import { Router, type Request, type Response } from 'express';
import type { Logger } from '../logger';
import { requireSuperMaster } from '../middleware';
import type { AdminAuth } from '../auth';
import type { BotRegistry } from '../registry';
import { getBot, getBotInstance } from '../../core/bot';
import { querySystemLogs, querySystemLogsCount, deleteSystemLogs, clearSystemLogs, getDb, getConfig, setConfig } from '../../db/index';
import {
  getSwitchStates,
  setSwitchState,
  listScheduleTasks,
  createScheduleTask,
  updateScheduleTask,
  deleteScheduleTask,
  toggleScheduleTask,
} from '../../shared/bot-controls';
import fs from 'fs';
import path from 'path';
import net from 'net';

// 检测目标端口是否已被其他进程占用（排除服务自身当前端口）
function portInUse(p: number, currentPort: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (p === currentPort) { resolve(false); return; }
    const srv = net.createServer();
    srv.once('error', () => resolve(true));
    srv.once('listening', () => { srv.close(() => resolve(false)); });
    srv.listen(p, '0.0.0.0');
  });
}

interface BotConfig {
  appId?: string;
  clientSecret?: string;
  sandbox?: boolean;
  intents?: number;
}

interface AdminConfig {
  port: number;
}

export function createSystemRoutes(
  logger: Logger,
  botConfig: BotConfig,
  adminConfig: AdminConfig,
  getUpdateLog: () => string,
  saveUpdateLog?: (content: string) => void,
  restartFn?: () => Promise<any>,
  refreshFn?: () => Promise<void>,
  adminAuth?: AdminAuth,
  botRegistry?: BotRegistry,
): Router {
  const router = Router();

  router.get('/logs', (_req: Request, res: Response) => {
    const lines = Number(_req.query.lines) || 200;
    res.json(logger.readLogs(lines));
  });

  router.get('/logs/download', (_req: Request, res: Response) => {
    res.download(logger.getLogPath());
  });

  // 系统日志数据库查询（运行记录）：非超主只能看到自己名下机器人的记录；超主可传 bot_id 过滤
  router.get('/system-logs', (_req: Request, res: Response) => {
    const limit = Number(_req.query.limit) || 100;
    const category = _req.query.category as string | undefined;
    const level = _req.query.level as string | undefined;
    const botId = (_req.query.bot_id as string) || '';
    const user = (_req as any).adminUser as { username?: string; role?: string } | undefined;
    let botIds: string[] | undefined;
    if (botId) {
      botIds = [botId];
    } else if (user && user.role !== 'super_master' && botRegistry) {
      botIds = botRegistry.list(user.username).map((b: any) => b.id);
    }
    const logs = querySystemLogs(limit, category, level, botIds);
    const total = querySystemLogsCount(category, level, botIds);
    res.json({ logs, total, filtered: !!botIds });
  });

  // 删除运行记录：body {ids:[...]} 批量删除；?all=1 或 body {all:true} 清空全部
  router.delete('/system-logs', requireSuperMaster, (req: Request, res: Response) => {
    try {
      const ids = req.body?.ids;
      if (Array.isArray(ids)) {
        const deleted = deleteSystemLogs(ids.map(Number));
        res.json({ ok: true, deleted });
        return;
      }
      if (req.query.all === '1' || req.body?.all) {
        const deleted = clearSystemLogs();
        res.json({ ok: true, deleted });
        return;
      }
      res.status(400).json({ error: '缺少 ids 或 all 参数' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/updatelog', (_req: Request, res: Response) => {
    res.json({ content: getUpdateLog() });
  });

  router.put('/updatelog', requireSuperMaster, (req: Request, res: Response) => {
    const content = req.body?.content;
    if (typeof content !== 'string') {
      res.status(400).json({ error: '缺少 content 字段' });
      return;
    }
    if (!saveUpdateLog) {
      res.status(500).json({ error: '更新日志保存能力不可用' });
      return;
    }
    try {
      saveUpdateLog(content);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 面板授权码登录开关状态（免鉴权，供登录页显示/隐藏授权码登录入口）
  router.get('/panel-login-status', (_req: Request, res: Response) => {
    res.json({ enabled: (getConfig('panel.auth_code_login') || '1') === '1' });
  });

  router.get('/config', (req: Request, res: Response) => {
    res.json({
      appId: botConfig.appId,
      clientSecret: '******',
      sandbox: botConfig.sandbox,
      intents: botConfig.intents,
      adminPort: adminConfig.port,
      serverPort: getConfig('server.port') || String(adminConfig.port),
      panelHost: getConfig('panel.host') || '',
      authCodePanelLogin: (getConfig('panel.auth_code_login') || '1') === '1',
      licenseAutoShutdown: (getConfig('license.auto_shutdown') || '1') === '1',
      botName: getConfig('bot.name') || '',
      chimeTexts: getConfig('bot.chime_texts') || '',
      chimeCity: getConfig('bot.chime_city') || '北京',
      chimeAd: getConfig('bot.chime_ad') || '',
      footerText: getConfig('bot.footer_text') || '',
      footerAds: getConfig('bot.footer_ads') || '',
      qqLoginToken: getConfig('qqlogin.token') || '',
      updateVersion: getConfig('update.version') || '4.2.59',
      updatePatchUrl: getConfig('update.patch_url') || 'https://8091-6f61dc7363389b7a.monkeycode-ai.online/qqbot-card-editor-patch-4.2.59.zip',
      updateFullUrl: getConfig('update.full_url') || 'https://8091-6f61dc7363389b7a.monkeycode-ai.online/qqbot-card-editor-4.2.59-full.zip',
      updateChangeLog: getConfig('update.changelog') || '',
      updateConfigUrl: getConfig('update.config_url') || '',
    });
  });

  router.put('/config', requireSuperMaster, async (req: Request, res: Response) => {
    if (req.body.appId) { botConfig.appId = req.body.appId; setConfig('bot.app_id', req.body.appId); }
    if (req.body.clientSecret && req.body.clientSecret !== '******') {
      botConfig.clientSecret = req.body.clientSecret;
      setConfig('bot.app_secret', req.body.clientSecret);
      try { getBot().updateSecret(req.body.clientSecret); } catch (e: any) {}
    }
    if (req.body.sandbox !== undefined) botConfig.sandbox = req.body.sandbox;
    if (req.body.intents) botConfig.intents = req.body.intents;
    if (req.body.port !== undefined) {
      const p = parseInt(String(req.body.port), 10);
      if (p > 0 && p <= 65535) {
        // 目标端口已被其他进程（如 nginx/tailscale 的 6655）占用时拒绝保存，避免重启后 502
        if (await portInUse(p, adminConfig.port)) {
          res.status(409).json({ error: `端口 ${p} 已被其他进程占用（可能是 nginx/访问端口）。请改为内部服务端口（如 3000/3100），不要填访问端口 6655` });
          return;
        }
        setConfig('server.port', String(p));
      }
    }
    if (req.body.authCodePanelLogin !== undefined) setConfig('panel.auth_code_login', req.body.authCodePanelLogin ? '1' : '0');
    if (req.body.panelHost !== undefined) setConfig('panel.host', String(req.body.panelHost).trim());
    if (req.body.licenseAutoShutdown !== undefined) setConfig('license.auto_shutdown', req.body.licenseAutoShutdown ? '1' : '0');
    if (req.body.botName !== undefined) setConfig('bot.name', String(req.body.botName).trim());
    if (req.body.chimeTexts !== undefined) setConfig('bot.chime_texts', String(req.body.chimeTexts));
    if (req.body.chimeCity !== undefined) setConfig('bot.chime_city', String(req.body.chimeCity).trim() || '北京');
    if (req.body.chimeAd !== undefined) setConfig('bot.chime_ad', String(req.body.chimeAd));
    if (req.body.footerText !== undefined) setConfig('bot.footer_text', String(req.body.footerText));
    if (req.body.footerAds !== undefined) setConfig('bot.footer_ads', String(req.body.footerAds));
    if (req.body.qqLoginToken !== undefined) setConfig('qqlogin.token', String(req.body.qqLoginToken).trim());
    if (req.body.updateVersion !== undefined) setConfig('update.version', String(req.body.updateVersion).trim() || '4.2.59');
    if (req.body.updatePatchUrl !== undefined) setConfig('update.patch_url', String(req.body.updatePatchUrl).trim());
    if (req.body.updateFullUrl !== undefined) setConfig('update.full_url', String(req.body.updateFullUrl).trim());
    if (req.body.updateChangeLog !== undefined) setConfig('update.changelog', String(req.body.updateChangeLog));
    if (req.body.updateConfigUrl !== undefined) setConfig('update.config_url', String(req.body.updateConfigUrl).trim());
    res.json({ ok: true });
  });

  // 更新系统：读取更新记录列表 + 当前部署版本 + 记录文件路径
  router.get('/update-records', (_req: Request, res: Response) => {
    try {
      const dir = path.resolve(process.cwd(), 'data', 'database', '更新');
      const recFile = path.join(dir, '记录.json');
      const stateFile = path.join(dir, '状态.json');
      let records: any[] = [];
      if (fs.existsSync(recFile)) {
        const j = JSON.parse(fs.readFileSync(recFile, 'utf-8') || '[]');
        if (Array.isArray(j)) records = j;
      }
      let currentVersion = '';
      if (fs.existsSync(stateFile)) {
        const s = JSON.parse(fs.readFileSync(stateFile, 'utf-8') || '{}');
        currentVersion = String(s.version || '');
      }
      res.json({ ok: true, records, currentVersion, recordFile: recFile });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 更新系统：手动补记本次更新（用于手动部署后把版本写入升级列表与当前版本）
  router.post('/record-update', requireSuperMaster, (_req: Request, res: Response) => {
    try {
      const dir = path.resolve(process.cwd(), 'data', 'database', '更新');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const recFile = path.join(dir, '记录.json');
      const stateFile = path.join(dir, '状态.json');
      let records: any[] = [];
      if (fs.existsSync(recFile)) {
        const j = JSON.parse(fs.readFileSync(recFile, 'utf-8') || '[]');
        if (Array.isArray(j)) records = j;
      }
      const version = (getConfig('update.version') || '4.2.59').trim();
      const changelog = getConfig('update.changelog') || '';
      const now = new Date(Date.now() + (8 * 60 + new Date().getTimezoneOffset()) * 60000);
      const fmt = (n: number) => String(n).padStart(2, '0');
      const time = `${now.getFullYear()}-${fmt(now.getMonth() + 1)}-${fmt(now.getDate())} ${fmt(now.getHours())}:${fmt(now.getMinutes())}:${fmt(now.getSeconds())}`;
      records.push({ type: '手动记录', version, time, content: changelog });
      fs.writeFileSync(recFile, JSON.stringify(records, null, 2), 'utf-8');
      fs.writeFileSync(stateFile, JSON.stringify({ version, updatedAt: time }, null, 2), 'utf-8');
      res.json({ ok: true, records, currentVersion: version });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.post('/refresh', async (_req: Request, res: Response) => {
    try {
      if (refreshFn) {
        await refreshFn();
        res.json({ ok: true, message: 'Bot refreshed' });
      } else {
        res.status(400).json({ error: 'Refresh not supported' });
      }
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/restart', requireSuperMaster, async (_req: Request, res: Response) => {
    try {
      if (!restartFn) {
        res.status(400).json({ error: 'Restart not supported' });
        return;
      }
      const r: any = await restartFn();
      if (r && r.ok === false) {
        res.status(500).json({ ok: false, error: (r.err || '远程重启失败').slice(0, 300) });
        return;
      }
      res.json({ ok: true, message: '重启命令已执行', detail: r || {} });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/stats', (_req: Request, res: Response) => {
    const mem = process.memoryUsage();

    // 统计插件数量：与插件列表页一致，按 plugins 目录实际可展示插件去重计数
    // （避免历史 DB 遗留重复记录（uuid code + file- 双实例）导致统计虚高、本地/服务器数量对不上）
    let pluginCount = 0;
    try {
      const pluginsDir = path.resolve(process.cwd(), 'plugins');
      if (fs.existsSync(pluginsDir)) {
        const names = new Set<string>();
        for (const name of fs.readdirSync(pluginsDir)) {
          if (name === '.tmp' || name.startsWith('.')) continue;
          const full = path.join(pluginsDir, name);
          let stat: fs.Stats | null = null;
          try { stat = fs.statSync(full); } catch { continue; }
          if (stat.isDirectory()) {
            const hasEntry = fs.existsSync(path.join(full, 'index.js')) ||
              fs.existsSync(path.join(full, 'index.mjs')) ||
              fs.existsSync(path.join(full, 'index.ts')) ||
              fs.existsSync(path.join(full, 'src', 'index.ts'));
            const hasManifest = fs.existsSync(path.join(full, 'plugin.json'));
            if (!hasEntry && !hasManifest) continue;
            names.add(name);
          } else {
            const ext = path.extname(name).toLowerCase();
            if (!ext || ext === '.zip' || ext === '.txt' || ext === '.md') continue;
            names.add(name);
          }
        }
        pluginCount = names.size;
      }
    } catch (e) {}

    // 读取 NapCatQQ 版本
    let napcatVersion = '';
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'external', 'NapCatQQ', 'package.json'), 'utf-8'));
      napcatVersion = pkg.version || '';
    } catch (e) {}

    res.json({
      uptime: process.uptime(),
      memory: {
        rss: Math.round(mem.rss / 1024 / 1024),
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      },
      nodeVersion: process.version,
      pid: process.pid,
      pluginCount,
      framework: {
        name: 'NapCatQQ',
        version: napcatVersion,
        integrated: true,
      },
      features: [
        '开关机控制', '主菜单路由', '娱乐中心', '实用工具',
        '签到系统', '群管理工具', '授权系统', '系统工具',
        '系统设置', 'DIC管理', '定时推送', '关键词回复',
        '问候插件', '词典回复', '按钮菜单', '整点报时',
        '新人欢迎', '退群提示', '全局模式切换',
      ],
    });
  });

  router.get('/hyperlinks', (_req: Request, res: Response) => {
    res.json({
      official: 'https://q.qq.com',
      docs: 'https://bot.q.qq.com/wiki',
      callback: 'https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/send-receive/msg-send.html',
    });
  });

  router.get('/help', (req: Request, res: Response) => {
    const host = req.get('host') || 'localhost:3000';
    const proto = (req.get('x-forwarded-proto') || req.protocol || 'https');
    const callbackUrl = `${proto}://${host}/qq/webhook`;
    res.json({
      title: 'QQ Bot Framework Help',
      sections: [
        {
          title: '快速开始',
          content: '1. 在 q.qq.com 注册机器人获取 AppID 和 AppSecret\n2. 在管理面板「我的机器人」页面点击「添加机器人」\n3. 填写 AppID、AppSecret 和 Intents\n4. 点击「启动」使机器人上线\n5. 在 QQ 开放平台配置回调地址',
        },
        {
          title: '插件开发文档',
          content: '插件以 zip 包形式打包上传。\n\n## 插件结构\n插件 zip 包内需包含:\n- `plugin.json` - 插件清单文件(必填)\n- `index.js` 或入口文件(必填)\n- `README.md` - 插件文档(可选)\n\n## plugin.json 格式\n{\n  "name": "my-plugin",\n  "version": "1.0.0",\n  "description": "我的插件",\n  "author": "作者名",\n  "main": "index.js",\n  "match": ["AT_MESSAGE_CREATE", "GROUP_MESSAGE_CREATE"]\n}\n\n## 入口文件示例 (index.js)\n`module.exports = function(ctx, next) {`\n`  if (ctx.event.content === "/hello") {`\n`    ctx.bot.messages.sendChannelMessage(ctx.event.channel_id, {`\n`      content: "Hello World!",`\n`      msg_id: ctx.event.id`\n`    });`\n`    return;`\n`  }`\n`  next();`\n`};`\n\n## 可用的 ctx 对象\nctx.bot - Bot 实例 (所有 API)\nctx.eventType - 事件类型\nctx.event - 事件数据\nctx.state - 跨中间件共享状态',
        },
        {
          title: '插件审核流程',
          content: '1. 普通用户上传插件后，状态为「待审核」\n2. 超级管理员在插件管理页面查看待审核插件\n3. 超级管理员可「批准」或「拒绝」插件\n4. 审核时可填写拒绝原因\n5. 只有「已批准」的插件会被加载执行\n6. 超级管理员上传的插件自动通过审核',
        },
        {
          title: '回调地址说明',
          content: `回调地址: ${callbackUrl}\n平台将在收到事件时 POST 到该地址。\n详细说明见官方文档: https://bot.q.qq.com/wiki`,
        },
        {
          title: '授权码说明',
          content: '授权码分为超级主人和主人角色。\n超级主人拥有全部权限（设置、用户管理、插件审核、机器人管理等）。\n主人拥有基本操作权限（添加管理自己机器人等），权限可由超级管理员配置。\n授权码可设置过期时间，过期后自动注销。',
        },
      ],
    });
  });

  // 功能开关：读取（登录用户） / 设置（超级主人），与插件共用 config 表同一状态
  router.get('/switches', (_req: Request, res: Response) => {
    res.json({ switches: getSwitchStates() });
  });

  router.put('/switches', requireSuperMaster, (req: Request, res: Response) => {
    const { key, enabled } = req.body || {};
    if (!key || typeof enabled !== 'boolean') { res.json({ ok: false, error: '需要 key 与布尔 enabled' }); return; }
    const s = setSwitchState(String(key), enabled);
    if (!s) { res.json({ ok: false, error: '未知开关：' + key }); return; }
    res.json({ ok: true, switch: s });
  });

  // 定时任务：读取（登录用户） / 管理（超级主人）
  router.get('/schedule-tasks', (_req: Request, res: Response) => {
    res.json({ tasks: listScheduleTasks() });
  });

  router.post('/schedule-tasks', requireSuperMaster, (req: Request, res: Response) => {
    const r = createScheduleTask(req.body || {});
    if (!r.ok) { res.json({ ok: false, error: r.error }); return; }
    res.json({ ok: true, task: r.task });
  });

  router.put('/schedule-tasks', requireSuperMaster, (req: Request, res: Response) => {
    const r = updateScheduleTask(req.body || {});
    if (!r.ok) { res.json({ ok: false, error: r.error }); return; }
    res.json({ ok: true, task: r.task });
  });

  router.delete('/schedule-tasks', requireSuperMaster, (req: Request, res: Response) => {
    const id = String(req.query.id || '');
    if (!id) { res.json({ ok: false, error: '缺少 id' }); return; }
    const r = deleteScheduleTask(id);
    res.json({ ok: r.ok });
  });

  router.post('/schedule-tasks/toggle', requireSuperMaster, (req: Request, res: Response) => {
    const id = String((req.body || {}).id || '');
    if (!id) { res.json({ ok: false, error: '缺少 id' }); return; }
    const r = toggleScheduleTask(id);
    if (!r.ok) { res.json({ ok: false, error: r.error }); return; }
    res.json({ ok: true, task: r.task });
  });

  // 机器人互动用户列表（user_mappings：头像/QQ/昵称/OpenID）
  router.get('/users', (_req: Request, res: Response) => {
    try {
      const db = getDb();
      const rows = db.prepare(
        "SELECT openid, qq_number, nickname, bot_id, last_updated FROM user_mappings ORDER BY last_updated DESC LIMIT 1000"
      ).all() as any[];
      res.json({ users: rows });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 反馈提交列表（插件"反馈"命令提交，面板只读）；超主可传 bot_id 过滤
  router.get('/feedbacks', (_req: Request, res: Response) => {
    try {
      const db = getDb();
      const botId = (_req.query.bot_id as string) || '';
      const rows = botId
        ? db.prepare("SELECT * FROM feedbacks WHERE bot_id = ? ORDER BY created_at DESC LIMIT 500").all(botId)
        : db.prepare("SELECT * FROM feedbacks ORDER BY created_at DESC LIMIT 500").all();
      res.json({ feedbacks: rows });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 反馈回复：发私聊给反馈提交者 + 更新状态（面板直接回复）
  router.post('/feedbacks/:id/reply', requireSuperMaster, async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id || '');
      const reply = String((req.body || {}).reply || '').trim();
      if (!id || !reply) { res.json({ ok: false, error: '缺少 id 或回复内容' }); return; }
      const db = getDb();
      const f = db.prepare('SELECT * FROM feedbacks WHERE id = ?').get(id) as any;
      if (!f) { res.json({ ok: false, error: '反馈不存在：' + id }); return; }
      const botId = String(f.bot_id || '');
      let bot: any;
      try { bot = botId ? getBotInstance(botId) || getBot() : getBot(); } catch { bot = null; }
      if (!bot) { res.json({ ok: false, error: '机器人未初始化，无法发送回复' }); return; }
      const openid = String(f.user_openid || '');
      if (!openid) { res.json({ ok: false, error: '反馈提交者无 OpenID，无法私聊回复' }); return; }
      const sent = await bot.sendPrivateMessage(openid, '📩 反馈回复\n━━━━━━━━━━━━━━\n你的反馈：' + String(f.content || '') + '\n━━━━━━━━━━━━━━\n机器人的回复：\n' + reply + '\n━━━━━━━━━━━━━━\nPHP · QQ机器人平台');
      if (!sent) { res.json({ ok: false, error: '机器人私聊发送失败（OpenID: ' + openid.slice(0, 12) + '...）' }); return; }
      db.prepare("UPDATE feedbacks SET reply = ?, status = 'replied', replied_at = datetime('now', 'localtime') WHERE id = ?").run(reply, id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 反馈状态更新（pending → done）
  router.put('/feedbacks/:id', requireSuperMaster, (req: Request, res: Response) => {
    try {
      const id = String(req.params.id || '');
      const status = String((req.body || {}).status || 'done');
      const db = getDb();
      db.prepare('UPDATE feedbacks SET status = ? WHERE id = ?').run(status, id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 删除反馈
  router.delete('/feedbacks/:id', requireSuperMaster, (req: Request, res: Response) => {
    try {
      const id = String(req.params.id || '');
      const db = getDb();
      db.prepare('DELETE FROM feedbacks WHERE id = ?').run(id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 群列表（用户管理/成员同步：群OpenID、群名、群号、群头像、成员数）；超主可传 bot_id 过滤
  router.get('/groups', (_req: Request, res: Response) => {
    try {
      const db = getDb();
      const botId = (_req.query.bot_id as string) || '';
      const rows = (botId
        ? db.prepare('SELECT * FROM groups WHERE bot_id = ? ORDER BY last_active DESC LIMIT 1000').all(botId)
        : db.prepare('SELECT * FROM groups ORDER BY last_active DESC LIMIT 1000').all()) as any[];
      for (const g of rows) {
        try {
          const c = db.prepare('SELECT COUNT(*) AS c FROM group_members WHERE group_id = ?').get(g.id) as any;
          g.member_count = c?.c || 0;
        } catch { g.member_count = g.member_count || 0; }
      }
      res.json({ groups: rows });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 修改群：群名 / 群号（群号变更自动生成群头像）
  router.put('/groups/:id', requireSuperMaster, (req: Request, res: Response) => {
    try {
      const id = String(req.params.id || '');
      const body = req.body || {};
      const db = getDb();
      const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(id) as any;
      if (!g) { res.json({ ok: false, error: '群不存在：' + id }); return; }
      const next = { name: g.name, group_number: g.group_number, avatar: g.avatar };
      if (body.name !== undefined) next.name = String(body.name).trim();
      if (body.group_number !== undefined) {
        next.group_number = String(body.group_number).trim();
        if (/^\d{6,15}$/.test(next.group_number)) next.avatar = `https://p.qlogo.cn/gh/${next.group_number}/${next.group_number}/0`;
      }
      if (body.avatar !== undefined && body.avatar !== '') next.avatar = String(body.avatar).trim();
      db.prepare('UPDATE groups SET name = ?, group_number = ?, avatar = ? WHERE id = ?').run(next.name, next.group_number, next.avatar, id);
      res.json({ ok: true, group: { ...next, id } });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 删除群（连带删除该群群成员记录）
  router.delete('/groups/:id', requireSuperMaster, (req: Request, res: Response) => {
    try {
      const id = String(req.params.id || '');
      const db = getDb();
      db.prepare('DELETE FROM groups WHERE id = ?').run(id);
      db.prepare('DELETE FROM group_members WHERE group_id = ?').run(id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 群+成员合并数据（用户管理页：按群组织，含群头像/群号/群OpenID/群名 与成员 QQ/昵称/授权码/权限）
  router.get('/user-groups', (_req: Request, res: Response) => {
    try {
      const db = getDb();
      const groups = db.prepare('SELECT * FROM groups ORDER BY last_active DESC LIMIT 1000').all() as any[];
      const out: any[] = [];
      for (const g of groups) {
        const members = db.prepare('SELECT member_openid, qq_id, nickname, bot_id, first_seen, last_seen FROM group_members WHERE group_id = ? ORDER BY last_seen DESC').all(g.id) as any[];
        const arr = members.map((m: any) => {
          let qq = (m.qq_id && /^\d{5,12}$/.test(m.qq_id)) ? m.qq_id : '';
          let nick = m.nickname || '';
          let umBotId = m.bot_id || '';
          try {
            const um = db.prepare('SELECT qq_number, nickname, bot_id FROM user_mappings WHERE openid = ?').get(m.member_openid) as any;
            if (um) {
              if (!qq) qq = um.qq_number || '';
              if (!nick) nick = um.nickname || '';
              if (!umBotId) umBotId = um.bot_id || '';
            }
          } catch {}
          return {
            openid: m.member_openid,
            qq_number: qq,
            nickname: nick,
            source: qq ? (m.qq_id ? 'mapped' : 'interact') : 'none',
            bot_id: umBotId,
          };
        });
        out.push({ ...g, members: arr });
      }
      let orphanUsers: any[] = [];
      try {
        orphanUsers = db.prepare(
          "SELECT um.openid, um.qq_number, um.nickname, um.bot_id FROM user_mappings um WHERE NOT EXISTS (SELECT 1 FROM group_members gm WHERE gm.member_openid = um.openid) ORDER BY um.last_updated DESC LIMIT 200"
        ).all() as any[];
      } catch {}
      res.json({ groups: out, orphanUsers });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}