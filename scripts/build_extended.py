# Builds data/mendota_extended.json for Module 5 ("The Sensor Revolution"):
# a longer June 1 - July 31, 2023 window (61 days, ~8.7 weeks) at hourly,
# daily, and 5-minute resolution, plus four named real-weather-event windows
# at 5-minute, multi-variable resolution.
#
# Source files (fetch once into this directory; see scripts/build_dataset.py
# for the equivalent hourly-product commands):
#   curl -o meteo_hourly.csv "https://pasta.lternet.edu/package/data/eml/knb-lter-ntl/129/41/72494d432fe1e977f5326100a733cece"
#   curl -o wtemp_hourly.csv "https://pasta.lternet.edu/package/data/eml/knb-lter-ntl/130/36/4f25fc29e69efbe93bbee36bb22692d8"
#   curl -o meteo_1min_full.csv "https://pasta.lternet.edu/package/data/eml/knb-lter-ntl/129/41/af29c64a7de5ad797b5709b5f7718cb9"
#   grep -E '^2023,"2023-0[67]-' meteo_1min_full.csv > extended_1min.csv
#   curl -o precip_extended.json "https://archive-api.open-meteo.com/v1/archive?latitude=43.0989&longitude=-89.4045&start_date=2023-06-01&end_date=2023-07-31&hourly=precipitation&timezone=America%2FChicago"
#
# (revision numbers 41 / 36 are the latest as of 2026-07; the 1-minute file
# is ~640 MB - only extended_1min.csv, the grep'd-down slice, is needed here.)
import csv, json, math
from datetime import date, datetime, timedelta

LAT = 43.0989
LON = -89.4045
TZ_OFFSET_HOURS = -5

START = date(2023, 6, 1)
END = date(2023, 7, 31)
NDAYS = (END - START).days + 1
DAYS = [START + timedelta(days=i) for i in range(NDAYS)]
DATE_STRS = set(d.isoformat() for d in DAYS)
print('n days:', NDAYS)


def sun_times(d, lat, lon, tz_offset):
    def calc(is_sunrise):
        jd_midnight = d.toordinal() + 1721424.5
        Jdate = jd_midnight + 0.5
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
        Jevent = Jtransit - omega / 360.0 if is_sunrise else Jtransit + omega / 360.0
        frac = (Jevent + 0.5) % 1.0
        utc_hour = frac * 24
        return (utc_hour + tz_offset) % 24
    return calc(True), calc(False)


def decimal_hour_to_hhmm(h):
    hh = int(h)
    mm = int(round((h - hh) * 60))
    if mm == 60:
        mm = 0
        hh += 1
    return f"{hh:02d}:{mm:02d}"


def fnum(s):
    if s is None or s == '':
        return None
    try:
        return round(float(s), 3)
    except ValueError:
        return None


# ---- hourly meteo ----
meteo = {}
with open('meteo_hourly.csv', newline='') as f:
    r = csv.reader(f)
    next(r)
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
            'air_temp_c': row[3], 'wind_ms': row[7], 'chlor_rfu': row[11],
            'par': row[15], 'do_sat_pct': row[21], 'do_mgl': row[23], 'turbidity': row[31],
        }

# ---- hourly water temp, surface ----
wtemp = {}
with open('wtemp_hourly.csv', newline='') as f:
    r = csv.reader(f)
    next(r)
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

# ---- precipitation (Open-Meteo, already fetched) ----
precip = {}
pdata = json.load(open('precip_extended.json'))
for t, p in zip(pdata['hourly']['time'], pdata['hourly']['precipitation']):
    d, hhmm = t.split('T')
    hh = int(hhmm.split(':')[0])
    precip.setdefault(d, {})[hh] = p

hourly = []
for d in DAYS:
    ds = d.isoformat()
    for hh in range(24):
        m = meteo.get(ds, {}).get(hh, {})
        wt = wtemp.get(ds, {}).get(hh)
        pr = precip.get(ds, {}).get(hh)
        ts = f"{ds}T{hh:02d}:00:00"
        hourly.append({
            't': ts,
            'do_mgl': fnum(m.get('do_mgl')),
            'wtemp_c': fnum(wt),
            'par': fnum(m.get('par')),
            'wind_ms': fnum(m.get('wind_ms')),
            'chlor_rfu': fnum(m.get('chlor_rfu')),
            'turbidity': fnum(m.get('turbidity')),
            'air_temp_c': fnum(m.get('air_temp_c')),
            'precip_mm': fnum(pr),
        })

missing = sum(1 for h in hourly if h['do_mgl'] is None)
print('hourly points:', len(hourly), 'missing do_mgl:', missing)
missing_t = sum(1 for h in hourly if h['wtemp_c'] is None)
print('missing wtemp_c:', missing_t)

days_meta = []
for d in DAYS:
    sr, ss = sun_times(d, LAT, LON, TZ_OFFSET_HOURS)
    days_meta.append({'date': d.isoformat(), 'sunrise': decimal_hour_to_hhmm(sr), 'sunset': decimal_hour_to_hhmm(ss)})

