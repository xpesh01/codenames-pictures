// Правила игры. Чистая логика без DOM и без сети — её гоняет хост комнаты.

import { makeRng, shuffle } from './rng.js';
import { generatePictures } from './pictures.js';

export const MODES = {
  pictures: { id: 'pictures', label: '5×4 — 20 картинок', cols: 5, rows: 4, first: 8, second: 7, neutral: 4 },
  big: { id: 'big', label: '5×5 — 25 картинок', cols: 5, rows: 5, first: 9, second: 8, neutral: 7 }
};

export const UNLIMITED = 99;
export const TEAMS = ['red', 'blue'];
export const other = (team) => (team === 'red' ? 'blue' : 'red');

export function createGame(seed, modeId = 'pictures') {
  const mode = MODES[modeId] || MODES.pictures;
  const rnd = makeRng(seed);
  const total = mode.cols * mode.rows;
  const pictures = generatePictures(total, rnd);

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
    cols: mode.cols,
    rows: mode.rows,
    starting,
    turn: starting,
    phase: 'clue', // clue -> guess -> ... -> over
    clue: null,
    guessesLeft: 0,
    winner: null,
    endedBy: null,
    cards: shuffle(keys, rnd).map((key, i) => ({
      key,
      revealed: false,
      pic: pictures[i],
      revealedBy: null
    })),
    log: [{ kind: 'start', team: starting, at: Date.now() }],
    version: 1
  };
}

export function remaining(state, team) {
  return state.cards.filter((c) => c.key === team && !c.revealed).length;
}

export function giveClue(state, team, word, count) {
  if (state.phase !== 'clue' || state.turn !== team) return false;
  const clean = String(word || '').trim().slice(0, 40);
  if (!clean) return false;
  const n = Math.max(0, Math.min(9, Number(count) || 0));
  state.clue = { word: clean, count: n, team };
  // «0» — классическая подсказка без ограничения числа попыток.
  // Держим её конечным числом, иначе Infinity превратится в null при передаче по сети.
  state.guessesLeft = n === 0 ? UNLIMITED : n + 1;
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
  state.log.push({ kind: 'turn', team: state.turn, at: Date.now() });
}

function finish(state, winner, endedBy) {
  state.phase = 'over';
  state.winner = winner;
  state.endedBy = endedBy;
  state.log.push({ kind: 'end', team: winner, endedBy, at: Date.now() });
  state.version++;
}

/**
 * Версия состояния для конкретного игрока: оперативникам ключи
 * нераскрытых карточек не отправляются вообще, чтобы их нельзя было
 * подсмотреть в консоли браузера.
 */
export function viewFor(state, isSpymaster) {
  return {
    ...state,
    cards: state.cards.map((c) => ({
      pic: c.pic,
      revealed: c.revealed,
      revealedBy: c.revealedBy,
      key: c.revealed || isSpymaster ? c.key : null
    })),
    counts: { red: remaining(state, 'red'), blue: remaining(state, 'blue') },
    youAreSpymaster: isSpymaster
  };
}
