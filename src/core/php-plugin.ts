import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { EventBus } from './event-bus';
import { BotAPI } from '../plugin/types';
import { createLogger } from '../utils/logger';
import { getConfig, getDb } from '../db/index';

const logger = createLogger('php-plugin');

// PHP 插件运行超时：下载/解压更新包等耗时操作需要更长时间，120s
const RUN_TIMEOUT = 120000;
const GRACE_KILL_MS = 3000;

// 扫描 plugins 目录下所有 PHP 插件（根目录 .php 文件 + 子目录 index.php；排除辅助函数库）
function scanPhpFiles(dir: string): string[] {
  const out: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile() && e.name.toLowerCase().endsWith('.php') && e.name !== 'php_helpers.php') {
        out.push(path.join(dir, e.name));
      } else if (e.isDirectory() && e.name !== '.tmp') {
        const idx = path.join(dir, e.name, 'index.php');
        if (fs.existsSync(idx)) out.push(idx);
      }
    }
  } catch (e: any) {
    logger.warn(`Scan PHP plugins failed: ${e.message}`);
  }
  return out;
}

// 检测 php CLI 是否可用
function detectPhp(): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean) => { if (!done) { done = true; resolve(v); } };
    try {
      const p = spawn('php', ['-v']);
      p.on('error', () => finish(false));
      p.on('close', () => finish(true));
      setTimeout(() => finish(false), 4000);
    } catch {
      finish(false);
    }
  });
}

// 执行单个 PHP 插件：stdin 传 JSON，stdout 收 JSON
function runPhpPlugin(file: string, input: any): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn('php', [file], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PHP_PLUGIN_BOT_ID: String((input && input.botId) || ''),
          PHP_PLUGIN_TYPE: String((input && input.type) || ''),
          PHP_PLUGIN_GROUP_ID: String((input && (input.groupId || '')) || ''),
          PHP_PLUGIN_CHANNEL_ID: String((input && (input.channelId || '')) || ''),
          PHP_PLUGIN_USER_ID: String((input && (input.userId || '')) || ''),
          PHP_PLUGIN_MSG_ID: String((input && (input.msgId || '')) || ''),
        },
      });
    } catch {
      resolve({ ok: false, out: '' });
      return;
    }
    const timer = setTimeout(() => {
      // 超时先 SIGTERM 优雅退出（PHP shutdown function 可输出已累积回复），3 秒后仍不退再 SIGKILL
      try { child.kill('SIGTERM'); } catch {}
      setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, GRACE_KILL_MS);
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
      if (err.trim()) logger.warn(`PHP 插件 stderr(${path.basename(file)}): ${err.trim().slice(0, 300)}`);
      resolve({ ok: true, out: out.trim() });
    });
    try {
      child.stdin!.write(JSON.stringify(input));
      child.stdin!.end();
    } catch {}
  });
}

// 读取/生成注入用的辅助函数库源码（helpers 置于插件源码前，插件可直接调用）
function prepareInjectedFiles(pluginsDir: string, phpFiles: string[]): string[] {
  const helperPath = path.join(pluginsDir, 'php_helpers.php');
  let helperSrc = '';
  if (fs.existsSync(helperPath)) {
    helperSrc = fs.readFileSync(helperPath, 'utf-8');
  }
  const tmpDir = path.join(pluginsDir, '.tmp');
  try { if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true }); } catch {}
  const dataDir = path.resolve(process.cwd(), 'data', 'database');
  const bridgeUrl = `http://127.0.0.1:${process.env.PORT || '3000'}`;
  return phpFiles.map((f) => {
    const name = path.basename(f, '.php');
    const tmp = path.join(tmpDir, `__php_${name.replace(/[^A-Za-z0-9_-]/g, '_')}.php`);
    try {
      const src = fs.readFileSync(f, 'utf-8');
      const head = '<?php\n' +
        `if (!defined('PHP_PLUGIN_DATA_DIR')) define('PHP_PLUGIN_DATA_DIR', ${JSON.stringify(dataDir)});\n` +
        `if (!defined('PHP_PLUGIN_BRIDGE_URL')) define('PHP_PLUGIN_BRIDGE_URL', ${JSON.stringify(bridgeUrl)});\n` +
        `if (!isset($GLOBALS['__PHP_REPLIES'])) $GLOBALS['__PHP_REPLIES'] = array();\n` +
        `ob_start();\n` +
        `register_shutdown_function(function () {\n` +
        `  $__out = (string)ob_get_clean();\n` +
        `  $__replies = array_values(array_filter($GLOBALS['__PHP_REPLIES'] ?? array(), function ($__r) { return $__r !== null; }));\n` +
        `  if (trim($__out) !== '') { echo $__out; }\n` +
        `  elseif (!empty($__replies)) { echo json_encode(array('replies' => $__replies), JSON_UNESCAPED_UNICODE); }\n` +
        `  else { echo '{}'; }\n` +
        `});\n` +
        helperSrc.replace(/^<\?php\s*/i, '') + '\n' +
        src.replace(/^<\?php\s*/i, '') + '\n';
      fs.writeFileSync(tmp, head, 'utf-8');
      return tmp;
    } catch {
      return f;
    }
  });
}

