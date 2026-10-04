// Транспорт для онлайн-игры.
// GitHub Pages отдаёт только статику, поэтому сервера у нас нет:
// игроки соединяются напрямую по WebRTC через PeerJS (публичный брокер
// используется только для «рукопожатия»). Создатель комнаты — хост,
// он держит настоящее состояние игры, остальные шлют ему действия.

const PEERJS_URL = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
const ID_PREFIX = 'cnpix-v1-';

let peerLibPromise = null;

export function loadPeerJs() {
  if (window.Peer) return Promise.resolve(window.Peer);
  if (!peerLibPromise) {
    peerLibPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PEERJS_URL;
      s.onload = () => (window.Peer ? resolve(window.Peer) : reject(new Error('PeerJS не загрузился')));
      s.onerror = () => reject(new Error('Не удалось загрузить PeerJS (проверь интернет)'));
      document.head.appendChild(s);
    });
  }
  return peerLibPromise;
}

const peerOptions = () => ({
  debug: 0,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' }
    ]
  }
});

function once(peer, event, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Таймаут: ${label}`)), timeoutMs);
    peer.once(event, (payload) => {
      clearTimeout(t);
      resolve(payload);
    });
    peer.once('error', (err) => {
      clearTimeout(t);
      reject(err);
    });
  });
}

/** Хост: принимает подключения, рассылает персональные состояния. */
export class HostTransport {
  constructor({ onAction, onPeersChanged, onStatus }) {
    this.onAction = onAction;
    this.onPeersChanged = onPeersChanged;
    this.onStatus = onStatus || (() => {});
    this.conns = new Map(); // peerId -> DataConnection
    this.peer = null;
    this.room = null;
  }

  async start(room) {
    const Peer = await loadPeerJs();
    this.room = room;
    this.peer = new Peer(ID_PREFIX + room, peerOptions());
    await once(this.peer, 'open', 15000, 'не удалось открыть комнату');

    this.peer.on('connection', (conn) => {
      conn.on('open', () => {
        this.conns.set(conn.peer, conn);
        this.onPeersChanged();
        this.onStatus(`Подключился игрок (${this.conns.size} на связи)`);
      });
      conn.on('data', (msg) => {
        if (msg && typeof msg === 'object') this.onAction(msg, conn.peer);
      });
      const drop = () => {
        if (this.conns.delete(conn.peer)) {
          this.onAction({ t: 'leave' }, conn.peer);
          this.onPeersChanged();
        }
      };
      conn.on('close', drop);
      conn.on('error', drop);
    });

    this.peer.on('disconnected', () => {
      if (!this.peer.destroyed) this.peer.reconnect();
    });

    // После успешного старта ошибки брокера не должны валить комнату:
    // уже установленные WebRTC-соединения продолжают работать.
    this.peer.on('error', (err) => this.onStatus(`Сеть: ${err.type || err.message}`));

    return room;
  }

  sendTo(peerId, msg) {
    const conn = this.conns.get(peerId);
    if (conn && conn.open) conn.send(msg);
  }

  peerIds() {
    return [...this.conns.keys()];
  }

  destroy() {
    this.conns.forEach((c) => c.close());
    this.conns.clear();
    if (this.peer) this.peer.destroy();
  }
}

/** Клиент: одно соединение с хостом. */
export class ClientTransport {
  constructor({ onMessage, onStatus, onClosed }) {
    this.onMessage = onMessage;
    this.onStatus = onStatus || (() => {});
    this.onClosed = onClosed || (() => {});
    this.peer = null;
    this.conn = null;
  }

  async connect(room) {
    const Peer = await loadPeerJs();
    this.peer = new Peer(null, peerOptions());
    await once(this.peer, 'open', 15000, 'нет связи с сигнальным сервером');

    this.conn = this.peer.connect(ID_PREFIX + room, { reliable: true });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Комната не отвечает — проверь код')), 15000);
      this.conn.on('open', () => {
        clearTimeout(t);
        resolve();
      });
      this.conn.on('error', (e) => {
        clearTimeout(t);
        reject(e);
      });
      this.peer.on('error', (e) => {
        clearTimeout(t);
        reject(e.type === 'peer-unavailable' ? new Error('Комната не найдена') : e);
      });
    });

    this.conn.on('data', (msg) => {
      if (msg && typeof msg === 'object') this.onMessage(msg);
    });
    this.conn.on('close', () => this.onClosed());
  }

  send(msg) {
    if (this.conn && this.conn.open) this.conn.send(msg);
  }

  destroy() {
    if (this.conn) this.conn.close();
    if (this.peer) this.peer.destroy();
  }
}
