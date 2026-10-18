# Adds multi-year-average bookkeeping metabolism to data/mendota_seasonal.json:
# gpp_avg / er_avg / nep_avg (and chlor_avg / phyco_avg), each the mean across
# 2021-2025 of that year's 7-day-median-smoothed daily value for the same
# calendar day (Mar 13 - Nov 25). Same method as scripts/build_seasonal.py
# (LakeMetabolizer's metab.bookkeep), run once per year on
# data/ntl129_2_v15.csv, but with a measured mixed-layer depth (z_mix) from the
# buoy's thermistor chain (data/ntl130_2_v14.csv, EDI knb-lter-ntl.130) in
# place of a fixed 2 m. The old fixed-2 m averages are kept as *_avg_z2. Years used match add_par_below.py (the clean-sensor
# years). Run from the repo root:  python3 scripts/add_multiyear_metabolism.py
import csv, json, math, sys
from datetime import date, timedelta

sys.path.insert(0, 'scripts')

CSV = 'data/ntl129_2_v15.csv'
JSON_PATH = 'data/mendota_seasonal.json'
YEARS = (2021, 2022, 2023, 2024, 2025)
LAT, LON, TZ_OFFSET = 43.0989, -89.4045, -5
Z_FIXED_M = 2.0           # the original assumption, kept for comparison
Z_MIN_M, Z_FULL_M = 1.0, 12.8   # DO sensor depth ~ shallowest plausible layer; Mendota mean depth = full mix
DENSITY_THRESHOLD = 0.1   # kg/m3 below surface density that marks the bottom of the mixed layer
CSV_T = 'data/ntl130_2_v14.csv'


def do_sat(t):
    return 14.652 - 0.41022 * t + 0.007991 * t * t - 0.000077774 * t * t * t


def sun_times(d):
    def calc(is_sunrise):
        jd_midnight = d.toordinal() + 1721424.5
        Jdate = jd_midnight + 0.5
        n = Jdate - 2451545.0 + 0.0008
        Jstar = n - LON / 360.0
        M = (357.5291 + 0.98560028 * Jstar) % 360
        Mrad = math.radians(M)
        C = 1.9148 * math.sin(Mrad) + 0.0200 * math.sin(2 * Mrad) + 0.0003 * math.sin(3 * Mrad)
        lam = (M + C + 180 + 102.9372) % 360
        lamrad = math.radians(lam)
        Jtransit = 2451545.0 + Jstar + 0.0053 * math.sin(Mrad) - 0.0069 * math.sin(2 * lamrad)
        delta = math.asin(math.sin(lamrad) * math.sin(math.radians(23.44)))
        latrad = math.radians(LAT)
        cos_omega = (math.sin(math.radians(-0.833)) - math.sin(latrad) * math.sin(delta)) / (math.cos(latrad) * math.cos(delta))
        omega = math.degrees(math.acos(max(-1, min(1, cos_omega))))
        Jevent = Jtransit - omega / 360.0 if is_sunrise else Jtransit + omega / 360.0
        return (((Jevent + 0.5) % 1.0) * 24 + TZ_OFFSET) % 24
    return calc(True), calc(False)


def schmidt_o2(t):
    return 1568 - 86.04 * t + 2.142 * t ** 2 - 0.0216 * t ** 3


def k_gas_o2_m_per_day(wind_ms, temp_c):
    k600_m_day = (2.07 + 0.215 * (wind_ms ** 1.7)) * 24 / 100
    return k600_m_day * ((schmidt_o2(temp_c) / 600) ** -0.5)


def fnum(s):
    try:
        return float(s)
    except (ValueError, TypeError):
        return None


# ---- hourly data for all years (same column positions as build_seasonal.py) ----
hourly = {}
with open(CSV, newline='') as f:
    r = csv.reader(f)
    next(r)
    for row in r:
        ds = row[1].strip('"')
        if int(ds[:4]) not in YEARS and ds != f'{max(YEARS) + 1}-01-01':
            continue
        try:
            hour_val = int(row[2])
        except ValueError:
            continue
        # The hour column mixes "HHMM" and plain-hour formats; see build_seasonal.py.
        hh = hour_val if hour_val <= 23 else hour_val // 100
        hourly[(ds, hh)] = {
            'do_mgl': fnum(row[23]), 'wtemp_c': fnum(row[19]), 'wind_ms': fnum(row[7]),
            'chlor_rfu': fnum(row[11]), 'phyco_rfu': fnum(row[13]),
        }


