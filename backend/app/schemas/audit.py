from datetime import datetime
from typing import Any, Dict, Optional
from pydantic import BaseModel, ConfigDict


class AllocationAuditLogOut(BaseModel):
    id: str
    request_id: str
    allocation_id: Optional[str] = None
    decision_type: str
    urgency_score: float
    candidate_scores_json: Dict[str, Any]
    selected_resource_id: str
    rationale_summary: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
