(() => {
  'use strict';

  const { cssVar, buildNightLayer, DATA_URL, WEEKDAYS } = window.LakeCommon;

  // Simplified process rates, hand-tuned (see scripts/build_dataset.py sibling
  // notes) so that with all three processes on the simulated curve lands in
  // the same 8-13 mg/L ballpark as the real observed week, while each single
  // process removed produces a clearly distinct "aha" shape.
  const ALPHA = 0.0002;   // mg/L added per hour, per unit PAR (photosynthesis)
  const R_CONST = 0.05;   // mg/L removed per hour, constant (respiration)
  const K_GAS = 0.006;    // gas-exchange rate per hour, per unit wind (m/s)

  function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

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
    const days = data.days;
    const par = hourly.map((h) => h.par);
    const wind = hourly.map((h) => h.wind_ms);
    const temp = hourly.map((h) => h.wtemp_c);
    const { nightShapes, sunAnnotations, xAll } = buildNightLayer(data);
    const equilibrium = temp.map(doSat);

    // Day labels ("Mon 10") are rendered as annotations centered at each
    // day's noon, decoupled from the axis ticks - the gridlines themselves
    // stay at midnight (set via xaxis.dtick below).
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

    const toggles = { photo: true, resp: true, gas: true };

    const togglePhoto = document.getElementById('togglePhoto');
    const toggleResp = document.getElementById('toggleResp');
    const toggleGas = document.getElementById('toggleGas');
    const stateCaptionText = document.getElementById('stateCaptionText');

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
      annotations: sunAnnotations.concat(dayLabelAnnotations),
      xaxis: {
        type: 'date',
        range: [xAll[0], xAll[xAll.length - 1]],
        dtick: 86400000,
        tick0: `${days[0].date}T00:00:00`,
        showticklabels: false,
        gridcolor: cssVar('--gridline'),
        linecolor: cssVar('--baseline'),
        tickfont: { color: cssVar('--text-muted') },
        hoverformat: '%a %b %-d, %-I:%M %p',
      },
      yaxis: {
        title: { text: 'Dissolved Oxygen (mg/L)', font: { size: 12, color: cssVar('--text-secondary') } },
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

    function recompute() {
      const y = simulate(par, wind, temp, toggles);
      Plotly.restyle('simPlot', { y: [y] }, [0]);
      stateCaptionText.textContent = CAPTIONS[toggleKey()];
    }

    togglePhoto.addEventListener('change', () => { toggles.photo = togglePhoto.checked; recompute(); });
    toggleResp.addEventListener('change', () => { toggles.resp = toggleResp.checked; recompute(); });
    toggleGas.addEventListener('change', () => { toggles.gas = toggleGas.checked; recompute(); });

    recompute();
    initQuiz();
    initPhysicsDemo();
  }

  function initPhysicsDemo() {
    const tempSlider = document.getElementById('physTempSlider');
    const windSlider = document.getElementById('physWindSlider');
    const tempValue = document.getElementById('physTempValue');
    const windValue = document.getElementById('physWindValue');
    const eqValue = document.getElementById('physEqValue');

    const eqColor = cssVar('--baseline');
    const HOURS = 72;
    const tArr = Array.from({ length: HOURS + 1 }, (_, i) => i);

    // Three fixed initial conditions, always shown together, so students can
    // compare all three at once instead of picking one at a time.
    const STARTS = [
      { pct: 120, color: cssVar('--critical'), label: 'Starts at 120% saturation' },
      { pct: 80, color: cssVar('--series-do'), label: 'Starts at 80% saturation' },
    ];

    function equilibrium() {
      return doSat(Number(tempSlider.value));
    }

    // Closed-form solution of dO2/dt = k * (E - O2): O2 always relaxes
    // exponentially toward equilibrium E, at a rate set by wind.
    function relaxCurve(pct) {
      const E = equilibrium();
      const k = K_GAS * Number(windSlider.value);
      const O0 = E * (pct / 100);
      return tArr.map((t) => E + (O0 - E) * Math.exp(-k * t));
    }

    const physLayout = {
      margin: { l: 48, r: 12, t: 10, b: 36 },
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      font: { family: 'system-ui, -apple-system, "Segoe UI", sans-serif', color: cssVar('--text-secondary'), size: 11 },
      showlegend: false,
      xaxis: {
        title: { text: 'Hours', font: { size: 12, color: cssVar('--text-secondary') } },
        range: [0, HOURS],
        gridcolor: cssVar('--gridline'),
        linecolor: cssVar('--baseline'),
        tickfont: { color: cssVar('--text-muted') },
      },
      yaxis: {
        title: { text: 'Dissolved oxygen (mg/L)', font: { size: 12, color: cssVar('--text-secondary') } },
        range: [5.5, 17.5],
        gridcolor: cssVar('--gridline'),
        linecolor: cssVar('--baseline'),
        tickfont: { color: cssVar('--text-muted') },
        zeroline: false,
      },
      hovermode: 'x',
    };

    function drawChart() {
      const E = equilibrium();
      const [yMin, yMax] = physLayout.yaxis.range;
      const traces = STARTS.map((s) => ({
        x: tArr, y: relaxCurve(s.pct), type: 'scatter', mode: 'lines',
        line: { color: s.color, width: 2.5 },
        hovertemplate: `%{y:.2f} mg/L<extra>${s.label}</extra>`,
      }));
      traces.push({
        x: [0, HOURS], y: [E, E], type: 'scatter', mode: 'lines',
        line: { color: eqColor, width: 1.5, dash: 'dash' },
        hovertemplate: '%{y:.2f} mg/L<extra>Equilibrium</extra>',
      });
      const annotations = [
        {
          x: HOURS, y: 1, xref: 'x', yref: 'paper',
          xanchor: 'right', yanchor: 'top', yshift: -4,
          text: '<b>Supersaturated</b> —<br>O₂ leaving the lake',
          showarrow: false,
          font: { size: 13, color: STARTS[0].color },
        },
        {
          x: HOURS, y: 0, xref: 'x', yref: 'paper',
          xanchor: 'right', yanchor: 'bottom', yshift: 4,
          text: '<b>Undersaturated</b> —<br>O₂ entering the lake',
          showarrow: false,
          font: { size: 13, color: STARTS[1].color },
        },
      ];
      // Background tint tracks the equilibrium line, splitting the plot into
      // a supersaturated zone (above) and undersaturated zone (below).
      const shapes = [
        {
          type: 'rect', xref: 'x', yref: 'y', layer: 'below', line: { width: 0 },
          x0: 0, x1: HOURS, y0: E, y1: yMax,
          fillcolor: hexToRgba(STARTS[0].color, 0.08),
        },
        {
          type: 'rect', xref: 'x', yref: 'y', layer: 'below', line: { width: 0 },
          x0: 0, x1: HOURS, y0: yMin, y1: E,
          fillcolor: hexToRgba(STARTS[1].color, 0.08),
        },
      ];
      Plotly.newPlot('physPlot', traces, { ...physLayout, annotations, shapes }, {
        displayModeBar: false, responsive: true, scrollZoom: false,
      });
    }

    function updateReadouts() {
      const t = Number(tempSlider.value);
      const w = Number(windSlider.value);
      tempValue.textContent = (Number.isInteger(t) ? t : t.toFixed(1)) + '°C';
      windValue.textContent = (Number.isInteger(w) ? w : w.toFixed(1)) + ' m/s';
      eqValue.textContent = equilibrium().toFixed(2);
    }

    function onControlsChanged() {
      updateReadouts();
      drawChart();
    }

    tempSlider.addEventListener('input', onControlsChanged);
    windSlider.addEventListener('input', onControlsChanged);

    updateReadouts();
    drawChart();
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

  const FINAL_QUESTIONS = [
    {
      scenario: "At 2:00 PM on a sunny day, the lake is 110% air saturation, and dissolved oxygen is still increasing.",
      question: 'Which process must be strongest at that moment?',
      options: [
        { text: 'Respiration', correct: false, why: "Not quite — respiration only removes oxygen, it never adds it. If respiration were the strongest process, oxygen would be falling, not rising." },
        { text: 'Photosynthesis', correct: true, why: "Right. Gas exchange is actually removing oxygen because the lake is supersaturated, and respiration is also removing oxygen. The only way oxygen can still be increasing is if photosynthesis is adding it faster than both of those processes combined." },
        { text: 'Gas exchange', correct: false, why: "Not quite — the lake is supersaturated (110%), so gas exchange is pulling oxygen out toward equilibrium, not adding it. That works against the increase you're seeing." },
        { text: 'Wind mixing', correct: false, why: "Not quite — wind controls the speed of gas exchange, and since the lake is supersaturated, faster wind would only pull oxygen out faster, not add it." },
      ],
    },
    {
      scenario: 'A lake is 120% air saturation just before sunset. The wind stays the same overnight.',
      question: 'What will happen to dissolved oxygen during the night?',
      options: [
        { text: 'Oxygen will continue increasing because the lake is supersaturated.', correct: false, why: "Not quite — being supersaturated doesn't cause oxygen to keep rising by itself. Once the sun sets, photosynthesis (the only process that adds oxygen) shuts off." },
        { text: 'Oxygen will stay constant until sunrise.', correct: false, why: "Not quite — respiration never stops, and gas exchange keeps pulling oxygen out of a supersaturated lake. With photosynthesis off overnight, nothing is left to balance those losses." },
        { text: 'Oxygen will decrease because photosynthesis stops while respiration and gas exchange continue.', correct: true, why: "Right. Once the sun sets, photosynthesis stops. Respiration continues using oxygen, and because the lake is supersaturated, gas exchange also removes oxygen. Both processes work in the same direction, so dissolved oxygen decreases through the night." },
        { text: 'Oxygen will immediately fall to 100% air saturation.', correct: false, why: "Not quite — gas exchange and respiration remove oxygen gradually, not instantly. The lake will drift toward equilibrium over the course of the night, not jump there right away." },
      ],
    },
    {
      scenario: 'The lake is at 120% air saturation. You can only change one thing.',
      question: 'Which change will cause oxygen to leave the lake fastest?',
      options: [
        { text: 'Turn on photosynthesis.', correct: false, why: "Not quite — photosynthesis only adds oxygen, it never removes it. Turning it on would work against oxygen leaving the lake." },
        { text: 'Increase wind speed.', correct: true, why: "Right. The lake is already supersaturated, so gas exchange is already pulling oxygen out toward equilibrium. Increasing wind speed speeds up gas exchange, so oxygen leaves fastest." },
        { text: 'Cool the lake.', correct: false, why: "Not quite — cooling the lake raises the equilibrium target (colder water can hold more oxygen), which would slow oxygen loss, not speed it up." },
        { text: 'Add more algae.', correct: false, why: "Not quite — more algae means more photosynthesis, which adds oxygen. That's the opposite of what you want." },
      ],
    },
  ];

  function initFinalQuiz() {
    const startBtn = document.getElementById('finalQuizStartBtn');
    const panel = document.getElementById('finalQuizPanel');
    const deck = document.getElementById('finalQuizDeck');
    const progressEl = document.getElementById('finalQuizProgress');
    const scenarioEl = document.getElementById('finalQuizScenario');
    const questionEl = document.getElementById('finalQuizQuestion');
    const optionsEl = document.getElementById('finalQuizOptions');
    const feedbackEl = document.getElementById('finalQuizFeedback');
    const nextBtn = document.getElementById('finalQuizNextBtn');
    const doneEl = document.getElementById('finalQuizDone');

    let qIdx = 0;

    function renderQuestion() {
      const q = FINAL_QUESTIONS[qIdx];
      progressEl.textContent = `Question ${qIdx + 1} of ${FINAL_QUESTIONS.length}`;
      scenarioEl.textContent = q.scenario;
      questionEl.textContent = q.question;
      feedbackEl.hidden = true;
      nextBtn.hidden = true;

      optionsEl.innerHTML = '';
      q.options.forEach((opt) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'quiz-option';
        btn.textContent = opt.text;
        btn.addEventListener('click', () => {
          // Match Module 3's quiz behavior: only the clicked option is
          // marked, buttons stay enabled, so a wrong guess can be retried.
          Array.from(optionsEl.children).forEach((b) => b.classList.remove('is-correct', 'is-incorrect'));
          btn.classList.add(opt.correct ? 'is-correct' : 'is-incorrect');

          feedbackEl.hidden = false;
          feedbackEl.classList.toggle('is-correct', opt.correct);
          feedbackEl.classList.toggle('is-incorrect', !opt.correct);
          feedbackEl.textContent = (opt.correct ? '✅ ' : '🤔 ') + opt.why;

          nextBtn.hidden = !opt.correct;
          if (opt.correct) {
            nextBtn.textContent = qIdx < FINAL_QUESTIONS.length - 1 ? 'Next question →' : 'See results →';
          }
        });
        optionsEl.appendChild(btn);
      });
    }

    startBtn.addEventListener('click', () => {
      startBtn.hidden = true;
      panel.hidden = false;
      qIdx = 0;
      renderQuestion();
    });

    nextBtn.addEventListener('click', () => {
      qIdx++;
      if (qIdx < FINAL_QUESTIONS.length) {
        renderQuestion();
      } else {
        deck.hidden = true;
        doneEl.hidden = false;
      }
    });
  }

  initFinalQuiz();
})();
