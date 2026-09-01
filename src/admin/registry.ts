import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import type { BotEntry } from './config';

export class BotRegistry extends EventEmitter {
  private filePath: string;
  private bots: BotEntry[] = [];

  constructor(dataDir: string) {
    super();
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    this.filePath = path.join(dataDir, 'bots.json');
    this._load();
  }

  private _load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        this.bots = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      }
    } catch {
      this.bots = [];
    }
  }

  private _save(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.bots, null, 2));
  }

  list(owner?: string): BotEntry[] {
    if (owner) {
      return this.bots.filter((b) => b.owner === owner);
    }
    return [...this.bots];
  }

  get(id: string): BotEntry | undefined {
    return this.bots.find((b) => b.id === id);
  }

  add(entry: Omit<BotEntry, 'id' | 'createdAt' | 'updatedAt' | 'status'>): BotEntry {
    const now = Date.now();
    const bot: BotEntry = {
      ...entry,
      id: `bot_${now}_${Math.random().toString(36).slice(2, 8)}`,
      status: 'stopped',
      createdAt: now,
      updatedAt: now,
    };
    this.bots.push(bot);
    this._save();
    this.emit('added', bot);
    return bot;
  }

  update(id: string, data: Partial<BotEntry>): BotEntry | null {
    const idx = this.bots.findIndex((b) => b.id === id);
    if (idx === -1) return null;

    const allowed = ['name', 'appId', 'clientSecret', 'intents', 'sandbox', 'owner', 'secretVisible'];
    for (const key of allowed) {
      if (key in data) (this.bots[idx] as unknown as Record<string, unknown>)[key] = (data as unknown as Record<string, unknown>)[key];
    }
    this.bots[idx].updatedAt = Date.now();
    this._save();
    this.emit('updated', this.bots[idx]);
    return this.bots[idx];
  }

  setStatus(id: string, status: BotEntry['status']): BotEntry | null {
    const bot = this.get(id);
    if (!bot) return null;
    bot.status = status;
    bot.updatedAt = Date.now();
    this._save();
    this.emit('status', bot);
    return bot;
  }

  // 激活码生命周期标记：记录机器人是否因授权码到期被自动停机（续期后据此自动恢复）
  setLicenseFlag(id: string, flag: boolean): BotEntry | null {
    const bot = this.get(id);
    if (!bot) return null;
    bot.licenseStopped = flag;
    bot.updatedAt = Date.now();
    this._save();
    return bot;
  }

  remove(id: string): boolean {
    const idx = this.bots.findIndex((b) => b.id === id);
    if (idx === -1) return false;
    this.bots.splice(idx, 1);
    this._save();
    this.emit('removed', id);
    return true;
  }
}
