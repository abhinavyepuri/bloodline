from sqlalchemy import Column, String, Float, Boolean, Date, ForeignKey, Integer
from sqlalchemy.orm import relationship
from geoalchemy2 import Geography
from app.models.base import TimestampedModel


class Donor(TimestampedModel):
    __tablename__ = "donors"

    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    blood_group = Column(String, index=True, nullable=False)  # e.g., "O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"
    date_of_birth = Column(Date, nullable=False)
    weight_kg = Column(Float, nullable=False)
    last_donation_date = Column(Date, nullable=True)
    is_available = Column(Boolean, default=True, index=True, nullable=False)
    reliability_score = Column(Float, default=1.0, nullable=False)  # 0.0 to 1.0
    total_successful_donations = Column(Integer, default=0, nullable=False)
    
    # PostGIS Point for exact spatial distance & isochrone calculations (SRID 4326: WGS84)
    location = Column(Geography(geometry_type="POINT", srid=4326), nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)

    user = relationship("User", backref="donor_profile")
