// Block and report on every social surface (IDEAS S-16): one report sheet used by friends, crew members, public crews
// and friends' cars; the list of people you blocked; and, for the owner only, the queue of reports to act on.
// Everything is set as text. The person reported is never told who reported them.
(function (root) {
  const REASONS = [['spam', 'Spam or scam'], ['abuse', 'Harassment or hate'], ['impersonation', 'Pretending to be someone'],
                   ['unsafe', 'Dangerous driving or illegal'], ['other', 'Something else']];
  const KIND_WORD = { user: 'person', crew: 'crew', car: 'car', highlight: 'spot', event: 'drive', photo: 'photo' };
  const CSS = `
    .report-sheet { position: fixed; left: 0; right: 0; bottom: 0; z-index: 45; background: var(--panel); color: var(--panel-ink);
      border-top: 1px solid var(--rule); box-shadow: 0 -12px 32px rgba(0, 0, 0, 0.3); display: grid; gap: 10px;
      padding: 16px calc(16px + var(--safe-right, 0px)) calc(20px + var(--safe-bottom, 0px)) calc(16px + var(--safe-left, 0px)); max-width: 560px; margin: 0 auto; }
    .report-sheet h3 { margin: 0; }
    .report-sheet label { display: flex; gap: 8px; align-items: center; }
    .report-scrim { position: fixed; inset: 0; z-index: 44; background: rgba(0, 0, 0, 0.45); }
    .mod-item { border: 1px solid var(--rule); padding: 10px 12px; display: grid; gap: 4px; overflow-wrap: anywhere; }
  `;

  /** The page lends its helpers: el, btn, toast, apiCall, jsonOf. */
  function mount(page) {
    const { el, btn, toast, apiCall, jsonOf } = page;
    if (!document.getElementById('safety-css')) document.head.append(el('style', { id: 'safety-css', textContent: CSS }));

    /** Opens the report sheet. `who` is the person behind it (a handle) for "Also block"; `done` runs after a send. */
    function report({ kind, target, label, who, done }) {
      const prev = document.activeElement;
      const scrim = el('div', { className: 'report-scrim' });
      const sheet = el('div', { className: 'report-sheet' });
      sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', `Report ${label}`);
      const reason = el('select', { className: 'field' });
      reason.setAttribute('aria-label', 'Reason');
      for (const [v, t] of REASONS) reason.append(el('option', { value: v, textContent: t }));
      const note = el('textarea', { className: 'field', rows: 2, maxLength: 280, placeholder: 'What happened' });
      note.setAttribute('aria-label', 'What happened');
      // blocking ends a friendship for good: never by default; a slide switch, read through .checked
      const alsoBlock = el('button', { type: 'button', className: 'sw' }, el('i'), el('span', { textContent: `Also block @${who}` }));
      alsoBlock.setAttribute('role', 'switch'); alsoBlock.setAttribute('aria-checked', 'false');
      Object.defineProperty(alsoBlock, 'checked', { get: () => alsoBlock.classList.contains('on'), set: (v) => { alsoBlock.classList.toggle('on', !!v); alsoBlock.setAttribute('aria-checked', String(!!v)); } });
      alsoBlock.addEventListener('click', () => { alsoBlock.checked = !alsoBlock.checked; });
      const close = () => { scrim.remove(); sheet.remove(); window.removeEventListener('keydown', onKey, true); if (prev && prev.isConnected && prev.focus) prev.focus(); };
      // Captured first, so Escape closes only this sheet (not the Crew sheet under it); Tab stays inside it.
      const onKey = (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); return; }
        if (e.key !== 'Tab') return;
        const f = [...sheet.querySelectorAll('select, textarea, input, button')].filter((x) => !x.disabled);
        if (!f.length) return;
        const i = f.indexOf(document.activeElement), next = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i === f.length - 1 ? 0 : i + 1);
        e.preventDefault(); f[next].focus();
      };
      let sending = false;
      const send = async (e) => {
        if (sending) return;
        sending = true;
        const b = e && e.currentTarget; if (b) b.disabled = true;
        let r = null;
        try { r = await apiCall('POST', '/api/reports', { kind, target, reason: reason.value, note: note.value, block: !!(who && alsoBlock.checked) }); } catch (_) {}
        sending = false; if (b) b.disabled = false;
        if (!r) { toast('No signal. Your report wasn\'t sent.'); return; }
        if (r.status === 429) { toast('That\'s a lot of reports today. Try again tomorrow.'); return; }
        if (!r.ok) { const j = await jsonOf(r); toast(j && j.error === 'bad_note' ? 'Take out the special characters in the note.' : 'Couldn\'t send the report. Try again.'); return; }
        close();
        toast(who && alsoBlock.checked ? `Thanks. We'll look at it, and you won't see @${who} again.` : 'Thanks. We\'ll look at it.');
        if (done) done();
      };
      scrim.onclick = close;
      sheet.append(el('h3', { textContent: `Report this ${KIND_WORD[kind] || 'item'}` }), el('p', { className: 'note', textContent: label }), reason, note,
        ...(who ? [alsoBlock] : []),
        el('p', { className: 'note', textContent: 'They won\'t know you reported them.' }),
        el('div', { className: 'row' }, btn('Send report', send, 'ink-btn solid'), btn('Cancel', close, 'linkbtn')));
      document.body.append(scrim, sheet);
      if (root.ApexRowSelect) root.ApexRowSelect.enhance(reason);   // the app's row list; the select holds the value
      window.addEventListener('keydown', onKey, true);
      (reason._rowPick ? reason._rowPick.key : reason).focus();
    }

    /** Block by handle with a plain question first; `done` runs after. */
    let blocking = false;
    async function block(handle, done) {
      if (blocking) return;
      if (!(await ApexConfirm.ask(`Block @${handle}? You won't see each other, friendship and sharing end, and a convoy you share drops one of you.`, 'Block'))) return;
      let r = null;
      blocking = true;
      try { r = await apiCall('POST', '/api/blocks', { handle }); } catch (_) {}
      blocking = false;
      if (!r || !r.ok) { toast('Couldn\'t block. Try again.'); return; }
      toast(`@${handle} is blocked.`);
      if (done) done();
    }

    /** "Blocked" in Account: who you blocked, with Unblock. Hidden when there's nobody. */
    function blockedSection() {
      const host = el('div', { className: 'stack-8' });
      (async () => {
        let list = null;
        try { const r = await apiCall('GET', '/api/blocks'); if (r.ok) list = await jsonOf(r); } catch (_) {}
        if (!Array.isArray(list) || !list.length) { host.replaceChildren(); return; }
        const kids = [el('h3', { textContent: 'Blocked' })];
        for (const p of list) {
          if (!p.handle) continue;
          kids.push(el('div', { className: 'row', style: 'justify-content:space-between;align-items:center' }, el('b', { textContent: '@' + p.handle }),
            btn('Unblock', async () => {
              let r = null;
              try { r = await apiCall('DELETE', `/api/blocks/${encodeURIComponent(p.handle)}`); } catch (_) {}
              if (r && r.ok) toast(`@${p.handle} is unblocked. Friendship and sharing don't come back on their own.`); else toast('Couldn\'t unblock. Try again.');
              host.replaceWith(blockedSection());
            }, 'linkbtn')));
        }
        host.replaceChildren(...kids);
      })();
      return host;
    }

    /** The owner's queue: what was reported, how many people, what they said, and Dismiss / Remove. */
    function moderationSection() {
      const host = el('div', { className: 'stack-8' });
      const render = async () => {
        let items = null;
        try { const r = await apiCall('GET', '/api/moderation'); if (r.ok) items = await jsonOf(r); } catch (_) {}
        const kids = [el('h3', { textContent: 'Reports to review' })];
        if (!Array.isArray(items)) kids.push(el('p', { className: 'note', textContent: 'Couldn\'t load reports. Check signal.' }));
        else if (!items.length) kids.push(el('p', { className: 'note', textContent: 'Nothing reported.' }));
        else for (const it of items) {
          const resolve = (action, ask) => async () => {
            if (ask && !(await ApexConfirm.ask(ask, action === 'remove' ? 'Remove' : 'Dismiss'))) return;
            let r = null;
            try { r = await apiCall('POST', '/api/moderation/resolve', { kind: it.kind, target: it.target, action }); } catch (_) {}
            if (!r || !r.ok) toast('Couldn\'t do that. Try again.');
            render();
          };
          const word = KIND_WORD[it.kind] || it.kind;
          const removeAsk = { user: 'Ban this person? Their membership ends, they\'re signed out, their invites stop working and they can\'t rejoin.', crew: 'Take this crew off the public list?',
                              car: 'Stop showing this car to anyone?', highlight: 'Hide this spot?' }[it.kind];
          kids.push(el('div', { className: 'mod-item' },
            el('b', { textContent: `${word[0].toUpperCase() + word.slice(1)}: ${it.label == null ? '(gone)' : it.kind === 'user' ? '@' + it.label : it.label}` }),
            el('span', { className: 'note', textContent: `${it.reporters} ${it.reporters === 1 ? 'person' : 'people'} · last ${String(it.latest).slice(0, 16)} UTC${it.hidden ? ' · hidden until you decide' : ''}` }),
            el('span', { className: 'note', textContent: `From ${(it.who || []).join(', ')}` }),
            ...it.notes.filter(Boolean).map((n) => el('span', { textContent: n })),
            el('div', { className: 'row' }, btn('Dismiss', resolve('dismiss', 'Dismiss these reports? The same people can\'t raise it again.'), 'linkbtn'), ...(it.gone ? [] : [btn('Remove', resolve('remove', removeAsk), 'danger-btn')]))));
        }
        host.replaceChildren(...kids);
      };
      render();
      return host;
    }

    return { report, block, blockedSection, moderationSection };
  }

  root.ApexSafetyUI = { mount, REASONS };
})(window);
