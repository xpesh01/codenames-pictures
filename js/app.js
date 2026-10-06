// Интерфейс: экран-меню, поле, панель управления. Всё состояние живёт в Room,
// здесь только отрисовка и отправка действий.

import { Room } from './room.js';
import { renderPicture } from './pictures.js';
import { MODES, UNLIMITED, normalizeSettings, playerInitial } from './game.js';

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
  turnText: $('#turn-text'),
  timer: $('#timer'),

  board: $('#board'),
  boardArea: $('#board-area'),
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
  playersBlock: $('#block-players'),
  log: $('#log'),

  homeTimerOn: $('#home-timer-on'),
  homeTimerFields: $('#home-timer-fields'),
  homeTimerClue: $('#home-timer-clue'),
  homeTimerGuess: $('#home-timer-guess'),
  gameTimerOn: $('#game-timer-on'),
  gameTimerClue: $('#game-timer-clue'),
  gameTimerGuess: $('#game-timer-guess'),
  timerHint: $('#timer-hint'),

  result: $('#result'),
  resultTitle: $('#result-title'),
  resultSub: $('#result-sub'),
  closeResult: $('#btn-close-result'),
  toast: $('#toast')
};

// Падежи команд: «красные ходят», «ход красных», «переходит к красным».
const TEAM = {
  red: { nom: 'красные', gen: 'красных', dat: 'красным' },
  blue: { nom: 'синие', gen: 'синих', dat: 'синим' }
};
const cap = (s) => s[0].toUpperCase() + s.slice(1);

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
try {
  const savedTimer = JSON.parse(localStorage.getItem('cnpix:timer') || 'null');
  if (savedTimer) {
    el.homeTimerOn.checked = !!savedTimer.timerOn;
    el.homeTimerClue.value = savedTimer.clueSec || 60;
    el.homeTimerGuess.value = savedTimer.guessSec || 90;
  }
} catch (_) {
  /* битые настройки — оставляем значения по умолчанию */
}
el.homeTimerFields.hidden = !el.homeTimerOn.checked;
el.homeTimerOn.addEventListener('change', () => {
  el.homeTimerFields.hidden = !el.homeTimerOn.checked;
});
const hashCode = location.hash.replace(/^#\/?/, '').trim().toUpperCase();
if (/^[A-Z0-9]{5}$/.test(hashCode)) {
  el.code.value = hashCode;
  el.code.focus();
}

const profile = () => ({ name: el.name.value.trim() || 'Агент', team: null, role: 'operative' });

function rememberName() {
  localStorage.setItem('cnpix:name', el.name.value.trim());
}

function readTimerSettings(onEl, clueEl, guessEl) {
  return normalizeSettings({
    timerOn: onEl.checked,
    clueSec: clueEl.value,
    guessSec: guessEl.value
  });
}

function rememberTimer() {
  localStorage.setItem('cnpix:timer', JSON.stringify(readTimerSettings(el.homeTimerOn, el.homeTimerClue, el.homeTimerGuess)));
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
    rememberTimer();
    const code = await room.createOnline(
      profile(),
      el.mode.value,
      readTimerSettings(el.homeTimerOn, el.homeTimerClue, el.homeTimerGuess)
    );
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
  rememberTimer();
  room.startLocal(
    profile(),
    el.mode.value,
    readTimerSettings(el.homeTimerOn, el.homeTimerClue, el.homeTimerGuess)
  );
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
  el.playersBlock.hidden = !online;
  startTimerTick();
}

el.back.addEventListener('click', () => {
  if (room.mode !== 'local' && !confirm('Выйти из комнаты?')) return;
  room.leave();
  stopTimerTick();
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
  renderTimerSettings(view);
  fitBoard();
}

const CARD_RATIO = 5 / 3;

/**
 * Подгоняет ширину поля так, чтобы оно целиком влезало в свободную область:
 * карточки держат пропорцию 5:4, поэтому ограничением становится либо ширина,
 * либо высота — берём меньшее. Благодаря этому страница никогда не скроллится.
 */
function fitBoard() {
  const view = room.view;
  if (!view || el.game.hidden) return;

  const styles = getComputedStyle(el.board);
  const cols = parseInt(styles.getPropertyValue('--cols'), 10) || view.cols;
  const gap = parseFloat(styles.columnGap) || 0;
  const rows = Math.ceil(view.cards.length / cols);

  const availW = el.boardArea.clientWidth;
  const availH = el.boardArea.clientHeight;
  if (!availW || !availH) return;

  const byWidth = (availW - (cols - 1) * gap) / cols;
  const byHeight = ((availH - (rows - 1) * gap) / rows) * CARD_RATIO;
  const cardW = Math.max(36, Math.min(byWidth, byHeight));

  el.board.style.width = `${Math.floor(cardW * cols + (cols - 1) * gap)}px`;
}

let fitScheduled = false;
const scheduleFit = () => {
  if (fitScheduled) return;
  fitScheduled = true;
  requestAnimationFrame(() => {
    fitScheduled = false;
    fitBoard();
  });
};

new ResizeObserver(scheduleFit).observe(el.boardArea);
window.addEventListener('resize', scheduleFit);
window.addEventListener('orientationchange', scheduleFit);

function renderBoard(view) {
  const signature = `${view.seed}:${view.cols}`;
  if (signature !== boardSignature) {
    boardSignature = signature;
    el.board.style.setProperty('--cols-base', view.cols);
    // поле 5×4 на телефоне разворачиваем в 4×5 — карточки получаются вдвое крупнее
    el.board.classList.toggle('board--rotatable', view.cards.length === 20);
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
      const marks = document.createElement('div');
      marks.className = 'marks';
      btn.append(dot, veil, marks);

      btn.addEventListener('click', () => {
        if (!btn.classList.contains('is-clickable')) return;
        room.dispatch({ t: 'pick', index: i });
      });
      el.board.append(btn);
      return btn;
    });
  }

  const guessing = canGuess(view);
  const marks = view.marks || [];
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
        card.key === 'assassin' ? '💀' : card.key === 'neutral' ? '🧍' : '🕵️';
    } else {
      btn.querySelector('.veil').textContent = '';
      if (guessing) btn.classList.add('is-clickable');
    }

    const mine = marks.find((m) => m.index === i && m.id === room.me.id);
    if (mine && guessing && !card.revealed) btn.classList.add('is-armed');

    const box = btn.querySelector('.marks');
    box.replaceChildren();
    for (const m of marks.filter((x) => x.index === i)) {
      const s = document.createElement('span');
      s.className = 'mark' + (m.id === room.me.id ? ' is-me' : '');
      s.style.background = m.color;
      s.textContent = m.initial;
      s.title = m.name;
      box.append(s);
    }

    btn.setAttribute(
      'aria-label',
      card.revealed
        ? `Карточка ${i + 1}, открыта`
        : mine
        ? `Карточка ${i + 1}, ваша метка — второй клик откроет`
        : `Карточка ${i + 1}`
    );
  });
}

