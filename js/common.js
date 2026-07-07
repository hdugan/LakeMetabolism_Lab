// Shared helpers used by both module pages: color tokens, the night-shading
// layer built from sunrise/sunset, and small date utilities. Plain global
// (no bundler in this project), namespaced under window.LakeCommon.
window.LakeCommon = (() => {
  'use strict';

  const root = getComputedStyle(document.documentElement);
  const cssVar = (name) => root.getPropertyValue(name).trim();

  // ISO strings carry a fixed -05:00 offset; strip it so Plotly/Date treat
  // them as naive local time (the data is already single-timezone).
  const stripOffset = (iso) => iso.slice(0, 19);

  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Bump this whenever data/mendota_week.json's content or schema changes -
  // it's the only thing standing between an editor and a stale browser (or
  // GitHub Pages CDN) cache silently serving the old file to every module.
  const DATA_VERSION = 2;
  const DATA_URL = `data/mendota_week.json?v=${DATA_VERSION}`;

  // Same idea for Module 5's longer extended-period dataset.
  const EXTENDED_DATA_VERSION = 1;
  const EXTENDED_DATA_URL = `data/mendota_extended.json?v=${EXTENDED_DATA_VERSION}`;

  // Same idea for Module 7's full-season dataset.
  const SEASONAL_DATA_VERSION = 3;
  const SEASONAL_DATA_URL = `data/mendota_seasonal.json?v=${SEASONAL_DATA_VERSION}`;

  function parseHM(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return h + m / 60;
  }

  function fmtBadgeTime(date) {
    let h = date.getHours();
    const m = date.getMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12; if (h === 0) h = 12;
    return `${WEEKDAYS[date.getDay()]} ${date.getMonth() + 1}/${date.getDate()}, ${h}:${String(m).padStart(2, '0')} ${ampm}`;
  }

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

  function cursorLineShape(x) {
    return {
      type: 'line', xref: 'x', yref: 'paper',
      x0: x, x1: x, y0: 0, y1: 1,
      line: { color: cssVar('--text-primary'), width: 1.5, dash: 'dot' },
    };
  }

  // Builds the night-shading rects + sunrise/sunset glyphs shared by every
  // chart on a page, from the dataset's `days` (date/sunrise/sunset) array.
  function buildNightLayer(data) {
    const xAll = data.hourly.map((h) => stripOffset(h.t));
    const days = data.days;
    const nightShapes = [];
    const sunAnnotations = [];
    days.forEach((d, i) => {
      const dayStart = `${d.date}T00:00:00`;
      const sunrise = `${d.date}T${d.sunrise}:00`;
      const sunset = `${d.date}T${d.sunset}:00`;
      const nextDate = days[i + 1] ? days[i + 1].date : null;
      const dayEnd = nextDate ? `${nextDate}T00:00:00` : xAll[xAll.length - 1];

      nightShapes.push(rectShape(dayStart, sunrise));
      nightShapes.push(rectShape(sunset, dayEnd));
      sunAnnotations.push(sunGlyph(sunrise, '☀️'));
      sunAnnotations.push(sunGlyph(sunset, '🌙'));
    });
    return { nightShapes, sunAnnotations, xAll };
  }

  return { cssVar, stripOffset, WEEKDAYS, DATA_URL, EXTENDED_DATA_URL, SEASONAL_DATA_URL, parseHM, fmtBadgeTime, buildNightLayer, cursorLineShape };
})();
