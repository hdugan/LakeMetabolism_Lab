# Builds data/lakes_compare.json for Module 7 (Compare Lakes): one week of hourly
# oxygen, water temperature and light for three North Temperate Lakes LTER sites -
# Lake Mendota (eutrophic), Trout Bog (dystrophic/bog) and Trout Lake (oligotrophic).
# Run from the repo root after placing the source CSVs in data/:
#   data/ntl129_2_v15.csv       Mendota hourly buoy        (EDI knb-lter-ntl.129)
#   data/ntl117_2_v9_TR.csv     Trout Lake hourly buoy     (EDI knb-lter-ntl.117)
#   data/ntl69_hires_do_v2_TB.csv, ntl69_hires_lux_v2_TB.csv   Trout Bog high-res DO and lux (EDI knb-lter-ntl.69)
#   data/ntl1_v15_chem.csv      NTL-LTER chemistry (EDI knb-lter-ntl.1): total N and P, DOC
#
# Notes:
# - July 2019 is the one summer where all three lakes have oxygen and a light measure.
# - Trout Bog has no PAR sensor: its light logger (HOBO, lux) hangs 25 cm below the
#   surface in summer. Lux is converted to PAR with the standard sunlight factor of
#   0.0185 umol/m2/s per lux, so Trout Bog's "PAR" is light AT 25 cm, not at the surface.
# - Trout Bog has no hourly wind for 2019, so wind is left out for all three lakes.
# - Glitch values (negative oxygen, or >20 mg/L; saturation outside 0-300%; temperature outside 0-35 C) in the
#   Trout Lake record are dropped.
import csv, json, math, collections
from datetime import date, timedelta

START = date(2019, 7, 1)
NDAYS = 7
DAYS = [START + timedelta(days=i) for i in range(NDAYS)]
DATE_STRS = {d.isoformat() for d in DAYS}
# The whole of July 2019 is loaded so the 'typical July day' (mean diel oxygen cycle) can be computed;
# only the 7-day window above is written out hour by hour.
LOAD_DATES = {(date(2019, 7, 1) + timedelta(days=i)).isoformat() for i in range(31)}
TZ = -5
LUX_TO_PAR = 0.0185


def fnum(x):
    try:
        return float(x)
    except (ValueError, TypeError):
        return None


def hh(v):
    v = int(v)
    return v if v <= 23 else v // 100


def sun_times(d, lat, lon):
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
        delta = math.asin(math.sin(lamrad) * math.sin(math.radians(23.44)))
        latrad = math.radians(lat)
        cos_omega = (math.sin(math.radians(-0.833)) - math.sin(latrad) * math.sin(delta)) / (math.cos(latrad) * math.cos(delta))
        omega = math.degrees(math.acos(max(-1, min(1, cos_omega))))
        Jevent = Jtransit - omega / 360.0 if is_sunrise else Jtransit + omega / 360.0
        return (((Jevent + 0.5) % 1.0) * 24 + TZ) % 24
    return calc(True), calc(False)


def hhmm(h):
    hr, mn = int(h), int(round((h - int(h)) * 60))
    if mn == 60:
        hr, mn = hr + 1, 0
    return f'{hr:02d}:{mn:02d}'


def clean_sat(v):
    return v if v is not None and 0 <= v <= 300 else None


def clean_temp(v):
    return v if v is not None and 0 <= v <= 35 else None


def clean_do(v):
    return v if v is not None and 0 <= v <= 20 else None


# ---- Mendota ----
mendota = collections.defaultdict(dict)
with open('data/ntl129_2_v15.csv', newline='') as f:
    r = csv.reader(f)
    next(r)
    for row in r:
        if row[1] in LOAD_DATES:
            mendota[row[1]][hh(row[2])] = {
                'do_mgl': clean_do(fnum(row[23])), 'do_sat_pct': clean_sat(fnum(row[21])),
                'wtemp_c': fnum(row[19]), 'par': fnum(row[15]),
            }

# ---- Trout Lake ----
trout = collections.defaultdict(dict)
with open('data/ntl117_2_v9_TR.csv', newline='') as f:
    r = csv.reader(f)
    h = next(r)
    ix = {c: i for i, c in enumerate(h)}
    for row in r:
        if row[1] in LOAD_DATES:
            do = clean_do(fnum(row[ix['avg_do_raw']]))
            trout[row[1]][hh(row[2])] = {
                'do_mgl': do, 'do_sat_pct': clean_sat(fnum(row[ix['avg_do_sat']])) if do is not None else None,
                'wtemp_c': clean_temp(fnum(row[ix['avg_do_wtemp']])), 'par': fnum(row[ix['avg_par']]),
            }

