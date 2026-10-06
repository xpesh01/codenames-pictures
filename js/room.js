// Склейка правил, игроков и транспорта.
// Хост — единственный источник правды: он применяет действия и рассылает
// каждому игроку его персональный срез состояния.

import { createGame, giveClue, revealCard, endTurn, viewFor, MODES, setMark, toggleMark, expireTurn, startMatch, normalizeSettings, playerColor, playerInitial, FIRST_CLUE_BONUS_SEC } from './game.js';
import { getPack, resolvePackId } from './packs.js';
import { HostTransport, ClientTransport } from './net.js';
import { randomCode } from './rng.js';
import { chooseClue, chooseGuess, choosePictureClue, choosePictureGuess, ensurePictureBot, ensureVectors, pictureFile } from './bot.js';

const LOG_TAIL = 40;
const SAVE_KEY = (room) => `cnpix:save:${room}`;

function guessesSinceClue(state, team) {
  let count = 0;
  const log = state.log || [];
  for (let i = log.length - 1; i >= 0; i--) {
    const entry = log[i];
    if (entry.kind === 'clue') break;
    if (entry.kind === 'reveal' && entry.team === team) count++;
  }
  return count;
}

const makePlayer = (id, profile = {}) => ({
  id,
  name: (profile.name || 'Игрок').slice(0, 20),
  team: profile.team === 'red' || profile.team === 'blue' ? profile.team : null,
  role: profile.role === 'spymaster' ? 'spymaster' : 'operative'
});

export class Room {
  constructor({ onRender, onStatus, onToast }) {
    this.onRender = onRender;
    this.onStatus = onStatus || (() => {});
    this.onToast = onToast || (() => {});

    this.mode = null; // 'local' | 'host' | 'client'
    this.code = null;
    this.state = null;
    this.players = [];
    this.me = null;
    this.view = null;
    this.transport = null;
    this.boardMode = 'pictures';
    this.packId = 'classic';
    this.localReveal = false; // в офлайне: показывать ключ
    this.settings = normalizeSettings();
    this._timerId = null;
    this._armedFor = '';
    this._botTimer = null;
  }

  applySettings(raw) {
    this.settings = normalizeSettings({ ...this.settings, ...raw });
  }

  // ---------- запуск ----------

  startLocal(profile, boardMode = 'pictures', settings, packId = 'classic') {
    this.mode = 'local';
    this.code = null;
    this.boardMode = boardMode;
    this.packId = getPack(packId).id;
    if (settings) this.applySettings(settings);
    this.me = makePlayer('local', profile);
    this.players = [this.me];
    this.state = createGame(randomCode(8), boardMode, this.packId);
    this.armTimer(true);
    this.render();
  }

