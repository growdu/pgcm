import type { TickMessage } from '../types';

export type TickHandler = (msg: TickMessage) => void;

export class WSClient {
  private url: string;
  private ws: WebSocket | null = null;
  private handler: TickHandler | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoff = 1000;
  private alive = false;

  constructor(url = '/api/v1/ws') {
    this.url = url;
  }

  on(h: TickHandler) {
    this.handler = h;
  }

  connect() {
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const u = `${proto}://${location.host}${this.url}`;
    this.ws = new WebSocket(u);
    this.ws.onopen = () => {
      this.backoff = 1000;
      this.alive = true;
    };
    this.ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as TickMessage;
        if (msg.type === 'tick') this.handler?.(msg);
      } catch {}
    };
    this.ws.onerror = () => {};
    this.ws.onclose = () => {
      this.alive = false;
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.backoff = Math.min(this.backoff * 2, 30000);
      this.connect();
    }, this.backoff);
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.ws?.close();
    this.ws = null;
  }

  get isAlive() {
    return this.alive;
  }
}
