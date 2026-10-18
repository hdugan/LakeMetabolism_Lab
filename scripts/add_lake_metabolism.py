# Adds daily GPP / ER / NEP for July 2019 to data/lakes_compare.json for Lake Mendota,
# Trout Bog and Trout Lake, using the same LakeMetabolizer-style bookkeeping method as
# Module 6 (hourly night/day DO changes with the estimated atmospheric flux subtracted).
# Run from the repo root after scripts/build_lakes_compare.py:
#   python3 scripts/add_lake_metabolism.py
#
# Inputs that differ by lake (flagged in the JSON and on the page):
# - Wind: measured at Mendota (ntl129) and Trout Lake (ntl117). Trout Bog's wind record ends in
#   2014, so its July mean from 2003-2014 is used as a constant (the bog is wind-sheltered).
# - Mixed-layer depth z_mix (the depth the gas-exchange correction is spread over): from the
#   thermistor chain by the 0.1 kg/m3 density rule for Mendota (ntl130) and Trout Lake (ntl116).
#   Trout Bog has no July 2019 temperature profile, so 1 m is assumed (its summer mixed layer
#   is only about a meter deep).
import csv, json, math, collections
from datetime import date, timedelta

JSON_PATH = 'data/lakes_compare.json'
JULY = [date(2019, 7, 1) + timedelta(days=i) for i in range(31)]
JULY_STR = {d.isoformat() for d in JULY}
TZ = -5
Z_MIN, Z_FULL = 1.0, 12.8
DENSITY_THRESHOLD = 0.1
BOG_Z_MIX = 1.0
LAKE_LOC = {'mendota': (43.0989, -89.4045), 'troutbog': (46.0413, -89.6862), 'troutlake': (46.0293, -89.6665)}


def fnum(x):
    try:
        return float(x)
    except (ValueError, TypeError):
        return None


def hh(v):
    v = int(v)
    return v if v <= 23 else v // 100


def do_sat(t):
    return 14.652 - 0.41022 * t + 0.007991 * t * t - 0.000077774 * t * t * t


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


def schmidt_o2(t):
    return 1568 - 86.04 * t + 2.142 * t ** 2 - 0.0216 * t ** 3


def k_gas_o2_m_per_day(wind, temp):
    k600 = (2.07 + 0.215 * (wind ** 1.7)) * 24 / 100
    return k600 * ((schmidt_o2(temp) / 600) ** -0.5)


def water_density(t):
    return 1000 * (1 - (t + 288.9414) / (508929.2 * (t + 68.12963)) * (t - 3.9863) ** 2)


def mixed_layer_depth(profile):
    deps = sorted(profile)
    if len(deps) < 5 or deps[0] > 1:
        return None
    rho0 = water_density(profile[deps[0]])
    prev_d, prev_diff = deps[0], 0.0
    for dep in deps[1:]:
        diff = water_density(profile[dep]) - rho0
        if diff >= DENSITY_THRESHOLD:
            frac = (DENSITY_THRESHOLD - prev_diff) / (diff - prev_diff) if diff != prev_diff else 0
            return max(Z_MIN, min(Z_FULL, prev_d + frac * (dep - prev_d)))
        prev_d, prev_diff = dep, diff
    return Z_FULL


def daily_z_from_chain(path):
    prof = collections.defaultdict(lambda: collections.defaultdict(list))
    with open(path, newline='') as f:
        r = csv.reader(f)
        next(r)
        for row in r:
            if row[1] in JULY_STR:
                t = fnum(row[4])
                if t is not None:
                    prof[(row[1], hh(row[2]))][float(row[3])].append(t)
    byday = collections.defaultdict(list)
    for (ds, hr), p in prof.items():
        z = mixed_layer_depth({d: sum(v) / len(v) for d, v in p.items()})
        if z is not None:
            byday[ds].append(z)
    return {ds: sum(z) / len(z) for ds, z in byday.items() if len(z) >= 12}


# ---- hourly DO / temp / wind for July 2019 ----
H = {k: collections.defaultdict(dict) for k in LAKE_LOC}
with open('data/ntl129_2_v15.csv', newline='') as f:
    r = csv.reader(f)
    next(r)
    for row in r:
        if row[1] in JULY_STR:
            H['mendota'][row[1]][hh(row[2])] = {'do': fnum(row[23]), 'temp': fnum(row[19]), 'wind': fnum(row[7])}
with open('data/ntl117_2_v9_TR.csv', newline='') as f:
    r = csv.reader(f)
    h = next(r)
    ix = {c: i for i, c in enumerate(h)}
    for row in r:
        if row[1] in JULY_STR:
            do = fnum(row[ix['avg_do_raw']])
            do = do if do is not None and 0 <= do <= 20 else None
            t = fnum(row[ix['avg_do_wtemp']])
            t = t if t is not None and 0 <= t <= 35 else None
            H['troutlake'][row[1]][hh(row[2])] = {'do': do, 'temp': t, 'wind': fnum(row[ix['avg_wind_speed']])}
