// Интерфейс: экран-меню, поле, панель управления. Всё состояние живёт в Room,
// здесь только отрисовка и отправка действий.

import { Room } from './room.js';
import { renderPicture } from './pictures.js';
import { MODES, UNLIMITED } from './game.js';

const $ = (sel) => document.querySelector(sel);

const el = {
  home: $('#screen-home'),
  game: $('#screen-game'),
  name: $('#input-name'),
  mode: $('#input-mode'),
  code: $('#input-code'),
  create: $('#btn-create'),
  join: $('#btn-join'),
  local: $('#btn-local'),
  homeError: $('#home-error'),

  back: $('#btn-home'),
  roomCode: $('#room-code'),
  invite: $('#btn-invite'),
  status: $('#status'),
  newGame: $('#btn-new'),
  newGame2: $('#btn-new-2'),

  scoreRed: $('#score-red'),
  scoreBlue: $('#score-blue'),
  turn: $('#turn-banner'),

  board: $('#board'),
  clueStrip: $('#clue-strip'),

  seatOnline: $('#seat-online'),
  seatLocal: $('#seat-local'),
  toggleKey: $('#toggle-key'),
  clueForm: $('#clue-form'),
  clueWord: $('#clue-word'),
  clueCount: $('#clue-count'),
  clueInfo: $('#clue-info'),
  endTurn: $('#btn-endturn'),
  players: $('#players'),
  log: $('#log'),

  result: $('#result'),
  resultTitle: $('#result-title'),
  resultSub: $('#result-sub'),
  closeResult: $('#btn-close-result'),
  toast: $('#toast')
};

const TEAM_RU = { red: 'Красные', blue: 'Синие' };
const TEAM_ONE = { red: 'красных', blue: 'синих' };

let boardSignature = null;
let cardEls = [];
let resultShownFor = null;

const room = new Room({
  onRender: render,
  onStatus: (t) => (el.status.textContent = t),
  onToast: toast
});

/* ───────── меню ───────── */

el.name.value = localStorage.getItem('cnpix:name') || '';
const hashCode = location.hash.replace(/^#\/?/, '').trim().toUpperCase();
if (/^[A-Z0-9]{5}$/.test(hashCode)) {
  el.code.value = hashCode;
  el.code.focus();
}

const profile = () => ({ name: el.name.value.trim() || 'Агент', team: null, role: 'operative' });

function rememberName() {
  localStorage.setItem('cnpix:name', el.name.value.trim());
}

function homeError(msg) {
  el.homeError.textContent = msg;
  el.homeError.hidden = !msg;
}

async function withBusy(btn, fn) {
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Секунду…';
  homeError('');
  try {
    await fn();
  } catch (err) {
    homeError(err && err.message ? err.message : 'Что-то пошло не так');
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

el.create.addEventListener('click', () =>
  withBusy(el.create, async () => {
    rememberName();
    const code = await room.createOnline(profile(), el.mode.value);
    location.hash = code;
    showGame();
    el.status.textContent = 'Комната открыта — ждём игроков';
  })
);

el.join.addEventListener('click', () =>
  withBusy(el.join, async () => {
    const code = el.code.value.trim().toUpperCase();
    if (code.length !== 5) throw new Error('Код комнаты — 5 символов');
    rememberName();
    await room.joinOnline(code, profile());
    location.hash = code;
    showGame();
  })
);

el.code.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') el.join.click();
});

el.local.addEventListener('click', () => {
  rememberName();
  room.startLocal(profile(), el.mode.value);
  showGame();
  el.status.textContent = 'Игра на одном устройстве';
});

function showGame() {
  el.home.hidden = true;
  el.game.hidden = false;
  el.roomCode.textContent = room.code || 'локально';
  el.invite.hidden = !room.code;
  const online = room.mode !== 'local';
  el.seatOnline.hidden = !online;
  el.seatLocal.hidden = online;
}

el.back.addEventListener('click', () => {
  if (room.mode !== 'local' && !confirm('Выйти из комнаты?')) return;
  room.leave();
  location.hash = '';
  boardSignature = null;
  el.game.hidden = true;
  el.home.hidden = false;
  el.result.hidden = true;
});

/* ───────── управление ───────── */

el.invite.addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}#${room.code}`;
  try {
    await navigator.clipboard.writeText(url);
    toast('Ссылка скопирована');
  } catch (_) {
    prompt('Скопируйте ссылку:', url);
  }
});

