from __future__ import annotations
import datetime as dt
import threading
import time
import requests
from typing import List, Dict, Any
from .config import Settings
from .models import FireRecord, parse_records, to_geojson

class FireCache:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._records: List[FireRecord] = []
        self.last_fetch: dt.datetime | None = None
        self.last_error: str | None = None

    def update(self, records: List[FireRecord], ts: dt.datetime, retention_hours: int) -> None:
        with self._lock:
            # Añadir nuevos registros y deduplicar conservando el más reciente (en práctica mismo contenido)
            current: Dict[str, FireRecord] = {r.uid(): r for r in self._records}
            for r in records:
                current[r.uid()] = r
            # Prune por ventana de retención
            cutoff = ts - dt.timedelta(hours=retention_hours)
            self._records = [r for r in current.values() if r.timestamp_utc() >= cutoff]
            self.last_fetch = ts
            self.last_error = None

    def set_error(self, err: str) -> None:
        with self._lock:
            self.last_error = err

    def clear(self) -> None:
        with self._lock:
            self._records = []
            self.last_fetch = None
            self.last_error = None

    def get_geojson(self, max_age_hours: int, now: dt.datetime) -> Dict[str, Any]:
        with self._lock:
            if not self._records:
                return {"type": "FeatureCollection", "features": []}
            cutoff = now - dt.timedelta(hours=max_age_hours)
            subset = [r for r in self._records if r.timestamp_utc() >= cutoff]
        return to_geojson(subset, now)

    def stats(self, now: dt.datetime) -> Dict[str, Any]:
        with self._lock:
            total = len(self._records)
            lf = self.last_fetch.isoformat() if self.last_fetch else None
            err = self.last_error
        ages = [int((now - r.timestamp_utc()).total_seconds() / 60) for r in self._records]
        return {
            "total": total,
            "last_fetch": lf,
            "last_error": err,
            "age_minutes_min": min(ages) if ages else None,
            "age_minutes_max": max(ages) if ages else None,
        }

    def get_all_geojson(self, now: dt.datetime) -> Dict[str, Any]:
        with self._lock:
            records = list(self._records)
        return to_geojson(records, now)


def build_area_url(st: Settings, bbox: str, day_range: int) -> str:
    return f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{st.map_key}/{st.dataset}/{bbox}/{day_range}"


def fetch_once(st: Settings, timeout=50) -> List[FireRecord]:
    all_records: Dict[str, FireRecord] = {}
    # Soporta múltiples bboxes separadas por ';'
    bboxes = [b.strip() for b in st.bbox.split(';') if b.strip()]
    for bb in bboxes:
        url = build_area_url(st, bb, st.day_range)
        r = requests.get(url, timeout=timeout)
        if r.status_code != 200:
            # Continuar con otras bboxes pero registrar error parcial
            continue
        records = parse_records(r.text)
        for rec in records:
            all_records[rec.uid()] = rec
    return list(all_records.values())


def fetch_with_day_range(st: Settings, day_range: int, timeout=60) -> List[FireRecord]:
    """Descarga datos usando un day_range específico (1..7) sin alterar settings global.
    Se usa para historiales cuando el cache no alcanza."""
    all_records: Dict[str, FireRecord] = {}
    bboxes = [b.strip() for b in st.bbox.split(';') if b.strip()]
    for bb in bboxes:
        url = build_area_url(st, bb, day_range)
        r = requests.get(url, timeout=timeout)
        if r.status_code != 200:
            continue
        records = parse_records(r.text)
        for rec in records:
            all_records[rec.uid()] = rec
    return list(all_records.values())


def start_background_fetcher(st: Settings, cache: FireCache) -> None:
    def loop() -> None:
        while True:
            if not st.map_key:
                cache.set_error("MAP_KEY vacío")
                time.sleep(st.fetch_interval_min * 60)
                continue
            try:
                records = fetch_once(st)
                cache.update(records, dt.datetime.now(dt.timezone.utc), st.retention_hours)
            except Exception as e:  # noqa
                cache.set_error(str(e))
            time.sleep(st.fetch_interval_min * 60)
    t = threading.Thread(target=loop, name="FireFetcher", daemon=True)
    t.start()
