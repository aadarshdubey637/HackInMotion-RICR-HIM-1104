from datetime import datetime

from pydantic import BaseModel, Field


class FarmProfileCreate(BaseModel):
    farm_name: str
    location_text: str
    latitude: float | None = None
    longitude: float | None = None
    land_size_acres: float = Field(gt=0)
    soil_type: str | None = None
    current_crop: str | None = None
    planned_crop: str | None = None


class FarmProfileUpdate(BaseModel):
    farm_name: str | None = None
    location_text: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    land_size_acres: float | None = None
    soil_type: str | None = None
    current_crop: str | None = None
    planned_crop: str | None = None


class FarmProfileOut(BaseModel):
    id: str
    farm_name: str
    location_text: str
    latitude: float | None
    longitude: float | None
    land_size_acres: float
    soil_type: str | None
    current_crop: str | None
    planned_crop: str | None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
