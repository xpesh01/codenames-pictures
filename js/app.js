// Интерфейс: экран-меню, поле, панель управления. Всё состояние живёт в Room,
// здесь только отрисовка и отправка действий.

import { Room } from './room.js';
import { renderFace } from './cardface.js';
import { MODES, UNLIMITED, FIRST_CLUE_BONUS_SEC, normalizeSettings, playerInitial } from './game.js';
import { PACK_LIST, getPack } from './packs.js';

const $ = (sel) => document.querySelector(sel);

const el = {
  home: $('#screen-home'),
  game: $('#screen-game'),
  name: $('#input-name'),
  mode: $('#input-mode'),
  pack: $('#input-pack'),
  packNoteHome: $('#pack-note-home'),
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
  lobbyBar: $('#lobby-bar'),
  lobbyText: $('#lobby-text'),
  begin: $('#btn-begin'),

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
  clueHistory: $('#clue-history'),
  clueHistoryEmpty: $('#clue-history-empty'),
  endTurn: $('#btn-endturn'),
  newGameDialog: $('#new-game-dialog'),
  newGamePack: $('#new-game-pack'),
  newGamePackNote: $('#new-game-pack-note'),
  newGameConfirm: $('#btn-new-confirm'),
  newGameCancel: $('#btn-new-cancel'),
  players: $('#players'),
  playersBlock: $('#block-players'),
  botPanel: $('#block-bot'),
  botNote: $('#bot-note'),
  botList: $('#bot-list'),
  addBot: $('#btn-add-bot'),
  sidePanel: $('#side-panel'),

  homeTimerOn: $('#home-timer-on'),
  homeTimerFields: $('#home-timer-fields'),
  homeTimerClue: $('#home-timer-clue'),
  homeTimerGuess: $('#home-timer-guess'),
  homeBotOn: $('#home-bot-on'),
  homeBotFields: $('#home-bot-fields'),
  homeBotClue: $('#home-bot-clue'),
  homeBotGuess: $('#home-bot-guess'),
  homeBotRisk: $('#home-bot-risk'),
  homeBotRiskValue: $('#home-bot-risk-value'),
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
    if (el.homeBotOn) el.homeBotOn.checked = !!savedTimer.botOn;
    el.homeTimerClue.value = secondsToMinutes(savedTimer.clueMin != null ? savedTimer.clueMin * 60 : savedTimer.clueSec, 3);
    el.homeTimerGuess.value = secondsToMinutes(savedTimer.guessMin != null ? savedTimer.guessMin * 60 : savedTimer.guessSec, 1.5);
    if (savedTimer.botClueSec != null) el.homeBotClue.value = savedTimer.botClueSec;
    if (savedTimer.botGuessSec != null) el.homeBotGuess.value = savedTimer.botGuessSec;
    if (savedTimer.botRisk != null && el.homeBotRisk) el.homeBotRisk.value = savedTimer.botRisk;
  }
} catch (_) {
  /* битые настройки — оставляем значения по умолчанию */
}
el.homeTimerFields.hidden = !el.homeTimerOn.checked;
el.homeTimerOn.addEventListener('change', () => {
  el.homeTimerFields.hidden = !el.homeTimerOn.checked;
});
if (el.homeBotOn && el.homeBotFields) {
  el.homeBotFields.hidden = !el.homeBotOn.checked;
  el.homeBotOn.addEventListener('change', () => {
    el.homeBotFields.hidden = !el.homeBotOn.checked;
  });
}
if (el.homeBotRisk && el.homeBotRiskValue) {
  const paintBotRisk = () => {
    el.homeBotRiskValue.textContent = el.homeBotRisk.value;
  };
  paintBotRisk();
  el.homeBotRisk.addEventListener('input', paintBotRisk);
}
const hashCode = location.hash.replace(/^#\/?/, '').trim().toUpperCase();
if (/^[A-Z0-9]{5}$/.test(hashCode)) {
  el.code.value = hashCode;
  el.code.focus();
}

const profile = () => ({ name: el.name.value.trim() || 'Агент', team: null, role: 'operative' });

function rememberName() {
  localStorage.setItem('cnpix:name', el.name.value.trim());
}

function secondsToMinutes(sec, fallback) {
  const n = Number(sec);
  if (!n) return fallback;
  const min = Math.round((n / 60) * 10) / 10;
  return Math.min(10, Math.max(0.5, min));
}

function readTimerSettings(onEl, clueEl, guessEl) {
  return {
    timerOn: onEl.checked,
    clueMin: clueEl.value,
    guessMin: guessEl.value
  };
}

function readHomeSettings() {
  return normalizeSettings({
    ...readTimerSettings(el.homeTimerOn, el.homeTimerClue, el.homeTimerGuess),
    botOn: !!(el.homeBotOn && el.homeBotOn.checked),
    botClueSec: el.homeBotClue.value,
    botGuessSec: el.homeBotGuess.value,
    botRisk: el.homeBotRisk ? el.homeBotRisk.value : 50
  });
}

function rememberTimer() {
  localStorage.setItem('cnpix:timer', JSON.stringify(readHomeSettings()));
}

function rememberPack() {
  localStorage.setItem('cnpix:pack', el.pack.value);
}

let adultPackOk = false;
function confirmAdult(packId) {
  const pack = getPack(packId);
  if (!pack.adult || adultPackOk) return true;
  adultPackOk = confirm('Колода «Слова 18+» только для взрослых. Продолжить?');
  return adultPackOk;
}

function paintPackNote(node, pack) {
  node.textContent = pack.adult ? 'Только для взрослых.' : pack.note;
  node.classList.toggle('is-adult', pack.adult);
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

el.create.addEventListener('click', () => {
  if (!confirmAdult(el.pack.value)) return;
  withBusy(el.create, async () => {
    rememberName();
    rememberTimer();
    const code = await room.createOnline(
      profile(),
      el.mode.value,
      readHomeSettings(),
      el.pack.value
    );
    location.hash = code;
    showGame();
    el.status.textContent = 'Комната открыта — ждём игроков';
    rememberPack();
  });
});

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
  if (!confirmAdult(el.pack.value)) return;
  rememberName();
  rememberTimer();
  rememberPack();
  room.startLocal(
    profile(),
    el.mode.value,
    readHomeSettings(),
    el.pack.value
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

let clueCountManual = false;
let clueCountFor = '';

el.clueCount.addEventListener('input', () => {
  clueCountManual = true;
});

el.clueForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const word = el.clueWord.value.trim();
  if (!word) return;
  if (/\s/.test(word)) {
    toast('Подсказка — одно слово');
    return;
  }
  room.dispatch({ t: 'clue', word, count: Number(el.clueCount.value) });
  el.clueWord.value = '';
  el.clueCount.value = '1';
  clueCountManual = false;
});

el.endTurn.addEventListener('click', () => room.dispatch({ t: 'endTurn' }));

el.begin.addEventListener('click', () => room.dispatch({ t: 'begin' }));

function currentPackId() {
  return (room.view && room.view.pack) || room.packId;
}

function dispatchNewGame(packId) {
  if (!confirmAdult(packId)) return false;
  const view = room.view;
  room.dispatch({
    t: 'newGame',
    mode: (view && view.mode) || room.boardMode,
    pack: packId
  });
  localStorage.setItem('cnpix:pack', packId);
  el.newGameDialog.hidden = true;
  el.result.hidden = true;
  resultShownFor = null;
  return true;
}

const startNew = () => {
  const inLobby = room.view && room.view.phase === 'lobby';
  if (inLobby) {
    if (!confirm('Перемешать поле? Партия ещё не началась.')) return;
    dispatchNewGame(currentPackId());
    return;
  }
  if (!canEditSettings()) {
    if (!confirm('Начать новую партию? Таймер снова включится только после кнопки «Начать игру».')) return;
    dispatchNewGame(currentPackId());
    return;
  }
  el.newGamePack.value = currentPackId();
  paintPackNote(el.newGamePackNote, getPack(el.newGamePack.value));
  el.newGameDialog.hidden = false;
};
el.newGame.addEventListener('click', startNew);
el.newGame2.addEventListener('click', startNew);
el.newGameCancel.addEventListener('click', () => {
  el.newGameDialog.hidden = true;
});
el.newGameConfirm.addEventListener('click', () => dispatchNewGame(el.newGamePack.value));
el.newGamePack.addEventListener('change', () => paintPackNote(el.newGamePackNote, getPack(el.newGamePack.value)));
el.closeResult.addEventListener('click', () => room.dispatch({ t: 'review' }));

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
  renderLobby(view);
  renderClue(view);
  renderClueHistory(view);
  renderSeat(view);
  renderBot(view);
  renderPlayers();
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
  fitWordFaces();
}

