import json
from typing import Optional

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import resolve_role
from app.core.config import settings
from app.core.database import get_db
from app.core.permissions import UserRole
from app.models.blood_bank import BloodBank
from app.models.donor import Donor
from app.models.hospital import Hospital
from app.models.user import User
from app.websocket.connection_manager import manager

router = APIRouter()

# RFC 6455 policy-violation close code.
WS_POLICY_VIOLATION = 1008


async def _resolve_entity_id(db: AsyncSession, user: User, role: str) -> Optional[str]:
    """
    The id of the profile this user owns, used as a targeted channel.

    Donors, hospitals and blood banks only ever receive events addressed to their
    own entity; coordinators and admins have no single entity and receive
    role-scoped events instead.
    """
    if role == UserRole.HOSPITAL.value:
        res = await db.execute(select(Hospital.id).where(Hospital.user_id == user.id))
    elif role == UserRole.BLOOD_BANK.value:
        res = await db.execute(select(BloodBank.id).where(BloodBank.user_id == user.id))
    elif role == UserRole.DONOR.value:
        res = await db.execute(select(Donor.id).where(Donor.user_id == user.id))
    else:
        return None
    return res.scalar()


async def _reject(websocket: WebSocket, reason: str) -> None:
    """
    Close an unauthenticated socket.

    The socket is accepted first purely so the client receives an application-level
    close code (1008) rather than an opaque handshake failure — otherwise a browser
    cannot distinguish "your token was rejected" from "the network blipped" and
    retries forever. Nothing is ever registered with the connection manager, so no
    events can reach a rejected socket.
    """
    try:
        await websocket.accept()
        await websocket.send_text(json.dumps({"type": "AUTH_ERROR", "message": reason}))
    except Exception:
        pass
    await websocket.close(code=WS_POLICY_VIOLATION)


async def _authenticate(
    websocket: WebSocket, token: Optional[str], db: AsyncSession
) -> Optional[User]:
    """Decode the JWT and load the active user, rejecting the socket on any failure."""
    if not token:
        await _reject(websocket, "Authentication token is required")
        return None

    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id: Optional[str] = payload.get("sub")
        if not user_id:
            raise JWTError("Token is missing the subject claim")
    except JWTError:
        await _reject(websocket, "Invalid or expired authentication token")
        return None

    user = await db.get(User, user_id)
    if user is None or not user.is_active:
        await _reject(websocket, "Account is missing or inactive")
        return None

    return user


@router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    token: Optional[str] = Query(None, description="JWT access token issued by /auth/login"),
    db: AsyncSession = Depends(get_db),
):
    """
    [USER-FACING] Authenticated WebSocket for live queue, match and dispatch events.

    Clients subscribe with ``/ws?token=<jwt>`` and receive only the events addressed
    to their own user, role and entity.
    """
    user = await _authenticate(websocket, token, db)
    if user is None:
        return

    role = resolve_role(user)
    entity_id = await _resolve_entity_id(db, user, role)

    await manager.connect(websocket, user_id=user.id, role=role, entity_id=entity_id)
    try:
        while True:
            data = await websocket.receive_text()
            if data.strip() in ("ping", '{"type":"ping"}'):
                await websocket.send_text('{"type":"pong"}')
    except WebSocketDisconnect:
        pass
    except Exception:
        # A send/receive failure mid-stream must still unpick the socket from the
        # manager rather than leaking it into active_connections forever.
        pass
    finally:
        manager.disconnect(websocket)
