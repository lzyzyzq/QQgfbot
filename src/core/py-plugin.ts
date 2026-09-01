import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { EventBus } from './event-bus';
import { BotAPI } from '../plugin/types';
import { createLogger } from '../utils/logger';
import { getConfig } from '../db/index';

const logger = createLogger('py-plugin');

const RUN_TIMEOUT = 8000;

// 扫描 plugins 目录下所有 Python 插件（根目录 .py 文件 + 子目录 index.py）
function scanPyFiles(dir: string): string[] {
  const out: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile() && e.name.toLowerCase().endsWith('.py')) {
        out.push(path.join(dir, e.name));
      } else if (e.isDirectory() && e.name !== '.tmp') {
        const idx = path.join(dir, e.name, 'index.py');
        if (fs.existsSync(idx)) out.push(idx);
      }
    }
  } catch (e: any) {
    logger.warn(`Scan Python plugins failed: ${e.message}`);
  }
  return out;
}

// 检测 python3 / python CLI 是否可用
function detectPython(): Promise<{ ok: boolean; cmd: string }> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: { ok: boolean; cmd: string }) => { if (!done) { done = true; resolve(v); } };
    try {
      const p = spawn('python3', ['-V']);
      p.on('error', () => {
        const p2 = spawn('python', ['-V']);
        p2.on('error', () => finish({ ok: false, cmd: '' }));
        p2.on('close', () => finish({ ok: true, cmd: 'python' }));
        setTimeout(() => finish({ ok: true, cmd: 'python' }), 4000);
      });
      p.on('close', () => finish({ ok: true, cmd: 'python3' }));
      setTimeout(() => finish({ ok: true, cmd: 'python3' }), 4000);
    } catch {
      finish({ ok: false, cmd: '' });
    }
  });
}

// 执行单个 Python 插件：stdin 传 JSON，stdout 收 JSON
function runPyPlugin(cmd: string, file: string, input: any): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, [file], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch {
      resolve({ ok: false, out: '' });
      return;
    }
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      resolve({ ok: false, out: '' });
    }, RUN_TIMEOUT);
    let out = '';
    let err = '';
    child.stdout!.on('data', (d: Buffer) => {
      out += d.toString();
      if (out.length > 500000) { try { child.kill('SIGKILL'); } catch {} }
    });
    child.stderr!.on('data', (d: Buffer) => { err += d.toString(); });
    child.on('error', () => { clearTimeout(timer); resolve({ ok: false, out: '' }); });
    child.on('close', () => {
      clearTimeout(timer);
      if (err.trim()) logger.warn(`Python 插件 stderr(${path.basename(file)}): ${err.trim().slice(0, 300)}`);
      resolve({ ok: true, out: out.trim() });
    });
    try {
      child.stdin!.write(JSON.stringify(input));
      child.stdin!.end();
    } catch {}
  });
}

/**
 * 启动 Python 插件桥：将消息事件转发给 plugins/ 下的 Python 插件执行，
 * Python 插件通过 stdin 接收 JSON、stdout 返回 JSON（协议与 PHP 插件一致）。
 */
export async function setupPyPlugins(eventBus: EventBus, botApi: BotAPI, pluginsDir: string): Promise<void> {
  const pyFiles = scanPyFiles(pluginsDir);
  if (pyFiles.length === 0) return;

  const py = await detectPython();
  if (!py.ok) {
    logger.warn(`发现 ${pyFiles.length} 个 Python 插件，但环境未安装 Python CLI（python3/python 命令不可用），已跳过`);
    return;
  }
  logger.info(`Python 插件已加载(${pyFiles.length})：${pyFiles.map(f => path.basename(f)).join(', ')}`);

  function buildHandler(type: string) {
    return async (data: any) => {
      const payload = {
        action: 'message',
        type,
        content: String((data && data.content) || ''),
        groupId: (data && (data.groupId || data.channelId)) || '',
        channelId: (data && data.channelId) || '',
        userId: (data && data.author && (data.author.openid || data.author.id)) || '',
        msgId: (data && data.id) || '',
        botId: (data && data.botId) || '',
        botName: (data && data.botName) || '',
        author: (data && data.author) || {},
        timestamp: (data && data.timestamp) || '',
        panelBase: getPanelBase(),
      };
      for (const f of pyFiles) {
        try {
          const r = await runPyPlugin(py.cmd, f, payload);
          if (!r.ok || !r.out) continue;
          let res: any = {};
          try { res = JSON.parse(r.out); } catch { logger.warn(`Python 插件输出非 JSON(${path.basename(f)})：${r.out.slice(0, 120)}`); continue; }
          const replies: any[] = res.replies || (res.reply ? [res.reply] : []);
          for (const rep of replies) {
            if (!rep || !rep.content) continue;
            await sendReply(botApi, rep, type, payload);
          }
        } catch (e: any) {
          logger.warn(`Python 插件执行失败(${path.basename(f)})：${e.message}`);
        }
      }
    };
  }

  eventBus.on('message.group', buildHandler('group'));
  eventBus.on('message.c2c', buildHandler('c2c'));
  eventBus.on('message.guild', buildHandler('guild'));
}

function getPanelBase(): string {
  try {
    const host = getConfig('panel.host') || '';
    if (!host) return '';
    return host.startsWith('http') ? host.replace(/\/+$/, '') : 'https://' + host.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

async function sendReply(botApi: BotAPI, rep: any, srcType: string, payload: any): Promise<void> {
  const to = rep.type || srcType;
  const markdown = rep.msgType === 'markdown';
  if (to === 'c2c' || to === 'user') {
    if (!payload.userId) return;
    if (markdown) {
      await botApi.sendMarkdownPrivate(payload.userId, rep.content, undefined, undefined, payload.msgId || undefined);
    } else {
      await botApi.sendPrivateMessage(payload.userId, rep.content, payload.msgId || undefined);
    }
  } else if (to === 'guild') {
    if (!payload.channelId) return;
    if (markdown) {
      await botApi.sendMarkdownGroup(payload.channelId, rep.content, undefined, undefined, payload.msgId || undefined);
    } else {
      await botApi.sendMessage(payload.channelId, rep.content, payload.msgId || undefined);
    }
  } else {
    if (!payload.groupId) return;
    if (markdown) {
      await botApi.sendMarkdownGroup(payload.groupId, rep.content, undefined, undefined, payload.msgId || undefined);
    } else {
      await botApi.sendGroupMessage(payload.groupId, rep.content, payload.msgId || undefined);
    }
  }
}
