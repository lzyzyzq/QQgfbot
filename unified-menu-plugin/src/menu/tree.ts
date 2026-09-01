import type { MenuNode } from '../types';

// 统一菜单树：主菜单 → 子菜单（对齐历史「主菜单.js」全量功能，按钮点击后填入输入框待发送触发）
export const MENU_TREE: MenuNode[] = [
  {
    id: 'fun', label: '🎮 娱乐功能',
    children: [
      { id: 'luck', label: '🔮 今日运势', action: '今日运势' },
      { id: 'dice', label: '🎲 掷骰子', action: '掷骰子 2d6' },
      { id: 'rps', label: '✊ 猜拳', action: '猜拳 石头' },
      { id: 'pick', label: '🎯 选择', action: '选择' },
      { id: 'randnum', label: '🔢 随机数', action: '随机数' },
      { id: 'food', label: '🍜 今天吃什么', action: '今天吃什么' },
      { id: 'integrity', label: '👤 今日人品', action: '今日人品' },
      { id: 'cp', label: '💕 抽老婆', action: '抽老婆' },
      { id: 'woodfish', label: '🙏 敲木鱼', action: '敲木鱼' },
      { id: 'joke', label: '😄 笑话', action: '笑话' },
      { id: 'guessnum', label: '🎯 猜数字', action: '猜数字' },
    ],
  },
  {
    id: 'util', label: '🛠 实用功能',
    children: [
      { id: 'myinfo', label: '👤 个人信息', action: '个人信息' },
      { id: 'groupinfo', label: '📈 群信息', action: '群信息' },
      { id: 'checkin', label: '📅 每日打卡', action: '每日打卡' },
      { id: 'note', label: '📝 每日备注', action: '每日备注' },
      { id: 'nick', label: '✏️ 设置昵称', action: '设置昵称' },
      { id: 'bindqq', label: '📎 绑定QQ', action: '绑定QQ' },
      { id: 'weather', label: '🌤 查询天气', action: '查询天气' },
      { id: 'backcheck', label: '⏪ 补签', action: '补签' },
      { id: 'signrank', label: '🏆 签到排行', action: '签到排行' },
      { id: 'pointrank', label: '💰 积分排行', action: '积分排行' },
    ],
  },
  {
    id: 'auth', label: '🔐 授权功能',
    children: [
      { id: 'gencode', label: '🔑 获取激活码', action: '获取激活码' },
      { id: 'actcode', label: '🔓 激活授权码', action: '激活授权码' },
      { id: 'login', label: '🔐 登录链接', action: '登录' },
    ],
  },
  {
    id: 'sys', label: '⚙️ 系统功能',
    children: [
      { id: 'ver', label: '📦 版本', action: '版本' },
      { id: 'uptime', label: '⏱ 在线时间', action: '在线时间' },
      { id: 'changelog', label: '📋 更新日志', action: '更新日志' },
      { id: 'patrol', label: '🔍 查巡', action: '查巡' },
    ],
  },
  {
    id: 'setting', label: '🔧 设置功能',
    children: [
      { id: 'chime', label: '⏰ 报时设置', action: '报时' },
      { id: 'welcome', label: '👋 欢迎提示', action: '欢迎提示' },
      { id: 'mode', label: '🎨 全局模式', action: '切换全局模式' },
    ],
  },
  {
    id: 'groupadm', label: '👥 群管系统',
    children: [
      { id: 'muteall', label: '🔒 开启全禁', action: '开启群全禁' },
      { id: 'unmuteall', label: '🔓 关闭全禁', action: '关闭群全禁' },
      { id: 'mute', label: '🔇 禁言', action: '禁言' },
      { id: 'unmute', label: '🔊 解禁', action: '解禁' },
      { id: 'kick', label: '👢 踢人', action: '踢人' },
    ],
  },
  {
    id: 'guildadm', label: '📢 频道管理',
    children: [
      { id: 'guilds', label: '📢 频道列表', action: '频道列表' },
      { id: 'gboards', label: '🗂 板块列表', action: '板块列表' },
      { id: 'gdetail', label: '📄 频道详情', action: '频道详情' },
      { id: 'gcreate', label: '📝 创建频道', action: '创建频道' },
      { id: 'grename', label: '✏️ 修改频道', action: '修改频道' },
      { id: 'gdelete', label: '🗑 删除频道', action: '删除频道' },
      { id: 'gpost', label: '📤 频道发帖', action: '频道发帖' },
      { id: 'gdelmsg', label: '🗑 频道删帖', action: '频道删帖' },
      { id: 'gactivity', label: '📊 频道活跃度', action: '频道活跃度' },
      { id: 'gsign', label: '📅 频道签到', action: '频道签到' },
    ],
  },
  {
    id: 'learn', label: '📚 词典学习',
    children: [
      { id: 'dicon', label: '🟢 开启dic回复', action: '开启dic回复' },
      { id: 'dicoff', label: '🔴 关闭dic回复', action: '关闭dic回复' },
      { id: 'ladd', label: '➕ 添加词条', action: '学习' },
      { id: 'llist', label: '📋 词条列表', action: '词条列表' },
      { id: 'ldel', label: '➖ 删除词条', action: '删词条' },
    ],
  },
  { id: 'ai', label: '🤖 AI 对话', action: 'AI' },
  { id: 'sign', label: '📅 签到', action: '签到' },
];

export function findNodeByAction(action: string): MenuNode | null {
  const stack: MenuNode[] = [...MENU_TREE];
  while (stack.length) {
    const n = stack.shift()!;
    if (n.action && (n.action === action || action.startsWith(n.action))) return n;
    if (n.children) stack.push(...n.children);
  }
  return null;
}

export function findNodeByLabel(label: string): MenuNode | null {
  const target = label.trim();
  const stack: MenuNode[] = [...MENU_TREE];
  while (stack.length) {
    const n = stack.shift()!;
    const plain = n.label.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').trim();
    if (plain === target || plain.replace(/\s+/g, '') === target.replace(/\s+/g, '')) return n;
    if (n.children) stack.push(...n.children);
  }
  return null;
}

export function parentOf(node: MenuNode): MenuNode | null {
  const stack: MenuNode[] = [...MENU_TREE];
  while (stack.length) {
    const n = stack.shift()!;
    if (n.children && n.children.some((c) => c.id === node.id)) return n;
    if (n.children) stack.push(...n.children);
  }
  return null;
}

export function rootOf(): MenuNode {
  return { id: 'main', label: '🌟 主菜单', children: MENU_TREE };
}
