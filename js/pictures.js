// Наборы иллюстраций лежат в cards/<набор>/. Классический — cards/classic/.

import { shuffle } from './rng.js';

export const CLASSIC_SET = 'classic';
export const DECK_COUNT = 279;

export function cardSrc(set, id) {
  return `cards/${set}/${String(id).padStart(3, '0')}.webp`;
}

export function generatePictures(count, rnd, deckCount = DECK_COUNT) {
  const total = deckCount;
  const n = Math.min(count, total);
  return shuffle([...Array(total).keys()], rnd)
    .slice(0, n)
    .map((id) => ({ id }));
}

export function renderPicture(pic) {
  const art = document.createElement('div');
  art.className = 'art art--photo';
  const img = document.createElement('img');
  img.src = cardSrc(pic.set || CLASSIC_SET, pic.id);
  img.alt = '';
  img.draggable = false;
  art.append(img);
  return art;
}
