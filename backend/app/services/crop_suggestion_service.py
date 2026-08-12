"""
Crop suggestion engine.

Rule-based scoring — every decision is explainable in plain English, which
matters for farmer trust. The CROP_DB dict is the single source of truth;
add more crops here without touching the router or frontend.
"""
from __future__ import annotations

from datetime import datetime

# ---------------------------------------------------------------------------
# Crop knowledge base
# Each entry: temperature range, annual rainfall need, suitable soils,
# season, minimum land, and a water-need label.
# ---------------------------------------------------------------------------
CROP_DB: dict[str, dict] = {
    "Wheat": {
        "min_temp": 10, "max_temp": 25,
        "rain_mm_min": 300, "rain_mm_max": 700,
        "soils": ["Black soil", "Alluvial soil", "Not sure"],
        "season": "Rabi (Oct–Mar)",
        "min_acres": 0.5,
        "water": "moderate",
        "icon": "🌾",
    },
    "Rice": {
        "min_temp": 20, "max_temp": 40,
        "rain_mm_min": 1000, "rain_mm_max": 2000,
        "soils": ["Alluvial soil", "Black soil", "Not sure"],
        "season": "Kharif (Jun–Oct)",
        "min_acres": 0.5,
        "water": "high",
        "icon": "🌾",
    },
    "Maize": {
        "min_temp": 15, "max_temp": 35,
        "rain_mm_min": 500, "rain_mm_max": 900,
        "soils": ["Alluvial soil", "Red soil", "Not sure"],
        "season": "Kharif (Jun–Oct)",
        "min_acres": 0.3,
        "water": "moderate",
        "icon": "🌽",
    },
    "Cotton": {
        "min_temp": 20, "max_temp": 40,
        "rain_mm_min": 500, "rain_mm_max": 900,
        "soils": ["Black soil", "Not sure"],
        "season": "Kharif (Jun–Oct)",
        "min_acres": 1.0,
        "water": "moderate",
        "icon": "🌿",
    },
    "Soybean": {
        "min_temp": 20, "max_temp": 35,
        "rain_mm_min": 600, "rain_mm_max": 1000,
        "soils": ["Black soil", "Alluvial soil", "Not sure"],
        "season": "Kharif (Jun–Oct)",
        "min_acres": 0.5,
        "water": "moderate",
        "icon": "🫘",
    },
    "Chickpea": {
        "min_temp": 10, "max_temp": 30,
        "rain_mm_min": 300, "rain_mm_max": 700,
        "soils": ["Black soil", "Sandy soil", "Not sure"],
        "season": "Rabi (Oct–Mar)",
        "min_acres": 0.3,
        "water": "low",
        "icon": "🫛",
    },
    "Sugarcane": {
        "min_temp": 20, "max_temp": 40,
        "rain_mm_min": 1000, "rain_mm_max": 1500,
        "soils": ["Alluvial soil", "Black soil", "Not sure"],
        "season": "Year-round",
        "min_acres": 1.0,
        "water": "high",
        "icon": "🎋",
    },
    "Tomato": {
        "min_temp": 15, "max_temp": 30,
        "rain_mm_min": 400, "rain_mm_max": 700,
        "soils": ["Alluvial soil", "Red soil", "Laterite soil", "Not sure"],
        "season": "Year-round",
        "min_acres": 0.2,
        "water": "moderate",
        "icon": "🍅",
    },
    "Onion": {
        "min_temp": 13, "max_temp": 35,
        "rain_mm_min": 300, "rain_mm_max": 600,
        "soils": ["Alluvial soil", "Red soil", "Not sure"],
        "season": "Rabi (Oct–Mar)",
        "min_acres": 0.2,
        "water": "low",
        "icon": "🧅",
    },
    "Mustard": {
        "min_temp": 5, "max_temp": 25,
        "rain_mm_min": 250, "rain_mm_max": 500,
        "soils": ["Alluvial soil", "Sandy soil", "Not sure"],
        "season": "Rabi (Oct–Mar)",
        "min_acres": 0.3,
        "water": "low",
        "icon": "🌼",
    },
    "Groundnut": {
        "min_temp": 20, "max_temp": 35,
        "rain_mm_min": 500, "rain_mm_max": 900,
        "soils": ["Sandy soil", "Red soil", "Laterite soil", "Not sure"],
        "season": "Kharif (Jun–Oct)",
        "min_acres": 0.3,
        "water": "moderate",
        "icon": "🥜",
    },
    "Turmeric": {
        "min_temp": 20, "max_temp": 35,
        "rain_mm_min": 1000, "rain_mm_max": 2000,
        "soils": ["Alluvial soil", "Red soil", "Laterite soil", "Not sure"],
        "season": "Kharif (Jun–Oct)",
        "min_acres": 0.2,
        "water": "high",
        "icon": "🌿",
    },
}


