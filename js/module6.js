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

  // Month and day only - for averages across years, where a specific year would mislead.
  function fmtMD(dateStr) {
    const [, m, d] = dateStr.split('-').map(Number);
    return `${MONTHS[m - 1]} ${d}`;
  }

  // '#rrggbb' -> 'rgba(r,g,b,a)' for translucent fills.
  function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const v = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${alpha})`;
  }

  // All dates in this module are averages across years (the year in the data is just a
  // calendar placeholder), so dates are shown as month and day only.
  function fmtDate(dateStr) {
    const [, m, d] = dateStr.split('-').map(Number);
    return `${MONTHS[m - 1]} ${d}`;
  }

  // Bookkeeping fields in mendota_seasonal.json: the average across 2021-2025 of
  // each year's 7-day-smoothed daily estimate (scripts/add_multiyear_metabolism.py).
  // (Trimmed to just these fields by scripts/prune_seasonal.py.)
  const BK = { gpp: 'gpp_avg', er: 'er_avg', nep: 'nep_avg' };

  // Per-season means and share of autotrophic days - shared by the match-game
  // reveal and the season cards so the two never tell slightly different stories.
  function seasonStats(daily) {
    const bucket = { Spring: [], Summer: [], Fall: [] };
    daily.forEach((d) => { bucket[seasonOf(d.date)].push(d); });
    const seasons = ['Spring', 'Summer', 'Fall'];
    return seasons.map((s) => {
      const rows = bucket[s];
      const gppVals = rows.map((d) => d[BK.gpp]).filter((v) => v != null);
      const erVals = rows.map((d) => d[BK.er]).filter((v) => v != null);
      const nepVals = rows.map((d) => d[BK.nep]).filter((v) => v != null);
      const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
      const autoPct = nepVals.length ? (100 * nepVals.filter((v) => v >= 0).length) / nepVals.length : null;
      const meanOf = (key) => mean(rows.map((d) => d[key]).filter((v) => v != null));
      return { season: s, gpp: mean(gppVals), er: mean(erVals), nep: mean(nepVals), par: meanOf('par_clim'), wtemp: meanOf('wtemp_clim'), autoPct, nAuto: nepVals.filter((v) => v >= 0).length, n: nepVals.length };
    });
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
        tickformat: '%b', hoverformat: '%b %-d',
      },
      yaxis: { gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') }, zeroline: false },
      hovermode: 'x',
    }, extra || {});
  }

  // ---- season prediction notes (localStorage) - independent of the data fetch ----
  [
    { id: 'springNotes', key: 'seasonalMetabolism.springNotes' },
    { id: 'summerNotes', key: 'seasonalMetabolism.summerNotes' },
    { id: 'fallNotes', key: 'seasonalMetabolism.fallNotes' },
    { id: 'mayLowNotes', key: 'seasonalMetabolism.mayLowNotes' },
  ].forEach((nt) => {
    const el = document.getElementById(nt.id);
    el.value = localStorage.getItem(nt.key) || '';
    el.addEventListener('input', () => localStorage.setItem(nt.key, el.value));
  });
  // Flip cards (season cards): click or press Enter/Space to turn over.
  function toggleFlip(card) {
    const flipped = card.classList.toggle('flipped');
    card.setAttribute('aria-pressed', String(flipped));
  }
  document.addEventListener('click', (e) => {
    const card = e.target.closest('.flip-card');
    if (card) toggleFlip(card);
  });
  document.addEventListener('keydown', (e) => {
    const card = e.target.closest && e.target.closest('.flip-card');
    if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleFlip(card); }
  });

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
      { stat: 'gpp', label: 'GPP', unit: 'mg O₂/L/day', color: '--flux-add' },
      { stat: 'er', label: 'ER', unit: 'mg O₂/L/day', color: '--flux-remove' },
      { stat: 'nep', label: 'NEP', unit: 'mg O₂/L/day', color: '--series-do' },
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
        x: dates, y: daily.map((d) => d[BK.gpp]), type: 'scatter', mode: 'lines',
        line: { color: gppColor, width: 2, shape: 'spline', smoothing: 0.3 },
        hovertemplate: '%{y:.2f} mg O₂/L/day<extra>GPP</extra>',
      },
      {
        x: dates, y: daily.map((d) => d[BK.er]), type: 'scatter', mode: 'lines',
        line: { color: erColor, width: 2, shape: 'spline', smoothing: 0.3 },
        hovertemplate: '%{y:.2f} mg O₂/L/day<extra>ER</extra>',
      },
    ], basePlotLayout({
      margin: { l: 56, r: 12, t: 10, b: 28 },
      shapes: [cursorLineShape(dates[0])],
      yaxis: { title: { text: 'GPP / ER (mg O₂/L/day)', font: { size: 11, color: cssVar('--text-muted') } }, gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') }, zeroline: false },
    }), { displayModeBar: false, responsive: true, scrollZoom: false });

    Plotly.newPlot('nepPlot', [{
      x: dates, y: daily.map((d) => d[BK.nep]), type: 'bar',
      marker: { color: daily.map((d) => (d[BK.nep] == null ? 'rgba(0,0,0,0)' : (d[BK.nep] >= 0 ? goodColor : badColor))) },
      hovertemplate: '%{y:.2f} mg O₂/L/day<extra>NEP</extra>',
    }], basePlotLayout({
      margin: { l: 56, r: 12, t: 10, b: 28 },
      shapes: [cursorLineShape(dates[0])],
      yaxis: { title: { text: 'NEP (mg O₂/L/day)', font: { size: 11, color: cssVar('--text-muted') } }, gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') }, zeroline: true, zerolinecolor: cssVar('--baseline') },
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
        const val = d[BK[s.stat]];
        el.innerHTML = val == null ? `&ndash;<span class="unit"> ${s.unit}</span>` : `${val >= 0 ? '+' : ''}${val.toFixed(2)}<span class="unit"> ${s.unit}</span>`;
      });
      const statusEl = document.getElementById('stat-status');
      const nepVal = d[BK.nep];
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

    // ---- match-the-season drag game (answer key comes from the
    // same bookkeeping estimates shown in the charts above) ----
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

    // ---- monthly NEP (bookkeeping), colored by season ----
    const SEASON_COLOR = { Spring: cssVar('--series-wind'), Summer: cssVar('--series-par'), Fall: cssVar('--series-wtemp') };
    function renderMonthlyNep() {
      const byMonth = {};
      daily.forEach((d) => {
        if (d[BK.nep] == null) return;
        const m = d.date.slice(0, 7);
        (byMonth[m] = byMonth[m] || []).push(d[BK.nep]);
      });
      const months = Object.keys(byMonth).sort();
      const means = months.map((m) => byMonth[m].reduce((a, b) => a + b, 0) / byMonth[m].length);
      const labels = months.map((m) => MONTHS[+m.slice(5, 7) - 1]);
      const colors = months.map((m) => SEASON_COLOR[seasonOf(`${m}-01`)]);

      Plotly.newPlot('monthlyNepPlot', [{
        x: labels, y: means, type: 'bar', marker: { color: colors },
        hovertemplate: '%{y:.2f} mg O₂/L/day<extra>%{x}</extra>',
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
      const lowIdx = means.reduce((best, v, i) => (v < means[best] ? i : best), 0);
      const posLabels = labels.filter((_, i) => means[i] > 0);
      const f2m = (v) => (v >= 0 ? '+' : '') + v.toFixed(2);

      let text = `Monthly NEP peaks in ${labels[peakIdx]} (mean ${f2m(means[peakIdx])} mg O₂/L/day) and is net positive in ${posLabels.join(', ')}. ` +
        `In the other months GPP and ER are close to balanced, with the most negative month being ${labels[lowIdx]} (${f2m(means[lowIdx])} mg O₂/L/day). ` +
        `This pattern - a productive summer, bracketed by spring and fall when respiration keeps pace with or slightly exceeds photosynthesis - is typical of temperate lakes: ` +
        `in spring, light and warmth are still building and algae are mixed through a deep, cold water column, while in fall the light available for photosynthesis ` +
        `drops faster than respiration does, and decomposition gets a boost from the summer bloom's die-off and from leaf litter and runoff.`;
      document.getElementById('matchGameText').textContent = text;
    }

    // ---- reveal: check the match game, then show the monthly chart ----
    document.getElementById('revealMatchGame').addEventListener('click', () => {
      const stats = seasonStats(daily);
      const byGpp = stats.slice().sort((a, b) => b.gpp - a.gpp);
      const byEr = stats.slice().sort((a, b) => b.er - a.er);
      const byAuto = stats.filter((s) => s.nep != null).slice().sort((a, b) => b.nep - a.nep);
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

    // ---- shared helpers for the "why" section ----
    const normalize = (vals) => {
      const nums = vals.filter((v) => v != null);
      const min = Math.min(...nums), max = Math.max(...nums), span = max - min || 1;
      return vals.map((v) => (v == null ? null : ((v - min) / span) * 100));
    };
    function pearson(a, b) {
      const mean = (arr) => arr.reduce((x, y) => x + y, 0) / arr.length;
      const ma = mean(a), mb = mean(b);
      const cov = mean(a.map((v, i) => (v - ma) * (b[i] - mb)));
      const sda = Math.sqrt(mean(a.map((v) => (v - ma) ** 2)));
      const sdb = Math.sqrt(mean(b.map((v) => (v - mb) ** 2)));
      return cov / (sda * sdb);
    }
    // Trailing 7-day mean that skips missing values (PAR and temperature are
    // raw daily values; GPP/ER are already smoothed in the data file).
    function rolling(key) {
      return daily.map((_, i) => {
        const vals = daily.slice(Math.max(0, i - 6), i + 1).map((d) => d[key]).filter((v) => v != null);
        return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      });
    }
    const axisStyle = { gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') } };
    const pctAxis = { title: { text: '% of season range', font: { size: 11, color: cssVar('--text-muted') } }, range: [-3, 103], zeroline: false, ...axisStyle };
    const line = (x, y, color, name, unit, custom) => ({
      x, y, customdata: custom, type: 'scatter', mode: 'lines', connectgaps: true,
      line: { color, width: 2, shape: 'spline', smoothing: 0.3 },
      hovertemplate: `%{customdata:.2f} ${unit}<extra>${name}</extra>`,
    });

    // ---- drivers vs. metabolism ----
    const parRoll = rolling('par_clim');
    const tempRoll = rolling('wtemp_clim');
    const gppSeries = daily.map((d) => d[BK.gpp]);
    const erSeries = daily.map((d) => d[BK.er]);
    Plotly.newPlot('driversPlot', [
      line(dates, normalize(parRoll), cssVar('--series-par'), 'Surface PAR', 'µmol/m²/s', parRoll),
      line(dates, normalize(tempRoll), cssVar('--series-do'), 'Water temp', '°C', tempRoll),
      line(dates, normalize(gppSeries), gppColor, 'GPP', 'mg O₂/L/day', gppSeries),
      line(dates, normalize(erSeries), erColor, 'ER', 'mg O₂/L/day', erSeries),
    ], basePlotLayout({ yaxis: pctAxis }), { displayModeBar: false, responsive: true, scrollZoom: false });

    // ---- draw-your-prediction: freehand curves ----
    // One bin per day of the season. Dragging fills every bin between the
    // previous and current pointer position (linear interpolation) so a fast
    // drag never leaves gaps. Real curves stay hidden until "Reveal".
    // cfg: { plotId, surfaceId, switchId, revealId, clearId, keyId, feedbackId,
    //        series: [{ key, color, real }], yRange, yTitle, tickvals, onReveal(drawn) }
    function makeDrawChart(cfg) {
      const plotEl = document.getElementById(cfg.plotId);
      const surface = document.getElementById(cfg.surfaceId);
      const [lo, hi] = cfg.yRange;
      const clampLo = cfg.clamp ? cfg.clamp[0] : lo, clampHi = cfg.clamp ? cfg.clamp[1] : hi;
      const drawn = {};
      cfg.series.forEach((sr) => { drawn[sr.key] = new Array(n).fill(null); });
      const idxOf = (key) => cfg.series.findIndex((sr) => sr.key === key);
      let drawKey = cfg.series[0].key;
      const k = cfg.series.length;
      const traces = [
        ...cfg.series.map((sr) => ({
          x: dates, y: drawn[sr.key], type: 'scatter', mode: 'lines', hoverinfo: 'skip',
          line: { color: sr.color, width: 3.5 }, connectgaps: false,
        })),
        ...(cfg.series[0].real ? cfg.series.map((sr) => ({
          x: dates, y: new Array(n).fill(null), type: 'scatter', mode: 'lines', hoverinfo: 'skip',
          line: { color: sr.color, width: 2.5, dash: 'dash' }, connectgaps: true,
        })) : []),
        // Optional translucent band between the first two real curves, filled
        // only once they're revealed (cfg.shadeColor).
        ...(cfg.shadeColor ? [
          { x: dates, y: new Array(n).fill(null), type: 'scatter', mode: 'lines', hoverinfo: 'skip', line: { width: 0 }, showlegend: false },
          { x: dates, y: new Array(n).fill(null), type: 'scatter', mode: 'lines', hoverinfo: 'skip', line: { width: 0 }, fill: 'tonexty', fillcolor: cfg.shadeColor, showlegend: false },
        ] : []),
      ];
      Plotly.newPlot(cfg.plotId, traces, basePlotLayout({
        margin: { l: 56, r: 12, t: 10, b: 28 },
        dragmode: false, hovermode: false,
        xaxis: { type: 'date', range: [dates[0], dates[n - 1]], fixedrange: true, tickformat: '%b', ...axisStyle },
        yaxis: { title: { text: cfg.yTitle, font: { size: 11, color: cssVar('--text-muted') } }, range: cfg.yRange, tickvals: cfg.tickvals, fixedrange: true, zeroline: false, ...axisStyle },
      }), { displayModeBar: false, responsive: true, scrollZoom: false });

      // Keep the transparent drawing surface exactly over Plotly's plot area.
      function placeSurface() {
        const size = plotEl._fullLayout && plotEl._fullLayout._size;
        if (!size) return;
        Object.assign(surface.style, { left: size.l + 'px', top: size.t + 'px', width: size.w + 'px', height: size.h + 'px' });
      }
      placeSurface();
      plotEl.on('plotly_afterplot', placeSurface);
      window.addEventListener('resize', () => setTimeout(placeSurface, 0));

      function pointToBin(e) {
        const r = surface.getBoundingClientRect();
        const fx = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
        const fy = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
        const val = lo + (1 - fy) * (hi - lo);
        return { i: Math.round(fx * (n - 1)), v: Math.max(clampLo, Math.min(clampHi, val)) };
      }
      let last = null;
      function paint(e) {
        const pt = pointToBin(e);
        const arr = drawn[drawKey];
        if (last && last.i !== pt.i) {
          const step = pt.i > last.i ? 1 : -1;
          for (let i = last.i; i !== pt.i + step; i += step) {
            arr[i] = last.v + ((pt.v - last.v) * (i - last.i)) / (pt.i - last.i);
          }
        } else {
          arr[pt.i] = pt.v;
        }
        last = pt;
        Plotly.restyle(cfg.plotId, { y: [arr.slice()] }, [idxOf(drawKey)]);
      }
      surface.addEventListener('pointerdown', (e) => {
        surface.setPointerCapture(e.pointerId);
        last = null;
        paint(e);
      });
      surface.addEventListener('pointermove', (e) => { if (last) paint(e); });
      ['pointerup', 'pointercancel'].forEach((ev) => surface.addEventListener(ev, () => { last = null; }));

      document.getElementById(cfg.switchId).addEventListener('click', (e) => {
        const btn = e.target.closest('.res-btn');
        if (!btn) return;
        drawKey = btn.dataset.draw;
        document.querySelectorAll(`#${cfg.switchId} .res-btn`).forEach((b) => b.classList.toggle('active', b === btn));
      });
      document.getElementById(cfg.clearId).addEventListener('click', () => {
        cfg.series.forEach((sr) => { drawn[sr.key].fill(null); });
        Plotly.restyle(cfg.plotId, { y: cfg.series.map((sr) => drawn[sr.key].slice()) }, cfg.series.map((_, i) => i));
      });
      if (cfg.revealId) document.getElementById(cfg.revealId).addEventListener('click', () => {
        Plotly.restyle(cfg.plotId, { y: cfg.series.map((sr) => sr.real) }, cfg.series.map((_, i) => k + i));
        if (cfg.shadeColor) {
          // lower curve first so 'tonexty' fills up to the upper one
          Plotly.restyle(cfg.plotId, { y: [cfg.series[1].real, cfg.series[0].real] }, [2 * k, 2 * k + 1]);
        }
        document.getElementById(cfg.keyId).hidden = false;
        const fb = document.getElementById(cfg.feedbackId);
        fb.textContent = cfg.feedback(drawn);
        fb.hidden = false;
        if (cfg.onReveal) cfg.onReveal();
      });
      return drawn;
    }

    const peakIdx = (arr) => arr.reduce((best, v, i) => (v != null && (best < 0 || v > arr[best]) ? i : best), -1);
    // Chart 1's real curves are the 2021-2025 average (smoother than one year).
    const realPar = normalize(rolling('par_clim'));
    const realTemp = normalize(rolling('wtemp_clim'));

    // Chart 1: relative light & temperature curves (timing is the point).
    makeDrawChart({
      plotId: 'drawPlot', surfaceId: 'drawSurface', switchId: 'drawSwitch', revealId: 'drawReveal', clearId: 'drawClear',
      keyId: 'drawRealKey', feedbackId: 'drawFeedback',
      series: [
        { key: 'par', color: cssVar('--series-par'), real: realPar },
        { key: 'temp', color: cssVar('--series-do'), real: realTemp },
      ],
      yRange: [-5, 105], clamp: [0, 100], tickvals: [0, 25, 50, 75, 100], yTitle: 'Relative level (% of season range)',
      feedback(drawn) {
        const rp = peakIdx(realPar), rt = peakIdx(realTemp);
        const dp = peakIdx(drawn.par), dt = peakIdx(drawn.temp);
        const lagDays = rt - rp;
        let text = `Real data (average of 2021–2025): surface PAR peaks around ${fmtMD(dates[rp])} and water temperature around ${fmtMD(dates[rt])} - ` +
          `temperature peaks about ${Math.abs(lagDays) < 7 ? 'the same time' : Math.round(Math.abs(lagDays) / 7) + ' weeks ' + (lagDays > 0 ? 'later' : 'earlier')}. `;
        // The summer solstice (about June 21) is the longest day and highest sun of the year.
        const solsticeGap = Math.abs((new Date(`${dates[rp].slice(0, 4)}-06-21`) - new Date(dates[rp])) / 86400000);
        if (solsticeGap <= 14) {
          text += 'Surface PAR peaks right around the summer solstice (about June 21), the longest day of the year, when the sun is highest in the sky. ';
        }
        if (dp >= 0 && dt >= 0) {
          const yourLag = dt - dp;
          text += `In your drawing, surface PAR peaks around ${fmtMD(dates[dp])} and temperature around ${fmtMD(dates[dt])}` +
            (yourLag > 7 ? ' - you also had warmth lagging behind surface PAR.' : yourLag < -7 ? ' - you had temperature peaking before surface PAR.' : ' - you had them peaking together.');
        } else if (dp >= 0 || dt >= 0) {
          text += `You drew only ${dp >= 0 ? 'surface PAR' : 'temperature'}, so there's no timing to compare - try drawing both next time.`;
        } else {
          text += 'You didn’t draw anything, so use the dashed lines as a preview, and try sketching before revealing next time.';
        }
        return text;
      },
    });

    // Chart 2: surface vs. 1 m PAR, in real units (the gap matters).
    // Real curves here are the average of 2021-2025 (see scripts/add_par_below.py),
    // so they show the typical seasonal pattern rather than one year.
    const surfRoll = rolling('par_clim');
    const belowRoll = rolling('par_below_clim');
    const parTop = Math.ceil((Math.max(...surfRoll.filter((v) => v != null)) * 1.1) / 100) * 100;
    function ratioFor(filter) {
      const r = daily.filter((d) => d.par_clim > 0 && d.par_below_clim != null && filter(d));
      return r.length ? (100 * r.reduce((a, d) => a + d.par_below_clim / d.par_clim, 0)) / r.length : null;
    }
    makeDrawChart({
      plotId: 'drawPlot2', surfaceId: 'drawSurface2', switchId: 'drawSwitch2', revealId: 'drawReveal2', clearId: 'drawClear2',
      keyId: 'drawRealKey2', feedbackId: 'drawFeedback2',
      shadeColor: hexToRgba(cssVar('--series-par'), 0.22),
      onReveal() { document.getElementById('keepExploringWrap').hidden = false; },
      series: [
        { key: 'surface', color: cssVar('--series-par'), real: surfRoll },
        { key: 'below', color: cssVar('--series-rain'), real: belowRoll },
      ],
      yRange: [0, parTop], tickvals: Array.from({ length: parTop / 100 + 1 }, (_, i) => i * 100), yTitle: 'PAR (µmol/m²/s, 7-day mean)',
      feedback(drawn) {
        const seasonRatio = (name) => ratioFor((d) => seasonOf(d.date) === name);
        const sp = seasonRatio('Spring'), su = seasonRatio('Summer'), fa = seasonRatio('Fall'), all = ratioFor(() => true);
        const pct = (v) => (v == null ? '–' : v.toFixed(0) + '%');
        const mean = (a) => { const v = a.filter((x) => x != null); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
        const yourS = mean(drawn.surface), yourB = mean(drawn.below);
        const bestSeason = sp != null && su != null && fa != null && sp > su && sp > fa;
        let text = `Real data (average of 2021–2025): on an average day the sensor at 1 m sees about ${pct(all)} of the surface light (spring ${pct(sp)}, summer ${pct(su)}, fall ${pct(fa)}). ` +
          (bestSeason ? `Spring is the highest: the water is typically clearest then, before algae build up, so more light makes it down. ` : '') +
          `The lake's water absorbs and scatters light quickly - algae, sediment, and dissolved organic matter all block it - so the under-water curve follows the surface curve's shape ` +
          `but sits far below it, and the share that gets through changes with how murky the water is. In practice the algae floating deeper than 1 m get even less. `;
        if (yourS != null && yourB != null) {
          text += `In your drawing the 1 m line averages ${(100 * yourB / yourS).toFixed(0)}% of your surface line.`;
        } else {
          text += 'Draw both lines before revealing next time to see how your gap compares.';
        }
        return text;
      },
    });

    // Chart 3: sketch GPP and ER (real units); NEP is derived from the two lines.
    const metabTop = Math.ceil(Math.max(...gppSeries.filter((v) => v != null), ...erSeries.filter((v) => v != null)) * 1.15);
    const sketched = makeDrawChart({
      plotId: 'drawPlot3', surfaceId: 'drawSurface3', switchId: 'drawSwitch3', clearId: 'drawClear3',
      series: [
        { key: 'gpp', color: gppColor },
        { key: 'er', color: erColor },
      ],
      yRange: [0, metabTop], tickvals: Array.from({ length: metabTop + 1 }, (_, i) => i), yTitle: 'mg O₂/L/day',
    });
    const sketchNote = document.getElementById('sketchWhyNotes');
    sketchNote.value = localStorage.getItem('seasonalMetabolism.sketchWhyNotes') || '';
    sketchNote.addEventListener('input', () => localStorage.setItem('seasonalMetabolism.sketchWhyNotes', sketchNote.value));
    document.getElementById('showSketchNep').addEventListener('click', () => {
      const nep = dates.map((_, i) => (sketched.gpp[i] != null && sketched.er[i] != null ? sketched.gpp[i] - sketched.er[i] : null));
      const have = nep.map((v, i) => ({ v, i })).filter((o) => o.v != null);
      const card = document.getElementById('sketchNepCard');
      card.hidden = false;
      Plotly.newPlot('sketchNepPlot', [{
        x: dates, y: nep, type: 'bar',
        marker: { color: nep.map((v) => (v == null ? 'rgba(0,0,0,0)' : (v >= 0 ? goodColor : badColor))) },
        hovertemplate: '%{y:.2f} mg O₂/L/day<extra>Your NEP</extra>',
      }], basePlotLayout({
        margin: { l: 56, r: 12, t: 10, b: 28 },
        xaxis: { type: 'date', range: [dates[0], dates[n - 1]], tickformat: '%b', hoverformat: '%b %-d', ...axisStyle },
        yaxis: { title: { text: 'NEP (mg O₂/L/day)', font: { size: 11, color: cssVar('--text-muted') } }, ...axisStyle, zeroline: true, zerolinecolor: cssVar('--baseline') },
      }), { displayModeBar: false, responsive: true, scrollZoom: false });
      const text = document.getElementById('sketchNepText');
      if (!have.length) {
        text.textContent = 'Draw both GPP and ER over the same stretch of the season first - NEP only shows up on days where you drew both.';
      } else {
        const auto = have.filter((o) => o.v >= 0).length;
        const best = have.reduce((a, b) => (b.v > a.v ? b : a)), worst = have.reduce((a, b) => (b.v < a.v ? b : a));
        text.textContent = `On ${Math.round((100 * auto) / have.length)}% of the days you drew, your lake is autotrophic (GPP above ER) and on ${Math.round((100 * (have.length - auto)) / have.length)}% it is heterotrophic. ` +
          `Your biggest oxygen surplus is around ${fmtMD(dates[best.i])} (${best.v >= 0 ? '+' : ''}${best.v.toFixed(1)} mg O₂/L/day) and your biggest deficit around ${fmtMD(dates[worst.i])} (${worst.v >= 0 ? '+' : ''}${worst.v.toFixed(1)}). ` +
          `Keep this in mind - next you'll see what the buoy actually recorded.`;
      }
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });

    // "Show me the real data": overlay the buoy's GPP/ER and NEP on the student's
    // sketch, then open the rest of the module (slider, match game, drivers).
    document.getElementById('showRealMetab').addEventListener('click', () => {
      const dash = (y, color, name) => ({ x: dates, y, type: 'scatter', mode: 'lines', hoverinfo: 'skip', line: { color, width: 2.5, dash: 'dash' }, connectgaps: true, name });
      Plotly.addTraces('drawPlot3', [dash(gppSeries, gppColor, 'Real GPP'), dash(erSeries, erColor, 'Real ER')]);
      document.getElementById('drawRealKey3').hidden = false;
      const realNep = daily.map((d) => d[BK.nep]);
      if (document.getElementById('sketchNepPlot').data) {
        Plotly.addTraces('sketchNepPlot', [{ x: dates, y: realNep, type: 'scatter', mode: 'lines', hoverinfo: 'skip', line: { color: cssVar('--text-primary'), width: 2.5, dash: 'dash' }, connectgaps: true, name: 'Real NEP' }]);
      }
      const vals = realNep.filter((v) => v != null);
      const autoPct = Math.round((100 * vals.filter((v) => v >= 0).length) / vals.length);
      document.getElementById('realMetabText').textContent =
        `Dashed lines show the buoy's real values (bookkeeping method, average of 2021–2025). In the real data GPP peaks around ${fmtMD(dates[peakOf(gppSeries)])} and ER around ${fmtMD(dates[peakOf(erSeries)])}, ` +
        `and the lake is autotrophic on ${autoPct}% of days. How does your sketch compare - did GPP and ER rise and fall together, and when did one pull ahead of the other?`;
      document.getElementById('realMetabText').hidden = false;
      document.getElementById('showRealMetab').hidden = true;

      document.getElementById('metabolismRest').hidden = false;
      // Charts built while hidden have no real size yet.
      ['gppErPlot', 'nepPlot', 'driversPlot', 'chlorGppPlot', 'monthlyNepPlot'].forEach((id) => Plotly.Plots.resize(id));
    });

    // Peak dates and correlations are found in the data, not assumed.
    const peakOf = (arr) => arr.reduce((best, v, i) => (v != null && v > arr[best] ? i : best), 0);
    const parPeak = fmtDate(dates[peakOf(parRoll)]);
    const tempPeak = fmtDate(dates[peakOf(tempRoll)]);
    const gppPeak = fmtDate(dates[peakOf(gppSeries)]);
    const pairs = daily.filter((d) => d.par_clim != null && d.wtemp_clim != null && d[BK.gpp] != null && d[BK.er] != null);
    const rGppPar = pearson(pairs.map((d) => d[BK.gpp]), pairs.map((d) => d.par_clim));
    const rGppTemp = pearson(pairs.map((d) => d[BK.gpp]), pairs.map((d) => d.wtemp_clim));
    const rErTemp = pearson(pairs.map((d) => d[BK.er]), pairs.map((d) => d.wtemp_clim));
    document.getElementById('driversText').textContent =
      `Light peaks first (7-day mean PAR tops out around ${parPeak}), but the water keeps warming for weeks afterward (warmest around ${tempPeak}) ` +
      `and GPP peaks around ${gppPeak}. By fall the two drivers have come apart: sunlight has dropped sharply while the water is still warm. ` +
      `Across the season, ER tracks water temperature closely (r = ${rErTemp.toFixed(2)}), and GPP tracks temperature too (r = ${rGppTemp.toFixed(2)}) ` +
      `- partly because warm water and bright light arrive together in summer - while GPP's day-to-day link to light alone is weaker (r = ${rGppPar.toFixed(2)}), ` +
      `since algae also need to be present in the water, not just sunshine. Whenever GPP outruns ER the lake is autotrophic; whenever ER wins, heterotrophic.`;

    // ---- season cards: numbers are live, mechanisms are the explanation ----
    const stats = seasonStats(daily);
    const byName = Object.fromEntries(stats.map((x) => [x.season, x]));
    const f1 = (v) => (v == null ? '–' : v.toFixed(1));
    const f2 = (v) => (v == null ? '–' : (v >= 0 ? '+' : '') + v.toFixed(2));
    const pctDrop = Math.round(100 * (1 - byName.Fall.par / byName.Summer.par));
    const SEASON_INFO = {
      Spring: {
        months: 'March – May', color: '--series-wind',
        verdict: 'Waking up: production and respiration nearly cancel.',
        body: [
          'Ice-out lets light back into a cold, well-mixed lake. Algae respond fast &mdash; chlorophyll shows an early-season bloom &mdash; but cold water keeps bacterial respiration slow.',
          'Light is still building and the lake hasn’t stratified yet, so algae get mixed down out of the sun. GPP and ER stay low and close to balanced; the lake hovers near zero NEP.',
        ],
      },
      Summer: {
        months: 'June – August', color: '--series-par',
        verdict: 'Peak everything: GPP wins, so the lake is autotrophic.',
        body: [
          'Maximum sunlight and warm water. The lake stratifies, holding algae &mdash; increasingly cyanobacteria &mdash; in the bright surface layer where they can photosynthesize all day.',
          'ER is also at its yearly high (warm water speeds respiration of everything living there), but GPP rises even further, leaving a positive NEP: more oxygen is made than used.',
        ],
      },
      Fall: {
        months: 'September – November', color: '--series-wtemp',
        verdict: 'Light fades, respiration lingers: ER wins, the lake is heterotrophic.',
        body: [
          `Day length shortens and sun angle drops &mdash; average PAR is about ${pctDrop}% lower than in summer &mdash; and as surface waters cool, wind mixing deepens the layer and carries algae below the light. GPP collapses.`,
          'But the water is still warm and the summer’s dead algae, plus leaf litter and runoff, give decomposers plenty to eat. ER stays above GPP as GPP falls away, so NEP slips slightly negative.',
        ],
      },
    };
    const cards = document.getElementById('seasonCards');
    const SEASON_INK = { Spring: '#ffffff', Summer: '#1f1f1f', Fall: '#ffffff' };
    ['Spring', 'Summer', 'Fall'].forEach((name) => {
      const info = SEASON_INFO[name], st = byName[name];
      const card = document.createElement('div');
      card.className = 'flip-card';
      card.setAttribute('role', 'button');
      card.tabIndex = 0;
      card.setAttribute('aria-pressed', 'false');
      card.setAttribute('aria-label', `Reveal ${name}`);
      card.style.setProperty('--season-color', cssVar(info.color));
      card.style.setProperty('--season-ink', SEASON_INK[name]);
      card.innerHTML = `
        <div class="flip-inner">
          <div class="flip-face flip-front">
            <span class="flip-emoji">${SEASON_EMOJI[name]}</span>
            <span class="flip-title">${name}</span>
            <span class="flip-hint">(reveal)</span>
          </div>
          <div class="flip-face flip-back season-card">
            <h3>${SEASON_EMOJI[name]} ${name}</h3>
            <p class="season-months">${info.months}</p>
            <div class="season-nums">
              <span>GPP<br><strong>${f1(st.gpp)}</strong></span>
              <span>ER<br><strong>${f1(st.er)}</strong></span>
              <span>NEP<br><strong>${f2(st.nep)}</strong></span>
              <span>Autotrophic days<br><strong>${st.autoPct == null ? '–' : st.autoPct.toFixed(0) + '%'}</strong></span>
              <span>Surface PAR<br><strong>${f1(st.par)}</strong></span>
              <span>Water temp<br><strong>${f1(st.wtemp)} °C</strong></span>
            </div>
            <p class="season-verdict">${info.verdict}</p>
            ${info.body.map((t) => `<p>${t}</p>`).join('')}
          </div>
        </div>`;
      cards.appendChild(card);
    });

    // ---- chlorophyll, phycocyanin & GPP ----
    const rows = daily.filter((d) => d.chlor_avg != null && d.phyco_avg != null && d[BK.gpp] != null);
    const chlorRaw = rows.map((d) => d.chlor_avg);
    const phycoRaw = rows.map((d) => d.phyco_avg);
    const gppRaw = rows.map((d) => d[BK.gpp]);
    const rowDates = rows.map((d) => d.date);
    Plotly.newPlot('chlorGppPlot', [
      // GPP is drawn as a wide, translucent band so it reads as the backdrop the
      // two pigment lines are compared against.
      (() => {
        const t = line(rowDates, normalize(gppRaw), hexToRgba(gppColor, 0.4), 'GPP', 'mg O₂/L/day', gppRaw);
        t.line.width = 9;
        return t;
      })(),
      line(rowDates, normalize(chlorRaw), cssVar('--series-wind'), 'Chlorophyll', 'RFU', chlorRaw),
      line(rowDates, normalize(phycoRaw), cssVar('--series-do'), 'Phycocyanin', 'RFU', phycoRaw),
    ], basePlotLayout({ yaxis: pctAxis }), { displayModeBar: false, responsive: true, scrollZoom: false });

    const peakChlor = rows.reduce((a, b) => (b.chlor_avg > a.chlor_avg ? b : a));
    const peakPhyco = rows.reduce((a, b) => (b.phyco_avg > a.phyco_avg ? b : a));
    document.getElementById('chlorGppText').textContent =
      `Chlorophyll peaks on ${fmtDate(peakChlor.date)} (${peakChlor.chlor_avg.toFixed(2)} RFU) - an early-season bloom, before cyanobacteria are active - ` +
      `while phycocyanin peaks later, on ${fmtDate(peakPhyco.date)} (${peakPhyco.phyco_avg.toFixed(2)} RFU), and stays elevated through summer. ` +
      `Season-long the two sensors are actually slightly anti-correlated (r = ${pearson(chlorRaw, phycoRaw).toFixed(2)}): the spring bloom and the summer ` +
      `cyanobacteria look like two different algal communities, not one continuous bloom. GPP follows the summer one: it tracks phycocyanin (r = ${pearson(phycoRaw, gppRaw).toFixed(2)}) ` +
      `but not chlorophyll (r = ${pearson(chlorRaw, gppRaw).toFixed(2)}). The spring chlorophyll bump is probably a different group of phytoplankton, such as diatoms - ` +
      `these sensors can't tell us that directly - and it produces much less oxygen than the summer's warm-water cyanobacteria.`;

    // ---- gate: the metabolism half of the module opens after the PAR reveal ----
    document.getElementById('keepExploring').addEventListener('click', () => {
      const block = document.getElementById('metabolismBlock');
      block.hidden = false;
      document.getElementById('keepExploringWrap').hidden = true;
      block.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    // ---- initial render ----
    update(Number(slider.value));
  }
})();
