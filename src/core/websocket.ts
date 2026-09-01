import WebSocket from 'ws';
import { createLogger } from '../utils/logger';

const logger = createLogger('websocket');

export type WsMessageHandler = (data: any) => void;
export type WsCloseHandler = () => void;

export class WebSocketManager {
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private url: string = '';
  private token: string = '';
  private reconnectAttempts: number = 0;
  private maxReconnectDelay: number = 60000;
  private baseReconnectDelay: number = 5000;
  private heartbeatInterval: number = 30000;
  private messageHandlers: WsMessageHandler[] = [];
  private closeHandlers: WsCloseHandler[] = [];
  private seq: number | null = null;
  private isActive: boolean = false;

  connect(url: string, token: string): Promise<void> {
    this.url = url;
    this.token = token;
    this.isActive = true;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url, {
          headers: {
            Authorization: `QQBot ${token}`,
          },
        });

        const timeout = setTimeout(() => {
          reject(new Error('WebSocket connection timeout'));
        }, 10000);

        this.ws.on('open', () => {
          clearTimeout(timeout);
          logger.info(`WebSocket connected to ${url}`);
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          resolve();
        });

        this.ws.on('message', (raw: WebSocket.Data) => {
          try {
            const data = JSON.parse(raw.toString());
            this.handleMessage(data);
          } catch (err) {
            logger.error(`Failed to parse WebSocket message: ${String(err)}`);
          }
        });

        this.ws.on('close', (code, reason) => {
          logger.warn(`WebSocket closed: code=${code}, reason=${reason}`);
          this.stopHeartbeat();
          this.handleClose();
        });

        this.ws.on('error', (err) => {
          logger.error(`WebSocket error: ${err.message}`);
          clearTimeout(timeout);
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  private handleMessage(data: any) {
    const { op, d, s, t } = data;

    if (s !== undefined) {
      this.seq = s;
    }

    switch (op) {
      case 10:
        this.heartbeatInterval = (d?.heartbeat_interval || 30000);
        logger.info(`Heartbeat interval set to ${this.heartbeatInterval}ms`);
        this.identify();
        break;

      case 11:
        logger.debug('Heartbeat ACK received');
        break;

      case 0:
        logger.debug(`Event received: ${t}`);
        for (const handler of this.messageHandlers) {
          try {
            handler({ type: t, data: d, seq: s });
          } catch (err) {
            logger.error(`Message handler error: ${String(err)}`);
          }
        }
        break;

      case 7:
        logger.info('Server requested reconnect');
        this.reconnect();
        break;
    }
  }

  private identify() {
    if (!this.ws) return;

    const payload = {
      op: 2,
      d: {
        token: `QQBot ${this.token}`,
        intents: 512 | 1024 | (1 << 25),
        shard: [0, 1],
        properties: {},
      },
    };

    this.ws.send(JSON.stringify(payload));
    logger.info('Identify payload sent');
  }

  private sendHeartbeat() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const payload = {
      op: 1,
      d: this.seq,
    };

    this.ws.send(JSON.stringify(payload));
    logger.debug('Heartbeat sent');
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), this.heartbeatInterval);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private handleClose() {
    for (const handler of this.closeHandlers) {
      try {
        handler();
      } catch (err) {
        logger.error(`Close handler error: ${String(err)}`);
      }
    }

    if (this.isActive) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay
    );

    this.reconnectAttempts++;
    logger.info(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnect();
    }, delay);
  }

  reconnect() {
    if (!this.isActive || !this.url || !this.token) return;

    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch { /* ignore */ }
    }

    this.connect(this.url, this.token).catch((err) => {
      logger.error(`Reconnect failed: ${err.message}`);
    });
  }

  disconnect() {
    logger.info('Disconnecting WebSocket...');
    this.isActive = false;
    this.stopHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
  }

  send(data: object) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.warn('Cannot send: WebSocket not connected');
      return;
    }
    this.ws.send(JSON.stringify(data));
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  onMessage(handler: WsMessageHandler) {
    this.messageHandlers.push(handler);
  }

  onClose(handler: WsCloseHandler) {
    this.closeHandlers.push(handler);
  }

  offMessage(handler: WsMessageHandler) {
    this.messageHandlers = this.messageHandlers.filter((h) => h !== handler);
  }

  offClose(handler: WsCloseHandler) {
    this.closeHandlers = this.closeHandlers.filter((h) => h !== handler);
  }
}
