from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.database import Base, engine
from app.routers import auth, farms, irrigation

# Hackathon-speed table creation. Swap for Alembic migrations if you have
# time later — see the alembic/ folder note in README.
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Smart Farm Decision Support System API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(farms.router)
app.include_router(irrigation.router)


@app.get("/api/health")
def health_check():
    return {"status": "ok"}
