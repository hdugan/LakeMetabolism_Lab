(() => {
  'use strict';

  const SERIES = [
    { key: 'do_mgl',   elId: 'plot-do',    varName: '--series-do',    label: 'Dissolved oxygen', unit: 'mg/L',        decimals: 2 },
    { key: 'wtemp_c',  elId: 'plot-wtemp', varName: '--series-wtemp', label: 'Water temperature', unit: '°C',    decimals: 1 },
    { key: 'par',      elId: 'plot-par',   varName: '--series-par',   label: 'Light (PAR)',       unit: 'µmol/m²/s', decimals: 0 },
    { key: 'wind_ms',  elId: 'plot-wind',  varName: '--series-wind',  label: 'Wind speed',        unit: 'm/s',        decimals: 1 },
  ];

  const { cssVar, WEEKDAYS, DATA_URL, parseHM, fmtBadgeTime, buildNightLayer, cursorLineShape } = window.LakeCommon;

  // ---- "Look for..." notes (localStorage) - independent of the chart data fetch ----
  const NOTES = [
    { id: 'q1Notes', key: 'meetTheLake.oxygenTiming' },
    { id: 'q2Notes', key: 'meetTheLake.overnight' },
    { id: 'q3Notes', key: 'meetTheLake.compareDays' },
    { id: 'q4Notes', key: 'meetTheLake.windPattern' },
  ];
  NOTES.forEach((n) => {
    const el = document.getElementById(n.id);
    el.value = localStorage.getItem(n.key) || '';
    el.addEventListener('input', () => localStorage.setItem(n.key, el.value));
  });

  fetch(DATA_URL)
    .then((r) => r.json())
    .then(init)
    .catch((err) => {
      document.querySelector('.content').innerHTML =
        '<p style="padding:40px;color:var(--text-secondary)">Could not load lake data (' + err + ').</p>';
    });

  function init(data) {
    const hourly = data.hourly;
    const days = data.days;
    const n = hourly.length;

    const { nightShapes, sunAnnotations, xAll } = buildNightLayer(data);
    // Built from the offset-stripped naive string (not h.t) so that Date's
    // local getters replay the original Central-time wall clock regardless
    // of the browser's own timezone.
    const dateObjs = xAll.map((x) => new Date(x));

    // Day labels ("Mon 10") are rendered as annotations centered at each
    // day's noon, decoupled from the axis ticks - the gridlines themselves
    // stay at midnight (set via xaxis.dtick below), which is where they
    // should be to mark day boundaries, while the label reads better
    // centered under the day it names rather than sitting on the boundary.
    const dayLabelAnnotations = days.map((d) => {
      const noon = new Date(`${d.date}T12:00:00`);
      return {
        x: `${d.date}T12:00:00`, y: 0, xref: 'x', yref: 'paper',
        yanchor: 'top', yshift: -6,
        text: `${WEEKDAYS[noon.getDay()]} ${noon.getDate()}`,
        showarrow: false,
        font: { size: 11, color: cssVar('--text-muted') },
      };
    });

    // ---- build the four charts ----
    const plots = {};
    SERIES.forEach((s) => {
      const color = cssVar(s.varName);
      const y = hourly.map((h) => h[s.key]);

      const trace = {
        x: xAll, y,
        type: 'scatter', mode: 'lines',
        line: { color, width: 2, shape: 'spline', smoothing: 0.3 },
        hovertemplate: `%{y:.${s.decimals}f} ${s.unit}<extra></extra>`,
        name: s.label,
      };

      const cursorTrace = {
        x: [xAll[0]], y: [y[0]],
        type: 'scatter', mode: 'markers',
        marker: { color, size: 11, line: { color: cssVar('--surface-1'), width: 2 } },
        hoverinfo: 'skip',
        showlegend: false,
      };

      const layout = {
        margin: { l: 8, r: 10, t: 6, b: 20 },
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        font: { family: 'system-ui, -apple-system, "Segoe UI", sans-serif', color: cssVar('--text-secondary'), size: 11 },
        showlegend: false,
        shapes: nightShapes.concat([cursorLineShape(xAll[36])]),
        // No sun/moon annotations here (unlike other modules) - they need
        // top margin this compact layout doesn't have room for, and the
        // current-value readout beside the title already gives an at-a-
        // glance number, so the y-axis labels are dropped too for the
        // same reason (hover still shows exact values).
        annotations: dayLabelAnnotations,
        xaxis: {
          type: 'date',
          range: [xAll[0], xAll[xAll.length - 1]],
          dtick: 86400000,
          tick0: `${days[0].date}T00:00:00`,
          showticklabels: false,
          gridcolor: cssVar('--gridline'),
          linecolor: cssVar('--baseline'),
          showspikes: true, spikemode: 'across', spikesnap: 'cursor',
          spikethickness: 1, spikedash: 'solid', spikecolor: cssVar('--text-muted'),
          hoverformat: '%a %b %-d, %-I:%M %p',
        },
        yaxis: {
          showticklabels: false,
          gridcolor: cssVar('--gridline'),
          linecolor: cssVar('--baseline'),
          zeroline: false,
        },
        hovermode: 'x',
      };

      Plotly.newPlot(s.elId, [trace, cursorTrace], layout, {
        displayModeBar: false, responsive: true, scrollZoom: false,
      });

      plots[s.key] = { el: document.getElementById(s.elId), y };
    });

    // ---- slider day labels ----
    const scale = document.getElementById('sliderScale');
    days.forEach((d) => {
      const span = document.createElement('span');
      const dt = new Date(`${d.date}T12:00:00`);
      span.textContent = `${WEEKDAYS[dt.getDay()]} ${dt.getDate()}`;
      scale.appendChild(span);
    });

    // ---- wire up slider / play / readouts ----
    const slider = document.getElementById('timeSlider');
    const readoutDate = document.getElementById('readoutDate');
    const badge = document.getElementById('daynightBadge');

    function dayInfoFor(idx) {
      return days[Math.floor(idx / 24)];
    }

    function update(idx) {
      idx = Math.max(0, Math.min(n - 1, idx));
      const x = xAll[idx];
      const date = dateObjs[idx];
      const info = dayInfoFor(idx);

      readoutDate.textContent = fmtBadgeTime(date);

      const sunriseH = parseHM(info.sunrise);
      const sunsetH = parseHM(info.sunset);
      const curH = date.getHours() + date.getMinutes() / 60;
      const isDay = curH >= sunriseH && curH < sunsetH;
      const nearSunrise = Math.abs(curH - sunriseH) <= 0.5;
      const nearSunset = Math.abs(curH - sunsetH) <= 0.5;

      badge.classList.toggle('is-transition', nearSunrise || nearSunset);
      if (nearSunrise) badge.textContent = `☀️ Sunrise · ${info.sunrise}`;
      else if (nearSunset) badge.textContent = `🌙 Sunset · ${info.sunset}`;
      else if (isDay) badge.textContent = `☀️ Daytime`;
      else badge.textContent = `🌙 Nighttime`;

      // Replace the whole shapes array (night bands + one cursor line) in a
      // single update rather than patching the cursor shape in place -
      // patching it via a `shapes[i]` relayout key left old cursor lines
      // behind instead of replacing them.
      const shapesArr = nightShapes.concat([cursorLineShape(x)]);
      SERIES.forEach((s) => {
        const p = plots[s.key];
        const val = p.y[idx];
        Plotly.update(p.el, { x: [[x]], y: [[val]] }, { shapes: shapesArr }, [1]);

        const statEl = document.getElementById(`stat-${s.key}`);
        if (val === null || val === undefined) {
          statEl.innerHTML = `&ndash;<span class="unit">${s.unit}</span>`;
        } else {
          statEl.innerHTML = `${val.toFixed(s.decimals)}<span class="unit"> ${s.unit}</span>`;
        }
      });
    }

    slider.addEventListener('input', () => update(Number(slider.value)));
    update(Number(slider.value));

    // ---- hover sync across charts: the other 3 markers snap to the hovered X ----
    SERIES.forEach((s) => {
      const p = plots[s.key];
      p.el.on('plotly_hover', (evt) => {
        if (evt.points[0].curveNumber !== 0) return;
        const idx = evt.points[0].pointIndex;
        SERIES.forEach((other) => {
          if (other.key === s.key) return;
          const op = plots[other.key];
          Plotly.restyle(op.el, { x: [[xAll[idx]]], y: [[op.y[idx]]] }, [1]);
        });
      });
      p.el.on('plotly_unhover', () => {
        const idx = Number(slider.value);
        SERIES.forEach((other) => {
          if (other.key === s.key) return;
          const op = plots[other.key];
          Plotly.restyle(op.el, { x: [[xAll[idx]]], y: [[op.y[idx]]] }, [1]);
        });
      });
    });

    // ---- play / pause through the week ----
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
        }, 220);
      } else {
        clearInterval(timer);
        timer = null;
      }
    }

    playBtn.addEventListener('click', () => setPlaying(!timer));

    initDetective(hourly, nightShapes, sunAnnotations, xAll);
  }

  // ==========================================================================
  // "Become a Lake Detective" (formerly Module 2) - which variable appears
  // to control oxygen? Shares the week's data/night-shading already loaded
  // above instead of fetching DATA_URL a second time.
  // ==========================================================================
  function initDetective(hourly, nightShapes, sunAnnotations, xAll) {
    const SUSPECTS = [
      {
        key: 'wtemp', label: 'Temperature', icon: '🌡️',
        varKey: 'wtemp_c', unit: '°C', decimals: 1, colorVar: '--series-wtemp',
        observe: 'Water temperature and oxygen both rise and fall once a day. But look at the timing: water temperature usually peaks by mid-to-late afternoon, while oxygen keeps climbing for a few more hours, often not turning around until early evening.',
        reflect: 'If temperature directly controlled oxygen, the two should peak at almost the same time. Instead there is a gap of several hours between them. What does that gap suggest about whether temperature is really driving oxygen, or just moving alongside something else that is?',
      },
      {
        key: 'wind', label: 'Wind', icon: '💨',
        varKey: 'wind_ms', unit: 'm/s', decimals: 1, colorVar: '--series-wind',
        observe: 'Wind speed jumps around hour to hour — sometimes calm at night, sometimes gusty at midday — with no repeating daily rhythm like oxygen has.',
        reflect: "Oxygen rises and falls on a reliable daily schedule. Wind doesn't seem to. If wind isn't driving that schedule, what job might it still be doing for the lake?",
      },
      {
        key: 'par', label: 'Sunlight', icon: '☀️',
        varKey: 'par', unit: 'µmol/m²/s', decimals: 0, colorVar: '--series-par',
        observe: 'Both curves rise and fall every day, but not at the same moment. PAR peaks right around solar noon, while oxygen often keeps climbing for several more hours, sometimes not turning around until early evening.',
        reflect: 'Why does oxygen continue increasing for hours after sunlight has already passed its maximum?',
      },
    ];

    const NOTES_PREFIX = 'lakeDetective.notes.';
    const VERDICT_KEY = 'lakeDetective.verdict';
    const triedSet = new Set();

    function normalize(values, floorAtZero) {
      const present = values.filter((v) => v !== null && v !== undefined);
      const min = floorAtZero ? 0 : Math.min(...present);
      const max = Math.max(...present);
      const span = max - min || 1;
      return values.map((v) => (v === null || v === undefined ? null : ((v - min) / span) * 100));
    }

    const doRaw = hourly.map((h) => h.do_mgl);
    const doNorm = normalize(doRaw, false);
    const doColor = cssVar('--series-do');

    const suspectGrid = document.getElementById('suspectGrid');
    const emptyState = document.getElementById('emptyState');
    const overlaySection = document.getElementById('overlaySection');
    const analysisSection = document.getElementById('analysisSection');
    const overlayTitle = document.getElementById('overlayTitle');
    const overlayLegend = document.getElementById('overlayLegend');
    const observeCallout = document.getElementById('observeCallout');
    const observeText = document.getElementById('observeText');
    const reflectText = document.getElementById('reflectText');
    const reflectNotes = document.getElementById('reflectNotes');
    const triedCount = document.getElementById('triedCount');
    const verdictRow = document.getElementById('verdictRow');
    const verdictNotes = document.getElementById('verdictNotes');

    // ---- suspect buttons ----
    SUSPECTS.forEach((s) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'suspect-btn';
      btn.dataset.key = s.key;
      btn.style.setProperty('--accent', cssVar(s.colorVar));
      btn.innerHTML = `
        <span class="suspect-check">✓ tested</span>
        <span class="suspect-icon">${s.icon}</span>
        <span class="suspect-label">${s.label}</span>`;
      if (localStorage.getItem(NOTES_PREFIX + s.key)) btn.classList.add('tried');
      btn.addEventListener('click', () => selectSuspect(s.key));
      suspectGrid.appendChild(btn);
    });

    // ---- verdict / progress chips ----
    function renderVerdictRow() {
      verdictRow.innerHTML = '';
      SUSPECTS.forEach((s) => {
        const chip = document.createElement('span');
        chip.className = 'verdict-chip';
        chip.textContent = (triedSet.has(s.key) ? '✓ ' : '– ') + s.label;
        verdictRow.appendChild(chip);
      });
      triedCount.textContent = String(triedSet.size);
    }
    // A suspect counts as "tried" if it has saved notes from an earlier
    // visit, so the progress count survives a reload instead of resetting
    // to 0 while the notes themselves are still there.
    SUSPECTS.forEach((s) => {
      if (localStorage.getItem(NOTES_PREFIX + s.key)) triedSet.add(s.key);
    });
    renderVerdictRow();

    // ---- restore saved verdict notes ----
    verdictNotes.value = localStorage.getItem(VERDICT_KEY) || '';
    verdictNotes.addEventListener('input', () => {
      localStorage.setItem(VERDICT_KEY, verdictNotes.value);
    });

    function selectSuspect(key) {
      const s = SUSPECTS.find((x) => x.key === key);
      const color = cssVar(s.colorVar);

      Array.from(suspectGrid.children).forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.key === key);
        if (btn.dataset.key === key) btn.classList.add('tried');
      });
      triedSet.add(key);
      renderVerdictRow();

      emptyState.hidden = true;
      overlaySection.hidden = false;
      analysisSection.hidden = false;

      overlayTitle.textContent = `Oxygen vs. ${s.label}`;
      observeCallout.style.setProperty('--accent', color);
      overlayLegend.innerHTML = `
        <span><span class="swatch" style="background:${doColor}"></span>Oxygen (DO)</span>
        <span><span class="swatch" style="background:${color}"></span>${s.label} (${s.unit})</span>`;
      observeText.textContent = s.observe;
      reflectText.textContent = s.reflect;
      reflectNotes.value = localStorage.getItem(NOTES_PREFIX + key) || '';
      reflectNotes.oninput = () => localStorage.setItem(NOTES_PREFIX + key, reflectNotes.value);

      drawOverlay(s);
    }

    function drawOverlay(s) {
      const raw = hourly.map((h) => h[s.varKey]);
      const norm = normalize(raw, false);
      const color = cssVar(s.colorVar);

      const doTrace = {
        x: xAll, y: doNorm, customdata: doRaw,
        type: 'scatter', mode: 'lines',
        line: { color: doColor, width: 2, shape: 'spline', smoothing: 0.3 },
        hovertemplate: '%{customdata:.2f} mg/L<extra>Oxygen</extra>',
        name: 'Oxygen (DO)',
      };

      const suspectTrace = {
        x: xAll, y: norm, customdata: raw,
        type: 'scatter', mode: 'lines',
        line: { color, width: 2, shape: 'spline', smoothing: 0.3 },
        hovertemplate: `%{customdata:.${s.decimals}f} ${s.unit}<extra>${s.label}</extra>`,
        name: s.label,
      };

      const layout = {
        margin: { l: 44, r: 12, t: 26, b: 28 },
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        font: { family: 'system-ui, -apple-system, "Segoe UI", sans-serif', color: cssVar('--text-secondary'), size: 11 },
        showlegend: false,
        shapes: nightShapes,
        annotations: sunAnnotations,
        xaxis: {
          type: 'date',
          range: [xAll[0], xAll[xAll.length - 1]],
          gridcolor: cssVar('--gridline'),
          linecolor: cssVar('--baseline'),
          tickfont: { color: cssVar('--text-muted') },
          showspikes: true, spikemode: 'across', spikesnap: 'cursor',
          spikethickness: 1, spikedash: 'solid', spikecolor: cssVar('--text-muted'),
          tickformat: '%a %-d',
          hoverformat: '%a %b %-d, %-I:%M %p',
        },
        yaxis: {
          title: { text: '% of week range', font: { size: 11, color: cssVar('--text-muted') } },
          range: [-3, 103],
          gridcolor: cssVar('--gridline'),
          linecolor: cssVar('--baseline'),
          tickfont: { color: cssVar('--text-muted') },
          zeroline: false,
        },
        hovermode: 'x',
      };

      Plotly.react('overlayPlot', [doTrace, suspectTrace], layout, {
        displayModeBar: false, responsive: true, scrollZoom: false,
      });
    }
  }
})();