# ---- daily means (for weekly/daily sampling views) ----
daily = []
for i, d in enumerate(DAYS):
    seg = hourly[i * 24:(i + 1) * 24]
    def dmean(key):
        vals = [h[key] for h in seg if h[key] is not None]
        return round(sum(vals) / len(vals), 3) if vals else None
    daily.append({
        'date': d.isoformat(),
        'do_mgl': dmean('do_mgl'), 'wtemp_c': dmean('wtemp_c'), 'par': dmean('par'),
        'wind_ms': dmean('wind_ms'), 'chlor_rfu': dmean('chlor_rfu'), 'precip_mm': dmean('precip_mm'),
    })

# ---- 5-minute DO series from the native ~1-minute log, whole period ----
rows_1min = []
with open('extended_1min.csv', newline='') as f:
    r = csv.reader(f)
    for row in r:
        ds = row[1].strip('"')
        ts = row[2].strip('"')
        try:
            do_val = float(row[15])
        except ValueError:
            do_val = None
        rows_1min.append((datetime.strptime(f"{ds} {ts}", "%Y-%m-%d %H:%M:%S"), do_val, row))
rows_1min.sort(key=lambda x: x[0])
print('1-min rows:', len(rows_1min))


def bucket_avg(rows, minutes_per_bucket, field_idx_map):
    """field_idx_map: {out_key: column_index_in_row}"""
    start = rows[0][0]
    buckets = {}
    for dt, _do, row in rows:
        idx = int((dt - start).total_seconds() // 60) // minutes_per_bucket
        buckets.setdefault(idx, {k: [] for k in field_idx_map})
        for k, col in field_idx_map.items():
            try:
                v = float(row[col])
            except (ValueError, IndexError):
                continue
            buckets[idx][k].append(v)
    out = []
    for idx in sorted(buckets):
        bdt = start + timedelta(minutes=idx * minutes_per_bucket)
        rec = {'t': bdt.strftime('%Y-%m-%dT%H:%M:%S')}
        ok = True
        for k, vals in buckets[idx].items():
            if vals:
                rec[k] = round(sum(vals) / len(vals), 3)
            else:
                ok = False
        if ok:
            out.append(rec)
    return out


five_min_do = bucket_avg(rows_1min, 5, {'do_mgl': 15})
print('five_min_do points:', len(five_min_do))

# ---- event windows: fine (5-min) multi-variable slices ----
def slice_1min(start_dt, end_dt):
    return [(dt, row) for dt, _do, row in rows_1min if start_dt <= dt < end_dt]


def event_5min(start_str, end_str):
    start_dt = datetime.strptime(start_str, '%Y-%m-%dT%H:%M:%S')
    end_dt = datetime.strptime(end_str, '%Y-%m-%dT%H:%M:%S')
    sliced = [(dt, row) for dt, _do, row in rows_1min if start_dt <= dt < end_dt]
    return bucket_avg(
        [(dt, None, row) for dt, row in sliced], 5,
        {'do_mgl': 15, 'wind_ms': 7, 'par': 23, 'wtemp_c': 19, 'turbidity': 31},
    )


events = {
    'storm': {
        'label': 'Storm (July 12, 2023)',
        'window': event_5min('2023-07-11T00:00:00', '2023-07-13T12:00:00'),
    },
    'windmix': {
        'label': 'Wind mixing (July 28, 2023)',
        'window': event_5min('2023-07-27T12:00:00', '2023-07-29T12:00:00'),
    },
    'cloud': {
        'label': 'Cloud cover (June 11, 2023)',
        'window': event_5min('2023-06-10T00:00:00', '2023-06-12T12:00:00'),
    },
}
for k, v in events.items():
    print(k, len(v['window']), 'points')

# ---- algal bloom: slower, hourly is enough ----
bloom_start = date(2023, 7, 2)
bloom_end = date(2023, 7, 12)
bloom_series = [h for h in hourly if bloom_start.isoformat() <= h['t'][:10] <= bloom_end.isoformat()]
events['bloom'] = {'label': 'Algal bloom build-up (July 2 - July 12, 2023)', 'window': bloom_series}
print('bloom', len(bloom_series), 'points')

out = {
    'lake': 'Lake Mendota',
    'site': 'NTL-LTER buoy, Lake Mendota, Wisconsin',
    'location': {'lat': LAT, 'lon': LON},
    'timezone': 'America/Chicago (UTC-05:00, CDT)',
    'period': {'start': DAYS[0].isoformat(), 'end': DAYS[-1].isoformat()},
    'days': days_meta,
    'hourly': hourly,
    'daily': daily,
    'five_min_do': five_min_do,
    'events': events,
    'source': {
        'oxygen_chlorophyll_wind_par': 'EDI knb-lter-ntl.129 (Hourly + High-Resolution Meteorological and Metabolism Data, Lake Mendota)',
        'water_temperature': 'EDI knb-lter-ntl.130 (Hourly Water Temperature, Lake Mendota)',
        'precipitation': 'Open-Meteo historical archive (ERA5-based reanalysis) for 43.0989, -89.4045',
    },
}
with open('mendota_extended.json', 'w') as f:
    json.dump(out, f, indent=2)
print('wrote mendota_extended.json')
import os
print('file size MB:', round(os.path.getsize('mendota_extended.json') / 1e6, 2))
