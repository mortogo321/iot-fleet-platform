import type { PlatformStats, WsEvent } from '@iot/shared';
import type { Server, ServerWebSocket } from 'bun';
import { logger } from '../log';
import { metrics } from '../metrics';

const TOPIC = 'events';

export interface WsHub {
  websocket: {
    open(ws: ServerWebSocket<undefined>): void;
    close(ws: ServerWebSocket<undefined>): void;
    message(ws: ServerWebSocket<undefined>, message: string | Buffer): void;
  };
  /** Bun.serve only hands back the Server instance after it starts listening. */
  attach(server: Server<undefined>): void;
  publish(event: WsEvent): void;
  clientCount(): number;
  /** Starts the periodic `stats` broadcast; returns a stop function. */
  startStatsLoop(
    getStats: () => PlatformStats | Promise<PlatformStats>,
    intervalMs?: number,
  ): () => void;
}

export function createWsHub(): WsHub {
  let server: Server<undefined> | undefined;

  function clientCount(): number {
    return server?.subscriberCount(TOPIC) ?? 0;
  }

  function publish(event: WsEvent): void {
    server?.publish(TOPIC, JSON.stringify(event));
  }

  return {
    websocket: {
      open(ws) {
        ws.subscribe(TOPIC);
        metrics.wsClients.set(clientCount());
      },
      close(ws) {
        ws.unsubscribe(TOPIC);
        metrics.wsClients.set(clientCount());
      },
      message() {
        // Clients are not expected to send data; nothing to do.
      },
    },
    attach(s) {
      server = s;
    },
    publish,
    clientCount,
    startStatsLoop(getStats, intervalMs = 5000) {
      const timer = setInterval(() => {
        Promise.resolve(getStats())
          .then((stats) => publish({ type: 'stats', stats }))
          .catch((err: unknown) => logger.error('stats loop failed', err));
      }, intervalMs);
      timer.unref?.();
      return () => clearInterval(timer);
    },
  };
}
