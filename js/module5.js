(() => {
  'use strict';

  const { cssVar, stripOffset, buildNightLayer, DATA_URL, EXTENDED_DATA_URL } = window.LakeCommon;

  function pad(n) { return String(n).padStart(2, '0'); }

  function getDo(hourly, dateStr, hour) {
    const key = `${dateStr}T${pad(hour)}:00`;
    const row = hourly.find((h) => h.t.startsWith(key));
    return row ? row.do_mgl : null;
  }

  // Classic diel-oxygen night-slope method: the night rate is pure ER (no
  // photosynthesis in the dark), then that same ER rate is assumed to
  // continue through daylight hours and subtracted back out to recover GPP.
  // This intentionally ignores atmospheric gas exchange (Module 2's third
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
    // Respiration is kept as a signed (negative) rate throughout this
    // summary, matching how it's plotted and how the verdict boxes already
    // display it - GPP adds oxygen (+), ER removes it (−).
    const dayRate = calc.dayChange / 15;
    const gppRate = dayRate - calc.rate;
    const erDailySigned = calc.rate * 24;

    document.getElementById('sumNightFormula').innerHTML =
      `(${calc.nightEnd.toFixed(2)} − ${calc.nightStart.toFixed(2)}) ÷ 8 = <strong>${fmtSigned(calc.rate)} mg/L/hr</strong>`;
    document.getElementById('sumDayFormula').innerHTML =
      `(${calc.dayEnd.toFixed(2)} − ${calc.nightEnd.toFixed(2)}) ÷ 15 = <strong>${fmtSigned(dayRate)} mg/L/hr</strong>`;
    document.getElementById('sumGppRateFormula').innerHTML =
      `${fmtSigned(dayRate)} − (${fmtSigned(calc.rate)}) = <strong>${fmtSigned(gppRate)} mg/L/hr</strong>`;
    document.getElementById('sumGppFormula').innerHTML =
      `${fmtSigned(gppRate)} × 15 hr = <strong>${fmtSigned(calc.gppDay)} mg/L</strong>`;
    document.getElementById('sumErFormula').innerHTML =
      `${fmtSigned(calc.rate)} × 24 hr = <strong>${fmtSigned(erDailySigned)} mg/L</strong>`;
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
          line: { color: '#b8860b', width: 3 },
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
        yaxis: {
          title: compact ? undefined : { text: 'Dissolved oxygen (mg/L)', font: { size: 12, color: cssVar('--text-secondary') } },
          gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') }, zeroline: false,
        },
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
        step1Feedback.textContent = `Yes: (${calc1.nightEnd.toFixed(2)} − ${calc1.nightStart.toFixed(2)}) / 8 hours ≈ ${calc1.rate.toFixed(2)} mg/L/hr. Since nothing produces oxygen at night, this whole rate is respiration: ER ≈ ${fmtSigned(calc1.rate)} mg/L/hr.`;
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
    const nepSection = document.getElementById('m6Nep');
    const nepQuestion = document.getElementById('m6NepQuestion');
    const nepInput = document.getElementById('m6NepInput');
    const nepFeedback = document.getElementById('m6NepFeedback');
    const verdictNetEl = document.getElementById('verdictNet');
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
          : `Ecosystem Respiration beat Gross Primary Production on July 9–10: the lake ecosystem was consuming more organic matter than it produced that day.`;
        verdict.hidden = false;
        nepSection.hidden = false;
        nepQuestion.hidden = false;
        summary.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });

    // ---- NEP question ----
    document.getElementById('m6NepCheck').addEventListener('click', () => {
      const guess = Number(nepInput.value);
      nepFeedback.hidden = false;
      if (!Number.isFinite(guess)) {
        nepFeedback.textContent = 'Enter a number to check.';
        nepFeedback.classList.remove('is-correct', 'is-incorrect');
        return;
      }
      const correct = Math.abs(guess - calc1.nep) <= 0.05;
      nepFeedback.classList.toggle('is-correct', correct);
      nepFeedback.classList.toggle('is-incorrect', !correct);
      if (correct) {
        nepFeedback.textContent = `Yes: NEP = GPP − ER = ${fmtSigned(calc1.gppDay)} − ${calc1.erDaily.toFixed(2)} = ${fmtSigned(calc1.nep)} mg/L/day.`;
        verdictNetEl.hidden = false;
      } else {
        nepFeedback.textContent = `Not quite. NEP = GPP − ER, using the values from the verdict above. Try again.`;
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

    initQuiz('recallQ1Grid', 'recallQ1Feedback', {
      true: 'Right. Autotrophs build their own organic matter from CO₂ (via photosynthesis); heterotrophs get theirs by eating other organisms.',
      false: 'Not quite — that description is correct. Autotrophs build their own organic matter from CO₂; heterotrophs get theirs by eating other organisms.',
    });
    initQuiz('recallQ2Grid', 'recallQ2Feedback', {
      trout: "Not quite — a trout eats other organisms for its organic matter, which makes it a heterotroph.",
      zooplankton: 'Not quite — zooplankton graze on algae and other organic matter, which makes them heterotrophs.',
      algae: 'Right. Algae photosynthesize, building their own organic matter from CO₂ - that makes them autotrophs.',
      bacteria: 'Not quite — bacteria that consume organic matter are heterotrophs, not autotrophs.',
    });

    // ---- reveal: keep the recall quiz collapsed until requested ----
    const recallStartBtn = document.getElementById('recallStartBtn');
    const recallPanel = document.getElementById('recallPanel');
    recallStartBtn.addEventListener('click', () => {
      recallPanel.hidden = false;
      recallStartBtn.hidden = true;
      recallPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });

    // ---- gate: no peeking at autotrophic/heterotrophic or the farm analogy
    // until the student has written their own answer ----
    const recallNotes = document.getElementById('recallNotes');
    const recallContinueBtn = document.getElementById('recallContinueBtn');
    const autoHeteroSection = document.getElementById('m6AutoHetero');
    const farmSection = document.getElementById('m6FarmAnalogy');

    recallNotes.value = localStorage.getItem('everyLakeMetabolism.recallNotes') || '';
    recallContinueBtn.disabled = recallNotes.value.trim().length === 0;
    recallNotes.addEventListener('input', () => {
      localStorage.setItem('everyLakeMetabolism.recallNotes', recallNotes.value);
      recallContinueBtn.disabled = recallNotes.value.trim().length === 0;
    });

    recallContinueBtn.addEventListener('click', () => {
      autoHeteroSection.hidden = false;
      farmSection.hidden = false;
      // These two charts were drawn earlier while their section was still
      // display:none, so Plotly sized them at 0x0 - force a resize now that
      // the container has real dimensions, or they'd stay invisible.
      Plotly.Plots.resize('ex1Plot');
      Plotly.Plots.resize('ex2Plot');
      autoHeteroSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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

  // ==========================================================================
  // Why high-frequency data matter - moved here from Module 4, since it uses
  // the same July 9-10 night as the GPP/ER calculation above. Runs on the
  // two-month extended dataset (5-minute resolution), independent of the
  // one-week fetch the rest of this module uses.
  // ==========================================================================

  // All timestamps in data/mendota_extended.json are naive "YYYY-MM-DDTHH:MM:SS"
  // strings (no timezone). Rather than round-trip them through `new Date()`
  // (whose wall-clock interpretation depends on the browser's own timezone),
  // these convert to/from a plain "minutes since 2023-01-01" integer using
  // Date.UTC purely as a calendar day-counter - safe regardless of the
  // reader's own timezone, since no wall-clock interpretation is involved.
  const HF_EPOCH_Y = 2023;
  function hfToMinutes(ts) {
    const y = +ts.slice(0, 4), mo = +ts.slice(5, 7), d = +ts.slice(8, 10);
    const hh = +ts.slice(11, 13), mm = +ts.slice(14, 16);
    const dayIndex = Math.round((Date.UTC(y, mo - 1, d) - Date.UTC(HF_EPOCH_Y, 0, 1)) / 86400000);
    return dayIndex * 1440 + hh * 60 + mm;
  }
  function hfFromMinutes(total) {
    const dayIndex = Math.floor(total / 1440);
    const rem = total - dayIndex * 1440;
    const hh = Math.floor(rem / 60), mm = rem % 60;
    const dt = new Date(Date.UTC(HF_EPOCH_Y, 0, 1) + dayIndex * 86400000);
    const pad2 = (n) => String(n).padStart(2, '0');
    return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}T${pad2(hh)}:${pad2(mm)}:00`;
  }
  function hfNearestIndex(sortedMinutes, target) {
    let lo = 0, hi = sortedMinutes.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sortedMinutes[mid] < target) lo = mid + 1; else hi = mid;
    }
    if (lo > 0 && Math.abs(sortedMinutes[lo - 1] - target) <= Math.abs(sortedMinutes[lo] - target)) return lo - 1;
    return lo;
  }
  // Regular-interval sampling: picks the nearest real observation to each
  // target time on a fixed grid, starting at the series' first timestamp -
  // exactly what a technician visiting on a fixed schedule would collect.
  function hfSampleRegular(series, minutesArr, intervalMinutes, toleranceMinutes) {
    const tol = toleranceMinutes || Math.max(15, intervalMinutes / 2);
    const startM = minutesArr[0];
    const endM = minutesArr[minutesArr.length - 1];
    const out = [];
    for (let t = startM; t <= endM; t += intervalMinutes) {
      const idx = hfNearestIndex(minutesArr, t);
      if (Math.abs(minutesArr[idx] - t) <= tol) out.push(series[idx]);
    }
    return out;
  }

  const HF_RUNGS = [
    { key: 'weekly', label: 'weekly', minutes: 7 * 24 * 60 },
    { key: 'daily', label: 'daily', minutes: 24 * 60 },
    { key: '6hourly', label: 'every 6 hours', minutes: 6 * 60 },
    { key: 'hourly', label: 'hourly', minutes: 60 },
    { key: '15min', label: 'every 15 minutes', minutes: 15 },
  ];

  fetch(EXTENDED_DATA_URL)
    .then((r) => r.json())
    .then(initHighFreqDemo)
    .catch(() => {
      // Silent: this demo is a supplementary section: the rest of the page
      // (which fetches its own, separate week of data) still works fine.
    });

  function initHighFreqDemo(data) {
    const titleEl = document.getElementById('p4Title');
    const rateEl = document.getElementById('p4RateOut');
    const explainEl = document.getElementById('p4Explain');
    const switchEl = document.getElementById('p4Switch');

    const fiveMinDo = data.five_min_do;
    const fiveMinMinutes = fiveMinDo.map((p) => hfToMinutes(p.t));

    const day1 = data.days.find((d) => d.date === '2023-07-09');
    const day2 = data.days.find((d) => d.date === '2023-07-10');
    const nightStartM = hfToMinutes(`2023-07-09T${day1.sunset}:00`);
    const nightEndM = hfToMinutes(`2023-07-10T${day2.sunrise}:00`);
    // pad the plotted window a couple hours either side of the night itself,
    // so the sparser rungs have a fighting chance of landing a point nearby
    const viewStartM = nightStartM - 120;
    const viewEndM = nightEndM + 120;
    const nightShape = {
      type: 'rect', xref: 'x', yref: 'paper',
      x0: hfFromMinutes(nightStartM), x1: hfFromMinutes(nightEndM), y0: 0, y1: 1,
      fillcolor: cssVar('--night-fill'),
      line: { width: 0 },
      layer: 'below',
    };

    const trueNight = fiveMinDo.filter((p) => {
      const m = hfToMinutes(p.t);
      return m >= nightStartM && m <= nightEndM;
    });
    const trueRate = (trueNight[trueNight.length - 1].do_mgl - trueNight[0].do_mgl) /
      ((nightEndM - nightStartM) / 60);

    function draw(rungIdx) {
      const rung = HF_RUNGS[rungIdx];
      titleEl.textContent = `One night, sampled ${rung.label}`;

      // Sample the whole record on this rung's grid, then keep only the
      // points that land inside the plotted window.
      const sampledAll = hfSampleRegular(fiveMinDo, fiveMinMinutes, rung.minutes);
      const windowed = sampledAll.filter((p) => {
        const m = hfToMinutes(p.t);
        return m >= viewStartM && m <= viewEndM;
      });
      const nightPoints = sampledAll.filter((p) => {
        const m = hfToMinutes(p.t);
        return m >= nightStartM && m <= nightEndM;
      });

      Plotly.react('p4Plot', [
        {
          x: trueNight.map((p) => p.t), y: trueNight.map((p) => p.do_mgl),
          type: 'scatter', mode: 'lines',
          line: { color: cssVar('--baseline'), width: 1.5, dash: 'dot' },
          hoverinfo: 'skip', name: 'True record (reference)',
        },
        {
          x: windowed.map((p) => p.t), y: windowed.map((p) => p.do_mgl),
          type: 'scatter', mode: 'markers+lines',
          line: { color: cssVar('--series-do'), width: 1.8 },
          marker: { size: 9, color: cssVar('--series-do') },
          name: 'Your data', hovertemplate: '%{y:.2f} mg/L<extra></extra>',
        },
      ], {
        margin: { l: 48, r: 12, t: 10, b: 28 },
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        font: { family: 'system-ui, -apple-system, "Segoe UI", sans-serif', color: cssVar('--text-secondary'), size: 11 },
        showlegend: false,
        shapes: [nightShape],
        xaxis: {
          type: 'date', range: [hfFromMinutes(viewStartM), hfFromMinutes(viewEndM)], tickformat: '%-I %p',
          gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') },
        },
        yaxis: {
          title: { text: 'Dissolved oxygen (mg/L)', font: { size: 12, color: cssVar('--text-secondary') } },
          gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') }, zeroline: false,
        },
        hovermode: 'x',
      }, { displayModeBar: false, responsive: true, scrollZoom: false });

      if (nightPoints.length >= 2) {
        const hours = (hfToMinutes(nightPoints[nightPoints.length - 1].t) - hfToMinutes(nightPoints[0].t)) / 60;
        const rate = (nightPoints[nightPoints.length - 1].do_mgl - nightPoints[0].do_mgl) / hours;
        rateEl.textContent = `${rate.toFixed(2)} mg/L/hr`;
        rateEl.classList.remove('is-warning');
        rateEl.classList.add('is-good');
        explainEl.textContent = `Estimated from ${nightPoints.length} points that fall within this one night. True overnight rate from the full 5-minute record: ${trueRate.toFixed(2)} mg/L/hr.`;
      } else if (nightPoints.length === 1) {
        rateEl.textContent = 'Not enough data';
        rateEl.classList.remove('is-good');
        rateEl.classList.add('is-warning');
        explainEl.textContent = `Only one point falls inside this night - a rate needs at least two. This resolution simply never visits the lake between sunset and sunrise on this date.`;
      } else {
        rateEl.textContent = 'No data at all';
        rateEl.classList.remove('is-good', 'is-warning');
        explainEl.textContent = `Zero points fall inside this night at this resolution. There is no way to know what happened between sunset and sunrise - the night is a total blind spot.`;
      }
    }

    Array.from(switchEl.children).forEach((btn) => {
      btn.addEventListener('click', () => {
        Array.from(switchEl.children).forEach((b) => b.classList.toggle('active', b === btn));
        draw(Number(btn.dataset.rung));
      });
    });
    draw(1);
  }
})();
