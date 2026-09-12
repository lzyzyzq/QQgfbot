import fs from 'fs';
import path from 'path';
import type { ReplySpec } from './reply-editor';

export interface CatalogVar {
  name: string;
  desc: string;
  group: string;
  example?: string;
  kind?: 'reply' | 'engine' | 'bot' | 'event' | 'weatherapi' | 'dict' | 'plugin';
}

export interface CatalogCmd {
  text: string;
  source: string;
}

export interface CatalogPlugin {
  name: string;
  id: string;
  version: string;
  desc: string;
  file: string;
  type: 'js' | 'php' | 'py' | 'dict' | 'unknown';
  commands: CatalogCmd[];
  variables: CatalogVar[];
}

// 内置/后端/官方平台变量字典（供面板参考与自动补全）
export const OFFICIAL_VARIABLES: CatalogVar[] = [
  // —— ReplySpec 回复模板通用键（{key} 占位，所有指令型插件可用）——
  { name: 'botId', desc: '当前机器人 ID', group: '回复模板通用键', example: '{botId}', kind: 'reply' },
  { name: 'botName', desc: '当前机器人昵称', group: '回复模板通用键', example: '{botName}', kind: 'reply' },
  { name: 'botShow', desc: '机器人展示名（昵称（ID）或纯 ID）', group: '回复模板通用键', example: '{botShow}', kind: 'reply' },
  { name: 'gid', desc: '当前群 OpenID', group: '回复模板通用键', example: '{gid}', kind: 'reply' },
  { name: 'openid', desc: '发送者 OpenID', group: '回复模板通用键', example: '{openid}', kind: 'reply' },
  { name: 'qq', desc: '发送者 QQ 号（已绑定）', group: '回复模板通用键', example: '{qq}', kind: 'reply' },
  { name: 'nick', desc: '发送者昵称', group: '回复模板通用键', example: '{nick}', kind: 'reply' },
  { name: 'guildId', desc: '频道 ID（频道场景）', group: '回复模板通用键', example: '{guildId}', kind: 'reply' },
  { name: 'role', desc: '成员角色（owner/admin/member/user）', group: '回复模板通用键', example: '{role}', kind: 'reply' },
  { name: 'gcount', desc: '群成员数量', group: '回复模板通用键', example: '{gcount}', kind: 'reply' },

  // —— 消息事件 data 字段 ——
  { name: 'data.id', desc: '消息 ID', group: '消息事件字段', example: 'data.id', kind: 'event' },
  { name: 'data.content', desc: '消息正文（已去 @）', group: '消息事件字段', example: 'data.content', kind: 'event' },
  { name: 'data.author.id', desc: '发送者 OpenID', group: '消息事件字段', example: 'data.author.id', kind: 'event' },
  { name: 'data.author.openid', desc: '发送者 OpenID（兼容字段）', group: '消息事件字段', example: 'data.author.openid', kind: 'event' },
  { name: 'data.author.member_openid', desc: '群成员 OpenID', group: '消息事件字段', example: 'data.author.member_openid', kind: 'event' },
  { name: 'data.author.username', desc: '发送者昵称', group: '消息事件字段', example: 'data.author.username', kind: 'event' },
  { name: 'data.groupId', desc: '群 OpenID', group: '消息事件字段', example: 'data.groupId', kind: 'event' },
  { name: 'data.channelId', desc: '频道 ID', group: '消息事件字段', example: 'data.channelId', kind: 'event' },
  { name: 'data.group_name', desc: '群名称（部分场景）', group: '消息事件字段', example: 'data.group_name', kind: 'event' },
  { name: 'data.timestamp', desc: '消息时间戳', group: '消息事件字段', example: 'data.timestamp', kind: 'event' },

  // —— 插件上下文 ctx.*（JS 插件） ——
  { name: 'ctx.bot', desc: '机器人能力集合（BotAPI，见“机器人与群接口”）', group: '插件上下文 ctx', example: 'ctx.bot.sendGroupMessage(...)', kind: 'engine' },
  { name: 'ctx.storage.get(key)', desc: '读插件存储（按插件隔离，跨消息持久）', group: '插件上下文 ctx', example: "ctx.storage.get('k')", kind: 'engine' },
  { name: 'ctx.storage.set(key,val)', desc: '写插件存储', group: '插件上下文 ctx', example: "ctx.storage.set('k','v')", kind: 'engine' },
  { name: 'ctx.storage.delete(key)', desc: '删插件存储', group: '插件上下文 ctx', example: "ctx.storage.delete('k')", kind: 'engine' },
  { name: 'ctx.config', desc: '插件配置对象（manifest/config 面板值）', group: '插件上下文 ctx', example: 'ctx.config.xxx', kind: 'engine' },
  { name: 'ctx.logger', desc: '日志：info/warn/error/debug', group: '插件上下文 ctx', example: "ctx.logger.info('hi')", kind: 'engine' },
  { name: 'ctx.data', desc: '本地 JSON/文本读写（限 data/database）：readJSON/writeJSON/remove/readText', group: '插件上下文 ctx', example: "ctx.data.readJSON('a.json')", kind: 'engine' },
  { name: 'ctx.link.mode()', desc: '外显开关 on/off', group: '插件上下文 ctx', example: 'ctx.link.mode()', kind: 'engine' },
  { name: 'ctx.link.linkify(text,cmd)', desc: '把文字渲染为可点击外显链接', group: '插件上下文 ctx', example: "ctx.link.linkify('菜单','菜单')", kind: 'engine' },
  { name: 'ctx.link.menuLink(label,item)', desc: '按菜单项生成外显链接', group: '插件上下文 ctx', example: "ctx.link.menuLink('菜单',{value:'菜单'})", kind: 'engine' },
  { name: 'ctx.identity.getQQ(openid)', desc: 'OpenID → QQ 号', group: '插件上下文 ctx', example: 'ctx.identity.getQQ(openid)', kind: 'engine' },
  { name: 'ctx.identity.getOpenids(qq)', desc: 'QQ 号 → 所有 OpenID', group: '插件上下文 ctx', example: 'ctx.identity.getOpenids(qq)', kind: 'engine' },
  { name: 'ctx.identity.getInfo(openid)', desc: '查询用户信息', group: '插件上下文 ctx', example: 'ctx.identity.getInfo(openid)', kind: 'engine' },
  { name: 'ctx.identity.isSameUser(a,b)', desc: '判断两个 OpenID 是否同一人', group: '插件上下文 ctx', example: 'ctx.identity.isSameUser(a,b)', kind: 'engine' },
  { name: 'ctx.eventBus', desc: '事件总线：on/off/emit（message.group/c2c/guild）', group: '插件上下文 ctx', example: "ctx.eventBus.on('message.group',fn)", kind: 'engine' },

  // —— 引擎 API（ctx.engine.*） ——
  { name: 'ctx.engine.callPlugin(name,method,...)', desc: '跨插件调用方法', group: '引擎 API', example: "ctx.engine.callPlugin('主菜单','sendMessage',...)", kind: 'engine' },
  { name: 'ctx.engine.getBotName()', desc: '当前机器人昵称', group: '引擎 API', example: 'ctx.engine.getBotName()', kind: 'engine' },
  { name: 'ctx.engine.getBotNameById(id)', desc: '按机器人 ID 取昵称', group: '引擎 API', example: "ctx.engine.getBotNameById(botId)", kind: 'engine' },
  { name: 'ctx.engine.getGroupName(gid)', desc: '群 OpenID → 群名称', group: '引擎 API', example: 'ctx.engine.getGroupName(gid)', kind: 'engine' },
  { name: 'ctx.engine.getGroupNumber(gid)', desc: '群 OpenID → 数字群号', group: '引擎 API', example: 'ctx.engine.getGroupNumber(gid)', kind: 'engine' },
  { name: 'ctx.engine.getConfigValue(key)', desc: '读全局 config（如 bot.weather_text_api）', group: '引擎 API', example: "ctx.engine.getConfigValue('bot.name')", kind: 'engine' },
  { name: 'ctx.engine.setConfigValue(key,val)', desc: '写全局 config', group: '引擎 API', example: "ctx.engine.setConfigValue('k','v')", kind: 'engine' },
  { name: 'ctx.engine.getVariable(name)', desc: '读面板“全局变量”', group: '引擎 API', example: "ctx.engine.getVariable('weather_api')", kind: 'engine' },
  { name: 'ctx.engine.setVariable(name,val)', desc: '写面板“全局变量”', group: '引擎 API', example: "ctx.engine.setVariable('k','v')", kind: 'engine' },
  { name: 'ctx.engine.listVariables()', desc: '列出全部全局变量', group: '引擎 API', example: 'ctx.engine.listVariables()', kind: 'engine' },
  { name: 'ctx.engine.getUserProfile(openid,limit)', desc: '聚合用户资料：openid/qq_number/nickname/avatar/permission/auth_code/auth_role/logs', group: '引擎 API', example: 'ctx.engine.getUserProfile(openid,1)', kind: 'engine' },
  { name: 'ctx.engine.getGroupProfile(gid,limit)', desc: '聚合群资料（成员/群主等）', group: '引擎 API', example: 'ctx.engine.getGroupProfile(gid)', kind: 'engine' },
  { name: 'ctx.engine.getGroupMemberRole(gid,openid)', desc: '成员角色 owner/admin/member/user', group: '引擎 API', example: 'ctx.engine.getGroupMemberRole(gid,openid)', kind: 'engine' },
  { name: 'ctx.engine.findGroupOwner(gid)', desc: '查群主 {openid,qq_id,nickname,role}', group: '引擎 API', example: 'ctx.engine.findGroupOwner(gid)', kind: 'engine' },
  { name: 'ctx.engine.resolveOpenidByQq(qq)', desc: 'QQ → OpenID', group: '引擎 API', example: 'ctx.engine.resolveOpenidByQq(qq)', kind: 'engine' },
  { name: 'ctx.engine.getGroupMemberOpenidByNickname(gid,nick)', desc: '按昵称查群成员 OpenID', group: '引擎 API', example: 'ctx.engine.getGroupMemberOpenidByNickname(gid,nick)', kind: 'engine' },
  { name: 'ctx.engine.getGroupMemberAvatar(gid,openid)', desc: '群成员头像 URL', group: '引擎 API', example: 'ctx.engine.getGroupMemberAvatar(gid,openid)', kind: 'engine' },
  { name: 'ctx.engine.bindUserQQ(openid,qq,nick?)', desc: '绑定 OpenID 与 QQ', group: '引擎 API', example: 'ctx.engine.bindUserQQ(openid,qq)', kind: 'engine' },
  { name: 'ctx.engine.getGlobalMode()', desc: '全局模式 text/text_link/image/button', group: '引擎 API', example: 'ctx.engine.getGlobalMode()', kind: 'engine' },
  { name: 'ctx.engine.getLinkMode()', desc: '外显开关 on/off', group: '引擎 API', example: 'ctx.engine.getLinkMode()', kind: 'engine' },
  { name: 'ctx.engine.linkify(text,cmd)', desc: '生成 mqqapi 外显链接', group: '引擎 API', example: "ctx.engine.linkify('菜单','菜单')", kind: 'engine' },
  { name: 'ctx.engine.buildClickUrl(g,u,action)', desc: '生成面板点击跳转 URL', group: '引擎 API', example: 'ctx.engine.buildClickUrl(g,u,action)', kind: 'engine' },
  { name: 'ctx.engine.getPanelBaseUrl()', desc: '面板基础地址', group: '引擎 API', example: 'ctx.engine.getPanelBaseUrl()', kind: 'engine' },
  { name: 'ctx.engine.enable/disable/reload(name)', desc: '启停/重载插件', group: '引擎 API', example: "ctx.engine.reload('file-xxx')", kind: 'engine' },

  // —— 机器人能力 ctx.bot.*（BotAPI） ——
  { name: 'ctx.bot.sendGroupMessage(gid,text,msgId)', desc: '发群文本', group: '机器人与群接口', example: 'ctx.bot.sendGroupMessage(gid,text)', kind: 'bot' },
  { name: 'ctx.bot.sendPrivateMessage(openid,text,msgId)', desc: '发单聊文本', group: '机器人与群接口', example: 'ctx.bot.sendPrivateMessage(openid,text)', kind: 'bot' },
  { name: 'ctx.bot.sendMarkdownGroup(gid,md,msgId)', desc: '发群 Markdown', group: '机器人与群接口', example: 'ctx.bot.sendMarkdownGroup(gid,md)', kind: 'bot' },
  { name: 'ctx.bot.sendMarkdownPrivate(openid,md,msgId)', desc: '发单聊 Markdown', group: '机器人与群接口', example: 'ctx.bot.sendMarkdownPrivate(openid,md)', kind: 'bot' },
  { name: 'ctx.bot.sendKeyboardGroup(gid,rows)', desc: '发群按钮键盘', group: '机器人与群接口', example: 'ctx.bot.sendKeyboardGroup(gid,rows)', kind: 'bot' },
  { name: 'ctx.bot.sendGroupMarkdownWithImage(gid,md,img,msgId)', desc: 'Markdown + 图片（头像卡等）', group: '机器人与群接口', example: 'ctx.bot.sendGroupMarkdownWithImage(gid,md,img)', kind: 'bot' },
  { name: 'ctx.bot.uploadGroupImage(gid,url)', desc: '上传群图片，返回 file_info', group: '机器人与群接口', example: 'ctx.bot.uploadGroupImage(gid,url)', kind: 'bot' },
  { name: 'ctx.bot.sendGroupImageMessage(gid,file,msgId)', desc: '发送已上传图片', group: '机器人与群接口', example: 'ctx.bot.sendGroupImageMessage(gid,file)', kind: 'bot' },
  { name: 'ctx.bot.sendImageMessage(...)', desc: '发送图片消息', group: '机器人与群接口', example: 'ctx.bot.sendImageMessage(...)', kind: 'bot' },
  { name: 'ctx.bot.muteMember(gid,openid,seconds)', desc: '禁言成员', group: '机器人与群接口', example: 'ctx.bot.muteMember(gid,openid,300)', kind: 'bot' },
  { name: 'ctx.bot.unmuteMember(gid,openid)', desc: '解除禁言', group: '机器人与群接口', example: 'ctx.bot.unmuteMember(gid,openid)', kind: 'bot' },
  { name: 'ctx.bot.muteAll(gid,enable)', desc: '全员禁言/解除', group: '机器人与群接口', example: 'ctx.bot.muteAll(gid,true)', kind: 'bot' },
  { name: 'ctx.bot.kickMember(gid,openid,reject)', desc: '踢出成员', group: '机器人与群接口', example: 'ctx.bot.kickMember(gid,openid)', kind: 'bot' },
  { name: 'ctx.bot.deleteMessage(gid,msgId)', desc: '撤回消息', group: '机器人与群接口', example: 'ctx.bot.deleteMessage(gid,msgId)', kind: 'bot' },
  { name: 'ctx.bot.getGroupMembers(gid)', desc: '取群成员列表', group: '机器人与群接口', example: 'ctx.bot.getGroupMembers(gid)', kind: 'bot' },
  { name: 'ctx.bot.getGroupInfo(gid)', desc: '取群信息：group_openid/group_name/member_count/max_member_count/owner_member_openid/is_owner/created_at/description', group: '机器人与群接口', example: 'ctx.bot.getGroupInfo(gid)', kind: 'bot' },
  { name: 'ctx.bot.setAnnouncement(gid,content)', desc: '设置群公告', group: '机器人与群接口', example: 'ctx.bot.setAnnouncement(gid,text)', kind: 'bot' },
  { name: 'ctx.bot.deleteAnnouncement(gid)', desc: '删除群公告', group: '机器人与群接口', example: 'ctx.bot.deleteAnnouncement(gid)', kind: 'bot' },
  { name: 'ctx.bot.getStatus()', desc: '机器人状态', group: '机器人与群接口', example: 'ctx.bot.getStatus()', kind: 'bot' },

  // —— 天气接口返回字段（/api/bot/weather） ——
  { name: 'ok', desc: '天气接口成功标志', group: '天气接口字段', example: 'lj.ok', kind: 'weatherapi' },
  { name: 'city', desc: '城市名', group: '天气接口字段', example: 'lj.city', kind: 'weatherapi' },
  { name: 'desc', desc: '天气描述', group: '天气接口字段', example: 'lj.desc', kind: 'weatherapi' },
  { name: 'temp', desc: '温度', group: '天气接口字段', example: 'lj.temp', kind: 'weatherapi' },
  { name: 'feels', desc: '体感温度', group: '天气接口字段', example: 'lj.feels', kind: 'weatherapi' },
  { name: 'humidity', desc: '湿度', group: '天气接口字段', example: 'lj.humidity', kind: 'weatherapi' },
  { name: 'wind', desc: '风力', group: '天气接口字段', example: 'lj.wind', kind: 'weatherapi' },
  { name: 'winddir', desc: '风向', group: '天气接口字段', example: 'lj.winddir', kind: 'weatherapi' },
  { name: 'minT', desc: '最低温', group: '天气接口字段', example: 'lj.minT', kind: 'weatherapi' },
  { name: 'maxT', desc: '最高温', group: '天气接口字段', example: 'lj.maxT', kind: 'weatherapi' },
  { name: 'date', desc: '日期', group: '天气接口字段', example: 'lj.date', kind: 'weatherapi' },
  { name: 'updateTime', desc: '更新时间', group: '天气接口字段', example: 'lj.updateTime', kind: 'weatherapi' },
  { name: 'hourly', desc: '逐小时预报', group: '天气接口字段', example: 'lj.hourly', kind: 'weatherapi' },
  { name: 'forecast7', desc: '未来 7 天预报数组', group: '天气接口字段', example: 'lj.forecast7', kind: 'weatherapi' },
  { name: 'today', desc: '今日概览', group: '天气接口字段', example: 'lj.today', kind: 'weatherapi' },
  { name: 'tomorrow', desc: '明日概览', group: '天气接口字段', example: 'lj.tomorrow', kind: 'weatherapi' },
  { name: 'warnings', desc: '预警数组 {type,level,content}', group: '天气接口字段', example: 'lj.warnings', kind: 'weatherapi' },
  { name: 'air', desc: '空气质量 {level,aqi,pm25}', group: '天气接口字段', example: 'lj.air', kind: 'weatherapi' },
  { name: 'uvIndex', desc: '紫外线指数', group: '天气接口字段', example: 'lj.uvIndex', kind: 'weatherapi' },
  { name: 'sunrise', desc: '日出时间', group: '天气接口字段', example: 'lj.sunrise', kind: 'weatherapi' },
  { name: 'sunset', desc: '日落时间', group: '天气接口字段', example: 'lj.sunset', kind: 'weatherapi' },
  { name: 'pressure', desc: '气压', group: '天气接口字段', example: 'lj.pressure', kind: 'weatherapi' },
  { name: 'visibility', desc: '能见度', group: '天气接口字段', example: 'lj.visibility', kind: 'weatherapi' },

  // —— 全局模式取值 ——
  { name: 'text', desc: '全局模式：纯文字', group: '全局模式取值', kind: 'engine' },
  { name: 'text_link', desc: '全局模式：文字+外显链接', group: '全局模式取值', kind: 'engine' },
  { name: 'image', desc: '全局模式：图片', group: '全局模式取值', kind: 'engine' },
  { name: 'button', desc: '全局模式：按钮', group: '全局模式取值', kind: 'engine' },
];

