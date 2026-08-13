from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


# ── Crop CRUD ──────────────────────────────────────────────────────────────────

CropStatus = Literal["planning", "active", "harvested"]


class CropCreate(BaseModel):
    crop_name: str
    land_allocated_acres: float = Field(gt=0)
    soil_type: str | None = None
    status: CropStatus = "planning"
    planting_date: datetime | None = None
    expected_harvest_date: datetime | None = None
    notes: str | None = None


class CropUpdate(BaseModel):
    crop_name: str | None = None
    land_allocated_acres: float | None = Field(default=None, gt=0)
    soil_type: str | None = None
    status: CropStatus | None = None
    planting_date: datetime | None = None
    expected_harvest_date: datetime | None = None
    notes: str | None = None


class CropOut(BaseModel):
    id: str
    farm_id: str
    crop_name: str
    land_allocated_acres: float
    soil_type: str | None
    status: CropStatus
    planting_date: datetime | None
    expected_harvest_date: datetime | None
    notes: str | None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ── Crop Suggestions ───────────────────────────────────────────────────────────

class SuggestedCrop(BaseModel):
    crop_name: str
    score: int                     # 0-100 suitability score
    land_acres: float              # recommended land allocation
    season: str                    # e.g. "Kharif (Jun-Oct)"
    reasoning: str                 # plain-language explanation


class CropSuggestionOut(BaseModel):
    suggestions: list[SuggestedCrop]
    land_plan: list[dict]          # [{crop_name, acres, pct}] — the division layout
    available_land_acres: float
    based_on: dict                 # summary of inputs used
    created_at: datetime

    class Config:
        from_attributes = True
