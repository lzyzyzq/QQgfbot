import { state } from './core/state';
import type { PluginContext } from './types';

export const PLUGIN_VERSION = "3.1.0";

export const DEFAULT_CONFIG: Record<string, any> = {
  enabled: true,
  commandPrefix: "",
  ownerIds: [],
  globalEnabled: true,
  // 群开关（按群配置）
  groupEnabledList: "",
  groupDisabledList: "",
  // 授权
  authServerUrl: "https://armbian.tailaa2e36.ts.net",
  authApiPath: "/api/auth/code",
  authVerifyPath: "/api/auth/code/verify",
  authMethod: "json",
  authTimeout: 8000,
  authCodeField: "code",
  authTokenField: "token",
  // 频道
  channelId: "7989734378509876559",
  // 菜单
  menuImageUrl: "",
  menuImagePath: "",
  enableButtonMenu: true,
  // 定时/通知
  hourlyChime: false,
  welcomeMsg: "",
  byeMsg: "",
  dailyPushTime: "08:00",
  // 外部服务
  weatherApiUrl: "https://wttr.in",
  weatherApiKey: "",
  songPlatforms: ["netease", "tencent", "kugou"],
  recallPermission: "owner",
  version: PLUGIN_VERSION,
};

export function splitList(value: any): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (value == null) return [];
  return String(value)
    .split(/[\s,，;；]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 判断某个群是否启用机器人（全局开关 + 按群开启/关闭列表） */
export function groupEnabled(groupId: string | number | undefined): boolean {
  if (!state.config.globalEnabled) return false;
  const id = String(groupId ?? "");
  const enabled = splitList(state.config.groupEnabledList);
  const disabled = splitList(state.config.groupDisabledList);
  if (!id) return enabled.length === 0;
  if (disabled.includes(id)) return false;
  if (enabled.length > 0 && !enabled.includes(id)) return false;
  return true;
}

/** 将某个群标记为开启：移出关闭列表；若配置了白名单则加入白名单 */
export function enableGroup(groupId: string | number): void {
  const id = String(groupId ?? "");
  if (!id) return;
  const enabled = splitList(state.config.groupEnabledList);
  const disabled = splitList(state.config.groupDisabledList);
  state.config.groupDisabledList = disabled.filter((g) => g !== id).join(",");
  if (enabled.length > 0 && !enabled.includes(id)) {
    state.config.groupEnabledList = [...enabled, id].join(",");
  }
  state.saveConfig();
}

/** 将某个群标记为关闭：移出白名单并加入关闭列表 */
export function disableGroup(groupId: string | number): void {
  const id = String(groupId ?? "");
  if (!id) return;
  const enabled = splitList(state.config.groupEnabledList);
  const disabled = splitList(state.config.groupDisabledList);
  state.config.groupEnabledList = enabled.filter((g) => g !== id).join(",");
  if (!disabled.includes(id)) disabled.push(id);
  state.config.groupDisabledList = disabled.join(",");
  state.saveConfig();
}

export function buildConfigUI(ctx: PluginContext): any[] {
  const C = ctx.NapCatConfig;
  if (!C) return [];
  return C.combine(
    C.html(`<div style="padding:16px 20px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;margin-bottom:16px;color:#0c4a6e;font-family:system-ui,-apple-system,sans-serif">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <span style="font-size:16px;font-weight:600;color:#0369a1">智能机器人插件</span>
        <span style="font-size:12px;color:#0e7490;background:#e0f2fe;border-radius:999px;padding:2px 10px">v${PLUGIN_VERSION}</span>
        <span style="font-size:12px;color:#6b7280">by 空空爱追剧</span>
      </div>
      <p style="margin:0;font-size:13px;line-height:1.6;color:#075985">多功能群机器人：群开关（按群配置）、主人/授权管理、统一菜单、娱乐中心、签到、群管理、定时推送、关键词回复、点歌、天气、频道管理等。</p>
    </div>`),
    C.boolean("enabled", "启用插件", true, "关闭后插件不响应任何命令"),
    C.text("commandPrefix", "命令前缀", "", "留空则直接匹配关键词；例如 / 或 #"),
    C.html(`<div style="padding:10px 14px;background:#fefce8;border-left:3px solid #eab308;border-radius:4px;margin:8px 0;font-family:system-ui,-apple-system,sans-serif"><p style="margin:0;font-size:12px;color:#713f12">主人和授权配置：主人可在群里发送「设置主人 <QQ号>」设置；授权码通过下方授权服务器获取。</p></div>`),
    C.text("ownerIds", "初始主人 QQ（逗号分隔）", "", "作为初始主人，可在群里再添加"),
    C.boolean("globalEnabled", "全局模式", true, "关闭后所有群停止响应"),
    C.html(`<div style="padding:10px 14px;background:#ecfdf5;border-left:3px solid #10b981;border-radius:4px;margin:8px 0;font-family:system-ui,-apple-system,sans-serif"><p style="margin:0;font-size:12px;color:#064e3b">群开关（按群配置）：「开启的群列表」留空表示所有群开启，填写后仅列表内的群开启；「关闭的群列表」填写的群强制关闭。两项可同时使用。</p></div>`),
    C.text("groupEnabledList", "开启的群列表（逗号分隔）", "", "留空 = 所有群开启；填写 = 仅这些群开启（白名单）"),
    C.text("groupDisabledList", "关闭的群列表（逗号分隔）", "", "这些群强制关闭（黑名单，优先级最高）"),
    C.html(`<div style="padding:10px 14px;background:#f0fdf4;border-left:3px solid #22c55e;border-radius:4px;margin:8px 0;font-family:system-ui,-apple-system,sans-serif"><p style="margin:0;font-size:12px;color:#14532d">授权码来源：从授权服务器获取激活码，支持 JSON API 或网页解析两种方式。</p></div>`),
    C.text("authServerUrl", "授权服务器地址", "https://armbian.tailaa2e36.ts.net", "获取授权码的服务器地址"),
    C.text("authApiPath", "授权 API 路径", "/api/auth/code", "JSON 模式下请求的接口路径"),
    C.text("authVerifyPath", "授权验证 API 路径", "/api/auth/code/verify", "激活授权码时验证/使用的接口路径"),
    C.select("authMethod", "获取方式", [
      { label: "JSON API", value: "json" },
      { label: "网页解析", value: "html" },
    ], "json"),
    C.text("authCodeField", "授权码字段名", "code", "JSON 响应中授权码所在字段"),
    C.number("authTimeout", "请求超时(ms)", 8000, "授权请求超时时间"),
    C.html(`<div style="padding:10px 14px;background:#f5f3ff;border-left:3px solid #8b5cf6;border-radius:4px;margin:8px 0;font-family:system-ui,-apple-system,sans-serif"><p style="margin:0;font-size:12px;color:#4c1d95">菜单形式：文字菜单始终可用；按钮菜单需要新版 QQ 支持；图片菜单需配置图片 URL 或本地路径。</p></div>`),
    C.boolean("enableButtonMenu", "启用按钮菜单", true, "发送「按钮菜单」时附带按键"),
    C.text("menuImageUrl", "图片菜单 URL", "", "图片菜单的远程图片地址"),
    C.text("menuImagePath", "图片菜单本地路径", "", "图片菜单的本地文件路径，如 /var/www/NapCat/menu.png"),
    C.html(`<div style="padding:10px 14px;background:#fce7f3;border-left:3px solid #ec4899;border-radius:4px;margin:8px 0;font-family:system-ui,-apple-system,sans-serif"><p style="margin:0;font-size:12px;color:#831843">频道管理：发送「频道列表」查看频道；发送「频道测试」向下方频道发送测试消息。</p></div>`),
    C.text("channelId", "默认测试频道 ID", "7989734378509876559", "「频道测试」命令发送的目标频道"),
    C.boolean("hourlyChime", "整点报时", false, "开启后每小时整点在已开启的群内播报"),
    C.text("welcomeMsg", "入群欢迎语", "", "留空则不发送；{nickname} 会被替换为新人"),
    C.text("byeMsg", "退群提示语", "", "留空则不发送"),
    C.text("dailyPushTime", "每日备注推送时间", "08:00", "每日备注提醒发送时间"),
    C.html(`<div style="padding:10px 14px;background:#fff7ed;border-left:3px solid #f97316;border-radius:4px;margin:8px 0;font-family:system-ui,-apple-system,sans-serif"><p style="margin:0;font-size:12px;color:#7c2d12">外部服务：天气和点歌依赖外部 API，网络不通时相关功能会提示失败。</p></div>`),
    C.text("weatherApiUrl", "天气 API 地址", "https://wttr.in", "支持 wttr.in 格式的天气服务"),
    C.text("weatherApiKey", "天气 API Key", "", "可选，部分天气服务需要"),
    C.multiSelect("songPlatforms", "点歌平台", [
      { label: "网易云", value: "netease" },
      { label: "QQ音乐", value: "tencent" },
      { label: "酷狗", value: "kugou" },
      { label: "咪咕", value: "migu" },
    ], ["netease", "tencent", "kugou"]),
  );
}
