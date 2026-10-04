// Склейка правил, игроков и транспорта.
// Хост — единственный источник правды: он применяет действия и рассылает
// каждому игроку его персональный срез состояния.

import { createGame, giveClue, revealCard, endTurn, viewFor, MODES } from './game.js';
import { HostTransport, ClientTransport } from './net.js';
import { randomCode } from './rng.js';

const LOG_TAIL = 40;
const SAVE_KEY = (room) => `cnpix:save:${room}`;

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
    this.localReveal = false; // в офлайне: показывать ключ
  }

  // ---------- запуск ----------

  startLocal(profile, boardMode = 'pictures') {
    this.mode = 'local';
    this.code = null;
    this.boardMode = boardMode;
    this.me = makePlayer('local', profile);
    this.players = [this.me];
    this.state = createGame(randomCode(8), boardMode);
    this.render();
  }

  async createOnline(profile, boardMode = 'pictures') {
    this.mode = 'host';
    this.boardMode = boardMode;
    this.me = makePlayer('host', profile);
    this.players = [this.me];
    this.state = createGame(randomCode(8), boardMode);

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

    switch (msg.t) {
      case 'hello': {
        if (!p) this.players.push(makePlayer(playerId, msg));
        break;
      }
      case 'leave': {
        this.players = this.players.filter((x) => x.id !== playerId);
        break;
      }
      case 'seat': {
        if (!p) break;
        if (msg.team === 'red' || msg.team === 'blue' || msg.team === null) p.team = msg.team;
        if (msg.role === 'spymaster' || msg.role === 'operative') p.role = msg.role;
        if (msg.name) p.name = String(msg.name).slice(0, 20);
        break;
      }
      case 'clue': {
        const team = this.actingTeam(p);
        if (!team) break;
        if (this.mode !== 'local' && p.role !== 'spymaster') break;
        if (!giveClue(this.state, team, msg.word, msg.count)) return;
        break;
      }
      case 'reveal': {
        const team = this.actingTeam(p);
        if (!team) break;
        if (this.mode !== 'local' && p.role !== 'operative') break;
        if (!revealCard(this.state, team, msg.index)) return;
        break;
      }
      case 'endTurn': {
        const team = this.actingTeam(p);
        if (!team) break;
        if (this.mode !== 'local' && p.role !== 'operative') break;
        if (!endTurn(this.state, team)) return;
        break;
      }
      case 'newGame': {
        const boardMode = MODES[msg.mode] ? msg.mode : this.boardMode;
        this.boardMode = boardMode;
        this.state = createGame(randomCode(8), boardMode);
        break;
      }
      case 'localReveal': {
        this.localReveal = !!msg.value;
        break;
      }
      default:
        return;
    }

    this.save();
    this.render();
    this.broadcast();
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
    return this.players.map((p) => ({ id: p.id, name: p.name, team: p.team, role: p.role }));
  }

  handleHostMessage(msg) {
    if (msg.t === 'sync') {
      this.view = msg.view;
      this.players = msg.players;
      this.me = { ...this.me, ...msg.you };
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
