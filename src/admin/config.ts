export interface AdminConfig {
  port: number;
  authCode: string;
  admins: AdminUser[];
  sessionExpireHours: number;
  pluginsDir: string;
  dataDir: string;
}

export interface AdminUser {
  username: string;
  password: string;
  role: 'super_master' | 'master' | 'member' | 'user';
  qq?: string;
  nickname?: string;
  openid?: string;
  avatar?: string;
  loginAble: boolean;
  expireAt?: number;
  permissions?: UserPermission;
  createdBy?: string;
  createdAt?: number;
  passwordChangedAt?: string;
  // 金币余额：AI 兜底回复等增值功能按次扣减，仅超级主人可增减
  coins?: number;
  // 侧边栏可用页面列表（值为页面 id）；未设置或空数组=按角色默认全部可用；超级主人始终不受限
  allowedPages?: string[];
  // 绑定邮箱：注册时验证码验证绑定；本人改绑需邮箱验证码；超级主人可直接修改他人邮箱
  email?: string;
}

export interface UserPermission {
  canAddBot: boolean;
  maxBots: number;
  canEditBot: boolean;
  canDeleteBot: boolean;
  canUploadPlugin: boolean;
  canManageOwnPlugins: boolean;
  canUseAllPlugins: boolean;
  canEditPluginCode: boolean;
  canManageGroups: boolean;
  canTestPlugin: boolean;
}

export const ROLE_PERMISSIONS: Record<string, UserPermission> = {
  super_master: {
    canAddBot: true, maxBots: 5, canEditBot: true, canDeleteBot: true,
    canUploadPlugin: true, canManageOwnPlugins: true, canUseAllPlugins: true,
    canEditPluginCode: true, canManageGroups: true, canTestPlugin: true,
  },
  master: {
    canAddBot: true, maxBots: 1, canEditBot: true, canDeleteBot: true,
    canUploadPlugin: true, canManageOwnPlugins: true, canUseAllPlugins: true,
    canEditPluginCode: true, canManageGroups: true, canTestPlugin: true,
  },
  member: {
    canAddBot: false, maxBots: 0, canEditBot: false, canDeleteBot: false,
    canUploadPlugin: true, canManageOwnPlugins: false, canUseAllPlugins: false,
    canEditPluginCode: false, canManageGroups: false, canTestPlugin: false,
  },
  user: {
    canAddBot: false, maxBots: 0, canEditBot: false, canDeleteBot: false,
    canUploadPlugin: false, canManageOwnPlugins: false, canUseAllPlugins: false,
    canEditPluginCode: false, canManageGroups: false, canTestPlugin: false,
  },
};

// 解析用户可建机器人上限：超级主人固定为角色上限（避免历史遗留的 999 生效），
// 其他角色优先取用户自定义权限，其次角色默认值
export function resolveMaxBots(role: string, permissions?: UserPermission | null): number {
  if (role === 'super_master') return ROLE_PERMISSIONS.super_master ? ROLE_PERMISSIONS.super_master.maxBots : 5;
  const def = ROLE_PERMISSIONS[role] ? ROLE_PERMISSIONS[role].maxBots : 0;
  if (permissions && typeof permissions.maxBots === 'number') return permissions.maxBots;
  return def;
}

export interface BotEntry {
  id: string;
  name: string;
  appId: string;
  clientSecret: string;
  intents: number;
  sandbox: boolean;
  owner: string;
  status: 'stopped' | 'running' | 'error';
  secretVisible?: boolean;
  licenseStopped?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface JwtPayload {
  username: string;
  role: 'super_master' | 'master' | 'member' | 'user';
  iat: number;
  exp: number;
}

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author: string;
  main: string;
  homepage?: string;
  match?: string[];
}

export interface LogEntry {
  time: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
}
