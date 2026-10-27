(() => {
  'use strict';

  const NAME_KEY = 'lakeMetab.studentName';

  // Every free-response note the lab saves, in the order they should be
  // reviewed/turned in. Keys match what modules 1-8 already write to
  // localStorage - this page only reads them, never writes to another
  // page's key. Module 1 includes the former standalone Module 2 (Lake
  // Detective) fields, which merged into it when that module was folded
  // into Module 1; the current Module 2 ("The Oxygen Budget") is a
  // separate, later rebuild with its own fields.
  const SECTIONS = [
    {
      title: 'Module 1 — Meet the Lake',
      fields: [
        { key: 'meetTheLake.oxygenTiming', label: 'What time does oxygen start climbing each morning? What time does it turn around and start falling?' },
        { key: 'meetTheLake.overnight', label: 'What happens to oxygen overnight (grey area on graphs), every single night?' },
        { key: 'meetTheLake.compareDays', label: 'Compare the afternoon of July 11 to July 12. Which day is warmer and sunnier — and which has the bigger swing in oxygen?' },
        { key: 'lakeDetective.verdict', label: 'Which variable do you think most directly controls the daily rise and fall of oxygen — and what\'s your justification?' },
      ],
    },
    {
      title: 'Module 2 — The Oxygen Budget',
      fields: [
        { key: 'oxygenBudget.tempSolubilityNotes', label: "What's the relationship between water temperature and how much oxygen the lake can hold?" },
        { key: 'oxygenBudget.satCalcNotes', label: 'At a water temperature of 15°C, what dissolved oxygen concentration (mg/L) corresponds to 110% saturation? Show your calculations and explain how you arrived at your answer.' },
      ],
    },
    {
      title: 'Module 3 — Build the Oxygen Curve',
      fields: [
        { key: 'buildOxygenCurve.bestFitNotes', label: 'Even the "best fit" of these three rates doesn\'t match the observed data perfectly over an entire week. Why do you think that might be?' },
      ],
    },
    {
      title: 'Module 4 — The Sensor Revolution',
      fields: [
        { key: 'sensorRevolution.p1notes', label: 'Part 1 notes' },
        { key: 'sensorRevolution.weatherEventsNotes', label: 'Of the three weather events you explored, which one changed oxygen the most — and why do you think it had a bigger effect than the others?' },
      ],
    },
    {
      title: 'Module 5 — Every Lake Has a Metabolism',
      fields: [
        { key: 'everyLakeMetabolism.recallNotes', label: 'How do you think these definitions might apply to an entire lake rather than an individual organism?' },
      ],
    },
    {
      title: 'Module 6 — Seasonal Metabolism',
      fields: [
        { key: 'seasonalMetabolism.sketchWhyNotes', label: 'Why did you draw GPP and ER the way you did? Describe how each one changes across spring, summer, and fall, and what you think drives it.' },
        { key: 'seasonalMetabolism.mayLowNotes', label: 'Knowing how lakes work, why are GPP and algal biomass so low in mid-May?' },
      ],
    },
    {
      title: 'Module 7 — Compare Lakes',
      fields: [
        { key: 'compareLakes.sketchWhyNotes', label: "Why did you draw each lake the way you did? Compare the three daily ranges, and say what you think causes the differences." },
        { key: 'compareLakes.fingerprintNotes', label: "What do you notice? Which lake's nutrients, light, and temperature would you expect to make the most oxygen, and does that match what you saw in each lake's oxygen?" },
        { key: 'compareLakes.manipulateNotes', label: "You've seen what controls GPP in different lakes. How would you change GPP in a lake?" },
        { key: 'compareLakes.experimentNotes', label: "What changed in Peter Lake compared with Paul Lake while nutrients were being added, and what happened after they stopped? Both GPP and ER changed - why do you think respiration responded too?" },
        { key: 'compareLakes.referenceNotes', label: 'In the Paul and Peter experiment, why did the scientists leave Paul Lake alone? What could you not conclude without it?' },
      ],
    },
    {
      title: 'Module 8 — Synthesis',
      fields: [
        { key: 'synthesis.metabolismDef', label: 'In your own words, what is lake metabolism, and what do GPP, ER and NEP each tell you about a lake?' },
        { key: 'synthesis.propertyOwner', label: 'A lake-front property owner tells you their lake has a lot of algae. What would you measure, and what would you expect to see in the oxygen data?' },
        { key: 'synthesis.mendotaDriver', label: 'Which of the three drivers you studied (nutrients, light, temperature) matters most for GPP in Lake Mendota in summer?' },
        { key: 'synthesis.buoyLimits', label: "What is one thing the buoy data cannot tell us about a lake's metabolism?" },
        { key: 'synthesis.carbon', label: 'A lake that is net heterotrophic is releasing carbon dioxide to the air. What does that suggest about the role of lakes in the global carbon cycle?' },
      ],
    },
    {
      title: 'Lab feedback',
      fields: [
        { key: 'feedback.liked', label: 'What did you like about this lab? Feedback here is helpful for future updates.' },
        { key: 'feedback.disliked', label: 'What did you not like about this lab? Feedback here is helpful for future updates.' },
      ],
    },
  ];

  const nameInput = document.getElementById('studentName');
  const sectionsEl = document.getElementById('responseSections');
  const outputEl = document.getElementById('responseOutput');
  const copyBtn = document.getElementById('copyBtn');
  const refreshBtn = document.getElementById('refreshBtn');
  const copyFeedback = document.getElementById('copyFeedback');

  nameInput.value = localStorage.getItem(NAME_KEY) || '';
  nameInput.addEventListener('input', () => {
    localStorage.setItem(NAME_KEY, nameInput.value);
    render();
  });

  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escMultiline = (s) => esc(s).replace(/\n/g, '<br>');

  // Rebuilt on every render: what the preview shows, the rich-text (HTML) copy that pastes into Word
  // with bold intact, and a plain-text fallback. The copied HTML carries no colors, so it comes out
  // black-on-white in Word even if the page is in dark mode.
  let currentHtml = '', currentText = '';

  function render() {
    sectionsEl.innerHTML = '';
    const text = [];
    const html = [];
    const name = nameInput.value.trim();
    text.push(name ? `Name: ${name}` : 'Name: (not entered)', '');
    html.push(`<p><strong>Name:</strong> ${name ? esc(name) : '(not entered)'}</p>`);

    SECTIONS.forEach((section) => {
      const heading = document.createElement('h3');
      heading.style.marginTop = '18px';
      heading.textContent = section.title;
      sectionsEl.appendChild(heading);

      text.push(section.title, '');
      html.push(`<h3>${esc(section.title)}</h3>`);

      section.fields.forEach((field) => {
        const value = (localStorage.getItem(field.key) || '').trim();

        const label = document.createElement('div');
        label.style.cssText = 'font-size:13px;font-weight:600;color:var(--text-secondary);margin-top:10px;';
        label.textContent = field.label;
        sectionsEl.appendChild(label);

        const block = document.createElement('div');
        block.className = 'response-block' + (value ? '' : ' is-empty');
        block.textContent = value || 'Not answered yet.';
        sectionsEl.appendChild(block);

        text.push(`Q) ${field.label}`, `A) ${value || '(not answered yet)'}`, '');
        html.push(`<p><strong>Q) ${esc(field.label)}</strong></p>`);
        html.push(`<p>A) ${value ? escMultiline(value) : '<em>(not answered yet)</em>'}</p>`);
      });
    });

    currentHtml = html.join('\n');
    currentText = text.join('\n').trim() + '\n';
    outputEl.innerHTML = currentHtml;
  }

  refreshBtn.addEventListener('click', render);

  // Copy as rich text where the browser allows it (ClipboardItem), otherwise select an off-screen
  // copy of the formatted HTML and use the classic copy command, which also keeps the formatting.
  function copyRichFallback() {
    const holder = document.createElement('div');
    holder.innerHTML = currentHtml;
    holder.style.cssText = 'position:fixed; left:-9999px; top:0; background:#fff; color:#000;';
    document.body.appendChild(holder);
    const range = document.createRange();
    range.selectNodeContents(holder);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const ok = document.execCommand('copy');
    sel.removeAllRanges();
    document.body.removeChild(holder);
    return ok;
  }

  copyBtn.addEventListener('click', () => {
    const showCopied = () => {
      copyFeedback.classList.add('show');
      setTimeout(() => copyFeedback.classList.remove('show'), 1800);
    };
    const wrapped = `<div style="font-family:Calibri, Arial, sans-serif; font-size:11pt;">${currentHtml}</div>`;
    if (navigator.clipboard && window.ClipboardItem) {
      navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([wrapped], { type: 'text/html' }),
        'text/plain': new Blob([currentText], { type: 'text/plain' }),
      })]).then(showCopied).catch(() => { if (copyRichFallback()) showCopied(); });
    } else if (copyRichFallback()) {
      showCopied();
    }
  });

  render();
})();
