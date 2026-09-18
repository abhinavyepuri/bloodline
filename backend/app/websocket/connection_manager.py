from typing import Dict, Iterable, List, Optional, Set
from fastapi import WebSocket
import json
import logging

logger = logging.getLogger("smartblood.ws")


class ConnectionManager:
    """
    Manages active WebSockets and multiplexes real-time event updates.

    Sockets register on named *channels* resolved from the authenticated user at
    connect time (role, and the id of the entity they own). Broadcasts target a
    channel instead of fanning every event out to every client, so a donor only
    receives alerts meant for them and a hospital only sees its own traffic.

    ``broadcast`` remains available for genuine system-wide events.
    """

    def __init__(self) -> None:
        self.active_connections: List[WebSocket] = []
        self.subscriptions: Dict[str, Set[WebSocket]] = {}
        self._socket_channels: Dict[WebSocket, Set[str]] = {}

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
    async def _send(self, sockets: Iterable[WebSocket], message: dict) -> None:
        payload = json.dumps(message, default=str)
        dead: List[WebSocket] = []
        for socket in list(sockets):
            try:
                await socket.send_text(payload)
            except Exception:
                # Socket is gone: reap it rather than leaking it forever.
                dead.append(socket)
        for socket in dead:
            self.disconnect(socket)

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

    # ---------------------------------------------------------- broadcasts
    async def broadcast(self, message: dict) -> None:
        """System-wide event: every connected client."""
        await self._send(self.active_connections, message)

    async def broadcast_to_role(self, role: str, message: dict) -> None:
        await self._send_to_channel(f"role:{role.strip().upper()}", message)

    async def broadcast_to_donors(self, donor_ids: Iterable[str], message: dict) -> None:
        """Target specific donors by their Donor id. Empty id list is a no-op."""
        channels = [f"entity:{d}" for d in donor_ids if d]
        if channels:
            await self._send_to_channels(channels, message)

    async def broadcast_to_hospital(self, hospital_id: Optional[str], message: dict) -> None:
        if hospital_id:
            await self._send_to_channel(f"entity:{hospital_id}", message)

    async def broadcast_to_blood_banks(self, message: dict) -> None:
        await self._send_to_channel("role:BLOOD_BANK", message)

    async def broadcast_to_coordinators(self, message: dict) -> None:
        await self._send_to_channels(["role:COORDINATOR", "role:ADMIN"], message)

    async def broadcast_operational(self, message: dict) -> None:
        """
        Operational event for the staff dashboards (hospitals, blood banks,
        coordinators, admins) — excludes donors, who should only see alerts
        targeted at them.
        """
        await self._send_to_channels(
            ["role:HOSPITAL", "role:BLOOD_BANK", "role:COORDINATOR", "role:ADMIN"],
            message,
        )


manager = ConnectionManager()
