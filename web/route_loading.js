(function (root) {
  'use strict';

  async function read(url, options, format, timeoutMs) {
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error('Route service took too long. Check signal and try again.'));
        controller.abort();
      }, timeoutMs);
    });
    try {
      return await Promise.race([
        (async () => {
          const response = await fetch(url, { ...options, signal: controller.signal });
          if (!response.ok) throw new Error(`Route service returned HTTP ${response.status}`);
          return response[format]();
        })(),
        deadline,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function optional(task, timeoutMs = 5000) {
    let timer;
    try {
      return await Promise.race([
        task,
        new Promise(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); }),
      ]);
    } catch (_) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  const api = {
    json: (url, options = {}, timeoutMs = 20000) => read(url, options, 'json', timeoutMs),
    arrayBuffer: (url, options = {}, timeoutMs = 20000) => read(url, options, 'arrayBuffer', timeoutMs),
    yieldToUI: () => new Promise(resolve => setTimeout(resolve, 0)),
    optional,
  };
  root.ApexRouteLoading = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
