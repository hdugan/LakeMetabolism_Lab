(() => {
  'use strict';

  const { cssVar, buildNightLayer, DATA_URL } = window.LakeCommon;

  // Simplified process rates, hand-tuned (see scripts/build_dataset.py sibling
  // notes) so that with all three processes on the simulated curve lands in
  // the same 8-13 mg/L ballpark as the real observed week, while each single
  // process removed produces a clearly distinct "aha" shape.
  const ALPHA = 0.0002;   // mg/L added per hour, per unit PAR (photosynthesis)
  const R_CONST = 0.05;   // mg/L removed per hour, constant (respiration)
  const K_GAS = 0.006;    // gas-exchange rate per hour, per unit wind (m/s)

  function doSat(tempC) {
    // Standard freshwater DO-saturation regression at 1 atm (mg/L).
    return 14.652 - 0.41022 * tempC + 0.007991 * tempC * tempC - 0.000077774 * tempC * tempC * tempC;
  }

  function simulate(par, wind, temp, toggles) {
    const n = par.length;
    const DO = new Array(n);
    DO[0] = doSat(temp[0]);
    for (let i = 1; i < n; i++) {
      const gpp = toggles.photo ? ALPHA * par[i - 1] : 0;
      const resp = toggles.resp ? R_CONST : 0;
      const sat = doSat(temp[i - 1]);
      const gasFlux = toggles.gas ? K_GAS * wind[i - 1] * (sat - DO[i - 1]) : 0;
      DO[i] = DO[i - 1] + gpp - resp + gasFlux;
    }
    return DO;
  }

  const CAPTIONS = {
    '111': "This is the real balance: photosynthesis adds oxygen by day, respiration removes it around the clock, and gas exchange keeps both in check. The result looks like a real lake.",
    '011': "With photosynthesis off, nothing is adding oxygen anymore. Respiration keeps consuming it, so oxygen only decreases, day after day.",
    '101': "With respiration off, nothing is consuming oxygen. Photosynthesis keeps adding it every day, so oxygen only increases, day after day.",
    '110': "With gas exchange off, oxygen has nowhere to go. Every day's gains and losses just keep piling up, and the swings become unrealistically large.",
    '001': "With photosynthesis and respiration both off, nothing is adding or removing oxygen — gas exchange just holds it steady at equilibrium.",
    '010': "No photosynthesis, no gas exchange to soften it — respiration runs unchecked, so oxygen falls and keeps falling.",
    '100': "No respiration, no gas exchange to soften it — photosynthesis runs unchecked, so oxygen rises and keeps rising, completely unrealistically.",
    '000': "All three processes are off. Nothing is adding or removing oxygen, so it just sits flat wherever it started.",
  };

  fetch(DATA_URL)
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
    const { nightShapes, sunAnnotations, xAll } = buildNightLayer(data);
    const equilibrium = temp.map(doSat);

    const toggles = { photo: true, resp: true, gas: true };

    const togglePhoto = document.getElementById('togglePhoto');
    const toggleResp = document.getElementById('toggleResp');
    const toggleGas = document.getElementById('toggleGas');
    const stateCaptionText = document.getElementById('stateCaptionText');
    const diagramPhotoArrow = document.getElementById('diagramPhotoArrow');
    const diagramRespArrow = document.getElementById('diagramRespArrow');
    const diagramGasArrow = document.getElementById('diagramGasArrow').closest('.diagram-atm');

    const doColor = cssVar('--series-do');
    const eqColor = cssVar('--baseline');

    const doTrace = {
      x: xAll, y: simulate(par, wind, temp, toggles),
      type: 'scatter', mode: 'lines',
      line: { color: doColor, width: 2.5, shape: 'spline', smoothing: 0.3 },
      hovertemplate: '%{y:.2f} mg/L<extra>Simulated oxygen</extra>',
      name: 'Simulated oxygen',
    };
    const eqTrace = {
      x: xAll, y: equilibrium,
      type: 'scatter', mode: 'lines',
      line: { color: eqColor, width: 1.5, dash: 'dash' },
      hovertemplate: '%{y:.2f} mg/L<extra>Equilibrium</extra>',
      name: 'Equilibrium',
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

    Plotly.newPlot('simPlot', [doTrace, eqTrace], layout, {
      displayModeBar: false, responsive: true, scrollZoom: false,
    });

    function toggleKey() {
      return (toggles.photo ? '1' : '0') + (toggles.resp ? '1' : '0') + (toggles.gas ? '1' : '0');
    }

    function updateDiagram() {
      diagramPhotoArrow.classList.toggle('is-off', !toggles.photo);
      diagramRespArrow.classList.toggle('is-off', !toggles.resp);
      diagramGasArrow.classList.toggle('is-off', !toggles.gas);
    }

    function recompute() {
      const y = simulate(par, wind, temp, toggles);
      Plotly.restyle('simPlot', { y: [y] }, [0]);
      stateCaptionText.textContent = CAPTIONS[toggleKey()];
      updateDiagram();
    }

    togglePhoto.addEventListener('change', () => { toggles.photo = togglePhoto.checked; recompute(); });
    toggleResp.addEventListener('change', () => { toggles.resp = toggleResp.checked; recompute(); });
    toggleGas.addEventListener('change', () => { toggles.gas = toggleGas.checked; recompute(); });

    recompute();
    initQuiz();
  }

  const QUIZ_FEEDBACK = {
    wave: "Not quite — that daily rise and fall is actually created by photosynthesis and respiration. Turn both off, and there's nothing left to produce that pattern.",
    climb: "Not quite — oxygen only climbs when something is adding it faster than anything removes it. With photosynthesis off too, there's no source left to push it up.",
    flat: "Exactly right. With nothing adding oxygen and nothing removing it, there's no engine left to move the line at all — it would sit flat at wherever it started, all week long.",
  };

  function initQuiz() {
    const quizGrid = document.getElementById('quizGrid');
    const quizFeedback = document.getElementById('quizFeedback');

    Array.from(quizGrid.children).forEach((btn) => {
      btn.addEventListener('click', () => {
        const correct = btn.dataset.correct === 'true';
        Array.from(quizGrid.children).forEach((b) => b.classList.remove('is-correct', 'is-incorrect'));
        btn.classList.add(correct ? 'is-correct' : 'is-incorrect');

        quizFeedback.hidden = false;
        quizFeedback.classList.toggle('is-correct', correct);
        quizFeedback.classList.toggle('is-incorrect', !correct);
        quizFeedback.textContent = (correct ? '✅ ' : '🤔 ') + QUIZ_FEEDBACK[btn.dataset.key];
      });
    });
  }
})();
