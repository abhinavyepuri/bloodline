from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.websocket.connection_manager import manager

router = APIRouter()


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, client_id: str = "guest"):
    """[USER-FACING] WebSocket upgrade for live queue, match updates, and dispatch events."""
    await manager.connect(websocket, user_id=client_id)
    try:
        while True:
            # Keep connection alive and accept heartbeat pings
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text('{"type":"pong"}')
    except WebSocketDisconnect:
        manager.disconnect(websocket, user_id=client_id)
