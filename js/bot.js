// Ход бота по вшитым векторам. Оперативник не получает ключ.

import { CLUE_WORDS } from './cluevocab.js';
import { WORDS } from './words.js';
import { WORDS_18 } from './words18.js';

// Чёрная карта и чужая команда — порог, а не слабый штраф: своё слово должно быть
// явно ближе. Пара и тройка берутся, только если слабейшее слово само выше порога.
const ASSASSIN_MARGIN = 0.15;
const ENEMY_MARGIN = 0.1;
const MIN_MULTI = 0.52;
const MAX_DROP = 0.2;
const COUNT_BONUS = 0.04;
const MAX_CLUE = 3;
const GUESS_CONTINUE = 0.3;
const GUESS_UNLIMITED = 0.38;
const UNLIMITED_CAP = 3;

let vectorsPromise = null;
let vectors = null;
let picturePromise = null;
let pictureVectors = null;
let pictureLabels = null;

export function normWord(word) {
  return String(word || '').toLowerCase().replaceAll('ё', 'е').trim();
}

export function ensureVectors() {
  if (vectors) return Promise.resolve(vectors);
  if (!vectorsPromise) {
    vectorsPromise = import('./vectors.js')
      .then((mod) => {
        vectors = mod.loadVectors();
        return vectors;
      })
      .catch((err) => {
        vectorsPromise = null;
        throw err;
      });
  }
  return vectorsPromise;
}

/** Подписи и векторы классических картинок. Грузятся только когда бот ходит по ним. */
export function ensurePictureBot() {
  if (pictureVectors && pictureLabels && vectors) return Promise.resolve();
  if (!picturePromise) {
    picturePromise = Promise.all([
      ensureVectors(),
      import('./classic-vectors.js'),
      import('./classic-labels.js')
    ])
      .then(([, vecMod, labelMod]) => {
        pictureVectors = vecMod.loadClassicVectors();
        pictureLabels = labelMod.CLASSIC_LABELS;
      })
      .catch((err) => {
        picturePromise = null;
        throw err;
      });
  }
  return picturePromise;
}

export function pictureFile(id) {
  return `${String(id).padStart(3, '0')}.webp`;
}

