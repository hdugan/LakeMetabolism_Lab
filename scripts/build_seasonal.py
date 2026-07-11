# Builds data/mendota_seasonal.json for Module 8 (Seasonal Metabolism): a
# full 2024 open-water season (March 13 - November 25 - the buoy is out of
# the water outside this window every year; there is no winter data to have),
# with per-day GPP/ER/NEP from the same automated night-slope/day-slope
# method as Module 6, plus a 7-day rolling median to tame the method's
# well-known day-to-day noise.
#
# Source (fetch once into this directory; see scripts/build_dataset.py):
#   curl -o meteo_hourly.csv "https://pasta.lternet.edu/package/data/eml/knb-lter-ntl/129/41/72494d432fe1e977f5326100a733cece"
#
# NOTE: this file's "hour" column inconsistently switches format partway
# through 2024 - "HHMM" (e.g. 1400) through June, plain hour (e.g. 14) from
# August on, with July mixing both within the same month. The parsing below
# handles both; watch for this if a future revision shifts the boundary.
import csv, json, math
from datetime import date, timedelta

LAT = 43.0989
LON = -89.4045
TZ_OFFSET = -5

START = date(2024, 3, 13)
END = date(2024, 11, 25)


def do_sat(t):
    # Same DO-saturation regression used everywhere else in this app
    # (Modules 3, 4, 6, and build_seasonal_methods.py).
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
        sin_delta = math.sin(lamrad) * math.sin(math.radians(23.44))
        delta = math.asin(sin_delta)
        latrad = math.radians(LAT)
        elevation = math.radians(-0.833)
        cos_omega = (math.sin(elevation) - math.sin(latrad) * math.sin(delta)) / (math.cos(latrad) * math.cos(delta))
        cos_omega = max(-1, min(1, cos_omega))
        omega = math.degrees(math.acos(cos_omega))
        Jevent = Jtransit - omega / 360.0 if is_sunrise else Jtransit + omega / 360.0
        frac = (Jevent + 0.5) % 1.0
        return (frac * 24 + TZ_OFFSET) % 24
    return calc(True), calc(False)


# ---- load hourly meteo for 2024 + first few days of Dec (for the season's
# final night's sunrise) ----
hourly = {}  # (date_str, hour_int) -> dict
with open('meteo_hourly.csv', newline='') as f:
    r = csv.reader(f)
    next(r)
    for row in r:
        ds = row[1].strip('"')
        if not (ds.startswith('2024-') or ds == '2024-12-01'):
            continue
        try:
            hour_val = int(row[2])
        except ValueError:
            continue
        # The source file's hour column inconsistently switches convention
        # partway through 2024: "HHMM" (e.g. 1400) through June, plain hour
        # (e.g. 14) from August on, with July mixing both. Plain-hour values
        # are always <=23, while HHMM values are 0 or >=100, so this covers
        # both without needing to know which month/row uses which.
        hh = hour_val if hour_val <= 23 else hour_val // 100

        def fnum(s):
            try:
                return float(s)
            except (ValueError, TypeError):
                return None
        hourly[(ds, hh)] = {
            'do_mgl': fnum(row[23]), 'wtemp_c': fnum(row[19]), 'wind_ms': fnum(row[7]),
            'par': fnum(row[15]), 'chlor_rfu': fnum(row[11]), 'phyco_rfu': fnum(row[13]),
            'air_temp_c': fnum(row[3]),
        }

print('hourly rows loaded:', len(hourly))


def get(d, hour, key):
    row = hourly.get((d.isoformat(), hour))
    return row[key] if row else None


# ---- LakeMetabolizer's metab.bookkeep(), ported from R/metab.bookkeep.R
# (Cole et al. 2000) ----
# Unlike a bare night-slope/day-slope split, this subtracts an estimated
# atmospheric flux from every hourly DO change before doing the day/night
# split, so gas exchange doesn't get misread as respiration. k600 comes
# from wind via Cole & Caraco (1998) (R/k.cole.R), converted to a
# temperature-specific kO2 via the Schmidt number (R/getSchmidt.R,
# R/k600.2.kGAS.R). z.mix (mixed-layer depth) isn't measured by this buoy
# setup, so it's fixed at 2 m for the whole season - a rough stand-in for
# the shallow near-surface layer the sensor sits in. This is a known
# imperfect simplification: once the lake destratifies and mixes deeper in
# fall, the true mixed layer is considerably deeper than 2 m, so the fall/
# spring corrections here likely overstate the atmospheric flux's effect on
# concentration (see the caveat in module7.html's footer).
Z_MIX_M = 2.0


def schmidt_o2(temp_c):
    return 1568 - 86.04 * temp_c + 2.142 * temp_c ** 2 - 0.0216 * temp_c ** 3


def k_gas_o2_m_per_day(wind_ms, temp_c):
    k600_cm_hr = 2.07 + 0.215 * (wind_ms ** 1.7)
    k600_m_day = k600_cm_hr * 24 / 100
    sc600 = schmidt_o2(temp_c) / 600
    return k600_m_day * (sc600 ** -0.5)