/** Длинное слово остаётся одной строкой: шрифт уменьшается, буква не переносится. */
function fitWordFaces() {
  for (const face of el.board.querySelectorAll('.word-face')) {
    const art = face.parentElement;
    if (!art) continue;
    const style = getComputedStyle(art);
    const max = art.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    if (max <= 0) continue;
    face.style.fontSize = '';
    let hi = parseFloat(getComputedStyle(face).fontSize);
    if (!hi) continue;
    face.style.fontSize = `${hi}px`;
    if (face.scrollWidth <= max) continue;
    let lo = 8;
    while (hi - lo > 0.5) {
      const mid = (hi + lo) / 2;
      face.style.fontSize = `${mid}px`;
      if (face.scrollWidth > max) hi = mid;
      else lo = mid;
    }
    face.style.fontSize = `${lo}px`;
  }
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
  const showFaces = view.phase !== 'lobby';
  const signature = `${view.seed}:${view.cols}:${view.pack || ''}:${showFaces ? 'play' : 'wait'}`;
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
      if (showFaces && card.face) btn.append(renderFace(card.face));

      const dot = document.createElement('span');
      dot.className = 'hint-dot';
      const veil = document.createElement('span');
      veil.className = 'veil';
      const marks = document.createElement('div');
      marks.className = 'marks';
      btn.append(dot, veil, marks);

      btn.addEventListener('click', () => {
        if (!btn.classList.contains('is-clickable')) return;
        const view = room.view;
        room.dispatch(view && canClue(view) ? { t: 'highlight', index: i } : { t: 'pick', index: i });
      });
      el.board.append(btn);
      return btn;
    });
  }

  const guessing = canGuess(view);
  const highlighting = canClue(view);
  const marks = view.marks || [];
  view.cards.forEach((card, i) => {
    const btn = cardEls[i];
    if (!btn) return;
    btn.className = 'card';
    if (!showFaces) {
      btn.classList.add('is-concealed');
      btn.setAttribute('aria-label', `Карточка ${i + 1} скрыта до старта`);
      return;
    }
    if (card.key) {
      btn.classList.add(card.revealed ? `key-${card.key}` : `hint-${card.key}`);
    }
    if (card.revealed) {
      btn.classList.add('is-revealed');
      btn.querySelector('.veil').textContent =
        card.key === 'assassin' ? '💀' : card.key === 'neutral' ? '🧍' : '🕵️';
    } else {
      btn.querySelector('.veil').textContent = '';
      if (guessing || highlighting) btn.classList.add('is-clickable');
    }

    const mine = marks.find((m) => m.index === i && m.id === room.me.id);
    if (mine && (guessing || highlighting) && !card.revealed) btn.classList.add('is-armed');

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

    const faceName = card.face && card.face.kind === 'word' ? ` «${card.face.text}»` : '';
    btn.setAttribute(
      'aria-label',
      card.revealed
        ? `Карточка ${i + 1}${faceName}, открыта`
        : mine && highlighting
        ? `Карточка ${i + 1}${faceName}, ваша метка — повтор снимет её`
        : mine
        ? `Карточка ${i + 1}${faceName}, ваша метка — второй клик откроет`
        : `Карточка ${i + 1}${faceName}`
    );
  });
}