# ---- Trout Bog (2-minute DO and 30-minute lux averaged to the hour) ----
bog_acc = collections.defaultdict(lambda: collections.defaultdict(lambda: collections.defaultdict(list)))
with open('data/ntl69_hires_do_v2_TB.csv', newline='') as f:
    r = csv.reader(f)
    next(r)
    for row in r:
        if row[0] in LOAD_DATES:
            hr = int(row[1][:2])
            for key, val in (('do_mgl', row[4]), ('do_sat_pct', row[3]), ('wtemp_c', row[5])):
                v = fnum(val)
                if v is not None:
                    bog_acc[row[0]][hr][key].append(v)
with open('data/ntl69_hires_lux_v2_TB.csv', newline='') as f:
    r = csv.reader(f)
    next(r)
    for row in r:
        if row[0] in LOAD_DATES and row[2] == '25':
            v = fnum(row[3])
            if v is not None:
                bog_acc[row[0]][int(row[1][:2])]['lux'].append(v)
bog = collections.defaultdict(dict)
for ds, hrs in bog_acc.items():
    for hr, acc in hrs.items():
        mean = lambda k: sum(acc[k]) / len(acc[k]) if acc.get(k) else None
        lux = mean('lux')
        bog[ds][hr] = {
            'do_mgl': clean_do(mean('do_mgl')), 'do_sat_pct': clean_sat(mean('do_sat_pct')), 'wtemp_c': mean('wtemp_c'),
            'par': lux * LUX_TO_PAR if lux is not None else None,
        }

# ---- chemistry: summer 2019 (Jun-Aug), surface samples (<= 2 m) ----
# Total nitrogen / phosphorus as ug/L. Mendota's 2019 values are in the WSLH columns, reported
# in mg/L (x1000); Trout Bog and Trout Lake use totnuf / totpuf, already in ug/L.
chem = collections.defaultdict(lambda: collections.defaultdict(list))
with open('data/ntl1_v15_chem.csv', newline='') as f:
    r = csv.reader(f)
    h = next(r)
    ix = {c: i for i, c in enumerate(h)}
    for row in r:
        lake = {'ME': 'mendota', 'TB': 'troutbog', 'TR': 'troutlake'}.get(row[0])
        dep = fnum(row[ix['depth']])
        if lake is None or row[1] != '2019' or row[3][5:7] not in ('06', '07', '08') or dep is None or dep > 2:
            continue
        if lake == 'mendota':
            tn, tp = fnum(row[ix['totnuf_WSLH']]), fnum(row[ix['totpuf_WSLH']])
            tn, tp = (tn * 1000 if tn is not None else None), (tp * 1000 if tp is not None else None)
        else:
            tn, tp = fnum(row[ix['totnuf']]), fnum(row[ix['totpuf']])
        for key, v in (('tn', tn), ('tp', tp), ('doc', fnum(row[ix['doc']]))):
            if v is not None and v >= 0:
                chem[lake][key].append(v)


def mean_of(vals):
    return sum(vals) / len(vals) if vals else None


# Drop a saturation value that disagrees with the oxygen and temperature recorded in the same
# hour (a sensor glitch in one of the three readings): saturation should equal
# oxygen / solubility(temperature) within a few percent.
def o2_solubility(t):
    return 14.652 - 0.41022 * t + 0.007991 * t * t - 0.000077774 * t * t * t


for lake_src in (mendota, bog, trout):
    for day in lake_src.values():
        for rec in day.values():
            do, t, sat = rec.get('do_mgl'), rec.get('wtemp_c'), rec.get('do_sat_pct')
            if None not in (do, t, sat) and abs(sat - 100 * do / o2_solubility(t)) > 25:
                rec['do_sat_pct'] = None

