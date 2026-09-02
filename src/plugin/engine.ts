import { EventBus, getPluginGroupMode, resetGroupPolicyCache } from '../core/event-bus';
import { Plugin, PluginInfo, PluginContext, BotAPI, PluginStorage, PluginEngineAPI } from './types';
import { PluginSandbox } from './sandbox';
import { getDb, getConfig, setConfig, getQQByOpenid, getOpenidsByQQ, getMappingByOpenid, querySystemLogs } from '../db/index';import { createLogger } from '../utils/logger';
import { signClickPayload } from '../utils/click-sign';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';
import { AsyncLocalStorage } from 'async_hooks';
import { isNapcatModule, initNapcatPlugin, readNapcatConfig, writeNapcatConfig } from './napcat';
import { loadAdminRoleByQQ, updateMemberBinding, removeMemberBinding } from '../core/napcat';
import { currentBotId as getCurrentBotId } from '../core/bot';
import { loadBroadcastCatalog, loadBroadcastTaskById, runBroadcastNow } from '../core/broadcast';
import { PythonRuntime } from './python-runtime';

const logger = createLogger('plugin-engine');
const callStackStorage = new AsyncLocalStorage<number>();

// 插件文件型数据目录：data/database/（插件经 ctx.data.readJSON/writeJSON 等读写），
// 路径严格限制在该目录内，禁止相对路径/上级目录穿越
const DATA_DIR = path.resolve('data', 'database');
function ensureDataDir(): void {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) { /* 忽略 */ }
}
function safeDatabaseFilePath(name: string): string | null {
  try {
    const fn = path.basename(String(name || '').trim()).replace(/[\/\\\x00-\x1f]/g, '_');
    if (!fn || fn === '.' || fn === '..') return null;
    return path.join(DATA_DIR, fn);
  } catch { return null; }
}