// lzyqzb TXT 词库引擎内置变量（娱乐群管）
export const DICT_VARIABLES: CatalogVar[] = [
  { name: '消息', desc: '消息正文', group: 'lzyqzb 词库变量', kind: 'dict' },
  { name: '完整消息', desc: '消息正文（同“消息”）', group: 'lzyqzb 词库变量', kind: 'dict' },
  { name: '昵称', desc: '发送者昵称', group: 'lzyqzb 词库变量', kind: 'dict' },
  { name: 'QQ', desc: '发送者 OpenID', group: 'lzyqzb 词库变量', kind: 'dict' },
  { name: '群号', desc: '群 OpenID', group: 'lzyqzb 词库变量', kind: 'dict' },
  { name: '频道ID', desc: '频道 ID', group: 'lzyqzb 词库变量', kind: 'dict' },
  { name: '消息ID', desc: '消息 ID', group: 'lzyqzb 词库变量', kind: 'dict' },
  { name: '使用次数', desc: '本群累计使用次数（含本次）', group: 'lzyqzb 词库变量', kind: 'dict' },
  { name: '访问次数', desc: '本群累计使用次数（同“使用次数”）', group: 'lzyqzb 词库变量', kind: 'dict' },
  { name: '指令次数', desc: '当前指令在本群已使用次数', group: 'lzyqzb 词库变量', kind: 'dict' },
  { name: '当前指令次数', desc: '当前指令在本群已使用次数（同上）', group: 'lzyqzb 词库变量', kind: 'dict' },
  { name: '全局次数', desc: '所有群累计使用次数', group: 'lzyqzb 词库变量', kind: 'dict' },
  { name: '当前指令', desc: '当前命中的规则名', group: 'lzyqzb 词库变量', kind: 'dict' },
  { name: '日期', desc: '今天日期 YYYY-MM-DD', group: 'lzyqzb 词库变量', kind: 'dict' },
  { name: '时间', desc: '当前时间 HH:MM:SS', group: 'lzyqzb 词库变量', kind: 'dict' },
  { name: '完整时间', desc: '当前日期时间', group: 'lzyqzb 词库变量', kind: 'dict' },
  { name: '括号1', desc: '(.*) 捕获的第 1 个参数', group: 'lzyqzb 词库变量', kind: 'dict' },
  { name: '参数1', desc: '(.*) 捕获的第 1 个参数（同“括号1”）', group: 'lzyqzb 词库变量', kind: 'dict' },
];

