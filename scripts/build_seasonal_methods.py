# Fits OLS, MLE, Kalman-filter, and Bayesian (MCMC) versions of the same
# 3-process model (GPP ~ PAR, constant R, gas exchange ~ wind*(DOsat-DO))
# for every day of the 2024 season, alongside the existing bookkeeping
# method already in data/mendota_seasonal.json. Each day's fit uses a
# 48-hour window (that day 00:00 through the next day 23:00) so there's
# enough data to estimate 3 (or 4, for KF/Bayesian) parameters; GPP/ER for
# that day are then computed from the fitted rate constants applied to that
# day's own PAR/24-hour window.
#
# Run scripts/build_seasonal.py first (produces the bookkeeping-only
# mendota_seasonal.json this script reads and adds columns to). No numpy/
# scipy/PyMC in this environment, so every method - including the 3x3 normal
# equations solve and the Metropolis-Hastings sampler - is written from
# scratch in plain Python. Runtime: ~15s for all 258 days on a laptop.
import csv, json, math, random, time
from datetime import date, timedelta

START = date(2024, 3, 13)
END = date(2024, 11, 25)
Hobs = 0.02 ** 2  # fixed observation-noise variance (typical optical DO sensor precision)


def do_sat(t):
    return 14.652 - 0.41022 * t + 0.007991 * t * t - 0.000077774 * t * t * t


# ---- load hourly data (same parsing/format-quirk fix as build_seasonal.py) ----
hourly = {}
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
        hh = hour_val if hour_val <= 23 else hour_val // 100

        def fnum(s):
            try:
                return float(s)
            except (ValueError, TypeError):
                return None
        hourly[(ds, hh)] = {'do_mgl': fnum(row[23]), 'wtemp_c': fnum(row[19]), 'wind_ms': fnum(row[7]), 'par': fnum(row[15])}

print('hourly rows loaded:', len(hourly))


def get_window(day, span_hours=48):
    """(DO, PAR, WIND, TEMP) for `span_hours` starting at `day` 00:00, or
    None if incomplete."""
    do, par, wind, temp = [], [], [], []
    d, h = day, 0
    for _ in range(span_hours):
        row = hourly.get((d.isoformat(), h))
        if row is None or None in (row['do_mgl'], row['par'], row['wind_ms'], row['wtemp_c']):
            return None
        do.append(row['do_mgl']); par.append(row['par']); wind.append(row['wind_ms']); temp.append(row['wtemp_c'])
        h += 1
        if h == 24:
            h = 0
            d = d + timedelta(days=1)
    return do, par, wind, temp


def fit_ols(DO, PAR, WIND, TEMP):
    n = len(DO) - 1
    X, y = [], []
    for i in range(n):
        sat = do_sat(TEMP[i])
        X.append([PAR[i], -1.0, WIND[i] * (sat - DO[i])])
        y.append(DO[i + 1] - DO[i])
    A = [[sum(X[k][i] * X[k][j] for k in range(n)) for j in range(3)] for i in range(3)]
    b = [sum(X[k][i] * y[k] for k in range(n)) for i in range(3)]
    return solve_n(A, b)


def solve_n(A, b):
    n = len(b)
    M = [row[:] + [b[i]] for i, row in enumerate(A)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(M[r][col]))
        M[col], M[pivot] = M[pivot], M[col]
        piv = M[col][col]
        if abs(piv) < 1e-14:
            return None
        for r in range(col + 1, n):
            factor = M[r][col] / piv
            for c in range(col, n + 1):
                M[r][c] -= factor * M[col][c]
    x = [0.0] * n
    for i in range(n - 1, -1, -1):
        s = M[i][n] - sum(M[i][j] * x[j] for j in range(i + 1, n))
        x[i] = s / M[i][i]
    return x


