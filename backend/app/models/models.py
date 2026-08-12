import uuid
from datetime import datetime

from sqlalchemy import Column, String, Float, ForeignKey, DateTime, Text, JSON
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.core.database import Base


def gen_uuid():
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    full_name = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    farms = relationship("FarmProfile", back_populates="owner", cascade="all, delete-orphan")


class FarmProfile(Base):
    __tablename__ = "farm_profiles"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    owner_id = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=False)

    farm_name = Column(String, nullable=False)
    location_text = Column(String, nullable=False)  # e.g. "Bhopal, Madhya Pradesh"
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    land_size_acres = Column(Float, nullable=False)
    soil_type = Column(String, nullable=True)
    current_crop = Column(String, nullable=True)
    planned_crop = Column(String, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    owner = relationship("User", back_populates="farms")
    irrigation_logs = relationship("IrrigationLog", back_populates="farm", cascade="all, delete-orphan")
    crop_health_logs = relationship("CropHealthLog", back_populates="farm", cascade="all, delete-orphan")


class IrrigationLog(Base):
    """One row per generated weather/irrigation recommendation — doubles as history."""
    __tablename__ = "irrigation_logs"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    farm_id = Column(UUID(as_uuid=False), ForeignKey("farm_profiles.id"), nullable=False)

    guidance_text = Column(String, nullable=False)
    risk_level = Column(String, nullable=False)  # "none" | "low" | "moderate" | "high"
    raw_forecast = Column(JSON, nullable=True)  # cached API response for debugging/replay
    created_at = Column(DateTime, default=datetime.utcnow)

    farm = relationship("FarmProfile", back_populates="irrigation_logs")


class CropHealthLog(Base):
    __tablename__ = "crop_health_logs"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    farm_id = Column(UUID(as_uuid=False), ForeignKey("farm_profiles.id"), nullable=False)

    description = Column(Text, nullable=True)
    image_path = Column(String, nullable=True)
    analysis_result = Column(JSON, nullable=True)  # {"flags": [...], "recommendation": "..."}
    created_at = Column(DateTime, default=datetime.utcnow)

    farm = relationship("FarmProfile", back_populates="crop_health_logs")


class MarketPriceCache(Base):
    """Cache table so we don't hammer the market API on every dashboard load."""
    __tablename__ = "market_price_cache"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    crop_name = Column(String, index=True, nullable=False)
    state = Column(String, nullable=True)
    price_data = Column(JSON, nullable=False)  # list of {date, price, market}
    fetched_at = Column(DateTime, default=datetime.utcnow)