function dot(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

function deckWords(packId) {
  if (packId === 'words18') return WORDS_18;
  if (packId === 'words') return WORDS;
  return [];
}

function clashes(candidate, board) {
  for (const word of board) {
    if (candidate === word) return true;
    const shorter = Math.min(candidate.length, word.length);
    if (shorter >= 4 && (candidate.includes(word) || word.includes(candidate))) return true;
    if (candidate.length >= 5 && word.length >= 5 && candidate.slice(0, 5) === word.slice(0, 5)) return true;
  }
  return false;
}

/** 0 — осторожно, одно слово. 100 — длинные подсказки. 50 — прежние пороги. */
function limitsFor(risk, picture) {
  const n = Number(risk);
  const t = (Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 50) / 100;
  const mix = (safe, bold) => safe + (bold - safe) * t;
  const shared = {
    t,
    maxClue: Math.round(1 + t * 4),
    countBonus: mix(0, 0.08, t)
  };
  if (picture) {
    return {
      ...shared,
      minMulti: mix(0.46, 0.1, t),
      assassinMargin: mix(0.1, 0, t),
      enemyMargin: mix(0.08, 0, t),
      maxDrop: mix(0.14, 0.42, t)
    };
  }
  return {
    ...shared,
    minMulti: mix(0.64, 0.4, t),
    assassinMargin: mix(0.24, 0.06, t),
    enemyMargin: mix(0.16, 0.04, t),
    maxDrop: mix(0.1, 0.3, t)
  };
}

function keepClue(best, option, t) {
  if (!option) return best;
  if (!best) return option;
  if (t > 0.5) {
    if (option.count !== best.count) return option.count > best.count ? option : best;
    return option.score > best.score ? option : best;
  }
  if (t < 0.5) return option.score > best.score ? option : best;
  const optionMulti = option.count >= 2;
  const bestMulti = best.count >= 2;
  if (optionMulti !== bestMulti) return optionMulti ? option : best;
  return option.score > best.score ? option : best;
}

/**
 * Сколько своих карт оперативник снимет этой подсказкой, пока не упрётся
 * в чёрную или в чужую. Число объявляется так, чтобы лишняя попытка
 * (в партии их count+1) не доставала до чёрной карты.
 */
function assessClue(row, live, team, limits = {}) {
  const minMulti = limits.minMulti ?? MIN_MULTI;
  const assassinMargin = limits.assassinMargin ?? ASSASSIN_MARGIN;
  const enemyMargin = limits.enemyMargin ?? ENEMY_MARGIN;
  const maxDrop = limits.maxDrop ?? MAX_DROP;
  const maxClue = limits.maxClue ?? MAX_CLUE;
  const countBonus = limits.countBonus ?? COUNT_BONUS;
  const order = [];
  for (let i = 0; i < live.length; i++) order.push(i);
  order.sort((a, b) => row[b] - row[a]);

  let assassinSim = null;
  let enemySim = null;
  for (let i = 0; i < live.length; i++) {
    const key = live[i].key;
    if (key === 'assassin') assassinSim = row[i];
    else if (key !== team && key !== 'neutral' && (enemySim == null || row[i] > enemySim)) enemySim = row[i];
  }

  const group = [];
  for (const i of order) {
    if (group.length >= maxClue) break;
    if (live[i].key !== team) break;
    const sim = row[i];
    if (assassinSim != null && sim < assassinSim + assassinMargin) break;
    if (enemySim != null && sim < enemySim + enemyMargin) break;
    if (group.length >= 1 && (sim < minMulti || group[0] - sim > maxDrop)) break;
    group.push(sim);
  }
  if (!group.length) return null;

  let count = group.length;
  const next = order[count];
  if (next != null && live[next].key === 'assassin') count -= 1;
  if (count < 1) return null;

  const weak = group[count - 1];
  const gapA = assassinSim == null ? weak : weak - assassinSim;
  const gapE = enemySim == null ? gapA : weak - enemySim;
  return { count, score: Math.min(gapA, gapE) + countBonus * (count - 1) };
}

/**
 * Одна карта, которая ближе любой другой. Нужна, когда порог риска
 * не пускает пару, но молчать уже нельзя.
 */
function clueForClosest(pool, live, team) {
  let best = null;
  for (const item of pool) {
    let top = -2;
    let second = -2;
    let topKey = null;
    for (const card of live) {
      const sim = dot(item.vec, card.vec);
      if (sim > top) {
        second = top;
        top = sim;
        topKey = card.key;
      } else if (sim > second) second = sim;
    }
    if (topKey !== team) continue;
    const score = second === -2 ? top : top - second;
    if (!best || score > best.score) best = { word: item.word, count: 1, score };
  }
  return best;
}

/** Подсказка капитана. cards: { text, key, revealed }. */
export function chooseClue({ cards, team, packId, risk }) {
  if (!vectors) throw new Error('Векторы ещё не загружены');
  const board = [];
  for (const card of cards) {
    const key = normWord(card.text);
    if (!key) continue;
    board.push(key);
  }

  const hiddenAssassin = cards.some(
    (card) => !card.revealed && card.key === 'assassin' && card.text && !vectors.has(normWord(card.text))
  );
  if (hiddenAssassin) return null;

  const display = new Map();
  for (const word of CLUE_WORDS.concat(deckWords(packId))) {
    const key = normWord(word);
    if (key && !display.has(key)) display.set(key, word);
  }

  const pool = [];
  for (const [key, word] of display) {
    if (/\s/.test(word) || clashes(key, board)) continue;
    const vec = vectors.get(key);
    if (!vec) continue;
    pool.push({ word, vec });
  }
  if (!pool.length) return null;

  const live = [];
  for (const card of cards) {
    if (card.revealed) continue;
    const vec = vectors.get(normWord(card.text));
    if (!vec) continue;
    live.push({ key: card.key, vec });
  }
  if (!live.some((card) => card.key === team)) return null;

  const limits = limitsFor(risk, false);
  let best = null;
  for (const item of pool) {
    const row = new Float32Array(live.length);
    for (let i = 0; i < live.length; i++) row[i] = dot(item.vec, live[i].vec);
    const option = assessClue(row, live, team, limits);
    if (!option) continue;
    option.word = item.word;
    best = keepClue(best, option, limits.t);
  }

  const picked = best || clueForClosest(pool, live, team);
  return picked ? { word: picked.word, count: picked.count } : null;
}

/**
 * Ход оперативника. В картах только index и text.
 * Возвращает { type: 'reveal', index } или { type: 'end' }.
 */
export function chooseGuess({ cards, clue, announced, guessesMade }) {
  if (!vectors) throw new Error('Векторы ещё не загружены');
  for (const card of cards) {
    if (Object.prototype.hasOwnProperty.call(card, 'key')) {
      throw new Error('Оперативник не должен видеть ключ');
    }
  }
  const made = guessesMade || 0;
  const clueVec = vectors.get(normWord(clue));
  const ranked = [];
  if (clueVec) {
    for (const card of cards) {
      const vec = vectors.get(normWord(card.text));
      if (!vec) continue;
      ranked.push({ index: card.index, sim: dot(clueVec, vec) });
    }
    ranked.sort((a, b) => b.sim - a.sim);
  }
  if (!ranked.length) {
    if (made === 0 && cards.length) return { type: 'reveal', index: cards[0].index };
    return { type: 'end' };
  }

  const top = ranked[0];
  if (made === 0) return { type: 'reveal', index: top.index };

  const count = Number(announced) || 0;
  if (count === 0) {
    if (made < UNLIMITED_CAP && top.sim >= GUESS_UNLIMITED) return { type: 'reveal', index: top.index };
    return { type: 'end' };
  }
  if (made < count && top.sim >= GUESS_CONTINUE) return { type: 'reveal', index: top.index };
  return { type: 'end' };
}

function wordVec(word) {
  const key = normWord(word);
  if (!key) return null;
  return pictureVectors?.get(key) || vectors?.get(key) || null;
}

/** Взвешенное среднее подписей. Чем больше weight, тем сильнее слово тянет карточку. */
function mixCard(labels) {
  if (!labels?.length || !pictureVectors) return null;
  const dim = pictureVectors.values().next().value.length;
  const acc = new Float32Array(dim);
  let weight = 0;
  for (const item of labels) {
    const vec = pictureVectors.get(normWord(item.word));
    const w = Number(item.weight);
    if (!vec || !(w > 0)) continue;
    for (let d = 0; d < dim; d++) acc[d] += w * vec[d];
    weight += w;
  }
  if (!weight) return null;
  let sum = 0;
  for (let d = 0; d < dim; d++) sum += acc[d] * acc[d];
  const inv = sum > 0 ? 1 / Math.sqrt(sum) : 0;
  for (let d = 0; d < dim; d++) acc[d] *= inv;
  return acc;
}

function pictureLabelsOf(file) {
  return pictureLabels?.[file] || [];
}

/** Подсказка капитана по картинкам. cards: { file, key, revealed }. */
export function choosePictureClue({ cards, team, risk }) {
  if (!pictureVectors || !pictureLabels || !vectors) throw new Error('Векторы картинок ещё не загружены');
  const labelWords = new Map();
  for (const items of Object.values(pictureLabels)) {
    for (const item of items) {
      const key = normWord(item.word);
      if (key && !labelWords.has(key)) labelWords.set(key, item.word);
    }
  }

  const display = new Map();
  for (const word of CLUE_WORDS) {
    const key = normWord(word);
    if (key && !display.has(key)) display.set(key, word);
  }
  for (const [key, word] of labelWords) {
    if (!display.has(key)) display.set(key, word);
  }

  const pool = [];
  for (const [key, word] of display) {
    if (/\s/.test(word)) continue;
    const vec = wordVec(key);
    if (!vec) continue;
    pool.push({ word, vec });
  }
  if (!pool.length) return null;

  const live = [];
  for (const card of cards) {
    if (card.revealed) continue;
    const vec = mixCard(pictureLabelsOf(card.file));
    if (!vec) continue;
    live.push({ key: card.key, vec });
  }
  const assassinMissing = cards.some(
    (card) => !card.revealed && card.key === 'assassin' && !mixCard(pictureLabelsOf(card.file))
  );
  if (assassinMissing || !live.some((card) => card.key === team)) return null;

  const limits = limitsFor(risk, true);
  let best = null;
  for (const item of pool) {
    const row = new Float32Array(live.length);
    for (let i = 0; i < live.length; i++) row[i] = dot(item.vec, live[i].vec);
    const option = assessClue(row, live, team, limits);
    if (!option) continue;
    option.word = item.word;
    best = keepClue(best, option, limits.t);
  }

  const picked = best || clueForClosest(pool, live, team);
  return picked ? { word: picked.word, count: picked.count } : null;
}

/**
 * Ход оперативника по картинкам. В картах только index и file, без ключа.
 */
export function choosePictureGuess({ cards, clue, announced, guessesMade }) {
  if (!pictureVectors || !pictureLabels) throw new Error('Векторы картинок ещё не загружены');
  for (const card of cards) {
    if (Object.prototype.hasOwnProperty.call(card, 'key')) {
      throw new Error('Оперативник не должен видеть ключ');
    }
  }
  const made = guessesMade || 0;
  const clueVec = wordVec(clue);
  const ranked = [];
  if (clueVec) {
    for (const card of cards) {
      const vec = mixCard(pictureLabelsOf(card.file));
      if (!vec) continue;
      ranked.push({ index: card.index, sim: dot(clueVec, vec) });
    }
    ranked.sort((a, b) => b.sim - a.sim);
  }
  if (!ranked.length) {
    if (made === 0 && cards.length) return { type: 'reveal', index: cards[0].index };
    return { type: 'end' };
  }

  const top = ranked[0];
  if (made === 0) return { type: 'reveal', index: top.index };

  const count = Number(announced) || 0;
  if (count === 0) {
    if (made < UNLIMITED_CAP && top.sim >= GUESS_UNLIMITED) return { type: 'reveal', index: top.index };
    return { type: 'end' };
  }
  if (made < count && top.sim >= GUESS_CONTINUE) return { type: 'reveal', index: top.index };
  return { type: 'end' };
}