function readTextSafe(file: string): string {
  try { return fs.readFileSync(file, 'utf-8'); } catch { return ''; }
}

// 从 JS/PY 源码启发式提取触发命令
export function extractCommands(src: string): string[] {
  const set = new Set<string>();
  const add = (s: string) => {
    const t = String(s || '').trim();
    if (!t || t.length > 40) return;
    if (/^[\\/.]$/.test(t)) return;
    set.add(t);
  };
  // content === 'x'
  for (const m of src.matchAll(/content\s*===\s*['"]([^'"]+)['"]/g)) add(m[1]);
  // content.indexOf('x') / startsWith('x')
  for (const m of src.matchAll(/content\.(?:indexOf|startsWith)\s*\(\s*['"]([^'"]+)['"]/g)) add(m[1]);
  // ReplySpec / 数组 triggers: ['a','b']
  for (const m of src.matchAll(/triggers\s*:\s*\[([^\]]*)\]/g)) {
    for (const q of m[1].matchAll(/['"]([^'"]+)['"]/g)) add(q[1]);
  }
  // 正则 ^(a|b|c)(.*)$
  for (const m of src.matchAll(/\^\(([^)]+)\)/g)) {
    for (const part of m[1].split('|')) {
      const t = part.trim();
      if (t && /^[\u4e00-\u9fa5A-Za-z0-9_]+$/.test(t)) add(t);
    }
  }
  // PHP/PY 头注释 → 命令
  for (const m of src.matchAll(/→\s*([^\s/|，,]+)/g)) add(m[1]);
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function detectType(file: string): CatalogPlugin['type'] {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return 'js';
  if (ext === '.php') return 'php';
  if (ext === '.py') return 'py';
  if (ext === '.txt' || ext === '.cid') return 'dict';
  return 'unknown';
}

