from sqlalchemy import Column, String, Float, Text, JSON, ForeignKey
from sqlalchemy.orm import relationship
from app.models.base import TimestampedModel


class AllocationAuditLog(TimestampedModel):
    __tablename__ = "allocation_audit_logs"

    request_id = Column(String, ForeignKey("blood_requests.id", ondelete="CASCADE"), nullable=False)
    allocation_id = Column(String, ForeignKey("allocations.id", ondelete="SET NULL"), nullable=True)
    decision_type = Column(String, nullable=False)  # "INITIAL_MATCH", "RE_PLAN_EXPANSION", "FIRST_ACK_CLAIM", "ATTRITION_RECOVERY"
    urgency_score = Column(Float, nullable=False)
    
    # Mathematical and decision rationale
    candidate_scores_json = Column(JSON, nullable=False)  # Proximity, reliability, expiry weights
    selected_resource_id = Column(String, nullable=False)
    rationale_summary = Column(Text, nullable=False)

    request = relationship("BloodRequest")
    allocation = relationship("Allocation")
