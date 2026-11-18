// sounds.vettadrive.app (web/sounds.html): the Practice Loop sheet (web/practice_loop.js) and its pictures, played by
// the browser player (web/sounds.js) in place of the app's native one.
(function () {
  'use strict';
  const P = window.ApexPracticeLoop, S = window.VettaSounds;
  const player = S.player((msg) => P.onNative(msg));
  P.mount(document.getElementById('sheet'), {
    post: (m) => player.handle(m),
    viz: window.ApexPracticeViz,
    document,
    note: 'Plays in this tab. Keep the screen on: a browser stops the sound when the phone locks.',
  });
})();
