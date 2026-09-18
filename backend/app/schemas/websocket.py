from typing import Any, Optional
from pydantic import BaseModel


class WebSocketEvent(BaseModel):
    event_type: str  # "MATCH_FOUND", "PROXIMITY_BROADCAST", "REQUEST_FULFILLED", "RE_PLAN_TRIGGERED", "TRANSIT_UPDATE"
    request_id: Optional[str] = None
    data: Any