def fit_alpha_R_given_K(DO, PAR, WIND, TEMP, K, weights=None):
    n = len(DO) - 1
    Xr, yr = [], []
    for i in range(n):
        sat = do_sat(TEMP[i])
        Xr.append([PAR[i], -1.0])
        yr.append(DO[i + 1] - DO[i] - K * WIND[i] * (sat - DO[i]))
    w = weights if weights is not None else [1.0] * n
    a11 = sum(w[i] * Xr[i][0] * Xr[i][0] for i in range(n)); a12 = sum(w[i] * Xr[i][0] * Xr[i][1] for i in range(n))
    a22 = sum(w[i] * Xr[i][1] * Xr[i][1] for i in range(n))
    b1 = sum(w[i] * Xr[i][0] * yr[i] for i in range(n)); b2 = sum(w[i] * Xr[i][1] * yr[i] for i in range(n))
    det = a11 * a22 - a12 * a12
    if abs(det) < 1e-18:
        return None
    return (b1 * a22 - b2 * a12) / det, (a11 * b2 - a12 * b1) / det


def fit_mle(DO, PAR, WIND, TEMP):
    n = len(DO) - 1

    def simulate(alpha, R, K):
        sim = [DO[0]]
        for i in range(n):
            sat = do_sat(TEMP[i])
            sim.append(sim[-1] + alpha * PAR[i] - R + K * WIND[i] * (sat - sim[-1]))
        return sim

    def traj_sse(K):
        fit = fit_alpha_R_given_K(DO, PAR, WIND, TEMP, K)
        if fit is None:
            return math.inf, 0, 0
        a_, r_ = fit
        sim = simulate(a_, r_, K)
        return sum((s - o) ** 2 for s, o in zip(sim, DO)), a_, r_

    lo, hi = 0.0, 0.02
    gr = (5 ** 0.5 - 1) / 2
    c = hi - gr * (hi - lo); fcand = lo + gr * (hi - lo)
    fc = traj_sse(c)[0]; ffcand = traj_sse(fcand)[0]
    for _ in range(40):
        if fc < ffcand:
            hi, fcand, ffcand = fcand, c, fc
            c = hi - gr * (hi - lo)
            fc = traj_sse(c)[0]
        else:
            lo, c, fc = c, fcand, ffcand
            fcand = lo + gr * (hi - lo)
            ffcand = traj_sse(fcand)[0]
    K_mle = (lo + hi) / 2
    _, a_mle, r_mle = traj_sse(K_mle)
    return a_mle, r_mle, K_mle


def kalman_loglik(DO, PAR, WIND, TEMP, alpha, R, K, Q):
    n = len(DO) - 1
    x = DO[0]; P = Hobs; ll = 0.0
    for i in range(n):
        sat = do_sat(TEMP[i])
        x_pred = x + alpha * PAR[i] - R + K * WIND[i] * (sat - x)
        F = 1 - K * WIND[i]
        P_pred = F * F * P + Q
        innov = DO[i + 1] - x_pred
        S = P_pred + Hobs
        if S <= 0:
            return -math.inf
        ll += -0.5 * (math.log(2 * math.pi * S) + innov * innov / S)
        Kg = P_pred / S
        x = x_pred + Kg * innov
        P = (1 - Kg) * P_pred
    return ll


def fit_kalman(DO, PAR, WIND, TEMP, alpha0, R0, K0):
    n = len(DO) - 1
    K_kf, Q_kf, alpha_kf, R_kf = K0, 0.01 ** 2, alpha0, R0
    for _ in range(3):
        # weighted refit of alpha,R using current K,Q (single reweighting pass)
        x, P, weights = DO[0], Hobs, []
        for i in range(n):
            sat = do_sat(TEMP[i])
            F = 1 - K_kf * WIND[i]
            P_pred = F * F * P + Q_kf
            S = P_pred + Hobs
            weights.append(1.0 / S if S > 0 else 1.0)
            Kg = P_pred / S if S > 0 else 0
            P = (1 - Kg) * P_pred
        fit = fit_alpha_R_given_K(DO, PAR, WIND, TEMP, K_kf, weights)
        if fit is None:
            break
        alpha_kf, R_kf = fit
        best = None
        for K_try in [K_kf * f for f in (0.7, 0.85, 1.0, 1.15, 1.3)]:
            for Q_try in [Q_kf * f for f in (0.3, 0.6, 1.0, 1.6, 2.5)] + [1e-6]:
                ll = kalman_loglik(DO, PAR, WIND, TEMP, alpha_kf, R_kf, K_try, Q_try)
                if best is None or ll > best[0]:
                    best = (ll, K_try, Q_try)
        K_kf, Q_kf = best[1], best[2]
    return alpha_kf, R_kf, K_kf, Q_kf


