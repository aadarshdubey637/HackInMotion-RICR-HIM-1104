from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.models import User, FarmProfile
from app.schemas.farm_schemas import FarmProfileCreate, FarmProfileUpdate, FarmProfileOut

router = APIRouter(prefix="/api/farms", tags=["farms"])


def _get_owned_farm_or_404(farm_id: str, current_user: User, db: Session) -> FarmProfile:
    """Every farm lookup goes through this — it's what keeps one farmer's data
    private from another (Key Requirement #1 in the problem statement)."""
    farm = db.query(FarmProfile).filter(FarmProfile.id == farm_id).first()
    if not farm or farm.owner_id != current_user.id:
        raise HTTPException(status_code=404, detail="Farm not found")
    return farm


@router.post("", response_model=FarmProfileOut, status_code=201)
def create_farm(
    payload: FarmProfileCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    farm = FarmProfile(owner_id=current_user.id, **payload.model_dump())
    db.add(farm)
    db.commit()
    db.refresh(farm)
    return farm


@router.get("", response_model=list[FarmProfileOut])
def list_farms(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(FarmProfile).filter(FarmProfile.owner_id == current_user.id).all()


@router.get("/{farm_id}", response_model=FarmProfileOut)
def get_farm(farm_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _get_owned_farm_or_404(farm_id, current_user, db)


@router.patch("/{farm_id}", response_model=FarmProfileOut)
def update_farm(
    farm_id: str,
    payload: FarmProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    farm = _get_owned_farm_or_404(farm_id, current_user, db)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(farm, field, value)
    db.commit()
    db.refresh(farm)
    return farm


@router.delete("/{farm_id}", status_code=204)
def delete_farm(farm_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    farm = _get_owned_farm_or_404(farm_id, current_user, db)
    db.delete(farm)
    db.commit()
