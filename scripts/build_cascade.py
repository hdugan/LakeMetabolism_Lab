# Builds data/cascade.json for the end of Module 7: daily GPP / ER / NEP (bookkeeping method, as
# Module 6), chlorophyll and oxygen for Paul (reference), Peter and Tuesday (fertilized) Lakes,
# 2013-2015, from the Cascade whole-lake nutrient experiment (UNDERC, Michigan):
#   data/LRT_Squeal2_allYears_HighFreq_SondeData_MARSSinterps_v3_CASCADE.csv
# Lake codes in the file: L = Paul, R = Peter, T = Tuesday. 5-minute, gap-filled (MARSS) data from two
# sondes (YSI and Hydrolab, which agree closely); the two are averaged, then averaged to the hour.
#
# The file has no wind, light, or temperature profile, so the gas-exchange correction uses the same
# assumed constants for all three lakes: wind 1.0 m/s and a 2 m mixed layer. Because the same
# assumptions apply to every lake and year, differences between the fertilized lakes and the
# unfertilized reference (Paul) are more trustworthy than the absolute rates.
import csv, json, math, collections
from datetime import date, timedelta

CSV = 'data/LRT_Squeal2_allYears_HighFreq_SondeData_MARSSinterps_v3_CASCADE.csv'
LAT, LON, TZ = 46.25, -89.50, -5
WIND, Z_MIX = 1.0, 2.0
LAKES = {'L': 'Paul', 'R': 'Peter', 'T': 'Tuesday'}
# Nutrient addition days (DOY) from the project's Table 2
FERT = {
    '2013': {'R': (154, 238), 'T': (154, 238)},
    '2014': {'R': (153, 241), 'T': (153, 241)},
    '2015': {'R': (152, 180), 'T': (152, 240)},
}
SAMPLING = {'2013': (137, 249), '2014': (136, 250), '2015': (129, 247)}


def do_sat(t):
    return 14.652 - 0.41022 * t + 0.007991 * t * t - 0.000077774 * t * t * t


def schmidt_o2(t):
    return 1568 - 86.04 * t + 2.142 * t ** 2 - 0.0216 * t ** 3


def k_gas(wind, t):
    return (2.07 + 0.215 * wind ** 1.7) * 24 / 100 * ((schmidt_o2(t) / 600) ** -0.5)


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
        return (((Jevent + 0.5) % 1.0) * 24 + TZ) % 24
    return calc(True), calc(False)


def num(x):
    try:
        return float(x)
    except (ValueError, TypeError):
        return None


def avg(*vals):
    v = [x for x in vals if x is not None]
    return sum(v) / len(v) if v else None


# (year, lake) -> {(doy_int, hour): {'do': [...], 'temp': [...], 'chl': [...]}}
acc = collections.defaultdict(lambda: collections.defaultdict(lambda: collections.defaultdict(list)))
with open(CSV, newline='') as f:
    for row in csv.DictReader(f):
        doy = float(row['DoY'])
        key = (int(doy), int((doy % 1) * 24 + 1e-6))
        b = acc[(row['Year'], row['Lake'])][key]
        for name, cols in (('do', ('DO_YSI', 'DO_HYLB')), ('temp', ('Temp_YSI', 'Temp_HYLB')), ('chl', ('Chl_YSI', 'Chl_HYLB'))):
            v = avg(*[num(row[c]) for c in cols])
            if v is not None:
                b[name].append(v)
hourly = {k: {kk: {n: sum(v) / len(v) for n, v in vv.items() if v} for kk, vv in d.items()} for k, d in acc.items()}


def doy_date(year, doy):
    return date(int(year), 1, 1) + timedelta(days=doy - 1)


