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
      { key: 'gpp_smooth', label: 'GPP', unit: 'mg/L/day', color: '--flux-add' },
      { key: 'er_smooth', label: 'ER', unit: 'mg/L/day', color: '--flux-remove' },
      { key: 'nep_smooth', label: 'NEP', unit: 'mg/L/day', color: '--series-do' },
    ];
    const statRow = document.getElementById('statRow');
    STATS.forEach((s) => {
      const tile = document.createElement('div');
      tile.className = 'stat-tile';
      tile.innerHTML = `
        <div class="stat-tile-label"><span class="dot" style="background:${cssVar(s.color)}"></span>${s.label}</div>
        <div class="stat-tile-value" id="stat-${s.key}">&ndash;<span class="unit"> ${s.unit}</span></div>`;
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
        x: dates, y: daily.map((d) => d.gpp_smooth), type: 'scatter', mode: 'lines',
        line: { color: gppColor, width: 2, shape: 'spline', smoothing: 0.3 },
        hovertemplate: '%{y:.2f} mg/L/day<extra>GPP</extra>',
      },
      {
        x: dates, y: daily.map((d) => d.er_smooth), type: 'scatter', mode: 'lines',
        line: { color: erColor, width: 2, shape: 'spline', smoothing: 0.3 },
        hovertemplate: '%{y:.2f} mg/L/day<extra>ER</extra>',
      },
    ], basePlotLayout({
      shapes: [cursorLineShape(dates[0])],
    }), { displayModeBar: false, responsive: true, scrollZoom: false });

    const nepColors = daily.map((d) => (d.nep_smooth == null ? 'rgba(0,0,0,0)' : (d.nep_smooth >= 0 ? goodColor : badColor)));
    Plotly.newPlot('nepPlot', [{
      x: dates, y: daily.map((d) => d.nep_smooth), type: 'bar',
      marker: { color: nepColors },
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
        const el = document.getElementById(`stat-${s.key}`);
        const val = d[s.key];
        el.innerHTML = val == null ? `&ndash;<span class="unit"> ${s.unit}</span>` : `${val >= 0 ? '+' : ''}${val.toFixed(2)}<span class="unit"> ${s.unit}</span>`;
      });
      const statusEl = document.getElementById('stat-status');
      if (d.nep_smooth == null) statusEl.textContent = 'No data';
      else if (d.nep_smooth >= 0) { statusEl.textContent = 'Autotrophic'; statusEl.style.color = goodColor; }
      else { statusEl.textContent = 'Heterotrophic'; statusEl.style.color = badColor; }

      const shape = cursorLineShape(d.date);
      Plotly.relayout('gppErPlot', { shapes: [shape] });
      Plotly.relayout('nepPlot', { shapes: [shape] });
    }

    slider.addEventListener('input', () => update(Number(slider.value)));
    update(Number(slider.value));

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

    // ---- reveal: GPP/ER peaks ----
    document.getElementById('revealPeaks').addEventListener('click', () => {
      const withGpp = daily.filter((d) => d.gpp_smooth != null);
      const withEr = daily.filter((d) => d.er_smooth != null);
      const peakGpp = withGpp.reduce((a, b) => (b.gpp_smooth > a.gpp_smooth ? b : a));
      const peakEr = withEr.reduce((a, b) => (b.er_smooth > a.er_smooth ? b : a));
      const sameDay = peakGpp.date === peakEr.date;
      document.getElementById('peaksText').textContent = sameDay
        ? `Both peak on the same day: ${fmtDate(peakGpp.date)}, with GPP at ${peakGpp.gpp_smooth.toFixed(2)} and ER at ${peakEr.er_smooth.toFixed(2)} mg/L/day. GPP and ER track each other closely all season - warmer, sunnier days grow more algae, and more algae both produces and consumes more oxygen.`
        : `GPP peaks on ${fmtDate(peakGpp.date)} (${peakGpp.gpp_smooth.toFixed(2)} mg/L/day), while ER peaks separately on ${fmtDate(peakEr.date)} (${peakEr.er_smooth.toFixed(2)} mg/L/day).`;
      document.getElementById('peaksPanel').hidden = false;
    });

    // ---- reveal: autotrophic/heterotrophic pattern ----
    document.getElementById('revealNepSummary').addEventListener('click', () => {
      const withNep = daily.filter((d) => d.nep_smooth != null);
      const auto = withNep.filter((d) => d.nep_smooth >= 0).length;
      const hetero = withNep.length - auto;

      const bySeason = { Spring: [0, 0], Summer: [0, 0], Fall: [0, 0] };
      withNep.forEach((d) => {
        const s = seasonOf(d.date);
        bySeason[s][1]++;
        if (d.nep_smooth >= 0) bySeason[s][0]++;
      });
      const pct = Object.entries(bySeason).map(([s, [a, t]]) => [s, t ? (100 * a) / t : 0]);
      pct.sort((a, b) => b[1] - a[1]);
      const most = pct[0], least = pct[pct.length - 1];

      document.getElementById('nepSummaryText').textContent =
        `Across the season, ${auto} of ${withNep.length} days (${Math.round((100 * auto) / withNep.length)}%) were net autotrophic (green) and ${hetero} were net heterotrophic (red). ` +
        `${most[0]} had the highest share of autotrophic days (${most[1].toFixed(0)}%), and ${least[0]} had the lowest (${least[1].toFixed(0)}%) - but look closely at the bar chart: ` +
        `even within a single season, the lake flips back and forth from one day to the next. It's rarely one or the other for long.`;
      document.getElementById('nepSummaryPanel').hidden = false;
    });
  }
})();
