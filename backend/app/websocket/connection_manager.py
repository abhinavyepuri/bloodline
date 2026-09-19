import asyncio
import json
import logging
import uuid
from typing import Dict, Iterable, List, Optional, Set
from fastapi import WebSocket
from app.core.redis import get_redis

logger = logging.getLogger("smartblood.ws")

REDIS_PUBSUB_CHANNEL = "smartblood:ws:events"


class ConnectionManager:
    """
    Manages active WebSockets and multiplexes real-time event updates across
    single-process or horizontally scaled multi-worker Uvicorn architectures.

    Sockets register on named channels resolved from the authenticated user
    (role, entity_id, user_id).
    Outgoing events are delivered immediately to local subscribers and simultaneously
    published to a Redis Pub/Sub backplane so connected WebSockets on other worker
    processes or cluster nodes receive the update in real-time.
    """

    def __init__(self) -> None:
        self.worker_id: str = uuid.uuid4().hex[:8]
        self.active_connections: List[WebSocket] = []
        self.subscriptions: Dict[str, Set[WebSocket]] = {}
        self._socket_channels: Dict[WebSocket, Set[str]] = {}
        self._pubsub_task: Optional[asyncio.Task] = None
        self._is_listening: bool = False
        self._background_tasks: Set[asyncio.Task] = set()

    # ------------------------------------------------------------ lifecycle
    async def connect(
        self,
        websocket: WebSocket,
        user_id: str = "anonymous",
        role: Optional[str] = None,
        entity_id: Optional[str] = None,
    ) -> None:
        await websocket.accept()
        self.active_connections.append(websocket)

        channels = {f"user:{user_id}"}
        if role:
            channels.add(f"role:{role.strip().upper()}")
        if entity_id:
            channels.add(f"entity:{entity_id}")

        self._socket_channels[websocket] = channels
        for channel in channels:
            self.subscriptions.setdefault(channel, set()).add(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

        for channel in self._socket_channels.pop(websocket, set()):
            subscribers = self.subscriptions.get(channel)
            if not subscribers:
                continue
            subscribers.discard(websocket)
            if not subscribers:
                self.subscriptions.pop(channel, None)

    # --------------------------------------------------------------- send
    async def _send_single(self, socket: WebSocket, payload: str, dead: List[WebSocket]) -> None:
        try:
            await socket.send_text(payload)
        except Exception:
            dead.append(socket)

    async def _send(self, sockets: Iterable[WebSocket], message: dict) -> None:
        socket_list = list(sockets)
        if not socket_list:
            return
        payload = json.dumps(message, default=str)
        dead: List[WebSocket] = []
        await asyncio.gather(
            *(self._send_single(s, payload, dead) for s in socket_list),
            return_exceptions=True,
        )
        for socket in dead:
            self.disconnect(socket)

    def dispatch(self, coroutine) -> asyncio.Task:
        """Fire-and-forget background broadcast that never blocks the HTTP response."""
        task = asyncio.create_task(coroutine)
        self._background_tasks.add(task)
        task.add_done_callback(self._background_tasks.discard)
        return task

    async def _send_to_channel(self, channel: str, message: dict) -> None:
        subscribers = self.subscriptions.get(channel)
        if subscribers:
            await self._send(subscribers, message)

    async def _send_to_channels(self, channels: Iterable[str], message: dict) -> None:
        seen: Set[WebSocket] = set()
        for channel in channels:
            seen.update(self.subscriptions.get(channel, set()))
        if seen:
            await self._send(seen, message)

    # ------------------------------------------------ Redis Pub/Sub Backplane
    async def _publish_to_backplane(self, channels: Optional[Iterable[str]], message: dict) -> None:
        """
        1. Delivers immediately to local WebSockets on this worker.
        2. Publishes to Redis Pub/Sub channel so peer workers deliver to their local clients.
        """
        # Step 1: Local delivery
        if channels is None:
            await self._send(self.active_connections, message)
        else:
            await self._send_to_channels(channels, message)

        # Step 2: Cross-worker Redis Pub/Sub broadcast
        try:
            redis_client = await get_redis()
            envelope = {
                "origin_worker_id": self.worker_id,
                "channels": list(channels) if channels else None,
                "message": message,
            }
            await redis_client.publish(REDIS_PUBSUB_CHANNEL, json.dumps(envelope, default=str))
        except Exception as e:
            logger.debug(f"[WS Backplane] Redis publish omitted/failed ({e})")

    async def _pubsub_listener_loop(self) -> None:
        """Background listener receiving broadcasts from peer workers via Redis."""
        while self._is_listening:
            try:
                redis_client = await get_redis()
                pubsub = redis_client.pubsub()
                await pubsub.subscribe(REDIS_PUBSUB_CHANNEL)
                logger.info(
                    f"[WS Backplane] Subscribed to Redis channel '{REDIS_PUBSUB_CHANNEL}' (worker {self.worker_id})"
                )

                async for raw in pubsub.listen():
                    if not self._is_listening:
                        break
                    if raw and raw.get("type") == "message":
                        data_str = raw.get("data")
                        if isinstance(data_str, bytes):
                            data_str = data_str.decode("utf-8")
                        if not isinstance(data_str, str):
                            continue
                        try:
                            envelope = json.loads(data_str)
                            # Ignore reflection of messages originated on this worker
                            if envelope.get("origin_worker_id") == self.worker_id:
                                continue
                            channels = envelope.get("channels")
                            msg = envelope.get("message")
                            if channels is None:
                                await self._send(self.active_connections, msg)
                            else:
                                await self._send_to_channels(channels, msg)
                        except Exception as parse_err:
                            logger.error(f"[WS Backplane] Error unpacking backplane message: {parse_err}")
            except asyncio.CancelledError:
                break
            except Exception as e:
                if self._is_listening:
                    logger.debug(f"[WS Backplane] Listener error ({e}), retrying in 5s...")
                    await asyncio.sleep(5)

    def start_pubsub_listener(self) -> None:
        if self._pubsub_task is None or self._pubsub_task.done():
            self._is_listening = True
            self._pubsub_task = asyncio.create_task(self._pubsub_listener_loop())

    def stop_pubsub_listener(self) -> None:
        self._is_listening = False
        if self._pubsub_task and not self._pubsub_task.done():
            self._pubsub_task.cancel()
        for task in list(self._background_tasks):
            if not task.done():
                task.cancel()
        self._background_tasks.clear()

    # ---------------------------------------------------------- broadcasts
    async def broadcast(self, message: dict) -> None:
        """System-wide event: every connected client across all cluster nodes."""
        await self._publish_to_backplane(None, message)

    async def broadcast_to_role(self, role: str, message: dict) -> None:
        await self._publish_to_backplane([f"role:{role.strip().upper()}"], message)

    async def broadcast_to_donors(self, donor_ids: Iterable[str], message: dict) -> None:
        """Target specific donors by their Donor id across all cluster nodes."""
        channels = [f"entity:{d}" for d in donor_ids if d]
        channels.append("role:DONOR")
        if channels:
            await self._publish_to_backplane(channels, message)

    async def broadcast_to_hospital(self, hospital_id: Optional[str], message: dict) -> None:
        if hospital_id:
            await self._publish_to_backplane([f"entity:{hospital_id}"], message)

    async def broadcast_to_blood_banks(self, message: dict) -> None:
        await self._publish_to_backplane(["role:BLOOD_BANK"], message)

    async def broadcast_to_coordinators(self, message: dict) -> None:
        await self._publish_to_backplane(["role:COORDINATOR", "role:ADMIN"], message)

    async def broadcast_operational(self, message: dict) -> None:
        """
        Operational event for staff dashboards (hospitals, blood banks, coordinators, admins)
        delivered across all cluster worker instances.
        """
        await self._publish_to_backplane(
            ["role:HOSPITAL", "role:BLOOD_BANK", "role:COORDINATOR", "role:ADMIN"],
            message,
        )


manager = ConnectionManager()
