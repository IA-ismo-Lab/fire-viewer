from __future__ import annotations
import os
from dataclasses import dataclass

try:
    from dotenv import load_dotenv  # type: ignore
except ImportError:  # pragma: no cover
    load_dotenv = None  # type: ignore

@dataclass
class Settings:
    map_key: str
    fetch_interval_min: int = 15
    dataset: str = "VIIRS_SNPP_NRT"
    bbox: str = "-8.20,41.80,-6.60,42.60"
    max_hours_default: int = 24
    day_range: int = 1  # días que devuelve el endpoint FIRMS (1..7 razonable)
    retention_hours: int = 72  # horas máximas que mantenemos en memoria para timeline
    weather_provider: str = "open-meteo"


def load_settings() -> Settings:
    # Carga variables desde .env si existe
    if load_dotenv:
        load_dotenv(".env", override=False)
    return Settings(
        map_key=os.getenv("FIRMS_MAP_KEY", ""),
        fetch_interval_min=int(os.getenv("FETCH_INTERVAL_MIN", "15")),
        dataset=os.getenv("FIRMS_DATASET", "VIIRS_SNPP_NRT"),
        # Soporta múltiples bounding boxes separadas por ';' (ej: "-10,35.5,4.5,44.5;-19,27.5,-12.5,29.5")
        bbox=os.getenv("BOUNDING_BOX", "-8.20,41.80,-6.60,42.60"),
        max_hours_default=int(os.getenv("MAX_HOURS_DEFAULT", "24")),
        day_range=int(os.getenv("FIRMS_DAY_RANGE", "1")),
        retention_hours=int(os.getenv("RETENTION_HOURS", "72")),
        weather_provider=os.getenv("WEATHER_PROVIDER", "open-meteo"),
    )
