# Regenerates data/mendota_week.json from the NTL-LTER Lake Mendota buoy CSVs.
# Fetch the two source files into this directory first:
#   curl -o meteo_hourly.csv "https://pasta.lternet.edu/package/data/eml/knb-lter-ntl/129/41/72494d432fe1e977f5326100a733cece"
#   curl -o wtemp_hourly.csv "https://pasta.lternet.edu/package/data/eml/knb-lter-ntl/130/36/4f25fc29e69efbe93bbee36bb22692d8"
# (revision numbers 41 / 36 are the latest as of 2026-07; check
# https://pasta.lternet.edu/package/eml/knb-lter-ntl/129 for newer ones.)
import csv, json, math
from datetime import date, timedelta

LAT = 43.0989
LON = -89.4045
TZ_OFFSET_HOURS = -5  # Central Daylight Time (America/Chicago, July)

START = date(2023, 7, 9)
NDAYS = 7
DAYS = [START + timedelta(days=i) for i in range(NDAYS)]
DATE_STRS = set(d.isoformat() for d in DAYS)


def sun_times(d: date, lat: float, lon: float, tz_offset: float):
    """NOAA Solar Calculator algorithm. Returns (sunrise_decimal_hour, sunset_decimal_hour) local time."""
    def calc(is_sunrise: bool):
        jd_midnight = d.toordinal() + 1721424.5
        Jdate = jd_midnight + 0.5  # JDN (noon-referenced, integer) for this calendar date
        n = Jdate - 2451545.0 + 0.0008
        Jstar = n - lon / 360.0
        M = (357.5291 + 0.98560028 * Jstar) % 360
        Mrad = math.radians(M)
        C = 1.9148 * math.sin(Mrad) + 0.0200 * math.sin(2 * Mrad) + 0.0003 * math.sin(3 * Mrad)
        lam = (M + C + 180 + 102.9372) % 360
        lamrad = math.radians(lam)
        Jtransit = 2451545.0 + Jstar + 0.0053 * math.sin(Mrad) - 0.0069 * math.sin(2 * lamrad)
        sin_delta = math.sin(lamrad) * math.sin(math.radians(23.44))
        delta = math.asin(sin_delta)
        latrad = math.radians(lat)
        elevation = math.radians(-0.833)
        cos_omega = (math.sin(elevation) - math.sin(latrad) * math.sin(delta)) / (math.cos(latrad) * math.cos(delta))
        cos_omega = max(-1, min(1, cos_omega))
        omega = math.degrees(math.acos(cos_omega))
        if is_sunrise:
            Jevent = Jtransit - omega / 360.0
        else:
            Jevent = Jtransit + omega / 360.0
        # convert julian day (UTC) to local decimal hour
        frac = (Jevent + 0.5) % 1.0
        utc_hour = frac * 24
        local_hour = (utc_hour + tz_offset) % 24
        return local_hour
    return calc(True), calc(False)


def hour_to_hhmm(hour_int):
    return f"{hour_int:02d}:{0:02d}" if hour_int < 24 else "00:00"


def decimal_hour_to_hhmm(h):
    hh = int(h)
    mm = int(round((h - hh) * 60))
    if mm == 60:
        mm = 0
        hh += 1
    return f"{hh:02d}:{mm:02d}"


# ---- load meteo hourly ----
meteo = {}
with open('meteo_hourly.csv', newline='') as f:
    r = csv.reader(f)
    header = next(r)
    for row in r:
        if len(row) < 24:
            continue
        d = row[1].strip('"')
        if d not in DATE_STRS:
            continue
        try:
            hour_val = int(row[2])
        except ValueError:
            continue
        hh = hour_val // 100
        meteo.setdefault(d, {})[hh] = {
            'air_temp_c': row[3],
            'wind_ms': row[7],
            'chlor_rfu': row[11],
            'par': row[15],
            'do_sat_pct': row[21],
            'do_mgl': row[23],
        }

# ---- load water temp hourly, surface only ----
wtemp = {}
with open('wtemp_hourly.csv', newline='') as f:
    r = csv.reader(f)
    header = next(r)
    for row in r:
        if len(row) < 6:
            continue
        d = row[1].strip('"')
        if d not in DATE_STRS:
            continue
        try:
            depthf = float(row[3])
        except ValueError:
            continue
        if abs(depthf) > 1e-9:
            continue
        try:
            hour_val = int(row[2])
        except ValueError:
            continue
        hh = hour_val // 100
        if row[4] != '':
            wtemp.setdefault(d, {})[hh] = row[4]


def fnum(s):
    if s is None or s == '':
        return None
    try:
        return round(float(s), 3)
    except ValueError:
        return None


hourly = []
for d in DAYS:
    ds = d.isoformat()
    for hh in range(24):
        m = meteo.get(ds, {}).get(hh, {})
        wt = wtemp.get(ds, {}).get(hh)
        ts = f"{ds}T{hh:02d}:00:00-05:00"
        hourly.append({
            't': ts,
            'do_mgl': fnum(m.get('do_mgl')),
            'do_sat_pct': fnum(m.get('do_sat_pct')),
            'wtemp_c': fnum(wt),
            'par': fnum(m.get('par')),
            'wind_ms': fnum(m.get('wind_ms')),
            'chlor_rfu': fnum(m.get('chlor_rfu')),
            'air_temp_c': fnum(m.get('air_temp_c')),
        })

days_meta = []
for d in DAYS:
    sr, ss = sun_times(d, LAT, LON, TZ_OFFSET_HOURS)
    days_meta.append({
        'date': d.isoformat(),
        'sunrise': decimal_hour_to_hhmm(sr),
        'sunset': decimal_hour_to_hhmm(ss),
    })

out = {
    'lake': 'Lake Mendota',
    'site': 'NTL-LTER buoy, Lake Mendota, Wisconsin',
    'location': {'lat': LAT, 'lon': LON},
    'timezone': 'America/Chicago (UTC-05:00, CDT)',
    'week': {'start': DAYS[0].isoformat(), 'end': DAYS[-1].isoformat()},
    'days': days_meta,
    'hourly': hourly,
    'source': {
        'oxygen_chlorophyll': 'EDI knb-lter-ntl.129 (Hourly Meteorological and Metabolism Data, Lake Mendota)',
        'water_temperature': 'EDI knb-lter-ntl.130 (Hourly Water Temperature, Lake Mendota)',
    },
}

print(json.dumps(days_meta, indent=2))
missing = [h['t'] for h in hourly if h['do_mgl'] is None or h['wtemp_c'] is None or h['wind_ms'] is None or h['par'] is None]
print('missing rows:', missing)

with open('mendota_week.json', 'w') as f:
    json.dump(out, f, indent=2)
print('wrote', len(hourly), 'hourly records')
