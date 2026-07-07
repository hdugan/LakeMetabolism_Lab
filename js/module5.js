(() => {
  'use strict';

  const { cssVar, EXTENDED_DATA_URL } = window.LakeCommon;

  // ---- timestamp helpers -------------------------------------------------
  // All timestamps in data/mendota_extended.json are naive "YYYY-MM-DDTHH:MM:SS"
  // strings (no timezone). Rather than round-trip them through `new Date()`
  // (whose wall-clock interpretation depends on the browser's own timezone),
  // these convert to/from a plain "minutes since 2023-01-01" integer using
  // Date.UTC purely as a calendar day-counter - safe regardless of the
  // reader's own timezone, since no wall-clock interpretation is involved.
  const EPOCH_Y = 2023;
  function toMinutes(ts) {
    const y = +ts.slice(0, 4), mo = +ts.slice(5, 7), d = +ts.slice(8, 10);
    const hh = +ts.slice(11, 13), mm = +ts.slice(14, 16);
    const dayIndex = Math.round((Date.UTC(y, mo - 1, d) - Date.UTC(EPOCH_Y, 0, 1)) / 86400000);
    return dayIndex * 1440 + hh * 60 + mm;
  }
  function fromMinutes(total) {
    const dayIndex = Math.floor(total / 1440);
    const rem = total - dayIndex * 1440;
    const hh = Math.floor(rem / 60), mm = rem % 60;
    const dt = new Date(Date.UTC(EPOCH_Y, 0, 1) + dayIndex * 86400000);
    const pad = (n) => String(n).padStart(2, '0');
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}T${pad(hh)}:${pad(mm)}:00`;
  }
  function weekdayOf(ts) {
    const y = +ts.slice(0, 4), mo = +ts.slice(5, 7), d = +ts.slice(8, 10);
    return new Date(Date.UTC(y, mo - 1, d)).getUTCDay(); // 0=Sun ... 2=Tue
  }

  function nearestIndex(sortedMinutes, target) {
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
  function sampleRegular(series, minutesArr, intervalMinutes, toleranceMinutes) {
    const tol = toleranceMinutes || Math.max(15, intervalMinutes / 2);
    const startM = minutesArr[0];
    const endM = minutesArr[minutesArr.length - 1];
    const out = [];
    for (let t = startM; t <= endM; t += intervalMinutes) {
      const idx = nearestIndex(minutesArr, t);
      if (Math.abs(minutesArr[idx] - t) <= tol) out.push(series[idx]);
    }
    return out;
  }

  function dailyAverage(series, valKey) {
    const buckets = {};
    series.forEach((p) => {
      const day = p.t.slice(0, 10);
      buckets[day] = buckets[day] || [];
      if (p[valKey] !== null && p[valKey] !== undefined) buckets[day].push(p[valKey]);
    });
    return Object.keys(buckets).sort().map((day) => ({
      t: `${day}T12:00:00`,
      [valKey]: buckets[day].length ? buckets[day].reduce((a, b) => a + b, 0) / buckets[day].length : null,
    }));
  }

  function normalize(values) {
    const present = values.filter((v) => v !== null && v !== undefined);
    const min = Math.min(...present);
    const max = Math.max(...present);
    const span = max - min || 1;
    return values.map((v) => (v === null || v === undefined ? null : ((v - min) / span) * 100));
  }

  const RUNGS = [
    { key: 'weekly', label: 'weekly', minutes: 7 * 24 * 60 },
    { key: 'daily', label: 'daily', minutes: 24 * 60 },
    { key: '6hourly', label: 'every 6 hours', minutes: 6 * 60 },
    { key: 'hourly', label: 'hourly', minutes: 60 },
    { key: '15min', label: 'every 15 minutes', minutes: 15 },
  ];

  function basePlotLayout(extra) {
    return Object.assign({
      margin: { l: 44, r: 12, t: 10, b: 28 },
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      font: { family: 'system-ui, -apple-system, "Segoe UI", sans-serif', color: cssVar('--text-secondary'), size: 11 },
      showlegend: false,
      xaxis: {
        type: 'date',
        gridcolor: cssVar('--gridline'),
        linecolor: cssVar('--baseline'),
        tickfont: { color: cssVar('--text-muted') },
      },
      yaxis: {
        gridcolor: cssVar('--gridline'),
        linecolor: cssVar('--baseline'),
        tickfont: { color: cssVar('--text-muted') },
        zeroline: false,
      },
      hovermode: 'x',
    }, extra || {});
  }

  fetch(EXTENDED_DATA_URL)
    .then((r) => r.json())
    .then(init)
    .catch((err) => {
      document.querySelector('.content').innerHTML =
        '<p style="padding:40px;color:var(--text-secondary)">Could not load lake data (' + err + ').</p>';
    });

  function init(data) {
    const doColor = cssVar('--series-do');
    const fiveMinDo = data.five_min_do;
    const fiveMinMinutes = fiveMinDo.map((p) => toMinutes(p.t));
    const periodStart = fiveMinMinutes[0];
    const periodEnd = fiveMinMinutes[fiveMinMinutes.length - 1];
    const xRange = [fromMinutes(periodStart), fromMinutes(periodEnd)];
    const yFull = fiveMinDo.map((p) => p.do_mgl).filter((v) => v !== null);
    const yPad = 0.6;
    const yRangeFull = [Math.min(...yFull) - yPad, Math.max(...yFull) + yPad];

    initPart1(data, fiveMinDo, fiveMinMinutes);
    initPart2(fiveMinDo, fiveMinMinutes, xRange, yRangeFull);
    initPart3(fiveMinDo, fiveMinMinutes, xRange, yRangeFull, doColor);
    initPart4(data, fiveMinDo, fiveMinMinutes);
    initPart5(data, doColor);
  }

  // ==========================================================================
  // Part 1 - traditional weekly sampling
  // ==========================================================================
  function initPart1(data, fiveMinDo, fiveMinMinutes) {
    const weekly = sampleRegular(fiveMinDo, fiveMinMinutes, 7 * 24 * 60).slice(0, 4);
    const cardsEl = document.getElementById('p1WeekCards');
    weekly.forEach((p, i) => {
      const tile = document.createElement('div');
      tile.className = 'stat-tile';
      tile.innerHTML = `
        <div class="stat-tile-label"><span class="dot" style="background:${cssVar('--series-do')}"></span>Week ${i + 1}</div>
        <div class="stat-tile-value">${p.do_mgl.toFixed(1)}<span class="unit"> mg/L</span></div>`;
      cardsEl.appendChild(tile);
    });

    Plotly.newPlot('p1Plot', [{
      x: weekly.map((p) => p.t), y: weekly.map((p) => p.do_mgl),
      type: 'scatter', mode: 'markers+lines',
      line: { color: cssVar('--series-do'), width: 1.5, dash: 'dot' },
      marker: { size: 10, color: cssVar('--series-do') },
      hovertemplate: '%{y:.2f} mg/L<extra></extra>',
    }], basePlotLayout({
      xaxis: { type: 'date', tickformat: '%b %-d', gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') } },
      yaxis: { range: [0, 16], gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') }, zeroline: false },
    }), { displayModeBar: false, responsive: true, scrollZoom: false });

    const notes = document.getElementById('p1Notes');
    notes.value = localStorage.getItem('sensorRevolution.p1notes') || '';
    notes.addEventListener('input', () => localStorage.setItem('sensorRevolution.p1notes', notes.value));

    document.getElementById('p1RevealBtn').addEventListener('click', () => {
      document.getElementById('p1RevealPanel').hidden = false;
    });
  }

  // ==========================================================================
  // Part 2 - buy more observations
  // ==========================================================================
  function initPart2(fiveMinDo, fiveMinMinutes, xRange, yRangeFull) {
    const plotEl = 'p2Plot';
    const titleEl = document.getElementById('p2Title');
    const statsEl = document.getElementById('p2Stats');
    const switchEl = document.getElementById('p2Switch');

    function draw(rungIdx) {
      const rung = RUNGS[rungIdx];
      const sampled = sampleRegular(fiveMinDo, fiveMinMinutes, rung.minutes);
      const mode = sampled.length > 200 ? 'lines' : 'lines+markers';
      titleEl.textContent = `Oxygen, sampled ${rung.label}`;
      Plotly.react(plotEl, [{
        x: sampled.map((p) => p.t), y: sampled.map((p) => p.do_mgl),
        type: 'scatter', mode,
        line: { color: cssVar('--series-do'), width: 1.8, shape: sampled.length > 200 ? 'spline' : 'linear', smoothing: 0.3 },
        marker: { size: 5, color: cssVar('--series-do') },
        hovertemplate: '%{y:.2f} mg/L<extra></extra>',
      }], basePlotLayout({
        xaxis: { type: 'date', range: xRange, tickformat: '%b %-d', gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') } },
        yaxis: { range: yRangeFull, gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') }, zeroline: false },
      }), { displayModeBar: false, responsive: true, scrollZoom: false });

      const n = sampled.length;
      let msg;
      if (rungIdx === 0) msg = `${n} points across two months. A slow drift, and nothing else - the same "not much happening" story as Part 1.`;
      else if (rungIdx === 1) msg = `${n} points. A faint wobble appears, but it still looks mostly like a smooth trend.`;
      else if (rungIdx === 2) msg = `${n} points. Now you can see a repeating rhythm - something is happening every day, not just over weeks.`;
      else if (rungIdx === 3) msg = `${n} points. The daily rise-and-fall from Module 1 is unmistakable now.`;
      else msg = `${n} points. A smooth, detailed oxygen cycle - every afternoon peak and overnight decline, in full resolution.`;
      statsEl.textContent = msg;
    }

    Array.from(switchEl.children).forEach((btn) => {
      btn.addEventListener('click', () => {
        Array.from(switchEl.children).forEach((b) => b.classList.toggle('active', b === btn));
        draw(Number(btn.dataset.rung));
      });
    });
    draw(0);
  }

  // ==========================================================================
  // Part 3 - the aliasing game
  // ==========================================================================
  function initPart3(fiveMinDo, fiveMinMinutes, xRange, yRangeFull, doColor) {
    const titleEl = document.getElementById('p3Title');
    const statsEl = document.getElementById('p3Stats');
    const switchEl = document.getElementById('p3Switch');
    const revealBtn = document.getElementById('p3RevealBtn');
    const accent = cssVar('--series-rain');
    let revealed = false;
    let currentSampled = [];

    const STRATEGIES = {
      every12h: { title: 'every 12 hours', run: () => sampleRegular(fiveMinDo, fiveMinMinutes, 12 * 60) },
      every24h: { title: 'every 24 hours (starting midnight)', run: () => sampleRegular(fiveMinDo, fiveMinMinutes, 24 * 60) },
      tuesday: {
        title: 'every Tuesday at noon',
        run: () => fiveMinDo.filter((p) => weekdayOf(p.t) === 2 && p.t.slice(11, 16) === '12:00'),
      },
      noon: {
        title: 'every day at noon',
        run: () => fiveMinDo.filter((p) => p.t.slice(11, 16) === '12:00'),
      },
      random: {
        title: 'random times',
        run: () => {
          const n = Math.round((fiveMinMinutes[fiveMinMinutes.length - 1] - fiveMinMinutes[0]) / (24 * 60));
          const picks = [];
          for (let i = 0; i < n; i++) {
            const t = fiveMinMinutes[0] + Math.random() * (fiveMinMinutes[fiveMinMinutes.length - 1] - fiveMinMinutes[0]);
            picks.push(fiveMinDo[nearestIndex(fiveMinMinutes, t)]);
          }
          return picks.sort((a, b) => (a.t < b.t ? -1 : 1));
        },
      },
    };

    function draw(key) {
      revealed = false;
      const strat = STRATEGIES[key];
      currentSampled = strat.run();
      titleEl.textContent = `Your samples: ${strat.title}`;
      redraw();
      const n = currentSampled.length;
      if (key === 'tuesday' || key === 'noon') {
        statsEl.textContent = `${n} points, every one at the same time of day. Every visit lands at the same point in the daily cycle, so the cycle itself is invisible - even though it's really there.`;
      } else if (key === 'every24h') {
        statsEl.textContent = `${n} points, exactly 24 hours apart. Same trap as "every Tuesday": a 24-hour cadence always samples the same phase of the daily cycle, no matter which hour you start on.`;
      } else if (key === 'every12h') {
        statsEl.textContent = `${n} points, 12 hours apart. This alternates between roughly "day" and "night" moments - closer to the truth, but still easy to misread as a two-step staircase instead of a smooth wave.`;
      } else {
        statsEl.textContent = `${n} points at random times. No fixed cadence to get trapped by - random sampling actually stands a better chance of stumbling onto the true shape than a naive fixed schedule does.`;
      }
    }

    function redraw() {
      const traces = [{
        x: currentSampled.map((p) => p.t), y: currentSampled.map((p) => p.do_mgl),
        type: 'scatter', mode: 'markers+lines',
        line: { color: accent, width: 1.5, dash: 'dot' },
        marker: { size: 7, color: accent },
        name: 'Your samples',
        hovertemplate: '%{y:.2f} mg/L<extra>Your samples</extra>',
      }];
      if (revealed) {
        traces.unshift({
          x: fiveMinDo.map((p) => p.t), y: fiveMinDo.map((p) => p.do_mgl),
          type: 'scatter', mode: 'lines',
          line: { color: doColor, width: 1 },
          opacity: 0.5,
          name: 'True 5-minute record',
          hovertemplate: '%{y:.2f} mg/L<extra>True record</extra>',
        });
      }
      Plotly.react('p3Plot', traces, basePlotLayout({
        xaxis: { type: 'date', range: xRange, tickformat: '%b %-d', gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') } },
        yaxis: { range: yRangeFull, gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') }, zeroline: false },
      }), { displayModeBar: false, responsive: true, scrollZoom: false });
    }

    Array.from(switchEl.children).forEach((btn) => {
      btn.addEventListener('click', () => {
        Array.from(switchEl.children).forEach((b) => b.classList.toggle('active', b === btn));
        draw(btn.dataset.strategy);
      });
    });
    revealBtn.addEventListener('click', () => { revealed = !revealed; redraw(); });
    draw('every12h');
  }

  // ==========================================================================
  // Part 4 - hidden metabolism
  // ==========================================================================
  function initPart4(data, fiveMinDo, fiveMinMinutes) {
    const titleEl = document.getElementById('p4Title');
    const rateEl = document.getElementById('p4RateOut');
    const explainEl = document.getElementById('p4Explain');
    const switchEl = document.getElementById('p4Switch');

    const day1 = data.days.find((d) => d.date === '2023-07-09');
    const day2 = data.days.find((d) => d.date === '2023-07-10');
    const nightStartM = toMinutes(`2023-07-09T${day1.sunset}:00`);
    const nightEndM = toMinutes(`2023-07-10T${day2.sunrise}:00`);
    // pad the plotted window a couple hours either side of the night itself,
    // so the sparser rungs have a fighting chance of landing a point nearby
    const viewStartM = nightStartM - 120;
    const viewEndM = nightEndM + 120;

    const trueNight = fiveMinDo.filter((p) => {
      const m = toMinutes(p.t);
      return m >= nightStartM && m <= nightEndM;
    });
    const trueRate = (trueNight[trueNight.length - 1].do_mgl - trueNight[0].do_mgl) /
      ((nightEndM - nightStartM) / 60);

    function draw(rungIdx) {
      const rung = RUNGS[rungIdx];
      titleEl.textContent = `One night, sampled ${rung.label}`;

      // Sample the whole record on this rung's grid, then keep only the
      // points that land inside the plotted window - this mirrors exactly
      // what Part 2 does, so "daily" here means the same thing it did there.
      const sampledAll = sampleRegular(fiveMinDo, fiveMinMinutes, rung.minutes);
      const windowed = sampledAll.filter((p) => {
        const m = toMinutes(p.t);
        return m >= viewStartM && m <= viewEndM;
      });
      const nightPoints = sampledAll.filter((p) => {
        const m = toMinutes(p.t);
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
      ], basePlotLayout({
        xaxis: { type: 'date', range: [fromMinutes(viewStartM), fromMinutes(viewEndM)], tickformat: '%-I %p', gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') } },
        yaxis: { gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') }, zeroline: false },
      }), { displayModeBar: false, responsive: true, scrollZoom: false });

      if (nightPoints.length >= 2) {
        const hours = (toMinutes(nightPoints[nightPoints.length - 1].t) - toMinutes(nightPoints[0].t)) / 60;
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

  // ==========================================================================
  // Part 5 - weather events
  // ==========================================================================
  function doSat(tempC) {
    // Standard freshwater DO-saturation regression at 1 atm (mg/L) - same
    // formula used in Modules 3 and 4.
    return 14.652 - 0.41022 * tempC + 0.007991 * tempC * tempC - 0.000077774 * tempC * tempC * tempC;
  }

  function initPart5(data, doColor) {
    const switchEl = document.getElementById('p5Switch');
    const fineTitle = document.getElementById('p5FineTitle');
    const fineLegend = document.getElementById('p5FineLegend');
    const captionLabel = document.getElementById('p5CaptionLabel');
    const captionText = document.getElementById('p5CaptionText');

    const EVENTS = {
      storm: {
        label: 'Storm', resolutionLabel: '5-minute data', secondaryKey: 'wind_ms', secondaryLabel: 'Wind speed (m/s)', secondaryColor: cssVar('--series-wind'),
        caption: 'On July 12, 2023, a summer thunderstorm dropped over 47 mm of rain in a few hours and pushed winds to some of the highest of the whole two-month record. Both effects show up immediately in the 5-minute data: light was cut to a fraction of a normal sunny day, and the usual afternoon oxygen rise never really happened.',
      },
      windmix: {
        label: 'Wind mixing', resolutionLabel: '5-minute data', secondaryKey: 'wind_ms', secondaryLabel: 'Wind speed (m/s)', secondaryColor: cssVar('--series-wind'),
        caption: 'Just after midnight on July 28, wind suddenly spiked to over 10 m/s - the windiest moment of the whole record. Within a few hours, oxygen at the sensor dropped sharply, and water temperature dropped right along with it - the signature of wind churning the water column and mixing cooler, lower-oxygen water up from below. By the next calm afternoon, the lake had settled back into its normal rhythm.',
      },
      cloud: {
        label: 'Cloud cover', resolutionLabel: '5-minute data', secondaryKey: 'par', secondaryLabel: 'Light (PAR)', secondaryColor: cssVar('--series-par'),
        caption: 'June 11, 2023 was heavily overcast - peak light that day reached only about a quarter of a typical sunny day. With that much less light, photosynthesis nearly stalled: oxygen barely moved, a striking contrast to the much bigger rise-and-fall on the sunnier days right before and after it.',
      },
      bloom: {
        label: 'Algal bloom', resolutionLabel: 'Hourly data', secondaryKey: 'chlor_rfu', secondaryLabel: 'Chlorophyll', secondaryColor: cssVar('--series-rain'),
        caption: 'Watch chlorophyll climb steadily from mid-June into early July as an algal bloom builds - and oxygen\'s daily swings grow right along with it, since more algae means more daytime photosynthesis (and more nighttime respiration). A bloom like this develops over weeks, not minutes, so hourly data is plenty to see it. The bloom breaks up right around the July 12 storm, when wind and rain mixed and diluted it.',
      },
    };

    function draw(key) {
      const ev = EVENTS[key];
      const win = data.events[key].window;
      const t = win.map((p) => p.t);
      const doRaw = win.map((p) => p.do_mgl);
      const secRaw = win.map((p) => p[ev.secondaryKey]);
      const doNorm = normalize(doRaw);
      const secNorm = normalize(secRaw);

      fineTitle.textContent = `${ev.resolutionLabel}: ${ev.label}`;
      fineLegend.innerHTML = `
        <span><span class="swatch" style="background:${doColor}"></span>Oxygen (DO)</span>
        <span><span class="swatch" style="background:${ev.secondaryColor}"></span>${ev.secondaryLabel}</span>`;
      captionLabel.textContent = `What happened - ${ev.label}`;
      captionText.textContent = ev.caption;

      Plotly.react('p5FinePlot', [
        {
          x: t, y: doNorm, customdata: doRaw,
          type: 'scatter', mode: 'lines',
          line: { color: doColor, width: 2, shape: 'spline', smoothing: 0.3 },
          hovertemplate: '%{customdata:.2f} mg/L<extra>Oxygen</extra>',
        },
        {
          x: t, y: secNorm, customdata: secRaw,
          type: 'scatter', mode: 'lines',
          line: { color: ev.secondaryColor, width: 2, shape: 'spline', smoothing: 0.3 },
          hovertemplate: `%{customdata:.2f}<extra>${ev.secondaryLabel}</extra>`,
        },
      ], basePlotLayout({
        xaxis: { type: 'date', tickformat: '%b %-d %-I%p', gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') } },
        yaxis: { title: { text: '% of window range', font: { size: 11, color: cssVar('--text-muted') } }, range: [-3, 103], gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') }, zeroline: false },
      }), { displayModeBar: false, responsive: true, scrollZoom: false });

      const daily = dailyAverage(win.map((p) => ({ t: p.t, do_mgl: p.do_mgl })), 'do_mgl');
      const dailyTemp = dailyAverage(win.map((p) => ({ t: p.t, wtemp_c: p.wtemp_c })), 'wtemp_c');
      Plotly.react('p5DailyPlot', [
        {
          x: dailyTemp.map((p) => p.t), y: dailyTemp.map((p) => (p.wtemp_c === null ? null : doSat(p.wtemp_c))),
          type: 'scatter', mode: 'lines',
          line: { color: cssVar('--baseline'), width: 1.5, dash: 'dash' },
          hovertemplate: '%{y:.2f} mg/L<extra>Equilibrium</extra>',
        },
        {
          x: daily.map((p) => p.t), y: daily.map((p) => p.do_mgl),
          type: 'scatter', mode: 'lines+markers',
          line: { color: doColor, width: 2 },
          marker: { size: 10, color: doColor },
          hovertemplate: '%{y:.2f} mg/L<extra>Oxygen</extra>',
        },
      ], basePlotLayout({
        xaxis: { type: 'date', tickformat: '%b %-d', gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') } },
        yaxis: { gridcolor: cssVar('--gridline'), linecolor: cssVar('--baseline'), tickfont: { color: cssVar('--text-muted') }, zeroline: false },
      }), { displayModeBar: false, responsive: true, scrollZoom: false });
    }

    Array.from(switchEl.children).forEach((btn) => {
      btn.addEventListener('click', () => {
        Array.from(switchEl.children).forEach((b) => b.classList.toggle('active', b === btn));
        draw(btn.dataset.event);
      });
    });
    draw('storm');
  }
})();
