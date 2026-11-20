#!/usr/bin/env python3
"""Ship Radar relay for Home Assistant.

Holds one websocket to AISStream.io, keeps a table of nearby vessels and
publishes it as a Home Assistant sensor (attributes) every few seconds.
Also serves the same data at http://<host>:8099/ships.json for debugging.
"""
import asyncio
import json
import logging
import math
import os
import time
from datetime import datetime, timezone

import aiohttp
from aiohttp import WSMsgType, web

log = logging.getLogger("ship_radar")

STREAM_URL = "wss://stream.aisstream.io/v0/stream"
SUPERVISOR = os.environ.get("SUPERVISOR_URL", "http://supervisor")
OPTIONS_FILE = os.environ.get("OPTIONS_FILE", "/data/options.json")

POSITION_TYPES = ["PositionReport", "StandardClassBPositionReport", "ExtendedClassBPositionReport"]
MESSAGE_TYPES = POSITION_TYPES + ["ShipStaticData", "StaticDataReport"]
MAX_SHIPS = 60          # keeps the sensor attributes under HA's 16 KB recorder limit
PUSH_SECONDS = 5
EARTH_NM = 3440.065

# MMSI "maritime identification digits" -> ISO country code (common ones only)
_FLAGS = {
    "PA": [351, 352, 353, 354, 355, 356, 357, 370, 371, 372, 373, 374], "LR": [636, 637],
    "MH": [538], "HK": [477], "SG": [563, 564, 565, 566], "MT": [215, 229, 248, 249, 256],
    "BS": [308, 309, 311], "CN": [412, 413, 414], "GR": [237, 239, 240, 241], "ZA": [601],
    "GB": [232, 233, 234, 235], "US": [303, 338, 366, 367, 368, 369], "NO": [257, 258, 259],
    "DK": [219, 220], "DE": [211, 218], "NL": [244, 245, 246], "CY": [209, 210, 212],
    "JP": [431, 432], "KR": [440, 441], "IN": [419], "IT": [247], "FR": [226, 227, 228],
    "ES": [224, 225], "TR": [271], "RU": [273], "MU": [645], "NA": [659], "MZ": [650],
    "AO": [603], "TZ": [677], "AG": [304, 305], "VC": [375, 376, 377], "KM": [616],
    "TG": [671], "SL": [667], "CM": [613], "GA": [626], "BE": [205], "PT": [204, 263],
    "IE": [250], "SE": [265, 266], "FI": [230], "IS": [251], "PL": [261], "EE": [276],
    "LV": [275], "LT": [277], "HR": [238], "BM": [310], "KY": [319], "BB": [314],
    "TW": [416], "ID": [525], "MY": [533], "TH": [567], "VN": [574], "PH": [548],
    "AE": [470, 471], "SA": [403], "IR": [422], "EG": [622], "BR": [710], "AR": [701],
    "CL": [725], "AU": [503], "NZ": [512], "CA": [316], "MX": [345], "KE": [634],
    "MG": [647], "GH": [627], "NG": [657], "SC": [664], "LK": [417], "PK": [463],
    "OM": [461], "QA": [466], "KW": [447], "IL": [428], "RO": [264], "BG": [207],
    "UA": [272], "GE": [213], "LU": [253], "SI": [278], "AL": [201], "ME": [262],
}
MID_TO_FLAG = {mid: iso for iso, mids in _FLAGS.items() for mid in mids}


def flag_for(mmsi):
    s = str(mmsi)
    if len(s) != 9 or s[0] not in "234567":
        return None
    return MID_TO_FLAG.get(int(s[:3]))


def categorise(t):
    """AIS ship-type code -> a coarse category the card has a silhouette for."""
    if not t:
        return "unknown"
    if t == 36:
        return "sailing"
    if t == 37:
        return "pleasure"
    if t == 30:
        return "fishing"
    if t in (31, 32, 52, 53):
        return "tug"
    if t in (35, 55):
        return "naval"
    if 60 <= t <= 69:
        return "passenger"
    if 70 <= t <= 79:
        return "cargo"
    if 80 <= t <= 89:
        return "tanker"
    if t in (33, 34, 50, 51, 54, 58, 59):
        return "service"
    return "other"


