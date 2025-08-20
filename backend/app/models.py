from __future__ import annotations
import csv
import datetime as dt
import hashlib
from dataclasses import dataclass
from io import StringIO
from typing import Any, Dict, List

@dataclass
class FireRecord:
    latitude: float
    longitude: float
    acq_date: str
    acq_time: str
    satellite: str
    instrument: str
    frp: float | None
    confidence: str | None
    daynight: str | None
    raw: Dict[str, Any]

    def timestamp_utc(self) -> dt.datetime:
        hour = int(self.acq_time.zfill(4)[:2])
        minute = int(self.acq_time.zfill(4)[2:])
        return dt.datetime.strptime(self.acq_date, "%Y-%m-%d").replace(hour=hour, minute=minute, tzinfo=dt.timezone.utc)

    def uid(self) -> str:
        h = hashlib.sha1()
        ident = f"{self.latitude:.5f}|{self.longitude:.5f}|{self.acq_date}|{self.acq_time}|{self.satellite}|{self.instrument}"
        h.update(ident.encode())
        return h.hexdigest()[:16]

    def age_minutes(self, now: dt.datetime) -> int:
        return int((now - self.timestamp_utc()).total_seconds() / 60)


def parse_records(csv_text: str) -> List[FireRecord]:
    buf = StringIO(csv_text)
    reader = csv.DictReader(buf)
    out: List[FireRecord] = []
    for row in reader:
        try:
            out.append(
                FireRecord(
                    latitude=float(row.get("latitude") or 0.0),
                    longitude=float(row.get("longitude") or 0.0),
                    acq_date=row.get("acq_date", ""),
                    acq_time=row.get("acq_time", ""),
                    satellite=row.get("satellite", ""),
                    instrument=row.get("instrument", ""),
                    frp=_try_float(row.get("frp")),
                    confidence=row.get("confidence"),
                    daynight=row.get("daynight"),
                    raw=row,
                )
            )
        except Exception:
            continue
    return out


def _try_float(v: Any) -> float | None:
    try:
        return float(v) if v not in (None, "") else None
    except Exception:
        return None


def to_geojson(records: List[FireRecord], now: dt.datetime) -> Dict[str, Any]:
    features = []
    for r in records:
        try:
            age = r.age_minutes(now)
            ts_iso = r.timestamp_utc().isoformat()
        except Exception:
            continue
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [r.longitude, r.latitude]},
                "properties": {
                    "uid": r.uid(),
                    "sensor": r.instrument,
                    "satellite": r.satellite,
                    "frp": r.frp,
                    "confidence": r.confidence,
                    "daynight": r.daynight,
                    "ts_utc": ts_iso,
                    "age_minutes": age,
                },
            }
        )
    return {"type": "FeatureCollection", "features": features}
