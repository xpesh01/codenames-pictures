// Правила игры. Чистая логика без DOM и без сети — её гоняет хост комнаты.

import { makeRng, shuffle } from './rng.js';
import { getPack } from './packs.js';

export const MODES = {
  pictures: { id: 'pictures', label: '5×4 — 20 карточек', cols: 5, rows: 4, first: 8, second: 7, neutral: 4 },
  big: { id: 'big', label: '5×5 — 25 карточек', cols: 5, rows: 5, first: 9, second: 8, neutral: 7 }
};

export const UNLIMITED = 99;
export const TEAMS = ['red', 'blue'];
export const other = (team) => (team === 'red' ? 'blue' : 'red');
/** Дополнительные секунды на первую подсказку команды, которая ходит первой. */
export const FIRST_CLUE_BONUS_SEC = 120;

const TOKEN_COLORS = ['#ffd166', '#06d6a0', '#ef476f', '#4cc9f0', '#f78c6b', '#c77dff', '#80ed99', '#ffadad'];

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function asMinutes(min, sec, fallback) {
  let n = NaN;
  if (min != null && min !== '') n = Number(String(min).replace(',', '.'));
  else if (sec != null && sec !== '') n = Number(sec) / 60;
  else n = fallback;
  return Number.isFinite(n) ? n : fallback;
}

/** В интерфейсе время в минутах (можно дробное, шаг 0,1), в партии — секунды. */
export function normalizeSettings(raw = {}) {
  const clueMin = clamp(Math.round(asMinutes(raw.clueMin, raw.clueSec, 3) * 10) / 10, 0.5, 10);
  const guessMin = clamp(Math.round(asMinutes(raw.guessMin, raw.guessSec, 1.5) * 10) / 10, 0.5, 10);
  const botSec = (value) => clamp(Math.round(Number.isFinite(Number(value)) ? Number(value) : 5), 0, 30);
  return {
    timerOn: !!raw.timerOn,
    clueSec: Math.round(clueMin * 60),
    guessSec: Math.round(guessMin * 60),
    botOn: !!raw.botOn,
    botClueSec: botSec(raw.botClueSec),
    botGuessSec: botSec(raw.botGuessSec),
    botRisk: clamp(Math.round(Number.isFinite(Number(raw.botRisk)) ? Number(raw.botRisk) : 50), 0, 100)
  };
}

/** Цвет личной метки игрока — одинаковый у всех клиентов. */
export function playerColor(id) {
  let h = 2166136261 >>> 0;
  for (const c of String(id)) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return TOKEN_COLORS[h % TOKEN_COLORS.length];
}

export function playerInitial(name) {
  const chars = [...String(name || '?').trim()];
  return (chars[0] || '?').toUpperCase();
}

export function createGame(seed, modeId = 'pictures', packId = 'classic') {
  const mode = MODES[modeId] || MODES.pictures;
  const pack = getPack(packId);
  const rnd = makeRng(seed);
  const total = mode.cols * mode.rows;
  const faces = pack.deal(total, rnd);

  const starting = rnd() < 0.5 ? 'red' : 'blue';
  const keys = [
    ...Array(mode.first).fill(starting),
    ...Array(mode.second).fill(other(starting)),
    ...Array(mode.neutral).fill('neutral'),
    'assassin'
  ];

  return {
    seed,
    mode: mode.id,
    pack: pack.id,
    cols: mode.cols,
    rows: mode.rows,
    starting,
    turn: starting,
    phase: 'lobby', // lobby -> clue -> guess -> ... -> over
    firstClueBonus: true,
    clue: null,
    clues: [],
    guessesLeft: 0,
    winner: null,
    endedBy: null,
    review: false,
    cards: shuffle(keys, rnd).map((key, i) => ({
      key,
      revealed: false,
      face: faces[i],
      revealedBy: null
    })),
    marks: {},
    timer: { endsAt: null, duration: 0, startedAt: null },
    log: [],
    version: 1
  };
}

/** Игроки уже сели. С этого момента можно давать подсказки, и хост запускает таймер. */
export function startMatch(state) {
  if (!state || state.phase !== 'lobby') return false;
  state.phase = 'clue';
  state.firstClueBonus = true;
  state.log.push({ kind: 'start', team: state.starting, at: Date.now() });
  state.version++;
  return true;
}

export function remaining(state, team) {
  return state.cards.filter((c) => c.key === team && !c.revealed).length;
}

export function giveClue(state, team, word, count) {
  if (state.phase !== 'clue' || state.turn !== team) return false;
  const clean = String(word || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!clean || /\s/.test(clean)) return false;
  const n = Math.max(0, Math.min(9, Number(count) || 0));
  state.clue = { word: clean, count: n, team };
  state.clues.push({ word: clean, count: n, team, correct: 0 });
  // «0» — классическая подсказка без ограничения числа попыток.
  // Держим её конечным числом, иначе Infinity превратится в null при передаче по сети.
  state.guessesLeft = n === 0 ? UNLIMITED : n + 1;
  state.firstClueBonus = false;
  state.phase = 'guess';
  state.log.push({ kind: 'clue', team, word: clean, count: n, at: Date.now() });
  state.version++;
  return true;
}