el.seatOnline.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.dataset.team) {
    const team = btn.dataset.team === 'none' ? null : btn.dataset.team;
    room.me.team = team;
    room.dispatch({ t: 'seat', team, role: room.me.role, name: room.me.name });
  } else if (btn.dataset.role) {
    room.me.role = btn.dataset.role;
    room.dispatch({ t: 'seat', team: room.me.team, role: btn.dataset.role, name: room.me.name });
  }
  render();
});

el.toggleKey.addEventListener('change', () => {
  room.dispatch({ t: 'localReveal', value: el.toggleKey.checked });
});

el.clueForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const word = el.clueWord.value.trim();
  if (!word) return;
  room.dispatch({ t: 'clue', word, count: Number(el.clueCount.value) });
  el.clueWord.value = '';
  el.clueCount.value = '1';
});

el.endTurn.addEventListener('click', () => room.dispatch({ t: 'endTurn' }));

const startNew = () => {
  if (!confirm('Начать новую партию?')) return;
  room.dispatch({ t: 'newGame', mode: room.boardMode });
  el.result.hidden = true;
  resultShownFor = null;
};
el.newGame.addEventListener('click', startNew);
el.newGame2.addEventListener('click', startNew);
el.closeResult.addEventListener('click', () => (el.result.hidden = true));

let toastTimer = null;
function toast(text) {
  el.toast.textContent = text;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.toast.hidden = true), 2600);
}

/* ───────── отрисовка ───────── */

function myTurn(view) {
  if (room.mode === 'local') return true;
  return room.me.team === view.turn;
}

function canGuess(view) {
  if (view.phase !== 'guess') return false;
  if (room.mode === 'local') return !room.localReveal;
  return myTurn(view) && room.me.role === 'operative';
}

function canClue(view) {
  if (view.phase !== 'clue') return false;
  if (room.mode === 'local') return true;
  return myTurn(view) && room.me.role === 'spymaster';
}

function render() {
  const view = room.view;
  if (!view) return;

  renderBoard(view);
  renderScore(view);
  renderClue(view);
  renderSeat(view);
  renderPlayers();
  renderLog(view);
  renderResult(view);
}

function renderBoard(view) {
  const signature = `${view.seed}:${view.cols}`;
  if (signature !== boardSignature) {
    boardSignature = signature;
    el.board.style.setProperty('--cols', view.cols);
    el.board.innerHTML = '';
    cardEls = view.cards.map((card, i) => {
      const btn = document.createElement('button');
      btn.className = 'card';
      btn.type = 'button';
      btn.dataset.i = i;
      btn.append(renderPicture(card.pic));

      const dot = document.createElement('span');
      dot.className = 'hint-dot';
      const veil = document.createElement('span');
      veil.className = 'veil';
      btn.append(dot, veil);

      btn.addEventListener('click', () => {
        if (!btn.classList.contains('is-clickable')) return;
        room.dispatch({ t: 'reveal', index: i });
      });
      el.board.append(btn);
      return btn;
    });
  }

  const guessing = canGuess(view);
  view.cards.forEach((card, i) => {
    const btn = cardEls[i];
    if (!btn) return;
    btn.className = 'card';
    if (card.key) {
      btn.classList.add(card.revealed ? `key-${card.key}` : `hint-${card.key}`);
    }
    if (card.revealed) {
      btn.classList.add('is-revealed');
      btn.querySelector('.veil').textContent =
        card.key === 'assassin' ? '💀' : card.key === 'neutral' ? '🫥' : '🕵️';
    } else {
      btn.querySelector('.veil').textContent = '';
      if (guessing) btn.classList.add('is-clickable');
    }
    btn.setAttribute(
      'aria-label',
      card.revealed ? `Карточка ${i + 1}, открыта` : `Карточка ${i + 1}`
    );
  });
}

function renderScore(view) {
  el.scoreRed.textContent = view.counts.red;
  el.scoreBlue.textContent = view.counts.blue;

  el.turn.className = 'turn-banner';
  if (view.phase === 'over') {
    el.turn.classList.add('is-over');
    el.turn.textContent = `Победа: ${TEAM_RU[view.winner]}`;
    return;
  }
  el.turn.classList.add(view.turn === 'red' ? 'is-red' : 'is-blue');
  el.turn.textContent =
    view.phase === 'clue'
      ? `Ход ${TEAM_ONE[view.turn]}: капитан думает`
      : `Ход ${TEAM_ONE[view.turn]}: угадывают`;
}

