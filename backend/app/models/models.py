import uuid
from datetime import datetime

from sqlalchemy import Column, String, Float, ForeignKey, DateTime, Text, JSON, Integer
from sqlalchemy.orm import relationship

from app.core.database import Base


def gen_uuid():
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    full_name = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    farms = relationship("FarmProfile", back_populates="owner", cascade="all, delete-orphan")


class FarmProfile(Base):
    __tablename__ = "farm_profiles"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    owner_id = Column(String(36), ForeignKey("users.id"), nullable=False)

    farm_name = Column(String, nullable=False)
    location_text = Column(String, nullable=False)  # e.g. "Bhopal, Madhya Pradesh"
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    land_size_acres = Column(Float, nullable=False)
    soil_type = Column(String, nullable=True)
    # kept for backward compat — dashboard uses crops table now
    current_crop = Column(String, nullable=True)
    planned_crop = Column(String, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    owner = relationship("User", back_populates="farms")
    irrigation_logs = relationship("IrrigationLog", back_populates="farm", cascade="all, delete-orphan")
    crop_health_logs = relationship("CropHealthLog", back_populates="farm", cascade="all, delete-orphan")
    crops = relationship("Crop", back_populates="farm", cascade="all, delete-orphan")
    crop_suggestions = relationship("CropSuggestion", back_populates="farm", cascade="all, delete-orphan")


class Crop(Base):
    """One row per crop slot on a farm — a farm can have many concurrent crops."""
    __tablename__ = "crops"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    farm_id = Column(String(36), ForeignKey("farm_profiles.id"), nullable=False)

    crop_name = Column(String, nullable=False)
    land_allocated_acres = Column(Float, nullable=False)   # portion of the farm assigned to this crop
    soil_type = Column(String, nullable=True)              # overrides farm default if set
    # status: planning | active | harvested
    status = Column(String, nullable=False, default="planning")
    planting_date = Column(DateTime, nullable=True)
    expected_harvest_date = Column(DateTime, nullable=True)
    notes = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    farm = relationship("FarmProfile", back_populates="crops")


class CropSuggestion(Base):
    """Stores the last AI suggestion run for a farm so we can show it without re-fetching."""
    __tablename__ = "crop_suggestions"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    farm_id = Column(String(36), ForeignKey("farm_profiles.id"), nullable=False)

    # JSON list of {crop_name, score, land_acres, reasoning, season}
    suggestions = Column(JSON, nullable=False)
    # snapshot of inputs used so the farmer knows what the suggestion was based on
    based_on = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    farm = relationship("FarmProfile", back_populates="crop_suggestions")


class IrrigationLog(Base):
    """One row per generated weather/irrigation recommendation — doubles as history."""
    __tablename__ = "irrigation_logs"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    farm_id = Column(String(36), ForeignKey("farm_profiles.id"), nullable=False)

    guidance_text = Column(String, nullable=False)
    risk_level = Column(String, nullable=False)  # "none" | "low" | "moderate" | "high"
    raw_forecast = Column(JSON, nullable=True)  # cached API response for debugging/replay
    created_at = Column(DateTime, default=datetime.utcnow)

    farm = relationship("FarmProfile", back_populates="irrigation_logs")


class CropHealthLog(Base):
    __tablename__ = "crop_health_logs"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    farm_id = Column(String(36), ForeignKey("farm_profiles.id"), nullable=False)

    description = Column(Text, nullable=True)
    image_path = Column(String, nullable=True)
    analysis_result = Column(JSON, nullable=True)  # {"flags": [...], "recommendation": "..."}
    created_at = Column(DateTime, default=datetime.utcnow)

    farm = relationship("FarmProfile", back_populates="crop_health_logs")


class MarketPriceCache(Base):
    """Cache table so we don't hammer the market API on every dashboard load."""
    __tablename__ = "market_price_cache"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    crop_name = Column(String, index=True, nullable=False)
    state = Column(String, nullable=True)
    price_data = Column(JSON, nullable=False)  # list of {date, price, market}
    fetched_at = Column(DateTime, default=datetime.utcnow)
