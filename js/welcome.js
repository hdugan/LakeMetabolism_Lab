(() => {
  'use strict';

  const TERMS = [
    {
      term: 'Photosynthesis',
      correct: 'The process by which algae and plants use light energy to convert CO₂ and water into organic matter, releasing oxygen as a byproduct.',
      incorrect: 'The process by which organisms break down organic matter to release energy, consuming oxygen in the process.',
    },
    {
      term: 'Respiration',
      correct: 'The process by which organisms break down organic matter to release energy, consuming oxygen in the process.',
      incorrect: 'The process by which algae and plants use light energy to convert CO₂ and water into organic matter, releasing oxygen as a byproduct.',
    },
    {
      term: 'Gas saturation',
      correct: 'The amount of a dissolved gas present in water relative to the maximum it could hold at equilibrium with the atmosphere, at a given temperature and pressure.',
      incorrect: 'The maximum amount of a gas that can dissolve in water, which depends on temperature, pressure, and the properties of the gas itself.',
    },
    {
      term: 'Gas solubility',
      correct: 'The maximum amount of a gas that can dissolve in water, which depends on temperature, pressure, and the properties of the gas itself.',
      incorrect: 'The amount of a dissolved gas present in water relative to the maximum it could hold at equilibrium with the atmosphere, at a given temperature and pressure.',
    },
    {
      term: 'Mixing depth',
      correct: 'The depth to which wind and convection actively stir the water column, keeping temperature and other properties roughly uniform from the surface down to that point.',
      incorrect: 'The depth to which enough sunlight penetrates to support net photosynthesis.',
    },
    {
      term: 'Photic (euphotic) zone',
      correct: 'The depth range from the surface down to where sunlight is still sufficient to support net photosynthesis, roughly the top 1% of surface light.',
      incorrect: 'The depth to which wind and convection actively stir the water column, keeping temperature and other properties roughly uniform.',
    },
    {
      term: 'Diffusion',
      correct: 'The net movement of molecules, such as dissolved gases, from an area of higher concentration to an area of lower concentration, with no energy input required.',
      incorrect: 'The physical mixing of water driven by wind and temperature differences, distributing heat and dissolved substances throughout a water column.',
    },
    {
      term: 'Autotroph',
      correct: 'An organism that produces its own organic matter from inorganic carbon, typically using light energy through photosynthesis.',
      incorrect: 'An organism that obtains organic matter by consuming other organisms or organic material, rather than producing it itself.',
    },
    {
      term: 'Heterotroph',
      correct: 'An organism that obtains organic matter by consuming other organisms or organic material, rather than producing it itself.',
      incorrect: 'An organism that produces its own organic matter from inorganic carbon, typically using light energy through photosynthesis.',
    },
    {
      term: 'Primary production',
      correct: 'The rate at which autotrophs, like algae and plants, convert inorganic carbon into new organic matter — the base of the food web.',
      incorrect: 'The total amount of organic matter consumed and broken down by all organisms in an ecosystem over a given time period.',
    },
    {
      term: 'PAR (Photosynthetically Active Radiation)',
      correct: 'The portion of sunlight, roughly 400–700 nm, that photosynthetic organisms can actually use to drive photosynthesis.',
      incorrect: 'The total solar energy reaching the water’s surface, including heat and all wavelengths of light, not just those usable for photosynthesis.',
    },
  ];

  const startBtn = document.getElementById('flashcardStartBtn');
  const panel = document.getElementById('flashcardPanel');
  const deck = document.getElementById('flashcardDeck');
  const termEl = document.getElementById('flashcardTerm');
  const progressEl = document.getElementById('flashcardProgress');
  const optionBtns = Array.from(document.getElementById('flashcardOptions').querySelectorAll('.quiz-option'));
  const feedbackEl = document.getElementById('flashcardFeedback');
  const nextBtn = document.getElementById('flashcardNextBtn');
  const doneEl = document.getElementById('flashcardDone');
  const restartBtn = document.getElementById('flashcardRestartBtn');
  const readyToStartSection = document.getElementById('readyToStartSection');

  let order = [];
  let idx = 0;
  let answered = false;

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function startDeck() {
    order = shuffle(TERMS.map((_, i) => i));
    idx = 0;
    doneEl.hidden = true;
    deck.hidden = false;
    panel.hidden = false;
    renderCard();
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderCard() {
    answered = false;
    const t = TERMS[order[idx]];
    termEl.textContent = t.term;
    progressEl.textContent = `Term ${idx + 1} of ${TERMS.length}`;

    const correctFirst = Math.random() < 0.5;
    const defs = correctFirst ? [t.correct, t.incorrect] : [t.incorrect, t.correct];
    const correctSlot = correctFirst ? 0 : 1;

    optionBtns.forEach((btn, i) => {
      btn.textContent = defs[i];
      btn.dataset.correct = String(i === correctSlot);
      btn.classList.remove('is-correct', 'is-incorrect');
      btn.disabled = false;
    });

    feedbackEl.hidden = true;
    nextBtn.hidden = true;
  }

  optionBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (answered) return;
      answered = true;
      const correct = btn.dataset.correct === 'true';
      optionBtns.forEach((b) => {
        b.disabled = true;
        if (b.dataset.correct === 'true') b.classList.add('is-correct');
      });
      if (!correct) btn.classList.add('is-incorrect');
      feedbackEl.hidden = false;
      feedbackEl.classList.toggle('is-correct', correct);
      feedbackEl.classList.toggle('is-incorrect', !correct);
      feedbackEl.textContent = correct
        ? '✅ Correct!'
        : '🤔 Not quite — the highlighted definition is the right one.';
      nextBtn.hidden = false;
    });
  });

  nextBtn.addEventListener('click', () => {
    idx += 1;
    if (idx >= order.length) {
      deck.hidden = true;
      doneEl.hidden = false;
      readyToStartSection.hidden = false;
    } else {
      renderCard();
    }
  });

  startBtn.addEventListener('click', startDeck);
  restartBtn.addEventListener('click', startDeck);
})();
