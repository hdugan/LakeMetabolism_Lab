# Trims data/mendota_seasonal.json to the fields Module 6 actually reads (the multi-year averages from
# add_par_below.py and add_multiyear_metabolism.py). The earlier 2024-only series and the OLS / MLE /
# Kalman filter / Bayesian columns are dropped. Run last, from the repo root:
#   python3 scripts/prune_seasonal.py
import json

PATH = 'data/mendota_seasonal.json'
KEEP = ['date', 'gpp_avg', 'er_avg', 'nep_avg', 'chlor_avg', 'phyco_avg', 'par_clim', 'par_below_clim', 'wtemp_clim']
KEEP_SOURCE = ['par_clim', 'metabolism_avg']

data = json.load(open(PATH))
data['daily'] = [{k: d.get(k) for k in KEEP} for d in data['daily']]
data['source'] = {k: v for k, v in data['source'].items() if k in KEEP_SOURCE}
data.pop('year', None)
json.dump(data, open(PATH, 'w'), indent=1)
print('kept fields:', KEEP)
