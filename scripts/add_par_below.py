# Adds daily `par_below` (PAR at 1 m depth, same daily-mean treatment as `par`),
# plus multi-year averages `par_clim` / `par_below_clim` / `wtemp_clim`, to data/mendota_seasonal.json
# from the EDI knb-lter-ntl.129 hourly file (data/ntl129_2_v15.csv - column avg_par_below). Surface `par` in the
# JSON matches avg_par from this same file, so the two are directly
# comparable. Days with no under-water readings stay null (the sensor wasn't
# reporting, e.g. mid-March and a few days in June). Run from the repo root:
#   python3 scripts/add_par_below.py
import csv, json

CSV = 'data/ntl129_2_v15.csv'
JSON_PATH = 'data/mendota_seasonal.json'

# Years whose 1 m sensor was clean all season. In 2016-2020 the under-water
# sensor fouled progressively through the summer (the 1 m reading falls to a
# few percent of surface light), so those years would understate how much light
# gets into the lake. No days are dropped within the years that are used.
CLEAN_YEARS = ('2021', '2022', '2023', '2024', '2025')

by_day = {}   # (year, 'MM-DD') -> {'par': [hourly], 'par_below': [hourly]}
with open(CSV, newline='') as f:
    r = csv.reader(f)
    header = next(r)
    i_date, i_par, i_below, i_wtemp = header.index('sampledate'), header.index('avg_par'), header.index('avg_par_below'), header.index('avg_do_wtemp')
    for row in r:
        y = row[i_date][:4]
        if y not in CLEAN_YEARS:
            continue
        e = by_day.setdefault((y, row[i_date][5:]), {'par': [], 'par_below': [], 'wtemp': []})
        for key, i in (('par', i_par), ('par_below', i_below), ('wtemp', i_wtemp)):
            if row[i] in ('', 'NA'):
                continue
            v = float(row[i])
            # PAR can't be negative: a few hours of sensor error (about -1,700 at 1 m
            # on 2025-04-08 to 04-10) are dropped; every other reading is kept.
            if key in ('par', 'par_below') and v < 0:
                continue
            e[key].append(v)

def daily_mean(vals):
    return sum(vals) / len(vals) if vals else None

data = json.load(open(JSON_PATH))
for d in data['daily']:
    md = d['date'][5:]
    below = daily_mean(by_day.get(('2024', md), {'par_below': []})['par_below'])
    d['par_below'] = round(below, 3) if below is not None else None
    for key in ('par', 'par_below', 'wtemp'):
        yearly = [daily_mean(by_day[(y, md)][key]) for y in CLEAN_YEARS if (y, md) in by_day]
        yearly = [v for v in yearly if v is not None]
        d[key + '_clim'] = round(sum(yearly) / len(yearly), 3) if yearly else None
data['source']['par_below'] = 'EDI knb-lter-ntl.129 avg_par_below (PAR at 1 m depth), 2024 daily mean of hourly values'
data['source']['par_clim'] = ('Average of the daily-mean surface PAR, PAR at 1 m, and water temperature across ' + ', '.join(CLEAN_YEARS)
                              + ' (same calendar day each year) - EDI knb-lter-ntl.129; 2016-2020 excluded for under-water sensor fouling')
json.dump(data, open(JSON_PATH, 'w'), indent=2)
print('clim days:', sum(1 for d in data['daily'] if d['par_clim'] is not None), 'below:', sum(1 for d in data['daily'] if d['par_below_clim'] is not None))