// lzyqzb 词库规则/触发
function parseDict(text: string): { rules: string[]; triggers: string[] } {
  const rules: string[] = [];
  const triggers: string[] = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const t = line.trim();
    const rm = t.match(/^规则\s+(\S.*)$/);
    if (rm) rules.push(rm[1].trim());
    const tm = t.match(/^触发\s+(\S.*)$/);
    if (tm) triggers.push(tm[1].trim());
  }
  return { rules, triggers };
}

// 从 ReplySpec 中提取 {key} 占位与 row/val 取值键
function extractSpecVars(spec: ReplySpec | null): CatalogVar[] {
  const vars = new Map<string, string>();
  if (spec && Array.isArray(spec.branches)) {
    for (const b of spec.branches) {
      for (const ln of (b.lines || []) as any[]) {
        const texts: string[] = [];
        if (typeof ln.v === 'string') texts.push(ln.v);
        if (typeof ln.pre === 'string') texts.push(ln.pre);
        if (typeof ln.post === 'string') texts.push(ln.post);
        if (typeof ln.fb === 'string') texts.push(ln.fb);
        if (typeof ln.k === 'string' && ln.k && !/^\{/.test(ln.k)) {
          if (!vars.has(ln.k)) vars.set(ln.k, '取值键（' + (ln.t === 'row' ? '同行动态' : '取值行') + '）');
        }
        for (const s of texts) {
          for (const m of s.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
            if (!vars.has(m[1])) vars.set(m[1], '回复模板占位');
          }
        }
      }
    }
  }
  return Array.from(vars.entries()).map(([name, desc]) => ({
    name,
    desc,
    group: '本插件回复变量',
    example: '{' + name + '}',
    kind: 'reply' as const,
  }));
}

// 从插件源码提取内嵌的 REPLY_SPEC（写回源码后固化为 JSON 常量）
export function extractSourceSpec(src: string): ReplySpec | null {
  const begin = '/*__REPLY_SPEC_BEGIN__*/';
  const end = '/*__REPLY_SPEC_END__*/';
  const b = src.indexOf(begin);
  if (b < 0) return null;
  const e = src.indexOf(end, b + begin.length);
  if (e < 0) return null;
  const body = src.slice(b + begin.length, e);
  const eq = body.indexOf('=');
  if (eq < 0) return null;
  let json = body.slice(eq + 1).trim();
  if (json.endsWith(';')) json = json.slice(0, -1);
  try {
    const spec = JSON.parse(json);
    return spec && Array.isArray(spec.branches) ? (spec as ReplySpec) : null;
  } catch {
    return null;
  }
}

function readManifest(src: string): { id: string; name: string; version: string; desc: string; author: string } | null {
  const pick = (re: RegExp) => { const m = src.match(re); return m ? m[1].trim() : ''; };
  const name = pick(/name\s*:\s*['"]([^'"]+)['"]/);
  if (!name) return null;
  return {
    id: pick(/id\s*:\s*['"]([^'"]+)['"]/),
    name,
    version: pick(/version\s*:\s*['"]([^'"]+)['"]/),
    desc: pick(/description\s*:\s*['"]([^'"]+)['"]/),
    author: pick(/author\s*:\s*['"]([^'"]+)['"]/) || pick(/@author\s*[:：]?\s*(.+)/),
  };
}

export function buildCatalog(
  pluginsDir: string,
  specOf?: (name: string) => ReplySpec | null,
): { official: CatalogVar[]; dictVariables: CatalogVar[]; plugins: CatalogPlugin[] } {
  const plugins: CatalogPlugin[] = [];
  const names = (() => { try { return fs.readdirSync(pluginsDir); } catch { return [] as string[]; } })();
  const cidDir = path.join(pluginsDir, '词库');

  // 顶层插件
  for (const n of names.sort((a, b) => a.localeCompare(b, 'zh-CN'))) {
    const full = path.join(pluginsDir, n);
    let st: fs.Stats;
    try { st = fs.statSync(full); } catch { continue; }
    if (!st.isFile()) continue;
    const type = detectType(n);
    if (type === 'unknown') continue;
    if (type === 'dict') continue; // 词库单独处理
    if (n === 'php_helpers.php') continue; // 辅助库，非独立插件
    const src = readTextSafe(full);
    const mf = readManifest(src);
    const cmds = extractCommands(src).map((text) => ({ text, source: n }));
    const spec = (specOf && (specOf(n) || specOf(n.replace(/\.[^.]+$/, '')))) || extractSourceSpec(src);
    const vars = extractSpecVars(spec);
    if (spec) {
      for (const b of spec.branches || []) {
        for (const t of b.triggers || []) {
          const tt = String(t || '').trim();
          if (tt && !cmds.some((c) => c.text === tt)) cmds.push({ text: tt, source: n });
        }
      }
    }
    plugins.push({
      name: (mf && mf.name) || n.replace(/\.[^.]+$/, ''),
      id: (mf && mf.id) || '',
      version: (mf && mf.version) || '',
      desc: (mf && mf.desc) || '',
      file: n,
      type,
      commands: cmds,
      variables: vars,
    });
  }

  // 词库（plugins/词库/*.txt + plugins 根目录旧词库）
  const dictFiles: string[] = [];
  const collectDicts = (dir: string, prefix: string) => {
    let ents: string[] = [];
    try { ents = fs.readdirSync(dir); } catch { return; }
    for (const n of ents) {
      const ext = path.extname(n).toLowerCase();
      if (ext !== '.txt' && ext !== '.cid') continue;
      try { if (!fs.statSync(path.join(dir, n)).isFile()) continue; } catch { continue; }
      dictFiles.push(prefix + n);
    }
  };
  collectDicts(cidDir, '词库/');
  for (const n of names) {
    if (path.extname(n).toLowerCase() !== '.txt') continue;
    if (fs.existsSync(path.join(cidDir, n))) continue;
    dictFiles.push(n);
  }
  for (const rel of dictFiles.sort((a, b) => a.localeCompare(b, 'zh-CN'))) {
    const full = path.join(pluginsDir, rel);
    const src = readTextSafe(full);
    const { rules, triggers } = parseDict(src);
    if (!rules.length && !triggers.length) continue;
    plugins.push({
      name: rel.replace(/^词库\//, '').replace(/\.(txt|cid)$/i, ''),
      id: '',
      version: '',
      desc: 'lzyqzb TXT 规则词库（' + rules.length + ' 条规则 / ' + triggers.length + ' 个触发）',
      file: rel,
      type: 'dict',
      commands: Array.from(new Set(triggers)).map((t) => ({ text: t, source: rel })),
      variables: [...DICT_VARIABLES],
    });
  }

  return { official: OFFICIAL_VARIABLES, dictVariables: DICT_VARIABLES, plugins };
}