BOUNDS = {'alpha': (0.0, 5e-4), 'R': (0.0, 0.2), 'K': (0.0, 0.02), 'Q': (1e-6, 0.05)}


def clip(v, lo, hi):
    return max(lo, min(hi, v))


def fit_bayesian(DO, PAR, WIND, TEMP, alpha0, R0, K0, Q0, n_iter=3000, burn=800, seed=0):
    rng = random.Random(seed)

    def log_post(theta):
        for k, v in theta.items():
            lo, hi = BOUNDS[k]
            if not (lo <= v <= hi):
                return -math.inf
        return kalman_loglik(DO, PAR, WIND, TEMP, theta['alpha'], theta['R'], theta['K'], theta['Q'])

    step = {'alpha': 1.6e-5, 'R': 0.018, 'K': 0.0018, 'Q': 0.006}
    theta = {'alpha': alpha0, 'R': R0, 'K': K0, 'Q': Q0}
    cur_lp = log_post(theta)
    samples = {k: [] for k in theta}
    keys = list(theta.keys())
    for it in range(n_iter):
        prop = dict(theta)
        key = keys[it % len(keys)]
        prop[key] = theta[key] + rng.gauss(0, step[key])
        prop_lp = log_post(prop)
        if math.log(rng.random() + 1e-300) < (prop_lp - cur_lp):
            theta, cur_lp = prop, prop_lp
        if it >= burn:
            for k in theta:
                samples[k].append(theta[k])
    return samples


def summarize(vals):
    vs = sorted(vals); n_ = len(vs)
    return sum(vs) / n_, vs[int(0.025 * n_)], vs[int(0.975 * n_)]


def fit_all_methods(day):
    win = get_window(day, 48)
    if win is None:
        return None
    DO, PAR, WIND, TEMP = win
    day_par = PAR[:24]  # day's own PAR values for computing that day's GPP

    # Every point estimate below is clipped to >=0 for alpha/R (negative light
    # response or negative respiration isn't physically meaningful - it's a
    # known failure mode of unconstrained regression on a noisy/ill-posed
    # day) and K is clipped into its search range (an ill-conditioned day can
    # otherwise send the Kalman search compounding past any sensible bound).
    ols = fit_ols(DO, PAR, WIND, TEMP)
    if ols is None:
        return None
    a_ols, r_ols, k_ols = ols
    a_ols, r_ols, k_ols = clip(a_ols, *BOUNDS['alpha']), clip(r_ols, *BOUNDS['R']), clip(k_ols, *BOUNDS['K'])
    gpp_ols = sum(max(a_ols * p, 0) for p in day_par)
    er_ols = r_ols * 24

    a_mle, r_mle, k_mle = fit_mle(DO, PAR, WIND, TEMP)
    a_mle, r_mle, k_mle = clip(a_mle, *BOUNDS['alpha']), clip(r_mle, *BOUNDS['R']), clip(k_mle, *BOUNDS['K'])
    gpp_mle = sum(max(a_mle * p, 0) for p in day_par)
    er_mle = r_mle * 24

    a_kf, r_kf, k_kf, q_kf = fit_kalman(DO, PAR, WIND, TEMP, a_mle, r_mle, k_mle)
    a_kf, r_kf, k_kf = clip(a_kf, *BOUNDS['alpha']), clip(r_kf, *BOUNDS['R']), clip(k_kf, *BOUNDS['K'])
    q_kf = clip(q_kf, *BOUNDS['Q'])
    gpp_kf = sum(max(a_kf * p, 0) for p in day_par)
    er_kf = r_kf * 24

    # Bayesian's own prior already restricts every parameter to BOUNDS, but
    # the chain still needs to *start* inside them, or the first several
    # acceptance ratios compare -inf to -inf (NaN in IEEE arithmetic, which
    # every comparison treats as false) and the chain can sit motionless for
    # a long time before a lucky proposal wanders back into bounds.
    samples = fit_bayesian(DO, PAR, WIND, TEMP, a_kf, r_kf, k_kf, q_kf, seed=hash(day.isoformat()) % (2**31))
    gpp_samples = [sum(max(a * p, 0) for p in day_par) for a in samples['alpha']]
    er_samples = [r * 24 for r in samples['R']]
    gpp_bayes = summarize(gpp_samples)
    er_bayes = summarize(er_samples)

    return {
        'gpp_ols': gpp_ols, 'er_ols': er_ols,
        'gpp_mle': gpp_mle, 'er_mle': er_mle,
        'gpp_kf': gpp_kf, 'er_kf': er_kf,
        'gpp_bayes': gpp_bayes[0], 'gpp_bayes_lo': gpp_bayes[1], 'gpp_bayes_hi': gpp_bayes[2],
        'er_bayes': er_bayes[0], 'er_bayes_lo': er_bayes[1], 'er_bayes_hi': er_bayes[2],
    }


