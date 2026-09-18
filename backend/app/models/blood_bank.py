from sqlalchemy import Column, String, Float, ForeignKey
from sqlalchemy.orm import relationship
from geoalchemy2 import Geography
from app.models.base import TimestampedModel


class BloodBank(TimestampedModel):
    __tablename__ = "blood_banks"

    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    name = Column(String, nullable=False)
    license_number = Column(String, unique=True, index=True, nullable=False)
    address = Column(String, nullable=False)
    contact_phone = Column(String, nullable=False)

    # PostGIS Location
    location = Column(Geography(geometry_type="POINT", srid=4326), nullable=False)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)

    user = relationship("User", backref="blood_bank_profile")
    inventory_units = relationship("InventoryUnit", back_populates="blood_bank")