function renderScore(view) {
  el.scoreRed.textContent = view.counts.red;
  el.scoreBlue.textContent = view.counts.blue;
  el.scoreRed.parentElement.setAttribute('aria-label', `Красным осталось угадать ${view.counts.red}`);
  el.scoreBlue.parentElement.setAttribute('aria-label', `Синим осталось угадать ${view.counts.blue}`);

  el.turn.className = 'turn-banner';
  if (view.phase === 'lobby') {
    el.turn.classList.add('is-lobby');
    el.turnText.textContent = 'Игра ещё не началась';
    paintTimer(view);
    return;
  }
  if (view.phase === 'over') {
    el.turn.classList.add('is-over');
    el.turnText.textContent = `Победа ${TEAM[view.winner].gen}`;
    paintTimer(view);
    return;
  }
  el.turn.classList.add(view.turn === 'red' ? 'is-red' : 'is-blue');
  const bonus =
    view.phase === 'clue' && view.firstClueBonus && view.settings && view.settings.timerOn ? ' (+2 мин)' : '';
  el.turnText.textContent =
    view.phase === 'clue'
      ? `Ход ${TEAM[view.turn].gen}: капитан думает${bonus}`
      : `Ход ${TEAM[view.turn].gen}: угадывают`;
  paintTimer(view);
}

function canBegin() {
  return room.mode === 'local' || room.mode === 'host';
}