def bookkeep(year, lake, doy):
    d = doy_date(year, doy)
    sr, ss = sun_times(d)
    sr_next, _ = sun_times(d + timedelta(days=1))
    sr_h, ss_h, sr_next_h = round(sr) % 24, round(ss) % 24, round(sr_next) % 24
    H = hourly[(year, lake)]
    seq = [(doy, h) for h in range(sr_h, 24)] + [(doy + 1, h) for h in range(0, sr_next_h + 1)]
    day_v, night_v = [], []
    for (d0, h0), (d1, h1) in zip(seq, seq[1:]):
        a, b = H.get((d0, h0)), H.get((d1, h1))
        if not a or not b or 'do' not in a or 'do' not in b or 'temp' not in a:
            continue
        gas = (do_sat(a['temp']) - a['do']) * (k_gas(WIND, a['temp']) / 24) / Z_MIX
        (day_v if (d0 == doy and sr_h <= h0 < ss_h) else night_v).append(b['do'] - a['do'] - gas)
    if len(day_v) < 4 or len(night_v) < 2:
        return None, None
    md, mn = sum(day_v) / len(day_v), sum(night_v) / len(night_v)
    return (md - mn) * len(day_v), abs(mn) * 24


def rolling_median(vals, window=7):
    half, out = window // 2, []
    for i in range(len(vals)):
        v = sorted(x for x in vals[max(0, i - half):i + half + 1] if x is not None)
        if len(v) >= 3:
            m = len(v) // 2
            out.append(v[m] if len(v) % 2 else (v[m - 1] + v[m]) / 2)
        else:
            out.append(None)
    return out


r3 = lambda v: round(v, 3) if v is not None else None
out = {'lakes': {'L': 'Paul', 'R': 'Peter', 'T': 'Tuesday'}, 'fertilized_days': {y: {LAKES[k]: v for k, v in d.items()} for y, d in FERT.items()},
       'sampling_days': SAMPLING, 'years': {}}
for year in ('2013', '2014', '2015'):
    lo, hi = SAMPLING[year]
    doys = list(range(lo + 1, hi))
    ydata = {}
    for code, name in LAKES.items():
        H = hourly[(year, code)]
        gpp, er, chl, dom = [], [], [], []
        for doy in doys:
            g, e = bookkeep(year, code, doy)
            gpp.append(g); er.append(e)
            day = [H[(doy, h)] for h in range(24) if (doy, h) in H]
            chl.append(avg(*[x.get('chl') for x in day]))
            dom.append(avg(*[x.get('do') for x in day]))
        gs, es = rolling_median(gpp), rolling_median(er)
        ydata[name] = {
            'gpp': [r3(v) for v in gs], 'er': [r3(v) for v in es],
            'nep': [r3(g - e) if None not in (g, e) else None for g, e in zip(gs, es)],
            'chl': [r3(v) for v in chl], 'do_mean': [r3(v) for v in dom],
        }
    out['years'][year] = {'doy': doys, 'lakes': ydata}
out['source'] = 'Cascade whole-lake nutrient experiment (UNDERC, Michigan), 5-min sonde data 2013-2015; bookkeeping metabolism with assumed wind 1.0 m/s and 2 m mixed layer for all lakes; 7-day rolling median'
json.dump(out, open('data/cascade.json', 'w'))
import statistics as st
for year in out['years']:
    y = out['years'][year]; doys = y['doy']
    print(year)
    for name in ('Paul', 'Peter', 'Tuesday'):
        L = y['lakes'][name]
        code = [c for c, n in LAKES.items() if n == name][0]
        fr = FERT[year].get(code)
        def m(arr, a, b):
            v = [x for d, x in zip(doys, arr) if x is not None and a <= d <= b]
            return round(st.mean(v), 2) if v else None
        pre_end = (fr[0] - 1) if fr else 153
        print(' ', name, 'pre(<=%d): GPP %s ER %s NEP %s' % (pre_end, m(L['gpp'], 0, pre_end), m(L['er'], 0, pre_end), m(L['nep'], 0, pre_end)),
              '| late(200-240): GPP %s ER %s NEP %s chl %s' % (m(L['gpp'], 200, 240), m(L['er'], 200, 240), m(L['nep'], 200, 240), m(L['chl'], 200, 240)))