days = [START + timedelta(days=i) for i in range((END - START).days + 1)]
results = []
n_ok = 0
for d in days:
    sr, ss = sun_times(d)
    sr_next, _ = sun_times(d + timedelta(days=1))
    sr_h, ss_h, sr_next_h = round(sr) % 24, round(ss) % 24, round(sr_next) % 24

    # Full hourly sequence from this day's sunrise through the next day's
    # sunrise, as (date, hour) pairs - the same day/night window Module 6
    # teaches by hand, just walked hour by hour instead of endpoint-to-endpoint.
    seq = [(d, h) for h in range(sr_h, 24)] + [(d + timedelta(days=1), h) for h in range(0, sr_next_h + 1)]

    nep_day, nep_night = [], []
    for (dt0, h0), (dt1, h1) in zip(seq, seq[1:]):
        do0 = get(dt0, h0, 'do_mgl')
        do1 = get(dt1, h1, 'do_mgl')
        wind0 = get(dt0, h0, 'wind_ms')
        temp0 = get(dt0, h0, 'wtemp_c')
        if None in (do0, do1, wind0, temp0):
            continue
        delta_do = do1 - do0
        sat0 = do_sat(temp0)
        kgas0 = k_gas_o2_m_per_day(wind0, temp0)
        gas_flux = (sat0 - do0) * (kgas0 / 24) / Z_MIX_M
        delta_do_metab = delta_do - gas_flux
        is_day = sr_h <= h0 < ss_h if dt0 == d else False
        (nep_day if is_day else nep_night).append(delta_do_metab)

    gpp = er = nep = None
    if len(nep_day) >= 4 and len(nep_night) >= 2:
        mean_day = sum(nep_day) / len(nep_day)
        mean_night = sum(nep_night) / len(nep_night)
        er = abs(mean_night) * 24  # LakeMetabolizer's R is negative; this app reports ER as a positive magnitude
        gpp = (mean_day - mean_night) * len(nep_day)
        nep = gpp - er  # kept consistent with "NEP = GPP - ER" as taught elsewhere in the app
        n_ok += 1

    def dmean(key):
        vals = [hourly[(d.isoformat(), h)][key] for h in range(24)
                if (d.isoformat(), h) in hourly and hourly[(d.isoformat(), h)][key] is not None]
        return round(sum(vals) / len(vals), 3) if vals else None

    results.append({
        'date': d.isoformat(),
        'gpp': round(gpp, 3) if gpp is not None else None,
        'er': round(er, 3) if er is not None else None,
        'nep': round(nep, 3) if nep is not None else None,
        'wtemp_c': dmean('wtemp_c'),
        'par': dmean('par'),
        'chlor_rfu': dmean('chlor_rfu'),
        'phyco_rfu': dmean('phyco_rfu'),
    })

print('days total:', len(days), 'days with GPP/ER:', n_ok)


# The single-endpoint night/day-slope method is well known to be noisy day to
# day (a brief wind gust or sensor blip right at the sampled sunrise/sunset
# hour can throw off one day's estimate a lot) - a rolling median across a
# +/-3 day window is standard practice for this method and, being a median
# rather than a mean, isn't dragged around by the rare single-day outlier.
def rolling_median(key, window=7):
    half = window // 2
    out = []
    for i in range(len(results)):
        lo, hi = max(0, i - half), min(len(results), i + half + 1)
        vals = sorted(v for v in (results[j][key] for j in range(lo, hi)) if v is not None)
        if len(vals) >= 3:
            mid = len(vals) // 2
            out.append(vals[mid] if len(vals) % 2 else (vals[mid - 1] + vals[mid]) / 2)
        else:
            out.append(None)
    return out


gpp_smooth = rolling_median('gpp')
er_smooth = rolling_median('er')
chlor_smooth = rolling_median('chlor_rfu')
phyco_smooth = rolling_median('phyco_rfu')
for i, r in enumerate(results):
    r['gpp_smooth'] = round(gpp_smooth[i], 3) if gpp_smooth[i] is not None else None
    r['er_smooth'] = round(er_smooth[i], 3) if er_smooth[i] is not None else None
    r['nep_smooth'] = round(gpp_smooth[i] - er_smooth[i], 3) if None not in (gpp_smooth[i], er_smooth[i]) else None
    r['chlor_smooth'] = round(chlor_smooth[i], 3) if chlor_smooth[i] is not None else None
    r['phyco_smooth'] = round(phyco_smooth[i], 3) if phyco_smooth[i] is not None else None

out = {
    'lake': 'Lake Mendota',
    'year': 2024,
    'season': {'start': START.isoformat(), 'end': END.isoformat()},
    'location': {'lat': LAT, 'lon': LON},
    'daily': results,
    'source': {
        'metabolism': 'EDI knb-lter-ntl.129 (Hourly Meteorological and Metabolism Data, Lake Mendota), 2024 open-water season',
        'method': "LakeMetabolizer's metab.bookkeep (Cole et al. 2000): hourly night/day DO changes, atmospheric flux "
                  "subtracted using k600 from wind (Cole & Caraco 1998) scaled to kO2 via the Schmidt number, z.mix fixed at 2 m "
                  "(a known simplification - likely overstates the flux correction once the lake mixes deeper than 2 m in fall)",
    },
}
with open('mendota_seasonal.json', 'w') as f:
    json.dump(out, f, indent=2)
import os
print('wrote mendota_seasonal.json, size KB:', round(os.path.getsize('mendota_seasonal.json') / 1024, 1))

# quick sanity peek by month
from collections import defaultdict
monthly_gpp = defaultdict(list)
monthly_er = defaultdict(list)
for r in results:
    if r['gpp'] is not None:
        monthly_gpp[r['date'][:7]].append(r['gpp'])
        monthly_er[r['date'][:7]].append(r['er'])
for m in sorted(monthly_gpp):
    g = monthly_gpp[m]
    e = monthly_er[m]
    print(m, 'n=', len(g), 'meanGPP=', round(sum(g) / len(g), 2), 'meanER=', round(sum(e) / len(e), 2))