def _estimate_annual_rain(forecast: dict) -> float:
    """Extrapolate 7-day rainfall to an annual estimate (rough but useful)."""
    daily = forecast.get("daily", {})
    rain_7 = sum(daily.get("precipitation_sum", []) or [])
    return rain_7 * (365 / 7)


def _avg_temp(forecast: dict) -> float:
    daily = forecast.get("daily", {})
    hi = daily.get("temperature_2m_max", [])
    lo = daily.get("temperature_2m_min", [])
    if not hi or not lo:
        return 25.0  # safe fallback
    return (sum(hi) / len(hi) + sum(lo) / len(lo)) / 2


def _score_crop(
    crop_name: str,
    info: dict,
    avg_temp: float,
    annual_rain_mm: float,
    soil_type: str | None,
    land_acres: float,
) -> tuple[int, list[str]]:
    """Returns (0-100 score, list-of-reason-strings)."""
    reasons: list[str] = []
    score = 100

    # --- temperature fit (40 pts) ---
    if avg_temp < info["min_temp"]:
        penalty = min(40, int((info["min_temp"] - avg_temp) * 4))
        score -= penalty
        reasons.append(
            f"Current avg temp ({avg_temp:.0f}°C) is below ideal minimum "
            f"({info['min_temp']}°C) — may need protection."
        )
    elif avg_temp > info["max_temp"]:
        penalty = min(40, int((avg_temp - info["max_temp"]) * 4))
        score -= penalty
        reasons.append(
            f"Temp ({avg_temp:.0f}°C) exceeds ideal max ({info['max_temp']}°C) — "
            "heat stress likely."
        )
    else:
        reasons.append(
            f"Temperature ({avg_temp:.0f}°C) is within the ideal range "
            f"({info['min_temp']}–{info['max_temp']}°C). ✓"
        )

    # --- rainfall fit (35 pts) ---
    if annual_rain_mm < info["rain_mm_min"]:
        shortage_pct = (info["rain_mm_min"] - annual_rain_mm) / info["rain_mm_min"]
        penalty = min(35, int(shortage_pct * 35))
        score -= penalty
        reasons.append(
            f"Estimated annual rainfall ({annual_rain_mm:.0f} mm) is below ideal "
            f"({info['rain_mm_min']} mm) — supplemental irrigation will be needed."
        )
    elif annual_rain_mm > info["rain_mm_max"]:
        excess_pct = (annual_rain_mm - info["rain_mm_max"]) / info["rain_mm_max"]
        penalty = min(35, int(excess_pct * 25))
        score -= penalty
        reasons.append(
            f"Rainfall may be higher than ideal — good drainage is important for {crop_name}."
        )
    else:
        reasons.append(
            f"Rainfall ({annual_rain_mm:.0f} mm/yr est.) suits {crop_name} well. ✓"
        )

    # --- soil fit (25 pts) ---
    if soil_type and soil_type not in info["soils"]:
        score -= 20
        reasons.append(
            f"Soil type '{soil_type}' is not ideal for {crop_name} "
            f"(prefers {', '.join(s for s in info['soils'] if s != 'Not sure')})."
        )
    elif soil_type and soil_type != "Not sure":
        reasons.append(f"Soil type '{soil_type}' works well for {crop_name}. ✓")

    # --- land size ---
    if land_acres < info["min_acres"]:
        score = max(0, score - 15)
        reasons.append(
            f"Minimum recommended plot for {crop_name} is {info['min_acres']} acres "
            f"— your available land ({land_acres:.2f} ac) is a bit tight."
        )

    return max(0, min(100, score)), reasons


