(() => {
  'use strict';

  const { cssVar, buildNightLayer } = window.LakeCommon;

  // Slider 0-100 maps linearly onto each parameter's real range. The maxima
  // were chosen so the best-fit values (below) sit roughly mid-slider,
  // not jammed against an edge.
  const ALPHA_MAX = 0.00025; // mg/L added per hour, per unit PAR, at slider=100
  const R_MAX = 0.12;        // mg/L removed per hour, constant, at slider=100
  const K_MAX = 0.008;       // gas-exchange rate per hour per unit wind, at slider=100

  // Best fit to the real observed week, found by grid search minimizing SSE
  // between this same model and the real DO curve (see scripts/build_dataset.py
  // sibling notes / conversation history — not re-derived client-side since a
  // full search is unnecessary to ship).
  const TRUE_PARAMS = { alpha: 0.000148, r: 0.063, k: 0.0042 };

  // A flat, uninformative 0% floor for the match score. RMSE this bad or
  // worse (mg/L) scores 0%; RMSE 0 scores 100%. The best-fit RMSE (~0.21
  // mg/L) tops out around 91-92%, which is honest: even the best simple
  // 3-process model doesn't perfectly reproduce a real lake.
  const RMSE_FLOOR = 2.5;

  function doSat(tempC) {
    return 14.652 - 0.41022 * tempC + 0.007991 * tempC * tempC - 0.000077774 * tempC * tempC * tempC;
  }

  function simulate(alpha, r, k, do0, par, wind, temp) {
    const n = par.length;
    const DO = new Array(n);
    DO[0] = do0;
    let gasTotal = 0;
    for (let i = 1; i < n; i++) {
      const gpp = alpha * par[i - 1];
      const sat = doSat(temp[i - 1]);
      const gasFlux = k * wind[i - 1] * (sat - DO[i - 1]);
      gasTotal += gasFlux;
      DO[i] = DO[i - 1] + gpp - r + gasFlux;
    }
    return { DO, gasTotal };
  }

  function rmse(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) * (a[i] - b[i]);
    return Math.sqrt(sum / a.length);
  }

  function scoreFromRmse(e) {
    return Math.max(0, Math.round(100 * (1 - e / RMSE_FLOOR)));
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
    const par = hourly.map((h) => h.par);
    const wind = hourly.map((h) => h.wind_ms);
    const temp = hourly.map((h) => h.wtemp_c);
    const doReal = hourly.map((h) => h.do_mgl);
    const { nightShapes, sunAnnotations, xAll } = buildNightLayer(data);

    const meanDailyPar = (() => {
      let total = 0;
      for (let d = 0; d < 7; d++) {
        for (let hh = 0; hh < 24; hh++) total += par[d * 24 + hh];
      }
      return total / 7;
    })();

    const dailyGPP = (alpha) => alpha * meanDailyPar;
    const dailyR = (r) => r * 24;

    const sliderPhoto = document.getElementById('sliderPhoto');
    const sliderResp = document.getElementById('sliderResp');
    const sliderGas = document.getElementById('sliderGas');
    const valuePhoto = document.getElementById('valuePhoto');
    const valueResp = document.getElementById('valueResp');
    const valueGas = document.getElementById('valueGas');
    const matchScoreText = document.getElementById('matchScoreText');
    const revealBtn = document.getElementById('revealBtn');
    const revealPanel = document.getElementById('revealPanel');

    const realColor = cssVar('--series-do');
    const yourColor = cssVar('--series-rain');

    const realTrace = {
      x: xAll, y: doReal,
      type: 'scatter', mode: 'lines',
      line: { color: realColor, width: 2.5, shape: 'spline', smoothing: 0.3 },
      hovertemplate: '%{y:.2f} mg/L<extra>Real oxygen</extra>',
      name: 'Real oxygen',
    };
    const yourTrace = {
      x: xAll, y: simulate(0, 0, 0, doReal[0], par, wind, temp).DO,
      type: 'scatter', mode: 'lines',
      line: { color: yourColor, width: 2.5, shape: 'spline', smoothing: 0.3 },
      hovertemplate: '%{y:.2f} mg/L<extra>Your model</extra>',
      name: 'Your model',
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

    Plotly.newPlot('matchPlot', [realTrace, yourTrace], layout, {
      displayModeBar: false, responsive: true, scrollZoom: false,
    });

    function currentParams() {
      return {
        alpha: (Number(sliderPhoto.value) / 100) * ALPHA_MAX,
        r: (Number(sliderResp.value) / 100) * R_MAX,
        k: (Number(sliderGas.value) / 100) * K_MAX,
      };
    }

    function recompute() {
      valuePhoto.textContent = sliderPhoto.value;
      valueResp.textContent = sliderResp.value;
      valueGas.textContent = sliderGas.value;

      const p = currentParams();
      const y = simulate(p.alpha, p.r, p.k, doReal[0], par, wind, temp).DO;
      Plotly.restyle('matchPlot', { y: [y] }, [1]);

      const e = rmse(y, doReal);
      const score = scoreFromRmse(e);
      matchScoreText.textContent = score + '%';
      matchScoreText.classList.remove('is-good', 'is-warning');
      if (score >= 80) matchScoreText.classList.add('is-good');
      else if (score >= 50) matchScoreText.classList.add('is-warning');
    }

    [sliderPhoto, sliderResp, sliderGas].forEach((s) => s.addEventListener('input', recompute));
    recompute();

    revealBtn.addEventListener('click', () => {
      const p = currentParams();
      const gppYou = dailyGPP(p.alpha);
      const rYou = dailyR(p.r);
      const gppTrue = dailyGPP(TRUE_PARAMS.alpha);
      const rTrue = dailyR(TRUE_PARAMS.r);
      const gasYou = simulate(p.alpha, p.r, p.k, doReal[0], par, wind, temp).gasTotal / 7;
      const gasTrue = simulate(TRUE_PARAMS.alpha, TRUE_PARAMS.r, TRUE_PARAMS.k, doReal[0], par, wind, temp).gasTotal / 7;

      const fmt = (v) => v.toFixed(2) + ' mg/L/day';
      document.getElementById('revGppYou').textContent = fmt(gppYou);
      document.getElementById('revGppTrue').textContent = fmt(gppTrue);
      document.getElementById('revRYou').textContent = fmt(rYou);
      document.getElementById('revRTrue').textContent = fmt(rTrue);
      document.getElementById('revGasYou').textContent = fmt(gasYou);
      document.getElementById('revGasTrue').textContent = fmt(gasTrue);

      const note = gppTrue >= rTrue
        ? `According to the best fit, the lake produced a bit more oxygen through photosynthesis than it consumed through respiration.`
        : `According to the best fit, the lake consumed a bit more oxygen through respiration than it produced through photosynthesis.`;
      document.getElementById('revealNote').innerHTML = note;

      revealPanel.hidden = false;
      revealPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }
})();