def run_full_season():
    days = [START + timedelta(days=i) for i in range((END - START).days + 1)]
    results = []
    t0 = time.time()
    n_ok = 0
    for i, d in enumerate(days):
        r = fit_all_methods(d)
        results.append({'date': d.isoformat(), **(r or {})})
        if r is not None:
            n_ok += 1
        if (i + 1) % 50 == 0:
            print(f'{i+1}/{len(days)} days done, {time.time()-t0:.1f}s elapsed')
    print(f'total: {time.time()-t0:.1f}s, {n_ok}/{len(days)} days with a full fit')

    # 7-day rolling median, same treatment as bookkeeping already gets
    def rolling_median(key, window=7):
        half = window // 2
        out = []
        for i in range(len(results)):
            lo, hi = max(0, i - half), min(len(results), i + half + 1)
            vals = sorted(v for v in (results[j].get(key) for j in range(lo, hi)) if v is not None)
            if len(vals) >= 3:
                mid = len(vals) // 2
                out.append(vals[mid] if len(vals) % 2 else (vals[mid - 1] + vals[mid]) / 2)
            else:
                out.append(None)
        return out

    for method in ['ols', 'mle', 'kf', 'bayes']:
        gpp_s = rolling_median(f'gpp_{method}')
        er_s = rolling_median(f'er_{method}')
        for i, r in enumerate(results):
            r[f'gpp_{method}_smooth'] = round(gpp_s[i], 3) if gpp_s[i] is not None else None
            r[f'er_{method}_smooth'] = round(er_s[i], 3) if er_s[i] is not None else None
            r[f'nep_{method}_smooth'] = (
                round(gpp_s[i] - er_s[i], 3) if None not in (gpp_s[i], er_s[i]) else None
            )

    # round the raw per-day values too
    for r in results:
        for k in list(r.keys()):
            if isinstance(r[k], float):
                r[k] = round(r[k], 4)

    # merge into the existing seasonal file (produced by build_seasonal.py)
    # by date, rather than shipping a second JSON file the frontend would
    # have to fetch and join itself.
    with open('mendota_seasonal.json') as f:
        seasonal = json.load(f)
    by_date = {r['date']: r for r in results}
    # Only the smoothed series - the frontend never charts the raw per-day
    # values (same as bookkeeping's own gpp/er, which are computed but only
    # gpp_smooth/er_smooth ever get plotted), so there's no reason to ship
    # the noisier raw numbers to the browser.
    method_keys = [f'{stat}_{m}_smooth' for m in ('ols', 'mle', 'kf', 'bayes') for stat in ('gpp', 'er', 'nep')]
    for day in seasonal['daily']:
        extra = by_date.get(day['date'], {})
        for k in method_keys:
            day[k] = extra.get(k)
    seasonal['source']['methods'] = (
        'GPP/ER also estimated via OLS, MLE (light-curve trajectory fit), a Kalman filter, and Bayesian '
        '(Metropolis-Hastings MCMC) versions of the same 3-process model used in Modules 3/4, fit per day on a '
        '48-hour window (that day plus the next), then 7-day rolling-median smoothed like bookkeeping. See '
        'scripts/build_seasonal_methods.py.'
    )
    with open('mendota_seasonal.json', 'w') as f:
        json.dump(seasonal, f, indent=2)
    print('merged method results into mendota_seasonal.json')


if __name__ == '__main__':
    run_full_season()