export function revealCard(state, team, index) {
  if (state.phase !== 'guess' || state.turn !== team) return false;
  const card = state.cards[index];
  if (!card || card.revealed) return false;

  card.revealed = true;
  card.revealedBy = team;
  clearMarksOn(state, index);
  if (card.key === team) {
    const clue = state.clues[state.clues.length - 1];
    if (clue && clue.team === team) clue.correct = (clue.correct || 0) + 1;
  }
  state.log.push({ kind: 'reveal', team, index, key: card.key, at: Date.now() });

  if (card.key === 'assassin') {
    finish(state, other(team), 'assassin');
    return true;
  }

  if (card.key === team) {
    if (remaining(state, team) === 0) {
      finish(state, team, 'cleared');
      return true;
    }
    state.guessesLeft--;
    if (state.guessesLeft <= 0) passTurn(state);
  } else {
    if (card.key !== 'neutral' && remaining(state, card.key) === 0) {
      finish(state, card.key, 'cleared');
      return true;
    }
    passTurn(state);
  }
  state.version++;
  return true;
}

export function endTurn(state, team) {
  if (state.phase !== 'guess' || state.turn !== team) return false;
  passTurn(state);
  state.version++;
  return true;
}

function passTurn(state) {
  state.turn = other(state.turn);
  state.phase = 'clue';
  state.clue = null;
  state.guessesLeft = 0;
  state.marks = {};
  state.log.push({ kind: 'turn', team: state.turn, at: Date.now() });
}

function finish(state, winner, endedBy) {
  state.phase = 'over';
  state.winner = winner;
  state.endedBy = endedBy;
  state.marks = {};
  state.timer = { endsAt: null, duration: 0, startedAt: null };
  state.log.push({ kind: 'end', team: winner, endedBy, at: Date.now() });
  state.version++;
}

function markList(state, playerId) {
  const cur = state.marks[playerId];
  if (Array.isArray(cur)) return cur;
  if (Number.isInteger(cur)) return [cur];
  return [];
}

/** Метка капитана на этапе подсказки: повторный клик снимает её и ничего не открывает. */
export function toggleMark(state, playerId, index) {
  if (state.phase !== 'clue') return null;
  const card = state.cards[index];
  if (!card || card.revealed) return null;
  const list = markList(state, playerId);
  const at = list.indexOf(index);
  if (at >= 0) list.splice(at, 1);
  else list.push(index);
  if (list.length) state.marks[playerId] = list;
  else delete state.marks[playerId];
  state.version++;
  return at >= 0 ? 'cleared' : 'tagged';
}

/** Клик добавляет метку, не снимая остальные. Повтор по той же карточке — сигнал «открыть». */
export function setMark(state, playerId, index) {
  if (state.phase !== 'guess') return null;
  const card = state.cards[index];
  if (!card || card.revealed) return null;
  const list = markList(state, playerId);
  if (list.includes(index)) return 'ready';
  list.push(index);
  state.marks[playerId] = list;
  state.version++;
  return 'tagged';
}

export function clearMarksOn(state, index) {
  for (const id of Object.keys(state.marks)) {
    const cur = state.marks[id];
    if (Array.isArray(cur)) {
      const next = cur.filter((i) => i !== index);
      if (next.length) state.marks[id] = next;
      else delete state.marks[id];
    } else if (cur === index) {
      delete state.marks[id];
    }
  }
}

export function expireTurn(state) {
  if (state.phase !== 'clue' && state.phase !== 'guess') return false;
  state.firstClueBonus = false;
  state.log.push({ kind: 'timeout', team: state.turn, at: Date.now() });
  passTurn(state);
  state.version++;
  return true;
}

/**
 * Версия состояния для конкретного игрока. До старта лица карточек и ключ
 * не отправляются. Оперативникам ключи нераскрытых карточек не отправляются
 * и после старта, чтобы их нельзя было подсмотреть в консоли браузера.
 * После «Посмотреть поле» ключ виден всем, как капитану.
 */
export function viewFor(state, isSpymaster) {
  const open = state.phase !== 'lobby';
  const showKey = isSpymaster || (state.phase === 'over' && state.review);
  return {
    ...state,
    cards: state.cards.map((c) => ({
      face: open ? c.face : null,
      revealed: c.revealed,
      revealedBy: c.revealedBy,
      key: open && (c.revealed || showKey) ? c.key : null
    })),
    counts: { red: remaining(state, 'red'), blue: remaining(state, 'blue') },
    youAreSpymaster: isSpymaster
  };
}
