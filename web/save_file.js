// Saving a file (GPX, Download my data, a drive video): a download on the web; in the iOS app, where a download link
// does nothing (the web view has no download handling), the shell's share sheet with the file instead (`shareFile`), so it
// can go to Files, AirDrop or Mail; the web's own share sheet where there's no shell. Resolves 'shared' | 'saved' | 'cancelled'.
(function (root) {
  'use strict';
  const inApp = () => typeof location !== 'undefined' && location.protocol === 'apexnav:';
  async function saveFile(data, name, type, opts = {}) {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const share = opts.share != null ? opts.share : inApp();
    // the map page's handler when this is its Log frame (sync.js handlers): the shell listens to the main frame only
    const wk = root.ApexSync && root.ApexSync.handlers ? root.ApexSync.handlers() : (root.webkit && root.webkit.messageHandlers);
    const native = share && wk && wk.apex;
    if (native) {                                                  // no tap needed, unlike the web share sheet after a network wait
      const b64 = await new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = fail; r.readAsDataURL(blob); });
      native.postMessage({ cmd: 'shareFile', name, type, data: b64 });
      return 'shared';
    }
    if (share && typeof File === 'function' && root.navigator && root.navigator.canShare) {
      const file = new File([blob], name, { type });
      if (root.navigator.canShare({ files: [file] })) {
        try { await root.navigator.share({ files: [file] }); return 'shared'; } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
      }
    }
    const a = root.document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    root.document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    return 'saved';
  }
  // An invite or a share link (feedback 07): the real share sheet, everywhere. In the app the shell's (`shareText`,
  // UIActivityViewController: Messages, AirDrop, Copy), since a web view's own share may be missing; the web's share sheet
  // where there is one; otherwise the clipboard. Never a "Copy this link" box. Resolves 'shared' | 'copied' | 'cancelled' | 'failed'.
  async function shareLink({ title = 'Vetta', text = '', url = '' } = {}) {
    const wk = root.ApexSync && root.ApexSync.handlers ? root.ApexSync.handlers() : (root.webkit && root.webkit.messageHandlers);
    const native = inApp() && wk && wk.apex;
    const words = text && text !== url ? text : title;
    if (native) { native.postMessage({ cmd: 'shareText', text: words, url }); return 'shared'; }
    const nav = root.navigator;
    if (nav && nav.share) {
      try { await nav.share(url ? { title, text: words, url } : { title, text: words }); return 'shared'; } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
    }
    try { await nav.clipboard.writeText(url ? (words && words !== title ? words + ' ' + url : url) : words); return 'copied'; } catch (_) { return 'failed'; }
  }
  const api = { saveFile, shareLink };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexSaveFile = api;
})(typeof window !== 'undefined' ? window : globalThis);
