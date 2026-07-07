(() => {
  'use strict';

  const { cssVar, stripOffset, buildNightLayer, DATA_URL } = window.LakeCommon;

  function pad(n) { return String(n).padStart(2, '0'); }

  function getDo(hourly, dateStr, hour) {
    const key = `${dateStr}T${pad(hour)}:00`;
    const row = hourly.find((h) => h.t.startsWith(key));
    return row ? row.do_mgl : null;
  }

  // Classic diel-oxygen night-slope method: the night rate is pure ER (no
  // photosynthesis in the dark), then that same ER rate is assumed to
  // continue through daylight hours and subtracted back out to recover GPP.
  // This intentionally ignores atmospheric gas exchange (Module 3's third
  // process) - a standard simplification at this teaching level.
  function calcMetabolism(hourly, d1, d2, nightHours, dayHours) {
    const nightStart = getDo(hourly, d1, 21);
    const nightEnd = getDo(hourly, d2, 5);
    const dayEnd = getDo(hourly, d2, 20);
    const rate = (nightEnd - nightStart) / nightHours;
    const erDay = Math.abs(rate) * dayHours;
    const dayChange = dayEnd - nightEnd;
    const gppDay = dayChange + erDay;
    const erDaily = Math.abs(rate) * 24;
    const nep = gppDay - erDaily;
    return { nightStart, nightEnd, dayEnd, rate, erDay, dayChange, gppDay, erDaily, nep };
  }

  function fmtSigned(v, digits) {
    const s = Math.abs(v).toFixed(digits == null ? 2 : digits);
    return (v >= 0 ? '+' : '−') + s;
  }

  function fillBalance(prefix, calc) {
    document.getElementById(`${prefix}Gpp`).textContent = '+' + calc.gppDay.toFixed(2);
    document.getElementById(`${prefix}Er`).textContent = '−' + calc.erDaily.toFixed(2);
    document.getElementById(`${prefix}Op`).textContent = calc.gppDay >= calc.erDaily ? '>' : '<';
    document.getElementById(`${prefix}Net`).textContent = `Net = ${fmtSigned(calc.nep)} mg/L/day`;
  }

  // The day slope is GPP and ER acting at once, so it alone isn't either
  // number - but subtracting out the respiration rate the night slope just
  // revealed (assumed to hold steady through daylight too) separates them.
  function fillSummary(calc) {
    const erRate = Math.abs(calc.rate);
    const dayRate = calc.dayChange / 15;
    const gppRate = dayRate + erRate;

    document.getElementById('sumNightFormula').textContent =
      `(${calc.nightEnd.toFixed(2)} − ${calc.nightStart.toFixed(2)}) ÷ 8 = ${calc.rate.toFixed(2)} mg/L/hr → ER rate = ${erRate.toFixed(2)} mg/L/hr`;
    document.getElementById('sumDayFormula').textContent =
      `(${calc.dayEnd.toFixed(2)} − ${calc.nightEnd.toFixed(2)}) ÷ 15 = ${fmtSigned(dayRate)} mg/L/hr`;
    document.getElementById('sumGppRateFormula').textContent =
      `${fmtSigned(dayRate)} + ${erRate.toFixed(2)} = ${fmtSigned(gppRate)} mg/L/hr`;
    document.getElementById('sumGppFormula').textContent =
      `${fmtSigned(gppRate)} × 15 hr = ${fmtSigned(calc.gppDay)} mg/L`;
    document.getElementById('sumErFormula').textContent =
      `${erRate.toFixed(2)} × 24 hr = ${calc.erDaily.toFixed(2)} mg/L`;
    document.getElementById('sumNepFormula').textContent =
      `${fmtSigned(calc.gppDay)} − ${calc.erDaily.toFixed(2)} = ${fmtSigned(calc.nep)} mg/L/day`;
  }

  fetch(DATA_URL)
    .then((r) => r.json())
    .then(init)
    .catch((err) => {
      document.querySelector('.content').innerHTML =
        '<p style="padding:40px;color:var(--text-secondary)">Could not load lake data (' + err + ').</p>';
    });

  function init(data) {
    const hourly = data.hourly;
    const doColor = cssVar('--series-do');
    const { nightShapes, sunAnnotations } = buildNightLayer(data);

    const calc1 = calcMetabolism(hourly, '2023-07-09', '2023-07-10', 8, 15);
    const calc2 = calcMetabolism(hourly, '2023-07-14', '2023-07-15', 8, 15);
    fillBalance('ex1', calc1);
    fillBalance('ex2', calc2);
    document.getElementById('ex1NetBadge').textContent = `Net ${fmtSigned(calc1.nep)} mg/L/day`;
    document.getElementById('ex2NetBadge').textContent = `Net ${fmtSigned(calc2.nep)} mg/L/day`;

    // Draws the oxygen curve for one night+day window (evening of d1 through
    // evening of d2), with night shading and markers at the three points the
    // calculation actually uses. Compares on the stripped (offset-free)
    // timestamp throughout - the raw `h.t` strings carry a "-05:00" suffix,
    // which makes naive string comparison against a bare boundary like
    // '...T23:00:00' silently drop the row exactly at that boundary (a
    // longer string that shares a prefix sorts *after* the shorter one).
    function drawNightDayChart(plotId, d1, d2, calc, compact, highlightSlopes) {
      const windowStart = `${d1}T18:00:00`;
      const windowEnd = `${d2}T23:00:00`;
      const windowRows = hourly.filter((h) => {
        const s = stripOffset(h.t);
        return s >= windowStart && s <= windowEnd;
      });
      const xAll = windowRows.map((h) => stripOffset(h.t));
      const yAll = windowRows.map((h) => h.do_mgl);

      const markerT = [
        stripOffset(hourly.find((h) => h.t.startsWith(`${d1}T21:00`)).t),
        stripOffset(hourly.find((h) => h.t.startsWith(`${d2}T05:00`)).t),
        stripOffset(hourly.find((h) => h.t.startsWith(`${d2}T20:00`)).t),
      ];
      const markerY = [calc.nightStart, calc.nightEnd, calc.dayEnd];

      const traces = [
        {
          x: xAll, y: yAll, type: 'scatter', mode: 'lines',
          line: { color: doColor, width: 2, shape: 'spline', smoothing: 0.3 },
          hovertemplate: '%{y:.2f} mg/L<extra></extra>',
        },
      ];
      if (highlightSlopes) {
        traces.push({
          x: [markerT[0], markerT[1]], y: [markerY[0], markerY[1]],
          type: 'scatter', mode: 'lines',
          line: { color: '#000000', width: 3 },
          name: 'Night slope', hovertemplate: '%{y:.2f} mg/L<extra>Night slope</extra>',
        });
        traces.push({
          x: [markerT[1], markerT[2]], y: [markerY[1], markerY[2]],
          type: 'scatter', mode: 'lines',
          line: { color: '#7f1d1d', width: 3 },
          name: 'Day slope', hovertemplate: '%{y:.2f} mg/L<extra>Day slope</extra>',
        });
      }
      traces.push({
        x: markerT, y: markerY, type: 'scatter', mode: 'markers',
        marker: { size: compact ? 8 : 11, color: doColor, line: { color: cssVar('--surface-1'), width: 2 } },
        hoverinfo: 'skip',
      });

      Plotly.newPlot(plotId, traces, {
        margin: compact ? { l: 36, r: 8, t: 6, b: 22 } : { l: 44, r: 12, t: 26, b: 28 },
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        font: { family: 'system-ui, -apple-system, "Segoe UI", sans-serif', color: cssVar('--text-secondary'), size: 11 },
        showlegend: false,
        shapes: nightShapes,
        annotations: sunAnnotations,
        xaxis: {
          type: 'date',
          range: [xAll[0], xAll[xAll.length - 1]],
          tickformat: '%a %-I%p',
          gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') },
        },
        yaxis: { gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') }, zeroline: false },
        hovermode: 'x',
      }, { displayModeBar: false, responsive: true, scrollZoom: false });
    }

    drawNightDayChart('m6Plot', '2023-07-09', '2023-07-10', calc1, false, true);
    drawNightDayChart('ex1Plot', '2023-07-09', '2023-07-10', calc1, true, false);
    drawNightDayChart('ex2Plot', '2023-07-14', '2023-07-15', calc2, true, false);

    document.getElementById('m6NightStartVal').textContent = calc1.nightStart.toFixed(2);
    document.getElementById('m6NightEndVal').textContent = calc1.nightEnd.toFixed(2);

    // ---- Step 1: night slope ----
    const step1Input = document.getElementById('m6Step1Input');
    const step1Feedback = document.getElementById('m6Step1Feedback');
    const step2Card = document.getElementById('m6Step2Card');

    document.getElementById('m6Step1Check').addEventListener('click', () => {
      const guess = Number(step1Input.value);
      step1Feedback.hidden = false;
      if (!Number.isFinite(guess)) {
        step1Feedback.textContent = 'Enter a number to check.';
        step1Feedback.classList.remove('is-correct', 'is-incorrect');
        return;
      }
      const correct = Math.abs(guess - calc1.rate) <= 0.02;
      step1Feedback.classList.toggle('is-correct', correct);
      step1Feedback.classList.toggle('is-incorrect', !correct);
      if (correct) {
        step1Feedback.textContent = `Yes: (${calc1.nightEnd.toFixed(2)} − ${calc1.nightStart.toFixed(2)}) / 8 hours ≈ ${calc1.rate.toFixed(2)} mg/L/hr. Since nothing produces oxygen at night, this whole rate is respiration: ER ≈ ${Math.abs(calc1.rate).toFixed(2)} mg/L/hr.`;
      } else {
        step1Feedback.textContent = `Not quite. Rate = change ÷ time = (${calc1.nightEnd.toFixed(2)} − ${calc1.nightStart.toFixed(2)}) ÷ 8. Try again.`;
      }
      if (correct && step2Card.hidden) {
        document.getElementById('m6DayStartVal').textContent = calc1.nightEnd.toFixed(2);
        document.getElementById('m6DayEndVal').textContent = calc1.dayEnd.toFixed(2);
        step2Card.hidden = false;
        step2Card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });

    // ---- Step 2: daytime slope ----
    const step2Input = document.getElementById('m6Step2Input');
    const step2Feedback = document.getElementById('m6Step2Feedback');
    const summary = document.getElementById('m6Summary');
    const verdict = document.getElementById('m6Verdict');
    const dayRateTrue = calc1.dayChange / 15;

    document.getElementById('m6Step2Check').addEventListener('click', () => {
      const guess = Number(step2Input.value);
      step2Feedback.hidden = false;
      if (!Number.isFinite(guess)) {
        step2Feedback.textContent = 'Enter a number to check.';
        step2Feedback.classList.remove('is-correct', 'is-incorrect');
        return;
      }
      const correct = Math.abs(guess - dayRateTrue) <= 0.02;
      step2Feedback.classList.toggle('is-correct', correct);
      step2Feedback.classList.toggle('is-incorrect', !correct);
      if (correct) {
        step2Feedback.textContent = `Yes: (${calc1.dayEnd.toFixed(2)} − ${calc1.nightEnd.toFixed(2)}) / 15 hours ≈ ${fmtSigned(dayRateTrue)} mg/L/hr. That's GPP and ER blended together - next, let's pull them apart.`;
      } else {
        step2Feedback.textContent = `Not quite. Rate = change ÷ time = (${calc1.dayEnd.toFixed(2)} − ${calc1.nightEnd.toFixed(2)}) ÷ 15. Try again.`;
      }
      if (correct && summary.hidden) {
        fillSummary(calc1);
        summary.hidden = false;
        fillBalance('verdict', calc1);
        document.getElementById('verdictText').textContent = calc1.nep >= 0
          ? `Gross Primary Production beat Ecosystem Respiration on July 9–10: this stretch of lake was autotrophic, producing a bit more organic matter than it consumed.`
          : `Ecosystem Respiration beat Gross Primary Production on July 9–10: this stretch of lake was heterotrophic, consuming more organic matter than it produced that day.`;
        verdict.hidden = false;
        summary.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });

    initQuiz('q1Grid', 'q1Feedback', {
      q1falls: "Not quite — if more oxygen is being added than removed, the total can't be falling.",
      q1same: 'Not quite — that would only happen if GPP and ER exactly matched.',
      q1rises: 'Right. More oxygen is being produced than consumed, so the surplus builds up: oxygen rises.',
    });
    initQuiz('q2Grid', 'q2Feedback', {
      q2rises: "Not quite — if more oxygen is being removed than added, the total can't be rising.",
      q2same: 'Not quite — that would only happen if GPP and ER exactly matched.',
      q2falls: 'Right. More oxygen is being consumed than produced, so the pool drains down: oxygen falls.',
    });
  }

  function initQuiz(gridId, feedbackId, messages) {
    const grid = document.getElementById(gridId);
    const feedback = document.getElementById(feedbackId);
    Array.from(grid.children).forEach((btn) => {
      btn.addEventListener('click', () => {
        const correct = btn.dataset.correct === 'true';
        Array.from(grid.children).forEach((b) => b.classList.remove('is-correct', 'is-incorrect'));
        btn.classList.add(correct ? 'is-correct' : 'is-incorrect');
        feedback.hidden = false;
        feedback.classList.toggle('is-correct', correct);
        feedback.classList.toggle('is-incorrect', !correct);
        feedback.textContent = (correct ? '✅ ' : '🤔 ') + messages[btn.dataset.key];
      });
    });
  }
})();