def get(d, hour, key):
    row = hourly.get((d.isoformat(), hour))
    return row[key] if row else None


def water_density(t):
    # Martin & McCutcheon (1999), kg/m3
    return 1000 * (1 - (t + 288.9414) / (508929.2 * (t + 68.12963)) * (t - 3.9863) ** 2)


def mixed_layer_depth(profile):
    """profile: {depth_m: temp_C}. Depth where density first exceeds the
    near-surface density by DENSITY_THRESHOLD (linearly interpolated); the whole
    water column (Z_FULL_M) if it never does."""
    deps = sorted(profile)
    if len(deps) < 5 or deps[0] > 1:
        return None
    rho0 = water_density(profile[deps[0]])
    prev_d, prev_diff = deps[0], 0.0
    for dep in deps[1:]:
        diff = water_density(profile[dep]) - rho0
        if diff >= DENSITY_THRESHOLD:
            frac = (DENSITY_THRESHOLD - prev_diff) / (diff - prev_diff) if diff != prev_diff else 0
            z = prev_d + frac * (dep - prev_d)
            return max(Z_MIN_M, min(Z_FULL_M, z))
        prev_d, prev_diff = dep, diff
    return Z_FULL_M


# ---- daily mean z_mix per year from the thermistor chain ----
profiles = {}   # (date_str, hour) -> {depth: [temps]}
with open(CSV_T, newline='') as f:
    r = csv.reader(f)
    next(r)
    for row in r:
        if not row[0].isdigit() or int(row[0]) not in YEARS:
            continue
        t = fnum(row[4])
        if t is None:
            continue
        try:
            hh = int(row[2])
        except ValueError:
            continue
        hh = hh if hh <= 23 else hh // 100
        profiles.setdefault((row[1].strip('"'), hh), {}).setdefault(float(row[3]), []).append(t)

zmix_daily = {}  # year -> {date_str: mean z_mix over the day's hours}
hourly_z = {}
for (ds, hh), prof in profiles.items():
    z = mixed_layer_depth({dep: sum(v) / len(v) for dep, v in prof.items()})
    if z is not None:
        hourly_z.setdefault(ds, []).append(z)
for ds, zs in hourly_z.items():
    if len(zs) >= 12:   # need most of a day
        zmix_daily.setdefault(int(ds[:4]), {})[ds] = sum(zs) / len(zs)
for y in YEARS:
    print(y, 'days with a measured mixed-layer depth:', len(zmix_daily.get(y, {})))

# Calendar-day climatology (mean across years, 7-day smoothed, gaps filled from the
# nearest measured day) for days a year's chain didn't record - 2024, for example,
# has thermistor data only from late September.
season_days = [date(2024, 3, 13) + timedelta(days=i) for i in range((date(2024, 11, 25) - date(2024, 3, 13)).days + 1)]
clim = []
for d in season_days:
    vals = [zmix_daily[y][f'{y}-{d.month:02d}-{d.day:02d}'] for y in YEARS if f'{y}-{d.month:02d}-{d.day:02d}' in zmix_daily.get(y, {})]
    clim.append(sum(vals) / len(vals) if vals else None)
def smooth_none(vals, half=3):
    out = []
    for i in range(len(vals)):
        v = [x for x in vals[max(0, i - half):i + half + 1] if x is not None]
        out.append(sum(v) / len(v) if v else None)
    return out
clim = smooth_none(clim)
known = [i for i, v in enumerate(clim) if v is not None]
for i in range(len(clim)):
    if clim[i] is None:
        nearest = min(known, key=lambda j: abs(j - i))
        clim[i] = clim[nearest]


def z_for(year, d):
    ds = d.isoformat()
    measured = zmix_daily.get(year, {}).get(ds)
    if measured is not None:
        return measured
    return clim[(date(2024, d.month, d.day) - date(2024, 3, 13)).days]


def rolling_median(vals, window=7):
    half, out = window // 2, []
    for i in range(len(vals)):
        v = sorted(x for x in vals[max(0, i - half):i + half + 1] if x is not None)
        if len(v) >= 3:
            mid = len(v) // 2
            out.append(v[mid] if len(v) % 2 else (v[mid - 1] + v[mid]) / 2)
        else:
            out.append(None)
    return out


