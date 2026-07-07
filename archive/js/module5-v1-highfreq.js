(() => {
  'use strict';

  const { cssVar, buildNightLayer, DATA_URL } = window.LakeCommon;

  // Archived page lives one directory deeper than when this was written.
  fetch('../' + DATA_URL)
    .then((r) => r.json())
    .then(init)
    .catch((err) => {
      document.querySelector('.content').innerHTML =
        '<p style="padding:40px;color:var(--text-secondary)">Could not load lake data (' + err + ').</p>';
    });

  function amplitudePerDay(y, pointsPerDay) {
    const amps = [];
    for (let d = 0; d < 7; d++) {
      const seg = y.slice(d * pointsPerDay, (d + 1) * pointsPerDay);
      amps.push(Math.max(...seg) - Math.min(...seg));
    }
    return amps;
  }
  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

  function init(data) {
    const { nightShapes, sunAnnotations, xAll } = buildNightLayer(data);
    const doColor = cssVar('--series-do');

    const fiveX = data.five_min_do.map((d) => d.t);
    const fiveY = data.five_min_do.map((d) => d.do_mgl);
    const hourlyX = xAll;
    const hourlyY = data.hourly.map((h) => h.do_mgl);
    const dailyX = data.daily_do.map((d) => `${d.date}T12:00:00`);
    const dailyY = data.daily_do.map((d) => d.do_mgl);

    // Fixed across every chart on this page so the visual "flattening" at
    // coarser resolutions is honest - it's the same scale throughout, not a
    // rescaled axis hiding the difference.
    const yPad = 0.6;
    const yRange = [Math.min(...fiveY) - yPad, Math.max(...fiveY) + yPad];

    const RES = {
      five: {
        title: 'Oxygen at 5-minute resolution',
        x: fiveX, y: fiveY,
        mode: 'lines',
        line: { color: doColor, width: 1.5 },
        marker: { size: 0 },
      },
      hourly: {
        title: 'Oxygen at hourly resolution',
        x: hourlyX, y: hourlyY,
        mode: 'lines+markers',
        line: { color: doColor, width: 2 },
        marker: { size: 4, color: doColor },
      },
      daily: {
        title: 'Oxygen at daily resolution',
        x: dailyX, y: dailyY,
        mode: 'lines+markers',
        line: { color: doColor, width: 2, dash: 'dot' },
        marker: { size: 12, color: doColor, line: { color: cssVar('--surface-1'), width: 2 } },
      },
    };

    function baseLayout(extraMargin) {
      return {
        margin: extraMargin || { l: 44, r: 12, t: 26, b: 28 },
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
          tickformat: '%a %-d',
          hoverformat: '%a %b %-d, %-I:%M %p',
        },
        yaxis: {
          range: yRange,
          gridcolor: cssVar('--gridline'),
          linecolor: cssVar('--baseline'),
          tickfont: { color: cssVar('--text-muted') },
          zeroline: false,
        },
        hovermode: 'x',
      };
    }

    function traceFor(key) {
      const r = RES[key];
      return {
        x: r.x, y: r.y,
        type: 'scatter', mode: r.mode,
        line: r.line, marker: r.marker,
        hovertemplate: '%{y:.2f} mg/L<extra></extra>',
      };
    }

    const resChartTitle = document.getElementById('resChartTitle');
    Plotly.newPlot('resPlot', [traceFor('five')], baseLayout(), {
      displayModeBar: false, responsive: true, scrollZoom: false,
    });
    resChartTitle.textContent = RES.five.title;

    const resSwitch = document.getElementById('resSwitch');
    Array.from(resSwitch.children).forEach((btn) => {
      btn.addEventListener('click', () => {
        Array.from(resSwitch.children).forEach((b) => b.classList.toggle('active', b === btn));
        const key = btn.dataset.res;
        resChartTitle.textContent = RES[key].title;
        Plotly.react('resPlot', [traceFor(key)], baseLayout());
      });
    });

    // ---- small multiples: all three resolutions, same fixed scale ----
    const miniLayout = () => baseLayout({ l: 34, r: 8, t: 6, b: 22 });
    const miniConfig = { displayModeBar: false, responsive: true, scrollZoom: false };
    Plotly.newPlot('miniFive', [traceFor('five')], miniLayout(), miniConfig);
    Plotly.newPlot('miniHourly', [traceFor('hourly')], miniLayout(), miniConfig);
    Plotly.newPlot('miniDaily', [traceFor('daily')], miniLayout(), miniConfig);

    // ---- the punchline, computed from the real data, not hardcoded ----
    const amp5 = mean(amplitudePerDay(fiveY, 288));
    const ampH = mean(amplitudePerDay(hourlyY, 24));
    const pct = Math.round((ampH / amp5) * 100);
    document.getElementById('statsText').innerHTML =
      `At 5-minute resolution, oxygen swings by about <strong>${amp5.toFixed(2)} mg/L</strong> on a typical day &mdash; ` +
      `the real signature of photosynthesis and respiration. Hourly averaging barely loses anything: still about ` +
      `<strong>${ampH.toFixed(2)} mg/L</strong>, roughly ${pct}% of the true swing. But daily averages are just one ` +
      `number per day &mdash; by definition, there is no rise or fall left to see <em>within</em> a day at all. The ` +
      `entire week's metabolism signal disappears into what looks like a slow, quiet decline.`;
  }
})();