// 全局用户自定义变量存储 key（config 表）：面板「插件卡片·后台编辑器」变量管理可编辑，插件经 ctx.engine.getVariable/setVariable 读写
const VARS_KEY = 'plugin.vars';
function readPluginVars(): Record<string, string> {
  try {
    const raw = getConfig(VARS_KEY) || '{}';
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

// 避免 TypeScript(CommonJS) 将动态 import() 编译成 require()（require 无法加载 file:// URL 与 .mjs），
// 用 new Function 保留真正的运行时动态 import
const dynamicImport = new Function('u', 'return import(u)') as (u: string) => Promise<any>;

/** 兼容无 manifest 字段的插件（旧版/外部格式），自动补默认 manifest */
function ensurePluginManifest(mod: any, fallback: { id: string; name: string; description?: string }): any {
  if (mod === null || (typeof mod !== 'object' && typeof mod !== 'function')) {
    throw new Error('Plugin entry is invalid');
  }
  if (!mod.manifest) {
    mod.manifest = {
      id: fallback.id,
      name: fallback.name,
      version: '1.0.0',
      description: fallback.description || '',
      author: '',
    };
  }
  return mod;
}

/** 把外部事件数据规范化为中间件插件期望的字段名（channel_id/guild_id/group_id/message_id） */
function normalizeMiddlewareEvent(data: any): any {
  if (!data || typeof data !== 'object') return data;
  const event: any = { ...data };
  if (event.channel_id === undefined) event.channel_id = event.channelId || '';
  if (event.guild_id === undefined) event.guild_id = event.guildId || event.groupId || '';
  if (event.group_id === undefined) event.group_id = event.groupId || '';
  if (event.message_id === undefined) event.message_id = event.id;
  return event;
}

/** 给 BotAPI 加中间件插件常见方法名别名（sendChannelMessage/getGuildChannels/createChannel 等） */
function compatBot(bot: any): any {
  if (!bot || typeof bot !== 'object') return bot;
  const proxy: any = { ...bot };
  const aliases: Record<string, string> = {
    getGuildChannels: 'getChannels',
    getChannel: 'getChannelDetail',
    getChannelById: 'getChannelDetail',
    createGuildChannel: 'createChannel',
    postChannel: 'createChannel',
    patchChannel: 'modifyChannel',
    updateChannel: 'modifyChannel',
    removeChannel: 'deleteChannel',
    deleteGuildChannel: 'deleteChannel',
    deleteMessage: 'deleteChannelMessage',
    retractChannelMessage: 'deleteChannelMessage',
    announceChannel: 'createChannelAnnounce',
    createChannelAnnouncement: 'createChannelAnnounce',
    announceGuild: 'createGuildAnnounce',
    createGuildAnnouncement: 'createGuildAnnounce',
    removeGuildMember: 'removeGuildMember',
    kickGuildMember: 'removeGuildMember',
    muteMember: 'muteGuildMember',
    getMembers: 'getGuildMembers',
    getGuildAnnounces: 'getGuildAnnounces',
    getAnnounces: 'getGuildAnnounces',
  };
  for (const [alias, target] of Object.entries(aliases)) {
    if (!(alias in proxy) && typeof (bot as any)[target] === 'function') {
      proxy[alias] = (bot as any)[target].bind(bot);
    }
  }
  // sendChannelMessage 适配对象入参 (channelId, { content, msg_id })
  if (typeof bot.sendMessage === 'function' && typeof proxy.sendChannelMessage !== 'function') {
    proxy.sendChannelMessage = async (channelId: string, optsOrContent: any, msgId?: string) => {
      const real = (bot as any).sendMessage.bind(bot);
      if (optsOrContent && typeof optsOrContent === 'object') {
        return real(channelId, optsOrContent.content ?? '', optsOrContent.msg_id ?? msgId);
      }
      return real(channelId, optsOrContent, msgId);
    };
  }
  proxy.messages = proxy.messages || {};
  if (!proxy.messages.sendChannelMessage && typeof bot.sendMessage === 'function') {
    proxy.messages.sendChannelMessage = (channelId: string, optsOrContent: any, msgId?: string) => {
      if (optsOrContent && typeof optsOrContent === 'object') {
        return bot.sendMessage(channelId, optsOrContent.content ?? '', optsOrContent.msg_id ?? msgId);
      }
      return bot.sendMessage(channelId, optsOrContent, msgId);
    };
  }
  return proxy;
}

/** 将中间件格式插件（module.exports = function(ctx, next)）包装为标准插件，自动订阅消息事件 */
function wrapMiddlewarePlugin(ctx: PluginContext, id: string, name: string, description: string, fn: Function): Plugin {
  const handler = (data: any) => {
    const event = normalizeMiddlewareEvent(data);
    const mctx: any = { ...ctx, bot: compatBot(ctx.bot), event, next: () => {} };
    try {
      const ret = fn(mctx, mctx.next);
      if (ret && typeof ret.catch === 'function') {
        ret.catch((e: any) => ctx.logger.error(`Middleware plugin ${name} error: ${e.message}`));
      }
    } catch (e: any) {
      ctx.logger.error(`Middleware plugin ${name} error: ${e.message}`);
    }
  };
  return {
    manifest: { id, name, version: '1.0.0', description: description || '', author: '' },
    onEnable: async () => {
      ctx.eventBus.on('message.group', handler as any, { pluginId: id });
      ctx.eventBus.on('message.c2c', handler as any, { pluginId: id });
      ctx.eventBus.on('message.guild', handler as any, { pluginId: id });
    },
  };
}

export class PluginEngine {
  private plugins: Map<string, {
    plugin: Plugin;
    ctx: PluginContext;
    loaded: boolean;
    error?: string;
    napcat?: { schema: any[]; unregister: () => void; mod: any; cleanup?: () => Promise<void> };
    pyRuntime?: PythonRuntime;
    pyUnregister?: () => void;
  }> = new Map();
  private eventBus: EventBus;
  private botApi: BotAPI;
  private pluginsDir: string;
  private dynImport: (u: string) => Promise<any>;
  /** 权限/模式类 key 跨插件共享（无插件实例前缀），其余存储 key 均带 plugin.{实例id}. 前缀 */
  private sharedPermKeys = new Set(['super_master_id', 'mini_masters', 'members', 'global_mode']);

  constructor(eventBus: EventBus, botApi: BotAPI, pluginsDir?: string, dynImport?: (u: string) => Promise<any>) {
    this.eventBus = eventBus;
    this.botApi = botApi;
    this.pluginsDir = pluginsDir || path.resolve(process.cwd(), 'plugins');
    this.dynImport = dynImport || dynamicImport;

    if (!fs.existsSync(this.pluginsDir)) {
      fs.mkdirSync(this.pluginsDir, { recursive: true });
    }
  }

  getBotApi(): BotAPI {
    return this.botApi;
  }

  getPluginsDir(): string {
    return this.pluginsDir;
  }

  list(): PluginInfo[] {
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM plugins ORDER BY created_at DESC').all() as any[];

      const infos: PluginInfo[] = rows.map((row) => {
        const loaded = this.plugins.has(row.id);
        const pluginEntry = this.plugins.get(row.id);
        let fileType: string = row.type || 'code';
        if (row.type === 'code') {
          fileType = fs.existsSync(path.join(this.pluginsDir, row.name + '.mjs')) ? 'mjs' : 'js';
        } else if (row.type === 'file') {
          fileType = path.extname(row.name).replace(/^\./, '') || 'file';
        }
        return {
          id: row.id,
          name: row.name,
          version: String(row.version),
          description: row.description || '',
          author: row.author || 'user',
          enabled: row.enabled === 1,
          loaded,
          hasError: pluginEntry ? !!pluginEntry.error : false,
          errorMessage: pluginEntry?.error,
          type: row.type || 'code',
          fileType,
          has_webui: (row.has_webui === 1),
          approved: row.approved === 1,
          owner: row.owner || '',
        };
      });

      // 合并 plugins 目录扫描结果：DB 未登记的插件（如手动放入目录、auto-discovery 失败）也显示，
      // 保证「插件统一放在 plugins 目录」即可被管理面板识别
      const ids = new Set(infos.map((i) => i.id));
      for (const extra of this.scanPluginsDir()) {
        if (!ids.has(extra.id)) {
          infos.push(extra);
          ids.add(extra.id);
        }
      }
      return infos;
    } catch (e) {
      // DB 异常（缺表/坏库/只读）时回退为纯目录扫描，保证插件列表永不 500
      logger.warn(`Plugin list via DB failed, fallback to plugins dir scan: ${e}`);
      return this.scanPluginsDir();
    }
  }

  // 直接扫描 plugins 目录，生成不依赖数据库的插件条目（DB 异常或 DB 未登记时兜底）
  private scanPluginsDir(): PluginInfo[] {
    const out: PluginInfo[] = [];
    try {
      if (!fs.existsSync(this.pluginsDir)) return out;
      const files = fs.readdirSync(this.pluginsDir);
      for (const f of files) {
        try {
          const fp = path.join(this.pluginsDir, f);
          if (!fs.statSync(fp).isFile()) continue;
          const ext = path.extname(f).toLowerCase();
          if (ext !== '.js' && ext !== '.mjs' && ext !== '.py') continue;
          const name = f.slice(0, -ext.length);
          if (!name) continue;
          const id = 'file-' + name;
          out.push({
            id,
            name,
            version: '',
            description: '',
            author: 'system',
            enabled: false,
            loaded: this.plugins.has(id),
            hasError: false,
            errorMessage: undefined,
            type: ext === '.py' ? 'py' : 'code',
            fileType: ext.slice(1),
            has_webui: false,
            approved: true,
            owner: 'system',
          });
        } catch { /* 单个文件失败不影响整体扫描 */ }
      }
    } catch { /* 目录不可读时返回空列表 */ }
    return out;
  }

  // 从 ZIP 包创建插件
  async createFromZip(id: string, zipPath: string, owner?: string, approved: boolean = true): Promise<PluginInfo> {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(zipPath);
    const pluginDir = path.join(this.pluginsDir, id);
    if (fs.existsSync(pluginDir)) {
      fs.rmSync(pluginDir, { recursive: true, force: true });
    }
    zip.extractAllTo(pluginDir, true);

    // 兼容 zip 内含单层顶层目录的情况（如 MKbot/xxx、Python 包 测试/），将入口所在子目录内容上移到插件根目录
    if (!fs.existsSync(path.join(pluginDir, 'index.mjs')) &&
        !fs.existsSync(path.join(pluginDir, 'index.js')) &&
        !fs.existsSync(path.join(pluginDir, 'index.ts')) &&
        !fs.existsSync(path.join(pluginDir, 'src', 'index.ts')) &&
        !fs.existsSync(path.join(pluginDir, 'package.json')) &&
        !fs.existsSync(path.join(pluginDir, '__init__.py'))) {
      try {
        const subs = fs.readdirSync(pluginDir).filter((n: string) => {
          try { return fs.statSync(path.join(pluginDir, n)).isDirectory(); } catch { return false; }
        });
        for (const sub of subs) {
          const subDir = path.join(pluginDir, sub);
          if (fs.existsSync(path.join(subDir, 'index.mjs')) ||
              fs.existsSync(path.join(subDir, 'index.js')) ||
              fs.existsSync(path.join(subDir, 'index.ts')) ||
              fs.existsSync(path.join(subDir, 'src', 'index.ts')) ||
              fs.existsSync(path.join(subDir, 'package.json')) ||
              fs.existsSync(path.join(subDir, '__init__.py'))) {
            for (const item of fs.readdirSync(subDir)) {
              const src = path.join(subDir, item);
              const dst = path.join(pluginDir, item);
              if (!fs.existsSync(dst)) fs.renameSync(src, dst);
            }
            logger.info(`Zip root adjusted: ${sub}/ -> plugin root`);
            break;
          }
        }
      } catch (e: any) {
        logger.warn(`Zip root adjustment failed: ${e.message}`);
      }
    }

    let pkg: any = {};
    let pkgPath = path.join(pluginDir, 'plugin.json');
    if (!fs.existsSync(pkgPath)) {
      pkgPath = path.join(pluginDir, 'package.json');
    }
    if (fs.existsSync(pkgPath)) {
      try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')); } catch {}
    }

    const name = pkg.name || path.basename(pluginDir);
    const description = pkg.description || '';
    const author = pkg.author || null;
    const mainFile = pkg.main || null;

    const hasJsEntry = fs.existsSync(path.join(pluginDir, 'index.mjs')) || fs.existsSync(path.join(pluginDir, 'index.js')) || fs.existsSync(path.join(pluginDir, 'index.ts')) || fs.existsSync(path.join(pluginDir, 'src', 'index.ts'));
    const hasPyInit = fs.existsSync(path.join(pluginDir, '__init__.py'));
    const pyEntry = this.findPyEntry(pluginDir);

    let entryFile: string;
    if (mainFile && fs.existsSync(path.join(pluginDir, mainFile))) {
      entryFile = mainFile;
    } else if (fs.existsSync(path.join(pluginDir, 'index.mjs'))) {
      entryFile = 'index.mjs';
    } else if (fs.existsSync(path.join(pluginDir, 'index.js'))) {
      entryFile = 'index.js';
    } else if (fs.existsSync(path.join(pluginDir, 'index.ts'))) {
      entryFile = 'index.ts';
    } else if (fs.existsSync(path.join(pluginDir, 'src', 'index.ts'))) {
      entryFile = 'src/index.ts';
    } else if (pyEntry) {
      entryFile = pyEntry;
    } else {
      entryFile = hasPyInit ? '__init__.py' : '';
    }
    const entryPath = entryFile ? path.join(pluginDir, entryFile) : '';
    if (!hasJsEntry && !hasPyInit && !pyEntry) {
      throw new Error('Plugin entry point not found: index.mjs/index.js or __init__.py');
    }

    const code = (entryPath && fs.existsSync(entryPath)) ? fs.readFileSync(entryPath, 'utf-8') : '';

    // WebUI：优先 package.json 的 webui 字段（如 "webui/dashboard.html"），否则 webui/index.html
    let webuiRel: string | null = null;
    const pkgWebui = pkg.webui;
    if (typeof pkgWebui === 'string' && fs.existsSync(path.join(pluginDir, pkgWebui))) {
      webuiRel = pkgWebui;
    } else if (fs.existsSync(path.join(pluginDir, 'webui', 'index.html'))) {
      webuiRel = 'webui';
    }
    const hasWebui = !!webuiRel;

    // 自动安装 package.json 中声明的 dependencies（失败仅警告，不阻断安装）
    const deps = pkg.dependencies;
    if (deps && Object.keys(deps).length > 0 && !fs.existsSync(path.join(pluginDir, 'node_modules'))) {
      try {
        const { spawnSync } = require('child_process');
        logger.info(`Installing dependencies for plugin ${name}: ${Object.keys(deps).join(', ')}`);
        const r = spawnSync('npm', ['install', '--production', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: pluginDir, timeout: 180000, encoding: 'utf-8' });
        if (r.status === 0) logger.info(`Dependencies installed for plugin ${name}`);
        else logger.warn(`npm install for ${name} exited ${r.status}: ${r.stderr?.slice(0, 300) || ''}`);
      } catch (e: any) {
        logger.warn(`Failed to install dependencies for plugin ${name}: ${e.message}`);
      }
    }

    const db = getDb();
    const existing = db.prepare('SELECT id FROM plugins WHERE id = ?').get(id);
    const finalOwner = owner || 'system';
    const finalApproved = approved ? 1 : 0;

    const isPy = !hasJsEntry && (hasPyInit || !!pyEntry);
    const dbType = isPy ? 'py' : 'zip';
    const pyDesc = this.readPyDescription(pluginDir) || description;

    if (existing) {
      db.prepare(
        `UPDATE plugins SET 
          name = ?, description = ?, code = ?, type = ?,
          source_path = ?, has_webui = ?, owner = ?, approved = ?,
          version = version + 1, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?`
      ).run(name, isPy ? pyDesc : description, code, dbType, pluginDir, hasWebui ? 1 : 0, finalOwner, finalApproved, id);
    } else {
      db.prepare(
        `INSERT INTO plugins (id, name, description, code, enabled, version, type, source_path, has_webui, owner, approved)
         VALUES (?, ?, ?, ?, 0, 1, ?, ?, ?, ?, ?)`
      ).run(id, name, isPy ? pyDesc : description, code, dbType, pluginDir, hasWebui ? 1 : 0, finalOwner, finalApproved);
    }

    return {
      id, name, version: pkg.version || '1.0.0',
      description: isPy ? pyDesc : description, author: pkg.author || 'user',
      enabled: false, loaded: false, hasError: false,
      type: dbType, has_webui: hasWebui,
      approved: finalApproved === 1,
      owner: finalOwner,
    };
  }

  async loadFromCode(
    id: string,
    name: string,
    code: string,
    description?: string,
    pluginType?: string,
    sourcePath?: string,
    hasWebui?: boolean,
    owner?: string,
    approved: boolean = true
  ): Promise<PluginInfo> {
    const pluginContext = this.createPluginContext(id);

    const plugin = PluginSandbox.loadPlugin(code, pluginContext);
    if (!plugin) {
      throw new Error('Failed to load plugin: invalid plugin code');
    }

    plugin.manifest.id = id;

    const db = getDb();
    const existing = db.prepare('SELECT id FROM plugins WHERE id = ?').get(id);
    const finalOwner = owner || 'system';
    const finalApproved = approved ? 1 : 0;

    if (existing) {
      db.prepare(
        `UPDATE plugins SET 
          name = ?, description = ?, code = ?, 
          type = COALESCE(?, type), 
          source_path = COALESCE(?, source_path), 
          has_webui = COALESCE(?, has_webui),
          owner = ?, approved = ?,
          version = version + 1, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?`
      ).run(
        plugin.manifest.name,
        description || '',
        code,
        pluginType || null,
        sourcePath || null,
        hasWebui !== undefined ? (hasWebui ? 1 : 0) : null,
        finalOwner,
        finalApproved,
        id
      );
    } else {
      db.prepare(
        `INSERT INTO plugins (id, name, description, code, enabled, version, type, source_path, has_webui, owner, approved)
         VALUES (?, ?, ?, ?, 0, 1, ?, ?, ?, ?, ?)`
      ).run(
        id,
        plugin.manifest.name,
        description || '',
        code,
        pluginType || 'code',
        sourcePath || '',
        hasWebui ? 1 : 0,
        finalOwner,
        finalApproved
      );
    }

    // 写入文件系统
    if (pluginType !== 'zip') {
      const pluginFile = path.join(this.pluginsDir, plugin.manifest.name + '.js');
      fs.writeFileSync(pluginFile, code, 'utf-8');
      logger.info(`Plugin code written to: ${pluginFile}`);
    }

    try {
      if (plugin.onLoad) {
        await plugin.onLoad(pluginContext);
      }
    } catch (err: any) {
      logger.error(`Plugin ${id} onLoad failed: ${err.message}`);
      this.plugins.set(id, { plugin, ctx: pluginContext, loaded: false, error: err.message });
      this.eventBus.emit('plugin.error', { pluginId: id, error: err.message });
      throw err;
    }

    this.plugins.set(id, { plugin, ctx: pluginContext, loaded: false });
    logger.info(`Plugin loaded: ${plugin.manifest.name} (${id})`);

    // 如果 enabled=1，自动启用
    const row = db.prepare('SELECT enabled FROM plugins WHERE id = ?').get(id) as any;
    if (row && row.enabled === 1) {
      try {
        await this.enable(id);
      } catch (e) {
        logger.warn(`Auto-enable failed for ${id}: ${e}`);
      }
    }

    return {
      id,
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      description: plugin.manifest.description || '',
      author: plugin.manifest.author || 'user',
      enabled: row?.enabled === 1,
      loaded: this.plugins.has(id),
      hasError: false,
      type: pluginType || 'code',
      has_webui: !!hasWebui,
      approved: finalApproved === 1,
      owner: finalOwner,
    };
  }

  /**
   * 在 Python 插件目录中查找入口 .py 文件（相对路径）：
   * 优先 目录名.py / index.py / __main__.py，其次子目录同名入口，最后根目录任意 .py
   */
  private findPyEntry(dir: string): string | null {
    if (!dir || !fs.existsSync(dir)) return null;
    try {
      const base = path.basename(dir);
      const candidates = [base + '.py', 'index.py', '__main__.py'];
      for (const c of candidates) {
        if (fs.existsSync(path.join(dir, c))) return c;
      }
      for (const sub of fs.readdirSync(dir)) {
        const subPath = path.join(dir, sub);
        if (!fs.statSync(subPath).isDirectory()) continue;
        if (!fs.existsSync(path.join(subPath, '__init__.py'))) continue;
        if (fs.existsSync(path.join(subPath, sub + '.py'))) return path.join(sub, sub + '.py');
        if (fs.existsSync(path.join(subPath, 'index.py'))) return path.join(sub, 'index.py');
        if (fs.existsSync(path.join(subPath, '__main__.py'))) return path.join(sub, '__main__.py');
      }
      const pys = fs.readdirSync(dir).filter((f) => f.endsWith('.py')).sort();
      if (pys.length) return pys[0];
    } catch {}
    return null;
  }

  /** 从 Python 插件目录读取简介（Plugin_Information.txt 或 README） */
  private readPyDescription(dir: string): string {
    if (!dir) return '';
    for (const f of ['Plugin_Information.txt', 'plugin_information.txt', 'README.txt', 'README.md']) {
      const p = path.join(dir, f);
      if (fs.existsSync(p)) {
        try { return fs.readFileSync(p, 'utf-8').split(/\r?\n/).slice(0, 5).join(' ').slice(0, 200).trim(); } catch {}
      }
    }
    return '';
  }

  /** 解析 Python 插件的绝对入口路径 */
  private resolvePyEntry(row: any): string | null {
    const candidates: string[] = [];
    if (row.source_path) {
      candidates.push(row.source_path);
      try {
        const st = fs.statSync(row.source_path);
        if (st.isFile() && row.source_path.endsWith('.py')) return path.resolve(row.source_path);
      } catch {}
    }
    candidates.push(path.join(this.pluginsDir, row.id));
    if (row.name) candidates.push(path.join(this.pluginsDir, row.name));
    const tried = new Set<string>();
    for (const c of candidates) {
      if (!c || tried.has(c)) continue;
      tried.add(c);
      try {
        if (!fs.existsSync(c)) continue;
        if (fs.statSync(c).isFile() && c.endsWith('.py')) return path.resolve(c);
        const rel = this.findPyEntry(c);
        if (rel) return path.resolve(c, rel);
      } catch {}
    }
    return null;
  }

  private async loadPyPlugin(id: string): Promise<void> {
    const db = getDb();
    const row = db.prepare('SELECT * FROM plugins WHERE id = ?').get(id) as any;
    if (!row || row.type !== 'py') throw new Error(`Plugin ${id} is not a Python plugin`);

    const entryPath = this.resolvePyEntry(row);
    if (!entryPath) {
      if (row.enabled !== 1) {
        logger.warn(`Python plugin ${id} entry not found, skipped (disabled): ${row.source_path}`);
        return;
      }
      throw new Error(`Python plugin entry not found: ${row.source_path}`);
    }

    const ctx = this.createPluginContext(id);
    const runtime = new PythonRuntime(entryPath, this.botApi, (line) => {
      logger.info(`[py:${row.name}] ${line}`);
    }, 'python3', {
      listGroups: () => {
        try {
          const db = getDb();
          return (db.prepare("SELECT id FROM groups WHERE id IS NOT NULL AND id != '' ORDER BY last_active DESC").all() as any[])
            .map((r: any) => String(r.id));
        } catch { return []; }
      },
      openidByQq: (qq: string) => {
        try {
          const resolved = ctx.engine.resolveOpenidByQq(String(qq || '').trim());
          return resolved || null;
        } catch { return null; }
      },
      nicknameToOpenid: (groupId: string, nickname: string) => {
        try {
          return ctx.engine.getGroupMemberOpenidByNickname(String(groupId || ''), String(nickname || '').trim());
        } catch { return null; }
      },
      isSuper: (openid: string) => {
        try {
          const superId = ctx.storage.get('super_master_id');
          if (!superId) return false;
          const ids = JSON.parse(superId) as string[];
          return Array.isArray(ids) && ids.includes(String(openid));
        } catch { return false; }
      },
      getVariable: (name: string) => {
        try { return ctx.engine.getVariable(String(name || '')); } catch { return null; }
      },
      getMenuConfig: (appid: string) => {
        try {
          const db = getDb();
          const row = db.prepare('SELECT value FROM config WHERE key = ?').get(`plugin.${id}.config`) as any;
          if (!row || !row.value) return null;
          const all = JSON.parse(row.value);
          if (all && typeof all === 'object' && appid) {
            const hit = all[appid] || all[String(appid || '').toUpperCase()] || null;
            return hit || null;
          }
          return null;
        } catch { return null; }
      },
      broadcastList: async () => {
        try {
          const cat = await loadBroadcastCatalog(true);
          return { ok: cat.ok, source: cat.sourceUrl, errors: cat.errors, tasks: cat.tasks.map((t) => ({ id: t.id, name: t.name, enabled: t.enabled, send: t.send, target: t.target, groupId: t.groupId || '', groups: t.groups || [], schedule: t.schedule || null })) };
        } catch (e: any) { return { ok: false, error: e.message || String(e), tasks: [] }; }
      },
      broadcastSend: async (taskId: string, target?: string, groupId?: string) => {
        const t = await loadBroadcastTaskById(String(taskId || '').trim());
        if (!t) return { ok: false, error: '云端广播任务不存在或目录不可用: ' + String(taskId || '') };
        const r = await runBroadcastNow(t, { target: target || 'default', groupId });
        return r;
      },
    });

    const dispatch = (ev: string) => (data: any) => runtime.dispatch({ ...data, type: ev });
    const listenerIds: string[] = [];
    listenerIds.push(ctx.eventBus.on('message.group', dispatch('message.group') as any, { pluginId: id }));
    listenerIds.push(ctx.eventBus.on('message.c2c', dispatch('message.c2c') as any, { pluginId: id }));
    listenerIds.push(ctx.eventBus.on('message.guild', dispatch('message.guild') as any, { pluginId: id }));

    const plugin: Plugin = {
      manifest: { id, name: row.name || id, version: String(row.version || '1.0.0'), description: row.description || '', author: row.owner || '' },
      onEnable: async () => { await runtime.start(); },
      onDisable: async () => { runtime.stop(); },
      onUnload: async () => { runtime.stop(); },
      methods: {},
    };

    this.plugins.set(id, {
      plugin, ctx, loaded: false,
      pyRuntime: runtime,
      pyUnregister: () => { try { for (const lid of listenerIds) ctx.eventBus.off(lid); } catch {} },
    });

    try {
      await runtime.start();
      const entry = this.plugins.get(id);
      if (entry) entry.loaded = true;
      db.prepare('UPDATE plugins SET enabled = 1, source_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(entryPath, id);
      this.eventBus.emit('plugin.enabled', { pluginId: id });
      logger.info(`Python plugin loaded: ${row.name || id} (${id}) entry=${entryPath}`);
    } catch (e: any) {
      this.plugins.get(id)!.error = e.message;
      this.eventBus.emit('plugin.error', { pluginId: id, error: e.message });
      this.plugins.delete(id);
      throw e;
    }
  }

  private async loadZipPlugin(id: string): Promise<void> {
    const db = getDb();
    const row = db.prepare('SELECT * FROM plugins WHERE id = ?').get(id) as any;
    if (!row || row.type !== 'zip') throw new Error(`Plugin ${id} is not a ZIP plugin`);

    const sourcePath = row.source_path;
    const candidates: string[] = [];
    if (sourcePath) {
      candidates.push(sourcePath);
      const base = path.basename(sourcePath);
      if (base === 'index.js' || base === 'index.mjs' || base === 'index.ts') candidates.push(path.dirname(sourcePath));
    }
    candidates.push(path.join(this.pluginsDir, row.id));
    if (row.name) candidates.push(path.join(this.pluginsDir, row.name));
    let finalPath: string | null = null;
    let entryFile = 'index.js';
    for (const c of candidates) {
      if (!c) continue;
      try {
        if (!fs.existsSync(c)) continue;
        if (fs.existsSync(path.join(c, 'index.mjs'))) { finalPath = c; entryFile = 'index.mjs'; break; }
        if (fs.existsSync(path.join(c, 'index.js'))) { finalPath = c; entryFile = 'index.js'; break; }
        if (fs.existsSync(path.join(c, 'index.ts'))) { finalPath = c; entryFile = 'index.ts'; break; }
        if (fs.existsSync(path.join(c, 'src', 'index.ts'))) { finalPath = c; entryFile = 'src/index.ts'; break; }
      } catch { continue; }
    }
    if (!finalPath) {
      // 目录/入口已失效且插件处于禁用状态时跳过（容忍孤儿记录），启用状态则报错
      if (row.enabled !== 1) {
        logger.warn(`ZIP plugin ${id} entry not found, skipped (disabled): ${row.source_path}`);
        return;
      }
      throw new Error(`Zip plugin entry not found: ${row.source_path} (tried: ${candidates.join(', ')})`);
    }
    if (finalPath !== sourcePath) {
      logger.info(`Zip plugin path fallback: ${row.source_path} -> ${finalPath}`);
    }
    const entryPath = path.join(finalPath, entryFile);
    const fullPath = path.resolve(entryPath);

    const ctx = this.createPluginContext(id);
    // 动态 import 带时间戳参数避免命中 Node 模块缓存（覆盖上传/重载后仍加载最新代码）
    const mod = (entryFile.endsWith('.ts'))
      ? await this.loadTsModule(fullPath)
      : await this.dynImport(pathToFileURL(fullPath).href + '?v=' + Date.now());
    const pluginExport = mod.default || mod;

    if (!pluginExport) {
      throw new Error('Plugin entry is empty');
    }

    // NapCat 兼容插件（导出 plugin_init/plugin_onmessage，NapCatQQ 插件格式）
    if (isNapcatModule(pluginExport)) {
      await this.loadNapcatPlugin(id, row.name || id, finalPath, pluginExport, row);
      return;
    }

    // 中间件格式插件（module.exports = function(ctx, next)）：包装为标准插件并订阅消息事件
    if (typeof pluginExport === 'function') {
      const mwPlugin = wrapMiddlewarePlugin(ctx, id, row.name || id, row.description || '', pluginExport);
      this.plugins.set(id, { plugin: mwPlugin, ctx, loaded: false });
      await mwPlugin.onEnable!(ctx);
      const entry = this.plugins.get(id);
      if (entry) entry.loaded = true;
      db.prepare('UPDATE plugins SET enabled = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
      this.eventBus.emit('plugin.enabled', { pluginId: id });
      logger.info(`Middleware plugin loaded: ${row.name || id} (${id})`);
      return;
    }

    pluginExport.manifest = ensurePluginManifest(pluginExport, { id, name: row.name || id, description: row.description });
    pluginExport.manifest.id = id;

    const plugin: Plugin = {
      manifest: pluginExport.manifest,
      onLoad: pluginExport.onLoad,
      onUnload: pluginExport.onUnload,
      onEnable: pluginExport.onEnable,
      onDisable: pluginExport.onDisable,
      methods: pluginExport.methods,
    };

    if (plugin.onLoad) {
      await plugin.onLoad(ctx);
    }

    this.plugins.set(id, { plugin, ctx, loaded: false });
    logger.info(`ZIP plugin loaded: ${plugin.manifest.name} (${id})`);

    if (plugin.onEnable) {
      await plugin.onEnable(ctx);
    }
    const entry = this.plugins.get(id);
    if (entry) entry.loaded = true;

    db.prepare('UPDATE plugins SET enabled = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    this.eventBus.emit('plugin.enabled', { pluginId: id });
    logger.info(`Plugin enabled: ${id}`);
  }

  /**
   * 加载 NapCatQQ 兼容插件：导出 plugin_init/plugin_onmessage/plugin_onevent/plugin_config_ui
   * 通过适配层构造 NapCat ctx（logger/configPath/NapCatConfig/actions/router），
   * 把本系统消息事件转换为 OneBot 事件后分发给插件。
   */
  private async loadNapcatPlugin(id: string, name: string, pluginPath: string, mod: any, row: any): Promise<void> {    const db = getDb();
    const ctx = this.createPluginContext(id);
    const napcat = await initNapcatPlugin(mod, { id, name, pluginPath, botApi: this.botApi, engine: this });

    const handler = (data: any) => napcat.dispatch(data);
    const listenerIds: string[] = [];
    listenerIds.push(ctx.eventBus.on('message.group', handler as any, { pluginId: id }));
    listenerIds.push(ctx.eventBus.on('message.c2c', handler as any, { pluginId: id }));
    const unregister = () => {
      try {
        for (const lid of listenerIds) ctx.eventBus.off(lid);
      } catch {}
    };

    this.plugins.set(id, {
      plugin: {
        manifest: { id, name, version: '1.0.0', description: row.description || 'NapCat 兼容插件', author: '' },
      },
      ctx,
      loaded: true,
      napcat: { schema: napcat.schema, unregister, mod, cleanup: napcat.cleanup },
    });

    db.prepare('UPDATE plugins SET enabled = 1, has_webui = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    this.eventBus.emit('plugin.enabled', { pluginId: id });
    logger.info(`NapCat plugin loaded: ${name} (${id})`);
  }

  /** NapCat 插件配置表单描述（plugin_config_ui 数组），无则返回空数组 */
  getNapcatSchema(id: string): any[] {
    const entry = this.plugins.get(id);
    return entry?.napcat?.schema || [];
  }

  /** 读 NapCat 插件 config.json（configPath 语义，与 NapCat 原样一致；插件导出 plugin_get_config 时优先） */
  getNapcatConfig(id: string): Record<string, any> {
    const entry = this.plugins.get(id);
    const napcatCtx: any = entry?.napcat?.mod ? entry.ctx : null;
    if (napcatCtx && typeof napcatCtx._getConfigImpl === 'function') {
      return napcatCtx._getConfigImpl();
    }
    return readNapcatConfig(id);
  }

  /** 写 NapCat 插件 config.json；插件导出 plugin_set_config 时优先，成功则触发 plugin_on_config_change 并重载 */
  setNapcatConfig(id: string, config: Record<string, any>): void {
    const entry = this.plugins.get(id);
    const oldCfg = this.getNapcatConfig(id);
    const napcatCtx: any = entry?.napcat?.mod ? entry.ctx : null;
    if (napcatCtx && typeof napcatCtx._setConfigImpl === 'function') {
      const ok = napcatCtx._setConfigImpl(config);
      if (ok === false) return;
    } else {
      writeNapcatConfig(id, config);
    }
    if (napcatCtx && typeof napcatCtx._notifyConfigChange === 'function') {
      napcatCtx._notifyConfigChange(oldCfg, config).catch((e: any) =>
        logger.error(`NapCat plugin ${id} on_config_change failed: ${e.message}`)
      );
    }
    const cur = this.plugins.get(id);
    if (cur?.napcat) {
      this.reload(id).catch((e: any) => logger.error(`NapCat plugin ${id} reload after config failed: ${e.message}`));
    }
  }

  /**
   * 加载单文件 .mjs 插件（ES Module），机制与 ZIP 插件的 index.mjs 一致：
   * 通过真实 import() 执行，支持 export default { manifest, onEnable }，也支持 NapCat 兼容插件
   */
  private async loadMjsPlugin(id: string): Promise<void> {
    const db = getDb();
    const row = db.prepare('SELECT * FROM plugins WHERE id = ?').get(id) as any;
    if (!row) throw new Error(`Plugin ${id} not found`);

    const file = path.join(this.pluginsDir, row.name + '.mjs');
    if (!fs.existsSync(file)) throw new Error(`MJS plugin entry not found: ${file}`);

    const ctx = this.createPluginContext(id);
    const mod = await this.dynImport(pathToFileURL(file).href + '?v=' + Date.now());
    const pluginExport = mod.default || mod;

    if (!pluginExport) {
      throw new Error('Plugin entry is empty');
    }

    // NapCat 兼容插件（导出 plugin_init/plugin_onmessage，NapCatQQ 插件格式）
    if (isNapcatModule(pluginExport)) {
      await this.loadNapcatPlugin(id, row.name || id, path.dirname(file), pluginExport, row);
      return;
    }

    // 中间件格式插件（module.exports = function(ctx, next)）：包装为标准插件并订阅消息事件
    if (typeof pluginExport === 'function') {
      const mwPlugin = wrapMiddlewarePlugin(ctx, id, row.name || id, row.description || '', pluginExport);
      this.plugins.set(id, { plugin: mwPlugin, ctx, loaded: false });
      await mwPlugin.onEnable!(ctx);
      const entry = this.plugins.get(id);
      if (entry) entry.loaded = true;
      db.prepare('UPDATE plugins SET enabled = 1, has_webui = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(this.hasPluginWebuiDir(row.name) ? 1 : 0, id);
      this.eventBus.emit('plugin.enabled', { pluginId: id });
      logger.info(`Middleware plugin loaded: ${row.name || id} (${id})`);
      return;
    }

    pluginExport.manifest = ensurePluginManifest(pluginExport, { id, name: row.name || id, description: row.description });
    pluginExport.manifest.id = id;

    const plugin: Plugin = {
      manifest: pluginExport.manifest,
      onLoad: pluginExport.onLoad,
      onUnload: pluginExport.onUnload,
      onEnable: pluginExport.onEnable,
      onDisable: pluginExport.onDisable,
      methods: pluginExport.methods,
    };

    if (plugin.onLoad) {
      await plugin.onLoad(ctx);
    }

    this.plugins.set(id, { plugin, ctx, loaded: false });
    logger.info(`MJS plugin loaded: ${plugin.manifest.name} (${id})`);

    if (plugin.onEnable) {
      await plugin.onEnable(ctx);
    }
    const entry = this.plugins.get(id);
    if (entry) entry.loaded = true;

    db.prepare('UPDATE plugins SET enabled = 1, has_webui = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(this.hasPluginWebuiDir(row.name) ? 1 : 0, id);
    this.eventBus.emit('plugin.enabled', { pluginId: id });
    logger.info(`Plugin enabled: ${id}`);
  }

  async enable(id: string, force = false): Promise<void> {
    const db = getDb();
    const row = db.prepare('SELECT * FROM plugins WHERE id = ?').get(id) as any;
    if (!row) throw new Error(`Plugin ${id} not found`);

    // 自动批准，不再检查 approved
    // if (row.approved !== 1) { // 注释掉，强制加载 }

    if (row.type === 'zip') {
      const existing = this.plugins.get(id);
      if (!force && existing?.loaded && !existing.error) return;
      if (force) await this.unload(id);
      await this.loadZipPlugin(id);
      return;
    }

    if (row.type === 'py') {
      const existing = this.plugins.get(id);
      if (!force && existing?.loaded && !existing.error) return;
      if (force) await this.unload(id);
      await this.loadPyPlugin(id);
      return;
    }

    if (row.type === 'file') {
      // 文件资源插件仅可查看/编辑，不可执行
      return;
    }

    let entry = this.plugins.get(id);
    if (!entry) {
      const jsFile = path.join(this.pluginsDir, row.name + '.js');
      const mjsFile = path.join(this.pluginsDir, row.name + '.mjs');
      if (fs.existsSync(mjsFile) && !fs.existsSync(jsFile)) {
        await this.loadMjsPlugin(id);
        entry = this.plugins.get(id);
        if (!entry) throw new Error(`Plugin ${id} failed to load`);
      } else {
        let code: string;
        if (fs.existsSync(jsFile)) {
          code = fs.readFileSync(jsFile, 'utf-8');
        } else {
          code = row.code || '';
          if (!code) throw new Error(`No code found for plugin ${id}`);
        }
        await this.loadFromCode(id, row.name, code, row.description, row.type, row.source_path, row.has_webui === 1, row.owner, true); // 强制 approved=true
        entry = this.plugins.get(id);
        if (!entry) throw new Error(`Plugin ${id} failed to load`);
      }
    }

    if (entry.loaded && entry.error === undefined) return;

    try {
      if (entry.plugin.onEnable) {
        await entry.plugin.onEnable(entry.ctx);
      }
      entry.loaded = true;
      entry.error = undefined;

      db.prepare('UPDATE plugins SET enabled = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);

      this.eventBus.emit('plugin.enabled', { pluginId: id });
      logger.info(`Plugin enabled: ${id}`);
    } catch (err: any) {
      entry.error = err.message;
      this.eventBus.emit('plugin.error', { pluginId: id, error: err.message });
      throw err;
    }
  }

  async disable(id: string): Promise<void> {
    const entry = this.plugins.get(id);
    if (!entry) {
      throw new Error(`Plugin ${id} not loaded`);
    }

    try {
      if (entry.plugin.onDisable) {
        await entry.plugin.onDisable(entry.ctx);
      }
      if (entry.napcat?.unregister) {
        entry.napcat.unregister();
      }
      if (entry.pyUnregister) {
        entry.pyUnregister();
      }
      if (entry.pyRuntime) {
        entry.pyRuntime.stop();
      }
    } catch (err: any) {
      logger.error(`Plugin ${id} onDisable failed: ${err.message}`);
    }

    entry.loaded = false;
    entry.error = undefined;

    const db = getDb();
    db.prepare('UPDATE plugins SET enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);

    this.eventBus.emit('plugin.disabled', { pluginId: id });
    logger.info(`Plugin disabled: ${id}`);
  }

  async reload(id: string): Promise<PluginInfo> {
    const db = getDb();
    const row = db.prepare('SELECT * FROM plugins WHERE id = ?').get(id) as any;

    if (!row) {
      throw new Error(`Plugin ${id} not found in database`);
    }

    await this.unload(id);
    if (row.type === 'zip') {
      await this.loadZipPlugin(id);
      const entry = this.plugins.get(id);
      const plugin = entry?.plugin;
      return {
        id, name: plugin?.manifest.name || row.name,
        version: plugin?.manifest.version || String(row.version),
        description: plugin?.manifest.description || row.description || '',
        author: plugin?.manifest.author || 'user',
        enabled: true, loaded: true, hasError: false,
        type: 'zip', has_webui: (row.has_webui === 1),
        approved: row.approved === 1,
        owner: row.owner || '',
      };
    } else if (row.type === 'py') {
      await this.loadPyPlugin(id);
      const entry = this.plugins.get(id);
      const plugin = entry?.plugin;
      return {
        id, name: plugin?.manifest.name || row.name,
        version: plugin?.manifest.version || String(row.version),
        description: plugin?.manifest.description || row.description || '',
        author: plugin?.manifest.author || 'user',
        enabled: true, loaded: true, hasError: false,
        type: 'py', has_webui: false,
        approved: row.approved === 1,
        owner: row.owner || '',
      };
    } else {
      const jsFile = path.join(this.pluginsDir, row.name + '.js');
      const mjsFile = path.join(this.pluginsDir, row.name + '.mjs');
      if (fs.existsSync(mjsFile) && !fs.existsSync(jsFile)) {
        await this.loadMjsPlugin(id);
        const entry2 = this.plugins.get(id);
        const plugin2 = entry2?.plugin;
        return {
          id, name: plugin2?.manifest.name || row.name,
          version: plugin2?.manifest.version || String(row.version),
          description: plugin2?.manifest.description || row.description || '',
          author: plugin2?.manifest.author || 'user',
          enabled: true, loaded: true, hasError: false,
          type: 'code', has_webui: (row.has_webui === 1),
          approved: row.approved === 1,
          owner: row.owner || '',
        };
      }
      let code: string;
      if (fs.existsSync(jsFile)) {
        code = fs.readFileSync(jsFile, 'utf-8');
      } else {
        code = row.code || '';
        if (!code) throw new Error(`No code found for plugin ${row.name}`);
      }
      return await this.loadFromCode(id, row.name, code, row.description, row.type, row.source_path, row.has_webui === 1, row.owner, true);
    }
  }

  async unload(id: string): Promise<void> {
    const entry = this.plugins.get(id);
    if (!entry) return;

    try {
      if (entry.plugin.onDisable) {
        await entry.plugin.onDisable(entry.ctx);
      }
    } catch (err: any) {
      logger.error(`Plugin ${id} onDisable during unload failed: ${err.message}`);
    }

    try {
      if (entry.plugin.onUnload) {
        await entry.plugin.onUnload(entry.ctx);
      }
    } catch (err: any) {
      logger.error(`Plugin ${id} onUnload failed: ${err.message}`);
    }

    // NapCat 兼容插件：卸载/重载时调用 plugin_cleanup(ctx)
    try {
      if (entry.napcat?.cleanup) {
        await entry.napcat.cleanup();
      }
    } catch (err: any) {
      logger.error(`Plugin ${id} plugin_cleanup failed: ${err.message}`);
    }

    // Python 插件：反注册事件监听并停止子进程
    try {
      if (entry.pyUnregister) entry.pyUnregister();
      if (entry.pyRuntime) entry.pyRuntime.stop();
    } catch (err: any) {
      logger.error(`Plugin ${id} py cleanup failed: ${err.message}`);
    }

    this.plugins.delete(id);
    this.eventBus.emit('plugin.unloaded', { pluginId: id });
    logger.info(`Plugin unloaded: ${id}`);
  }

  async deletePlugin(id: string): Promise<void> {
    const db = getDb();
    const row = db.prepare('SELECT * FROM plugins WHERE id = ?').get(id) as any;

    if (row && row.type === 'zip' && row.source_path) {
      try {
        if (fs.existsSync(row.source_path)) {
          fs.rmSync(row.source_path, { recursive: true, force: true });
        }
      } catch (e: any) { logger.warn(`Failed to delete plugin dir: ${e.message}`); }
    }

    if (row && row.type === 'file' && row.source_path) {
      try {
        if (fs.existsSync(row.source_path) && fs.statSync(row.source_path).isFile()) fs.unlinkSync(row.source_path);
      } catch (e: any) { logger.warn(`Failed to delete file plugin source: ${e.message}`); }
    }

    if (row && row.type !== 'zip') {
      const jsPath = path.join(this.pluginsDir, row.name + '.js');
      const mjsPath = path.join(this.pluginsDir, row.name + '.mjs');
      if (fs.existsSync(jsPath)) fs.unlinkSync(jsPath);
      if (fs.existsSync(mjsPath)) fs.unlinkSync(mjsPath);
      if (row.type === 'php') {
        const phpPath = path.join(this.pluginsDir, row.name);
        if (fs.existsSync(phpPath)) fs.unlinkSync(phpPath);
      }
      if (row.type === 'py') {
        // Python zip：删除 source_path 目录
        if (row.source_path) {
          try {
            const st = fs.statSync(row.source_path);
            if (st.isDirectory()) fs.rmSync(row.source_path, { recursive: true, force: true });
            else if (st.isFile()) fs.unlinkSync(row.source_path);
          } catch (e: any) { logger.warn(`Failed to delete py source: ${e.message}`); }
        }
        // 单文件 .py：pluginsDir/<name> 或 <name>.py
        for (const cand of [row.name, row.name + '.py', path.basename(row.name || '', '.py') + '.py']) {
          if (!cand || path.extname(cand) !== '.py') continue;
          const p = path.join(this.pluginsDir, cand);
          try { if (fs.existsSync(p) && fs.statSync(p).isFile()) fs.unlinkSync(p); } catch {}
        }
      }
    }

    await this.unload(id);
    db.prepare('DELETE FROM plugins WHERE id = ?').run(id);
    logger.info(`Plugin deleted: ${id}`);
  }

  async toggleEnabled(id: string): Promise<boolean> {
    const db = getDb();
    const row = db.prepare('SELECT enabled FROM plugins WHERE id = ?').get(id) as any;

    if (!row) {
      throw new Error(`Plugin ${id} not found`);
    }

    if (row.enabled === 1) {
      await this.disable(id);
      return false;
    } else {
      await this.enable(id);
      return true;
    }
  }

  getPluginCode(id: string): string | null {
    const db = getDb();
    const row = db.prepare('SELECT code FROM plugins WHERE id = ?').get(id) as any;
    return row ? row.code : null;
  }

  async testMessage(name: string, userId: string, userName: string, groupId: string | null, groupName: string | null, message: string, mode?: string, botId?: string): Promise<{ status: string; replies: string[]; messages: any[]; error?: string }> {
    const id = this.findPluginByName(name);
    if (!id) {
      throw new Error(`Plugin "${name}" not found`);
    }
    const entry = this.plugins.get(id);
    if (!entry || !entry.loaded) {
      throw new Error(`Plugin "${name}" is not loaded`);
    }

    const replies: string[] = [];
    const capturedMessages: any[] = [];

    const mockBotApi: Partial<BotAPI> = {
      sendMessage: async () => {},
      sendImageMessage: async () => {},
      sendPrivateMessage: async (openid: any, content: any) => {
        capturedMessages.push({ type: 'c2c_text', userId: openid, content });
        replies.push(content);
      },
      sendGroupMessage: async (groupOpenid: any, content: any) => {
        capturedMessages.push({ type: 'group_text', groupId: groupOpenid, content });
        replies.push(content);
      },
      sendKeyboardPrivate: async (openid: any, keyboard: any) => {
        capturedMessages.push({ type: 'c2c_keyboard', userId: openid, keyboard });
        replies.push('[键盘消息] ' + (keyboard?.rows?.length || 0) + ' 行按钮');
      },
      sendKeyboardGroup: async (groupOpenid: any, keyboard: any) => {
        capturedMessages.push({ type: 'group_keyboard', groupId: groupOpenid, keyboard });
        replies.push('[键盘消息] ' + (keyboard?.rows?.length || 0) + ' 行按钮');
      },
      sendMarkdownPrivate: async (openid: any, markdown: any) => {
        capturedMessages.push({ type: 'c2c_markdown', userId: openid, markdown });
        replies.push('[Markdown] ' + (markdown || '').substring(0, 80));
      },
      sendMarkdownGroup: async (groupOpenid: any, markdown: any) => {
        capturedMessages.push({ type: 'group_markdown', groupId: groupOpenid, markdown });
        replies.push('[Markdown] ' + (markdown || '').substring(0, 80));
      },
      sendGroupMarkdownWithImage: async (groupOpenid: any, markdown: any, imageUrl: any) => {
        capturedMessages.push({ type: 'group_markdown_image', groupId: groupOpenid, imageUrl, markdown });
        replies.push('[Markdown+头像] ' + (markdown || '').substring(0, 80));
        return true;
      },
      sendMenuCard: async (groupOpenid: any, menu: any) => {
        capturedMessages.push({ type: 'group_menu_image', groupId: groupOpenid, title: menu?.title });
        replies.push('[图片菜单] ' + (menu?.title || ''));
        return true;
      },
      muteMember: async (groupOpenid: any, memberOpenid: any, duration: any) => {
        capturedMessages.push({ type: 'mute', groupId: groupOpenid, memberId: memberOpenid, duration });
        replies.push('[群管] 禁言成员 ' + memberOpenid + ' ' + duration + '秒');
      },
      unmuteMember: async (groupOpenid: any, memberOpenid: any) => {
        capturedMessages.push({ type: 'unmute', groupId: groupOpenid, memberId: memberOpenid });
        replies.push('[群管] 解除禁言 ' + memberOpenid);
      },
      kickMember: async (groupOpenid: any, memberOpenid: any) => {
        capturedMessages.push({ type: 'kick', groupId: groupOpenid, memberId: memberOpenid });
        replies.push('[群管] 踢出成员 ' + memberOpenid);
      },
      setAnnouncement: async (groupOpenid: any, content: any) => {
        capturedMessages.push({ type: 'announce', groupId: groupOpenid, content });
        replies.push('[群公告] ' + (content || '').substring(0, 80));
      },
      deleteMessage: async (groupOpenid: any, messageId: any, hideTip: any) => {
        capturedMessages.push({ type: 'delete_msg', groupId: groupOpenid, messageId });
        replies.push('[撤回] 消息 ' + messageId);
      },
      muteAll: async (groupOpenid: any, enable: any, duration: any) => {
        capturedMessages.push({ type: 'mute_all', groupId: groupOpenid, enable });
        replies.push('[全禁] ' + (enable ? '开启' : '关闭'));
      },
      deleteAnnouncement: async (groupOpenid: any, messageId: any) => {
        capturedMessages.push({ type: 'delete_announce', groupId: groupOpenid, messageId });
        replies.push('[删除公告] ' + messageId);
      },
      getStatus: () => 'test',
      getGroupInfo: async (groupOpenid: any) => ({
        group_openid: groupOpenid,
        group_name: groupName || '测试群',
        group_avatar: '',
        member_count: 0,
        max_member_count: 0,
        owner_member_openid: '',
        is_owner: false,
        created_at: '',
        description: '',
      }),
      getGroupBotState: async (groupOpenid: any) => ({
        group_openid: groupOpenid,
        bot_member_openid: 'test_bot',
        bot_join_time: '',
        group_role_type: 4,
      }),
      getGroupMembers: async (groupOpenid: any) => [{
        member_openid: userId,
        member_join_time: '',
        robot_member_openid: 'test_bot',
        nick: userName,
        role: 'member',
      }],
    };

    let savedStorageGet: any = undefined;
    const plugins = this.plugins;
    const self = this;
    if (mode) {
      const powerId = self.findPluginByName('开关机控制');
      const powerEntry = powerId ? plugins.get(powerId) : undefined;
      if (powerEntry?.loaded && powerEntry.ctx?.storage) {
        savedStorageGet = powerEntry.ctx.storage.get;
        const overrideMode = (mode === 'text' || mode === 'image') ? mode : 'text';
        (powerEntry.ctx.storage as any).get = (key: string) => {
          if (key === 'global_mode') return overrideMode;
          return savedStorageGet.call(powerEntry.ctx.storage, key);
        };
      }
    }

    // 将 mock 方法注入到所有已加载插件的 ctx.bot 上
    const mockKeys = Object.keys(mockBotApi) as (keyof BotAPI)[];
    const savedBots: Array<{ bot: any; saved: Record<string, Function> }> = [];
    for (const [pid, pEntry] of plugins) {
      if (pEntry.loaded && pEntry.ctx && pEntry.ctx.bot) {
        const saved: Record<string, Function> = {};
        for (const key of mockKeys) {
          if (typeof (mockBotApi[key]) === 'function') {
            saved[key] = (pEntry.ctx.bot as any)[key];
            (pEntry.ctx.bot as any)[key] = (mockBotApi as any)[key];
          }
        }
        savedBots.push({ bot: pEntry.ctx.bot, saved });
      }
    }

    const eventData = {
      id: 'test_' + Date.now(),
      content: message,
      author: {
        id: userId,
        openid: userId,
        qqId: '',
        member_openid: '',
        username: userName,
      },
      timestamp: String(Date.now()),
      groupId: groupId || '',
      channelId: groupId || '',
      group_name: groupName || '',
      botId: botId || '',
    };

    const isGroup = !!groupId;
    const eventName = isGroup ? 'message.group' : 'message.c2c';

        try {
            await this.eventBus.emit(eventName, eventData, true);
        }
        catch (e) {
            restoreAllBots();
            restoreMode();
            return { status: 'error', replies, messages: capturedMessages, error: e instanceof Error ? e.message : String(e) };
        }

    restoreAllBots();
    restoreMode();
    return {
      status: capturedMessages.length > 0 ? 'replied' : (replies.length > 0 ? 'replied' : 'no_handler'),
      replies,
      messages: capturedMessages,
    };

    function restoreAllBots() {
      for (const item of savedBots) {
        for (const key of mockKeys) {
          if (item.saved[key] !== undefined) {
            (item.bot as any)[key] = item.saved[key];
          }
        }
      }
    }
    function restoreMode() {
      if (savedStorageGet !== undefined) {
        const pid = self.findPluginByName('开关机控制');
        if (pid) {
          const powerEntry = plugins.get(pid);
          if (powerEntry?.loaded && powerEntry.ctx?.storage) {
            (powerEntry.ctx.storage as any).get = savedStorageGet;
          }
        }
      }
    }
  }

  /**
   * 通过 esbuild 将 TypeScript 插件入口转译打包为 ESM 后动态加载。
   * 支持单文件 index.ts 与 src/index.ts 多文件工程（相对导入会被 bundle 内联，
   * node_modules 依赖按 packages:'external' 在运行时解析）。
   */
  private async loadTsModule(entryPath: string): Promise<any> {
    const os = require('os') as typeof import('os');
    const crypto = require('crypto') as typeof import('crypto');
    let esbuild: any;
    try {
      esbuild = require('esbuild');
    } catch {
      throw new Error('TypeScript 插件加载需要 esbuild，请确认已安装该依赖');
    }
    const outfile = path.join(os.tmpdir(), `qbot-ts-${crypto.randomUUID()}.mjs`);
    try {
      esbuild.buildSync({
        entryPoints: [entryPath],
        bundle: true,
        format: 'esm',
        platform: 'node',
        target: 'node18',
        outfile,
        packages: 'external',
        logLevel: 'silent',
        sourcemap: 'inline',
      });
      const mod = await this.dynImport(pathToFileURL(outfile).href);
      return mod.default || mod;
    } finally {
      try { fs.unlinkSync(outfile); } catch {}
    }
  }

  /**
   * 实时派生超主 OpenID：按当前触发机器人（currentBotId）从 user_mappings 反查超主 QQ 的 openid，
   * 找不到则回退 admin.json 中超主记录的 openid。多机器人下每个机器人给同一用户分配独立 OpenID，
   * 固定返回单一 openid 会导致超主在非 admin.json.openid 所属机器人上被判定为非主人。
   */
  private deriveSuperMasterId(): { id: string; name: string } | null {
    try {
      const file = path.resolve(process.cwd(), 'data', 'admin.json');
      if (!fs.existsSync(file)) return null;
      const admins = JSON.parse(fs.readFileSync(file, 'utf-8')) as any[];
      const s = (admins || []).find((a: any) => a && a.role === 'super_master');
      if (!s) return null;
      const name = s.nickname || s.username || '超级主人';
      let curBotId = '';
      try { curBotId = getCurrentBotId(); } catch {}
      // 权威 QQ：优先 admin.json.qq；qq 缺失/有误时从 admin.json.openid 在 user_mappings 的记录反查真实 QQ
      let qq = String(s.qq || '').trim();
      if (!qq && s.openid) {
        try {
          const m = getMappingByOpenid(String(s.openid).trim());
          if (m && m.qq_number) qq = m.qq_number;
        } catch {}
      }
      if (qq) {
        const openids = getOpenidsByQQ(qq);
        if (openids.length) {
          if (curBotId) {
            const match = openids.find((o) => o.bot_id === curBotId);
            if (match) return { id: match.openid, name };
          }
          return { id: openids[0].openid, name };
        }
      }
      const id = String(s.openid || '').trim();
      if (id) return { id, name };
      return null;
    } catch {
      return null;
    }
  }

  getPluginConfig(id: string): Record<string, string> {
    const db = getDb();
    const rows = db.prepare(
      "SELECT key, value FROM config WHERE key LIKE ?"
    ).all(`plugin.${id}.%`) as any[];
    const config: Record<string, string> = {};
    const prefix = `plugin.${id}.`;
    for (const row of rows) {
      config[row.key.substring(prefix.length)] = row.value;
    }
    return config;
  }

  setPluginConfig(id: string, key: string, value: string): void {
    const db = getDb();
    const fullKey = `plugin.${id}.${key}`;
    db.prepare(
      'INSERT INTO config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP'
    ).run(fullKey, value);
  }

  isEnabled(id: string): boolean {
    const entry = this.plugins.get(id);
    return entry ? entry.loaded : false;
  }

  findPluginByName(name: string): string | null {
    const db = getDb();
    const row = db.prepare('SELECT id FROM plugins WHERE name = ?').get(name) as any;
    if (row) return row.id;
    // 兼容带扩展名的查找（如 PHP 插件 name 为 xxx.php，面板传 xxx）
    const rowExt = db.prepare('SELECT id FROM plugins WHERE name = ?').get(name + '.php') as any;
    return rowExt ? rowExt.id : null;
  }

  getPluginSourcePath(id: string): string | null {
    const db = getDb();
    const row = db.prepare('SELECT source_path, name, type FROM plugins WHERE id = ?').get(id) as any;
    if (!row) return null;
    if (row.type === 'zip' && row.source_path) return row.source_path;
    // 单文件插件（.js/.mjs）：webui 使用同名子目录 plugins/{name}/
    const dir = path.join(this.pluginsDir, row.name);
    if (fs.existsSync(path.join(dir, 'webui'))) return dir;
    return null;
  }

  /** NapCat 插件互操作：返回其他已加载插件的导出对象（NapCat mod 或 Plugin 对象） */
  getPluginExports(id: string): any {
    const entry = this.plugins.get(id);
    if (!entry) return undefined;
    if (entry.napcat?.mod) return entry.napcat.mod;
    if (entry.plugin) return entry.plugin;
    return undefined;
  }

  /** 以插件自身 ctx 调用其方法（供定时任务「读取插件播报」等后端场景使用） */
  async callPluginMethod(name: string, method: string, ...args: any[]): Promise<any> {
    const id = this.findPluginByName(name);
    if (!id) throw new Error(`Plugin "${name}" not found`);
    const entry = this.plugins.get(id);
    if (!entry || !entry.loaded || !entry.ctx) throw new Error(`Plugin "${name}" is not loaded`);
    const mod = entry.plugin as any;
    const methods = mod?.methods || mod;
    const fn = methods?.[method];
    if (typeof fn !== 'function') throw new Error(`Plugin "${name}" has no method "${method}"`);
    return fn.call(methods, entry.ctx, ...args);
  }

  /** 返回插件当前状态摘要，供 NapCat pluginManager.getPlugin 使用 */
  getPluginInfo(id: string): any {
    const entry = this.plugins.get(id);
    if (!entry) return null;
    const db = getDb();
    const row = db.prepare('SELECT * FROM plugins WHERE id = ?').get(id) as any;
    return {
      id,
      name: row?.name || entry.plugin?.manifest?.name || id,
      version: entry.plugin?.manifest?.version || String(row?.version || ''),
      description: row?.description || entry.plugin?.manifest?.description || '',
      enabled: row ? row.enabled === 1 : entry.loaded,
      loaded: entry.loaded,
    };
  }

  /** 单文件插件是否存在同名子目录 webui（插件管理页「设置」按钮依赖 has_webui） */
  private hasPluginWebuiDir(name: string): boolean {
    const dir = path.join(this.pluginsDir, name);
    if (!fs.existsSync(dir)) return false;
    if (fs.existsSync(path.join(dir, 'webui'))) return true;
    try {
      const pkgPath = path.join(dir, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (typeof pkg.webui === 'string' && fs.existsSync(path.join(dir, pkg.webui))) return true;
      }
    } catch {}
    return false;
  }

  /** 注册并启用一个单文件 .mjs 插件（文件须已写入 plugins/{name}.mjs） */
  async registerMjsFile(name: string, description?: string): Promise<string> {
    const db = getDb();
    const id = 'file-' + name;
    const mjsPath = path.join(this.pluginsDir, name + '.mjs');
    if (!fs.existsSync(mjsPath)) throw new Error(`MJS file not found: ${mjsPath}`);
    const existing = db.prepare('SELECT id FROM plugins WHERE id = ?').get(id);
    if (!existing) {
      db.prepare(
        `INSERT INTO plugins (id, name, description, code, enabled, version, type, has_webui, approved, owner)
         VALUES (?, ?, ?, '', 0, 1, 'code', ?, 1, 'system')`
      ).run(id, name, description || '', this.hasPluginWebuiDir(name) ? 1 : 0);
      logger.info(`Registered MJS plugin: ${name} -> ${id}`);
    } else {
      db.prepare('UPDATE plugins SET has_webui = ?, description = COALESCE(?, description) WHERE id = ?')
        .run(this.hasPluginWebuiDir(name) ? 1 : 0, description || null, id);
    }
    await this.enable(id);
    return id;
  }

  async registerPyFile(name: string, code?: string, description?: string): Promise<string> {
    const db = getDb();
    const fileName = name.endsWith('.py') ? name : name + '.py';
    const id = 'file-' + path.basename(fileName, '.py');
    const pyPath = path.join(this.pluginsDir, fileName);
    if (code !== undefined) {
      fs.writeFileSync(pyPath, code, 'utf-8');
    }
    if (!fs.existsSync(pyPath)) throw new Error(`Python file not found: ${pyPath}`);
    const existing = db.prepare('SELECT id FROM plugins WHERE id = ?').get(id);
    if (!existing) {
      db.prepare(
        `INSERT INTO plugins (id, name, description, code, enabled, version, type, source_path, has_webui, approved, owner)
         VALUES (?, ?, ?, '', 0, 1, 'py', ?, 0, 1, 'system')`
      ).run(id, fileName, description || '', pyPath);
      logger.info(`Registered Python plugin: ${fileName} -> ${id}`);
    } else {
      db.prepare('UPDATE plugins SET source_path = ?, name = ?, description = COALESCE(?, description) WHERE id = ?')
        .run(pyPath, fileName, description || null, id);
    }
    await this.enable(id);
    return id;
  }

  /** 历史数据兼容回退：当前实例 key 无值时，按插件名查同 name 的其它（旧 uuid/zip 上传、已被去重禁用）实例在 config 表的历史 key。
   *  解决 4.2.52 去重（只保留 file- 实例）后，签到积分/最近签到等历史数据仍被旧 uuid key 持有而读不到的问题。 */
  private fallbackConfigByPluginName(name: string, key: string): string | null {
    try {
      const db = getDb();
      const rows = db.prepare("SELECT id FROM plugins WHERE type = 'code' AND name = ?").all(String(name || '')) as any[];
      for (const r of rows) {
        const oid = String(r.id || '');
        if (oid.indexOf('file-') === 0) continue;
        const k = this.sharedPermKeys.has(key) ? key : `plugin.${oid}.${key}`;
        const row = db.prepare('SELECT value FROM config WHERE key = ?').get(k) as any;
        if (row && row.value) return row.value;
      }
    } catch (e) { /* 忽略 */ }
    return null;
  }

  private createPluginContext(pluginId: string): PluginContext {
    // 权限类 key 跨插件共享（一处设置，所有插件生效）：super_master_id/mini_masters/members 存全局无前缀 key
    // global_mode 同样全局共享：所有插件的 storage.get('global_mode') 读到同一份全局模式
    const SHARED_PERM_KEYS = this.sharedPermKeys;
    const storage: PluginStorage = {
      get: (key: string) => {
        const db = getDb();
        const realKey = SHARED_PERM_KEYS.has(key) ? key : `plugin.${pluginId}.${key}`;
        // super_master_id 优先实时派生：多机器人下不同 AppID 给同一用户分配不同 OpenID，
        // 必须按当前触发机器人（currentBotId）从 user_mappings 反查超主 QQ 匹配 openid，
        // 否则超主在非主机器人（非 admin.json.openid 所属机器人）上会被插件识别为非主人。
        // 派生结果与用户显式配置/历史写入值语义等价（单机器人时均为同一 openid）。
        if (key === 'super_master_id') {
          const derived = this.deriveSuperMasterId();
          if (derived) return JSON.stringify(derived);
        }
        const row = db.prepare(
          'SELECT value FROM config WHERE key = ?'
        ).get(realKey) as any;
        if (row && row.value) return row.value;
        // 回退：读不到当前实例 key 时，尝试同插件名其它历史实例（uuid/zip 上传）的数据
        if (!SHARED_PERM_KEYS.has(key)) {
          try {
            const entry = this.plugins.get(pluginId);
            const pname = entry && entry.plugin && entry.plugin.manifest ? entry.plugin.manifest.name : '';
            if (pname) {
              const fallback = this.fallbackConfigByPluginName(pname, key);
              if (fallback != null) return fallback;
            }
          } catch (e) { /* 忽略 */ }
        }
        if (key === 'super_master_id') {
          // 兜底：无显式配置且 admin.json 派生失败时返回 null
        }
        return null;
      },
      set: (key: string, value: string) => {
        const db = getDb();
        const realKey = SHARED_PERM_KEYS.has(key) ? key : `plugin.${pluginId}.${key}`;
        db.prepare(
          'INSERT INTO config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP'
        ).run(realKey, value);
      },
      delete: (key: string) => {
        const db = getDb();
        const realKey = SHARED_PERM_KEYS.has(key) ? key : `plugin.${pluginId}.${key}`;
        db.prepare('DELETE FROM config WHERE key = ?').run(realKey);
      },
    };

    const engineApi: PluginEngineAPI = {
      enableAllExcept: async (exceptId: string) => {
        const db = getDb();
        const rows = db.prepare('SELECT id FROM plugins WHERE id != ? AND enabled != 1').all(exceptId) as any[];
        for (const row of rows) {
          try {
            await this.enable(row.id);
          } catch (err: any) {
            logger.warn(`Failed to enable ${row.id}: ${err.message}`);
          }
        }
      },
      disableAllExcept: async (exceptId: string) => {
        const db = getDb();
        const rows = db.prepare('SELECT id FROM plugins WHERE id != ? AND enabled = 1').all(exceptId) as any[];
        for (const row of rows) {
          try {
            await this.disable(row.id);
          } catch (err: any) {
            logger.warn(`Failed to disable ${row.id}: ${err.message}`);
          }
        }
      },
      isAllOthersEnabled: (exceptId: string) => {
        const db = getDb();
        const rows = db.prepare('SELECT id, enabled FROM plugins WHERE id != ?').all(exceptId) as any[];
        if (rows.length === 0) return true;
        for (const row of rows) {
          if (row.enabled !== 1) return false;
        }
        return true;
      },
      isAllOthersDisabled: (exceptId: string) => {
        const db = getDb();
        const rows = db.prepare('SELECT id, enabled FROM plugins WHERE id != ?').all(exceptId) as any[];
        for (const row of rows) {
          if (row.enabled === 1) return false;
        }
        return true;
      },
      callPlugin: async (name: string, method: string, ...args: any[]) => {
        const depth = (callStackStorage.getStore() || 0) + 1;
        if (depth > 20) {
          logger.error(`[plugin-engine] callPlugin recursion limit exceeded (>20): ${name}.${method}`);
          return undefined;
        }
        return callStackStorage.run(depth, async () => {
          for (const [id, entry] of this.plugins) {
            if (!entry.loaded) continue;
            if (entry.plugin.manifest.name === name || entry.plugin.manifest.id === name) {
              if (entry.plugin.methods && entry.plugin.methods[method]) {
                return entry.plugin.methods[method](entry.ctx, ...args);
              }
              throw new Error(`Plugin "${name}" has no method "${method}"`);
            }
          }
          throw new Error(`Plugin "${name}" not found or not loaded`);
        });
      },
      findPluginByName: (name: string) => {
        return this.findPluginByName(name);
      },
      getPluginStorage: (target: string, key: string) => {
        const db = getDb();
        const candidates: string[] = [];
        for (const [id, entry] of this.plugins) {
          if (!entry.loaded) continue;
          if (entry.plugin.manifest.name === target || entry.plugin.manifest.id === target) candidates.push(id);
        }
        // 同一名称可能存在多个实例（zip 上传 uuid + 文件 file-），优先文件插件，其次回退其它实例
        candidates.sort((a, b) => (a.indexOf('file-') === 0 ? -1 : 1) - (b.indexOf('file-') === 0 ? -1 : 1));
        for (const id of candidates) {
          const realKey = SHARED_PERM_KEYS.has(key) ? key : `plugin.${id}.${key}`;
          const row = db.prepare('SELECT value FROM config WHERE key = ?').get(realKey) as any;
          if (row && row.value) return row.value;
        }
        // 回退：DB 中同插件名但未加载/已禁用的历史实例（uuid）持有的数据（如去重前的签到积分）
        if (!SHARED_PERM_KEYS.has(key)) {
          const fallback = this.fallbackConfigByPluginName(target, key);
          if (fallback != null) return fallback;
        }
        return null;
      },
      enable: async (id: string) => {
        await this.enable(id);
      },
      disable: async (id: string) => {
        await this.disable(id);
      },
      reload: async (id: string) => {
        return await this.reload(id);
      },
      getPluginConfig: (id: string) => {
        return this.getPluginConfig(id);
      },
      setPluginConfig: (id: string, key: string, value: string) => {
        this.setPluginConfig(id, key, value);
      },
      getGlobalMode: () => {
        try {
          const row = getDb().prepare("SELECT value FROM config WHERE key = 'global_mode'").get() as any;
          if (row && row.value) return row.value === 'text_link' ? 'text' : row.value;
        } catch {}
        return 'text';
      },
      setGlobalMode: (mode: string) => {
        // text_link 模式已移除，统一归一化为 text
        const m = (mode === 'text' || mode === 'image') ? mode : 'text';
        try {
          getDb().prepare(
            "INSERT INTO config (key, value, updated_at) VALUES ('global_mode', ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP"
          ).run(m);
          logger.info(`Global mode set to: ${m}`);
        } catch (e: any) {
          logger.warn(`setGlobalMode failed: ${e.message}`);
        }
      },
      getPanelBaseUrl: () => {
        try {
          const host = getConfig('panel.host') || '';
          if (!host) return '';
          return host.startsWith('http') ? host.replace(/\/+$/, '') : 'https://' + host.replace(/\/+$/, '');
        } catch { return ''; }
      },
      // ---- 全局文字外显模式（所有插件共享）：on=外显文字渲染为 mqqapi 链接，off=纯文本 ----
      getLinkMode: () => {
        try {
          const row = getDb().prepare("SELECT value FROM config WHERE key = 'global_link_mode'").get() as any;
          if (row && row.value) return String(row.value) === 'off' ? 'off' : 'on';
        } catch {}
        return 'on';
      },
      setLinkMode: (mode: string) => {
        const m = String(mode || 'on') === 'off' ? 'off' : 'on';
        try {
          getDb().prepare(
            "INSERT INTO config (key, value, updated_at) VALUES ('global_link_mode', ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP"
          ).run(m);
          logger.info(`Global link mode set to: ${m}`);
        } catch (e: any) {
          logger.warn(`setLinkMode failed: ${e.message}`);
        }
      },
      // 生成菜单链接 markdown：type='link' 直接跳转；否则 mqqapi inlinecmd 回填指令（enter=false 不自动发送，reply=false 不引用）
      menuLink: (label: string, item: { type?: string; value: string }) => {
        const type = (item && item.type) || 'cmd';
        let value = String((item && item.value) || '');
        if (type === 'link') return `[${label}](${value})`;
        if (type === 'image') value = '__img:' + value;
        else if (type === 'page') value = '__page:' + value;
        else if (type === 'plugin') value = '__call:' + value;
        return `[${label}](mqqapi://aio/%69nlinecmd?command=${encodeURIComponent(value)}&enter=false&reply=false)`;
      },
      // 按全局文字外显模式渲染外显文字：on 返回 mqqapi 链接，off 返回原文本
      linkify: (text: string, cmd: string) => {
        try {
          const row = getDb().prepare("SELECT value FROM config WHERE key = 'global_link_mode'").get() as any;
          if (row && row.value && String(row.value) === 'off') return String(text == null ? '' : text);
        } catch {}
        return `[${text}](mqqapi://aio/%69nlinecmd?command=${encodeURIComponent(String(cmd == null ? '' : cmd))}&enter=false&reply=false)`;
      },
      buildClickUrl: (groupOpenid: string, userOpenid: string, action: string) => {
        try {
          const base = getConfig('panel.host') || '';
          if (!base) return '';
          const baseUrl = base.startsWith('http') ? base.replace(/\/+$/, '') : 'https://' + base.replace(/\/+$/, '');
          const sig = signClickPayload(groupOpenid, userOpenid, action);
          return `${baseUrl}/click?g=${encodeURIComponent(groupOpenid)}&u=${encodeURIComponent(userOpenid)}&d=${encodeURIComponent(action)}&s=${sig}`;
        } catch { return ''; }
      },
      getBotName: () => {
        try { return getConfig('bot.name') || '空空爱追剧'; } catch { return '空空爱追剧'; }
      },
      // 按机器人 AppID 查名称（data/bots.json registry，未登记回退 config bot.name）
      getBotNameById: (botId: string) => {
        try {
          const file = path.resolve(process.cwd(), 'data', 'bots.json');
          if (fs.existsSync(file)) {
            const bots = JSON.parse(fs.readFileSync(file, 'utf-8')) as any[];
            if (Array.isArray(bots)) {
              const hit = bots.find((b) => b && String(b.appId || b.app_id || '') === String(botId || ''));
              if (hit && (hit.name || hit.appName)) return String(hit.name || hit.appName);
            }
          }
        } catch {}
        return getConfig('bot.name') || '空空爱追剧';
      },
      getGroupName: (groupOpenid: string) => {
        try {
          const row = getDb().prepare('SELECT name FROM groups WHERE id = ?').get(groupOpenid || '') as any;
          return (row && row.name) ? String(row.name) : '';
        } catch { return ''; }
      },
      getGroupNumber: (groupOpenid: string) => {
        try {
          const row = getDb().prepare('SELECT group_number FROM groups WHERE id = ?').get(groupOpenid || '') as any;
          return (row && row.group_number) ? String(row.group_number) : '';
        } catch { return ''; }
      },
      getConfigValue: (key: string) => {
        try { return getConfig(key) || ''; } catch { return ''; }
      },
      setConfigValue: (key: string, value: string) => {
        try { setConfig(key, String(value)); return true; } catch { return false; }
      },
      // ---- 全局用户自定义变量（面板「插件卡片·后台编辑器」变量管理创建，供各插件调用） ----
      getVariable: (name: string) => {
        try {
          const vars = readPluginVars();
          const k = String(name || '').trim();
          return Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : null;
        } catch { return null; }
      },
      setVariable: (name: string, value: string) => {
        try {
          const k = String(name || '').trim();
          if (!k) return false;
          const vars = readPluginVars();
          vars[k] = String(value ?? '');
          setConfig(VARS_KEY, JSON.stringify(vars));
          return true;
        } catch { return false; }
      },
      listVariables: () => {
        try { return readPluginVars(); } catch { return {}; }
      },
      // ---- 成员解析（头像/禁言/踢人目标解析用） ----
      getGroupMemberAvatar: (groupId: string, openid: string) => {
        try {
          const db = getDb();
          const row = db.prepare('SELECT qq_id FROM group_members WHERE group_id = ? AND member_openid = ?').get(groupId || '', openid || '') as any;
          const qq = row && row.qq_id && /^\d{5,12}$/.test(String(row.qq_id)) ? String(row.qq_id) : '';
          if (qq) return `https://q1.qlogo.cn/g?b=qq&nk=${qq}&s=640`;
          const m = getMappingByOpenid(openid || '');
          const mq = (m && m.qq_number) || '';
          if (mq) return `https://q1.qlogo.cn/g?b=qq&nk=${mq}&s=640`;
          return '';
        } catch { return ''; }
      },
      resolveOpenidByQq: (qq: string) => {
        try {
          const q = String(qq || '').trim();
          if (!/^\d{5,12}$/.test(q)) return null;
          const db = getDb();
          const r1 = db.prepare('SELECT openid FROM user_mappings WHERE qq_number = ? ORDER BY last_updated DESC LIMIT 1').get(q) as any;
          if (r1 && r1.openid) return String(r1.openid);
          const r2 = db.prepare('SELECT member_openid FROM group_members WHERE qq_id = ? AND member_openid != "" ORDER BY last_seen DESC LIMIT 1').get(q) as any;
          if (r2 && r2.member_openid) return String(r2.member_openid);
          return null;
        } catch { return null; }
      },
      getGroupMemberOpenidByNickname: (groupId: string, nickname: string) => {
        try {
          const n = String(nickname || '').trim();
          if (!n) return null;
          const db = getDb();
          const rows = db.prepare('SELECT member_openid, nickname FROM group_members WHERE group_id = ? AND (nickname LIKE ? OR member_openid = ?) ORDER BY last_seen DESC LIMIT 5').all(groupId || '', `%${n}%`, n) as any[];
          if (!rows || !rows.length) return null;
          for (const r of rows) { if (String(r.nickname || '') === n) return String(r.member_openid); }
          return String(rows[0].member_openid);
        } catch { return null; }
      },
      // ---- 插件按群开关（群内回填式配置用） ----
      listAssignedPlugins: (botId: string) => {
        try {
          const db = getDb();
          const hasRec = db.prepare('SELECT COUNT(*) AS c FROM bot_plugins WHERE bot_id = ?').get(botId || '') as any;
          let rows: any[] = [];
          if (!hasRec || hasRec.c === 0) {
            rows = db.prepare('SELECT id, name FROM plugins WHERE enabled = 1 ORDER BY name').all() as any[];
          } else {
            rows = db.prepare(
              'SELECT p.id, p.name FROM bot_plugins b JOIN plugins p ON p.id = b.plugin_id WHERE b.bot_id = ? AND b.assigned = 1 ORDER BY p.name'
            ).all(botId || '') as any[];
          }
          return (rows || []).filter((r: any) => r && r.name && r.name !== '新版菜单').map((r: any) => ({ id: r.id, name: String(r.name) }));
        } catch { return []; }
      },
      setPluginGroupMode: (pluginId: string, groupId: string, mode: string) => {
        try {
          const db = getDb();
          const m = (mode === 'allow' || mode === 'deny') ? mode : '';
          if (!m) {
            db.prepare('DELETE FROM plugin_group_config WHERE plugin_id = ? AND group_id = ?').run(pluginId || '', groupId || '');
          } else {
            db.prepare(
              `INSERT INTO plugin_group_config (plugin_id, group_id, mode, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(plugin_id, group_id) DO UPDATE SET mode = excluded.mode, updated_at = CURRENT_TIMESTAMP`
            ).run(pluginId || '', groupId || '', m);
          }
          resetGroupPolicyCache(pluginId);
          return { ok: true, mode: m || 'follow' };
        } catch (e: any) { return { ok: false, error: e.message }; }
      },
      getPluginGroupMode: (pluginId: string, groupId: string) => {
        try { return getPluginGroupMode(pluginId, groupId); } catch { return null; }
      },
      getGroupMemberRole: (groupId: string, memberOpenid: string) => {
        try {
          const row = getDb().prepare('SELECT role FROM group_members WHERE group_id = ? AND member_openid = ?').get(groupId || '', memberOpenid || '') as any;
          return (row && row.role) ? String(row.role) : '';
        } catch { return ''; }
      },
      findGroupOwner: (groupId: string) => {
        try {
          const row = getDb().prepare("SELECT member_openid AS openid, qq_id, nickname, role FROM group_members WHERE group_id = ? AND role IN ('owner','super') ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END LIMIT 1").get(groupId || '') as any;
          return row ? { openid: String(row.openid || ''), qq_id: String(row.qq_id || ''), nickname: String(row.nickname || ''), role: String(row.role || 'owner') } : null;
        } catch { return null; }
      },
      // ---- 用户信息聚合（复读插件/用户管理用）：OpenID→QQ/昵称/头像/权限/授权码/运行日志 ----
      getUserProfile: (openid: string, limit = 10) => {
        try {
          const db = getDb();
          const m = getMappingByOpenid(openid || '');
          let qq = (m && m.qq_number) || getQQByOpenid(openid || '') || '';
          let nickname = (m && m.nickname) || '';
          // 昵称/QQ 回退：绑定记录缺失时，用群成员表中最近发言记录的群昵称/QQ，避免显示「未绑定昵称」
          if (!nickname || !qq) {
            try {
              const gm = db.prepare(
                'SELECT nickname, qq_id FROM group_members WHERE member_openid = ? AND (nickname != \'\' OR qq_id != \'\') ORDER BY last_seen DESC LIMIT 1'
              ).get(openid || '') as any;
              if (gm) {
                if (!nickname && gm.nickname) nickname = String(gm.nickname);
                if (!qq && gm.qq_id) qq = String(gm.qq_id);
              }
            } catch (e) {}
          }
          const avatar = qq ? `https://q1.qlogo.cn/g?b=qq&nk=${qq}&s=640` : '';
          let permission = '';
          try {
            const roleMap = loadAdminRoleByQQ();
            permission = roleMap.get(qq) || roleMap.get(openid) || '';
          } catch {}
          let authCode = '';
          let authRole = '';
          try {
            const ac = db.prepare("SELECT code, role FROM auth_codes WHERE used_by = ? LIMIT 1").get(openid || '') as any;
            if (ac) { authCode = ac.code || ''; authRole = ac.role || ''; }
            else if (qq) {
              const ac2 = db.prepare("SELECT code, role FROM auth_codes WHERE used_by = ? LIMIT 1").get(qq) as any;
              if (ac2) { authCode = ac2.code || ''; authRole = ac2.role || ''; }
            }
          } catch {}
          const logs = querySystemLogs(limit, undefined, undefined, undefined).filter((l: any) => l.user_id === openid);
          return {
            openid: openid || '',
            qq_number: qq,
            nickname,
            avatar,
            permission,
            auth_code: authCode,
            auth_role: authRole,
            logs,
          };
        } catch { return null; }
      },
      // 绑定 OpenID → QQ（写入 user_mappings，同步 admin.json/group_members）
      bindUserQQ: (openid: string, qq: string, nickname?: string) => {
        try {
          const db = getDb();
          if (!openid || !qq) return { ok: false, error: 'openid 与 qq 均不能为空' };
          updateMemberBinding(openid, String(qq));
          if (nickname) {
            db.prepare('UPDATE user_mappings SET nickname = ? WHERE openid = ?').run(String(nickname).substring(0, 50), openid);
          }
          return { ok: true };
        } catch (e: any) { return { ok: false, error: e.message }; }
      },
      // 解绑 OpenID → QQ（清除 user_mappings + group_members + admin.json 关联）
      unbindUser: (openid: string) => {
        try {
          if (!openid) return { ok: false, error: 'openid 不能为空' };
          removeMemberBinding(openid);
          return { ok: true };
        } catch (e: any) { return { ok: false, error: e.message }; }
      },
      // 群 OpenID → 数字群号绑定（写入 groups.group_number，群不存在时自动收录）
      bindGroupNumber: (groupOpenid: string, groupNumber: string, name?: string) => {
        try {
          const db = getDb();
          if (!groupOpenid) return { ok: false, error: '群 OpenID 不能为空' };
          const num = String(groupNumber || '').trim();
          if (!/^\d{6,15}$/.test(num)) return { ok: false, error: 'QQ 群号应为 6-15 位数字' };
          const row = db.prepare('SELECT id FROM groups WHERE id = ?').get(groupOpenid) as any;
          if (row) {
            db.prepare('UPDATE groups SET group_number = ?, name = CASE WHEN ? IS NOT NULL AND ? != \'\' THEN ? ELSE name END, last_active = CURRENT_TIMESTAMP WHERE id = ?')
              .run(num, name || null, name || null, name || null, groupOpenid);
          } else {
            db.prepare('INSERT INTO groups (id, name, group_number, last_active) VALUES (?, ?, ?, CURRENT_TIMESTAMP)')
              .run(groupOpenid, name || groupOpenid, num);
          }
          return { ok: true };
        } catch (e: any) { return { ok: false, error: e.message }; }
      },
      // ---- 群信息聚合（群管理用）：群OpenID→群号/群名/头像/公告/人数/运行日志/活跃度 ----
      getGroupProfile: (groupId: string, limit = 10) => {
        try {
          const db = getDb();
          const row = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId || '') as any;
          if (!row) return null;
          const logs = querySystemLogs(limit, undefined, undefined, undefined).filter((l: any) => l.group_id === groupId);
          const activeMembers = db.prepare('SELECT COUNT(*) AS c FROM group_members WHERE group_id = ?').get(groupId || '') as any;
          return {
            id: row.id,
            group_number: row.group_number || '',
            name: row.name || '',
            avatar: row.avatar || '',
            member_count: row.member_count || 0,
            active_members: activeMembers ? activeMembers.c : 0,
            first_seen: row.first_seen || '',
            last_active: row.last_active || '',
            bot_id: row.bot_id || '',
            logs,
          };
        } catch { return null; }
      },
    };

    return {
      pluginId,
      bot: this.botApi,
      // data/ 下文件型数据（database 目录）：插件需要持久化结构化数据（用户/激活码/配置等 JSON 文件）时使用，
      // 路径限制在 data/database 内，防止越权读写
      data: {
        readJSON: (name: string, fallback?: any) => {
          const f = safeDatabaseFilePath(name);
          if (!f) return fallback === undefined ? null : fallback;
          try {
            if (!fs.existsSync(f)) return fallback === undefined ? null : fallback;
            return JSON.parse(fs.readFileSync(f, 'utf-8'));
          } catch (e) { return fallback === undefined ? null : fallback; }
        },
        writeJSON: (name: string, obj: any) => {
          const f = safeDatabaseFilePath(name);
          if (!f) return false;
          try {
            ensureDataDir();
            fs.writeFileSync(f, JSON.stringify(obj, null, 2), 'utf-8');
            return true;
          } catch (e) { return false; }
        },
        remove: (name: string) => {
          const f = safeDatabaseFilePath(name);
          if (!f) return false;
          try {
            if (fs.existsSync(f)) { fs.unlinkSync(f); }
            return true;
          } catch (e) { return false; }
        },
        readText: (name: string, fallback?: string) => {
          const f = safeDatabaseFilePath(name);
          if (!f) return fallback === undefined ? null : fallback;
          try {
            if (!fs.existsSync(f)) return fallback === undefined ? null : fallback;
            return fs.readFileSync(f, 'utf-8');
          } catch (e) { return fallback === undefined ? null : fallback; }
        },
      },
      // 新增全局变量 link：mqqapi 链接式外显文字工具，所有插件共享，受全局切换（文字外显模式）控制
      link: {
        mode: () => {
          try {
            const row = getDb().prepare("SELECT value FROM config WHERE key = 'global_link_mode'").get() as any;
            if (row && row.value) return String(row.value) === 'off' ? 'off' : 'on';
          } catch {}
          return 'on';
        },
        menuLink: (label: string, item: { type?: string; value: string }) => {
          const type = (item && item.type) || 'cmd';
          let value = String((item && item.value) || '');
          if (type === 'link') return `[${label}](${value})`;
          if (type === 'image') value = '__img:' + value;
          else if (type === 'page') value = '__page:' + value;
          else if (type === 'plugin') value = '__call:' + value;
          return `[${label}](mqqapi://aio/%69nlinecmd?command=${encodeURIComponent(value)}&enter=false&reply=false)`;
        },
        linkify: (text: string, cmd: string) => {
          try {
            const row = getDb().prepare("SELECT value FROM config WHERE key = 'global_link_mode'").get() as any;
            if (row && row.value && String(row.value) === 'off') return String(text == null ? '' : text);
          } catch {}
          return `[${text}](mqqapi://aio/%69nlinecmd?command=${encodeURIComponent(String(cmd == null ? '' : cmd))}&enter=false&reply=false)`;
        },
      },
      // 包装 eventBus：插件订阅事件时自动携带 pluginId，EventBus 按机器人分配关系过滤该插件监听者
      eventBus: {
        on: (evt: string, handler: (data: any) => void | Promise<void>) => this.eventBus.on(evt as any, handler, { pluginId }),
        off: (listenerId: string) => this.eventBus.off(listenerId),
      },
      logger: createLogger(`plugin:${pluginId}`),
      storage,
      config: {},
      engine: engineApi,
      identity: {
        getQQ: (openid: string) => {
          try {
            return getQQByOpenid(openid);
          } catch { return null; }
        },
        getOpenids: (qq: string) => {
          try {
            return getOpenidsByQQ(qq).map(m => ({ openid: m.openid, bot_id: m.bot_id || '' }));
          } catch { return []; }
        },
        getInfo: (openid: string) => {
          try {
            const m = getMappingByOpenid(openid);
            return m ? { openid: m.openid, qq_number: m.qq_number || '', nickname: m.nickname || '' } : null;
          } catch { return null; }
        },
        isSameUser: (a: string, b: string) => {
          if (!a || !b) return a === b;
          if (a === b) return true;
          try {
            const qqA = getQQByOpenid(a);
            const qqB = getQQByOpenid(b);
            if (qqA && qqB) return qqA === qqB;
            return false;
          } catch { return false; }
        },
      },
    };
  }

  /**
   * 从数据库加载所有插件，并自动发现 plugins/ 目录下的 .js 文件
   * 强制所有插件 approved=1，确保它们被加载
   */
  async loadAllFromDb(): Promise<void> {
    const db = getDb();
    ensureDataDir();

    // --- 确保表结构有 approved 和 owner 列 ---
    try {
      const tableInfo = db.prepare("PRAGMA table_info('plugins')").all() as any[];
      const columns = tableInfo.map(c => c.name);
      if (!columns.includes('approved')) {
        db.exec("ALTER TABLE plugins ADD COLUMN approved INTEGER DEFAULT 0");
        logger.info('Added approved column to plugins table');
      }
      if (!columns.includes('owner')) {
        db.exec("ALTER TABLE plugins ADD COLUMN owner TEXT DEFAULT ''");
        logger.info('Added owner column to plugins table');
      }
    } catch (e) {
      logger.warn('Failed to alter plugins table: ' + e);
    }

    // --- 将所有现有插件的 approved 设为 1（强制批准） ---
    try {
      db.prepare("UPDATE plugins SET approved = 1 WHERE approved IS NULL OR approved = 0").run();
      logger.info('All existing plugins have been auto-approved');
    } catch (e) {
      logger.warn('Failed to auto-approve plugins: ' + e);
    }

    // --- 迁移旧版 py-{name} 单文件记录为 file-{name}（旧一次性协议已废弃，避免与新常驻协议重复加载） ---
    try {
      const legacyPy = db.prepare("SELECT id, name FROM plugins WHERE type = 'py' AND id LIKE 'py-%'").all() as any[];
      for (const lp of legacyPy) {
        const target = 'file-' + path.basename(String(lp.name || ''), '.py');
        const hasNew = db.prepare('SELECT id FROM plugins WHERE id = ?').get(target);
        if (hasNew) {
          db.prepare('DELETE FROM plugins WHERE id = ?').run(lp.id);
          logger.info(`Migrated legacy Python plugin ${lp.id} -> ${target} (merged)`);
        } else {
          db.prepare('UPDATE plugins SET id = ? WHERE id = ?').run(target, lp.id);
          logger.info(`Renamed legacy Python plugin ${lp.id} -> ${target}`);
        }
      }
    } catch (e) {
      logger.warn('Failed to migrate legacy Python plugin ids: ' + e);
    }

    // --- 自动注册 plugins/ 下的 ZIP/Python 插件目录（无 DB 记录时插入，source_path 失效时修正） ---
    try {
      const dirEntries = fs.readdirSync(this.pluginsDir, { withFileTypes: true });
      for (const d of dirEntries) {
        if (!d.isDirectory() || d.name === '.tmp') continue;
        const dirPath = path.join(this.pluginsDir, d.name);
        const hasManifest = fs.existsSync(path.join(dirPath, 'plugin.json'));
        const hasEntry = fs.existsSync(path.join(dirPath, 'index.js')) || fs.existsSync(path.join(dirPath, 'index.mjs')) || fs.existsSync(path.join(dirPath, 'index.ts')) || fs.existsSync(path.join(dirPath, 'src', 'index.ts'));
        const hasPyInit = fs.existsSync(path.join(dirPath, '__init__.py')) || !!this.findPyEntry(dirPath);
        if (!hasManifest && !hasEntry && !hasPyInit) continue;
        const isPy = !hasEntry && hasPyInit;
        const row1 = db.prepare('SELECT id, source_path, type FROM plugins WHERE id = ?').get(d.name) as any;
        const row2 = row1 ? null : (db.prepare('SELECT id, source_path, type FROM plugins WHERE name = ?').get(d.name) as any);
        const row = row2 || row1;
        if (!row) {
          db.prepare(
            `INSERT INTO plugins (id, name, description, code, enabled, version, type, source_path, has_webui, owner, approved)
             VALUES (?, ?, ?, '', 0, '1.0.0', ?, ?, 0, 'system', 1)`
          ).run(uuidv4(), d.name, isPy ? this.readPyDescription(dirPath) : '', isPy ? 'py' : 'zip', dirPath);
          logger.info(`Auto-registered ${isPy ? 'Python' : 'ZIP'} plugin directory: ${d.name}`);
        } else {
          const sp = row.source_path;
          const spOk = sp && (
            fs.existsSync(path.join(sp, 'index.js')) ||
            fs.existsSync(path.join(sp, 'index.mjs')) ||
            fs.existsSync(path.join(sp, 'index.ts')) ||
            fs.existsSync(path.join(sp, 'src', 'index.ts')) ||
            fs.existsSync(path.join(sp, '__init__.py')) ||
            !!this.findPyEntry(sp)
          );
          if (!spOk) {
            db.prepare('UPDATE plugins SET source_path = ? WHERE id = ?').run(dirPath, row.id);
            logger.info(`Fixed ${row.type || 'zip'} plugin source_path for ${d.name} -> ${dirPath}`);
          }
        }
      }
    } catch (e) {
      logger.warn('Failed to auto-register ZIP plugins: ' + e);
    }

    // --- 规范化去重：同一插件名存在多条 code 记录（历史 zip 上传 uuid + 文件自动发现 file-）时，
    // 只保留 file-{name} 文件实例，禁用其它同 name 记录，避免同插件双实例加载导致事件重复响应、配置 key 错位 ---
    try {
      const dupRows = db.prepare("SELECT id, name, type FROM plugins WHERE type = 'code'").all() as any[];
      const byName = new Map<string, any[]>();
      for (const r of dupRows) {
        const key = String(r.name || '');
        if (!key) continue;
        if (!byName.has(key)) byName.set(key, []);
        byName.get(key)!.push(r);
      }
      for (const [name, rows] of byName) {
        if (rows.length < 2) continue;
        const fileRow = rows.find((r) => String(r.id).startsWith('file-'));
        const fileExists = fs.existsSync(path.join(this.pluginsDir, name + '.js')) ||
          fs.existsSync(path.join(this.pluginsDir, name + '.mjs'));
        if (fileRow && fileExists) {
          for (const r of rows) {
            if (r.id === fileRow.id) continue;
            db.prepare('UPDATE plugins SET enabled = 0 WHERE id = ?').run(r.id);
            logger.warn(`Dedup plugin "${name}": disabled duplicate ${r.id}, kept file instance ${fileRow.id}`);
            // 历史数据迁移：将被禁用实例的 config（plugin.{uuid}.{suffix}）复制到 file- 实例 key（file- 无值时才写），
            // 保证签到积分/最近签到等历史数据在去重后仍可被 file- 实例读到，避免积分归零/显示未签到
            try {
              const prefix = 'plugin.' + String(r.id) + '.';
              const hist = db.prepare('SELECT key, value FROM config WHERE key LIKE ?').all(prefix + '%') as any[];
              for (const h of hist) {
                const newKey = 'plugin.' + fileRow.id + '.' + String(h.key).slice(prefix.length);
                const exists = db.prepare('SELECT 1 FROM config WHERE key = ?').get(newKey) as any;
                if (!exists) {
                  db.prepare('INSERT INTO config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)').run(newKey, h.value);
                  logger.info(`Migrated config ${h.key} -> ${newKey}`);
                }
              }
            } catch (e: any) {
              logger.warn(`Failed to migrate config for ${r.id}: ${e.message}`);
            }
          }
        }
      }
    } catch (e) {
      logger.warn('Failed to dedup duplicate code plugins: ' + e);
    }

    // --- 加载数据库中的所有插件 ---
    const rows = db.prepare('SELECT * FROM plugins').all() as any[];
    for (const row of rows) {
      try {
        // 确保 approved=1
        if (row.approved !== 1) {
          db.prepare('UPDATE plugins SET approved = 1 WHERE id = ?').run(row.id);
          row.approved = 1;
        }

        if (row.type === 'zip') {
          await this.loadZipPlugin(row.id);
          if (row.enabled !== 1) {
            const entry = this.plugins.get(row.id);
            if (entry && entry.plugin.onDisable) {
              try { await entry.plugin.onDisable(entry.ctx); } catch {}
            }
            if (entry) entry.loaded = false;
            db.prepare('UPDATE plugins SET enabled = 0 WHERE id = ?').run(row.id);
          }
          continue;
        }

        // PHP 插件：由 php-plugin 桥执行，仅注册到插件管理页面显示，不做沙箱加载
        if (row.type === 'php') {
          continue;
        }

        // Python 插件：由 py-plugin 桥执行；启用状态时真正加载执行
        if (row.type === 'py') {
          if (row.enabled === 1) {
            try {
              await this.loadPyPlugin(row.id);
            } catch (e: any) {
              logger.error(`Failed to load Python plugin ${row.id}: ${e.message}`);
            }
          }
          continue;
        }

        // 代码插件：从 plugins/ 文件夹读取（优先 .js，无 .js 时支持单文件 .mjs）
        const jsFile = path.join(this.pluginsDir, row.name + '.js');
        const mjsFile = path.join(this.pluginsDir, row.name + '.mjs');

        if (fs.existsSync(mjsFile) && !fs.existsSync(jsFile)) {
          await this.loadMjsPlugin(row.id);
          continue;
        }

        const pluginFile = jsFile;
        let code: string;

        if (fs.existsSync(pluginFile)) {
          code = fs.readFileSync(pluginFile, 'utf-8');
        } else {
          code = row.code || '';
          if (code) {
            fs.writeFileSync(pluginFile, code, 'utf-8');
            logger.info(`Restored plugin file from DB: ${row.name}.js`);
          } else {
            logger.warn(`Plugin ${row.name}: no file or DB code, skipping`);
            continue;
          }
        }

        const ctx = this.createPluginContext(row.id);
        const plugin = PluginSandbox.loadPlugin(code, ctx);

        if (plugin) {
          plugin.manifest.id = row.id;
          this.plugins.set(row.id, { plugin, ctx, loaded: false });

          // 刷新 webui 标志（单文件插件使用同名子目录 plugins/{name}/ 提供设置界面）
          try {
            const webuiFlag = this.hasPluginWebuiDir(row.name) ? 1 : 0;
            if ((row.has_webui || 0) !== webuiFlag) {
              db.prepare('UPDATE plugins SET has_webui = ? WHERE id = ?').run(webuiFlag, row.id);
              row.has_webui = webuiFlag;
            }
          } catch {}

          if (plugin.onLoad) {
            await plugin.onLoad(ctx);
          }

          // 代码插件从文件加载时，仅当 DB enabled=1 才启用
          // enabled=0 时尊重 DB 状态（保留文件以便面板随时重新启用）
          // 说明：开机/关机由 zip 型插件(如 qq-bot-plugins)负责，不受此逻辑影响
          if (row.enabled === 1) {
            try {
              if (plugin.onEnable) {
                await plugin.onEnable(ctx);
              }
              const entry = this.plugins.get(row.id);
              if (entry) entry.loaded = true;
            } catch (err: any) {
              logger.error(`Plugin ${row.id} auto-enable failed: ${err.message}`);
            }
          } else {
            // enabled=0 → 保持禁用，不自动启用
            db.prepare('UPDATE plugins SET enabled = 0 WHERE id = ?').run(row.id);
            logger.info(`Plugin ${row.name} stays disabled (DB enabled=0)`);
          }
        } else {
          logger.warn(`Failed to load plugin ${row.name} (${row.id}) due to sandbox error`);
        }
      } catch (err: any) {
        logger.error(`Failed to load plugin ${row.id}: ${err.message}`);
      }
    }

    // --- 扫描 plugins/ 目录，发现新的 .js / .mjs 文件并自动注册（approved=1） ---
    // 注意：按 id（file-{文件名}）判重而非 name，避免被同名的 .php/.js 插件（如 菜单.php）占用后漏掉 .mjs
    const existingIds = new Set((db.prepare('SELECT id FROM plugins').all() as any[]).map((r: any) => r.id));
    if (fs.existsSync(this.pluginsDir)) {
      const files = fs.readdirSync(this.pluginsDir).filter(f => f.endsWith('.js') || f.endsWith('.mjs'));
      for (const file of files) {
        const ext = path.extname(file);
        const pluginName = file.slice(0, -ext.length);
        const id = 'file-' + pluginName;
        if (existingIds.has(id)) {
          continue; // 已存在，跳过
        }

        const fullPath = path.join(this.pluginsDir, file);
        try {
          let description = '';
          let manifestName = pluginName;
          if (ext === '.mjs') {
            // ESM 单文件插件：真实 import 校验（与 ZIP 插件 index.mjs 一致）
            const mod = await this.dynImport(pathToFileURL(fullPath).href + '?v=' + Date.now());
            const pluginExport = mod.default || mod;
            if (!pluginExport || !pluginExport.manifest) {
              logger.warn(`Invalid MJS plugin file: ${file}, skipping auto-discovery`);
              continue;
            }
            description = pluginExport.manifest.description || '';
            manifestName = pluginExport.manifest.name || pluginName;
          } else {
            const code = fs.readFileSync(fullPath, 'utf-8');
            const tempCtx = this.createPluginContext('_temp');
            const plugin = PluginSandbox.loadPlugin(code, tempCtx);
            if (!plugin) {
              logger.warn(`Invalid plugin file: ${file}, skipping auto-discovery`);
              continue;
            }
            description = plugin.manifest.description || '';
            manifestName = plugin.manifest.name || pluginName;
          }

          const existing = db.prepare('SELECT id, type FROM plugins WHERE id = ?').get(id) as any;
          if (existing) {
            if (existing.type === 'code') {
              logger.info(`Plugin ${id} already exists, skipping`);
              continue;
            }
            // id 被历史脏数据占用（如 php/zip 误注册到 file-{name}）：文件存在时修正为 code 类型并重新加载
            logger.warn(`Re-registering ${id} as code plugin (was type=${existing.type}), file=${file}`);
            db.prepare("UPDATE plugins SET type = 'code', name = ?, description = ?, code = '', has_webui = ?, enabled = 0, version = 1 WHERE id = ?")
              .run(manifestName, description, this.hasPluginWebuiDir(pluginName) ? 1 : 0, id);
            try {
              await this.enable(id);
            } catch (e) {
              logger.warn(`Failed to enable plugin ${id}: ${e}`);
            }
            continue;
          }

          // 插入数据库，approved=1，自动批准
          const hasWebui = this.hasPluginWebuiDir(pluginName) ? 1 : 0;
          db.prepare(
            `INSERT INTO plugins (id, name, description, code, enabled, version, type, has_webui, approved, owner)
             VALUES (?, ?, ?, '', 0, 1, 'code', ?, 1, ?)`
          ).run(id, manifestName, description, hasWebui, 'system');

          logger.info(`Auto-discovered and approved plugin: ${file} -> ${id}`);

          // 立即加载
          try {
            await this.enable(id);
          } catch (e) {
            logger.warn(`Failed to auto-enable plugin ${id}: ${e}`);
          }
        } catch (err: any) {
          logger.warn(`Failed to auto-load ${file}: ${err.message}`);
        }
      }
    }

    // --- 扫描 plugins/ 目录，发现 .php 插件并注册到插件管理页面（执行由 php-plugin 桥负责） ---
    if (fs.existsSync(this.pluginsDir)) {
      // 清理历史残留：php_helpers.php 是辅助库，不应作为插件登记展示
      try {
        db.prepare("DELETE FROM plugins WHERE name = 'php_helpers.php' OR id = 'php-php_helpers'").run();
      } catch {}
      const dbNamesAll = (db.prepare('SELECT name FROM plugins').all() as any[]).map((r: any) => r.name);
      const phpFiles = fs.readdirSync(this.pluginsDir).filter(f => f.endsWith('.php') && f !== 'php_helpers.php');
      for (const file of phpFiles) {
        if (dbNamesAll.includes(file)) continue;
        let desc = 'PHP 插件';
        try {
          const head = fs.readFileSync(path.join(this.pluginsDir, file), 'utf-8').slice(0, 800);
          const m = head.match(/@description\s+(.+)/);
          if (m) desc = m[1].trim();
        } catch {}
        db.prepare(
          `INSERT INTO plugins (id, name, description, code, enabled, version, type, source_path, approved, owner)
           VALUES (?, ?, ?, '', 1, '1.0.0', 'php', ?, 1, 'system')`
        ).run('php-' + path.basename(file, '.php'), file, desc, path.join(this.pluginsDir, file));
        logger.info(`Auto-registered PHP plugin for panel display: ${file}`);
      }
    }

    // --- 扫描 plugins/ 目录，发现 .py 单文件插件并注册/加载（py-plugin 桥执行） ---
    if (fs.existsSync(this.pluginsDir)) {
      const existingIdsSet = new Set((db.prepare('SELECT id FROM plugins').all() as any[]).map((r: any) => r.id));
      const pyFiles = fs.readdirSync(this.pluginsDir).filter(f => f.endsWith('.py'));
      for (const file of pyFiles) {
        const pluginName = file.slice(0, -3);
        const id = 'file-' + pluginName;
        if (existingIdsSet.has(id)) continue;
        let desc = 'Python 插件';
        try {
          const head = fs.readFileSync(path.join(this.pluginsDir, file), 'utf-8').slice(0, 800);
          const m = head.match(/(?:@description|""")\s*(.+)/);
          if (m) desc = m[1].trim().slice(0, 100);
        } catch {}
        db.prepare(
          `INSERT INTO plugins (id, name, description, code, enabled, version, type, source_path, approved, owner)
           VALUES (?, ?, ?, '', 0, '1.0.0', 'py', ?, 1, 'system')`
        ).run(id, file, desc, path.join(this.pluginsDir, file));
        logger.info(`Auto-registered Python plugin: ${file} -> ${id}`);
        try {
          await this.enable(id);
        } catch (e) {
          logger.warn(`Failed to auto-enable Python plugin ${id}: ${e}`);
        }
      }
    }

    // --- 扫描 plugins/ 目录，发现其他任意类型文件（.java/.txt/.cid/.json 等）注册为可读文件插件 ---
    // 仅用于插件管理页在线查看/编辑，不执行。扩展名为 js/mjs/py/php 或已被同名 file- id 占用的跳过。
    if (fs.existsSync(this.pluginsDir)) {
      const allIds = new Set((db.prepare('SELECT id FROM plugins').all() as any[]).map((r: any) => r.id));
      const otherFiles = fs.readdirSync(this.pluginsDir).filter((f) => {
        if (f.startsWith('.') || f === '.tmp') return false;
        const ext = path.extname(f);
        if (!ext || ['.js', '.mjs', '.py', '.php', '.zip'].includes(ext)) return false;
        const p = path.join(this.pluginsDir, f);
        try { return !fs.statSync(p).isDirectory(); } catch { return false; }
      });
      for (const file of otherFiles) {
        const pluginName = path.basename(file, path.extname(file));
        const id = 'file-' + pluginName;
        if (allIds.has(id)) continue;
        let desc = '文件资源插件（' + path.extname(file) + '）';
        try {
          const head = fs.readFileSync(path.join(this.pluginsDir, file), 'utf-8').slice(0, 300);
          const m = head.match(/(?:@description|"""|<!--)\s*(.+)/);
          if (m) desc = m[1].trim().slice(0, 80);
        } catch {}
        db.prepare(
          `INSERT INTO plugins (id, name, description, code, enabled, version, type, source_path, has_webui, approved, owner)
           VALUES (?, ?, ?, '', 0, '1.0.0', 'file', ?, 0, 1, 'system')`
        ).run(id, file, desc, path.join(this.pluginsDir, file));
        logger.info(`Auto-registered file plugin (read-only): ${file} -> ${id}`);
      }
    }

    logger.info(`Loaded ${this.plugins.size} plugins from database`);
  }

  async shutdown(): Promise<void> {
    for (const [id] of this.plugins) {
      await this.unload(id);
    }
    this.plugins.clear();
  }
}