def year_series(year, fixed_z=None):
    days = [date(year, 3, 13) + timedelta(days=i) for i in range((date(year, 11, 25) - date(year, 3, 13)).days + 1)]
    gpp, er, chlor, phyco = [], [], [], []
    for d in days:
        sr, ss = sun_times(d)
        sr_next, _ = sun_times(d + timedelta(days=1))
        sr_h, ss_h, sr_next_h = round(sr) % 24, round(ss) % 24, round(sr_next) % 24
        seq = [(d, h) for h in range(sr_h, 24)] + [(d + timedelta(days=1), h) for h in range(0, sr_next_h + 1)]
        z_mix = fixed_z if fixed_z is not None else z_for(year, d)
        day_v, night_v = [], []
        for (d0, h0), (d1, h1) in zip(seq, seq[1:]):
            do0, do1 = get(d0, h0, 'do_mgl'), get(d1, h1, 'do_mgl')
            wind0, temp0 = get(d0, h0, 'wind_ms'), get(d0, h0, 'wtemp_c')
            if None in (do0, do1, wind0, temp0):
                continue
            gas_flux = (do_sat(temp0) - do0) * (k_gas_o2_m_per_day(wind0, temp0) / 24) / z_mix
            (day_v if (d0 == d and sr_h <= h0 < ss_h) else night_v).append(do1 - do0 - gas_flux)
        g = e = None
        if len(day_v) >= 4 and len(night_v) >= 2:
            md, mn = sum(day_v) / len(day_v), sum(night_v) / len(night_v)
            e = abs(mn) * 24
            g = (md - mn) * len(day_v)
        gpp.append(g)
        er.append(e)
        def dmean(key):
            v = [get(d, h, key) for h in range(24) if get(d, h, key) is not None]
            return sum(v) / len(v) if v else None
        chlor.append(dmean('chlor_rfu'))
        phyco.append(dmean('phyco_rfu'))
    return {'gpp': rolling_median(gpp), 'er': rolling_median(er),
            'chlor': rolling_median(chlor), 'phyco': rolling_median(phyco)}


per_year = {y: year_series(y) for y in YEARS}
per_year_z2 = {y: year_series(y, fixed_z=Z_FIXED_M) for y in YEARS}
for y in YEARS:
    ok = sum(1 for v in per_year[y]['gpp'] if v is not None)
    print(y, 'smoothed GPP days:', ok)

clim_mean = []
for i, d0 in enumerate(season_days):
    zs = [z_for(y, date(y, d0.month, d0.day)) for y in YEARS]
    clim_mean.append(sum(zs) / len(zs))

data = json.load(open(JSON_PATH))
for i, d in enumerate(data['daily']):
    md = d['date'][5:]
    for key in ('gpp', 'er', 'chlor', 'phyco'):
        vals = []
        for y in YEARS:
            # each year's series starts at Mar 13, so the index lines up with 2024's
            vals.append(per_year[y][key][i])
        vals = [v for v in vals if v is not None]
        d[key + '_avg'] = round(sum(vals) / len(vals), 3) if vals else None
    d['nep_avg'] = round(d['gpp_avg'] - d['er_avg'], 3) if None not in (d['gpp_avg'], d['er_avg']) else None
    d['zmix_avg'] = round(clim_mean[i], 2)
    for key in ('gpp', 'er'):
        v2 = [per_year_z2[y][key][i] for y in YEARS if per_year_z2[y][key][i] is not None]
        d[key + '_avg_z2'] = round(sum(v2) / len(v2), 3) if v2 else None
    d['nep_avg_z2'] = round(d['gpp_avg_z2'] - d['er_avg_z2'], 3) if None not in (d['gpp_avg_z2'], d['er_avg_z2']) else None
data['source']['metabolism_avg'] = ('Bookkeeping GPP/ER computed with a measured mixed-layer depth (thermistor chain, EDI knb-lter-ntl.130; density threshold 0.1 kg/m3; calendar-day climatology where a year has no chain data) separately for ' + ', '.join(map(str, YEARS)) +
                                    ', 7-day-median smoothed per year, then averaged by calendar day')
json.dump(data, open(JSON_PATH, 'w'), indent=2)
print('done; days with gpp_avg:', sum(1 for d in data['daily'] if d['gpp_avg'] is not None), 'of', len(data['daily']))
