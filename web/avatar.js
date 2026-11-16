/* Vetta: a face in a ring (Social home, 2026-11-16). One component wherever a face says something about now: a red ring
 * for someone driving right now, a white one for someone with a new drive today, none otherwise. The face itself is
 * ApexPhotos.avatar (a photo, or the initial until there is one); this only frames it, so a face looks the same everywhere. */
(function (root) {
  'use strict';
  const KINDS = new Set(['live', 'new', 'crew']);
  const CSS = `
    .av-ring { --ring: transparent; position: relative; display: inline-grid; place-items: center; padding: 3px; border-radius: 50%;
      box-shadow: inset 0 0 0 2.5px var(--ring); flex: none; }
    .av-ring > .avatar { box-shadow: 0 0 0 2px var(--panel, #0A0A0B); }
    .av-ring.live { --ring: var(--accent, #FF3341); }
    .av-ring.new { --ring: var(--panel-ink, #F5F5F7); }
    .av-ring.crew, .av-ring.crew > .avatar, .av-ring.crew > .avatar img { border-radius: 14px; }
    .av-ring.crew { --ring: var(--hair, #2B2D33); }
    .av-ring .av-live { position: absolute; left: 50%; bottom: -4px; transform: translateX(-50%); padding: 1px 6px; border-radius: 6px;
      background: var(--accent, #FF3341); color: #fff; font-size: 10px; font-weight: 800; letter-spacing: 0.06em; line-height: 14px; }
    @media (prefers-reduced-motion: no-preference) { .av-ring.live { animation: av-pulse 2.4s ease-in-out infinite; } }
    @keyframes av-pulse { 50% { box-shadow: inset 0 0 0 2.5px var(--ring), 0 0 0 3px color-mix(in srgb, var(--ring) 30%, transparent); } }
  `;
  let styled = false;
  /** `face` (a node, usually ApexPhotos.avatar) in a ring of `kind`: 'live', 'new', 'crew' or none. */
  function ring(face, kind) {
    const d = root.document;
    if (!styled && d.head) { const s = d.createElement('style'); s.textContent = CSS; d.head.append(s); styled = true; }
    const box = d.createElement('span');
    box.className = `av-ring${KINDS.has(kind) ? ` ${kind}` : ''}`;
    box.setAttribute('aria-hidden', 'true');
    box.append(face);
    if (kind === 'live') { const t = d.createElement('span'); t.className = 'av-live'; t.textContent = 'LIVE'; box.append(t); }
    return box;
  }
  const api = { ring, KINDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexAvatar = api;
})(typeof window !== 'undefined' ? window : globalThis);