LAKES = [
    ('mendota', 'Lake Mendota', 'Eutrophic', 43.0989, -89.4045, mendota),
    ('troutbog', 'Trout Bog', 'Dystrophic (bog)', 46.0413, -89.6862, bog),
    ('troutlake', 'Trout Lake', 'Oligotrophic', 46.0293, -89.6665, trout),
]
out = {'period': {'start': DAYS[0].isoformat(), 'end': DAYS[-1].isoformat()}, 'timezone': 'America/Chicago (UTC-05:00, CDT)', 'lakes': {}}
r2 = lambda v, n=3: round(v, n) if v is not None else None
for key, name, kind, lat, lon, src in LAKES:
    days, hourly = [], []
    for d in DAYS:
        sr, ss = sun_times(d, lat, lon)
        days.append({'date': d.isoformat(), 'sunrise': hhmm(sr), 'sunset': hhmm(ss)})
        for hr in range(24):
            row = src.get(d.isoformat(), {}).get(hr, {})
            hourly.append({
                't': f'{d.isoformat()}T{hr:02d}:00:00-05:00',
                'do_mgl': r2(row.get('do_mgl')), 'do_sat_pct': r2(row.get('do_sat_pct'), 1),
                'wtemp_c': r2(row.get('wtemp_c'), 2), 'par': r2(row.get('par'), 1),
            })
    # A 'typical July day': each day's value minus that day's own mean (so day-to-day drift
    # doesn't blur the daily cycle), averaged by hour across July with the top and bottom 10%
    # trimmed (so a few sensor spikes don't dominate), added back onto the July mean level.
    # Done for oxygen in mg/L and for oxygen as % saturation.
    def trimmed_mean(v, p=0.1):
        v = sorted(v)
        k = int(len(v) * p)
        v = v[k:len(v) - k] if len(v) - 2 * k >= 3 else v
        return sum(v) / len(v)

    def typical_day(field):
        anoms, levels = collections.defaultdict(list), []
        for ds in sorted(LOAD_DATES):
            vals = {hr: v[field] for hr, v in src.get(ds, {}).items() if v.get(field) is not None}
            if len(vals) < 20:
                continue
            mu = sum(vals.values()) / len(vals)
            levels.append(mu)
            for hr, v in vals.items():
                anoms[hr].append(v - mu)
        level = sum(levels) / len(levels)
        return level, [r2(level + trimmed_mean(anoms[hr]), 2) for hr in range(24)], [len(anoms[hr]) for hr in range(24)]

    level, diel_mean, diel_n = typical_day('do_mgl')
    level_sat, diel_sat, _ = typical_day('do_sat_pct')
    # Daily lowest and highest % saturation for every July day with >= 20 hourly values
    # (the box plots on the Module 7 prediction chart).
    daily_low, daily_high, daily_dates = [], [], []
    for ds in sorted(LOAD_DATES):
        sat = [v['do_sat_pct'] for v in src.get(ds, {}).values() if v.get('do_sat_pct') is not None]
        if len(sat) >= 20:
            daily_dates.append(ds)
            daily_low.append(r2(min(sat), 1))
            daily_high.append(r2(max(sat), 1))
    # July 2019 mean light and water temperature (all hours), and summer chemistry.
    all_par = [v['par'] for ds in LOAD_DATES for v in src.get(ds, {}).values() if v.get('par') is not None]
    all_temp = [v['wtemp_c'] for ds in LOAD_DATES for v in src.get(ds, {}).values() if v.get('wtemp_c') is not None]
    drivers = {
        'tn_ugl': r2(mean_of(chem[key]['tn']), 0), 'tp_ugl': r2(mean_of(chem[key]['tp']), 1), 'doc_mgl': r2(mean_of(chem[key]['doc']), 1),
        'n_tn': len(chem[key]['tn']), 'n_tp': len(chem[key]['tp']),
        'par_mean': r2(mean_of(all_par), 0), 'temp_mean': r2(mean_of(all_temp), 1),
    }
    mid_sr, mid_ss = sun_times(date(2019, 7, 16), lat, lon)
    out['lakes'][key] = {'name': name, 'trophic': kind, 'location': {'lat': lat, 'lon': lon}, 'days': days, 'hourly': hourly, 'drivers': drivers,
                         'diel': {'mean_do_mgl': diel_mean, 'level_do_mgl': r2(level), 'mean_sat_pct': diel_sat, 'level_sat_pct': r2(level_sat, 1), 'n_days': diel_n, 'daily_dates': daily_dates, 'daily_low_sat_pct': daily_low, 'daily_high_sat_pct': daily_high, 'sunrise': hhmm(mid_sr), 'sunset': hhmm(mid_ss), 'period': 'July 2019, typical day (hourly mean of daily anomalies, 10% trimmed, on the July mean level)'}}
out['source'] = {
    'chemistry': 'EDI knb-lter-ntl.1 (NTL-LTER chemistry), June-August 2019, samples at <= 2 m; Mendota N and P from the WSLH columns (mg/L converted to ug/L)',
    'mendota': 'EDI knb-lter-ntl.129 (hourly buoy), July 2019',
    'troutlake': 'EDI knb-lter-ntl.117 (Trout Lake hourly buoy), July 2019; glitch oxygen values (<0 or >20 mg/L) removed',
    'troutbog': 'EDI knb-lter-ntl.69 (Trout Bog high-resolution DO, averaged to the hour); PAR modelled from the 25 cm HOBO lux logger at 0.0185 umol/m2/s per lux',
}
with open('data/lakes_compare.json', 'w') as f:
    json.dump(out, f, indent=1)
for key in out['lakes']:
    hrs = out['lakes'][key]['hourly']
    print(key, {k: sum(1 for h in hrs if h[k] is not None) for k in ('do_mgl', 'do_sat_pct', 'wtemp_c', 'par')}, 'of', len(hrs))
