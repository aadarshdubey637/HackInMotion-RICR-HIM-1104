import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.models import User, IrrigationLog
from app.routers.farms import _get_owned_farm_or_404
from app.services.weather_service import get_irrigation_guidance

router = APIRouter(prefix="/api/farms/{farm_id}/irrigation", tags=["irrigation"])


@router.get("")
async def get_irrigation(
    farm_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    farm = _get_owned_farm_or_404(farm_id, current_user, db)

    if farm.latitude is None or farm.longitude is None:
        raise HTTPException(
            status_code=422,
            detail="This farm has no coordinates set — add latitude/longitude to the farm profile first.",
        )

    try:
        result = await get_irrigation_guidance(farm.latitude, farm.longitude)
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Weather service is unavailable right now — please try again shortly.")

    log = IrrigationLog(
        farm_id=farm.id,
        guidance_text=result["guidance_text"],
        risk_level=result["risk_level"],
        raw_forecast=result["raw_forecast"],
    )
    db.add(log)
    db.commit()

    return {
        "guidance_text": result["guidance_text"],
        "risk_level": result["risk_level"],
        "alerts": result["alerts"],
    }


@router.get("/history")
def get_irrigation_history(
    farm_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    farm = _get_owned_farm_or_404(farm_id, current_user, db)
    logs = (
        db.query(IrrigationLog)
        .filter(IrrigationLog.farm_id == farm.id)
        .order_by(IrrigationLog.created_at.desc())
        .limit(20)
        .all()
    )
    return [
        {"id": l.id, "guidance_text": l.guidance_text, "risk_level": l.risk_level, "created_at": l.created_at}
        for l in logs
    ]
