// Карточки из cards.pdf: 279 иллюстраций, на поле каждый раз случайная колода.

import { shuffle } from './rng.js';

export const DECK_COUNT = 279;

export function cardSrc(id) {
  return `cards/${String(id).padStart(3, '0')}.webp`;
}

export function generatePictures(count, rnd) {
  const n = Math.min(count, DECK_COUNT);
  return shuffle([...Array(DECK_COUNT).keys()], rnd)
    .slice(0, n)
    .map((id) => ({ id }));
}

export function renderPicture(pic) {
  const art = document.createElement('div');
  art.className = 'art art--photo';
  const img = document.createElement('img');
  img.src = cardSrc(pic.id);
  img.alt = '';
  img.draggable = false;
  art.append(img);
  return art;
}
