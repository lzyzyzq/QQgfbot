import fs from 'fs';
import path from 'path';
import { DEFAULT_CONFIG } from '../config';
import type { PluginContext } from '../types';

export interface PluginData {
  owners: string[];
  groupSwitches: Record<string, boolean>;
  activatedCodes: Record<string, any>;
  signin: Record<string, any>;
  keywordReplies: Record<string, any>;
  schedules: any[];
  birthdays: Record<string, any>;
  woodFish: Record<string, number>;
  farm: Record<string, any>;
  mines: Record<string, any>;
  fishing: Record<string, any>;
  dailyNotes: Record<string, any>;
  checkins: Record<string, any>;
  manualSchedules: Record<string, any>;
}

export function defaultData(): PluginData {
  return {
    owners: [],
    groupSwitches: {},
    activatedCodes: {},
    signin: {},
    keywordReplies: {},
    schedules: [],
    birthdays: {},
    woodFish: {},
    farm: {},
    mines: {},
    fishing: {},
    dailyNotes: {},
    checkins: {},
    manualSchedules: {},
  };
}

export class PluginState {
  private _ctx: PluginContext | null = null;
  private _config: Record<string, any> = { ...DEFAULT_CONFIG };
  private _data: PluginData = defaultData();
  private _timers: any[] = [];
  private _dataPath = "";

  get ctx(): PluginContext | null {
    return this._ctx;
  }

  get config(): Record<string, any> {
    return this._config;
  }

  get data(): PluginData {
    return this._data;
  }

  pushTimer(timer: any): void {
    this._timers.push(timer);
  }

  init(ctx: PluginContext): void {
    this._ctx = ctx;
    this.loadConfig(ctx.configPath);
    this.loadData(ctx.dataPath);
    this.migrateGroupSwitches();
  }

  cleanup(): void {
    this._timers.forEach((t) => clearInterval(t));
    this._timers = [];
    this.saveData();
    this._ctx = null;
  }

  replaceConfig(config: Record<string, any>): void {
    this._config = { ...DEFAULT_CONFIG, ...config };
    this.saveConfig();
  }

  loadConfig(configPath: string): void {
    try {
      if (fs.existsSync(configPath)) {
        const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        this._config = { ...DEFAULT_CONFIG, ...raw };
      } else {
        this.saveConfig();
      }
    } catch {
      this._ctx?.logger?.warn('配置加载失败，使用默认值');
    }
  }

  saveConfig(): void {
    if (!this._ctx) return;
    try {
      const dir = this._ctx.configPath.replace(/[/\\][^/\\]+$/, '');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this._ctx.configPath, JSON.stringify(this._config, null, 2));
    } catch {
      this._ctx.logger?.warn('配置保存失败');
    }
  }

  loadData(dataPath: string): void {
    this._dataPath = dataPath;
    const file = path.join(dataPath, 'data.json');
    try {
      if (fs.existsSync(file)) {
        const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
        this._data = { ...defaultData(), ...raw };
      } else {
        this._data = defaultData();
        this.saveData();
      }
    } catch {
      this._data = defaultData();
    }
  }

  saveData(): void {
    if (!this._dataPath) return;
    try {
      if (!fs.existsSync(this._dataPath)) fs.mkdirSync(this._dataPath, { recursive: true });
      fs.writeFileSync(path.join(this._dataPath, 'data.json'), JSON.stringify(this._data, null, 2));
    } catch {
      this._ctx?.logger?.warn('数据保存失败');
    }
  }

  /** 兼容 v3.0.0 及更早版本：将 data.groupSwitches 中的显式开关迁移到配置列表 */
  private migrateGroupSwitches(): void {
    const sw = this._data.groupSwitches || {};
    const entries = Object.entries(sw).filter(([, v]) => typeof v === 'boolean');
    if (!entries.length) return;
    const disabled = (this._config.groupDisabledList || '').split(/[\s,，;；]+/).filter(Boolean);
    const enabled = (this._config.groupEnabledList || '').split(/[\s,，;；]+/).filter(Boolean);
    for (const [gid, on] of entries) {
      if (on === false) {
        if (!disabled.includes(gid)) disabled.push(gid);
      } else if (on === true) {
        if (!enabled.includes(gid)) enabled.push(gid);
      }
    }
    this._config.groupDisabledList = disabled.join(',');
    this._config.groupEnabledList = enabled.join(',');
    this._data.groupSwitches = {};
    this.saveConfig();
    this.saveData();
  }
}

export const state = new PluginState();
