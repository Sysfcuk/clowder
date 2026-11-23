import { think } from './ai.js';

self.onmessage = (e) => {
  const { id, board, state, me, n, rules, level } = e.data;
  let move = null;
  try {
    move = think(board, state, me, n, rules, level);
  } catch (err) {
    console.error(err);
  }
  self.postMessage({ id, move });
};