function renderScore(view) {
  el.scoreRed.textContent = view.counts.red;
  el.scoreBlue.textContent = view.counts.blue;

  el.turn.className = 'turn-banner';
  if (view.phase === 'over') {
    el.turn.classList.add('is-over');
    el.turnText.textContent = `Победа ${TEAM[view.winner].gen}`;
    paintTimer(view);
    return;
  }
  el.turn.classList.add(view.turn === 'red' ? 'is-red' : 'is-blue');
  el.turnText.textContent =
    view.phase === 'clue'
      ? `Ход ${TEAM[view.turn].gen}: капитан думает`
      : `Ход ${TEAM[view.turn].gen}: угадывают`;
  paintTimer(view);
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
    el.clueInfo.textContent = `Капитан ${TEAM[view.turn].gen} придумывает подсказку…`;
  } else if (canGuess(view)) {
    el.clueInfo.textContent = 'Первый клик — метка, второй по той же карточке — открыть.';
  } else {
    el.clueInfo.textContent = `Угадывают ${TEAM[view.turn].nom}.`;
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
    const tint = document.createElement('span');
    tint.className = 'tint';
    tint.style.background = p.color || '#8d99b5';
    tint.textContent = playerInitial(p.name);
    const name = document.createElement('span');
    name.textContent = p.name;
    if (p.id === room.me.id) name.className = 'me';
    const role = document.createElement('span');
    role.className = 'role';
    role.textContent = p.team ? (p.role === 'spymaster' ? 'капитан' : 'оперативник') : 'зритель';
    li.append(tint, name, role);
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
      return `Начинают ${TEAM[e.team].nom}.`;
    case 'clue':
      return `${cap(TEAM[e.team].nom)}: подсказка «${e.word}» — ${e.count || '∞'}.`;
    case 'reveal': {
      const what =
        e.key === 'assassin'
          ? 'убийцу'
          : e.key === 'neutral'
          ? 'нейтральную карточку'
          : `агента ${TEAM[e.key].gen}`;
      return `${cap(TEAM[e.team].nom)} открыли ${what}.`;
    }
    case 'turn':
      return `Ход переходит к ${TEAM[e.team].dat}.`;
    case 'timeout':
      return `Время ${TEAM[e.team].gen} вышло.`;
    case 'end':
      return e.endedBy === 'assassin'
        ? `Убийца! Победа ${TEAM[e.team].gen}.`
        : `Все агенты найдены. Победа ${TEAM[e.team].gen}.`;
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
  el.resultTitle.textContent = `Победа ${TEAM[view.winner].gen}!`;
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

let clockOffset = 0;
let timerTick = null;

function paintTimer(view) {
  if (view.serverNow) clockOffset = view.serverNow - Date.now();
  const on = !!(view.settings && view.settings.timerOn) && view.phase !== 'over' && view.timer && view.timer.endsAt;
  el.timer.hidden = !on;
  if (!on) {
    el.timer.classList.remove('is-low');
    return;
  }
  const left = Math.max(0, view.timer.endsAt - (Date.now() + clockOffset));
  const sec = Math.ceil(left / 1000);
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, '0');
  el.timer.textContent = `${m}:${s}`;
  el.timer.classList.toggle('is-low', sec <= 10);
}

