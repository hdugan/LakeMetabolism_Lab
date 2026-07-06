# Adds five_min_do and daily_do to data/mendota_week.json for Module 5
# (High-Frequency Data), by aggregating the native ~1-minute buoy log up to
# 5-minute and daily bins. The existing hourly `do_mgl` in mendota_week.json
# already comes from NTL's own hourly product and is reused as-is; this
# script only adds the two extra resolutions.
#
# The source file is the single-entity, multi-year "High Resolution
# Meteorological and Metabolism Data" product and is large (~640 MB as of
# this writing) - fetch it once, filter to the target week, then this
# script only needs the small filtered CSV:
#
#   curl -o meteo_1min_full.csv "https://pasta.lternet.edu/package/data/eml/knb-lter-ntl/129/41/af29c64a7de5ad797b5709b5f7718cb9"
#   grep -E '^2023,"2023-07-(09|10|11|12|13|14|15)"' meteo_1min_full.csv > week_1min.csv
#
# (revision 41 is the latest as of 2026-07; check
# https://pasta.lternet.edu/package/eml/knb-lter-ntl/129 for newer ones.)
import csv, json
from datetime import datetime, timedelta

rows = []
with open('week_1min.csv', newline='') as f:
    r = csv.reader(f)
    for row in r:
        ds = row[1].strip('"')
        ts = row[2].strip('"')
        try:
            do_val = float(row[15])
        except ValueError:
            do_val = None
        rows.append((datetime.strptime(f"{ds} {ts}", "%Y-%m-%d %H:%M:%S"), do_val))
rows.sort(key=lambda x: x[0])

missing = sum(1 for _, v in rows if v is None)
print('rows:', len(rows), 'missing do values:', missing)


def bucket_avg(rows, minutes_per_bucket):
    # Bucket by elapsed minutes since the first row, so this never depends on
    # the system's local timezone (no epoch/timestamp() math).
    start = rows[0][0]
    buckets = {}
    for dt, v in rows:
        if v is None:
            continue
        idx = int((dt - start).total_seconds() // 60) // minutes_per_bucket
        buckets.setdefault(idx, []).append(v)
    out = []
    for idx in sorted(buckets):
        vals = buckets[idx]
        out.append((start + timedelta(minutes=idx * minutes_per_bucket), sum(vals) / len(vals)))
    return out


five_min = bucket_avg(rows, 5)
daily = bucket_avg(rows, 1440)
print('five_min points:', len(five_min), 'daily points:', len(daily))

with open('mendota_week.json') as f:
    data = json.load(f)

data['five_min_do'] = [{'t': dt.strftime('%Y-%m-%dT%H:%M:%S'), 'do_mgl': round(v, 3)} for dt, v in five_min]
data['daily_do'] = [{'date': dt.strftime('%Y-%m-%d'), 'do_mgl': round(v, 3)} for dt, v in daily]

with open('mendota_week.json', 'w') as f:
    json.dump(data, f, indent=2)
print('updated mendota_week.json with five_min_do and daily_do')
