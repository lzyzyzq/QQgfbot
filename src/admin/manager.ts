import { EventEmitter } from 'events';
import type { BotEntry } from './config';
import { BotRegistry } from './registry';
import type { Logger } from './logger';

export class BotManager extends EventEmitter {
  private registry: BotRegistry;
  private logger: Logger;

  constructor(registry: BotRegistry, logger: Logger) {
    super();
    this.registry = registry;
    this.logger = logger;
  }

  listBots(owner?: string): BotEntry[] {
    return this.registry.list(owner).map((b) => ({
      ...b,
      status: b.status,
    }));
  }

  getBot(id: string): BotEntry | undefined {
    const entry = this.registry.get(id);
    if (!entry) return undefined;
    return { ...entry, status: entry.status };
  }

  addBot(data: Omit<BotEntry, 'id' | 'createdAt' | 'updatedAt' | 'status'>): BotEntry {
    return this.registry.add(data);
  }

  updateBot(id: string, data: Partial<BotEntry>): BotEntry | null {
    return this.registry.update(id, data);
  }

  removeBot(id: string): boolean {
    return this.registry.remove(id);
  }

  async startBot(id: string): Promise<BotEntry | null> {
    const entry = this.registry.get(id);
    if (!entry) return null;
    this.registry.setStatus(id, 'running');
    this.logger.info(`Bot [${entry.name}] start requested`);
    this.emit('botStarted', id);
    return entry;
  }

  stopBot(id: string): void {
    const entry = this.registry.get(id);
    this.registry.setStatus(id, 'stopped');
    this.logger.info(`Bot [${entry?.name || id}] stopped`);
    this.emit('botStopped', id);
  }

  async restartBot(id: string): Promise<BotEntry | null> {
    this.stopBot(id);
    await new Promise((r) => setTimeout(r, 500));
    return this.startBot(id);
  }

  async startAll(): Promise<void> {
    const bots = this.registry.list();
    for (const bot of bots) {
      if (bot.status === 'running') {
        await this.startBot(bot.id).catch((err) => {
          this.logger.error(`Bot [${bot.name}] auto-start failed: ${err}`);
        });
      }
    }
  }

  stopAll(): void {
    for (const entry of this.registry.list()) {
      if (entry.status === 'running') {
        this.registry.setStatus(entry.id, 'stopped');
      }
    }
  }
}
