from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.models import User, Crop, CropSuggestion
from app.routers.farms import _get_owned_farm_or_404
from app.schemas.crop_schemas import CropCreate, CropUpdate, CropOut, CropSuggestionOut
from app.services.weather_service import fetch_forecast
from app.services.crop_suggestion_service import suggest_crops

import httpx
from datetime import datetime

router = APIRouter(prefix="/api/farms/{farm_id}/crops", tags=["crops"])


def _get_owned_crop_or_404(crop_id: str, farm_id: str, db: Session) -> Crop:
    crop = db.query(Crop).filter(Crop.id == crop_id, Crop.farm_id == farm_id).first()
    if not crop:
        raise HTTPException(status_code=404, detail="Crop not found")
    return crop


def _allocated_acres(farm_id: str, db: Session, exclude_id: str | None = None) -> float:
    q = db.query(Crop).filter(Crop.farm_id == farm_id, Crop.status != "harvested")
    if exclude_id:
        q = q.filter(Crop.id != exclude_id)
    crops = q.all()
    return sum(c.land_allocated_acres for c in crops)


# ── CRUD ───────────────────────────────────────────────────────────────────────

@router.post("", response_model=CropOut, status_code=201)
def add_crop(
    farm_id: str,
    payload: CropCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    farm = _get_owned_farm_or_404(farm_id, current_user, db)

    already = _allocated_acres(farm_id, db)
    if already + payload.land_allocated_acres > farm.land_size_acres:
        available = farm.land_size_acres - already
        raise HTTPException(
            status_code=422,
            detail=f"Not enough land. Available: {available:.2f} acres, requested: {payload.land_allocated_acres} acres.",
        )

    crop = Crop(farm_id=farm.id, **payload.model_dump())
    db.add(crop)
    db.commit()
    db.refresh(crop)
    return crop


@router.get("", response_model=list[CropOut])
def list_crops(
    farm_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    farm = _get_owned_farm_or_404(farm_id, current_user, db)
    return db.query(Crop).filter(Crop.farm_id == farm.id).order_by(Crop.created_at).all()


@router.get("/{crop_id}", response_model=CropOut)
def get_crop(
    farm_id: str,
    crop_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _get_owned_farm_or_404(farm_id, current_user, db)
    return _get_owned_crop_or_404(crop_id, farm_id, db)


@router.patch("/{crop_id}", response_model=CropOut)
def update_crop(
    farm_id: str,
    crop_id: str,
    payload: CropUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    farm = _get_owned_farm_or_404(farm_id, current_user, db)
    crop = _get_owned_crop_or_404(crop_id, farm_id, db)

    if payload.land_allocated_acres is not None:
        already = _allocated_acres(farm_id, db, exclude_id=crop_id)
        if already + payload.land_allocated_acres > farm.land_size_acres:
            available = farm.land_size_acres - already
            raise HTTPException(
                status_code=422,
                detail=f"Not enough land. Available: {available:.2f} acres.",
            )

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(crop, field, value)
    crop.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(crop)
    return crop


@router.delete("/{crop_id}", status_code=204)
def delete_crop(
    farm_id: str,
    crop_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _get_owned_farm_or_404(farm_id, current_user, db)
    crop = _get_owned_crop_or_404(crop_id, farm_id, db)
    db.delete(crop)
    db.commit()


# ── Suggestions ────────────────────────────────────────────────────────────────

@router.get("/suggestions/run", response_model=CropSuggestionOut)
async def get_suggestions(
    farm_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    farm = _get_owned_farm_or_404(farm_id, current_user, db)

    if farm.latitude is None or farm.longitude is None:
        raise HTTPException(
            status_code=422,
            detail="Add latitude/longitude to your farm profile first — suggestions need weather data.",
        )

    try:
        forecast = await fetch_forecast(farm.latitude, farm.longitude)
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Weather service unavailable — try again shortly.")

    already_allocated = _allocated_acres(farm_id, db)
    result = suggest_crops(
        forecast=forecast,
        soil_type=farm.soil_type,
        total_land_acres=farm.land_size_acres,
        already_allocated_acres=already_allocated,
    )

    # Persist so the frontend can load without re-calling weather API
    suggestion_row = CropSuggestion(
        farm_id=farm.id,
        suggestions=result["suggestions"],
        based_on=result["based_on"],
    )
    db.add(suggestion_row)
    db.commit()
    db.refresh(suggestion_row)

    return CropSuggestionOut(
        suggestions=result["suggestions"],
        land_plan=result["land_plan"],
        available_land_acres=result["available_land_acres"],
        based_on=result["based_on"],
        created_at=suggestion_row.created_at,
    )


@router.get("/suggestions/latest", response_model=CropSuggestionOut | None)
def get_latest_suggestion(
    farm_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Returns the most recent cached suggestion without hitting the weather API."""
    _get_owned_farm_or_404(farm_id, current_user, db)
    row = (
        db.query(CropSuggestion)
        .filter(CropSuggestion.farm_id == farm_id)
        .order_by(CropSuggestion.created_at.desc())
        .first()
    )
    if not row:
        return None

    # Re-build land plan from cached suggestions
    from app.services.crop_suggestion_service import _build_land_plan, CROP_DB
    top = [
        {**s, "min_acres": CROP_DB.get(s["crop_name"], {}).get("min_acres", 0.1), "icon": s.get("icon", "")}
        for s in row.suggestions
    ]
    available = row.based_on.get("available_land_acres", 0)
    land_plan = _build_land_plan(top, available)

    return CropSuggestionOut(
        suggestions=row.suggestions,
        land_plan=land_plan,
        available_land_acres=available,
        based_on=row.based_on,
        created_at=row.created_at,
    )