def suggest_crops(
    forecast: dict,
    soil_type: str | None,
    total_land_acres: float,
    already_allocated_acres: float = 0.0,
) -> dict:
    """
    Main entry point called by the router.
    Returns suggestions + a land-division plan.
    """
    available = max(0.0, total_land_acres - already_allocated_acres)
    avg_temp = _avg_temp(forecast)
    annual_rain = _estimate_annual_rain(forecast)

    scored: list[dict] = []
    for name, info in CROP_DB.items():
        if available < info["min_acres"]:
            continue  # not enough land — skip silently
        score, reasons = _score_crop(name, info, avg_temp, annual_rain, soil_type, available)
        scored.append({
            "crop_name": name,
            "score": score,
            "season": info["season"],
            "icon": info["icon"],
            "water": info["water"],
            "min_acres": info["min_acres"],
            "reasoning": " ".join(reasons),
        })

    # Sort by score descending, take top 6
    scored.sort(key=lambda x: x["score"], reverse=True)
    top = scored[:6]

    # Build land-division plan for the top suggestions
    # Strategy: weight allocation by score, respect minimum acreage
    land_plan = _build_land_plan(top, available)

    # Attach land_acres to each suggestion from the plan
    plan_map = {p["crop_name"]: p["acres"] for p in land_plan}
    suggestions = [
        {
            "crop_name": c["crop_name"],
            "score": c["score"],
            "land_acres": plan_map.get(c["crop_name"], c["min_acres"]),
            "season": c["season"],
            "icon": c["icon"],
            "water": c["water"],
            "reasoning": c["reasoning"],
        }
        for c in top
    ]

    based_on = {
        "avg_temp_c": round(avg_temp, 1),
        "estimated_annual_rain_mm": round(annual_rain, 0),
        "soil_type": soil_type or "Not specified",
        "total_land_acres": total_land_acres,
        "available_land_acres": available,
        "already_allocated_acres": already_allocated_acres,
    }

    return {
        "suggestions": suggestions,
        "land_plan": land_plan,
        "available_land_acres": available,
        "based_on": based_on,
    }


def _build_land_plan(top_crops: list[dict], available_acres: float) -> list[dict]:
    """
    Divide available land proportionally by score, but cap each crop at
    40% of total land so no single crop dominates unless forced to.
    """
    if not top_crops or available_acres <= 0:
        return []

    total_score = sum(c["score"] for c in top_crops) or 1
    cap = available_acres * 0.40

    raw = [
        {
            "crop_name": c["crop_name"],
            "icon": c["icon"],
            "acres": round(min(cap, (c["score"] / total_score) * available_acres), 2),
        }
        for c in top_crops
    ]

    # Ensure nobody got less than their minimum (re-scale if needed)
    for i, c in enumerate(top_crops):
        if raw[i]["acres"] < c["min_acres"]:
            raw[i]["acres"] = c["min_acres"]

    # Trim to available land
    total_assigned = sum(r["acres"] for r in raw)
    if total_assigned > available_acres:
        factor = available_acres / total_assigned
        for r in raw:
            r["acres"] = round(r["acres"] * factor, 2)

    total_final = sum(r["acres"] for r in raw)
    for r in raw:
        r["pct"] = round((r["acres"] / total_final) * 100, 1) if total_final > 0 else 0

    return raw
