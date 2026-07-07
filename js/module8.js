(() => {
  'use strict';

  const { cssVar, parseHM } = window.LakeCommon;

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTH_LENS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const MONTH_STARTS = (() => {
    const starts = [1];
    for (let i = 0; i < 11; i++) starts.push(starts[i] + MONTH_LENS[i]);
    return starts;
  })();
  function doyToLabel(doy) {
    let d = Math.round(doy);
    for (let m = 0; m < 12; m++) {
      if (d <= MONTH_LENS[m]) return `${MONTHS[m]} ${d}`;
      d -= MONTH_LENS[m];
    }
    return 'Dec 31';
  }

  // Same 3-process alpha/R/gas-exchange model as Modules 3 & 4, and the same
  // O2 solubility curve used throughout the app.
  function doSat(tempC) {
    return 14.652 - 0.41022 * tempC + 0.007991 * tempC * tempC - 0.000077774 * tempC * tempC * tempC;
  }
  function simulate(alpha, r, k, do0, par, wind, temp) {
    const n = par.length;
    const DO = new Array(n);
    DO[0] = do0;
    for (let i = 1; i < n; i++) {
      const gpp = alpha * par[i - 1];
      const sat = doSat(temp[i - 1]);
      const gasFlux = k * wind[i - 1] * (sat - DO[i - 1]);
      DO[i] = DO[i - 1] + gpp - r + gasFlux;
    }
    return DO;
  }

  // ------------------------------------------------------------------
  // Five illustrative lake archetypes. Diel forcing (sunrise/sunset, PAR
  // peak, temperature, wind) is hand-set to typical conditions for each
  // lake type; targetGPP/targetER are typical summer daily rates (mg
  // O2/L/day) drawn from the published range for each archetype. alpha/r
  // are then solved so the simulated day reproduces those exact rates -
  // see buildLakeSeries.
  // ------------------------------------------------------------------
  const LAKES = [
    {
      key: 'oligo', label: 'Oligotrophic', emoji: '\u{1F48E}', color: '--lake-oligo', mapPct: 30,
      env: { nutrients: '8 &micro;g/L (low)', clarity: '8.0 m Secchi', doc: '2 mg/L', temp: '18°C', season: '220 days' },
      diel: {
        sunrise: '05:30', sunset: '20:30', wtempMean: 18, wtempAmp: 1.4, wtempPeakHr: 16,
        parPeak: 1900, windBase: 3.2, windAmp: 0.8, k: 0.0042, targetGPP: 2.00, targetER: 1.65,
      },
      seasonal: { type: 'hump', start: 80, end: 300 },
      notice: [
        'Oxygen rises and falls in a clean curve, tightly tracking sunrise and sunset.',
        'The overnight drop is small &mdash; respiration is modest.',
        'Oxygen sits at or above 100% saturation almost the entire time.',
      ],
      ecoNote: 'Low nutrient inputs mean modest photosynthesis, but there is also very little organic matter to fuel respiration. What little production occurs mostly outpaces decomposition, letting the lake accumulate a small carbon surplus most years.',
    },
    {
      key: 'eutro', label: 'Eutrophic', emoji: '\u{1F7E2}', color: '--lake-eutro', mapPct: 58,
      env: { nutrients: '60 &micro;g/L (high)', clarity: '1.0 m Secchi', doc: '6 mg/L', temp: '24°C', season: '220 days' },
      diel: {
        sunrise: '05:30', sunset: '20:30', wtempMean: 24, wtempAmp: 2.0, wtempPeakHr: 16,
        parPeak: 1900, windBase: 2.6, windAmp: 0.6, k: 0.0040, targetGPP: 8.50, targetER: 9.05,
      },
      seasonal: { type: 'hump', start: 80, end: 300 },
      notice: [
        'Daytime oxygen production is huge &mdash; the biggest afternoon peak of any lake here.',
        'Overnight, oxygen crashes just as dramatically &mdash; nighttime consumption is intense.',
        'Day-to-day variability is the largest of any lake type.',
      ],
      ecoNote: 'Algal blooms drive enormous daytime production, but they also leave behind huge amounts of organic matter that bacteria respire away, day and night. Its short, intense open-water season limits how much of that daily surplus can accumulate over a full year.',
    },
    {
      key: 'bog', label: 'Bog', emoji: '\u{1F7E4}', color: '--lake-bog', mapPct: 42,
      env: { nutrients: '15 &micro;g/L (low-mod.)', clarity: '1.2 m Secchi (tannins)', doc: '18 mg/L', temp: '20°C', season: '205 days' },
      diel: {
        sunrise: '05:30', sunset: '20:30', wtempMean: 20, wtempAmp: 1.0, wtempPeakHr: 15,
        parPeak: 1700, windBase: 1.5, windAmp: 0.4, k: 0.0030, targetGPP: 0.90, targetER: 3.10,
      },
      seasonal: { type: 'hump', start: 85, end: 290 },
      notice: [
        'Oxygen barely moves through the day &mdash; the swings are the smallest of any lake here.',
        'Oxygen stays low almost continuously, day and night.',
        'The sun rises and sets like any other lake, but oxygen barely responds.',
      ],
      ecoNote: 'Bogs receive huge amounts of dissolved organic carbon washed in from surrounding peatlands and forests. Tannins darken the water and block light before it can drive much photosynthesis, so respiration overwhelms production almost every day &mdash; making bogs among the strongest carbon sources of any lake type.',
    },
    {
      key: 'arctic', label: 'Arctic', emoji: '❄️', color: '--lake-arctic', mapPct: 8,
      env: { nutrients: '5 &micro;g/L (low)', clarity: '6.0 m Secchi', doc: '3 mg/L', temp: '8°C', season: '70 days' },
      diel: {
        sunrise: '02:00', sunset: '23:30', wtempMean: 8, wtempAmp: 0.6, wtempPeakHr: 15,
        parPeak: 900, windBase: 4.5, windAmp: 1.0, k: 0.0060, targetGPP: 1.00, targetER: 0.95,
      },
      seasonal: { type: 'hump', start: 165, end: 235 },
      notice: [
        'The sun barely sets &mdash; daylight lasts almost the entire 24 hours.',
        'Even with nearly constant light, oxygen changes are small and slow.',
        'This snapshot covers some of the only ~70 ice-free days of the whole year.',
      ],
      ecoNote: 'A short ice-free season limits total production and consumption alike. Whatever the lake produces or consumes has only a few months to accumulate, keeping most Arctic lakes close to carbon-neutral in a typical year.',
    },
    {
      key: 'tropical', label: 'Tropical', emoji: '\u{1F334}', color: '--lake-tropical', mapPct: 88,
      env: { nutrients: '25 &micro;g/L (moderate)', clarity: '2.5 m Secchi', doc: '5 mg/L', temp: '28°C', season: '365 days' },
      diel: {
        sunrise: '06:00', sunset: '18:00', wtempMean: 28, wtempAmp: 1.0, wtempPeakHr: 15,
        parPeak: 2200, windBase: 2.0, windAmp: 0.5, k: 0.0035, targetGPP: 4.20, targetER: 4.95,
      },
      seasonal: { type: 'flat', wobbleAmp: 0.15, wobblePhase: 80 },
      notice: [
        'Day length barely changes &mdash; about 12 hours of light, every single day of the year.',
        'The same diel swing repeats all year &mdash; there is no winter shutdown.',
        'Warm water holds less oxygen, so even daytime highs look modest next to a cold lake.',
      ],
      ecoNote: 'Warm, stable conditions keep both photosynthesis and respiration running every day of the year, with no winter shutoff. Because respiration responds to temperature even more strongly than photosynthesis does, decomposition wins out day after day &mdash; adding up to a substantial annual carbon loss.',
    },
  ];
  const LAKE_BY_KEY = Object.fromEntries(LAKES.map((l) => [l.key, l]));

  function seasonalEnvelope(lake, day) {
    const s = lake.seasonal;
    if (s.type === 'hump') {
      if (day < s.start || day > s.end) return 0;
      return Math.sin(Math.PI * (day - s.start) / (s.end - s.start));
    }
    return 1 + (s.wobbleAmp || 0) * Math.sin(2 * Math.PI * (day - (s.wobblePhase || 0)) / 365);
  }

  function buildDiel(lake) {
    const sunriseHr = parseHM(lake.diel.sunrise);
    const sunsetHr = parseHM(lake.diel.sunset);
    const dayLen = sunsetHr - sunriseHr;
    const par = [], wind = [], temp = [];
    for (let h = 0; h < 96; h++) {
      const dayIdx = Math.floor(h / 24);
      const hod = h % 24;
      const cloud = 0.92 + 0.08 * Math.sin(dayIdx * 1.7 + 1);
      const isDay = hod >= sunriseHr && hod <= sunsetHr;
      const parVal = isDay ? Math.max(0, lake.diel.parPeak * cloud * Math.sin(Math.PI * (hod - sunriseHr) / dayLen)) : 0;
      par.push(parVal);
      temp.push(lake.diel.wtempMean + lake.diel.wtempAmp * Math.cos(2 * Math.PI * (hod - lake.diel.wtempPeakHr) / 24));
      wind.push(Math.max(0.2, lake.diel.windBase + lake.diel.windAmp * Math.sin(2 * Math.PI * (hod - 14) / 24)));
    }
    return { par, wind, temp, sunriseHr, sunsetHr };
  }

  function buildLakeSeries(lake) {
    const { par, wind, temp, sunriseHr, sunsetHr } = buildDiel(lake);
    const sumDayPar = par.slice(24, 48).reduce((a, b) => a + b, 0);
    const alpha = lake.diel.targetGPP / sumDayPar;
    const r = lake.diel.targetER / 24;
    const do0 = doSat(lake.diel.wtempMean) * 0.95;
    const DOfull = simulate(alpha, r, lake.diel.k, do0, par, wind, temp);

    const par3 = par.slice(24, 96), wind3 = wind.slice(24, 96), temp3 = temp.slice(24, 96), do3 = DOfull.slice(24, 96);
    const sat3 = do3.map((v, i) => 100 * v / doSat(temp3[i]));
    const hourLabels = par3.map((_, i) => `Day ${Math.floor(i / 24) + 1}, ${String(i % 24).padStart(2, '0')}:00`);

    // seasonal daily GPP/ER/NEP + season-integrated annual NEP
    const days = [], gpp = [], er = [], nep = [];
    let annual = 0;
    for (let d = 1; d <= 365; d++) {
      const env = seasonalEnvelope(lake, d);
      days.push(d);
      if (env > 0.001) {
        const g = lake.diel.targetGPP * env, e = lake.diel.targetER * env;
        gpp.push(g); er.push(e); nep.push(g - e);
        annual += (g - e);
      } else {
        gpp.push(null); er.push(null); nep.push(null);
      }
    }
    const activeDays = gpp.filter((v) => v != null).length;
    const peakIdx = gpp.reduce((best, v, i) => (v != null && (best === -1 || v > gpp[best]) ? i : best), -1);

    return {
      par: par3, wind: wind3, temp: temp3, do: do3, sat: sat3, hourLabels, sunriseHr, sunsetHr,
      gpp: lake.diel.targetGPP, er: lake.diel.targetER, nep: lake.diel.targetGPP - lake.diel.targetER,
      avgSat: sat3.reduce((a, b) => a + b, 0) / sat3.length,
      seasonal: { days, gpp, er, nep, annual, activeDays, peakDay: peakIdx + 1 },
    };
  }

  const SERIES = new Map(LAKES.map((l) => [l.key, buildLakeSeries(l)]));

  function nightShapes(sunriseHr, sunsetHr) {
    const shapes = [];
    const fill = cssVar('--night-fill');
    const rect = (x0, x1) => ({ type: 'rect', xref: 'x', yref: 'paper', x0, x1, y0: 0, y1: 1, fillcolor: fill, line: { width: 0 }, layer: 'below' });
    let prevSunset = 0;
    for (let d = 0; d < 3; d++) {
      const sunrise = d * 24 + sunriseHr;
      const sunset = d * 24 + sunsetHr;
      shapes.push(rect(prevSunset, sunrise));
      prevSunset = sunset;
    }
    shapes.push(rect(prevSunset, 72));
    return shapes;
  }
  function sunAnnotations(sunriseHr, sunsetHr) {
    const anns = [];
    for (let d = 0; d < 3; d++) {
      anns.push({ x: d * 24 + sunriseHr, y: 1.0, yref: 'paper', yanchor: 'top', text: '☀️', showarrow: false, font: { size: 11 } });
      anns.push({ x: d * 24 + sunsetHr, y: 1.0, yref: 'paper', yanchor: 'top', text: '\u{1F319}', showarrow: false, font: { size: 11 } });
    }
    return anns;
  }

  function dielLayout(sunriseHr, sunsetHr, extra) {
    return Object.assign({
      margin: { l: 44, r: 10, t: 20, b: 26 },
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      font: { family: 'system-ui, -apple-system, "Segoe UI", sans-serif', color: cssVar('--text-secondary'), size: 11 },
      showlegend: false,
      shapes: nightShapes(sunriseHr, sunsetHr),
      annotations: sunAnnotations(sunriseHr, sunsetHr),
      transition: { duration: 450, easing: 'cubic-in-out' },
      xaxis: {
        range: [0, 71], tickmode: 'array', tickvals: [12, 36, 60], ticktext: ['Day 1', 'Day 2', 'Day 3'],
        gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') },
      },
      yaxis: { gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') }, zeroline: false },
      hovermode: 'x',
    }, extra || {});
  }

  function basePlotLayout(extra) {
    return Object.assign({
      margin: { l: 44, r: 12, t: 10, b: 28 },
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      font: { family: 'system-ui, -apple-system, "Segoe UI", sans-serif', color: cssVar('--text-secondary'), size: 11 },
      showlegend: false,
      transition: { duration: 450, easing: 'cubic-in-out' },
      xaxis: { gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') } },
      yaxis: { gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') }, zeroline: false },
      hovermode: 'x',
    }, extra || {});
  }

  // ==================================================================
  // Build static UI: lake switch, env table, daily bar chart, predict
  // rows, carbon map, then wire up the interactive bits.
  // ==================================================================
  const goodColor = cssVar('--good');
  const badColor = cssVar('--flux-remove');
  const gppColor = cssVar('--flux-add');
  const erColor = cssVar('--flux-remove');

  // ---- lake switch ----
  const lakeSwitch = document.getElementById('lakeSwitch');
  LAKES.forEach((l) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'res-btn';
    btn.dataset.lake = l.key;
    btn.style.setProperty('--accent', `var(${l.color})`);
    btn.textContent = `${l.emoji} ${l.label}`;
    lakeSwitch.appendChild(btn);
  });

  // ---- stat tiles ----
  const STAT_DEFS = [
    { key: 'gpp', label: 'GPP', unit: 'mg/L/day' },
    { key: 'er', label: 'ER', unit: 'mg/L/day' },
    { key: 'nep', label: 'NEP', unit: 'mg/L/day' },
    { key: 'sat', label: 'Avg O₂ saturation', unit: '%' },
    { key: 'status', label: 'Status', unit: '' },
  ];
  const statRow = document.getElementById('statRow');
  STAT_DEFS.forEach((s) => {
    const tile = document.createElement('div');
    tile.className = 'stat-tile';
    tile.innerHTML = `<div class="stat-tile-label">${s.label}</div><div class="stat-tile-value" id="stat-${s.key}">&ndash;<span class="unit"> ${s.unit}</span></div>`;
    statRow.appendChild(tile);
  });

  // ---- env table ----
  const envBody = document.getElementById('envTableBody');
  LAKES.forEach((l) => {
    const tr = document.createElement('tr');
    tr.dataset.lake = l.key;
    tr.style.cursor = 'pointer';
    tr.style.setProperty('--row-accent', `var(${l.color})`);
    tr.innerHTML = `
      <td><span class="env-lake-cell">${l.emoji} ${l.label}</span></td>
      <td>${l.env.nutrients}</td>
      <td>${l.env.clarity}</td>
      <td>${l.env.doc}</td>
      <td>${l.env.temp}</td>
      <td>${l.env.season}</td>`;
    tr.addEventListener('click', () => selectLake(l.key));
    envBody.appendChild(tr);
  });

  // ---- daily metabolism grouped bar chart (Part 3, all lakes at once) ----
  (function renderDailyBars() {
    const nepColors = LAKES.map((l) => (SERIES.get(l.key).nep >= 0 ? goodColor : badColor));
    Plotly.newPlot('dailyBarPlot', [
      { x: LAKES.map((l) => l.label), y: LAKES.map((l) => SERIES.get(l.key).gpp), type: 'bar', name: 'GPP', marker: { color: gppColor }, hovertemplate: '%{y:.2f} mg/L/day<extra>GPP</extra>' },
      { x: LAKES.map((l) => l.label), y: LAKES.map((l) => SERIES.get(l.key).er), type: 'bar', name: 'ER', marker: { color: erColor }, hovertemplate: '%{y:.2f} mg/L/day<extra>ER</extra>' },
      { x: LAKES.map((l) => l.label), y: LAKES.map((l) => SERIES.get(l.key).nep), type: 'bar', name: 'NEP', marker: { color: nepColors }, hovertemplate: '%{y:.2f} mg/L/day<extra>NEP</extra>' },
    ], basePlotLayout({
      barmode: 'group', showlegend: true,
      legend: { orientation: 'h', y: 1.15, font: { color: cssVar('--text-secondary'), size: 11 } },
      xaxis: { type: 'category', gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') } },
      yaxis: { gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') }, zeroline: true, zerolinecolor: cssVar('--baseline') },
    }), { displayModeBar: false, responsive: true, scrollZoom: false });

    document.getElementById('revealDailyAnswers').addEventListener('click', () => {
      const byGpp = LAKES.slice().sort((a, b) => SERIES.get(b.key).gpp - SERIES.get(a.key).gpp)[0];
      const byEr = LAKES.slice().sort((a, b) => SERIES.get(b.key).er - SERIES.get(a.key).er)[0];
      const byNep = LAKES.slice().sort((a, b) => SERIES.get(b.key).nep - SERIES.get(a.key).nep)[0];
      const text = `${byGpp.label} produces the most oxygen each day (${SERIES.get(byGpp.key).gpp.toFixed(2)} mg/L/day GPP), and ` +
        `${byEr.label} also consumes the most (${SERIES.get(byEr.key).er.toFixed(2)} mg/L/day ER) &mdash; both records belong to the same lake. ` +
        `But the greatest carbon surplus goes to ${byNep.label} (NEP = +${SERIES.get(byNep.key).nep.toFixed(2)} mg/L/day), which never comes close to the highest GPP or ER. ` +
        `High production and high consumption can cancel each other out almost exactly &mdash; it's the gap between them, not the size of either one alone, that determines NEP.`;
      document.getElementById('dailyAnswersText').innerHTML = text;
      document.getElementById('dailyAnswersPanel').hidden = false;
    });
  })();

  // ---- Part 5: predictions + ranking reveal ----
  const predictions = {};
  const predictRows = document.getElementById('predictRows');
  const PREDICT_CHOICES = [
    { key: 'sink', label: 'Store carbon' },
    { key: 'source', label: 'Lose carbon' },
    { key: 'balance', label: 'Close to balance' },
  ];
  LAKES.forEach((l) => {
    const row = document.createElement('div');
    row.className = 'predict-row';
    row.innerHTML = `
      <div class="predict-lake">${l.emoji} ${l.label}</div>
      <div class="predict-toggle" data-lake="${l.key}"></div>
      <div class="predict-result" id="predictResult-${l.key}"></div>`;
    const toggle = row.querySelector('.predict-toggle');
    PREDICT_CHOICES.forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'res-btn sm';
      b.dataset.choice = c.key;
      b.textContent = c.label;
      b.addEventListener('click', () => {
        predictions[l.key] = c.key;
        toggle.querySelectorAll('.res-btn').forEach((x) => x.classList.toggle('active', x === b));
      });
      toggle.appendChild(b);
    });
    predictRows.appendChild(row);
  });

  document.getElementById('revealRanking').addEventListener('click', () => {
    const ranked = LAKES.slice().sort((a, b) => SERIES.get(b.key).seasonal.annual - SERIES.get(a.key).seasonal.annual);
    const maxAbs = Math.max(...ranked.map((l) => Math.abs(SERIES.get(l.key).seasonal.annual)));
    const rankList = document.getElementById('rankList');
    rankList.innerHTML = '';
    ranked.forEach((l) => {
      const annual = SERIES.get(l.key).seasonal.annual;
      const isSink = annual >= 0;
      const actual = Math.abs(annual) < 10 ? 'balance' : (isSink ? 'sink' : 'source');
      const guess = predictions[l.key];
      const resultEl = document.getElementById(`predictResult-${l.key}`);
      if (guess) resultEl.textContent = guess === actual ? '✅' : '❌';

      const row = document.createElement('div');
      row.className = 'rank-row';
      const widthPct = (Math.abs(annual) / maxAbs) * 100;
      row.innerHTML = `
        <div class="rank-lake">${l.emoji} ${l.label}</div>
        <div class="rank-track"><div class="rank-bar" style="left:0; width:${widthPct}%; background:${isSink ? goodColor : badColor};"></div></div>
        <div class="rank-value">${annual >= 0 ? '+' : ''}${annual.toFixed(0)}</div>`;
      rankList.appendChild(row);
    });

    const strongestSink = ranked[0];
    const strongestSource = ranked[ranked.length - 1];
    const balance = LAKES.slice().sort((a, b) => Math.abs(SERIES.get(a.key).seasonal.annual) - Math.abs(SERIES.get(b.key).seasonal.annual))[0];
    document.getElementById('rankSummary').innerHTML =
      `${strongestSink.label} is the strongest carbon <strong>sink</strong> here; ${balance.label} stays closest to <strong>balance</strong>, mostly because its ` +
      `growing season is so short; and ${strongestSource.label} is the strongest carbon <strong>source</strong> &mdash; even stronger, over a full year, than the ` +
      `much more dramatic-looking Eutrophic lake from Part 3. Units above are season-integrated mg O&#8322;/L (illustrative, not g C/m&sup2;/yr).`;
    document.getElementById('rankingPanel').hidden = false;
  });

  // ---- Part 6: carbon exchange map ----
  (function renderCarbonMap() {
    const band = document.getElementById('carbonMapBand');
    LAKES.forEach((l) => {
      const annual = SERIES.get(l.key).seasonal.annual;
      const isSink = annual >= 0;
      const div = document.createElement('div');
      div.className = 'carbon-map-lake';
      div.dataset.lake = l.key;
      div.style.left = `${l.mapPct}%`;
      div.style.cursor = 'pointer';
      div.innerHTML = `
        <span class="carbon-map-arrow ${isSink ? 'is-sink' : 'is-source'}">${isSink ? '↓ CO₂' : '↑ CO₂'}</span>
        <span class="carbon-map-lake-icon">${l.emoji}</span>
        <span class="carbon-map-lake-label">${l.label}</span>`;
      div.addEventListener('click', () => selectLake(l.key));
      band.appendChild(div);
    });
  })();

  // ---- Part 7: vote ----
  document.querySelectorAll('.vote-row .quiz-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.vote-row .quiz-option').forEach((b) => b.classList.toggle('selected', b === btn));
      document.getElementById('voteFeedback').hidden = false;
    });
  });

  // ---- notes (localStorage) ----
  const fingerprintNotes = document.getElementById('fingerprintNotes');
  fingerprintNotes.value = localStorage.getItem('compareLakes.fingerprintNotes') || '';
  fingerprintNotes.addEventListener('input', () => localStorage.setItem('compareLakes.fingerprintNotes', fingerprintNotes.value));
  const reflectionNotes = document.getElementById('reflectionNotes');
  reflectionNotes.value = localStorage.getItem('compareLakes.reflection') || '';
  reflectionNotes.addEventListener('input', () => localStorage.setItem('compareLakes.reflection', reflectionNotes.value));

  // ---- notice reveal (Part 1) ----
  let noticeOpen = false;
  function renderNotice(lake) {
    document.getElementById('noticeTitle').textContent = `What scientists typically notice: ${lake.label}`;
    const list = document.getElementById('noticeList');
    list.innerHTML = '';
    lake.notice.forEach((n) => {
      const li = document.createElement('li');
      li.innerHTML = n;
      list.appendChild(li);
    });
  }
  document.getElementById('revealNotice').addEventListener('click', () => {
    noticeOpen = !noticeOpen;
    document.getElementById('noticePanel').hidden = !noticeOpen;
    if (noticeOpen) renderNotice(LAKE_BY_KEY[currentLakeKey]);
  });

  // ==================================================================
  // Selection state - drives Part 1 dashboard, Part 4 budget, table
  // highlight, and the map highlight, all at once.
  // ==================================================================
  let currentLakeKey = 'oligo';

  // dot colors for the diel chart headers (fixed series identity, not lake-dependent)
  document.getElementById('dotDo').style.background = cssVar('--series-do');
  document.getElementById('dotTemp').style.background = cssVar('--series-wtemp');
  document.getElementById('dotPar').style.background = cssVar('--series-par');

  const doColor = cssVar('--series-do');
  const tempColor = cssVar('--series-wtemp');
  const parColor = cssVar('--series-par');

  function selectLake(key) {
    currentLakeKey = key;
    const lake = LAKE_BY_KEY[key];
    const s = SERIES.get(key);
    const hoursX = s.par.map((_, i) => i);

    lakeSwitch.querySelectorAll('.res-btn').forEach((b) => b.classList.toggle('active', b.dataset.lake === key));
    envBody.querySelectorAll('tr').forEach((tr) => tr.classList.toggle('active', tr.dataset.lake === key));
    document.querySelectorAll('.carbon-map-lake').forEach((el) => el.classList.toggle('active', el.dataset.lake === key));

    // stat tiles
    document.getElementById('stat-gpp').innerHTML = `+${s.gpp.toFixed(2)}<span class="unit"> mg/L/day</span>`;
    document.getElementById('stat-er').innerHTML = `&minus;${s.er.toFixed(2)}<span class="unit"> mg/L/day</span>`;
    document.getElementById('stat-nep').innerHTML = `${s.nep >= 0 ? '+' : ''}${s.nep.toFixed(2)}<span class="unit"> mg/L/day</span>`;
    document.getElementById('stat-sat').innerHTML = `${s.avgSat.toFixed(0)}<span class="unit">%</span>`;
    const statusEl = document.getElementById('stat-status');
    if (s.nep >= 0) { statusEl.textContent = 'Autotrophic'; statusEl.style.color = goodColor; }
    else { statusEl.textContent = 'Heterotrophic'; statusEl.style.color = badColor; }

    // diel charts
    Plotly.react('plot-do', [{
      x: hoursX, y: s.do, customdata: s.hourLabels, type: 'scatter', mode: 'lines',
      line: { color: doColor, width: 2.2, shape: 'spline', smoothing: 0.3 },
      hovertemplate: '%{customdata}<br>%{y:.2f} mg/L<extra></extra>',
    }], dielLayout(s.sunriseHr, s.sunsetHr), { displayModeBar: false, responsive: true, scrollZoom: false });

    Plotly.react('plot-wtemp', [{
      x: hoursX, y: s.temp, customdata: s.hourLabels, type: 'scatter', mode: 'lines',
      line: { color: tempColor, width: 2.2, shape: 'spline', smoothing: 0.3 },
      hovertemplate: '%{customdata}<br>%{y:.1f}°C<extra></extra>',
    }], dielLayout(s.sunriseHr, s.sunsetHr), { displayModeBar: false, responsive: true, scrollZoom: false });

    Plotly.react('plot-par', [{
      x: hoursX, y: s.par, customdata: s.hourLabels, type: 'scatter', mode: 'lines',
      line: { color: parColor, width: 2.2, shape: 'spline', smoothing: 0.3 },
      hovertemplate: '%{customdata}<br>%{y:.0f} &micro;mol/m&sup2;/s<extra></extra>',
    }], dielLayout(s.sunriseHr, s.sunsetHr), { displayModeBar: false, responsive: true, scrollZoom: false });

    // seasonal chart
    Plotly.react('seasonalPlot', [
      { x: s.seasonal.days, y: s.seasonal.gpp, type: 'scatter', mode: 'lines', line: { color: gppColor, width: 2, shape: 'spline', smoothing: 0.3 }, connectgaps: false, hovertemplate: '%{y:.2f} mg/L/day<extra>GPP</extra>' },
      { x: s.seasonal.days, y: s.seasonal.er, type: 'scatter', mode: 'lines', line: { color: erColor, width: 2, shape: 'spline', smoothing: 0.3 }, connectgaps: false, hovertemplate: '%{y:.2f} mg/L/day<extra>ER</extra>' },
    ], basePlotLayout({
      xaxis: { range: [1, 365], tickmode: 'array', tickvals: MONTH_STARTS, ticktext: MONTHS, gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') } },
    }), { displayModeBar: false, responsive: true, scrollZoom: false });

    const seasonWord = s.seasonal.activeDays >= 360 ? 'all 365 days of the year' : `${s.seasonal.activeDays} ice-free days`;
    document.getElementById('seasonalCaption').innerHTML =
      `${lake.label} is active for ${seasonWord}, peaking around ${doyToLabel(s.seasonal.peakDay)}. Season-integrated NEP: ` +
      `<strong style="color:${s.seasonal.annual >= 0 ? goodColor : badColor}">${s.seasonal.annual >= 0 ? '+' : ''}${s.seasonal.annual.toFixed(0)}</strong> ` +
      `(illustrative units) &mdash; ${s.seasonal.annual >= 0 ? 'a net carbon sink' : 'a net carbon source'} over the year.`;

    // notice panel (only re-render if currently open)
    if (noticeOpen) renderNotice(lake);

    // Part 4 budget meter - scaled against the largest GPP/ER across all lakes
    const maxFlow = Math.max(...LAKES.map((l) => Math.max(SERIES.get(l.key).gpp, SERIES.get(l.key).er)));
    document.getElementById('fillGpp').style.width = `${(s.gpp / maxFlow) * 100}%`;
    document.getElementById('fillEr').style.width = `${(s.er / maxFlow) * 100}%`;
    document.getElementById('valGpp').textContent = `+${s.gpp.toFixed(2)}`;
    document.getElementById('valEr').textContent = `−${s.er.toFixed(2)}`;
    document.getElementById('budgetEquationText').innerHTML =
      `${s.gpp.toFixed(2)} &minus; ${s.er.toFixed(2)} = <span style="color:${s.nep >= 0 ? goodColor : badColor}">${s.nep >= 0 ? '+' : ''}${s.nep.toFixed(2)} mg/L/day</span>`;

    const maxNep = Math.max(...LAKES.map((l) => Math.abs(SERIES.get(l.key).nep)));
    const tankFill = document.getElementById('tankFill');
    const fillPct = (Math.abs(s.nep) / maxNep) * 48; // up to 48% of tank height each direction
    tankFill.className = 'budget-tank-fill ' + (s.nep >= 0 ? 'is-positive' : 'is-negative');
    tankFill.style.height = `${fillPct}%`;
    document.getElementById('tankLabel').textContent = s.nep >= 0 ? 'Storage rising' : 'Storage draining';
  }

  lakeSwitch.addEventListener('click', (e) => {
    const btn = e.target.closest('.res-btn');
    if (!btn) return;
    selectLake(btn.dataset.lake);
  });

  selectLake(currentLakeKey);
})();
