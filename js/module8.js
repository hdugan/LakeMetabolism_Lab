(() => {
  'use strict';

  // Free-response answers for the synthesis questions and lab feedback (localStorage).
  // Keys are listed on the Your Responses page (js/responses.js).
  [
    { id: 'metabolismDefNotes', key: 'synthesis.metabolismDef' },
    { id: 'propertyOwnerNotes', key: 'synthesis.propertyOwner' },
    { id: 'mendotaDriverNotes', key: 'synthesis.mendotaDriver' },
    { id: 'buoyLimitsNotes', key: 'synthesis.buoyLimits' },
    { id: 'carbonNotes', key: 'synthesis.carbon' },
    { id: 'likedNotes', key: 'feedback.liked' },
    { id: 'dislikedNotes', key: 'feedback.disliked' },
  ].forEach((nt) => {
    const el = document.getElementById(nt.id);
    el.value = localStorage.getItem(nt.key) || '';
    el.addEventListener('input', () => localStorage.setItem(nt.key, el.value));
  });
})();
