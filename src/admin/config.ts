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
  passwordChangedAt?: string;
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
    canAddBot: true, maxBots: 999, canEditBot: true, canDeleteBot: true,
    canUploadPlugin: true, canManageOwnPlugins: true, canUseAllPlugins: true,
    canEditPluginCode: true, canManageGroups: true, canTestPlugin: true,
  },
  master: {
    canAddBot: true, maxBots: 5, canEditBot: true, canDeleteBot: true,
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
