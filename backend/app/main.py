from __future__ import annotations
import datetime as dt
from fastapi import FastAPI, Query
from fastapi import HTTPException
from fastapi.middleware.cors import CORSMiddleware
from .config import load_settings
from .fetcher import FireCache, start_background_fetcher, fetch_once, fetch_with_day_range
from .weather import wind_from_open_meteo, parse_bbox_center

settings = load_settings()
app = FastAPI(title="Fire Viewer API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # TODO: restringir en producción
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
cache = FireCache()

# Fetch inicial inmediato (no bloquear si falla)
if settings.map_key:
    try:
        initial_records = fetch_once(settings)
        cache.update(initial_records, dt.datetime.now(dt.timezone.utc), settings.retention_hours)
    except Exception as e:  # noqa
        cache.set_error(f"init: {e}")
else:
    cache.set_error("MAP_KEY vacío")

if settings.fetch_interval_min > 0:
    start_background_fetcher(settings, cache)

@app.get("/")
def root():
    return {"service": "fire-viewer-api", "version": "0.1.0"}

@app.get("/health")
def health():
    now = dt.datetime.now(dt.timezone.utc)
    st = cache.stats(now)
    st["config_dataset"] = settings.dataset
    st["config_bbox"] = settings.bbox
    return st

@app.get("/fires")
def fires(
    hours: int = Query(default=None, ge=1, le=72),
    min_conf: str | None = Query(default=None, description="Filtra confianza mínima (l|n|h)"),
    sensor: str | None = Query(default=None, description="Filtra por instrumento/sensor"),
):
    now = dt.datetime.now(dt.timezone.utc)
    h = hours or settings.max_hours_default
    gj = cache.get_geojson(h, now)
    if min_conf or sensor:
        feats = []
        min_order = {"l": 0, "n": 1, "h": 2}
        thr = min_order.get((min_conf or "").lower(), -1)
        for f in gj["features"]:
            p = f.get("properties", {})
            c = (p.get("confidence") or "").lower()
            if sensor and (p.get("sensor") or "").lower() != sensor.lower():
                continue
            if thr >= 0 and min_order.get(c, -1) < thr:
                continue
            feats.append(f)
        gj["features"] = feats
    return gj

@app.post("/admin/reset")
def reset_cache():
    cache.clear()
    return {"status": "cleared"}

@app.post("/admin/fetch_now")
def fetch_now():
    if not settings.map_key:
        raise HTTPException(400, "MAP_KEY no configurado")
    try:
        records = fetch_once(settings)
        cache.update(records, dt.datetime.now(dt.timezone.utc), settings.retention_hours)
        return {"status": "ok", "added": len(records)}
    except Exception as e:  # noqa
        raise HTTPException(500, f"fetch error: {e}")

@app.get("/history_daily")
def history_daily(
    start_date: str = Query(..., description="YYYY-MM-DD UTC inclusive"),
    end_date: str = Query(..., description="YYYY-MM-DD UTC inclusive"),
    min_conf: str | None = Query(default=None),
    sensor: str | None = Query(default=None),
    fetch_if_missing: bool = Query(default=True, description="Si true y faltan días, intenta fetch directo a FIRMS (hasta 7)."),
):
    """Agrega incendios por día (timeline diario). Puede complementar cache haciendo fetch directo
    con day_range adecuado hasta 7 días cuando se solicita un rango mayor que lo retenido localmente.
    Devuelve {days:[{date:'YYYY-MM-DD', count:int, features:[..]}], total:int}.
    Nota: FIRMS area API sólo permite day_range máximo ~7 (NRT)."""
    try:
        sd = dt.datetime.strptime(start_date, "%Y-%m-%d").replace(tzinfo=dt.timezone.utc)
        ed = dt.datetime.strptime(end_date, "%Y-%m-%d").replace(tzinfo=dt.timezone.utc)
    except ValueError:
        raise HTTPException(400, "Formato de fecha inválido")
    if ed < sd:
        raise HTTPException(400, "end_date < start_date")
    span_days = (ed.date() - sd.date()).days + 1
    if span_days > 7:
        raise HTTPException(400, "Máximo 7 días (limitación FIRMS area endpoint)")
    now = dt.datetime.now(dt.timezone.utc)
    # Datos de cache
    gj_all = cache.get_all_geojson(now)
    feats_cache = gj_all["features"]
    # Determinar si cache cubre intervalo completo
    have_dates = set()
    for f in feats_cache:
        p = f.get("properties", {})
        ts_str = p.get("ts_utc")
        if not ts_str:
            continue
        try:
            ts = dt.datetime.fromisoformat(ts_str)
        except Exception:
            continue
        d = ts.date()
        if sd.date() <= d <= ed.date():
            have_dates.add(d)
    need_fetch = fetch_if_missing and len(have_dates) < span_days
    extra_records = []
    if need_fetch:
        day_range = span_days
        try:
            extra_records = fetch_with_day_range(settings, day_range)
        except Exception as e:  # noqa
            # No abortar; continuar con lo que haya
            pass
    # Combinar (deduplicar por uid)
    merged = {}
    for f in feats_cache:
        p = f.get("properties", {})
        merged[p.get("uid")] = f
    for r in extra_records:
        try:
            ts_iso = r.timestamp_utc().isoformat()
            uid = r.uid()
            merged[uid] = {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [r.longitude, r.latitude]},
                "properties": {
                    "uid": uid,
                    "sensor": r.instrument,
                    "satellite": r.satellite,
                    "frp": r.frp,
                    "confidence": r.confidence,
                    "daynight": r.daynight,
                    "ts_utc": ts_iso,
                    "age_minutes": int((now - r.timestamp_utc()).total_seconds()/60),
                },
            }
        except Exception:
            continue
    feats_all = list(merged.values())
    # Filtros y recorte al rango
    out_feats = []
    min_order = {"l":0, "n":1, "h":2}
    thr = min_order.get((min_conf or '').lower(), -1)
    for f in feats_all:
        p = f.get("properties", {})
        try:
            ts = dt.datetime.fromisoformat(p.get("ts_utc"))
        except Exception:
            continue
        if not (sd.date() <= ts.date() <= ed.date()):
            continue
        c = (p.get("confidence") or '').lower()
        if thr >=0 and min_order.get(c, -1) < thr:
            continue
        if sensor and (p.get("sensor") or '').lower() != sensor.lower():
            continue
        out_feats.append(f)
    buckets: dict[str, list] = {}
    for f in out_feats:
        day_key = f["properties"]["ts_utc"][:10]
        buckets.setdefault(day_key, []).append(f)
    days_out = []
    for k in sorted(buckets.keys()):
        days_out.append({
            "date": k,
            "count": len(buckets[k]),
            "features": buckets[k],
        })
    return {"days": days_out, "total": len(out_feats), "fetched_extra": need_fetch and bool(extra_records)}

@app.get("/weather")
def weather():
    """Devuelve información meteorológica usando OpenMeteo API."""
    lat, lon = parse_bbox_center(settings.bbox.split(';')[0])
    try:
        om = wind_from_open_meteo(lat, lon)
        return {"provider": "open-meteo", **om}
    except Exception as e:  # noqa
        return {"error": str(e)}

@app.get("/stats")
def stats():
    now = dt.datetime.now(dt.timezone.utc)
    st = cache.stats(now)
    gj = cache.get_geojson(settings.max_hours_default, now)
    by_sensor: dict[str, int] = {}
    by_conf: dict[str, int] = {}
    for f in gj["features"]:
        p = f.get("properties", {})
        s = (p.get("sensor") or "").lower()
        c = (p.get("confidence") or "").lower()
        if s:
            by_sensor[s] = by_sensor.get(s, 0) + 1
        if c:
            by_conf[c] = by_conf.get(c, 0) + 1
    st["by_sensor"] = by_sensor
    st["by_confidence"] = by_conf
    return st
