"""
Weather + irrigation guidance.

Uses Open-Meteo (https://open-meteo.com) — free, no API key, generous rate
limits, which matters a lot for a live hackathon demo. Swap the base URL /
response parsing here if you pick a different provider; nothing else in the
app needs to change since routers only call `get_irrigation_guidance`.
"""
import httpx

from app.core.config import settings


async def fetch_forecast(latitude: float, longitude: float) -> dict:
    """Raises httpx.HTTPError on failure — callers must handle it (see
    Key Requirement #9: never leave the farmer with a blank/broken screen)."""
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "daily": "precipitation_sum,precipitation_probability_max,temperature_2m_max,"
                 "temperature_2m_min,windspeed_10m_max",
        "timezone": "auto",
        "forecast_days": 7,
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(f"{settings.weather_api_base_url}/forecast", params=params)
        response.raise_for_status()
        return response.json()


def build_irrigation_guidance(forecast: dict) -> dict:
    """Turns raw forecast JSON into a plain-language recommendation + risk
    level. Deliberately simple, explainable rules — a judge can read this
    function and understand exactly why it said what it said, which matters
    more in a hackathon than a fancier model would."""
    daily = forecast.get("daily", {})
    dates = daily.get("time", [])
    rain_mm = daily.get("precipitation_sum", [])
    rain_prob = daily.get("precipitation_probability_max", [])
    temp_max = daily.get("temperature_2m_max", [])
    wind_max = daily.get("windspeed_10m_max", [])

    if not dates:
        return {
            "guidance_text": "Forecast data unavailable right now — try again shortly.",
            "risk_level": "unknown",
            "alerts": [],
        }

    alerts = []
    next_2_days_rain = sum(rain_mm[:2]) if len(rain_mm) >= 2 else 0
    next_2_days_rain_likely = any(p >= 60 for p in rain_prob[:2]) if rain_prob else False

    # Irrigation guidance
    if next_2_days_rain >= 10 or next_2_days_rain_likely:
        guidance = "No need to irrigate for the next 2 days — meaningful rain is expected."
    elif next_2_days_rain > 0:
        guidance = "Light rain possible, but irrigate as normal — expected rainfall likely won't be enough on its own."
    else:
        guidance = "Irrigate today — no rain expected over the next 2 days."

    # Risk alerts
    risk_level = "none"
    if temp_max and max(temp_max[:3]) >= 42:
        alerts.append("Extreme heat warning — daytime temperatures may exceed 42°C in the next 3 days.")
        risk_level = "high"
    if rain_mm and max(rain_mm[:3]) >= 50:
        alerts.append("Heavy rain warning — possible flooding/waterlogging risk in the next 3 days.")
        risk_level = "high"
    if wind_max and max(wind_max[:3]) >= 40:
        alerts.append("High wind warning — may damage standing crops in the next 3 days.")
        risk_level = "moderate" if risk_level == "none" else risk_level
    if temp_max and min(temp_max[:3]) <= 5:
        alerts.append("Frost risk — low temperatures expected in the next 3 days.")
        risk_level = "high"

    return {
        "guidance_text": guidance,
        "risk_level": risk_level,
        "alerts": alerts,
    }


async def get_irrigation_guidance(latitude: float, longitude: float) -> dict:
    forecast = await fetch_forecast(latitude, longitude)
    guidance = build_irrigation_guidance(forecast)
    guidance["raw_forecast"] = forecast
    return guidance
