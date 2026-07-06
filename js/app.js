(() => {
  'use strict';

  const SERIES = [
    { key: 'do_mgl',   elId: 'plot-do',    varName: '--series-do',    label: 'Dissolved oxygen', unit: 'mg/L',        decimals: 2 },
    { key: 'wtemp_c',  elId: 'plot-wtemp', varName: '--series-wtemp', label: 'Water temperature', unit: '°C',    decimals: 1 },
    { key: 'par',      elId: 'plot-par',   varName: '--series-par',   label: 'Light (PAR)',       unit: 'µmol/m²/s', decimals: 0 },
    { key: 'wind_ms',  elId: 'plot-wind',  varName: '--series-wind',  label: 'Wind speed',        unit: 'm/s',        decimals: 1 },
  ];

  const root = getComputedStyle(document.documentElement);
  const cssVar = (name) => root.getPropertyValue(name).trim();

  // ISO strings with a fixed -05:00 offset; strip the offset so Plotly treats
  // them as naive local time on the axis (the data is already single-timezone).
  const stripOffset = (iso) => iso.slice(0, 19);

  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function fmtBadgeTime(date) {
    let h = date.getHours();
    const m = date.getMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12; if (h === 0) h = 12;
    return `${WEEKDAYS[date.getDay()]} ${date.getMonth() + 1}/${date.getDate()}, ${h}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  function parseHM(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return h + m / 60;
  }

  fetch('data/mendota_week.json')
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

    const xAll = hourly.map((h) => stripOffset(h.t));
    // Built from the offset-stripped naive string (not h.t) so that Date's
    // local getters replay the original Central-time wall clock regardless
    // of the browser's own timezone.
    const dateObjs = xAll.map((x) => new Date(x));

    // ---- night shading + sunrise/sunset annotations (shared by all 4 charts) ----
    const nightShapes = [];
    const sunAnnotations = [];
    days.forEach((d, i) => {
      const dayStart = `${d.date}T00:00:00`;
      const sunrise = `${d.date}T${d.sunrise}:00`;
      const sunset = `${d.date}T${d.sunset}:00`;
      const nextDate = days[i + 1] ? days[i + 1].date : null;
      const dayEnd = nextDate ? `${nextDate}T00:00:00` : xAll[xAll.length - 1];

      // pre-dawn night
      nightShapes.push(rectShape(dayStart, sunrise));
      // post-dusk night
      nightShapes.push(rectShape(sunset, dayEnd));

      sunAnnotations.push(sunGlyph(sunrise, '☀️'));   // sunrise
      sunAnnotations.push(sunGlyph(sunset, '🌙'));    // sunset
    });

    function rectShape(x0, x1) {
      return {
        type: 'rect', xref: 'x', yref: 'paper',
        x0, x1, y0: 0, y1: 1,
        fillcolor: cssVar('--night-fill'),
        line: { width: 0 },
        layer: 'below',
      };
    }
    function sunGlyph(x, glyph) {
      // yanchor 'top' hangs the glyph down from the paper edge, into the
      // margin.t gap reserved above the plot area, instead of poking up past
      // the top of the canvas (which is where paper y=1 actually sits).
      return {
        x, y: 1.0, yref: 'paper', yanchor: 'top',
        text: glyph, showarrow: false, font: { size: 12 },
      };
    }

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
        margin: { l: 44, r: 12, t: 26, b: 28 },
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        font: { family: 'system-ui, -apple-system, "Segoe UI", sans-serif', color: cssVar('--text-secondary'), size: 11 },
        showlegend: false,
        shapes: nightShapes.concat([cursorLineShape(xAll[36])]),
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
          gridcolor: cssVar('--gridline'),
          linecolor: cssVar('--baseline'),
          tickfont: { color: cssVar('--text-muted') },
          zeroline: false,
        },
        hovermode: 'x',
      };

      Plotly.newPlot(s.elId, [trace, cursorTrace], layout, {
        displayModeBar: false, responsive: true, scrollZoom: false,
      });

      plots[s.key] = { el: document.getElementById(s.elId), y };
    });

    function cursorLineShape(x) {
      return {
        type: 'line', xref: 'x', yref: 'paper',
        x0: x, x1: x, y0: 0, y1: 1,
        line: { color: cssVar('--text-primary'), width: 1.5, dash: 'dot' },
      };
    }

    // ---- stat row ----
    const statRow = document.getElementById('statRow');
    SERIES.forEach((s) => {
      const tile = document.createElement('div');
      tile.className = 'stat-tile';
      tile.innerHTML = `
        <div class="stat-tile-label"><span class="dot" style="background:${cssVar(s.varName)}"></span>${s.label}</div>
        <div class="stat-tile-value" id="stat-${s.key}">&ndash;<span class="unit">${s.unit}</span></div>`;
      statRow.appendChild(tile);
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
  }
})();
