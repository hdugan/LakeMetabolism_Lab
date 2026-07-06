(() => {
  'use strict';

  const { cssVar, buildNightLayer, DATA_URL } = window.LakeCommon;

  const SUSPECTS = [
    {
      key: 'wtemp', label: 'Temperature', icon: '🌡️',
      varKey: 'wtemp_c', unit: '°C', decimals: 1, colorVar: '--series-wtemp', mark: 'line',
      observe: 'Water temperature and oxygen both rise and fall once a day. But look at the timing: water temperature usually peaks by mid-to-late afternoon, while oxygen keeps climbing for a few more hours, often not turning around until early evening.',
      reflect: 'If temperature directly controlled oxygen, the two should peak at almost the same time. Instead there is a gap of several hours between them. What does that gap suggest about whether temperature is really driving oxygen, or just moving alongside something else that is?',
    },
    {
      key: 'wind', label: 'Wind', icon: '💨',
      varKey: 'wind_ms', unit: 'm/s', decimals: 1, colorVar: '--series-wind', mark: 'line',
      observe: 'Wind speed jumps around hour to hour — sometimes calm at night, sometimes gusty at midday — with no repeating daily rhythm like oxygen has.',
      reflect: "Oxygen rises and falls on a reliable daily schedule. Wind doesn't seem to. If wind isn't driving that schedule, what job might it still be doing for the lake?",
    },
    {
      key: 'par', label: 'Sunlight', icon: '☀️',
      varKey: 'par', unit: 'µmol/m²/s', decimals: 0, colorVar: '--series-par', mark: 'line',
      observe: 'Both curves rise and fall every day, but not at the same moment. PAR peaks right around solar noon, while oxygen often keeps climbing for several more hours, sometimes not turning around until early evening.',
      reflect: 'Why does oxygen continue increasing for hours after sunlight has already passed its maximum?',
    },
    {
      key: 'rain', label: 'Rainfall', icon: '🌧️',
      varKey: 'precip_mm', unit: 'mm', decimals: 1, colorVar: '--series-rain', mark: 'bar',
      observe: 'Real rain fell only once this week: a heavy afternoon storm on July 12 (over 40 mm in a few hours) and a lighter shower the next two days. Most hours saw no rain at all, and none of it lines up with oxygen’s daily up-and-down.',
      reflect: "Rain doesn't happen every day, but oxygen's cycle does — so rain can't be the direct cause. Could it still be an indirect cause of the smaller oxygen swings seen July 12–14?",
    },
  ];

  const NOTES_PREFIX = 'lakeDetective.notes.';
  const VERDICT_KEY = 'lakeDetective.verdict';
  const triedSet = new Set();

  fetch(DATA_URL)
    .then((r) => r.json())
    .then(init)
    .catch((err) => {
      document.querySelector('.content').innerHTML =
        '<p style="padding:40px;color:var(--text-secondary)">Could not load lake data (' + err + ').</p>';
    });

  function normalize(values, floorAtZero) {
    const present = values.filter((v) => v !== null && v !== undefined);
    const min = floorAtZero ? 0 : Math.min(...present);
    const max = Math.max(...present);
    const span = max - min || 1;
    return values.map((v) => (v === null || v === undefined ? null : ((v - min) / span) * 100));
  }

  function init(data) {
    const hourly = data.hourly;
    const { nightShapes, sunAnnotations, xAll } = buildNightLayer(data);

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
      const norm = normalize(raw, s.key === 'rain');
      const color = cssVar(s.colorVar);

      const doTrace = {
        x: xAll, y: doNorm, customdata: doRaw,
        type: 'scatter', mode: 'lines',
        line: { color: doColor, width: 2, shape: 'spline', smoothing: 0.3 },
        hovertemplate: '%{customdata:.2f} mg/L<extra>Oxygen</extra>',
        name: 'Oxygen (DO)',
      };

      const suspectTrace = s.mark === 'bar'
        ? {
            x: xAll, y: norm, customdata: raw,
            type: 'bar',
            marker: { color, opacity: 0.55 },
            hovertemplate: `%{customdata:.${s.decimals}f} ${s.unit}<extra>${s.label}</extra>`,
            name: s.label,
          }
        : {
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
        barmode: 'overlay',
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
