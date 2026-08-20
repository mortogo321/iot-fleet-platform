import type { WsEvent } from '@iot/shared';
import { useEffect, useRef, useState } from 'react';

export type WsStatus = 'connecting' | 'open' | 'reconnecting';

type EventListener = (event: WsEvent) => void;
type StatusListener = (status: WsStatus) => void;

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

/** Same-origin WS URL: dev goes through the Vite proxy, prod hits the server directly. */
function socketUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  return `${proto}${location.host}/ws`;
}

/**
 * Singleton WS client: one connection for the whole app, exponential-backoff
 * reconnect, fan-out to any number of subscribers via `useWsEvent`/`useWsStatus`.
 */
class WsClient {
  status: WsStatus = 'connecting';
  private socket: WebSocket | null = null;
  private backoff = INITIAL_BACKOFF_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private readonly eventListeners = new Set<EventListener>();
  private readonly statusListeners = new Set<StatusListener>();

  start(): void {
    if (this.started) return;
    this.started = true;
    this.open();
  }

  private open(): void {
    this.setStatus(this.socket ? 'reconnecting' : 'connecting');
    const socket = new WebSocket(socketUrl());
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.backoff = INITIAL_BACKOFF_MS;
      this.setStatus('open');
    });
    socket.addEventListener('message', (ev) => {
      let parsed: WsEvent;
      try {
        parsed = JSON.parse(ev.data as string) as WsEvent;
      } catch {
        return; // ignore malformed frames
      }
      for (const listener of this.eventListeners) listener(parsed);
    });
    socket.addEventListener('close', () => {
      this.scheduleReconnect();
    });
    socket.addEventListener('error', () => {
      socket.close();
    });
  }

  private scheduleReconnect(): void {
    this.setStatus('reconnecting');
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, this.backoff);
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
  }

  private setStatus(status: WsStatus): void {
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }

  subscribe(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  subscribeStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }
}

export const wsClient = new WsClient();

/** Subscribe to every WS event with a stable effect (handler identity may change freely). */
export function useWsEvent(handler: EventListener): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => wsClient.subscribe((event) => handlerRef.current(event)), []);
}

export function useWsStatus(): WsStatus {
  const [status, setStatus] = useState(wsClient.status);
  useEffect(() => wsClient.subscribeStatus(setStatus), []);
  return status;
}