def distance_bearing(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    dist = 2 * EARTH_NM * math.asin(math.sqrt(a))
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return dist, (math.degrees(math.atan2(y, x)) + 360) % 360


def bounding_box(lat, lon, radius_nm):
    d_lat = radius_nm / 60.0
    d_lon = radius_nm / (60.0 * max(0.05, math.cos(math.radians(lat))))
    return [[max(-90, lat - d_lat), max(-180, lon - d_lon)],
            [min(90, lat + d_lat), min(180, lon + d_lon)]]


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _clean(text):
    return (text or "").replace("@", " ").strip()


class Fleet:
    def __init__(self, lat, lon, radius_nm, expire_s):
        self.lat, self.lon, self.radius_nm, self.expire_s = lat, lon, radius_nm, expire_s
        self.ships = {}

    def _static(self, ship, ship_type, dim, dest):
        if _num(ship_type) and ship_type > 0:
            ship["type"] = int(ship_type)
        if isinstance(dim, dict):
            a, b, c, d = (dim.get(k) or 0 for k in "ABCD")
            if a + b > 0:
                ship["len"] = int(a + b)
            if c + d > 0:
                ship["beam"] = int(c + d)
        if dest is not None:
            dest = _clean(dest)
            if dest:
                ship["dest"] = dest[:24]

    def update(self, msg, now=None):
        now = now or time.time()
        kind = msg.get("MessageType")
        if kind not in MESSAGE_TYPES:
            return
        meta = msg.get("MetaData") or {}
        body = (msg.get("Message") or {}).get(kind) or {}
        try:
            mmsi = int(meta.get("MMSI") or body.get("UserID") or 0)
        except (TypeError, ValueError):
            return
        if not mmsi:
            return
        ship = self.ships.setdefault(mmsi, {"first": now})
        ship["seen"] = now
        name = _clean(meta.get("ShipName"))
        if name:
            ship["name"] = name[:24]

        if kind in POSITION_TYPES:
            lat = body.get("Latitude", meta.get("latitude"))
            lon = body.get("Longitude", meta.get("longitude"))
            if _num(lat) and _num(lon) and abs(lat) <= 90 and abs(lon) <= 180:
                ship.update(lat=lat, lon=lon, pos_t=now)
            sog, cog, hdg = body.get("Sog"), body.get("Cog"), body.get("TrueHeading")
            ship["sog"] = sog if _num(sog) and sog < 102.3 else None
            ship["cog"] = cog if _num(cog) and cog < 360 else None
            ship["hdg"] = hdg if _num(hdg) and hdg < 360 else None
            st = body.get("NavigationalStatus")
            if _num(st):
                ship["status"] = int(st) if st != 15 else None
            if kind == "ExtendedClassBPositionReport":
                self._static(ship, body.get("Type"), body.get("Dimension"), None)
                n = _clean(body.get("Name"))
                if n:
                    ship["name"] = n[:24]
        elif kind == "ShipStaticData":
            self._static(ship, body.get("Type"), body.get("Dimension"), body.get("Destination"))
            n = _clean(body.get("Name"))
            if n:
                ship["name"] = n[:24]
        elif kind == "StaticDataReport":
            n = _clean((body.get("ReportA") or {}).get("Name"))
            if n:
                ship["name"] = n[:24]
            rb = body.get("ReportB") or {}
            self._static(ship, rb.get("ShipType"), rb.get("Dimension"), None)

    def snapshot(self, now=None):
        now = now or time.time()
        out = []
        for mmsi, s in list(self.ships.items()):
            if now - s.get("pos_t", s["seen"]) > self.expire_s:
                del self.ships[mmsi]
                continue
            if "lat" not in s:
                continue
            dist, brg = distance_bearing(self.lat, self.lon, s["lat"], s["lon"])
            if dist > self.radius_nm:
                continue
            out.append({
                "mmsi": mmsi, "name": s.get("name") or f"MMSI {mmsi}",
                "dist": round(dist, 2), "brg": round(brg),
                "sog": None if s.get("sog") is None else round(s["sog"], 1),
                "cog": None if s.get("cog") is None else round(s["cog"]),
                "hdg": None if s.get("hdg") is None else round(s["hdg"]),
                "status": s.get("status"), "cat": categorise(s.get("type")),
                "type": s.get("type"), "len": s.get("len"), "beam": s.get("beam"),
                "dest": s.get("dest"), "flag": flag_for(mmsi),
                "age": int(now - s.get("pos_t", s["seen"])),
            })
        out.sort(key=lambda x: x["dist"])
        return out[:MAX_SHIPS], len(out)


async def resolve_home(session, opts):
    lat, lon = opts.get("latitude"), opts.get("longitude")
    if _num(lat) and _num(lon) and (lat or lon):
        return float(lat), float(lon)
    token = os.environ.get("SUPERVISOR_TOKEN")
    if not token:
        return None
    try:
        async with session.get(f"{SUPERVISOR}/core/api/config",
                               headers={"Authorization": f"Bearer {token}"}) as r:
            cfg = await r.json()
            return float(cfg["latitude"]), float(cfg["longitude"])
    except Exception as exc:  # noqa: BLE001
        log.error("Could not read home location from Home Assistant: %s", exc)
        return None


async def stream_loop(session, fleet, opts, status):
    sub = {
        "APIKey": opts["api_key"],
        "BoundingBoxes": [bounding_box(fleet.lat, fleet.lon, fleet.radius_nm)],
        "FilterMessageTypes": MESSAGE_TYPES,
    }
    backoff = 1
    while True:
        try:
            async with session.ws_connect(STREAM_URL, heartbeat=30) as ws:
                await ws.send_json(sub)  # must arrive within 3 s of connecting
                log.info("Connected to AISStream, box %s", sub["BoundingBoxes"][0])
                async for m in ws:
                    if m.type in (WSMsgType.TEXT, WSMsgType.BINARY):
                        data = json.loads(m.data)
                        if "error" in data:
                            status.update(connected=False, error=str(data["error"]))
                            log.error("AISStream error: %s", data["error"])
                            break
                        if not status["connected"]:
                            status.update(connected=True, error=None)
                        backoff = 1
                        fleet.update(data)
                    elif m.type in (WSMsgType.CLOSED, WSMsgType.ERROR):
                        break
        except Exception as exc:  # noqa: BLE001
            log.warning("AISStream connection problem: %s", exc)
        status["connected"] = False
        await asyncio.sleep(backoff)
        backoff = min(backoff * 2, 60)


def build_payload(fleet, status, opts):
    ships, total = fleet.snapshot()
    return {
        "state": total,
        "attributes": {
            "friendly_name": "Ship radar", "icon": "mdi:ferry", "unit_of_measurement": "ships",
            "ships": ships, "radius_nm": fleet.radius_nm,
            "home": {"lat": fleet.lat, "lon": fleet.lon},
            "connected": status["connected"], "error": status["error"],
            "expire_minutes": opts.get("expire_minutes", 20),
            "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        },
    }


async def push_loop(session, fleet, status, opts):
    token = os.environ.get("SUPERVISOR_TOKEN")
    url = f"{SUPERVISOR}/core/api/states/{opts['entity_id']}"
    failed = False
    while True:
        try:
            async with session.post(url, json=build_payload(fleet, status, opts),
                                    headers={"Authorization": f"Bearer {token}"}) as r:
                if r.status >= 300:
                    raise RuntimeError(f"HTTP {r.status}")
            failed = False
        except Exception as exc:  # noqa: BLE001
            if not failed:
                log.error("Could not update %s: %s", opts["entity_id"], exc)
            failed = True
        await asyncio.sleep(PUSH_SECONDS)


async def main():
    with open(OPTIONS_FILE) as f:
        opts = json.load(f)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    opts.setdefault("entity_id", "sensor.ship_radar")
    status = {"connected": False, "error": None}

    async with aiohttp.ClientSession() as session:
        home = await resolve_home(session, opts)
        fleet = Fleet(*(home or (0.0, 0.0)), float(opts.get("radius_nm", 30)),
                      int(opts.get("expire_minutes", 20)) * 60)
        tasks = [push_loop(session, fleet, status, opts)]
        if not opts.get("api_key"):
            status["error"] = "no_api_key"
            log.error("No API key set. Get a free one at https://aisstream.io and add it in the app options.")
        elif home is None:
            status["error"] = "no_location"
            log.error("No location. Set latitude/longitude in the options or set your Home Assistant home location.")
        else:
            log.info("Watching %.1f nm around %.4f, %.4f", fleet.radius_nm, fleet.lat, fleet.lon)
            tasks.append(stream_loop(session, fleet, opts, status))

        async def ships_json(_):
            return web.json_response(build_payload(fleet, status, opts),
                                     headers={"Access-Control-Allow-Origin": "*"})

        app = web.Application()
        app.add_routes([web.get("/ships.json", ships_json)])
        runner = web.AppRunner(app)
        await runner.setup()
        await web.TCPSite(runner, "0.0.0.0", 8099).start()
        await asyncio.gather(*tasks)


if __name__ == "__main__":
    asyncio.run(main())