  async createOnline(profile, boardMode = 'pictures', settings, packId = 'classic') {
    this.mode = 'host';
    this.boardMode = boardMode;
    this.packId = getPack(packId).id;
    if (settings) this.applySettings(settings);
    this.me = makePlayer('host', profile);
    this.players = [this.me];
    this.state = createGame(randomCode(8), boardMode, this.packId);

    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = randomCode(5);
      const transport = new HostTransport({
        onAction: (msg, peerId) => this.handleAction(msg, peerId),
        onPeersChanged: () => this.render(),
        onStatus: (s) => this.onStatus(s)
      });
      try {
        await transport.start(code);
        this.transport = transport;
        this.code = code;
        this.armTimer(true);
        this.save();
        this.render();
        return code;
      } catch (err) {
        transport.destroy();
        lastErr = err;
        // Код уже занят на брокере — пробуем другой, остальные ошибки не лечатся повтором.
        if (!err || err.type !== 'unavailable-id') break;
      }
    }
    throw lastErr || new Error('Не удалось создать комнату');
  }

  async joinOnline(code, profile) {
    this.mode = 'client';
    this.code = String(code || '').trim().toUpperCase();
    this.me = makePlayer('me', profile);

    this.transport = new ClientTransport({
      onMessage: (msg) => this.handleHostMessage(msg),
      onStatus: (s) => this.onStatus(s),
      onClosed: () => {
        this.onStatus('Связь с хостом потеряна');
        this.onToast('Хост отключился. Попробуйте переподключиться.');
      }
    });

    await this.transport.connect(this.code);
    this.transport.send({ t: 'hello', name: this.me.name, team: this.me.team, role: this.me.role });
    this.onStatus('В комнате ' + this.code);
  }

  leave() {
    clearTimeout(this._timerId);
    clearTimeout(this._botTimer);
    this._timerId = null;
    this._botTimer = null;
    if (this.transport) this.transport.destroy();
    this.transport = null;
    this.mode = null;
    this.state = null;
    this.view = null;
    this.players = [];
  }

  // ---------- действия игрока ----------

  /** Вызывается из UI. У клиента уходит хосту, у хоста применяется сразу. */
  dispatch(action) {
    if (this.mode === 'client') {
      this.transport.send(action);
      return;
    }
    this.handleAction(action, this.me.id);
  }

  handleAction(msg, playerId) {
    if (this.mode === 'client') return;
    const p = this.playerById(playerId);
    const before = this.phaseStamp();
    let changed = false;

    switch (msg.t) {
      case 'hello': {
        if (!p) this.players.push(makePlayer(playerId, msg));
        changed = true;
        break;
      }
      case 'leave': {
        this.players = this.players.filter((x) => x.id !== playerId);
        if (this.state?.marks) delete this.state.marks[playerId];
        changed = true;
        break;
      }
      case 'seat': {
        if (!p) break;
        if (msg.team === 'red' || msg.team === 'blue' || msg.team === null) p.team = msg.team;
        if (msg.role === 'spymaster' || msg.role === 'operative') p.role = msg.role;
        if (msg.name) p.name = String(msg.name).slice(0, 20);
        changed = true;
        break;
      }
      case 'clue': {
        const team = p?.bot ? p.team : this.actingTeam(p);
        if (!team) break;
        if (p?.bot) {
          if (p.role !== 'spymaster' || p.team !== this.state.turn) break;
        } else if (this.mode !== 'local' && p.role !== 'spymaster') break;
        if (!giveClue(this.state, team, msg.word, msg.count)) return;
        delete this.state.marks[playerId];
        changed = true;
        break;
      }
      case 'highlight': {
        if (this.mode !== 'local' && (!p || p.role !== 'spymaster')) break;
        const team = this.actingTeam(p);
        if (!team || this.state.turn !== team) break;
        if (!toggleMark(this.state, playerId, Number(msg.index))) return;
        changed = true;
        break;
      }
      case 'pick': {
        const team = this.actingTeam(p);
        if (!team) break;
        if (this.mode !== 'local' && p.role !== 'operative') break;
        const idx = Number(msg.index);
        const result = setMark(this.state, playerId, idx);
        if (result === 'ready') {
          if (!revealCard(this.state, team, idx)) return;
        } else if (result !== 'tagged') {
          return;
        }
        changed = true;
        break;
      }
      case 'endTurn': {
        const team = p?.bot ? p.team : this.actingTeam(p);
        if (!team) break;
        if (p?.bot) {
          if (p.role !== 'operative' || p.team !== this.state.turn) break;
        } else if (this.mode !== 'local' && p.role !== 'operative') break;
        if (!endTurn(this.state, team)) return;
        changed = true;
        break;
      }
      case 'botReveal': {
        if (!p?.bot || p.role !== 'operative' || p.team !== this.state.turn) break;
        if (this.humanOperativeBeside(p.team)) break;
        if (!revealCard(this.state, p.team, Number(msg.index))) return;
        changed = true;
        break;
      }
      case 'botHint': {
        if (!p?.bot || p.role !== 'operative' || p.team !== this.state.turn) break;
        if (!this.humanOperativeBeside(p.team) || this.state.phase !== 'guess') break;
        const index = Number(msg.index);
        const card = this.state.cards[index];
        if (!card || card.revealed) break;
        const cur = this.state.marks[p.id];
        if (Array.isArray(cur) && cur.length === 1 && cur[0] === index) break;
        this.state.marks[p.id] = [index];
        this.state.version++;
        changed = true;
        break;
      }
      case 'addBot': {
        if (!this.isAuthority(playerId)) break;
        const team = msg.team === 'red' || msg.team === 'blue' ? msg.team : null;
        const role = msg.role === 'spymaster' || msg.role === 'operative' ? msg.role : null;
        if (!team || !role) break;
        const id = `bot:${team}:${role}`;
        if (this.players.some((x) => x.id === id)) {
          this.onToast('Такой бот уже в игре');
          break;
        }
        this.players.push({ id, name: 'Бот', team, role, bot: true });
        ensureVectors().catch(() => this.onToast('Не удалось загрузить слова бота'));
        changed = true;
        break;
      }
      case 'removeBot': {
        if (!this.isAuthority(playerId)) break;
        const id = String(msg.id || '');
        if (!this.players.some((x) => x.bot && x.id === id)) break;
        this.players = this.players.filter((x) => x.id !== id);
        if (this.state?.marks) delete this.state.marks[id];
        changed = true;
        break;
      }
      case 'timeout': {
        // Таймер тикает только у хоста/локальной партии — гости не могут его форсировать.
        if (playerId !== this.me.id) return;
        if (!this.state.timer?.endsAt || Date.now() + 400 < this.state.timer.endsAt) return;
        if (!expireTurn(this.state)) return;
        changed = true;
        break;
      }
      case 'begin': {
        if (this.mode === 'host' && playerId !== this.me.id) return;
        if (!startMatch(this.state)) return;
        const entry = this.state.log[this.state.log.length - 1];
        if (entry && entry.kind === 'start') entry.bonus = !!this.settings.timerOn;
        changed = true;
        break;
      }
      case 'settings': {
        if (this.mode === 'host' && playerId !== this.me.id) return;
        this.applySettings(msg);
        changed = true;
        break;
      }
      case 'newGame': {
        const boardMode = MODES[msg.mode] ? msg.mode : this.boardMode;
        const packId = resolvePackId(msg.pack) || this.packId;
        this.boardMode = boardMode;
        this.packId = packId;
        this.state = createGame(randomCode(8), boardMode, packId);
        changed = true;
        break;
      }
      case 'localReveal': {
        this.localReveal = !!msg.value;
        changed = true;
        break;
      }
      case 'review': {
        if (!this.state || this.state.phase !== 'over') break;
        if (this.mode === 'local') this.localReveal = true;
        if (!this.state.review) {
          this.state.review = true;
          this.state.version++;
        }
        changed = true;
        break;
      }
      default:
        return;
    }

    if (!changed) return;
    this.armTimer(this.phaseStamp() !== before || msg.t === 'settings' || msg.t === 'newGame');
    this.save();
    this.render();
    this.broadcast();
    this.scheduleBot();
  }

  isAuthority(playerId) {
    return (this.mode === 'host' || this.mode === 'local') && playerId === this.me?.id;
  }

  /** Бот, чей сейчас ход. Картинки — только колода с подписями. */
  currentBot() {
    const state = this.state;
    if (!state || (state.phase !== 'clue' && state.phase !== 'guess')) return null;
    const pack = getPack(this.packId);
    if (pack.kind !== 'word' && pack.id !== 'classic') return null;
    const role = state.phase === 'clue' ? 'spymaster' : 'operative';
    return this.players.find((p) => p.bot && p.team === state.turn && p.role === role) || null;
  }

  /** Живой оперативник этой команды сам открывает карты. На одном экране это человек за устройством. */
  humanOperativeBeside(team) {
    if (this.mode === 'local') return true;
    return this.players.some((p) => !p.bot && p.team === team && p.role === 'operative');
  }

  scheduleBot() {
    if (this.mode !== 'host' && this.mode !== 'local') return;
    clearTimeout(this._botTimer);
    this._botTimer = null;
    const bot = this.currentBot();
    if (!bot) return;
    const stamp = `${this.phaseStamp()}:${this.state.version}`;
    const botId = bot.id;
    const sec = bot.role === 'spymaster' ? this.settings.botClueSec : this.settings.botGuessSec;
    this._botTimer = setTimeout(() => {
      this._botTimer = null;
      this.runBot(botId, stamp);
    }, Math.max(0, Number(sec) || 0) * 1000);
  }

  async runBot(botId, stamp) {
    if (`${this.phaseStamp()}:${this.state?.version}` !== stamp) return;
    const picture = getPack(this.packId).id === 'classic';
    try {
      if (picture) await ensurePictureBot();
      else await ensureVectors();
    } catch (_) {
      this.onToast('Не удалось загрузить слова бота');
      return;
    }
    if (`${this.phaseStamp()}:${this.state?.version}` !== stamp) return;
    const bot = this.playerById(botId);
    if (!bot?.bot || bot.team !== this.state.turn) return;

    try {
      if (this.state.phase === 'clue' && bot.role === 'spymaster') {
        const clue = picture
          ? choosePictureClue({
              cards: this.state.cards.map((card) => ({
                file: pictureFile(card.face?.id),
                key: card.key,
                revealed: card.revealed
              })),
              team: bot.team
            })
          : chooseClue({
              cards: this.state.cards.map((card) => ({
                text: card.face?.text || '',
                key: card.key,
                revealed: card.revealed
              })),
              team: bot.team,
              packId: this.packId
            });
        if (`${this.phaseStamp()}:${this.state.version}` !== stamp || bot.team !== this.state.turn) return;
        if (!clue) {
          this.onToast('Бот не нашёл подсказку');
          return;
        }
        this.handleAction({ t: 'clue', word: clue.word, count: clue.count }, bot.id);
        return;
      }

      if (this.state.phase === 'guess' && bot.role === 'operative') {
        const cards = [];
        this.state.cards.forEach((card, index) => {
          if (card.revealed) return;
          if (picture) {
            if (card.face?.kind !== 'image') return;
            cards.push({ index, file: pictureFile(card.face.id) });
            return;
          }
          if (card.face?.kind !== 'word' || !card.face.text) return;
          cards.push({ index, text: card.face.text });
        });
        const decision = picture
          ? choosePictureGuess({
              cards,
              clue: this.state.clue?.word || '',
              announced: this.state.clue?.count || 0,
              guessesMade: guessesSinceClue(this.state, bot.team)
            })
          : chooseGuess({
              cards,
              clue: this.state.clue?.word || '',
              announced: this.state.clue?.count || 0,
              guessesMade: guessesSinceClue(this.state, bot.team)
            });
        if (`${this.phaseStamp()}:${this.state.version}` !== stamp || bot.team !== this.state.turn) return;
        if (this.humanOperativeBeside(bot.team)) {
          if (decision.type === 'reveal') this.handleAction({ t: 'botHint', index: decision.index }, bot.id);
          return;
        }
        if (decision.type === 'reveal') this.handleAction({ t: 'botReveal', index: decision.index }, bot.id);
        else this.handleAction({ t: 'endTurn' }, bot.id);
      }
    } catch (_) {
      this.onToast('Бот не смог походить');
    }
  }

  phaseStamp() {
    if (!this.state) return '';
    return `${this.state.phase}:${this.state.turn}:${this.state.clue ? this.state.clue.word : ''}`;
  }

  /** Запускает дедлайн текущего этапа. Клиенты считают остаток сами по endsAt. */
  armTimer(restart) {
    if (!this.state) return;
    if (!restart && this._armedFor === this.phaseStamp()) return;
    clearTimeout(this._timerId);
    this._timerId = null;
    this._armedFor = this.phaseStamp();

    if (this.state.phase === 'over' || this.state.phase === 'lobby' || !this.settings.timerOn) {
      this.state.timer = { endsAt: null, duration: 0, startedAt: null };
      return;
    }
    let sec = this.state.phase === 'clue' ? this.settings.clueSec : this.settings.guessSec;
    if (this.state.phase === 'clue' && this.state.firstClueBonus) sec += FIRST_CLUE_BONUS_SEC;
    const now = Date.now();
    this.state.timer = { endsAt: now + sec * 1000, duration: sec, startedAt: now };
    this._timerId = setTimeout(() => this.handleAction({ t: 'timeout' }, this.me.id), sec * 1000 + 40);
  }

  /** За какую команду действует игрок (в офлайне — всегда за ту, чей ход). */
  actingTeam(player) {
    if (this.mode === 'local') return this.state.turn;
    return player && player.team ? player.team : null;
  }

  playerById(id) {
    return this.players.find((p) => p.id === id) || null;
  }

  // ---------- синхронизация ----------

  isSpymasterView(player) {
    if (this.mode === 'local') return this.localReveal;
    return player.role === 'spymaster';
  }

  buildView(player) {
    const v = viewFor(this.state, this.isSpymasterView(player));
    v.log = v.log.slice(-LOG_TAIL);
    v.settings = this.settings;
    v.serverNow = Date.now();
    v.marks = [];
    for (const [id, indexes] of Object.entries(this.state.marks || {})) {
      const list = Array.isArray(indexes) ? indexes : [indexes];
      const p = this.playerById(id);
      // Метки капитана — черновик подсказки, их видит только он сам.
      if (p && p.role === 'spymaster' && player.id !== id) continue;
      const name = p?.name || 'Игрок';
      for (const index of list) {
        v.marks.push({
          id,
          index,
          name,
          initial: playerInitial(name),
          color: playerColor(id),
          team: p?.team || null
        });
      }
    }
    return v;
  }

  broadcast() {
    if (this.mode !== 'host' || !this.transport) return;
    for (const id of this.transport.peerIds()) {
      const p = this.playerById(id);
      if (!p) continue;
      this.transport.sendTo(id, {
        t: 'sync',
        view: this.buildView(p),
        players: this.publicPlayers(),
        you: { id: p.id, team: p.team, role: p.role, name: p.name },
        code: this.code
      });
    }
  }

  publicPlayers() {
    return this.players.map((p) => ({
      id: p.id,
      name: p.name,
      team: p.team,
      role: p.role,
      color: playerColor(p.id),
      bot: !!p.bot
    }));
  }

  handleHostMessage(msg) {
    if (msg.t === 'sync') {
      this.view = msg.view;
      this.players = msg.players;
      this.me = { ...this.me, ...msg.you };
      if (msg.view && msg.view.settings) this.settings = msg.view.settings;
      this.onRender();
    } else if (msg.t === 'toast') {
      this.onToast(msg.text);
    }
  }

  render() {
    if (this.mode === 'host' || this.mode === 'local') {
      this.view = this.buildView(this.me);
    }
    this.onRender();
  }

  // ---------- сохранение у хоста ----------

  save() {
    if (this.mode !== 'host' || !this.code) return;
    try {
      localStorage.setItem(SAVE_KEY(this.code), JSON.stringify({ state: this.state, at: Date.now() }));
    } catch (_) {
      /* переполнение хранилища — не критично */
    }
  }

  restore(code) {
    try {
      const raw = localStorage.getItem(SAVE_KEY(code));
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data.state || Date.now() - data.at > 12 * 3600 * 1000) return false;
      this.state = data.state;
      return true;
    } catch (_) {
      return false;
    }
  }
}
