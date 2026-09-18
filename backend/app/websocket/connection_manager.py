from typing import List, Dict
from fastapi import WebSocket
import json


class ConnectionManager:
    """Manages active WebSockets and multiplexes real-time event updates."""

    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.user_subscriptions: Dict[str, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, user_id: str = "anonymous"):
        await websocket.accept()
        self.active_connections.append(websocket)
        if user_id not in self.user_subscriptions:
            self.user_subscriptions[user_id] = []
        self.user_subscriptions[user_id].append(websocket)

    def disconnect(self, websocket: WebSocket, user_id: str = "anonymous"):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        if user_id in self.user_subscriptions and websocket in self.user_subscriptions[user_id]:
            self.user_subscriptions[user_id].remove(websocket)

    async def broadcast(self, message: dict):
        """Broadcast event to all connected dashboard and mobile clients."""
        payload = json.dumps(message)
        for connection in self.active_connections:
            try:
                await connection.send_text(payload)
            except Exception:
                pass


manager = ConnectionManager()