function startTimerTick() {
  if (timerTick) return;
  timerTick = setInterval(() => {
    if (room.view) paintTimer(room.view);
  }, 250);
}

function stopTimerTick() {
  clearInterval(timerTick);
  timerTick = null;
}

function canEditSettings() {
  return room.mode === 'local' || room.mode === 'host';
}

function renderTimerSettings(view) {
  const s = view.settings || room.settings;
  const writable = canEditSettings();
  if (document.activeElement !== el.gameTimerOn) el.gameTimerOn.checked = !!s.timerOn;
  if (document.activeElement !== el.gameTimerClue) el.gameTimerClue.value = s.clueSec;
  if (document.activeElement !== el.gameTimerGuess) el.gameTimerGuess.value = s.guessSec;
  el.gameTimerOn.disabled = !writable;
  el.gameTimerClue.disabled = !writable || !s.timerOn;
  el.gameTimerGuess.disabled = !writable || !s.timerOn;
  el.timerHint.hidden = writable;
}

function sendTimerSettings() {
  if (!canEditSettings()) return;
  room.dispatch({
    t: 'settings',
    ...readTimerSettings(el.gameTimerOn, el.gameTimerClue, el.gameTimerGuess)
  });
}

el.gameTimerOn.addEventListener('change', sendTimerSettings);
el.gameTimerClue.addEventListener('change', sendTimerSettings);
el.gameTimerGuess.addEventListener('change', sendTimerSettings);

// Подсказка по размерам поля в меню собирается из правил, чтобы не дублировать цифры.
for (const opt of el.mode.options) {
  const m = MODES[opt.value];
  if (m) opt.title = `${m.first}/${m.second} агентов, ${m.neutral} нейтральных, 1 убийца`;
}
