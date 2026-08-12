from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Central app config. Reads from .env; every field has a safe-ish default
    so the app doesn't crash on import if .env is missing (it will fail loudly
    later when a real DB connection or secret is actually needed)."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    database_url: str = "postgresql://postgres:postgres@localhost:5432/smart_farm"

    secret_key: str = "dev-only-secret-change-me"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60

    weather_api_base_url: str = "https://api.open-meteo.com/v1"

    market_api_key: str = ""
    market_api_base_url: str = "https://api.data.gov.in/resource"

    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


settings = Settings()
