import type { AdminUser } from './config';

// AI 供应商（管理员维护的系统格式）
export interface AiProvider {
  id: string;
  name: string;
  // 供应商标记的 API 格式，如 openai（兼容 /chat/completions）
  format: string;
  baseUrl: string;
  model: string;
  // 系统共享密钥（仅超级主人可见/可改）
  systemKey: string;
}

// 前端可见的供应商（系统密钥脱敏为 hasSystemKey）
export type AiProviderView = Omit<AiProvider, 'systemKey'> & { hasSystemKey: boolean };

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// 每个机器人的 AI 兜底回复配置
export interface AiBotConfig {
  enabled: boolean;
  providerId: string;
  // system=系统共享密钥；own=使用自己的密钥
  keyMode: 'system' | 'own';
  ownKey: string;
  // 留空使用供应商默认
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  // 记忆轮数（0=无记忆）
  memoryRounds: number;
  systemPrompt: string;
  groupEnabled: boolean;
  c2cEnabled: boolean;
  // at=仅 @机器人时回复；all=所有消息都回复
  groupTrigger: 'at' | 'all';
  // OpenAI tools JSON 数组，留空不使用
  toolsJson: string;
}

// 框架内置预设人设模板
export const AI_PRESET_PERSONAS: Array<{ id: string; name: string; prompt: string }> = [
  {
    id: 'default',
    name: '默认智能助手',
    prompt: '你是一个智能QQ群助手，回答简洁友好，用轻松自然的口语化中文回复，避免过长。',
  },
  {
    id: 'cute',
    name: '可爱小助手',
    prompt: '你是一只可爱的AI小助手，说话活泼可爱，偶尔用颜文字，回复简短有趣，乐于帮助群友解决问题。',
  },
  {
    id: 'knowledge',
    name: '百科知识库',
    prompt: '你是一个知识渊博的百科助手，回答准确严谨、条理清晰，遇到不确定的问题会如实说明，回复控制在合理篇幅内。',
  },
  {
    id: 'customer',
    name: '贴心客服',
    prompt: '你是本群的贴心客服，态度耐心礼貌，主动引导群友描述问题并给出解决方案，语气专业友善。',
  },
  {
    id: 'witty',
    name: '幽默段子手',
    prompt: '你是一个幽默风趣的AI，回复带点小幽默和梗，但把握分寸不冒犯人，在轻松中帮群友解决问题。',
  },
];

// 框架内置默认供应商模板（系统密钥由超级主人在面板填写）
export const AI_DEFAULT_PROVIDER: AiProvider = {
  id: 'default-openai-auto',
  name: '柒柒自适应模型',
  format: 'openai',
  baseUrl: 'https://api.18years.ink/openAi/auto',
  model: 'auto',
  systemKey: '',
};

// 用户角色默认可用的侧边栏页面 id 列表（allowedPages 未配置时的缺省）
export const SIDEBAR_PAGES: Array<{ id: string; name: string }> = [
  { id: 'dashboard', name: '仪表盘' },
  { id: 'realtime', name: '消息工作台' },
  { id: 'bots', name: '机器人管理' },
  { id: 'membersync', name: '成员同步' },
  { id: 'channels', name: '群管理' },
  { id: 'editor', name: '卡片编辑器' },
  { id: 'plugins', name: '插件管理' },
  { id: 'menueditor', name: '菜单配置' },
  { id: 'openplatform', name: '开放平台' },
  { id: 'files', name: '文件管理' },
  { id: 'deployterminal', name: '部署终端' },
  { id: 'settings', name: '系统设置' },
  { id: 'users', name: '用户管理' },
  { id: 'openids', name: 'ID 映射' },
  { id: 'feedback', name: '意见反馈' },
  { id: 'ai', name: 'AI 智能回复' },
];