function renderClue(view) {
  const showForm = canClue(view);
  el.clueForm.hidden = !showForm;

  if (view.clue) {
    el.clueStrip.hidden = false;
    const left = view.guessesLeft >= UNLIMITED ? '∞' : view.guessesLeft;
    el.clueStrip.innerHTML = `<b>${escapeHtml(view.clue.word)}</b><span class="count">${
      view.clue.count || '∞'
    }</span><div class="muted small">осталось попыток: ${left}</div>`;
  } else {
    el.clueStrip.hidden = true;
  }

  if (view.phase === 'over') {
    el.clueInfo.textContent = 'Партия окончена.';
  } else if (showForm) {
    el.clueInfo.textContent = 'Введите слово и количество карточек.';
  } else if (view.phase === 'clue') {
    el.clueInfo.textContent = `Капитан ${TEAM_ONE[view.turn]} придумывает подсказку…`;
  } else if (canGuess(view)) {
    el.clueInfo.textContent = 'Выбирайте карточки на поле.';
  } else {
    el.clueInfo.textContent = `Угадывают ${TEAM_RU[view.turn].toLowerCase()}.`;
  }

  el.endTurn.hidden = !canGuess(view);
}

function renderSeat(view) {
  if (room.mode === 'local') {
    el.toggleKey.checked = !!room.localReveal;
    return;
  }
  el.seatOnline.querySelectorAll('[data-team]').forEach((b) => {
    const t = b.dataset.team === 'none' ? null : b.dataset.team;
    b.classList.toggle('is-active', room.me.team === t);
  });
  el.seatOnline.querySelectorAll('[data-role]').forEach((b) => {
    b.classList.toggle('is-active', room.me.role === b.dataset.role);
  });
}

function renderPlayers() {
  el.players.innerHTML = '';
  if (!room.players.length) return;
  for (const p of room.players) {
    const li = document.createElement('li');
    const tag = document.createElement('span');
    tag.className = 'tag' + (p.team ? ` tag--${p.team}` : '');
    const name = document.createElement('span');
    name.textContent = p.name;
    if (p.id === room.me.id) name.className = 'me';
    const role = document.createElement('span');
    role.className = 'role';
    role.textContent = p.team ? (p.role === 'spymaster' ? 'капитан' : 'оперативник') : 'зритель';
    li.append(tag, name, role);
    el.players.append(li);
  }
}

function renderLog(view) {
  el.log.innerHTML = '';
  const items = view.log.slice().reverse();
  for (const e of items) {
    const li = document.createElement('li');
    li.className = e.team === 'red' ? 'r' : e.team === 'blue' ? 'b' : '';
    li.textContent = logText(e);
    el.log.append(li);
  }
}

function logText(e) {
  switch (e.kind) {
    case 'start':
      return `Начинают ${TEAM_ONE[e.team]}.`;
    case 'clue':
      return `${TEAM_RU[e.team]}: подсказка «${e.word}» — ${e.count || '∞'}.`;
    case 'reveal': {
      const what =
        e.key === 'assassin'
          ? 'убийцу'
          : e.key === 'neutral'
          ? 'нейтральную карточку'
          : `агента ${TEAM_ONE[e.key]}`;
      return `${TEAM_RU[e.team]} открыли ${what}.`;
    }
    case 'turn':
      return `Ход переходит к ${TEAM_ONE[e.team]}.`;
    case 'end':
      return e.endedBy === 'assassin'
        ? `Убийца! Победа ${TEAM_ONE[e.team]}.`
        : `Все агенты найдены. Победа ${TEAM_ONE[e.team]}.`;
    default:
      return '';
  }
}

function renderResult(view) {
  if (view.phase !== 'over') {
    resultShownFor = null;
    el.result.hidden = true;
    return;
  }
  if (resultShownFor === view.seed) return;
  resultShownFor = view.seed;
  el.resultTitle.textContent = `Победа: ${TEAM_RU[view.winner]}`;
  el.resultTitle.className = view.winner === 'red' ? 'is-red' : 'is-blue';
  el.resultSub.textContent =
    view.endedBy === 'assassin'
      ? 'Соперники наткнулись на убийцу.'
      : 'Все свои агенты найдены.';
  el.result.hidden = false;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Подсказка по размерам поля в меню собирается из правил, чтобы не дублировать цифры.
for (const opt of el.mode.options) {
  const m = MODES[opt.value];
  if (m) opt.title = `${m.first}/${m.second} агентов, ${m.neutral} нейтральных, 1 убийца`;
}
