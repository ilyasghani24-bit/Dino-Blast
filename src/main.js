import { Game } from './game.js';

const game = new Game();
window.__game = game;
game.init().catch((err) => {
  console.error(err);
  const t = document.querySelector('.loading-text');
  if (t) t.textContent = 'Failed to load: ' + err.message;
});