/**
 * 启动 PHP 插件桥：将消息事件转发给 plugins/ 下的 PHP 插件执行，
 * PHP 插件通过 stdin 接收 JSON、stdout 返回 JSON（协议见 plugins/菜单.php 头部注释）。
 */
export async function setupPhpPlugins(eventBus: EventBus, botApi: BotAPI, pluginsDir: string): Promise<void> {
  const phpFiles = scanPhpFiles(pluginsDir);
  if (phpFiles.length === 0) return;

  const hasPhp = await detectPhp();
  if (!hasPhp) {
    logger.warn(`发现 ${phpFiles.length} 个 PHP 插件，但环境未安装 PHP CLI（php 命令不可用），已跳过：请安装 php-cli`);
    return;
  }
  logger.info(`PHP 插件已加载(${phpFiles.length})：${phpFiles.map(f => path.basename(f)).join(', ')}`);

  const dataDir = path.resolve(process.cwd(), 'data', 'database');
  const runFiles = prepareInjectedFiles(pluginsDir, phpFiles);

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
      for (let i = 0; i < phpFiles.length; i++) {
        try {
          // 尊重管理面板启用状态：被禁用的 PHP 插件不执行（php_helpers.php 不登记，跳过查询）
          const baseName = path.basename(phpFiles[i]);
          if (baseName !== 'php_helpers.php') {
            const row = getDb().prepare('SELECT enabled FROM plugins WHERE name = ?').get(baseName) as any;
            if (row && row.enabled === 0) continue;
          }
          const r = await runPhpPlugin(runFiles[i] || phpFiles[i], payload);
          if (!r.ok || !r.out) continue;
          let res: any = {};
          try { res = JSON.parse(r.out); } catch { logger.warn(`PHP 插件输出非 JSON(${path.basename(phpFiles[i])})：${r.out.slice(0, 120)}`); continue; }
          const replies: any[] = res.replies || (res.reply ? [res.reply] : []);
          for (const rep of replies) {
            if (!rep) continue;
            const hasContent = rep.content !== undefined || rep.imageUrl || rep.voiceUrl ||
              rep.messageId || rep.type || rep.kind || rep.msgType;
            if (!hasContent) continue;
            await sendReply(botApi, rep, type, payload);
            if (type === 'group' && payload.groupId) recordPhpReply(dataDir, payload.botId, payload.groupId);
          }
        } catch (e: any) {
          logger.warn(`PHP 插件执行失败(${path.basename(phpFiles[i])})：${e.message}`);
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

// 记录机器人回复计数（供「群信息」插件统计）：data/database/活跃/{botId}/{date}.json 的 数据->回复->{groupId}++
function recordPhpReply(dataDir: string, botId: string, gid: string): void {
  try {
    if (!botId || !gid) return;
    const day = new Date();
    day.setUTCHours(day.getUTCHours() + 8);
    const date = day.toISOString().slice(0, 10);
    const f = path.join(dataDir, '活跃', botId, date + '.json');
    let j: any = {};
    try {
      if (fs.existsSync(f)) j = JSON.parse(fs.readFileSync(f, 'utf-8')) || {};
    } catch {}
    const data = (j && typeof j.data === 'object' && j.data) || {};
    const replies = (data.replies && typeof data.replies === 'object' && data.replies) || {};
    replies[gid] = (parseInt(replies[gid] || '0', 10) || 0) + 1;
    data.replies = replies;
    j.data = data;
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(j, null, 2), 'utf-8');
  } catch {}
}

export async function sendReply(botApi: BotAPI, rep: any, srcType: string, payload: any): Promise<void> {  // 旧协议：rep.type 为目标渠道(c2c/user/guild)，内容类型由 rep.msgType 决定
  const isChannelType = rep.type === 'c2c' || rep.type === 'user' || rep.type === 'guild';
  const kind = isChannelType ? (rep.msgType === 'markdown' ? 'markdown' : 'text')
    : String(rep.kind || rep.type || rep.msgType || 'text');
  const dst = rep.channel && (rep.channel === 'c2c' || rep.channel === 'guild' || rep.channel === 'user')
    ? rep.channel
    : isChannelType ? rep.type : srcType;
  try {
    if (dst === 'c2c') {
      const uid = rep.userId || payload.userId;
      if (!uid) return;
      if (kind === 'markdown') { await botApi.sendMarkdownPrivate(uid, rep.content, undefined, undefined, payload.msgId || undefined); return; }
      if (kind === 'image' || rep.imageUrl) { await botApi.sendImageMessage(uid, rep.imageUrl || rep.content, payload.msgId || undefined); return; }
      if (kind === 'button' || kind === 'keyboard') { await botApi.sendKeyboardPrivate(uid, keyboardFrom(rep), payload.msgId || undefined); return; }
      await botApi.sendPrivateMessage(uid, rep.content, payload.msgId || undefined);
      return;
    }
    if (dst === 'guild') {
      const ch = rep.channelId || payload.channelId;
      if (!ch) return;
      if (kind === 'markdown') { await botApi.sendMarkdownGroup(ch, rep.content, undefined, undefined, payload.msgId || undefined); return; }
      if (kind === 'image' || rep.imageUrl) { await botApi.sendImageMessage(ch, rep.imageUrl || rep.content, payload.msgId || undefined); return; }
      await botApi.sendMessage(ch, rep.content, payload.msgId || undefined);
      return;
    }
    const gid = rep.groupId || payload.groupId;
    if (!gid) return;
    if (kind === 'markdown') { await botApi.sendMarkdownGroup(gid, rep.content, undefined, undefined, payload.msgId || undefined); return; }
    if (kind === 'image' || rep.imageUrl) {
      const url = rep.imageUrl || rep.content;
      // base64 data URI 图片：解码后走分片上传，避免 QQ 无法直接拉取 data URI
      if (typeof url === 'string' && url.startsWith('data:image/')) {
        const comma = url.indexOf(',');
        const b64 = comma >= 0 ? url.substring(comma + 1) : url;
        const buf = Buffer.from(b64, 'base64');
        if (buf.length > 0) {
          const up = await botApi.uploadGroupImageBuffer(gid, buf, rep.fileName || 'php_image.png');
          const fileInfo = (up && (up.file_info || up.fileInfo)) || (up && up.data && up.data.file_info);
          if (fileInfo) { await botApi.sendGroupImageMessage(gid, fileInfo, payload.msgId || undefined); return; }
        }
      }
      const up = await botApi.uploadGroupImage(gid, url);
      const fileInfo = (up && (up.file_info || up.fileInfo)) || (up && up.data && up.data.file_info);
      if (fileInfo) { await botApi.sendGroupImageMessage(gid, fileInfo, payload.msgId || undefined); return; }
      await botApi.sendGroupMessage(gid, url);
      return;
    }
    if (kind === 'voice' || kind === 'audio') {
      const url = rep.voiceUrl || rep.content;
      const up = await botApi.uploadGroupVoice(gid, url, rep.fileName || undefined);
      const fileInfo = (up && (up.file_info || up.fileInfo)) || (up && up.data && up.data.file_info);
      if (fileInfo) { await botApi.sendGroupVoiceMessage(gid, fileInfo, payload.msgId || undefined); return; }
      await botApi.sendGroupMessage(gid, url);
      return;
    }
    if (kind === 'video') {
      await botApi.sendGroupMessage(gid, rep.content, payload.msgId || undefined);
      return;
    }
    if (kind === 'button' || kind === 'keyboard') {
      await botApi.sendKeyboardGroup(gid, keyboardFrom(rep), payload.msgId || undefined);
      return;
    }
    if (kind === 'infocard' || kind === 'card' || kind === '文卡') {
      await botApi.sendGroupInfoCard(gid, infoCardFrom(rep));
      return;
    }
    if (kind === 'dashboard' || kind === '总览') { await botApi.sendGroupDashboard(gid); return; }
    if (kind === 'menu') { await botApi.sendMenuCard(gid, rep.content || rep.menu); return; }
    if (kind === 'recall' || kind === '撤回') {
      if (rep.messageId) await botApi.deleteMessage(gid, rep.messageId, rep.hideTip !== false);
      return;
    }
    await botApi.sendGroupMessage(gid, rep.content, payload.msgId || undefined);
  } catch (err: any) {
    logger.warn(`PHP 插件回复发送失败(${kind}): ${err && err.message ? err.message : err}`);
  }
}

function keyboardFrom(rep: any): any {
  const rows = Array.isArray(rep.rows) ? rep.rows : Array.isArray(rep.buttons) ? [rep.buttons] : [];
  const buttons = rows.map((r: any) => Array.isArray(r) ? r : [r]).map((row: any[]) =>
    row.map((b: any) => {
      if (typeof b === 'string') return { text: b, action_url: '' };
      return { text: String(b.text ?? b.label ?? ''), action_url: String(b.url ?? b.action_url ?? '') };
    })
  );
  return { content: rep.content || ' ', rows: buttons };
}

function infoCardFrom(rep: any): any {
  return {
    title: rep.title || '',
    content: rep.content || '',
    url: rep.url || '',
  };
}