# Trout Bog: hourly means of the 2-minute record; wind = July mean 2003-2014 (constant)
bog_wind = []
with open('data/ntl69_tb_met_hourly_v3_TB.csv', newline='') as f:
    r = csv.reader(f)
    next(r)
    for row in r:
        if row[0][5:7] == '07' and fnum(row[4]) is not None:
            bog_wind.append(float(row[4]))
BOG_WIND = sum(bog_wind) / len(bog_wind)
acc = collections.defaultdict(lambda: collections.defaultdict(lambda: collections.defaultdict(list)))
with open('data/ntl69_hires_do_v2_TB.csv', newline='') as f:
    r = csv.reader(f)
    next(r)
    for row in r:
        if row[0] in JULY_STR:
            hr = int(row[1][:2])
            for key, val in (('do', row[4]), ('temp', row[5])):
                v = fnum(val)
                if v is not None:
                    acc[row[0]][hr][key].append(v)
for ds, hrs in acc.items():
    for hr, a in hrs.items():
        do = sum(a['do']) / len(a['do']) if a['do'] else None
        t = sum(a['temp']) / len(a['temp']) if a['temp'] else None
        H['troutbog'][ds][hr] = {'do': do if do is not None and 0 <= do <= 20 else None, 'temp': t, 'wind': BOG_WIND}

Z = {
    'mendota': daily_z_from_chain('data/ntl130_2_v14.csv'),
    'troutlake': daily_z_from_chain('data/ntl116_2_v9_TR.csv'),
}


def z_for(lake, d):
    if lake == 'troutbog':
        return BOG_Z_MIX
    z = Z[lake].get(d.isoformat())
    if z is not None:
        return z
    vals = list(Z[lake].values())     # fall back to the lake's own July mean
    return sum(vals) / len(vals)


def bookkeep_day(lake, d):
    lat, lon = LAKE_LOC[lake]
    sr, ss = sun_times(d, lat, lon)
    sr_next, _ = sun_times(d + timedelta(days=1), lat, lon)
    sr_h, ss_h, sr_next_h = round(sr) % 24, round(ss) % 24, round(sr_next) % 24
    seq = [(d, h) for h in range(sr_h, 24)] + [(d + timedelta(days=1), h) for h in range(0, sr_next_h + 1)]
    z_mix = z_for(lake, d)
    get = lambda dd, hr, key: H[lake].get(dd.isoformat(), {}).get(hr, {}).get(key)
    day_v, night_v = [], []
    for (d0, h0), (d1, h1) in zip(seq, seq[1:]):
        do0, do1, w0, t0 = get(d0, h0, 'do'), get(d1, h1, 'do'), get(d0, h0, 'wind'), get(d0, h0, 'temp')
        if None in (do0, do1, w0, t0):
            continue
        gas = (do_sat(t0) - do0) * (k_gas_o2_m_per_day(w0, t0) / 24) / z_mix
        (day_v if (d0 == d and sr_h <= h0 < ss_h) else night_v).append(do1 - do0 - gas)
    if len(day_v) < 4 or len(night_v) < 2:
        return None, None, z_mix
    md, mn = sum(day_v) / len(day_v), sum(night_v) / len(night_v)
    er = abs(mn) * 24
    gpp = (md - mn) * len(day_v)
    return gpp, er, z_mix


data = json.load(open(JSON_PATH))
for lake in LAKE_LOC:
    rows = []
    for d in JULY:
        g, e, z = bookkeep_day(lake, d)
        rows.append({'date': d.isoformat(), 'gpp': round(g, 3) if g is not None else None, 'er': round(e, 3) if e is not None else None,
                     'nep': round(g - e, 3) if g is not None else None, 'z_mix': round(z, 2)})
    ok = [r for r in rows if r['gpp'] is not None]
    mean = lambda k: sum(r[k] for r in ok) / len(ok)
    data['lakes'][lake]['metabolism'] = {
        'daily': rows,
        'mean_gpp': round(mean('gpp'), 3), 'mean_er': round(mean('er'), 3), 'mean_nep': round(mean('nep'), 3),
        'mean_z_mix': round(sum(r['z_mix'] for r in rows) / len(rows), 2),
        'n_days': len(ok),
        'wind_source': 'measured' if lake != 'troutbog' else f'July mean of 2003-2014 ({BOG_WIND:.2f} m/s), constant',
        'z_mix_source': 'thermistor chain, 0.1 kg/m3 density rule' if lake != 'troutbog' else 'assumed 1 m',
    }
    m = data['lakes'][lake]['metabolism']
    print(lake, 'days', m['n_days'], 'GPP %.2f ER %.2f NEP %.2f' % (m['mean_gpp'], m['mean_er'], m['mean_nep']), 'z_mix %.1f' % m['mean_z_mix'])
data['source']['metabolism'] = 'GPP/ER/NEP: bookkeeping method (as Module 6), July 2019; Trout Bog wind = 2003-2014 July mean and z_mix = 1 m (assumed); Mendota and Trout Lake z_mix from thermistor chains (ntl130, ntl116)'
json.dump(data, open(JSON_PATH, 'w'), indent=1)
