// The confirm sheet (docs/design/REVIEW.md 1.2 Settings, principle 1): a destructive action is red text, and it asks on a
// sheet in the app's own hand, not the system's alert box. Cancel is the default (focused, Escape, a tap outside).
//   if (!(await ApexConfirm.ask('Delete this reply?', 'Delete'))) return;
(function (root) {
  'use strict';
  let open = null;

  function ask(text, action = 'Delete') {
    if (open) open.done(false);
    const doc = root.document;
    return new Promise((resolve) => {
      const back = doc.createElement('div');
      back.className = 'confirm-sheet';
      const box = doc.createElement('div');
      box.className = 'cs-box';
      box.setAttribute('role', 'alertdialog');
      box.setAttribute('aria-modal', 'true');
      const p = doc.createElement('p');
      p.id = 'csText';
      p.textContent = text;
      box.setAttribute('aria-describedby', p.id);
      const yes = doc.createElement('button');
      yes.className = 'cs-yes';
      yes.textContent = action;
      const no = doc.createElement('button');
      no.className = 'cs-no';
      no.textContent = 'Cancel';
      const acts = doc.createElement('div');
      acts.className = 'cs-acts';
      acts.append(no, yes);
      box.append(p, acts);
      back.append(box);
      const before = doc.activeElement;
      const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(false); } };
      function done(v) {
        if (!open || open.back !== back) return;
        open = null;
        doc.removeEventListener('keydown', key, true);
        back.remove();
        try { if (before && before.focus) before.focus(); } catch (_) {}
        resolve(v);
      }
      yes.addEventListener('click', () => done(true));
      no.addEventListener('click', () => done(false));
      back.addEventListener('click', (e) => { if (e.target === back) done(false); });
      doc.addEventListener('keydown', key, true);
      open = { back, done };
      doc.body.append(back);
      no.focus();
    });
  }

  const api = { ask, get open() { return !!open; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ApexConfirm = api;
})(typeof window !== 'undefined' ? window : globalThis);