function renderLobby(view) {
  const lobby = view.phase === 'lobby';
  el.lobbyBar.hidden = !lobby;
  el.newGame.textContent = lobby ? 'Перемешать' : 'Новая игра';
  if (!lobby) return;
  const starter = canBegin();
  el.begin.hidden = !starter;
  const bonus =
    view.settings && view.settings.timerOn
      ? ` Первому капитану на первую подсказку добавляются ${FIRST_CLUE_BONUS_SEC / 60} минуты.`
      : '';
  el.lobbyText.textContent = starter
    ? `Выберите команды и роли, затем нажмите «Начать игру». Карточки и таймер — только после старта.${bonus}`
    : `Выберите команду и роль. Карточки откроются, когда создатель комнаты нажмёт «Начать игру».${bonus}`;
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

  if (view.phase === 'lobby') {
    el.clueInfo.textContent = canBegin()
      ? 'Подсказки откроются после старта партии.'
      : 'Ждём, пока создатель комнаты начнёт партию.';
  } else if (view.phase === 'over') {
    el.clueInfo.textContent = 'Партия окончена.';
  } else if (showForm) {
    const bonus = view.firstClueBonus && view.settings && view.settings.timerOn ? ' На эту подсказку у вас на 2 минуты больше.' : '';
    el.clueInfo.textContent = `Отметьте карточки на поле — число подставится само, его можно изменить.${bonus}`;
    syncClueCount(view);
  } else if (view.phase === 'clue') {
    el.clueInfo.textContent =
      view.firstClueBonus && view.settings && view.settings.timerOn
        ? `Капитан ${TEAM[view.turn].gen} придумывает первую подсказку — у него на 2 минуты больше.`
        : `Капитан ${TEAM[view.turn].gen} придумывает подсказку…`;
  } else if (canGuess(view)) {
    el.clueInfo.textContent = 'Клик ставит метку — можно отметить несколько. Повтор по той же карточке открывает её.';
  } else {
    el.clueInfo.textContent = `Угадывают ${TEAM[view.turn].nom}.`;
  }

  el.endTurn.hidden = !canGuess(view);
}

function syncClueCount(view) {
  const stamp = `${view.seed}:${view.turn}:${(view.clues || []).length}`;
  if (stamp !== clueCountFor) {
    clueCountFor = stamp;
    clueCountManual = false;
  }
  if (clueCountManual || document.activeElement === el.clueCount) return;
  const n = (view.marks || []).filter((m) => m.id === room.me.id).length;
  el.clueCount.value = n > 0 ? String(Math.min(9, n)) : '1';
}

function renderClueHistory(view) {
  const clues = view.clues || [];
  el.clueHistory.replaceChildren();
  el.clueHistory.hidden = clues.length === 0;
  el.clueHistoryEmpty.hidden = clues.length > 0;
  clues.forEach((c, i) => {
    const li = document.createElement('li');
    li.className = c.team === 'red' ? 'is-red' : 'is-blue';
    const current = view.clue && i === clues.length - 1 && view.clue.word === c.word && view.clue.team === c.team;
    if (current) li.classList.add('is-current');
    const word = document.createElement('span');
    word.className = 'word';
    word.textContent = c.word;
    const score = document.createElement('span');
    score.className = 'score';
    const announced = c.count ? String(c.count) : '∞';
    const correct = String(c.correct || 0);
    score.title = `Угадано верно: ${correct} из ${announced}`;
    const hit = document.createElement('span');
    hit.className = 'hit';
    hit.textContent = correct;
    const of = document.createElement('span');
    of.className = 'of';
    of.textContent = '/';
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = announced;
    score.append(hit, of, num);
    li.append(word, score);
    el.clueHistory.append(li);
  });
  if (clues.length) el.clueHistory.scrollTop = el.clueHistory.scrollHeight;
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

let botTeam = 'red';
let botRole = 'spymaster';

function paintBotChoices() {
  el.botPanel.querySelectorAll('[data-bot-team]').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.botTeam === botTeam);
  });
  el.botPanel.querySelectorAll('[data-bot-role]').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.botRole === botRole);
  });
}

el.botPanel.addEventListener('click', (e) => {
  const teamBtn = e.target.closest('[data-bot-team]');
  if (teamBtn) {
    botTeam = teamBtn.dataset.botTeam;
    paintBotChoices();
    return;
  }
  const roleBtn = e.target.closest('[data-bot-role]');
  if (roleBtn) {
    botRole = roleBtn.dataset.botRole;
    paintBotChoices();
    return;
  }
  const remove = e.target.closest('[data-bot-remove]');
  if (remove) room.dispatch({ t: 'removeBot', id: remove.dataset.botRemove });
});

el.addBot.addEventListener('click', () => {
  room.dispatch({ t: 'addBot', team: botTeam, role: botRole });
});

