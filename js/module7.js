(() => {
  'use strict';

  const { cssVar, stripOffset, buildNightLayer } = window.LakeCommon;

  // Bump when data/lakes_compare.json changes (same cache-busting idea as common.js).
  const LAKES_DATA_URL = 'data/lakes_compare.json?v=5';

  const LAKE_KEYS = ['mendota', 'troutbog', 'troutlake'];
  const LAKE_COLOR = {
    mendota: cssVar('--series-wind'),
    troutbog: cssVar('--series-wtemp'),
    troutlake: cssVar('--series-do'),
  };
  const LAKE_EMOJI = { mendota: '\u{1F33F}', troutbog: '\u{1F341}', troutlake: '\u{1F48E}' };

  // The two-day window used throughout (July 2-3, 2019) out of the 7 days in the data file.
  const DAY0 = 1, NDAYS = 2;
  const H0 = DAY0 * 24, H1 = (DAY0 + NDAYS) * 24;

  // O2 solubility at 100% saturation (same curve used throughout the app).
  const doSat = (t) => (t == null ? null : 14.652 - 0.41022 * t + 0.007991 * t * t - 0.000077774 * t * t * t);

  // ---- saved text answers (localStorage) - independent of the data fetch ----
  [
    { id: 'sketchWhyNotes', key: 'compareLakes.sketchWhyNotes' },
    { id: 'fingerprintNotes', key: 'compareLakes.fingerprintNotes' },
  ].forEach((nt) => {
    const el = document.getElementById(nt.id);
    el.value = localStorage.getItem(nt.key) || '';
    el.addEventListener('input', () => localStorage.setItem(nt.key, el.value));
  });

  fetch(LAKES_DATA_URL)
    .then((r) => r.json())
    .then(init)
    .catch((err) => {
      document.querySelector('.content').innerHTML =
        '<p style="padding:40px;color:var(--text-secondary)">Could not load lake data (' + err + ').</p>';
    });

  const mean = (arr) => {
    const v = arr.filter((x) => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const fmt = (v, d = 1) => (v == null ? '–' : v.toFixed(d));

  function init(data) {
    // Two-day slice of each lake: hourly values, x labels, and the day/night layer.
    const lakes = {};
    LAKE_KEYS.forEach((k) => {
      const l = data.lakes[k];
      const hourly = l.hourly.slice(H0, H1);
      lakes[k] = { name: l.name, trophic: l.trophic, hourly, days: l.days.slice(DAY0, DAY0 + NDAYS), xs: hourly.map((h) => stripOffset(h.t)) };
    });
    const n = lakes.mendota.hourly.length;
    const xs = lakes.mendota.xs;
    const night = buildNightLayer({ hourly: lakes.mendota.hourly, days: lakes.mendota.days });

    const baseLayout = (extra) => Object.assign({
      margin: { l: 56, r: 12, t: 26, b: 28 },
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      font: { family: 'system-ui, -apple-system, "Segoe UI", sans-serif', color: cssVar('--text-secondary'), size: 11 },
      showlegend: false,
      xaxis: {
        type: 'date', range: [xs[0], xs[n - 1]],
        gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') },
        tickformat: '%a %-d', hoverformat: '%a %-I %p',
      },
      yaxis: { gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') }, zeroline: false },
      hovermode: 'x',
    }, extra || {});
    const yTitle = (t) => ({ text: t, font: { size: 11, color: cssVar('--text-muted') } });

    // ------------------------------------------------------------------
    // Predict: drag a vertical bar in each lake's column to mark the range between a
    // typical day's lowest and highest oxygen (% saturation). "Reveal" adds box plots of
    // the real July 2019 daily lows and highs for each lake.
    // ------------------------------------------------------------------
    const Y_RANGE = [0, 240];
    const LABEL = { mendota: 'Lake Mendota', troutbog: 'Trout Bog', troutlake: 'Trout Lake' };
    const LABELS = LAKE_KEYS.map((k) => LABEL[k]);
    const plotEl = document.getElementById('drawPlot');
    const surface = document.getElementById('drawSurface');
    const drawn = {};   // lake -> { lo, hi } in % saturation
    const rgba = (hex, a) => {
      const h = hex.replace('#', '');
      const v = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
      return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${a})`;
    };
    const median = (arr) => {
      const v = arr.filter((x) => x != null).sort((a, b) => a - b);
      if (!v.length) return null;
      const m = Math.floor(v.length / 2);
      return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
    };
    const daily = {};
    LAKE_KEYS.forEach((k) => { daily[k] = { low: data.lakes[k].diel.daily_low_sat_pct, high: data.lakes[k].diel.daily_high_sat_pct }; });

    const axisStyle = { gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') } };
    Plotly.newPlot('drawPlot', LAKE_KEYS.map((k) => ({
      x: [LABEL[k], LABEL[k]], y: [null, null], type: 'scatter', mode: 'lines+markers', hoverinfo: 'skip',
      line: { color: LAKE_COLOR[k], width: 8 }, marker: { color: LAKE_COLOR[k], size: 14, symbol: 'line-ew-open', line: { width: 4, color: LAKE_COLOR[k] } },
    })), baseLayout({
      margin: { l: 56, r: 12, t: 12, b: 36 },
      hovermode: false, dragmode: false, boxmode: 'group', boxgap: 0.35,
      shapes: [{ type: 'line', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: 100, y1: 100, line: { color: cssVar('--baseline'), width: 1.5, dash: 'dot' } }],
      annotations: [{ xref: 'paper', x: 1, xanchor: 'right', y: 100, yanchor: 'bottom', yref: 'y', text: '100% = in balance with the air', showarrow: false, font: { size: 10, color: cssVar('--text-muted') } }],
      xaxis: Object.assign({ type: 'category', categoryarray: LABELS, range: [-0.5, LAKE_KEYS.length - 0.5], fixedrange: true }, axisStyle),
      yaxis: Object.assign({ title: yTitle('Dissolved oxygen (% saturation)'), range: Y_RANGE, tickvals: [0, 50, 100, 150, 200], fixedrange: true, zeroline: false }, axisStyle),
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

    function pointer(e) {
      const r = surface.getBoundingClientRect();
      const fx = Math.max(0, Math.min(0.999, (e.clientX - r.left) / r.width));
      const fy = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
      return { lake: Math.floor(fx * LAKE_KEYS.length), v: Y_RANGE[0] + (1 - fy) * (Y_RANGE[1] - Y_RANGE[0]) };
    }
    let active = null;   // { key, anchor }
    function setRange(key, a, b) {
      drawn[key] = { lo: Math.min(a, b), hi: Math.max(a, b) };
      Plotly.restyle('drawPlot', { y: [[drawn[key].lo, drawn[key].hi]] }, [LAKE_KEYS.indexOf(key)]);
    }
    surface.addEventListener('pointerdown', (e) => {
      surface.setPointerCapture(e.pointerId);
      const pt = pointer(e);
      active = { key: LAKE_KEYS[pt.lake], anchor: pt.v };
      setRange(active.key, pt.v, pt.v);
    });
    surface.addEventListener('pointermove', (e) => { if (active) setRange(active.key, active.anchor, pointer(e).v); });
    ['pointerup', 'pointercancel'].forEach((ev) => surface.addEventListener(ev, () => { active = null; }));

    document.getElementById('drawClear').addEventListener('click', () => {
      LAKE_KEYS.forEach((k) => { delete drawn[k]; });
      Plotly.restyle('drawPlot', { y: LAKE_KEYS.map(() => [null, null]) }, LAKE_KEYS.map((_, i) => i));
    });

    // Daily swing = mean over the two days of (max - min); used by the dynamics summary.
    function swing(series) {
      const perDay = [];
      for (let d = 0; d < NDAYS; d++) {
        const v = series.slice(d * 24, (d + 1) * 24).filter((x) => x != null);
        if (v.length >= 12) perDay.push(Math.max(...v) - Math.min(...v));
      }
      return mean(perDay);
    }

    let revealed = false;
    document.getElementById('drawReveal').addEventListener('click', () => {
      if (!revealed) {
        revealed = true;
        const boxes = [];
        LAKE_KEYS.forEach((k) => {
          [['low', 'low', 'Daily low'], ['high', 'high', 'Daily high']].forEach(([field, group, name]) => {
            boxes.push({
              type: 'box', y: daily[k][field], x: daily[k][field].map(() => LABEL[k]), name, offsetgroup: group, legendgroup: group,
              boxpoints: 'outliers', marker: { color: LAKE_COLOR[k], size: 4 }, line: { color: LAKE_COLOR[k], width: 2 }, fillcolor: rgba(LAKE_COLOR[k], 0.35),
              hovertemplate: `%{y:.0f}%<extra>${LABEL[k]} ${name.toLowerCase()}</extra>`,
            });
          });
        });
        Plotly.addTraces('drawPlot', boxes);
        Plotly.relayout('drawPlot', { hovermode: 'closest' });
      }
      document.getElementById('drawRealKey').hidden = false;

      const real = LAKE_KEYS.map((k) => `${LABEL[k]} typically drops to about ${fmt(median(daily[k].low), 0)}% each day and rises to about ${fmt(median(daily[k].high), 0)}%`);
      const text = `Real data (${daily.mendota.low.length} days in July 2019, median daily low and high): ${real[0]}; ${real[1]}; and ${real[2]}.`;
      const fb = document.getElementById('drawFeedback');
      fb.textContent = text;
      fb.hidden = false;
      document.getElementById('exploreWrap').hidden = false;
    });

    // ------------------------------------------------------------------
    // Drivers match game: rank the lakes (lowest -> highest) for N, P, light, temperature
    // ------------------------------------------------------------------
    const drivers = {};
    LAKE_KEYS.forEach((k) => { drivers[k] = data.lakes[k].drivers; });
    const DRIVERS = [
      { id: 'tn', label: 'Nitrogen (N)', field: 'tn_ugl', unit: 'µg/L', digits: 0, plot: 'plot-tn' },
      { id: 'tp', label: 'Phosphorus (P)', field: 'tp_ugl', unit: 'µg/L', digits: 0, plot: 'plot-tp' },
      { id: 'par', label: 'Light (PAR)', field: 'par_mean', unit: 'µmol/m²/s', digits: 0, plot: 'plot-parmean' },
      { id: 'temp', label: 'Water temperature', field: 'temp_mean', unit: '°C', digits: 1, plot: 'plot-tempmean' },
    ];
    const RANKS = ['Lowest', 'Middle', 'Highest'];
    const answers = {};   // driver id -> lakes ordered lowest -> highest
    DRIVERS.forEach((d) => {
      answers[d.id] = LAKE_KEYS.slice().sort((a, b) => drivers[a][d.field] - drivers[b][d.field]);
    });
    const pick = {};      // driver id -> [lake|null x 3]
    DRIVERS.forEach((d) => { pick[d.id] = [null, null, null]; });
    const CHIP_LABEL = { mendota: '\u{1F33F} Lake Mendota', troutbog: '\u{1F341} Trout Bog', troutlake: '\u{1F48E} Trout Lake' };

    const rowsEl = document.getElementById('driverRows');
    DRIVERS.forEach((d) => {
      const row = document.createElement('div');
      row.className = 'match-row';
      row.innerHTML = `<div class="match-label">${d.label}</div><div class="match-slots3">${
        RANKS.map((r, i) => `<div class="match-slot" data-driver="${d.id}" data-rank="${i}" data-hint="${r}"></div>`).join('')}</div>`;
      rowsEl.appendChild(row);
    });
    const slotEl = (id, rank) => document.querySelector(`.match-slot[data-driver="${id}"][data-rank="${rank}"]`);
    function renderSlot(id, rank) {
      const el = slotEl(id, rank);
      const lake = pick[id][rank];
      el.classList.remove('correct', 'incorrect');
      el.innerHTML = lake
        ? `<span class="match-chip">${CHIP_LABEL[lake]}</span><button type="button" class="match-slot-clear" aria-label="Clear">&times;</button>`
        : '';
    }
    function assign(id, rank, lake) { pick[id][rank] = lake; renderSlot(id, rank); }

    let selectedLake = null;
    document.getElementById('driverGame').addEventListener('click', (e) => {
      const chip = e.target.closest('.match-tray .match-chip');
      if (chip) {
        const was = chip.classList.contains('selected');
        document.querySelectorAll('#driverTray .match-chip').forEach((c) => c.classList.remove('selected'));
        selectedLake = was ? null : chip.dataset.lake;
        if (selectedLake) chip.classList.add('selected');
        return;
      }
      const clear = e.target.closest('.match-slot-clear');
      if (clear) {
        const sl = clear.closest('.match-slot');
        assign(sl.dataset.driver, +sl.dataset.rank, null);
        return;
      }
      const slot = e.target.closest('.match-slot');
      if (slot && selectedLake) assign(slot.dataset.driver, +slot.dataset.rank, selectedLake);
    });
    document.querySelectorAll('#driverTray .match-chip').forEach((chip) => {
      chip.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', chip.dataset.lake));
    });
    document.getElementById('driverRows').addEventListener('dragover', (e) => {
      const slot = e.target.closest('.match-slot');
      if (slot) { e.preventDefault(); slot.classList.add('over'); }
    });
    document.getElementById('driverRows').addEventListener('dragleave', (e) => {
      const slot = e.target.closest('.match-slot');
      if (slot) slot.classList.remove('over');
    });
    document.getElementById('driverRows').addEventListener('drop', (e) => {
      const slot = e.target.closest('.match-slot');
      if (!slot) return;
      e.preventDefault();
      slot.classList.remove('over');
      const lake = e.dataTransfer.getData('text/plain');
      if (lake) assign(slot.dataset.driver, +slot.dataset.rank, lake);
    });

    let driversShown = false;
    document.getElementById('revealDrivers').addEventListener('click', () => {
      // grade each filled slot against the real ranking, show the right answer on misses
      DRIVERS.forEach((d) => {
        RANKS.forEach((_, i) => {
          const el = slotEl(d.id, i);
          const ok = pick[d.id][i] === answers[d.id][i];
          el.classList.toggle('correct', ok);
          el.classList.toggle('incorrect', !ok);
          el.querySelectorAll('.match-slot-answer').forEach((x) => x.remove());
          if (!ok) {
            const ans = document.createElement('span');
            ans.className = 'match-slot-answer';
            ans.textContent = `(answer: ${LABEL[answers[d.id][i]]})`;
            el.appendChild(ans);
          }
        });
      });

      document.getElementById('driversPanel').hidden = false;
      DRIVERS.forEach((d) => {
        const y = LAKE_KEYS.map((k) => drivers[k][d.field]);
        const trace = {
          x: LABELS, y, type: 'bar', marker: { color: LAKE_KEYS.map((k) => LAKE_COLOR[k]) },
          text: y.map((v) => v.toFixed(d.digits)), textposition: 'outside', cliponaxis: false,
          hovertemplate: `%{y:.${d.digits}f} ${d.unit}<extra>%{x}</extra>`,
        };
        const layout = baseLayout({
          margin: { l: 48, r: 8, t: 22, b: 28 }, hovermode: 'closest',
          xaxis: { type: 'category', gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') } },
          yaxis: Object.assign({ rangemode: 'tozero', zeroline: false }, axisStyle),
        });
        (driversShown ? Plotly.react : Plotly.newPlot)(d.plot, [trace], layout, { displayModeBar: false, responsive: true, scrollZoom: false });
      });
      driversShown = true;

      const v = (k, f, dg) => drivers[k][f].toFixed(dg);
      document.getElementById('driversText').textContent =
        `Summer 2019: nitrogen and phosphorus both climb from Trout Lake (${v('troutlake', 'tn_ugl', 0)} µg/L N, ${v('troutlake', 'tp_ugl', 0)} µg/L P) to Trout Bog (${v('troutbog', 'tn_ugl', 0)}, ${v('troutbog', 'tp_ugl', 0)}) to Mendota ` +
        `(${v('mendota', 'tn_ugl', 0)}, ${v('mendota', 'tp_ugl', 0)}) - and Mendota is also the sunniest and warmest (${v('mendota', 'par_mean', 0)} µmol/m²/s, ${v('mendota', 'temp_mean', 1)} °C). ` +
        `That is the recipe for lots of algae, lots of photosynthesis, and big oxygen swings. But nutrients aren't the whole story: Trout Bog has more N and P than Trout Lake yet much lower oxygen, because its water is so dark ` +
        `(${v('troutbog', 'doc_mgl', 0)} mg/L of dissolved organic carbon, versus ${v('mendota', 'doc_mgl', 0)} in Mendota and ${v('troutlake', 'doc_mgl', 0)} in Trout Lake) that little light gets down to power photosynthesis, while that same carbon fuels respiration. ` +
        `(Trout Bog's light here is measured 25 cm below the surface, so it is lower than the other lakes by design.)`;
    });

    // ------------------------------------------------------------------
    // GPP, ER & NEP by lake: predict autotrophic / balanced / heterotrophic, then reveal
    // ------------------------------------------------------------------
    const metab = {};
    LAKE_KEYS.forEach((k) => { metab[k] = data.lakes[k].metabolism; });
    const stats = (arr) => {
      const v = arr.filter((x) => x != null);
      const m = v.reduce((a, b) => a + b, 0) / v.length;
      return { mean: m, sd: Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length), n: v.length };
    };
    const MSTAT = {};
    LAKE_KEYS.forEach((k) => {
      MSTAT[k] = { gpp: stats(metab[k].daily.map((d) => d.gpp)), er: stats(metab[k].daily.map((d) => d.er)), nep: stats(metab[k].daily.map((d) => d.nep)) };
    });
    // A lake counts as "about balanced" when its average NEP can't be told apart from zero given the
    // day-to-day scatter: within 2 standard errors (2 x SD / sqrt(days)); otherwise the sign of NEP decides.
    const classify = (k) => {
      const nep = MSTAT[k].nep;
      if (Math.abs(nep.mean) < (2 * nep.sd) / Math.sqrt(nep.n)) return 'balanced';
      return nep.mean > 0 ? 'auto' : 'hetero';
    };
    const CLASS_LABEL = { auto: 'Autotrophic (GPP > ER)', balanced: 'About balanced', hetero: 'Heterotrophic (ER > GPP)' };
    const metabPick = {};
    const predictEl = document.getElementById('metabPredict');
    LAKE_KEYS.forEach((k) => {
      const row = document.createElement('div');
      row.className = 'match-row';
      row.innerHTML = `<div class="match-label">${CHIP_LABEL[k]}</div>
        <div class="res-switch" data-lake="${k}">${['auto', 'balanced', 'hetero'].map((c) => `<button type="button" class="res-btn" data-class="${c}">${CLASS_LABEL[c]}</button>`).join('')}</div>`;
      predictEl.appendChild(row);
    });
    predictEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.res-btn');
      if (!btn) return;
      const sw = btn.closest('.res-switch');
      metabPick[sw.dataset.lake] = btn.dataset.class;
      sw.querySelectorAll('.res-btn').forEach((b) => b.classList.toggle('active', b === btn));
      clearMetabMarks(sw);   // a changed answer drops the old grading until the next reveal
    });
    function clearMetabMarks(sw) {
      sw.querySelectorAll('.res-btn').forEach((b) => { b.classList.remove('metab-right', 'metab-wrong'); });
      sw.querySelectorAll('.metab-mark, .match-slot-answer').forEach((el) => el.remove());
    }

    document.getElementById('revealMetab').addEventListener('click', () => {
      document.getElementById('metabPanel').hidden = false;
      // grade each prediction: a check mark on the right ones, the answer shown on the misses
      document.querySelectorAll('#metabPredict .res-switch').forEach((sw) => {
        const lake = sw.dataset.lake;
        clearMetabMarks(sw);
        const chosen = metabPick[lake];
        if (!chosen) return;
        const btn = sw.querySelector(`.res-btn[data-class="${chosen}"]`);
        if (chosen === classify(lake)) {
          btn.classList.add('metab-right');
          btn.insertAdjacentHTML('beforeend', ' <span class="metab-mark" aria-label="correct">\u2713</span>');
        } else {
          btn.classList.add('metab-wrong');
          sw.insertAdjacentHTML('beforeend', `<span class="match-slot-answer" style="align-self:center; margin-left:8px;">(answer: ${CLASS_LABEL[classify(lake)].split(' (')[0].toLowerCase()})</span>`);
        }
      });
      const bar = (field, name, color) => ({
        x: LABELS, y: LAKE_KEYS.map((k) => MSTAT[k][field].mean), type: 'bar', name, marker: { color },
        error_y: { type: 'data', array: LAKE_KEYS.map((k) => MSTAT[k][field].sd), visible: true, color: cssVar('--text-muted'), thickness: 1.2, width: 4 },
        hovertemplate: `%{y:.2f} mg O₂/L/day<extra>${name} · %{x}</extra>`,
      });
      Plotly.react('plot-metab', [
        bar('gpp', 'GPP', cssVar('--flux-add')), bar('er', 'ER', cssVar('--flux-remove')), bar('nep', 'NEP', cssVar('--series-do')),
      ], baseLayout({
        margin: { l: 56, r: 12, t: 12, b: 36 }, barmode: 'group', hovermode: 'closest',
        xaxis: { type: 'category', gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') } },
        yaxis: Object.assign({ title: yTitle('mg O₂/L/day'), zeroline: true, zerolinecolor: cssVar('--baseline') }, axisStyle),
      }), { displayModeBar: false, responsive: true, scrollZoom: false });

      const f2 = (v) => (v >= 0 ? '+' : '') + v.toFixed(2);
      const parts = LAKE_KEYS.map((k) => `${LABEL[k]}: GPP ${MSTAT[k].gpp.mean.toFixed(2)}, ER ${MSTAT[k].er.mean.toFixed(2)}, NEP ${f2(MSTAT[k].nep.mean)} - ${CLASS_LABEL[classify(k)].split(' (')[0].toLowerCase()}`);
      let text = `July 2019 averages (mg O₂/L/day): ${parts.join('; ')}. `;
      const answered = LAKE_KEYS.filter((k) => metabPick[k]);
      if (answered.length) {
        text += 'Your predictions: ' + answered.map((k) => `${LABEL[k]} - ${CLASS_LABEL[metabPick[k]].split(' (')[0].toLowerCase()} (${metabPick[k] === classify(k) ? 'matches' : 'differs'})`).join('; ') + '. ';
      }
      text += 'Mendota\u2019s abundant nutrients and light grow so many algae that photosynthesis outpaces respiration. Trout Bog is the opposite: its dark water starves algae of light so GPP is tiny, while carbon washed in from the surrounding forest fuels respiration, making it strongly heterotrophic. Trout Lake is clear but so nutrient-poor that both processes are small and nearly cancel: its average NEP is about zero, well within its day-to-day ups and downs, so it is about balanced.';
      document.getElementById('metabText').textContent = text;
      document.getElementById('metabCaveat').textContent =
        'Estimates use the same bookkeeping method as Module 6 and are rough, especially for the bog. Mendota and Trout Lake use measured wind and a mixed-layer depth from their thermistor chains (about ' +
        `${metab.mendota.mean_z_mix.toFixed(0)} m and ${metab.troutlake.mean_z_mix.toFixed(0)} m); Trout Bog has no wind record after 2014 and no July 2019 temperature profile, so its July-average wind from 2003–2014 (${metab.troutbog.wind_source.match(/\(([^)]+) m\/s/)[1]} m/s) and an assumed 1 m mixed layer were used. ` +
        'Rates are per liter at the sensor, so lakes with very different mixing depths are not directly comparable per square meter.';
    });

    document.getElementById('exploreBtn').addEventListener('click', () => {
      const block = document.getElementById('dynamicsBlock');
      block.hidden = false;
      document.getElementById('exploreWrap').hidden = true;
      block.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  // ====================================================================
  // Cascade whole-lake nutrient experiment (end of the module): Paul (reference) vs Peter
  // (fertilized June 1-29), 2015. Day-of-year values in the data are shown as calendar dates.
  // ====================================================================
  const CASCADE_URL = 'data/cascade.json?v=1';
  const EXP_YEAR = '2015';
  const EXP_LAKES = ['Paul', 'Peter'];
  const EXP_COLOR = { Paul: cssVar('--series-do'), Peter: cssVar('--series-wind') };
  const FERT_COLOR = cssVar('--series-wtemp');

  let cascade = null, expBuilt = false;
  [{ id: 'experimentNotes', key: 'compareLakes.experimentNotes' }, { id: 'referenceLakeNotes', key: 'compareLakes.referenceNotes' }, { id: 'manipulateNotes', key: 'compareLakes.manipulateNotes' }].forEach((nt) => {
    const el = document.getElementById(nt.id);
    el.value = localStorage.getItem(nt.key) || '';
    el.addEventListener('input', () => localStorage.setItem(nt.key, el.value));
  });

  fetch(CASCADE_URL).then((r) => r.json()).then((cd) => { cascade = cd; maybeBuildExperiment(); })
    .catch((err) => { console.warn('Could not load experiment data', err); });
  // The plots are built once the (initially hidden) dynamics block is visible, so they get
  // their real width; whichever of "data loaded" or "block opened" happens last triggers it.
  document.getElementById('exploreBtn').addEventListener('click', () => setTimeout(maybeBuildExperiment, 0));

  // "How would you change GPP in a lake?": the reveal unlocks once there is an answer, shows the
  // lead-in sentence, then opens the whole-lake experiment below.
  const manipNotes = document.getElementById('manipulateNotes');
  const manipBtn = document.getElementById('manipulateReveal');
  const syncManipBtn = () => { manipBtn.disabled = manipNotes.value.trim().length === 0; };
  manipNotes.addEventListener('input', syncManipBtn);
  syncManipBtn();
  manipBtn.addEventListener('click', () => {
    document.getElementById('manipulateText').hidden = false;
    manipBtn.hidden = true;
    const block = document.getElementById('expBlock');
    block.hidden = false;
    maybeBuildExperiment();   // built now that its container is visible
    setTimeout(() => {
      const top = block.getBoundingClientRect().top + window.scrollY - 70;
      window.scrollTo({ top, behavior: 'smooth' });
    }, 900);
  });

  function maybeBuildExperiment() {
    if (!cascade || expBuilt || document.getElementById('dynamicsBlock').hidden || document.getElementById('expBlock').hidden) return;
    expBuilt = true;
    buildExperiment(cascade);
  }

  function buildExperiment(cd) {
    const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const doyToIso = (doy) => new Date(Date.UTC(+EXP_YEAR, 0, doy)).toISOString().slice(0, 10);   // doy 1 -> Jan 1
    const doyLabel = (doy) => { const d = new Date(Date.UTC(+EXP_YEAR, 0, doy)); return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}`; };
    const axisStyle = { gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') } };
    const yTitle = (t) => ({ text: t, font: { size: 11, color: cssVar('--text-muted') } });
    const Y = cd.years[EXP_YEAR];
    const [f0, f1] = cd.fertilized_days[EXP_YEAR].Peter;
    const dates = Y.doy.map(doyToIso);
    const n = dates.length;
    const fertText = `nutrients added to Peter: ${doyLabel(f0)} \u2013 ${doyLabel(f1)}`;

    // The shaded nutrient window, with its dates written on the chart.
    const fertShape = () => ({
      type: 'rect', xref: 'x', yref: 'paper', x0: doyToIso(f0), x1: doyToIso(f1), y0: 0, y1: 1,
      fillcolor: cssVar('--night-fill'), line: { width: 0 }, layer: 'below',
    });
    const fertEdges = [f0, f1].map((d) => ({ type: 'line', xref: 'x', yref: 'paper', x0: doyToIso(d), x1: doyToIso(d), y0: 0, y1: 1, line: { color: FERT_COLOR, width: 1.5, dash: 'dot' } }));
    const fertNote = (small) => ({
      xref: 'x', yref: 'paper', x: doyToIso((f0 + f1) / 2), y: 1, yanchor: 'bottom', xanchor: 'center', showarrow: false,
      text: small ? `${doyLabel(f0)}\u2013${doyLabel(f1)}` : fertText, font: { size: small ? 10 : 11, color: cssVar('--text-secondary') },
    });
    const layoutBase = (extra) => Object.assign({
      margin: { l: 52, r: 10, t: 22, b: 28 }, paper_bgcolor: 'transparent', plot_bgcolor: 'transparent', showlegend: false,
      font: { family: 'system-ui, -apple-system, "Segoe UI", sans-serif', color: cssVar('--text-secondary'), size: 11 },
      xaxis: Object.assign({ type: 'date', tickformat: '%b %-d', hoverformat: '%b %-d' }, axisStyle),
      yaxis: Object.assign({ zeroline: false }, axisStyle), hovermode: 'x',
    }, extra || {});

    // ---- sketch: GPP for an unfertilized and a fertilized lake ----
    const gppMax = Math.max(...EXP_LAKES.map((l) => Math.max(...Y.lakes[l].gpp.filter((v) => v != null))));
    const Y_RANGE = [0, Math.ceil(gppMax * 1.2 * 2) / 2];
    const keys = ['paul', 'fert'];
    const drawn = { paul: new Array(n).fill(null), fert: new Array(n).fill(null) };
    const drawColor = { paul: EXP_COLOR.Paul, fert: FERT_COLOR };
    let drawKey = 'paul';
    const plotEl = document.getElementById('expDrawPlot');
    const surface = document.getElementById('expDrawSurface');

    Plotly.newPlot('expDrawPlot', [
      ...keys.map((k) => ({ x: dates, y: drawn[k], type: 'scatter', mode: 'lines', hoverinfo: 'skip', line: { color: drawColor[k], width: 3.5 }, connectgaps: false })),
      ...EXP_LAKES.map((l) => ({ x: dates, y: new Array(n).fill(null), type: 'scatter', mode: 'lines', hoverinfo: 'skip', line: { color: EXP_COLOR[l], width: 2.5, dash: 'dash' }, connectgaps: true })),
    ], layoutBase({
      margin: { l: 56, r: 12, t: 24, b: 28 }, hovermode: false, dragmode: false,
      shapes: [fertShape(), ...fertEdges], annotations: [fertNote(false)],
      xaxis: Object.assign({ type: 'date', tickformat: '%b %-d', fixedrange: true, range: [dates[0], dates[n - 1]] }, axisStyle),
      yaxis: Object.assign({ title: yTitle('GPP (mg O₂/L/day)'), range: Y_RANGE, fixedrange: true, zeroline: false }, axisStyle),
    }), { displayModeBar: false, responsive: true, scrollZoom: false });

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
      return { i: Math.round(fx * (n - 1)), v: Y_RANGE[0] + (1 - fy) * (Y_RANGE[1] - Y_RANGE[0]) };
    }
    let last = null;
    function paint(e) {
      const pt = pointToBin(e);
      const arr = drawn[drawKey];
      if (last && last.i !== pt.i) {
        const step = pt.i > last.i ? 1 : -1;
        for (let i = last.i; i !== pt.i + step; i += step) arr[i] = last.v + ((pt.v - last.v) * (i - last.i)) / (pt.i - last.i);
      } else {
        arr[pt.i] = pt.v;
      }
      last = pt;
      Plotly.restyle('expDrawPlot', { y: [arr.slice()] }, [keys.indexOf(drawKey)]);
    }
    surface.addEventListener('pointerdown', (e) => { surface.setPointerCapture(e.pointerId); last = null; paint(e); });
    surface.addEventListener('pointermove', (e) => { if (last) paint(e); });
    ['pointerup', 'pointercancel'].forEach((ev) => surface.addEventListener(ev, () => { last = null; }));
    document.getElementById('expDrawSwitch').addEventListener('click', (e) => {
      const btn = e.target.closest('.res-btn');
      if (!btn) return;
      drawKey = btn.dataset.draw;
      document.querySelectorAll('#expDrawSwitch .res-btn').forEach((b) => b.classList.toggle('active', b === btn));
    });
    document.getElementById('expDrawClear').addEventListener('click', () => {
      keys.forEach((k) => drawn[k].fill(null));
      Plotly.restyle('expDrawPlot', { y: keys.map((k) => drawn[k].slice()) }, keys.map((_, i) => i));
    });

    // ---- explorer: chlorophyll, GPP, ER, NEP for Paul vs Peter ----
    const PLOTS = [
      { id: 'plot-expchl', field: 'chl', title: 'Chlorophyll' },
      { id: 'plot-expgpp', field: 'gpp', title: 'GPP (mg O₂/L/day)' },
      { id: 'plot-exper', field: 'er', title: 'ER (mg O₂/L/day)' },
      { id: 'plot-expnep', field: 'nep', title: 'NEP (mg O₂/L/day)' },
    ];
    function renderExplorer() {
      PLOTS.forEach((p) => {
        const traces = EXP_LAKES.map((l) => ({
          x: dates, y: Y.lakes[l][p.field], type: 'scatter', mode: 'lines', connectgaps: true,
          line: { color: EXP_COLOR[l], width: 2.2, shape: 'spline', smoothing: 0.3 },
          hovertemplate: `%{y:.2f}<extra>${l}</extra>`,
        }));
        const layout = layoutBase({
          shapes: [fertShape(), ...fertEdges], annotations: [fertNote(true)], margin: { l: 52, r: 10, t: 22, b: 28 },
          yaxis: Object.assign({ title: yTitle(p.title), zeroline: p.field === 'nep', zerolinecolor: cssVar('--baseline'), rangemode: p.field === 'nep' ? 'normal' : 'tozero' }, axisStyle),
        });
        Plotly.newPlot(p.id, traces, layout, { displayModeBar: false, responsive: true, scrollZoom: false });
      });

      const text = 'Look at how Peter changes relative to Paul. When nutrients go in, algae respond within days to weeks (chlorophyll climbs) and GPP rises. ' +
        'ER rises along with GPP, since more algae means more algal respiration, plus bacteria feeding on the extra organic matter the algae produce. ' +
        'Peter is only fertilized for four weeks, so the later period shows how much of the response lingers after the nutrients stop.';
      document.getElementById('expText').textContent = text;
    }

    let revealTimer = null;
    document.getElementById('expDrawReveal').addEventListener('click', () => {
      if (revealTimer) return;
      document.getElementById('expDrawKey').hidden = false;
      const real = EXP_LAKES.map((l) => Y.lakes[l].gpp);
      const traceIdx = EXP_LAKES.map((_, i) => keys.length + i);
      document.getElementById('expCaveat').textContent =
        'Metabolism here uses the same bookkeeping method as Module 6, but the sonde file has no wind or temperature-profile data, so the same wind (1 m/s) and mixed-layer depth (2 m) were assumed for both lakes. ' +
        'Because those assumptions are identical for each lake, the difference between Peter and Paul is more trustworthy than the absolute rates. Lines are 7-day medians.';

      // Draw the real Paul and Peter lines onto the sketch from left to right, so the reveal is
      // visible in place; only after that does the page scroll down to the detailed charts.
      const STEPS = 30;
      let step = 0;
      revealTimer = setInterval(() => {
        step += 1;
        const upto = Math.ceil((n * step) / STEPS);
        Plotly.restyle('expDrawPlot', { y: real.map((arr) => arr.map((v, i) => (i < upto ? v : null))) }, traceIdx);
        if (step < STEPS) return;
        clearInterval(revealTimer);
        document.getElementById('expExplore').hidden = false;
        renderExplorer();
        setTimeout(() => {
          const top = document.getElementById('expExplore').getBoundingClientRect().top + window.scrollY - 70;
          window.scrollTo({ top, behavior: 'smooth' });
          revealTimer = null;
        }, 1500);
      }, 40);
    });
  }
})();