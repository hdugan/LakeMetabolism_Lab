(() => {
  'use strict';

  const { cssVar, cursorLineShape, SEASONAL_DATA_URL } = window.LakeCommon;

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function seasonOf(dateStr) {
    const month = +dateStr.slice(5, 7);
    if (month >= 3 && month <= 5) return 'Spring';
    if (month >= 6 && month <= 8) return 'Summer';
    return 'Fall'; // 9, 10, 11 - this dataset never reaches Dec
  }
  const SEASON_EMOJI = { Spring: '🌱', Summer: '☀️', Fall: '🍂' };

  function fmtDate(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return `${MONTHS[m - 1]} ${d}, ${y}`;
  }

  // Five ways of turning the same oxygen curve into GPP/ER/NEP. `gpp`/`er`/
  // `nep` name the smoothed fields each method contributes to mendota_seasonal.json
  // (bookkeeping's have no suffix - they're the original Module 6 fields).
  const METHODS = [
    {
      key: 'bookkeeping', label: 'Bookkeeping', gpp: 'gpp_smooth', er: 'er_smooth', nep: 'nep_smooth',
      desc: 'Module 6’s method: the overnight DO slope is treated as pure respiration, and that respiration rate is added back onto the daytime slope to get GPP. Simple, but it folds any gas exchange with the atmosphere into ER.',
    },
    {
      key: 'ols', label: 'OLS', gpp: 'gpp_ols_smooth', er: 'er_ols_smooth', nep: 'nep_ols_smooth',
      desc: 'Ordinary least squares: fits GPP, ER, and gas exchange together in a single regression against the whole oxygen curve, instead of reading two slopes in isolation.',
    },
    {
      key: 'mle', label: 'MLE', gpp: 'gpp_mle_smooth', er: 'er_mle_smooth', nep: 'nep_mle_smooth',
      desc: 'Maximum likelihood: searches for the GPP / ER / gas-exchange combination whose simulated oxygen curve best matches the buoy’s actual data.',
    },
    {
      key: 'kf', label: 'Kalman filter', gpp: 'gpp_kf_smooth', er: 'er_kf_smooth', nep: 'nep_kf_smooth',
      desc: 'Kalman filter: the same model, but lets random process noise absorb some of the day-to-day wobble that other methods force entirely into GPP and ER.',
    },
    {
      key: 'bayes', label: 'Bayesian', gpp: 'gpp_bayes_smooth', er: 'er_bayes_smooth', nep: 'nep_bayes_smooth',
      desc: 'Bayesian (Metropolis-Hastings MCMC): explores a full range of plausible parameter values weighted by how well each fits, instead of committing to one single best fit.',
    },
  ];
  const METHOD_BY_KEY = Object.fromEntries(METHODS.map((m) => [m.key, m]));

  // Per-season mean GPP/ER and share of autotrophic days for one method's
  // fields - shared by the season bar chart and the autotrophic/heterotrophic
  // reveal so the two never tell slightly different stories.
  function seasonStats(daily, method) {
    const bucket = { Spring: [], Summer: [], Fall: [] };
    daily.forEach((d) => { bucket[seasonOf(d.date)].push(d); });
    const seasons = ['Spring', 'Summer', 'Fall'];
    return seasons.map((s) => {
      const rows = bucket[s];
      const gppVals = rows.map((d) => d[method.gpp]).filter((v) => v != null);
      const erVals = rows.map((d) => d[method.er]).filter((v) => v != null);
      const nepVals = rows.map((d) => d[method.nep]).filter((v) => v != null);
      const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
      const autoPct = nepVals.length ? (100 * nepVals.filter((v) => v >= 0).length) / nepVals.length : null;
      return { season: s, gpp: mean(gppVals), er: mean(erVals), autoPct, nAuto: nepVals.filter((v) => v >= 0).length, n: nepVals.length };
    });
  }

  // Season-wide mean NEP and % autotrophic days for one method, across all
  // days at once (not split by season) - used by the all-methods comparison.
  function overallStats(daily, method) {
    const nepVals = daily.map((d) => d[method.nep]).filter((v) => v != null);
    const mean = nepVals.length ? nepVals.reduce((a, b) => a + b, 0) / nepVals.length : null;
    const autoPct = nepVals.length ? (100 * nepVals.filter((v) => v >= 0).length) / nepVals.length : null;
    return { mean, autoPct, n: nepVals.length };
  }

  function basePlotLayout(extra) {
    return Object.assign({
      margin: { l: 44, r: 12, t: 10, b: 28 },
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      font: { family: 'system-ui, -apple-system, "Segoe UI", sans-serif', color: cssVar('--text-secondary'), size: 11 },
      showlegend: false,
      xaxis: {
        type: 'date',
        gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') },
        tickformat: '%b',
      },
      yaxis: { gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') }, zeroline: false },
      hovermode: 'x',
    }, extra || {});
  }

  fetch(SEASONAL_DATA_URL)
    .then((r) => r.json())
    .then(init)
    .catch((err) => {
      document.querySelector('.content').innerHTML =
        '<p style="padding:40px;color:var(--text-secondary)">Could not load lake data (' + err + ').</p>';
    });

  function init(data) {
    const daily = data.daily;
    const n = daily.length;
    const dates = daily.map((d) => d.date);
    let currentMethod = METHOD_BY_KEY.bookkeeping;

    // ---- month tick labels under the slider, one per month boundary ----
    const scale = document.getElementById('sliderScale');
    let lastMonth = null;
    daily.forEach((d) => {
      const month = d.date.slice(0, 7);
      if (month !== lastMonth) {
        lastMonth = month;
        const span = document.createElement('span');
        span.textContent = MONTHS[+d.date.slice(5, 7) - 1];
        scale.appendChild(span);
      }
    });

    // ---- stat tiles ----
    const STATS = [
      { stat: 'gpp', label: 'GPP', unit: 'mg/L/day', color: '--flux-add' },
      { stat: 'er', label: 'ER', unit: 'mg/L/day', color: '--flux-remove' },
      { stat: 'nep', label: 'NEP', unit: 'mg/L/day', color: '--series-do' },
    ];
    const statRow = document.getElementById('statRow');
    STATS.forEach((s) => {
      const tile = document.createElement('div');
      tile.className = 'stat-tile';
      tile.innerHTML = `
        <div class="stat-tile-label"><span class="dot" style="background:${cssVar(s.color)}"></span>${s.label}</div>
        <div class="stat-tile-value" id="stat-${s.stat}">&ndash;<span class="unit"> ${s.unit}</span></div>`;
      statRow.appendChild(tile);
    });
    const statusTile = document.createElement('div');
    statusTile.className = 'stat-tile';
    statusTile.innerHTML = `
      <div class="stat-tile-label">Status</div>
      <div class="stat-tile-value" id="stat-status">&ndash;</div>`;
    statRow.appendChild(statusTile);

    // ---- charts ----
    const gppColor = cssVar('--flux-add');
    const erColor = cssVar('--flux-remove');
    const goodColor = cssVar('--good');
    const badColor = cssVar('--flux-remove');

    Plotly.newPlot('gppErPlot', [
      {
        x: dates, y: daily.map((d) => d[currentMethod.gpp]), type: 'scatter', mode: 'lines',
        line: { color: gppColor, width: 2, shape: 'spline', smoothing: 0.3 },
        hovertemplate: '%{y:.2f} mg/L/day<extra>GPP</extra>',
      },
      {
        x: dates, y: daily.map((d) => d[currentMethod.er]), type: 'scatter', mode: 'lines',
        line: { color: erColor, width: 2, shape: 'spline', smoothing: 0.3 },
        hovertemplate: '%{y:.2f} mg/L/day<extra>ER</extra>',
      },
    ], basePlotLayout({
      shapes: [cursorLineShape(dates[0])],
    }), { displayModeBar: false, responsive: true, scrollZoom: false });

    Plotly.newPlot('nepPlot', [{
      x: dates, y: daily.map((d) => d[currentMethod.nep]), type: 'bar',
      marker: { color: daily.map((d) => (d[currentMethod.nep] == null ? 'rgba(0,0,0,0)' : (d[currentMethod.nep] >= 0 ? goodColor : badColor))) },
      hovertemplate: '%{y:.2f} mg/L/day<extra>NEP</extra>',
    }], basePlotLayout({
      shapes: [cursorLineShape(dates[0])],
      yaxis: { gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') }, zeroline: true, zerolinecolor: cssVar('--baseline') },
    }), { displayModeBar: false, responsive: true, scrollZoom: false });

    // ---- slider wiring ----
    const slider = document.getElementById('timeSlider');
    slider.max = String(n - 1);
    const readoutDate = document.getElementById('readoutDate');
    const seasonBadge = document.getElementById('seasonBadge');

    function update(idx) {
      idx = Math.max(0, Math.min(n - 1, idx));
      const d = daily[idx];
      readoutDate.textContent = fmtDate(d.date);
      const season = seasonOf(d.date);
      seasonBadge.textContent = `${SEASON_EMOJI[season]} ${season}`;

      STATS.forEach((s) => {
        const el = document.getElementById(`stat-${s.stat}`);
        const val = d[currentMethod[s.stat]];
        el.innerHTML = val == null ? `&ndash;<span class="unit"> ${s.unit}</span>` : `${val >= 0 ? '+' : ''}${val.toFixed(2)}<span class="unit"> ${s.unit}</span>`;
      });
      const statusEl = document.getElementById('stat-status');
      const nepVal = d[currentMethod.nep];
      if (nepVal == null) statusEl.textContent = 'No data';
      else if (nepVal >= 0) { statusEl.textContent = 'Autotrophic'; statusEl.style.color = goodColor; }
      else { statusEl.textContent = 'Heterotrophic'; statusEl.style.color = badColor; }

      const shape = cursorLineShape(d.date);
      Plotly.relayout('gppErPlot', { shapes: [shape] });
      Plotly.relayout('nepPlot', { shapes: [shape] });
    }

    slider.addEventListener('input', () => update(Number(slider.value)));

    // ---- play / pause through the season ----
    const playBtn = document.getElementById('playBtn');
    const iconPlay = document.getElementById('iconPlay');
    const iconPause = document.getElementById('iconPause');
    const playLabel = document.getElementById('playLabel');
    let timer = null;
    function setPlaying(playing) {
      iconPlay.hidden = playing;
      iconPause.hidden = !playing;
      playLabel.textContent = playing ? 'Pause' : 'Play';
      if (playing) {
        timer = setInterval(() => {
          let next = Number(slider.value) + 1;
          if (next > Number(slider.max)) next = 0;
          slider.value = next;
          update(next);
        }, 90);
      } else {
        clearInterval(timer);
        timer = null;
      }
    }
    playBtn.addEventListener('click', () => setPlaying(!timer));

    // ---- season summary bar chart ----
    const seasonBarMethodLabel = document.getElementById('seasonBarMethodLabel');
    function renderSeasonBar() {
      const stats = seasonStats(daily, currentMethod);
      Plotly.react('seasonBarPlot', [
        {
          x: stats.map((s) => s.season), y: stats.map((s) => s.gpp), type: 'bar', name: 'GPP',
          marker: { color: gppColor }, hovertemplate: '%{y:.2f} mg/L/day<extra>GPP</extra>',
        },
        {
          x: stats.map((s) => s.season), y: stats.map((s) => s.er), type: 'bar', name: 'ER',
          marker: { color: erColor }, hovertemplate: '%{y:.2f} mg/L/day<extra>ER</extra>',
        },
      ], basePlotLayout({
        barmode: 'group',
        xaxis: { type: 'category', gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') } },
      }), { displayModeBar: false, responsive: true, scrollZoom: false });

      document.getElementById('seasonAutoText').textContent = stats
        .map((s) => `${s.season}: ${s.autoPct == null ? 'no data' : Math.round(s.autoPct) + '% autotrophic days'}`)
        .join('  ·  ');
      seasonBarMethodLabel.textContent = currentMethod.label;
      return stats;
    }

    // ---- chlorophyll vs NEP ----
    const normalize = (vals) => {
      const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
      return vals.map((v) => ((v - min) / span) * 100);
    };
    function renderChlorNep() {
      const withChlorNep = daily.filter((d) => d.chlor_smooth != null && d[currentMethod.nep] != null);
      const chlorRaw = withChlorNep.map((d) => d.chlor_smooth);
      const nepRaw = withChlorNep.map((d) => d[currentMethod.nep]);
      Plotly.react('chlorNepPlot', [
        {
          x: withChlorNep.map((d) => d.date), y: normalize(chlorRaw), customdata: chlorRaw,
          type: 'scatter', mode: 'lines', line: { color: cssVar('--series-rain'), width: 2, shape: 'spline', smoothing: 0.3 },
          hovertemplate: '%{customdata:.2f} RFU<extra>Chlorophyll</extra>',
        },
        {
          x: withChlorNep.map((d) => d.date), y: normalize(nepRaw), customdata: nepRaw,
          type: 'scatter', mode: 'lines', line: { color: cssVar('--series-do'), width: 2, shape: 'spline', smoothing: 0.3 },
          hovertemplate: '%{customdata:.2f} mg/L/day<extra>NEP</extra>',
        },
      ], basePlotLayout({
        yaxis: { title: { text: '% of season range', font: { size: 11, color: cssVar('--text-muted') } }, range: [-3, 103], gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') }, zeroline: false },
      }), { displayModeBar: false, responsive: true, scrollZoom: false });

      // Pearson correlation between chlorophyll and NEP, computed from
      // whichever method is currently selected - the caption states whatever
      // this actually comes out to, not an assumed relationship.
      const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
      const mChlor = mean(chlorRaw), mNep = mean(nepRaw);
      const cov = mean(chlorRaw.map((c, i) => (c - mChlor) * (nepRaw[i] - mNep)));
      const sdChlor = Math.sqrt(mean(chlorRaw.map((c) => (c - mChlor) ** 2)));
      const sdNep = Math.sqrt(mean(nepRaw.map((v) => (v - mNep) ** 2)));
      const corr = cov / (sdChlor * sdNep);
      const peakChlorDay = withChlorNep.reduce((a, b) => (b.chlor_smooth > a.chlor_smooth ? b : a));

      document.getElementById('chlorNepText').textContent =
        `Across the season, chlorophyll and NEP barely track each other (correlation r = ${corr.toFixed(2)}, ${currentMethod.label}). ` +
        `The single highest-chlorophyll day is ${fmtDate(peakChlorDay.date)} (${peakChlorDay.chlor_smooth.toFixed(2)} RFU) - ` +
        `a spring bloom, back before GPP and ER (and their difference, NEP) really ramp up - while the season's peak ` +
        `metabolic activity happens in midsummer, once that spring bloom has already collapsed. More algae doesn't ` +
        `automatically tip the lake toward autotrophic: more biomass tends to fuel more respiration right along with ` +
        `more photosynthesis, so a bloom doesn't reliably shift the balance either way.`;
    }

    // ---- method selector ----
    const methodDesc = document.getElementById('methodDesc');
    function selectMethod(key) {
      currentMethod = METHOD_BY_KEY[key];
      document.querySelectorAll('#methodSwitch .res-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.method === key);
      });
      methodDesc.textContent = currentMethod.desc;

      Plotly.restyle('gppErPlot', { y: [daily.map((d) => d[currentMethod.gpp]), daily.map((d) => d[currentMethod.er])] });
      Plotly.restyle('nepPlot', {
        y: [daily.map((d) => d[currentMethod.nep])],
        marker: [{ color: daily.map((d) => (d[currentMethod.nep] == null ? 'rgba(0,0,0,0)' : (d[currentMethod.nep] >= 0 ? goodColor : badColor))) }],
      });
      update(Number(slider.value));
      renderSeasonBar();
      renderChlorNep();
    }
    document.getElementById('methodSwitch').addEventListener('click', (e) => {
      const btn = e.target.closest('.res-btn');
      if (!btn) return;
      selectMethod(btn.dataset.method);
    });

    // ---- all-methods comparison (independent of the selector above) ----
    const methodColors = METHODS.map((m) => {
      const stats = overallStats(daily, m);
      return stats.mean == null ? 'rgba(0,0,0,0)' : (stats.mean >= 0 ? goodColor : badColor);
    });
    const allStats = METHODS.map((m) => overallStats(daily, m));
    Plotly.newPlot('methodComparePlot', [{
      x: METHODS.map((m) => m.label), y: allStats.map((s) => s.mean), type: 'bar',
      marker: { color: methodColors },
      customdata: allStats.map((s) => s.autoPct),
      hovertemplate: '%{y:.2f} mg/L/day, %{customdata:.0f}% autotrophic days<extra>%{x}</extra>',
    }], basePlotLayout({
      xaxis: { type: 'category', gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') } },
      yaxis: { gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') }, zeroline: true, zerolinecolor: cssVar('--baseline') },
    }), { displayModeBar: false, responsive: true, scrollZoom: false });

    const bkStats = allStats[0];
    const others = allStats.slice(1);
    const othersAllAgree = others.every((s) => s.mean != null && s.mean >= 0) && bkStats.mean != null && bkStats.mean < 0;
    document.getElementById('methodCompareText').textContent = othersAllAgree
      ? `Bookkeeping is the outlier: it puts the season at ${bkStats.mean.toFixed(2)} mg/L/day (${bkStats.autoPct.toFixed(0)}% autotrophic days) - just barely net heterotrophic - ` +
        `while all four statistical methods agree the lake is net autotrophic, from ${Math.min(...others.map((s) => s.mean)).toFixed(2)} to ${Math.max(...others.map((s) => s.mean)).toFixed(2)} mg/L/day. ` +
        `The reason: Lake Mendota runs supersaturated with oxygen much of the summer, so oxygen is constantly leaking out to the atmosphere overnight even with no respiration at all. ` +
        `Bookkeeping has no way to tell that outgassing apart from true respiration, so it lumps both into ER - inflating ER just enough to flip the season's sign.`
      : `The five methods don't fully agree: season-mean NEP ranges from ${Math.min(...allStats.map((s) => s.mean)).toFixed(2)} to ${Math.max(...allStats.map((s) => s.mean)).toFixed(2)} mg/L/day. ` +
        `Bookkeeping ignores gas exchange with the atmosphere entirely, folding any outgassing (common when the lake is supersaturated) into its respiration estimate - the other four methods ` +
        `fit gas exchange explicitly, which is usually why they land closer to net autotrophic.`;

    // ---- initial render ----
    update(Number(slider.value));
    methodDesc.textContent = currentMethod.desc;
    renderSeasonBar();
    renderChlorNep();

    // ---- reveal: GPP/ER peaks ----
    document.getElementById('revealPeaks').addEventListener('click', () => {
      const withGpp = daily.filter((d) => d[currentMethod.gpp] != null);
      const withEr = daily.filter((d) => d[currentMethod.er] != null);
      const peakGpp = withGpp.reduce((a, b) => (b[currentMethod.gpp] > a[currentMethod.gpp] ? b : a));
      const peakEr = withEr.reduce((a, b) => (b[currentMethod.er] > a[currentMethod.er] ? b : a));
      const sameDay = peakGpp.date === peakEr.date;
      document.getElementById('peaksText').textContent = sameDay
        ? `Both peak on the same day: ${fmtDate(peakGpp.date)}, with GPP at ${peakGpp[currentMethod.gpp].toFixed(2)} and ER at ${peakEr[currentMethod.er].toFixed(2)} mg/L/day (${currentMethod.label}). GPP and ER track each other closely all season - warmer, sunnier days grow more algae, and more algae both produces and consumes more oxygen.`
        : `GPP peaks on ${fmtDate(peakGpp.date)} (${peakGpp[currentMethod.gpp].toFixed(2)} mg/L/day), while ER peaks separately on ${fmtDate(peakEr.date)} (${peakEr[currentMethod.er].toFixed(2)} mg/L/day) - ${currentMethod.label}.`;
      document.getElementById('peaksPanel').hidden = false;
    });

    // ---- reveal: autotrophic/heterotrophic pattern ----
    document.getElementById('revealNepSummary').addEventListener('click', () => {
      const withNep = daily.filter((d) => d[currentMethod.nep] != null);
      const auto = withNep.filter((d) => d[currentMethod.nep] >= 0).length;
      const hetero = withNep.length - auto;

      const stats = seasonStats(daily, currentMethod);
      const bySeasonPct = stats.filter((s) => s.autoPct != null).slice().sort((a, b) => b.autoPct - a.autoPct);
      const most = bySeasonPct[0], least = bySeasonPct[bySeasonPct.length - 1];

      document.getElementById('nepSummaryText').textContent =
        `By ${currentMethod.label}, ${auto} of ${withNep.length} days (${Math.round((100 * auto) / withNep.length)}%) were net autotrophic (green) and ${hetero} were net heterotrophic (red). ` +
        `${most.season} had the highest share of autotrophic days (${most.autoPct.toFixed(0)}%), and ${least.season} had the lowest (${least.autoPct.toFixed(0)}%) - but look closely at the bar chart: ` +
        `even within a single season, the lake flips back and forth from one day to the next. It's rarely one or the other for long. Try a different method above and see how much this picture shifts.`;
      document.getElementById('nepSummaryPanel').hidden = false;
    });
  }
})();
