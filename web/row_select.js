// A choice from a list, as the app's own row list rather than the browser's <select> (docs/design/REVIEW2.md U-18).
// enhance(select) hides the select and puts a row in its place: the chosen option and a chevron. Tapping it opens a
// sheet of rows; choosing one sets the select and fires its change event, so the page's own code doesn't change. The
// row follows the select when the page refills it, sets its value, hides or disables it.
(function (root) {
  'use strict';
  const d = root.document;
  const VALUE = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  const INDEX = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');

  function open(sel, key, paint) {
    const sheet = d.createElement('div'), box = d.createElement('div'), list = d.createElement('div');
    sheet.className = 'row-pick-sheet'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', sel.getAttribute('aria-label') || 'Choose');
    box.className = 'rp-box'; list.className = 'rp-list'; list.setAttribute('role', 'listbox');
    const close = () => { sheet.remove(); d.removeEventListener('keydown', onKey, true); key.focus(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    [...sel.options].forEach((o, i) => {
      const b = d.createElement('button');
      b.type = 'button'; b.textContent = o.text; b.disabled = o.disabled;
      b.setAttribute('role', 'option'); b.setAttribute('aria-selected', String(i === sel.selectedIndex));
      b.addEventListener('click', () => {
        close();
        if (sel.selectedIndex === i) return;
        INDEX.set.call(sel, i); paint();
        sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true }));
      });
      list.append(b);
    });
    const head = d.createElement('p'), cancel = d.createElement('button');
    head.className = 'rp-head'; head.textContent = sel.getAttribute('aria-label') || '';
    cancel.type = 'button'; cancel.className = 'rp-cancel'; cancel.textContent = 'Cancel'; cancel.addEventListener('click', close);
    box.append(head, list, cancel); sheet.append(box);
    sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });
    d.addEventListener('keydown', onKey, true);
    d.body.append(sheet);
    (list.querySelector('[aria-selected="true"]') || list.firstChild || cancel).focus();
  }

  function enhance(sel) {
    if (!sel || sel._rowPick) return sel;
    const key = d.createElement('button'), text = d.createElement('span'), chev = d.createElement('i');
    key.type = 'button'; key.className = 'row-pick'; key.setAttribute('aria-haspopup', 'listbox');
    chev.setAttribute('aria-hidden', 'true'); key.append(text, chev);
    const paint = () => {
      const o = sel.options[sel.selectedIndex];
      text.textContent = o ? o.text : '--';
      key.setAttribute('aria-label', `${sel.getAttribute('aria-label') || 'Choose'}: ${o ? o.text : 'none'}`);
      key.hidden = sel.hidden; key.disabled = sel.disabled || !sel.options.length;
    };
    sel.classList.add('row-pick-native'); sel.after(key);
    sel.addEventListener('change', paint);
    new MutationObserver(paint).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'disabled'] });
    // the page sets the value in code too, which fires no event
    Object.defineProperty(sel, 'value', { configurable: true, get() { return VALUE.get.call(sel); }, set(v) { VALUE.set.call(sel, v); paint(); } });
    Object.defineProperty(sel, 'selectedIndex', { configurable: true, get() { return INDEX.get.call(sel); }, set(v) { INDEX.set.call(sel, v); paint(); } });
    key.addEventListener('click', () => open(sel, key, paint));
    sel._rowPick = { key, paint };
    paint();
    return sel;
  }

  const api = { enhance };
  root.ApexRowSelect = api;
})(window);
