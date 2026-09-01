import type { CtxLike, GlobalMode } from '../types';

const KEY_CONFIG = 'config';
const KEY_MODULES = 'modules';
const KEY_DICT = 'dict';
const KEY_CHIME_GROUPS = 'chime_groups';
const DEDUP_WINDOW = 5000;

class State {
  ctx: CtxLike | null = null;
  dedup = new Map<string, number>();

  init(ctx: CtxLike): void {
    this.ctx = ctx;
  }

  private read(key: string, fallback: any): any {
    const v = this.ctx?.storage?.get(key);
    if (!v) return fallback;
    try { return JSON.parse(v); } catch { return fallback; }
  }

  private write(key: string, val: any): void {
    try { this.ctx?.storage?.set(key, JSON.stringify(val)); } catch {}
  }

  config(): { globalMode: GlobalMode; chimeMode: 'text' | 'image'; welcomeEnabled: boolean } {
    const c = this.read(KEY_CONFIG, {});
    return {
      globalMode: c.globalMode === 'image' ? 'image' : 'text',
      chimeMode: c.chimeMode === 'image' ? 'image' : 'text',
      welcomeEnabled: c.welcomeEnabled !== false,
    };
  }

  setConfig(patch: any): void {
    const c = this.config();
    this.write(KEY_CONFIG, { ...c, ...patch });
  }

  modules(botId: string): string[] {
    const m = this.read(KEY_MODULES, {});
    return Array.isArray(m[botId]) ? m[botId] : [];
  }

  setModules(botId: string, list: string[]): void {
    const m = this.read(KEY_MODULES, {});
    m[botId] = list;
    this.write(KEY_MODULES, m);
  }

  moduleEnabled(botId: string, mod: string): boolean {
    const list = this.modules(botId);
    if (list.length === 0) return true;
    return list.includes(mod);
  }

  chimeGroups(): string[] {
    return this.read(KEY_CHIME_GROUPS, []);
  }

  setChimeGroups(groups: string[]): void {
    this.write(KEY_CHIME_GROUPS, groups);
  }

  dict(): Record<string, string> {
    return this.read(KEY_DICT, {});
  }

  setDictItem(k: string, v: string): void {
    const d = this.dict();
    d[k] = v;
    this.write(KEY_DICT, d);
  }

  delDictItem(k: string): void {
    const d = this.dict();
    delete d[k];
    this.write(KEY_DICT, d);
  }

  isDup(botId: string, msgId: string, content: string): boolean {
    const key = (botId || '') + ':' + (msgId || content || '');
    const now = Date.now();
    if (this.dedup.has(key)) {
      const last = this.dedup.get(key) || 0;
      if (now - last < DEDUP_WINDOW) return true;
    }
    this.dedup.set(key, now);
    if (this.dedup.size > 500) {
      const it = this.dedup.entries().next();
      if (it.value) this.dedup.delete(it.value[0]);
    }
    return false;
  }
}

export const state = new State();