function renderBot(view) {
  const settings = (view && view.settings) || room.settings;
  const show = canEditSettings() && !!(settings && settings.botOn);
  el.botPanel.hidden = !show;
  if (!show) return;
  const pack = getPack((view && view.pack) || room.packId);
  const ready = pack.kind === 'word' || pack.id === 'classic';
  el.addBot.disabled = !ready;
  el.botNote.textContent = ready
    ? 'Ходит на этом устройстве. Для слов и классических картинок.'
    : 'Для этой колоды бот пока не умеет.';
  paintBotChoices();
  el.botList.replaceChildren();
  for (const p of room.players) {
    if (!p.bot) continue;
    const li = document.createElement('li');
    const team = p.team === 'red' ? 'красные' : 'синие';
    const roleName = p.role === 'spymaster' ? 'капитан' : 'оперативник';
    const label = document.createElement('span');
    label.textContent = `Бот · ${roleName} · ${team}`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--small btn--ghost';
    btn.dataset.botRemove = p.id;
    btn.textContent = 'Убрать';
    li.append(label, btn);
    el.botList.append(li);
  }
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
    const teamName = p.team === 'red' ? 'красные' : 'синие';
    role.textContent = p.bot
      ? `${p.role === 'spymaster' ? 'капитан' : 'оперативник'} · ${teamName}`
      : p.team
        ? p.role === 'spymaster'
          ? 'капитан'
          : 'оперативник'
        : 'зритель';
    li.append(tint, name, role);
    el.players.append(li);
  }
}

function renderResult(view) {
  if (view.phase !== 'over') {
    resultShownFor = null;
    el.result.hidden = true;
    return;
  }
  if (view.review) {
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
let clockStamp = '';
let timerTick = null;

function paintTimer(view) {
  const endsAt = view.timer && view.timer.endsAt;
  const sample = view.serverNow || 0;
  // serverNow приходит вместе со снимком состояния и больше не меняется,
  // пока не придёт следующий. Если вычитать его на каждом кадре, прошедшее
  // время сокращается ровно на ту же величину — цифры на экране замирают.
  const stamp = `${sample}:${endsAt || 0}`;
  if (stamp !== clockStamp) {
    clockStamp = stamp;
    clockOffset = sample ? sample - Date.now() : 0;
  }
  const on = !!(view.settings && view.settings.timerOn) && view.phase !== 'over' && view.phase !== 'lobby' && endsAt;
  el.timer.hidden = !on;
  if (!on) {
    el.timer.classList.remove('is-low');
    el.timer.title = '';
    return;
  }
  const left = Math.max(0, endsAt - (Date.now() + clockOffset));
  const sec = Math.ceil(left / 1000);
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, '0');
  el.timer.textContent = `${m}:${s}`;
  el.timer.classList.toggle('is-low', sec <= 10);
  el.timer.title =
    view.phase === 'clue' && view.firstClueBonus ? 'Время на подсказку плюс 2 минуты первому капитану' : '';
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
  clockStamp = '';
  clockOffset = 0;
}

function canEditSettings() {
  return room.mode === 'local' || room.mode === 'host';
}

function renderTimerSettings(view) {
  const s = view.settings || room.settings;
  const writable = canEditSettings();
  if (document.activeElement !== el.gameTimerOn) el.gameTimerOn.checked = !!s.timerOn;
  if (document.activeElement !== el.gameTimerClue) el.gameTimerClue.value = secondsToMinutes(s.clueSec, 3);
  if (document.activeElement !== el.gameTimerGuess) el.gameTimerGuess.value = secondsToMinutes(s.guessSec, 1.5);
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

function fillPackSelect(select) {
  select.replaceChildren();
  for (const pack of PACK_LIST) {
    const opt = document.createElement('option');
    opt.value = pack.id;
    opt.textContent = pack.adult ? `${pack.title} — ${pack.note}` : pack.title;
    select.append(opt);
  }
}

fillPackSelect(el.pack);
fillPackSelect(el.newGamePack);
const savedPack = localStorage.getItem('cnpix:pack');
if (savedPack) el.pack.value = getPack(savedPack).id;
paintPackNote(el.packNoteHome, getPack(el.pack.value));
el.pack.addEventListener('change', () => paintPackNote(el.packNoteHome, getPack(el.pack.value)));

el.sidePanel.addEventListener('click', (e) => {
  const toggle = e.target.closest('.panel__toggle');
  if (!toggle) return;
  const block = toggle.closest('.panel__block');
  const collapsed = block.classList.toggle('is-collapsed');
  toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
});

// Подсказка по размерам поля в меню собирается из правил, чтобы не дублировать цифры.
for (const opt of el.mode.options) {
  const m = MODES[opt.value];
  if (m) opt.title = `${m.first}/${m.second} агентов, ${m.neutral} нейтральных, 1 убийца`;
}
