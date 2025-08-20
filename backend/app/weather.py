from __future__ import annotations
from typing import Any, Dict
import requests

"""Proveedor meteorológico simple (placeholder) para viento.

Implementación inicial usando Open-Meteo (gratuito, sin API key) para obtener dirección y velocidad media de viento
sobre el centro aproximado del bounding box.
"""


def wind_from_open_meteo(lat: float, lon: float) -> Dict[str, Any]:
    url = (
        "https://api.open-meteo.com/v1/forecast?latitude="
        f"{lat}&longitude={lon}&hourly=windspeed_10m,winddirection_10m&current_weather=true"
    )
    r = requests.get(url, timeout=20)
    if r.status_code != 200:
        raise RuntimeError(f"Open-Meteo HTTP {r.status_code}")
    data = r.json()
    current = data.get("current_weather", {})
    return {
        "windspeed": current.get("windspeed"),
        "winddirection": current.get("winddirection"),  # grados meteorológicos
        "time": current.get("time"),
        "source": "open-meteo",
    }


def parse_bbox_center(bbox: str) -> tuple[float, float]:
    # bbox formato: lon_min,lat_min,lon_max,lat_max
    parts = [p.strip() for p in bbox.split(",")]
    if len(parts) != 4:
        raise ValueError("Formato BOUNDING_BOX inválido")
    lon_min, lat_min, lon_max, lat_max = map(float, parts)
    return (lat_min + lat_max) / 2.0, (lon_min + lon_max) / 2.0
