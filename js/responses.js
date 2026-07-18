(() => {
  'use strict';

  const NAME_KEY = 'lakeMetab.studentName';

  // Every free-response note the lab saves, in the order they should be
  // reviewed/turned in. Keys match what modules 1, 4, 5 and 7 already write
  // to localStorage - this page only reads them, never writes to another
  // page's key. Module 1 includes the former Module 2 (Lake Detective)
  // fields, which merged into it when Module 2 was folded into Module 1.
  const SECTIONS = [
    {
      title: 'Module 1 — Meet the Lake',
      fields: [
        { key: 'meetTheLake.oxygenTiming', label: 'What time does oxygen start climbing each morning? What time does it turn around and start falling?' },
        { key: 'meetTheLake.overnight', label: 'What happens to oxygen overnight (grey area on graphs), every single night?' },
        { key: 'meetTheLake.compareDays', label: 'Compare the afternoon of July 11 to July 12. Which day is warmer and sunnier — and which has the bigger swing in oxygen?' },
        { key: 'lakeDetective.notes.wtemp', label: 'Reflection: Temperature' },
        { key: 'lakeDetective.notes.wind', label: 'Reflection: Wind' },
        { key: 'lakeDetective.notes.par', label: 'Reflection: Sunlight' },
        { key: 'lakeDetective.verdict', label: 'Which variable appears to control oxygen? Final verdict' },
      ],
    },
    {
      title: 'Module 4 — The Sensor Revolution',
      fields: [
        { key: 'sensorRevolution.p1notes', label: 'Part 1 notes' },
      ],
    },
    {
      title: 'Module 5 — Every Lake Has a Metabolism',
      fields: [
        { key: 'everyLakeMetabolism.recallNotes', label: 'How do you think these definitions might apply to an entire lake rather than an individual organism?' },
      ],
    },
    {
      title: 'Module 7 — Compare Lakes',
      fields: [
        { key: 'compareLakes.fingerprintNotes', label: 'What do you notice as you switch between lakes?' },
        { key: 'compareLakes.reflection', label: 'Final reflection' },
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

  function render() {
    sectionsEl.innerHTML = '';
    const lines = [];
    const name = nameInput.value.trim();
    lines.push(name ? `Name: ${name}` : 'Name: (not entered)');
    lines.push('');

    SECTIONS.forEach((section) => {
      const heading = document.createElement('h3');
      heading.style.marginTop = '18px';
      heading.textContent = section.title;
      sectionsEl.appendChild(heading);

      lines.push(`## ${section.title}`);
      lines.push('');

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

        lines.push(field.label);
        lines.push(value || '(not answered yet)');
        lines.push('');
      });
    });

    outputEl.value = lines.join('\n').trim() + '\n';
  }

  refreshBtn.addEventListener('click', render);

  copyBtn.addEventListener('click', () => {
    const showCopied = () => {
      copyFeedback.classList.add('show');
      setTimeout(() => copyFeedback.classList.remove('show'), 1800);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(outputEl.value).then(showCopied);
    } else {
      outputEl.select();
      document.execCommand('copy');
      showCopied();
    }
  });

  render();
})();
