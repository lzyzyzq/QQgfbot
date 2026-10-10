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
  // 认证开发者：仅超主可授予；持有者可在市场内新建插件并发布
  isDeveloper?: boolean;
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
  // 扩展权限点（v1.0.29）：对应各管理功能的操作门槛，超主恒有全部权限
  canManageAuthCodes: boolean;      // 授权码管理（生成/编辑/删除/绑定）
  canManageMarket: boolean;         // 插件词库市场管理（上架/审核/删除）
  canManageOpenids: boolean;        // OpenID 列表管理（同步/改名/解绑）
  canManageFeedbacks: boolean;      // 反馈管理（回复/删除）
  canManageMemberSync: boolean;     // 成员同步操作（拉取/写入群成员）
  canManageSystemLogs: boolean;     // 系统日志清理
  canManageBlocklist: boolean;      // 拦截名单管理
  canManageUpdateLog: boolean;      // 更新日志编辑
  canManageSwitches: boolean;       // 功能开关管理
  canManageScheduleTasks: boolean;  // 定时任务管理
  canManageCustomPages: boolean;    // 自定义页面管理（新增侧边栏页面/网页功能）
}

// 扩展权限点默认值：超主/主人全开，会员/普通用户全关
const EXT_PERM_KEYS: Array<keyof UserPermission> = [
  'canManageGroups', 'canManageAuthCodes', 'canManageMarket', 'canManageOpenids',
  'canManageFeedbacks', 'canManageMemberSync', 'canManageSystemLogs', 'canManageBlocklist',
  'canManageUpdateLog', 'canManageSwitches', 'canManageScheduleTasks', 'canManageCustomPages',
];
function extPerms(on: boolean): Record<string, boolean> {
  const o: Record<string, boolean> = {};
  for (const k of EXT_PERM_KEYS) o[k] = on;
  return o;
}

export const ROLE_PERMISSIONS: Record<string, UserPermission> = {
  super_master: {
    canAddBot: true, maxBots: 5, canEditBot: true, canDeleteBot: true,
    canUploadPlugin: true, canManageOwnPlugins: true, canUseAllPlugins: true,
    canEditPluginCode: true, canManageGroups: true, canTestPlugin: true,
    ...extPerms(true),
  } as UserPermission,
  master: {
    canAddBot: true, maxBots: 1, canEditBot: true, canDeleteBot: true,
    canUploadPlugin: true, canManageOwnPlugins: true, canUseAllPlugins: true,
    canEditPluginCode: true, canManageGroups: true, canTestPlugin: true,
    ...extPerms(true),
  } as UserPermission,
  member: {
    canAddBot: false, maxBots: 0, canEditBot: false, canDeleteBot: false,
    canUploadPlugin: true, canManageOwnPlugins: false, canUseAllPlugins: false,
    canEditPluginCode: false, canManageGroups: false, canTestPlugin: false,
    ...extPerms(false),
  } as UserPermission,
  user: {
    canAddBot: false, maxBots: 0, canEditBot: false, canDeleteBot: false,
    canUploadPlugin: false, canManageOwnPlugins: false, canUseAllPlugins: false,
    canEditPluginCode: false, canManageGroups: false, canTestPlugin: false,
    ...extPerms(false),
  } as UserPermission,
};

// 自定义页面（v1.0.29）：超级主人可在网页端新增侧边栏页面与功能（HTML 内容或外链）
export interface CustomPage {
  id: string;
  name: string;
  type: 'html' | 'link';
  content: string;   // html=HTML 片段；link=完整 URL
  enabled: boolean;
  order: number;
  roles?: string[];
  createdAt: number;
}

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
