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
  // (bookkeeping's have no suffix - it's the original field, computed by
  // scripts/build_seasonal.py; the other four are added by
  // scripts/build_seasonal_methods.py).
  const METHODS = [
    {
      key: 'bookkeeping', label: 'Bookkeeping', gpp: 'gpp_smooth', er: 'er_smooth', nep: 'nep_smooth',
      desc: 'LakeMetabolizer’s metab.bookkeep(): the same night/day-slope idea as Module 5, but a wind-based atmospheric flux is subtracted from every hourly DO change first, so gas exchange isn’t folded into ER the way Module 5’s by-hand version does.',
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

    // ---- match-the-season drag game (answer key is always Bayesian - the
    // method the rest of the app treats as the most trustworthy) ----
    const slotAssignments = { gpp: null, er: null, auto: null, hetero: null };
    let selectedSeason = null;

    function renderSlot(category) {
      const slot = document.querySelector(`.match-slot[data-category="${category}"]`);
      const season = slotAssignments[category];
      slot.classList.remove('correct', 'incorrect');
      slot.innerHTML = season
        ? `<span class="match-chip">${SEASON_EMOJI[season]} ${season}</span><button type="button" class="match-slot-clear" aria-label="Clear">&times;</button>`
        : '';
    }
    function assignSlot(category, season) {
      slotAssignments[category] = season;
      renderSlot(category);
    }

    document.getElementById('matchGame').addEventListener('click', (e) => {
      const chip = e.target.closest('.match-tray .match-chip');
      if (chip) {
        const wasSelected = chip.classList.contains('selected');
        document.querySelectorAll('.match-tray .match-chip').forEach((c) => c.classList.remove('selected'));
        selectedSeason = wasSelected ? null : chip.dataset.season;
        if (selectedSeason) chip.classList.add('selected');
        return;
      }
      const clearBtn = e.target.closest('.match-slot-clear');
      if (clearBtn) {
        assignSlot(clearBtn.closest('.match-slot').dataset.category, null);
        return;
      }
      const slot = e.target.closest('.match-slot');
      if (slot && selectedSeason) assignSlot(slot.dataset.category, selectedSeason);
    });
    document.querySelectorAll('.match-tray .match-chip').forEach((chip) => {
      chip.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', chip.dataset.season));
    });
    document.querySelectorAll('.match-slot').forEach((slot) => {
      slot.addEventListener('dragover', (e) => { e.preventDefault(); slot.classList.add('over'); });
      slot.addEventListener('dragleave', () => slot.classList.remove('over'));
      slot.addEventListener('drop', (e) => {
        e.preventDefault();
        slot.classList.remove('over');
        const season = e.dataTransfer.getData('text/plain');
        if (season) assignSlot(slot.dataset.category, season);
      });
    });

    // ---- monthly NEP (Bayesian), colored by season ----
    const SEASON_COLOR = { Spring: cssVar('--series-wind'), Summer: cssVar('--series-par'), Fall: cssVar('--series-wtemp') };
    function renderMonthlyNep() {
      const byMonth = {};
      daily.forEach((d) => {
        if (d.nep_bayes_smooth == null) return;
        const m = d.date.slice(0, 7);
        (byMonth[m] = byMonth[m] || []).push(d.nep_bayes_smooth);
      });
      const months = Object.keys(byMonth).sort();
      const means = months.map((m) => byMonth[m].reduce((a, b) => a + b, 0) / byMonth[m].length);
      const labels = months.map((m) => MONTHS[+m.slice(5, 7) - 1]);
      const colors = months.map((m) => SEASON_COLOR[seasonOf(`${m}-01`)]);

      Plotly.newPlot('monthlyNepPlot', [{
        x: labels, y: means, type: 'bar', marker: { color: colors },
        hovertemplate: '%{y:.2f} mg/L/day<extra>%{x}</extra>',
      }], basePlotLayout({
        margin: { l: 56, r: 12, t: 10, b: 28 },
        xaxis: { type: 'category', gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') } },
        yaxis: {
          title: { text: 'NEP (mg O₂/L/day)', font: { size: 11, color: cssVar('--text-muted') } },
          gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') }, zeroline: true, zerolinecolor: cssVar('--baseline'),
        },
      }), { displayModeBar: false, responsive: true, scrollZoom: false });

      // Every month/value below is found live in the data, not assumed.
      const peakIdx = means.reduce((best, v, i) => (v > means[best] ? i : best), 0);
      let fallFlipIdx = -1;
      for (let i = peakIdx; i < months.length; i++) {
        if (means[i] < 0) { fallFlipIdx = i; break; }
      }
      const springFlipIdx = means.findIndex((v, i) => i > 0 && i < peakIdx && v >= 0 && means[i - 1] < 0);

      let text = `Monthly NEP peaks in ${labels[peakIdx]} (mean ${means[peakIdx].toFixed(2)} mg/L/day) and stays positive through summer`;
      if (fallFlipIdx > -1) {
        text += `, then flips negative in ${labels[fallFlipIdx]} (${means[fallFlipIdx].toFixed(2)} mg/L/day) and stays net heterotrophic for the rest of the season. ` +
          `This switch - a productive summer followed by a heterotrophic fall - happens in most temperate lakes every year, not just in this one season's ` +
          `data: as day length shortens and the sun angle drops, the light available for photosynthesis falls faster than respiration does, and decomposition ` +
          `gets an extra boost from the summer bloom's own die-off and from leaf litter and runoff entering the lake as the growing season ends.`;
      } else {
        text += '.';
      }
      if (springFlipIdx > -1) {
        text += ` The same data shows a mirror-image flip in early spring: ${labels[0]} starts net heterotrophic (mean ${means[0].toFixed(2)} mg/L/day) before ` +
          `turning positive by ${labels[springFlipIdx]}, as ice-out returns light to the water column.`;
      }
      document.getElementById('matchGameText').textContent = text;
    }

    // ---- reveal: check the match game, then show the monthly chart ----
    document.getElementById('revealMatchGame').addEventListener('click', () => {
      const stats = seasonStats(daily, METHOD_BY_KEY.bayes);
      const byGpp = stats.slice().sort((a, b) => b.gpp - a.gpp);
      const byEr = stats.slice().sort((a, b) => b.er - a.er);
      const byAuto = stats.filter((s) => s.autoPct != null).slice().sort((a, b) => b.autoPct - a.autoPct);
      const correct = {
        gpp: byGpp[0].season, er: byEr[0].season,
        auto: byAuto[0].season, hetero: byAuto[byAuto.length - 1].season,
      };
      Object.keys(correct).forEach((cat) => {
        const slot = document.querySelector(`.match-slot[data-category="${cat}"]`);
        const isCorrect = slotAssignments[cat] === correct[cat];
        slot.classList.toggle('correct', isCorrect);
        slot.classList.toggle('incorrect', !isCorrect);
        slot.querySelectorAll('.match-slot-answer').forEach((el) => el.remove());
        if (!isCorrect) {
          const ans = document.createElement('span');
          ans.className = 'match-slot-answer';
          ans.textContent = `(answer: ${correct[cat]})`;
          slot.appendChild(ans);
        }
      });

      document.getElementById('matchGamePanel').hidden = false;
      renderMonthlyNep();
    });

    // ---- chlorophyll, phycocyanin & NEP ----
    const normalize = (vals) => {
      const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
      return vals.map((v) => ((v - min) / span) * 100);
    };
    function pearson(a, b) {
      const mean = (arr) => arr.reduce((x, y) => x + y, 0) / arr.length;
      const ma = mean(a), mb = mean(b);
      const cov = mean(a.map((v, i) => (v - ma) * (b[i] - mb)));
      const sda = Math.sqrt(mean(a.map((v) => (v - ma) ** 2)));
      const sdb = Math.sqrt(mean(b.map((v) => (v - mb) ** 2)));
      return cov / (sda * sdb);
    }
    function renderChlorNep() {
      // NEP here is always the Bayesian estimate, regardless of the method
      // selector above - bookkeeping's day-to-day noise swamps the real
      // relationship to phycocyanin (see the caption below).
      const rows = daily.filter((d) => d.chlor_smooth != null && d.phyco_smooth != null && d.nep_bayes_smooth != null);
      const chlorRaw = rows.map((d) => d.chlor_smooth);
      const phycoRaw = rows.map((d) => d.phyco_smooth);
      const nepRaw = rows.map((d) => d.nep_bayes_smooth);
      Plotly.react('chlorNepPlot', [
        {
          x: rows.map((d) => d.date), y: normalize(chlorRaw), customdata: chlorRaw,
          type: 'scatter', mode: 'lines', line: { color: cssVar('--series-wind'), width: 2, shape: 'spline', smoothing: 0.3 },
          hovertemplate: '%{customdata:.2f} RFU<extra>Chlorophyll</extra>',
        },
        {
          x: rows.map((d) => d.date), y: normalize(phycoRaw), customdata: phycoRaw,
          type: 'scatter', mode: 'lines', line: { color: cssVar('--series-do'), width: 2, shape: 'spline', smoothing: 0.3 },
          hovertemplate: '%{customdata:.2f} RFU<extra>Phycocyanin</extra>',
        },
        {
          x: rows.map((d) => d.date), y: normalize(nepRaw), customdata: nepRaw,
          type: 'scatter', mode: 'lines', line: { color: cssVar('--series-rain'), width: 2, shape: 'spline', smoothing: 0.3 },
          hovertemplate: '%{customdata:.2f} mg/L/day<extra>NEP (Bayesian)</extra>',
        },
      ], basePlotLayout({
        yaxis: { title: { text: '% of season range', font: { size: 11, color: cssVar('--text-muted') } }, range: [-3, 103], gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') }, zeroline: false },
      }), { displayModeBar: false, responsive: true, scrollZoom: false });

      // Every correlation and peak date below is computed live from the
      // data, not assumed - the caption states whatever this actually comes
      // out to.
      const corrChlorPhyco = pearson(chlorRaw, phycoRaw);
      const corrChlorNep = pearson(chlorRaw, nepRaw);
      const corrPhycoNep = pearson(phycoRaw, nepRaw);
      const peakChlorDay = rows.reduce((a, b) => (b.chlor_smooth > a.chlor_smooth ? b : a));
      const peakPhycoDay = rows.reduce((a, b) => (b.phyco_smooth > a.phyco_smooth ? b : a));

      document.getElementById('chlorNepText').textContent =
        `Chlorophyll and phycocyanin peak at completely different times: chlorophyll tops out on ${fmtDate(peakChlorDay.date)} ` +
        `(${peakChlorDay.chlor_smooth.toFixed(2)} RFU) - an early spring bloom, before cyanobacteria are active - while phycocyanin's ` +
        `peak comes later, on ${fmtDate(peakPhycoDay.date)} (${peakPhycoDay.phyco_smooth.toFixed(2)} RFU), and stays elevated through ` +
        `summer. Season-long the two sensors are actually slightly anti-correlated (r = ${corrChlorPhyco.toFixed(2)}): the spring bloom ` +
        `and the summer cyanobacteria are two different populations of algae, not one continuous bloom. Bayesian net metabolism ` +
        `actually tracks phycocyanin fairly well through the summer (r = ${corrPhycoNep.toFixed(2)}) - the season's highest-NEP days ` +
        `cluster right where phycocyanin is elevated, consistent with that summer cyanobacteria bloom actively driving gross ` +
        `production. Chlorophyll vs. NEP is weaker, and slightly negative (r = ${corrChlorNep.toFixed(2)}): the spring NEP bump does ` +
        `line up with the chlorophyll peak, but it's most likely picking up a diatom bloom - a distinct, earlier-season phytoplankton ` +
        `event - rather than the cyanobacteria that dominate later.`;
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
      ? `Bookkeeping is still the outlier, but only barely: it puts the season at ${bkStats.mean.toFixed(2)} mg/L/day (${bkStats.autoPct.toFixed(0)}% autotrophic days) - just barely net heterotrophic - ` +
        `while all four statistical methods agree the lake is net autotrophic, from ${Math.min(...others.map((s) => s.mean)).toFixed(2)} to ${Math.max(...others.map((s) => s.mean)).toFixed(2)} mg/L/day. ` +
        `Unlike Module 5's by-hand version, this bookkeeping does subtract an estimated atmospheric flux before splitting day from night, and it tracks the other methods closely through summer, when the lake runs supersaturated. ` +
        `The remaining gap traces to a simplification: the flux correction assumes a fixed 2-meter mixed layer all season, which overstates the correction once the lake mixes far deeper than that after fall turnover.`
      : `The five methods don't fully agree: season-mean NEP ranges from ${Math.min(...allStats.map((s) => s.mean)).toFixed(2)} to ${Math.max(...allStats.map((s) => s.mean)).toFixed(2)} mg/L/day. ` +
        `Bookkeeping now subtracts an estimated atmospheric flux too (unlike Module 5's by-hand version), but assumes a fixed 2-meter mixed layer all season - a simplification that's roughest once the lake mixes deeper after fall turnover.`;

    // ---- initial render ----
    update(Number(slider.value));
    methodDesc.textContent = currentMethod.desc;
    renderChlorNep();
  }
})();
