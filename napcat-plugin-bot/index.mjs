// src/core/state.ts
import fs from "fs";
import path from "path";

// src/config.ts
var PLUGIN_VERSION = "3.1.0";
var DEFAULT_CONFIG = {
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
  authTimeout: 8e3,
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
  version: PLUGIN_VERSION
};
function splitList(value) {
  if (Array.isArray(value)) return value.map(String);
  if (value == null) return [];
  return String(value).split(/[\s,，;；]+/).map((s) => s.trim()).filter(Boolean);
}
function groupEnabled(groupId) {
  if (!state.config.globalEnabled) return false;
  const id = String(groupId ?? "");
  const enabled = splitList(state.config.groupEnabledList);
  const disabled = splitList(state.config.groupDisabledList);
  if (!id) return enabled.length === 0;
  if (disabled.includes(id)) return false;
  if (enabled.length > 0 && !enabled.includes(id)) return false;
  return true;
}
function enableGroup(groupId) {
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
function disableGroup(groupId) {
  const id = String(groupId ?? "");
  if (!id) return;
  const enabled = splitList(state.config.groupEnabledList);
  const disabled = splitList(state.config.groupDisabledList);
  state.config.groupEnabledList = enabled.filter((g) => g !== id).join(",");
  if (!disabled.includes(id)) disabled.push(id);
  state.config.groupDisabledList = disabled.join(",");
  state.saveConfig();
}
function buildConfigUI(ctx) {
  const C = ctx.NapCatConfig;
  if (!C) return [];
  return C.combine(
    C.html(`<div style="padding:16px 20px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;margin-bottom:16px;color:#0c4a6e;font-family:system-ui,-apple-system,sans-serif">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <span style="font-size:16px;font-weight:600;color:#0369a1">\u667A\u80FD\u673A\u5668\u4EBA\u63D2\u4EF6</span>
        <span style="font-size:12px;color:#0e7490;background:#e0f2fe;border-radius:999px;padding:2px 10px">v${PLUGIN_VERSION}</span>
        <span style="font-size:12px;color:#6b7280">by \u7A7A\u7A7A\u7231\u8FFD\u5267</span>
      </div>
      <p style="margin:0;font-size:13px;line-height:1.6;color:#075985">\u591A\u529F\u80FD\u7FA4\u673A\u5668\u4EBA\uFF1A\u7FA4\u5F00\u5173\uFF08\u6309\u7FA4\u914D\u7F6E\uFF09\u3001\u4E3B\u4EBA/\u6388\u6743\u7BA1\u7406\u3001\u7EDF\u4E00\u83DC\u5355\u3001\u5A31\u4E50\u4E2D\u5FC3\u3001\u7B7E\u5230\u3001\u7FA4\u7BA1\u7406\u3001\u5B9A\u65F6\u63A8\u9001\u3001\u5173\u952E\u8BCD\u56DE\u590D\u3001\u70B9\u6B4C\u3001\u5929\u6C14\u3001\u9891\u9053\u7BA1\u7406\u7B49\u3002</p>
    </div>`),
    C.boolean("enabled", "\u542F\u7528\u63D2\u4EF6", true, "\u5173\u95ED\u540E\u63D2\u4EF6\u4E0D\u54CD\u5E94\u4EFB\u4F55\u547D\u4EE4"),
    C.text("commandPrefix", "\u547D\u4EE4\u524D\u7F00", "", "\u7559\u7A7A\u5219\u76F4\u63A5\u5339\u914D\u5173\u952E\u8BCD\uFF1B\u4F8B\u5982 / \u6216 #"),
    C.html(`<div style="padding:10px 14px;background:#fefce8;border-left:3px solid #eab308;border-radius:4px;margin:8px 0;font-family:system-ui,-apple-system,sans-serif"><p style="margin:0;font-size:12px;color:#713f12">\u4E3B\u4EBA\u548C\u6388\u6743\u914D\u7F6E\uFF1A\u4E3B\u4EBA\u53EF\u5728\u7FA4\u91CC\u53D1\u9001\u300C\u8BBE\u7F6E\u4E3B\u4EBA <QQ\u53F7>\u300D\u8BBE\u7F6E\uFF1B\u6388\u6743\u7801\u901A\u8FC7\u4E0B\u65B9\u6388\u6743\u670D\u52A1\u5668\u83B7\u53D6\u3002</p></div>`),
    C.text("ownerIds", "\u521D\u59CB\u4E3B\u4EBA QQ\uFF08\u9017\u53F7\u5206\u9694\uFF09", "", "\u4F5C\u4E3A\u521D\u59CB\u4E3B\u4EBA\uFF0C\u53EF\u5728\u7FA4\u91CC\u518D\u6DFB\u52A0"),
    C.boolean("globalEnabled", "\u5168\u5C40\u6A21\u5F0F", true, "\u5173\u95ED\u540E\u6240\u6709\u7FA4\u505C\u6B62\u54CD\u5E94"),
    C.html(`<div style="padding:10px 14px;background:#ecfdf5;border-left:3px solid #10b981;border-radius:4px;margin:8px 0;font-family:system-ui,-apple-system,sans-serif"><p style="margin:0;font-size:12px;color:#064e3b">\u7FA4\u5F00\u5173\uFF08\u6309\u7FA4\u914D\u7F6E\uFF09\uFF1A\u300C\u5F00\u542F\u7684\u7FA4\u5217\u8868\u300D\u7559\u7A7A\u8868\u793A\u6240\u6709\u7FA4\u5F00\u542F\uFF0C\u586B\u5199\u540E\u4EC5\u5217\u8868\u5185\u7684\u7FA4\u5F00\u542F\uFF1B\u300C\u5173\u95ED\u7684\u7FA4\u5217\u8868\u300D\u586B\u5199\u7684\u7FA4\u5F3A\u5236\u5173\u95ED\u3002\u4E24\u9879\u53EF\u540C\u65F6\u4F7F\u7528\u3002</p></div>`),
    C.text("groupEnabledList", "\u5F00\u542F\u7684\u7FA4\u5217\u8868\uFF08\u9017\u53F7\u5206\u9694\uFF09", "", "\u7559\u7A7A = \u6240\u6709\u7FA4\u5F00\u542F\uFF1B\u586B\u5199 = \u4EC5\u8FD9\u4E9B\u7FA4\u5F00\u542F\uFF08\u767D\u540D\u5355\uFF09"),
    C.text("groupDisabledList", "\u5173\u95ED\u7684\u7FA4\u5217\u8868\uFF08\u9017\u53F7\u5206\u9694\uFF09", "", "\u8FD9\u4E9B\u7FA4\u5F3A\u5236\u5173\u95ED\uFF08\u9ED1\u540D\u5355\uFF0C\u4F18\u5148\u7EA7\u6700\u9AD8\uFF09"),
    C.html(`<div style="padding:10px 14px;background:#f0fdf4;border-left:3px solid #22c55e;border-radius:4px;margin:8px 0;font-family:system-ui,-apple-system,sans-serif"><p style="margin:0;font-size:12px;color:#14532d">\u6388\u6743\u7801\u6765\u6E90\uFF1A\u4ECE\u6388\u6743\u670D\u52A1\u5668\u83B7\u53D6\u6FC0\u6D3B\u7801\uFF0C\u652F\u6301 JSON API \u6216\u7F51\u9875\u89E3\u6790\u4E24\u79CD\u65B9\u5F0F\u3002</p></div>`),
    C.text("authServerUrl", "\u6388\u6743\u670D\u52A1\u5668\u5730\u5740", "https://armbian.tailaa2e36.ts.net", "\u83B7\u53D6\u6388\u6743\u7801\u7684\u670D\u52A1\u5668\u5730\u5740"),
    C.text("authApiPath", "\u6388\u6743 API \u8DEF\u5F84", "/api/auth/code", "JSON \u6A21\u5F0F\u4E0B\u8BF7\u6C42\u7684\u63A5\u53E3\u8DEF\u5F84"),
    C.text("authVerifyPath", "\u6388\u6743\u9A8C\u8BC1 API \u8DEF\u5F84", "/api/auth/code/verify", "\u6FC0\u6D3B\u6388\u6743\u7801\u65F6\u9A8C\u8BC1/\u4F7F\u7528\u7684\u63A5\u53E3\u8DEF\u5F84"),
    C.select("authMethod", "\u83B7\u53D6\u65B9\u5F0F", [
      { label: "JSON API", value: "json" },
      { label: "\u7F51\u9875\u89E3\u6790", value: "html" }
    ], "json"),
    C.text("authCodeField", "\u6388\u6743\u7801\u5B57\u6BB5\u540D", "code", "JSON \u54CD\u5E94\u4E2D\u6388\u6743\u7801\u6240\u5728\u5B57\u6BB5"),
    C.number("authTimeout", "\u8BF7\u6C42\u8D85\u65F6(ms)", 8e3, "\u6388\u6743\u8BF7\u6C42\u8D85\u65F6\u65F6\u95F4"),
    C.html(`<div style="padding:10px 14px;background:#f5f3ff;border-left:3px solid #8b5cf6;border-radius:4px;margin:8px 0;font-family:system-ui,-apple-system,sans-serif"><p style="margin:0;font-size:12px;color:#4c1d95">\u83DC\u5355\u5F62\u5F0F\uFF1A\u6587\u5B57\u83DC\u5355\u59CB\u7EC8\u53EF\u7528\uFF1B\u6309\u94AE\u83DC\u5355\u9700\u8981\u65B0\u7248 QQ \u652F\u6301\uFF1B\u56FE\u7247\u83DC\u5355\u9700\u914D\u7F6E\u56FE\u7247 URL \u6216\u672C\u5730\u8DEF\u5F84\u3002</p></div>`),
    C.boolean("enableButtonMenu", "\u542F\u7528\u6309\u94AE\u83DC\u5355", true, "\u53D1\u9001\u300C\u6309\u94AE\u83DC\u5355\u300D\u65F6\u9644\u5E26\u6309\u952E"),
    C.text("menuImageUrl", "\u56FE\u7247\u83DC\u5355 URL", "", "\u56FE\u7247\u83DC\u5355\u7684\u8FDC\u7A0B\u56FE\u7247\u5730\u5740"),
    C.text("menuImagePath", "\u56FE\u7247\u83DC\u5355\u672C\u5730\u8DEF\u5F84", "", "\u56FE\u7247\u83DC\u5355\u7684\u672C\u5730\u6587\u4EF6\u8DEF\u5F84\uFF0C\u5982 /var/www/NapCat/menu.png"),
    C.html(`<div style="padding:10px 14px;background:#fce7f3;border-left:3px solid #ec4899;border-radius:4px;margin:8px 0;font-family:system-ui,-apple-system,sans-serif"><p style="margin:0;font-size:12px;color:#831843">\u9891\u9053\u7BA1\u7406\uFF1A\u53D1\u9001\u300C\u9891\u9053\u5217\u8868\u300D\u67E5\u770B\u9891\u9053\uFF1B\u53D1\u9001\u300C\u9891\u9053\u6D4B\u8BD5\u300D\u5411\u4E0B\u65B9\u9891\u9053\u53D1\u9001\u6D4B\u8BD5\u6D88\u606F\u3002</p></div>`),
    C.text("channelId", "\u9ED8\u8BA4\u6D4B\u8BD5\u9891\u9053 ID", "7989734378509876559", "\u300C\u9891\u9053\u6D4B\u8BD5\u300D\u547D\u4EE4\u53D1\u9001\u7684\u76EE\u6807\u9891\u9053"),
    C.boolean("hourlyChime", "\u6574\u70B9\u62A5\u65F6", false, "\u5F00\u542F\u540E\u6BCF\u5C0F\u65F6\u6574\u70B9\u5728\u5DF2\u5F00\u542F\u7684\u7FA4\u5185\u64AD\u62A5"),
    C.text("welcomeMsg", "\u5165\u7FA4\u6B22\u8FCE\u8BED", "", "\u7559\u7A7A\u5219\u4E0D\u53D1\u9001\uFF1B{nickname} \u4F1A\u88AB\u66FF\u6362\u4E3A\u65B0\u4EBA"),
    C.text("byeMsg", "\u9000\u7FA4\u63D0\u793A\u8BED", "", "\u7559\u7A7A\u5219\u4E0D\u53D1\u9001"),
    C.text("dailyPushTime", "\u6BCF\u65E5\u5907\u6CE8\u63A8\u9001\u65F6\u95F4", "08:00", "\u6BCF\u65E5\u5907\u6CE8\u63D0\u9192\u53D1\u9001\u65F6\u95F4"),
    C.html(`<div style="padding:10px 14px;background:#fff7ed;border-left:3px solid #f97316;border-radius:4px;margin:8px 0;font-family:system-ui,-apple-system,sans-serif"><p style="margin:0;font-size:12px;color:#7c2d12">\u5916\u90E8\u670D\u52A1\uFF1A\u5929\u6C14\u548C\u70B9\u6B4C\u4F9D\u8D56\u5916\u90E8 API\uFF0C\u7F51\u7EDC\u4E0D\u901A\u65F6\u76F8\u5173\u529F\u80FD\u4F1A\u63D0\u793A\u5931\u8D25\u3002</p></div>`),
    C.text("weatherApiUrl", "\u5929\u6C14 API \u5730\u5740", "https://wttr.in", "\u652F\u6301 wttr.in \u683C\u5F0F\u7684\u5929\u6C14\u670D\u52A1"),
    C.text("weatherApiKey", "\u5929\u6C14 API Key", "", "\u53EF\u9009\uFF0C\u90E8\u5206\u5929\u6C14\u670D\u52A1\u9700\u8981"),
    C.multiSelect("songPlatforms", "\u70B9\u6B4C\u5E73\u53F0", [
      { label: "\u7F51\u6613\u4E91", value: "netease" },
      { label: "QQ\u97F3\u4E50", value: "tencent" },
      { label: "\u9177\u72D7", value: "kugou" },
      { label: "\u54AA\u5495", value: "migu" }
    ], ["netease", "tencent", "kugou"])
  );
}

// src/core/state.ts
function defaultData() {
  return {
    owners: [],
    groupSwitches: {},
    activatedCodes: {},
    signin: {},
    keywordReplies: {},
    schedules: [],
    birthdays: {},
    woodFish: {},
    farm: {},
    mines: {},
    fishing: {},
    dailyNotes: {},
    checkins: {},
    manualSchedules: {}
  };
}
var PluginState = class {
  _ctx = null;
  _config = { ...DEFAULT_CONFIG };
  _data = defaultData();
  _timers = [];
  _dataPath = "";
  get ctx() {
    return this._ctx;
  }
  get config() {
    return this._config;
  }
  get data() {
    return this._data;
  }
  pushTimer(timer) {
    this._timers.push(timer);
  }
  init(ctx) {
    this._ctx = ctx;
    this.loadConfig(ctx.configPath);
    this.loadData(ctx.dataPath);
    this.migrateGroupSwitches();
  }
  cleanup() {
    this._timers.forEach((t) => clearInterval(t));
    this._timers = [];
    this.saveData();
    this._ctx = null;
  }
  replaceConfig(config) {
    this._config = { ...DEFAULT_CONFIG, ...config };
    this.saveConfig();
  }
  loadConfig(configPath) {
    try {
      if (fs.existsSync(configPath)) {
        const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        this._config = { ...DEFAULT_CONFIG, ...raw };
      } else {
        this.saveConfig();
      }
    } catch {
      this._ctx?.logger?.warn("\u914D\u7F6E\u52A0\u8F7D\u5931\u8D25\uFF0C\u4F7F\u7528\u9ED8\u8BA4\u503C");
    }
  }
  saveConfig() {
    if (!this._ctx) return;
    try {
      const dir = this._ctx.configPath.replace(/[/\\][^/\\]+$/, "");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this._ctx.configPath, JSON.stringify(this._config, null, 2));
    } catch {
      this._ctx.logger?.warn("\u914D\u7F6E\u4FDD\u5B58\u5931\u8D25");
    }
  }
  loadData(dataPath) {
    this._dataPath = dataPath;
    const file = path.join(dataPath, "data.json");
    try {
      if (fs.existsSync(file)) {
        const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
        this._data = { ...defaultData(), ...raw };
      } else {
        this._data = defaultData();
        this.saveData();
      }
    } catch {
      this._data = defaultData();
    }
  }
  saveData() {
    if (!this._dataPath) return;
    try {
      if (!fs.existsSync(this._dataPath)) fs.mkdirSync(this._dataPath, { recursive: true });
      fs.writeFileSync(path.join(this._dataPath, "data.json"), JSON.stringify(this._data, null, 2));
    } catch {
      this._ctx?.logger?.warn("\u6570\u636E\u4FDD\u5B58\u5931\u8D25");
    }
  }
  /** 兼容 v3.0.0 及更早版本：将 data.groupSwitches 中的显式开关迁移到配置列表 */
  migrateGroupSwitches() {
    const sw = this._data.groupSwitches || {};
    const entries = Object.entries(sw).filter(([, v]) => typeof v === "boolean");
    if (!entries.length) return;
    const disabled = (this._config.groupDisabledList || "").split(/[\s,，;；]+/).filter(Boolean);
    const enabled = (this._config.groupEnabledList || "").split(/[\s,，;；]+/).filter(Boolean);
    for (const [gid, on] of entries) {
      if (on === false) {
        if (!disabled.includes(gid)) disabled.push(gid);
      } else if (on === true) {
        if (!enabled.includes(gid)) enabled.push(gid);
      }
    }
    this._config.groupDisabledList = disabled.join(",");
    this._config.groupEnabledList = enabled.join(",");
    this._data.groupSwitches = {};
    this.saveConfig();
    this.saveData();
  }
};
var state = new PluginState();

// src/core/actions.ts
async function sendMsg(ctx, event, message) {
  const params = {
    message,
    message_type: event.message_type
  };
  if (event.message_type === "group" && event.group_id) {
    params.group_id = String(event.group_id);
  }
  if (event.message_type === "private" && event.user_id) {
    params.user_id = String(event.user_id);
  }
  try {
    await ctx.actions.call("send_msg", params, ctx.adapterName, ctx.pluginManager.config);
  } catch (e) {
    ctx.logger?.error("send_msg \u5931\u8D25:", e.message);
  }
}
async function callApi(ctx, action, params = {}) {
  try {
    return await ctx.actions.call(action, params || {}, ctx.adapterName, ctx.pluginManager.config);
  } catch (e) {
    ctx.logger?.error(`API ${action} \u5931\u8D25:`, e.message);
    return null;
  }
}

// src/core/utils.ts
import http from "http";
import https from "https";
function stripCQ(text) {
  return String(text).replace(/\[CQ:[^\]]*\]/g, "").trim();
}
function todayStr() {
  const d = /* @__PURE__ */ new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
function nowTime() {
  const d = /* @__PURE__ */ new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function seededRandom(seedStr) {
  let h = 0;
  for (let i = 0; i < seedStr.length; i++) {
    h = (h << 5) - h + seedStr.charCodeAt(i) | 0;
  }
  return () => {
    h = h * 1664525 + 1013904223 & 4294967295;
    return (h >>> 0) % 1e3 / 1e3;
  };
}
function pickRandomFromList(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function pickWeighted(list, rand) {
  const total = list.reduce((s, it) => s + it.weight, 0);
  let r = rand() * total;
  for (const it of list) {
    r -= it.weight;
    if (r <= 0) return it;
  }
  return list[list.length - 1];
}
function httpGet(url, timeout = 8e3) {
  return httpRequest(url, { method: "GET", timeout });
}
function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const method = (options.method || "GET").toUpperCase();
    let payload = null;
    const headers = {};
    if (options.body !== void 0 && options.body !== null) {
      payload = Buffer.from(typeof options.body === "string" ? options.body : JSON.stringify(options.body));
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = String(payload.byteLength);
    }
    const req = mod.request(url, { method, timeout: options.timeout || 8e3, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on(
        "end",
        () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf-8") })
      );
    });
    req.on("timeout", () => {
      req.destroy(new Error("\u8BF7\u6C42\u8D85\u65F6"));
    });
    req.on("error", (e) => reject(e));
    if (payload) req.write(payload);
    req.end();
  });
}

// src/features/group.ts
function isOwner(qq) {
  const id = String(qq ?? "");
  return state.config.ownerIds.includes(id) || state.data.owners.includes(id);
}
function isGroupAdmin(event) {
  return event.sender?.role === "owner" || event.sender?.role === "admin";
}
function checkOwner(event) {
  return isOwner(event.user_id) || event.message_type === "group" && isGroupAdmin(event);
}
function checkManagePermission(event) {
  const p = state.config.recallPermission || "owner";
  if (p === "admin") return checkOwner(event);
  return isOwner(event.user_id);
}
function extractTarget(event, args) {
  const raw = event.raw_message || "";
  const at = raw.match(/\[CQ:at,qq=(\d+)\]/);
  if (at) {
    const nums2 = args.match(/\d+/g);
    const duration = nums2 && nums2.length > 1 ? nums2[nums2.length - 1] : null;
    return { qq: at[1], duration };
  }
  const nums = args.match(/\d+/g);
  if (nums && nums.length) return { qq: nums[0], duration: nums.length > 1 ? nums[1] : null };
  return null;
}
async function groupInfo(ctx, event) {
  const res = await callApi(ctx, "get_group_info", { group_id: String(event.group_id) });
  if (!res) {
    await sendMsg(ctx, event, "\u83B7\u53D6\u7FA4\u4FE1\u606F\u5931\u8D25\u3002");
    return;
  }
  const info = res;
  await sendMsg(
    ctx,
    event,
    `\u3010\u7FA4\u4FE1\u606F\u3011
\u7FA4\u540D\uFF1A${info.group_name}
\u7FA4\u53F7\uFF1A${event.group_id}
\u6210\u5458\u6570\uFF1A${info.member_count ?? "\u672A\u77E5"}
${info.memo ? `\u7FA4\u516C\u544A\uFF1A${info.memo}` : ""}`
  );
}
async function groupStats(ctx, event) {
  const res = await callApi(ctx, "get_group_member_list", { group_id: String(event.group_id) });
  if (!Array.isArray(res)) {
    await sendMsg(ctx, event, "\u83B7\u53D6\u6210\u5458\u5217\u8868\u5931\u8D25\u3002");
    return;
  }
  const list = res;
  const total = list.length;
  const owners = list.filter((m) => m.role === "owner").length;
  const admins = list.filter((m) => m.role === "admin").length;
  const male = list.filter((m) => m.sex === "male").length;
  const female = list.filter((m) => m.sex === "female").length;
  await sendMsg(
    ctx,
    event,
    `\u3010\u7FA4\u7EDF\u8BA1\u3011
\u603B\u6210\u5458\uFF1A${total}
\u7FA4\u4E3B\uFF1A${owners}
\u7BA1\u7406\u5458\uFF1A${admins}
\u7537\uFF1A${male} / \u5973\uFF1A${female}`
  );
}
async function groupMuteAll(ctx, event, action) {
  const res = await callApi(ctx, "set_group_whole_ban", { group_id: String(event.group_id), enable: action });
  await sendMsg(ctx, event, res === null ? "\u64CD\u4F5C\u5931\u8D25\uFF08\u53EF\u80FD\u6CA1\u6709\u6743\u9650\uFF09" : action ? "\u2705 \u5DF2\u5F00\u542F\u5168\u5458\u7981\u8A00" : "\u2705 \u5DF2\u89E3\u9664\u5168\u5458\u7981\u8A00");
}
async function groupMute(ctx, event, target, duration) {
  const res = await callApi(ctx, "set_group_ban", { group_id: String(event.group_id), user_id: target, duration });
  await sendMsg(ctx, event, res === null ? "\u7981\u8A00\u5931\u8D25\uFF08\u53EF\u80FD\u6CA1\u6709\u6743\u9650\uFF09" : `\u2705 \u5DF2\u7981\u8A00 ${target} ${duration / 60} \u5206\u949F`);
}
async function groupKick(ctx, event, target) {
  const res = await callApi(ctx, "set_group_kick", { group_id: String(event.group_id), user_id: target });
  await sendMsg(ctx, event, res === null ? "\u8E22\u4EBA\u5931\u8D25\uFF08\u53EF\u80FD\u6CA1\u6709\u6743\u9650\uFF09" : `\u2705 \u5DF2\u5C06 ${target} \u79FB\u51FA\u7FA4\u804A`);
}
async function groupPunchCard(ctx, event) {
  const res = await callApi(ctx, "send_group_sign", { group_id: String(event.group_id) });
  await sendMsg(ctx, event, res === null ? "\u7FA4\u6253\u5361\u5931\u8D25\uFF08\u5F53\u524D QQ \u7248\u672C\u53EF\u80FD\u4E0D\u652F\u6301\uFF09" : "\u2705 \u7FA4\u6253\u5361\u6210\u529F\uFF01");
}
async function sendPoke(ctx, event, target) {
  if (!target) {
    await sendMsg(ctx, event, "\u7528\u6CD5\uFF1A\u6233\u4E00\u6233 @\u67D0\u4EBA");
    return;
  }
  const params = {
    user_id: String(event.user_id),
    target_id: target
  };
  if (event.message_type === "group" && event.group_id) {
    params.group_id = String(event.group_id);
  }
  const res = await callApi(ctx, "send_poke", params);
  await sendMsg(ctx, event, res === null ? "\u6233\u4E00\u6233\u5931\u8D25\u3002" : `\u{1F446} \u5DF2\u6233\u4E86\u6233 ${target}`);
}
async function markEssence(ctx, event, msgId) {
  if (!msgId) {
    await sendMsg(ctx, event, "\u7528\u6CD5\uFF1A\u8BBE\u4E3A\u7CBE\u534E <\u6D88\u606FID>");
    return;
  }
  const res = await callApi(ctx, "set_essence_msg", { message_id: msgId });
  await sendMsg(ctx, event, res === null ? "\u8BBE\u7F6E\u7CBE\u534E\u5931\u8D25\uFF08\u9700\u8981\u7FA4\u4E3B/\u7BA1\u7406\u5458\u6743\u9650\uFF09\u3002" : "\u2705 \u5DF2\u8BBE\u4E3A\u7CBE\u534E\u6D88\u606F\u3002");
}
async function sendGroupAnnouncement(ctx, event, content) {
  if (!content) {
    await sendMsg(ctx, event, "\u7528\u6CD5\uFF1A\u7FA4\u516C\u544A <\u5185\u5BB9>");
    return;
  }
  const res = await callApi(ctx, "_send_group_notice", { group_id: String(event.group_id), content });
  await sendMsg(ctx, event, res === null ? "\u53D1\u5E03\u7FA4\u516C\u544A\u5931\u8D25\uFF08\u9700\u8981\u7FA4\u4E3B/\u7BA1\u7406\u5458\u6743\u9650\uFF09\u3002" : "\u2705 \u7FA4\u516C\u544A\u5DF2\u53D1\u5E03\u3002");
}
async function setGroupName(ctx, event, name) {
  if (!name) {
    await sendMsg(ctx, event, "\u7528\u6CD5\uFF1A\u8BBE\u7F6E\u7FA4\u540D <\u540D\u5B57>");
    return;
  }
  const res = await callApi(ctx, "set_group_name", { group_id: String(event.group_id), group_name: name });
  await sendMsg(ctx, event, res === null ? "\u8BBE\u7F6E\u7FA4\u540D\u5931\u8D25\uFF08\u9700\u8981\u7FA4\u4E3B\u6743\u9650\uFF09\u3002" : `\u2705 \u7FA4\u540D\u5DF2\u6539\u4E3A\uFF1A${name}`);
}
async function setGroupAdmin(ctx, event, target) {
  if (!target) {
    await sendMsg(ctx, event, "\u7528\u6CD5\uFF1A\u8BBE\u7BA1\u7406 @\u67D0\u4EBA");
    return;
  }
  const res = await callApi(ctx, "set_group_admin", { group_id: String(event.group_id), user_id: target, enable: true });
  await sendMsg(ctx, event, res === null ? "\u8BBE\u7F6E\u7BA1\u7406\u5458\u5931\u8D25\uFF08\u9700\u8981\u7FA4\u4E3B\u6743\u9650\uFF09\u3002" : `\u2705 \u5DF2\u5C06 ${target} \u8BBE\u4E3A\u7BA1\u7406\u5458\u3002`);
}
async function removeGroupAdmin(ctx, event, target) {
  if (!target) {
    await sendMsg(ctx, event, "\u7528\u6CD5\uFF1A\u53D6\u6D88\u7BA1\u7406 @\u67D0\u4EBA");
    return;
  }
  const res = await callApi(ctx, "set_group_admin", { group_id: String(event.group_id), user_id: target, enable: false });
  await sendMsg(ctx, event, res === null ? "\u53D6\u6D88\u7BA1\u7406\u5458\u5931\u8D25\uFF08\u9700\u8981\u7FA4\u4E3B\u6743\u9650\uFF09\u3002" : `\u2705 \u5DF2\u53D6\u6D88 ${target} \u7684\u7BA1\u7406\u5458\u3002`);
}
async function deleteMsg(ctx, event, msgId) {
  if (!msgId) {
    await sendMsg(ctx, event, "\u7528\u6CD5\uFF1A\u64A4\u56DE <\u6D88\u606FID>");
    return;
  }
  const res = await callApi(ctx, "delete_msg", { message_id: msgId });
  await sendMsg(ctx, event, res === null ? "\u64A4\u56DE\u5931\u8D25\u3002" : "\u2705 \u5DF2\u5C1D\u8BD5\u64A4\u56DE\u3002");
}

// src/features/entertainment.ts
var FOOD_LIST = ["\u706B\u9505", "\u70E4\u8089", "\u9EBB\u8FA3\u70EB", "\u9EC4\u7116\u9E21", "\u5170\u5DDE\u62C9\u9762", "\u6C99\u53BF\u5C0F\u5403", "\u6C49\u5821", "\u62AB\u8428", "\u5BFF\u53F8", "\u70E7\u70E4", "\u87BA\u86F3\u7C89", "\u70B8\u9E21", "\u997A\u5B50", "\u7172\u4ED4\u996D", "\u9178\u83DC\u9C7C", "\u7172\u6C64", "\u80A0\u7C89", "\u94C1\u677F\u70E7", "\u4E32\u4E32\u9999", "\u4E91\u5357\u7C73\u7EBF"];
var FORTUNE_LIST = ["\u5927\u5409", "\u4E2D\u5409", "\u5C0F\u5409", "\u5C0F\u51F6", "\u4E2D\u51F6", "\u5927\u51F6"];
var REALT_LIST = ["\u51E1\u4EBA", "\u7EC3\u6C14", "\u7B51\u57FA", "\u91D1\u4E39", "\u5143\u5A74", "\u5316\u795E", "\u70BC\u865A", "\u5408\u4F53", "\u5927\u4E58", "\u6E21\u52AB", "\u4ED9\u5E1D", "\u4ED9\u5C0A", "\u4ED9\u738B", "\u771F\u4ED9"];
var FISH_LIST = [
  { name: "\u7834\u8349\u978B", weight: 30, score: 1 },
  { name: "\u5C0F\u867E\u7C73", weight: 25, score: 2 },
  { name: "\u9CAB\u9C7C", weight: 18, score: 5 },
  { name: "\u9CA4\u9C7C", weight: 12, score: 8 },
  { name: "\u8349\u9C7C", weight: 8, score: 10 },
  { name: "\u91D1\u9C7C", weight: 4, score: 20 },
  { name: "\u9526\u9CA4", weight: 2, score: 50 },
  { name: "\u795E\u9F99", weight: 1, score: 200 }
];
var CROP_LIST = [
  { name: "\u841D\u535C", cost: 10, yield: 30, time: 30 },
  { name: "\u767D\u83DC", cost: 20, yield: 60, time: 60 },
  { name: "\u5C0F\u9EA6", cost: 40, yield: 120, time: 120 },
  { name: "\u756A\u8304", cost: 80, yield: 240, time: 240 },
  { name: "\u5357\u74DC", cost: 160, yield: 500, time: 480 },
  { name: "\u91D1\u82F9\u679C", cost: 500, yield: 2e3, time: 720 }
];
function dailyFortune(event) {
  const uid = String(event.user_id);
  const rand = seededRandom(uid + todayStr());
  const fortune = FORTUNE_LIST[Math.floor(rand() * FORTUNE_LIST.length)];
  const lucky = 1 + Math.floor(rand() * 9);
  const color = ["\u7EA2\u8272", "\u91D1\u8272", "\u84DD\u8272", "\u7EFF\u8272", "\u7D2B\u8272", "\u767D\u8272"][Math.floor(rand() * 6)];
  return `\u4ECA\u65E5\u8FD0\u52BF\uFF08${todayStr()}\uFF09
\u8FD0\u52BF\uFF1A${fortune}
\u5E78\u8FD0\u6570\u5B57\uFF1A${lucky}
\u5E78\u8FD0\u989C\u8272\uFF1A${color}
\u5B9C\uFF1A${["\u559D\u6C34", "\u6478\u9C7C", "\u6652\u592A\u9633", "\u53D1\u5446", "\u8EBA\u5E73", "\u5403\u996D"][Math.floor(rand() * 6)]}`;
}
function dailyLuck(event) {
  const uid = String(event.user_id);
  const rand = seededRandom(uid + todayStr());
  const pct = Math.floor(rand() * 100);
  const level = pct >= 90 ? "\u6B27\u7687\u9644\u4F53" : pct >= 70 ? "\u8FD0\u6C14\u4E0D\u9519" : pct >= 40 ? "\u5E73\u5E73\u65E0\u5947" : pct >= 15 ? "\u6709\u70B9\u975E" : "\u975E\u914B\u672C\u914B";
  return `\u4ECA\u65E5\u4EBA\u54C1\uFF1A${pct}%
\u8BC4\u4EF7\uFF1A${level}`;
}
function rockPaperScissors(choice) {
  const map = { \u77F3\u5934: 0, \u526A\u5200: 1, \u5E03: 2 };
  const names = ["\u77F3\u5934", "\u526A\u5200", "\u5E03"];
  const c = map[choice];
  if (c === void 0) return "\u7528\u6CD5\uFF1A\u731C\u62F3 \u77F3\u5934/\u526A\u5200/\u5E03";
  const bot = Math.floor(Math.random() * 3);
  let result;
  if (c === bot) result = "\u5E73\u5C40\uFF01";
  else if ((c + 1) % 3 === bot) result = "\u4F60\u8F93\u4E86~";
  else result = "\u4F60\u8D62\u4E86\uFF01";
  return `\u4F60\u51FA\uFF1A${names[c]}
\u6211\u51FA\uFF1A${names[bot]}
${result}`;
}
function randomInRange(arg) {
  const m = arg.match(/(\d+)\s*[-~到]\s*(\d+)/);
  if (!m) return "\u7528\u6CD5\uFF1A\u968F\u673A\u6570 1-100";
  const min = Math.min(parseInt(m[1]), parseInt(m[2]));
  const max = Math.max(parseInt(m[1]), parseInt(m[2]));
  return `\u968F\u673A\u6570\uFF08${min}-${max}\uFF09\uFF1A${min + Math.floor(Math.random() * (max - min + 1))}`;
}
function pickChoice(args) {
  const items = args.split(/[、,，;；\s]+/).filter(Boolean);
  if (items.length < 2) return "\u7528\u6CD5\uFF1A\u9009\u62E9 \u9009\u9879A \u9009\u9879B \u9009\u9879C";
  return `\u6211\u5E2E\u4F60\u9009\u4E86\uFF1A${pickRandomFromList(items)}`;
}
function whatToEat() {
  return `\u4ECA\u5929\u5403\uFF1A${pickRandomFromList(FOOD_LIST)}`;
}
function drawCp(parts, members) {
  if (members && members.length >= 2) {
    return `\u{1F49E} ${members[0]} \u2764 ${members[1]}`;
  }
  return "\u7528\u6CD5\uFF1A\u62BDCP \u540D\u5B57A \u540D\u5B57B";
}
function renderMine(grid, revealed, w, h, lost) {
  const rows = [];
  rows.push("   " + Array.from({ length: w }, (_, i) => String(i + 1)).join(" "));
  grid.forEach((row, r) => {
    const line = row.map((v, c) => {
      if (lost && v === -1) return "\u{1F4A3}";
      if (!revealed[r][c]) return "\u25A0";
      return v === 0 ? "\xB7" : String(v);
    }).join(" ");
    rows.push(String.fromCharCode(65 + r) + " " + line);
  });
  rows.push("\u53D1\u9001\u300C\u626B\u96F7 A1\u300D\u7FFB\u5F00\u683C\u5B50");
  return rows.join("\n");
}
function minesweeperInit(event) {
  const uid = String(event.user_id);
  const w = 9, h = 9, mines = 10;
  const grid = Array.from({ length: h }, () => Array(w).fill(0));
  const bomb = Array.from({ length: h }, () => Array(w).fill(false));
  let placed = 0;
  while (placed < mines) {
    const r = Math.floor(Math.random() * h);
    const c = Math.floor(Math.random() * w);
    if (!bomb[r][c]) {
      bomb[r][c] = true;
      placed++;
    }
  }
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (bomb[r][c]) {
        grid[r][c] = -1;
        continue;
      }
      let n = 0;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < h && nc >= 0 && nc < w && bomb[nr][nc]) n++;
        }
      grid[r][c] = n;
    }
  }
  const revealed = Array.from({ length: h }, () => Array(w).fill(false));
  state.data.mines[uid] = { grid, bomb, revealed, w, h };
  state.saveData();
  return renderMine(grid, revealed, w, h, false);
}
function minesweeperReveal(event, arg) {
  const uid = String(event.user_id);
  const game = state.data.mines[uid];
  if (!game) return "\u6CA1\u6709\u8FDB\u884C\u4E2D\u7684\u626B\u96F7\u6E38\u620F\uFF0C\u53D1\u9001\u300C\u626B\u96F7\u300D\u5F00\u59CB\u4E00\u5C40\u3002";
  const m = arg.match(/^([A-Za-z])(\d+)$/);
  if (!m) return "\u683C\u5F0F\uFF1A\u626B\u96F7 A1";
  const r = m[1].toUpperCase().charCodeAt(0) - 65;
  const c = parseInt(m[2]) - 1;
  if (r < 0 || r >= game.h || c < 0 || c >= game.w) return "\u8D8A\u754C\u5566\uFF0C\u518D\u8BD5\u4E00\u6B21\u3002";
  if (game.revealed[r][c]) return "\u8FD9\u4E2A\u683C\u5B50\u5DF2\u7ECF\u7FFB\u8FC7\u4E86\u3002";
  if (game.bomb[r][c]) {
    delete state.data.mines[uid];
    state.saveData();
    return renderMine(game.grid, game.revealed.map((row) => row.map(() => true)), game.w, game.h, true) + "\n\u{1F4A5} \u8E29\u5230\u5730\u96F7\u4E86\uFF01\u6E38\u620F\u7ED3\u675F\u3002";
  }
  const queue = [[r, c]];
  while (queue.length) {
    const [cr, cc] = queue.pop();
    if (game.revealed[cr][cc]) continue;
    game.revealed[cr][cc] = true;
    if (game.grid[cr][cc] === 0) {
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const nr = cr + dr, nc = cc + dc;
          if (nr >= 0 && nr < game.h && nc >= 0 && nc < game.w && !game.revealed[nr][nc] && !game.bomb[nr][nc]) queue.push([nr, nc]);
        }
    }
  }
  let cleared = 0;
  for (let i = 0; i < game.h; i++) for (let j = 0; j < game.w; j++) if (game.revealed[i][j]) cleared++;
  state.saveData();
  if (cleared === game.w * game.h - 10) {
    delete state.data.mines[uid];
    state.saveData();
    return renderMine(game.grid, game.revealed, game.w, game.h, false) + "\n\u{1F389} \u626B\u96F7\u6210\u529F\uFF01";
  }
  return renderMine(game.grid, game.revealed, game.w, game.h, false);
}
function woodFish(event) {
  const uid = String(event.user_id);
  state.data.woodFish[uid] = (state.data.woodFish[uid] || 0) + 1;
  state.saveData();
  return `\u{1F528} \u529F\u5FB7 +1\uFF0C\u7D2F\u8BA1\u529F\u5FB7 ${state.data.woodFish[uid]}`;
}
function fishing(event) {
  const uid = String(event.user_id);
  const st = state.data.fishing[uid] || { count: 0, score: 0, best: "" };
  const fish = pickWeighted(FISH_LIST, Math.random);
  st.count++;
  st.score += fish.score;
  if (fish.score >= 20) st.best = fish.name;
  state.data.fishing[uid] = st;
  state.saveData();
  return `\u{1F3A3} \u4F60\u9493\u5230\u4E86\uFF1A${fish.name}\uFF08+${fish.score}\u5206\uFF09
\u7D2F\u8BA1\u9493\u9C7C ${st.count} \u6B21\uFF0C\u603B\u5206 ${st.score}${st.best ? `\uFF0C\u6700\u4F73\u8BB0\u5F55\uFF1A${st.best}` : ""}`;
}
function getFarm(event) {
  const uid = String(event.user_id);
  if (!state.data.farm[uid]) {
    state.data.farm[uid] = { coins: 100, plots: [{ crop: null, plantedAt: 0 }, { crop: null, plantedAt: 0 }, { crop: null, plantedAt: 0 }] };
  }
  return state.data.farm[uid];
}
function farmView(event) {
  const f = getFarm(event);
  const lines = [`\u{1F33E} \u5F00\u5FC3\u519C\u573A\uFF08\u91D1\u5E01\uFF1A${f.coins}\uFF09`];
  f.plots.forEach((p, i) => {
    if (!p.crop) {
      lines.push(`  ${i + 1}. \u7A7A\u5730`);
      return;
    }
    const def = CROP_LIST.find((c) => c.name === p.crop);
    const remain = Math.max(0, Math.ceil((p.plantedAt + (def ? def.time : 60) * 1e3 - Date.now()) / 1e3));
    lines.push(`  ${i + 1}. ${p.crop}${remain > 0 ? `\uFF08\u8FD8\u6709 ${remain}s \u6210\u719F\uFF09` : "\uFF08\u53EF\u6536\u83B7\uFF09"}`);
  });
  lines.push("\u53D1\u9001\u300C\u79CD\u690D \u841D\u535C\u300D\u300C\u6536\u83B7 1\u300D\u300C\u5F00\u57A6\u300D(100\u91D1\u5E01)");
  state.saveData();
  return lines.join("\n");
}
function farmPlant(event, cropName) {
  const f = getFarm(event);
  const def = CROP_LIST.find((c) => c.name === cropName);
  if (!def) return `\u6CA1\u6709\u8FD9\u4E2A\u4F5C\u7269\uFF1A${cropName}\uFF08\u53EF\u9009\uFF1A${CROP_LIST.map((c) => c.name).join("\u3001")}\uFF09`;
  if (f.coins < def.cost) return `\u91D1\u5E01\u4E0D\u8DB3\uFF0C\u79CD\u690D${def.name}\u9700\u8981 ${def.cost} \u91D1\u5E01\u3002`;
  const empty = f.plots.findIndex((p) => !p.crop);
  if (empty === -1) return "\u6CA1\u6709\u7A7A\u5730\u4E86\uFF0C\u5148\u6536\u83B7\u6216\u5F00\u57A6\u3002";
  f.coins -= def.cost;
  f.plots[empty] = { crop: def.name, plantedAt: Date.now() };
  state.saveData();
  return `\u5DF2\u79CD\u690D ${def.name}\uFF08${def.time}s \u540E\u6210\u719F\uFF09\u3002`;
}
function farmHarvest(event, idx) {
  const f = getFarm(event);
  const i = parseInt(idx) - 1;
  if (isNaN(i) || i < 0 || i >= f.plots.length) return "\u683C\u5F0F\uFF1A\u6536\u83B7 1";
  const p = f.plots[i];
  if (!p.crop) return "\u8FD9\u5757\u5730\u662F\u7A7A\u7684\u3002";
  const def = CROP_LIST.find((c) => c.name === p.crop);
  if (Date.now() < p.plantedAt + (def ? def.time : 60) * 1e3) {
    const remain = Math.ceil((p.plantedAt + (def ? def.time : 60) * 1e3 - Date.now()) / 1e3);
    return `\u8FD8\u6CA1\u6210\u719F\uFF0C\u8FD8\u9700\u8981 ${remain}s\u3002`;
  }
  const gain = def ? def.yield : 30;
  f.coins += gain;
  f.plots[i] = { crop: null, plantedAt: 0 };
  state.saveData();
  return `\u6536\u83B7\u6210\u529F\uFF01${def ? def.name : ""} \u5356\u51FA ${gain} \u91D1\u5E01\uFF0C\u5F53\u524D\u91D1\u5E01\uFF1A${f.coins}`;
}
function farmExpand(event) {
  const f = getFarm(event);
  if (f.plots.length >= 6) return "\u6700\u591A 6 \u5757\u5730\u3002";
  if (f.coins < 100) return "\u91D1\u5E01\u4E0D\u8DB3\uFF0C\u5F00\u57A6\u9700\u8981 100 \u91D1\u5E01\u3002";
  f.coins -= 100;
  f.plots.push({ crop: null, plantedAt: 0 });
  state.saveData();
  return `\u5F00\u57A6\u6210\u529F\uFF01\u73B0\u5728\u6709 ${f.plots.length} \u5757\u5730\u3002`;
}
function xianNi(event) {
  const uid = String(event.user_id);
  const rand = seededRandom(uid + todayStr());
  const xp = 1 + Math.floor(rand() * 50);
  const realm = REALT_LIST[Math.min(REALT_LIST.length - 1, Math.floor(rand() * REALT_LIST.length))];
  const next = REALT_LIST[Math.min(REALT_LIST.length - 1, REALT_LIST.indexOf(realm) + 1)];
  return `\u{1F9D8} \u4ED9\u9006\u4FEE\u70BC\u65E5\u5FD7
\u4ECA\u65E5\u4FEE\u70BC\u83B7\u5F97 ${xp} \u70B9\u7075\u529B
\u5F53\u524D\u5883\u754C\uFF1A${realm}
${next ? `\u4E0B\u4E00\u5883\u754C\uFF1A${next}` : "\u5DF2\u8FBE\u5DC5\u5CF0"}`;
}

// src/features/signin.ts
function getSignin(event) {
  const uid = String(event.user_id);
  if (!state.data.signin[uid]) {
    state.data.signin[uid] = { points: 0, streak: 0, last: "", history: {} };
  }
  return state.data.signin[uid];
}
function doSignin(event) {
  const st = getSignin(event);
  const today = todayStr();
  if (st.last === today) {
    return `\u4ECA\u5929\u5DF2\u7ECF\u7B7E\u8FC7\u5230\u5566\uFF01\u5F53\u524D\u79EF\u5206 ${st.points}\uFF0C\u8FDE\u7EED ${st.streak} \u5929\u3002`;
  }
  const prev = st.last;
  const prevDate = new Date(today);
  prevDate.setDate(prevDate.getDate() - 1);
  const expected = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}-${String(prevDate.getDate()).padStart(2, "0")}`;
  st.streak = prev === expected ? st.streak + 1 : 1;
  const bonus = st.streak >= 7 ? 10 : st.streak >= 3 ? 5 : 0;
  const base = 5 + Math.floor(Math.random() * 6);
  st.points += base + bonus;
  st.last = today;
  st.history[today] = (st.history[today] || 0) + 1;
  state.saveData();
  return `\u2705 \u7B7E\u5230\u6210\u529F\uFF01\u83B7\u5F97 ${base} \u79EF\u5206${bonus ? ` + ${bonus} \u8FDE\u7EED\u5956\u52B1` : ""}
\u8FDE\u7EED\u7B7E\u5230 ${st.streak} \u5929\uFF0C\u5F53\u524D\u79EF\u5206 ${st.points}`;
}
function makeupSignin(event) {
  const st = getSignin(event);
  const cost = 20;
  if (st.points < cost) return `\u8865\u7B7E\u9700\u8981 ${cost} \u79EF\u5206\uFF0C\u5F53\u524D ${st.points} \u79EF\u5206\u4E0D\u8DB3\u3002`;
  st.points -= cost;
  st.streak += 1;
  state.saveData();
  return `\u2705 \u8865\u7B7E\u6210\u529F\uFF01\u6D88\u8017 ${cost} \u79EF\u5206\uFF0C\u8FDE\u7EED ${st.streak} \u5929\uFF0C\u5269\u4F59\u79EF\u5206 ${st.points}`;
}
function leaderboard() {
  const entries = Object.entries(state.data.signin).map(([uid, v]) => ({ uid, ...v }));
  entries.sort((a, b) => b.points - a.points);
  if (!entries.length) return "\u8FD8\u6CA1\u6709\u4EBA\u7B7E\u5230\uFF0C\u5FEB\u6765\u7B2C\u4E00\u4E2A\u7B7E\u5230\u5427\uFF01";
  const lines = entries.slice(0, 10).map((e, i) => `${i + 1}. ${e.uid}\uFF1A${e.points} \u79EF\u5206\uFF08\u8FDE\u7EED ${e.streak} \u5929\uFF09`);
  return `\u{1F3C6} \u7B7E\u5230\u6392\u884C\u699C
${lines.join("\n")}`;
}
function personalInfo(event) {
  const uid = String(event.user_id);
  const st = state.data.signin[uid] || { points: 0, streak: 0 };
  const wf = state.data.woodFish[uid] || 0;
  const f = state.data.fishing[uid] || { count: 0, score: 0 };
  return `\u3010\u4E2A\u4EBA\u4FE1\u606F\u3011
QQ\uFF1A${uid}
\u79EF\u5206\uFF1A${st.points}\uFF08\u8FDE\u7EED ${st.streak} \u5929\uFF09
\u529F\u5FB7\uFF1A${wf}
\u9493\u9C7C\uFF1A${f.count} \u6B21 / ${f.score} \u5206`;
}

// src/features/schedule.ts
function addSchedule(event, args) {
  const m = args.match(/^(\d{1,2}):(\d{2})\s+(.+)$/);
  if (!m) {
    const iv = args.match(/^每\s*(\d+)\s*分钟\s+(.+)$/);
    if (iv) {
      const s2 = {
        type: "interval",
        minutes: parseInt(iv[1]),
        message: iv[2],
        target: String(event.group_id || event.user_id),
        isGroup: !!event.group_id,
        createdAt: Date.now()
      };
      state.data.schedules.push(s2);
      state.saveData();
      return `\u2705 \u5DF2\u6DFB\u52A0\u95F4\u9694\u63A8\u9001\uFF1A\u6BCF ${iv[1]} \u5206\u949F\u53D1\u9001\u300C${iv[2]}\u300D`;
    }
    return "\u7528\u6CD5\uFF1A\u6DFB\u52A0\u5B9A\u65F6 08:00 \u5185\u5BB9\uFF0C\u6216 \u6DFB\u52A0\u5B9A\u65F6 \u6BCF30\u5206\u949F \u5185\u5BB9";
  }
  const s = {
    type: "daily",
    time: `${m[1].padStart(2, "0")}:${m[2]}`,
    message: m[3],
    target: String(event.group_id || event.user_id),
    isGroup: !!event.group_id,
    createdAt: Date.now()
  };
  state.data.schedules.push(s);
  state.saveData();
  return `\u2705 \u5DF2\u6DFB\u52A0\u6BCF\u65E5\u5B9A\u65F6 ${s.time} \u53D1\u9001\u300C${s.message}\u300D`;
}
function listSchedules(event) {
  const target = String(event.group_id || event.user_id);
  const mine = state.data.schedules.filter((s) => s.target === target);
  if (!mine.length) return "\u8FD8\u6CA1\u6709\u5B9A\u65F6\u4EFB\u52A1\u3002";
  return `\u23F0 \u5B9A\u65F6\u5217\u8868\uFF08${target}\uFF09
${mine.map((s, i) => `${i + 1}. ${s.type === "daily" ? `\u6BCF\u65E5 ${s.time}` : `\u6BCF${s.minutes}\u5206\u949F`} - ${s.message}`).join("\n")}
\u53D1\u9001\u300C\u5220\u9664\u5B9A\u65F6 <\u5E8F\u53F7>\u300D\u5220\u9664`;
}
function deleteSchedule(event, idx) {
  const target = String(event.group_id || event.user_id);
  const mine = state.data.schedules.filter((s2) => s2.target === target);
  const i = parseInt(idx) - 1;
  if (isNaN(i) || i < 0 || i >= mine.length) return "\u5E8F\u53F7\u65E0\u6548\u3002";
  const s = mine[i];
  state.data.schedules = state.data.schedules.filter((x) => x !== s);
  state.saveData();
  return `\u2705 \u5DF2\u5220\u9664\u5B9A\u65F6\uFF1A${s.message}`;
}
function checkSchedules() {
  const ctx = state.ctx;
  if (!ctx) return;
  const now = nowTime();
  for (const s of state.data.schedules) {
    if (!s) continue;
    if (s.type === "daily" && s.time === now) {
      const params = {
        message: s.message,
        message_type: s.isGroup ? "group" : "private"
      };
      if (s.isGroup) params.group_id = s.target;
      else params.user_id = s.target;
      ctx.actions.call("send_msg", params, ctx.adapterName, ctx.pluginManager.config).catch(() => {
      });
    } else if (s.type === "interval" && s.minutes) {
      const elapsed = Date.now() - s.createdAt;
      const period = s.minutes * 6e4;
      const lastTick = Math.floor(elapsed / period);
      if (lastTick > 0) {
        const params = {
          message: s.message,
          message_type: s.isGroup ? "group" : "private"
        };
        if (s.isGroup) params.group_id = s.target;
        else params.user_id = s.target;
        ctx.actions.call("send_msg", params, ctx.adapterName, ctx.pluginManager.config).catch(() => {
        });
        s.createdAt = Date.now();
      }
    }
  }
  const today = todayStr();
  if (now === (state.config.dailyPushTime || "08:00")) {
    for (const [uid, note] of Object.entries(state.data.dailyNotes)) {
      ctx.actions.call("send_msg", { message: `\u{1F4DD} \u6BCF\u65E5\u5907\u6CE8\u63D0\u9192\uFF1A${note}`, message_type: "private", user_id: uid }, ctx.adapterName, ctx.pluginManager.config).catch(() => {
      });
    }
  }
  const md = today.slice(5);
  for (const [uid, bd] of Object.entries(state.data.birthdays)) {
    if (String(bd).slice(5) === md) {
      ctx.actions.call("send_msg", { message: "\u{1F382} \u4ECA\u5929\u662F\u4F60\u7684\u751F\u65E5\uFF0C\u795D\u4F60\u751F\u65E5\u5FEB\u4E50\uFF01", message_type: "private", user_id: uid }, ctx.adapterName, ctx.pluginManager.config).catch(() => {
      });
    }
  }
}

// src/features/keyword.ts
function addKeyword(event, args) {
  const idx = args.search(/\s+/);
  if (idx === -1) return "\u7528\u6CD5\uFF1A\u6DFB\u52A0\u5173\u952E\u8BCD <\u8BCD> <\u56DE\u590D>";
  const kw = args.slice(0, idx).trim();
  const reply = args.slice(idx).trim();
  if (!kw || !reply) return "\u7528\u6CD5\uFF1A\u6DFB\u52A0\u5173\u952E\u8BCD <\u8BCD> <\u56DE\u590D>";
  const key = `k_${kw}`;
  state.data.keywordReplies[key] = { kw, reply, group: event.group_id ? String(event.group_id) : "" };
  state.saveData();
  return `\u2705 \u5173\u952E\u8BCD\u300C${kw}\u300D\u2192 ${reply}`;
}
function delKeyword(args) {
  const kw = args.trim();
  if (!kw) return "\u7528\u6CD5\uFF1A\u5220\u9664\u5173\u952E\u8BCD <\u8BCD>";
  const key = `k_${kw}`;
  if (state.data.keywordReplies[key]) {
    delete state.data.keywordReplies[key];
    state.saveData();
    return `\u2705 \u5DF2\u5220\u9664\u5173\u952E\u8BCD\u300C${kw}\u300D`;
  }
  return `\u672A\u627E\u5230\u5173\u952E\u8BCD\u300C${kw}\u300D`;
}
function keywordMatch(text, groupId) {
  for (const v of Object.values(state.data.keywordReplies)) {
    if (v.group && v.group !== String(groupId)) continue;
    if (text.includes(v.kw)) return v.reply;
  }
  return null;
}
function keywordList(label) {
  const list = Object.values(state.data.keywordReplies);
  return list.length ? `${label}\uFF1A
${list.map((v) => `  ${v.kw} \u2192 ${v.reply}`).join("\n")}` : `${label}\u4E3A\u7A7A\u3002`;
}

// src/features/menu.ts
function buildTextMenu() {
  return `\u3010\u667A\u80FD\u673A\u5668\u4EBA\u83DC\u5355\u3011
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F4CC} \u57FA\u7840
  \u83DC\u5355 / \u4E3B\u83DC\u5355 / \u5E2E\u52A9
  \u7B7E\u5230 | \u8865\u7B7E | \u6392\u884C\u699C | \u4E2A\u4EBA\u4FE1\u606F
  \u7FA4\u4FE1\u606F | \u7FA4\u7EDF\u8BA1
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F3AE} \u5A31\u4E50\u4E2D\u5FC3
  \u4ECA\u65E5\u8FD0\u52BF | \u4ECA\u65E5\u4EBA\u54C1 | \u63B7\u9AB0\u5B50 | \u731C\u62F3
  \u9009\u62E9 | \u968F\u673A\u6570 | \u4ECA\u5929\u5403\u4EC0\u4E48 | \u62BDCP
  \u626B\u96F7 | \u6572\u6728\u9C7C | \u5F00\u5FC3\u519C\u573A | \u53BB\u9493\u9C7C | \u4ED9\u9006
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F3B5} \u97F3\u4E50 / \u{1F324} \u5DE5\u5177
  \u70B9\u6B4C/\u5531\u6B4C <\u6B4C\u540D> | \u5929\u6C14 <\u57CE\u5E02>
  \u6BCF\u65E5\u6253\u5361 | \u6BCF\u65E5\u5907\u6CE8 <\u5185\u5BB9> | \u8BBE\u7F6E\u6635\u79F0 <\u540D\u5B57>
  \u67E5\u5DE1 | \u7FA4\u6253\u5361
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u23F0 \u5B9A\u65F6
  \u6DFB\u52A0\u5B9A\u65F6 <HH:MM> <\u5185\u5BB9>
  \u5B9A\u65F6\u5217\u8868 | \u5220\u9664\u5B9A\u65F6 <\u5E8F\u53F7>
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F465} \u7FA4\u7BA1\u7406
  \u5168\u5458\u7981\u8A00 | \u89E3\u7981\u5168\u5458
  \u7981\u8A00 @\u67D0\u4EBA [\u5206\u949F] | \u89E3\u7981 @\u67D0\u4EBA
  \u8E22\u4EBA @\u67D0\u4EBA | \u8BBE\u7BA1\u7406 @\u67D0\u4EBA | \u53D6\u6D88\u7BA1\u7406 @\u67D0\u4EBA
  \u7FA4\u516C\u544A <\u5185\u5BB9> | \u8BBE\u7F6E\u7FA4\u540D <\u540D\u5B57>
  \u64A4\u56DE <\u6D88\u606FID> | \u8BBE\u4E3A\u7CBE\u534E <\u6D88\u606FID> | \u6233\u4E00\u6233 @\u67D0\u4EBA
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F4A1} \u5173\u952E\u8BCD
  \u6DFB\u52A0\u5173\u952E\u8BCD <\u8BCD> <\u56DE\u590D>
  \u5220\u9664\u5173\u952E\u8BCD <\u8BCD> | \u5173\u952E\u8BCD\u5217\u8868
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F511} \u6388\u6743
  \u83B7\u53D6\u6FC0\u6D3B\u7801 | \u6FC0\u6D3B <\u6388\u6743\u7801> | \u6388\u6743\u72B6\u6001
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u2699\uFE0F \u7BA1\u7406(\u4E3B\u4EBA)
  \u8BBE\u7F6E\u4E3B\u4EBA <QQ\u53F7> | \u4E3B\u4EBA\u5217\u8868
  \u5F00\u542F\u673A\u5668\u4EBA | \u5173\u95ED\u673A\u5668\u4EBA
  \u5168\u5C40\u5F00\u542F | \u5168\u5C40\u5173\u95ED
  \u9891\u9053\u5217\u8868 | \u9891\u9053\u6D4B\u8BD5 | \u5B9A\u65F6\u5173\u673A <N>\u5206\u949F
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u2139\uFE0F \u5176\u4ED6
  \u8FD0\u884C\u65F6\u95F4 | \u7248\u672C | \u66F4\u65B0\u65E5\u5FD7 | \u8D5E\u52A9 | \u95EE\u5019`;
}
function buildButtonMenuData() {
  const buttons = [
    [{ text: "\u{1F4CC} \u83DC\u5355", data: "\u83DC\u5355", type: 2 }, { text: "\u{1F3AE} \u4ECA\u65E5\u8FD0\u52BF", data: "\u4ECA\u65E5\u8FD0\u52BF", type: 2 }],
    [{ text: "\u{1F3AE} \u63B7\u9AB0\u5B50", data: "\u63B7\u9AB0\u5B50", type: 2 }, { text: "\u{1F3AE} \u4ECA\u5929\u5403\u4EC0\u4E48", data: "\u4ECA\u5929\u5403\u4EC0\u4E48", type: 2 }],
    [{ text: "\u2705 \u7B7E\u5230", data: "\u7B7E\u5230", type: 2 }, { text: "\u{1F3C6} \u6392\u884C\u699C", data: "\u6392\u884C\u699C", type: 2 }],
    [{ text: "\u{1F324} \u5929\u6C14", data: "\u5929\u6C14 \u5317\u4EAC", type: 2 }, { text: "\u{1F3B5} \u70B9\u6B4C", data: "\u70B9\u6B4C \u6674\u5929", type: 2 }],
    [{ text: "\u{1F3A3} \u53BB\u9493\u9C7C", data: "\u53BB\u9493\u9C7C", type: 2 }, { text: "\u23F0 \u6572\u6728\u9C7C", data: "\u6572\u6728\u9C7C", type: 2 }],
    [{ text: "\u{1F446} \u6233\u4E00\u6233", data: "\u6233\u4E00\u6233", type: 2 }, { text: "\u{1F511} \u83B7\u53D6\u6FC0\u6D3B\u7801", data: "\u83B7\u53D6\u6FC0\u6D3B\u7801", type: 2 }],
    [{ text: "\u{1F4A1} \u5173\u952E\u8BCD\u5217\u8868", data: "\u5173\u952E\u8BCD\u5217\u8868", type: 2 }, { text: "\u2728 \u7FA4\u6253\u5361", data: "\u7FA4\u6253\u5361", type: 2 }]
  ];
  return { rows: buttons, bot_appid: 0 };
}
async function showMenu(ctx, event, style) {
  const textMenu = buildTextMenu();
  if (style === "image") {
    const url = state.config.menuImageUrl;
    const file = state.config.menuImagePath;
    if (url || file) {
      const seg = [{ type: "image", data: url ? { url } : { file } }];
      await sendMsg(ctx, event, seg);
      return;
    }
    await sendMsg(ctx, event, "\u56FE\u7247\u83DC\u5355\u672A\u914D\u7F6E\uFF1A\u8BF7\u5728\u63D2\u4EF6\u914D\u7F6E\u4E2D\u586B\u5199 menuImageUrl \u6216 menuImagePath\u3002\n\n" + textMenu);
    return;
  }
  if (style === "button" && state.config.enableButtonMenu) {
    const data = buildButtonMenuData();
    const seg = [{ type: "keyboard", data: { content: JSON.stringify(data) } }];
    await sendMsg(ctx, event, seg);
    await sendMsg(ctx, event, textMenu);
    return;
  }
  await sendMsg(ctx, event, textMenu);
}

// src/features/misc.ts
import { execSync } from "child_process";
function uptimeInfo() {
  const s = process.uptime();
  const d = Math.floor(s / 86400);
  const h = Math.floor(s % 86400 / 3600);
  const m = Math.floor(s % 3600 / 60);
  return `\u23F1 \u5728\u7EBF\u65F6\u95F4\uFF1A${d}\u5929 ${h}\u5C0F\u65F6 ${m}\u5206\u949F`;
}
function versionInfo(version) {
  return `\u{1F4E6} \u667A\u80FD\u673A\u5668\u4EBA\u63D2\u4EF6 v${version}
\u8FD0\u884C NapCat \u63D2\u4EF6\u7CFB\u7EDF
\u4F5C\u8005\uFF1A\u7A7A\u7A7A\u7231\u8FFD\u5267\uFF08QQ 511742399\uFF09`;
}
function changelog() {
  return `\u3010\u66F4\u65B0\u65E5\u5FD7\u3011
v3.1.0
- \u7FA4\u5F00\u5173\u652F\u6301\u6309\u7FA4\u914D\u7F6E\uFF08\u54EA\u4E9B\u7FA4\u5F00\u542F/\u54EA\u4E9B\u7FA4\u5173\u95ED\uFF0C\u53EF\u5728\u8BBE\u7F6E\u754C\u9762\u586B\u5199\uFF09
- TypeScript \u5DE5\u7A0B\u91CD\u6784\uFF08napcat-plugin-template \u98CE\u683C\uFF09
- \u8BBE\u7F6E\u754C\u9762\u54CD\u5E94\u5F0F\u5347\u7EA7\uFF08\u7535\u8111\u7AEF/\u624B\u673A\u7AEF\uFF09
- \u6240\u6709\u529F\u80FD\u6574\u5408\u5230\u5355\u4E00\u63D2\u4EF6\uFF0C\u4E0D\u518D\u91CD\u590D\u6563\u843D
v3.0.0
- \u6388\u6743\u7801\u5BF9\u63A5\u9762\u677F\u6388\u6743 API\uFF08auth_codes \u8868\u540C\u6E90\uFF0C\u6FC0\u6D3B\u540C\u6B65\u5230\u9762\u677F\uFF09
- \u65B0\u589E\u9891\u9053\u7BA1\u7406\uFF08\u9891\u9053\u5217\u8868 / \u9891\u9053\u6D4B\u8BD5\uFF09
v2.0.0
- TypeScript \u6A21\u5757\u5316\u91CD\u6784
- \u65B0\u589E NapCat \u63A5\u53E3\u547D\u4EE4\uFF08\u7FA4\u6253\u5361/\u6233\u4E00\u6233/\u7CBE\u534E/\u516C\u544A/\u7FA4\u540D/\u7BA1\u7406\u5458\uFF09
v1.0.0
- \u5168\u65B0\u667A\u80FD\u673A\u5668\u4EBA\u63D2\u4EF6
- \u7FA4\u5F00\u5173/\u4E3B\u4EBA/\u6388\u6743\u7BA1\u7406
- \u4E09\u79CD\u83DC\u5355\uFF08\u6587\u5B57/\u6309\u94AE/\u56FE\u7247\uFF09
- \u5A31\u4E50\u4E2D\u5FC3/\u7B7E\u5230/\u7FA4\u7BA1\u7406/\u5B9A\u65F6\u63A8\u9001\u7B49`;
}
function sponsorInfo() {
  return `\u3010\u8D5E\u52A9\u6211\u4EEC\u3011
\u5982\u679C\u89C9\u5F97\u597D\u7528\uFF0C\u8BF7\u652F\u6301\u4E00\u4E0B\u5F00\u53D1\u8005\uFF5E
\u4F5C\u8005\uFF1A\u7A7A\u7A7A\u7231\u8FFD\u5267\uFF08QQ 511742399\uFF09
\u611F\u8C22\u4F60\u7684\u652F\u6301\uFF01`;
}
function greetingInfo() {
  return `\u4F60\u597D\u5440\uFF01\u6211\u662F\u667A\u80FD\u673A\u5668\u4EBA\u3002
\u53D1\u9001\u300C\u83DC\u5355\u300D\u67E5\u770B\u6240\u6709\u529F\u80FD\u5427\uFF5E`;
}
function scheduleShutdown(event, args) {
  const uid = String(event.user_id);
  if (!state.data.owners.includes(uid) && !state.config.ownerIds.includes(uid)) {
    return "\u8BE5\u547D\u4EE4\u4EC5\u9650\u4E3B\u4EBA\u4F7F\u7528\u3002";
  }
  const m = args.match(/(\d+)\s*分钟/);
  if (!m) return "\u7528\u6CD5\uFF1A\u5B9A\u65F6\u5173\u673A <N> \u5206\u949F";
  const min = parseInt(m[1]);
  if (min <= 0 || min > 720) return "\u65F6\u95F4\u8303\u56F4 1-720 \u5206\u949F\u3002";
  setTimeout(() => {
    try {
      execSync("shutdown -h +1");
    } catch {
    }
  }, min * 6e4);
  return `\u2705 \u5DF2\u8BBE\u7F6E ${min} \u5206\u949F\u540E\u5173\u673A\u3002`;
}
async function setNickname(ctx, event, name) {
  if (!name) {
    await sendMsg(ctx, event, "\u7528\u6CD5\uFF1A\u8BBE\u7F6E\u6635\u79F0 <\u540D\u5B57>");
    return;
  }
  if (event.message_type === "group") {
    const res = await callApi(ctx, "set_group_card", {
      group_id: String(event.group_id),
      user_id: String(event.user_id),
      card: name
    });
    await sendMsg(ctx, event, res === null ? "\u8BBE\u7F6E\u5931\u8D25\uFF0C\u53EF\u80FD\u6CA1\u6709\u6743\u9650\u3002" : `\u2705 \u5DF2\u5C06\u4F60\u7684\u7FA4\u540D\u7247\u6539\u4E3A\uFF1A${name}`);
  } else {
    await sendMsg(ctx, event, "\u7FA4\u540D\u7247\u53EA\u80FD\u5728\u7FA4\u804A\u4E2D\u8BBE\u7F6E\u3002");
  }
}
function dailyNote(event, content) {
  if (!content) {
    return "\u7528\u6CD5\uFF1A\u6BCF\u65E5\u5907\u6CE8 <\u5185\u5BB9>\uFF0C\u4F1A\u6BCF\u5929\u63A8\u9001\u7ED9\u4F60\u3002";
  }
  const uid = String(event.user_id);
  state.data.dailyNotes[uid] = content;
  state.saveData();
  return `\u2705 \u6BCF\u65E5\u5907\u6CE8\u5DF2\u8BBE\u7F6E\uFF1A${content}`;
}
function dailyCheckin(event) {
  const uid = String(event.user_id);
  const today = todayStr();
  const st = state.data.checkins[uid] || { last: "", count: 0 };
  if (st.last === today) return "\u4ECA\u5929\u5DF2\u7ECF\u6253\u8FC7\u5361\u4E86\u3002";
  st.last = today;
  st.count = (st.count || 0) + 1;
  state.data.checkins[uid] = st;
  state.saveData();
  return `\u2705 \u6253\u5361\u6210\u529F\uFF01\u7D2F\u8BA1\u6253\u5361 ${st.count} \u5929\u3002`;
}
function chatTour(event) {
  const uid = String(event.user_id);
  return `\u{1F50D} \u67E5\u5DE1\uFF1A\u7528\u6237 ${uid} \u8BB0\u5F55
\u7FA4\u5F00\u5173\uFF1A${event.group_id ? groupEnabled(event.group_id) ? "\u5F00\u542F" : "\u5173\u95ED" : "-"}
\u6388\u6743\u7801\uFF1A${Object.keys(state.data.activatedCodes).filter((c) => state.data.activatedCodes[c].owner === String(uid)).length} \u4E2A
\u7B7E\u5230\uFF1A${(state.data.signin[uid] || {}).points || 0} \u79EF\u5206`;
}
function ownerInfo() {
  const owners = [...state.config.ownerIds, ...state.data.owners];
  return `\u{1F451} \u4E3B\u4EBA\u5217\u8868\uFF1A${owners.join("\u3001") || "\u6682\u65E0"}`;
}
function setOwner(event, args) {
  const qq = args.match(/\d+/);
  if (!qq) return "\u7528\u6CD5\uFF1A\u8BBE\u7F6E\u4E3B\u4EBA <QQ\u53F7>";
  if (!state.data.owners.includes(qq[0])) state.data.owners.push(qq[0]);
  state.saveData();
  return `\u2705 \u5DF2\u5C06 ${qq[0]} \u8BBE\u4E3A\u4E3B\u4EBA\u3002`;
}
function groupSwitchStatus(event) {
  if (event.message_type !== "group") return "\u8BE5\u547D\u4EE4\u4EC5\u7FA4\u804A\u53EF\u7528\u3002";
  const gid = String(event.group_id);
  const on = groupEnabled(gid);
  const enabled = splitList(state.config.groupEnabledList);
  const disabled = splitList(state.config.groupDisabledList);
  const lines = [
    `\u{1F518} \u672C\u7FA4\u673A\u5668\u4EBA\uFF1A${on ? "\u5F00\u542F" : "\u5173\u95ED"}`,
    `\u5F00\u542F\u7684\u7FA4\u5217\u8868\uFF1A${enabled.length ? enabled.join("\u3001") : "\uFF08\u7A7A = \u5168\u90E8\u5F00\u542F\uFF09"}`,
    `\u5173\u95ED\u7684\u7FA4\u5217\u8868\uFF1A${disabled.length ? disabled.join("\u3001") : "\uFF08\u7A7A\uFF09"}`
  ];
  return lines.join("\n");
}
function setGroupSwitch(event, on) {
  if (event.message_type !== "group") return "\u8BE5\u547D\u4EE4\u4EC5\u7FA4\u804A\u53EF\u7528\u3002";
  const gid = String(event.group_id);
  if (on) {
    enableGroup(gid);
    return "\u2705 \u672C\u7FA4\u673A\u5668\u4EBA\u5DF2\u5F00\u542F\u3002";
  }
  disableGroup(gid);
  return "\u2705 \u672C\u7FA4\u673A\u5668\u4EBA\u5DF2\u5173\u95ED\u3002";
}

// src/services/auth.ts
async function fetchAuthCodes() {
  const cfg = state.config;
  const base = String(cfg.authServerUrl || "").replace(/\/+$/, "");
  const apiPath = String(cfg.authApiPath || "/api/auth/code");
  let url = base + apiPath;
  if (cfg.authMethod === "html" && !apiPath.includes("?")) {
    url += `?t=${Date.now()}`;
  }
  try {
    const res = await httpGet(url, cfg.authTimeout);
    if (res.status !== 200) return { ok: false, msg: `\u6388\u6743\u670D\u52A1\u5668\u8FD4\u56DE ${res.status}` };
    if (cfg.authMethod === "html") {
      const codes2 = (res.body.match(/[A-Z0-9]{8,32}/gi) || []).slice(0, 10);
      if (!codes2.length) return { ok: false, msg: "\u7F51\u9875\u4E2D\u672A\u63D0\u53D6\u5230\u6388\u6743\u7801" };
      return { ok: true, codes: [...new Set(codes2)].map(String) };
    }
    let data;
    try {
      data = JSON.parse(res.body);
    } catch {
      return { ok: false, msg: "\u6388\u6743\u670D\u52A1\u5668\u8FD4\u56DE\u7684\u4E0D\u662F\u5408\u6CD5 JSON" };
    }
    const field = String(cfg.authCodeField || "code");
    let codes = Array.isArray(data) ? data : data[field];
    if (!codes && data.data) {
      const d = data.data;
      codes = Array.isArray(d) ? d : d[field];
    }
    if (codes === void 0 || codes === null) {
      const obj = data;
      codes = obj.codes || obj.list || obj.result || [];
    }
    if (typeof codes === "string") codes = codes.split(/[\s,，;；]+/).filter(Boolean);
    if (!Array.isArray(codes) || !codes.length) return { ok: false, msg: "\u6388\u6743\u54CD\u5E94\u4E2D\u672A\u627E\u5230\u6388\u6743\u7801\u5B57\u6BB5" };
    return { ok: true, codes: codes.map((c) => String(c)) };
  } catch (e) {
    return { ok: false, msg: `\u6388\u6743\u670D\u52A1\u5668\u8FDE\u63A5\u5931\u8D25: ${e.message}` };
  }
}
async function grantCode(ctx, event) {
  const res = await fetchAuthCodes();
  if (!res.ok) {
    await sendMsg(ctx, event, `\u83B7\u53D6\u6FC0\u6D3B\u7801\u5931\u8D25\uFF1A${res.msg}`);
    return;
  }
  const list = res.codes.slice(0, 10).map((c) => `  ${c}`).join("\n");
  await sendMsg(
    ctx,
    event,
    `\u6210\u529F\u83B7\u53D6 ${res.codes.length} \u4E2A\u6FC0\u6D3B\u7801\uFF1A
${list}

\u53D1\u9001\u300C\u6FC0\u6D3B <\u6388\u6743\u7801>\u300D\u5373\u53EF\u6FC0\u6D3B\u6388\u6743\u3002`
  );
}
async function activateCode(ctx, event, code) {
  code = (code || "").trim().toUpperCase();
  if (!code) {
    await sendMsg(ctx, event, "\u7528\u6CD5\uFF1A\u6FC0\u6D3B <\u6388\u6743\u7801>");
    return;
  }
  const uid = String(event.user_id);
  const cfg = state.config;
  const base = String(cfg.authServerUrl || "").replace(/\/+$/, "");
  const verifyPath = String(cfg.authVerifyPath || "/api/auth/code/verify");
  if (base && verifyPath) {
    try {
      const res = await httpRequest(base + verifyPath, {
        method: "POST",
        body: { code, openid: uid },
        timeout: cfg.authTimeout
      });
      let data = null;
      try {
        data = JSON.parse(res.body);
      } catch {
      }
      if (res.status !== 200 || !data || data.valid !== true) {
        await sendMsg(ctx, event, `\u6FC0\u6D3B\u5931\u8D25\uFF1A${data?.error || `\u9762\u677F\u8FD4\u56DE ${res.status}`}`);
        return;
      }
    } catch (e) {
      await sendMsg(ctx, event, `\u6FC0\u6D3B\u5931\u8D25\uFF1A\u65E0\u6CD5\u8FDE\u63A5\u6388\u6743\u670D\u52A1\u5668\uFF08${e.message}\uFF09`);
      return;
    }
  }
  const now = Date.now();
  if (state.data.activatedCodes[code]) {
    if (state.data.activatedCodes[code].owner === uid) {
      await sendMsg(ctx, event, "\u8BE5\u6388\u6743\u7801\u5DF2\u7531\u4F60\u6FC0\u6D3B\u3002");
    } else {
      await sendMsg(ctx, event, "\u8BE5\u6388\u6743\u7801\u5DF2\u88AB\u5176\u4ED6\u7528\u6237\u6FC0\u6D3B\u3002");
    }
    return;
  }
  state.data.activatedCodes[code] = { owner: uid, time: now, group: event.group_id ? String(event.group_id) : "" };
  state.saveData();
  await sendMsg(ctx, event, `\u6FC0\u6D3B\u6210\u529F\uFF01\u6388\u6743\u7801 ${code} \u5DF2\u7ED1\u5B9A\u5230\u4F60\u7684 QQ\u3002`);
}
async function authStatus(ctx, event) {
  const uid = String(event.user_id);
  const mine = Object.entries(state.data.activatedCodes).filter(([, v]) => v.owner === uid);
  if (!mine.length) {
    await sendMsg(ctx, event, "\u4F60\u8FD8\u6CA1\u6709\u6FC0\u6D3B\u4EFB\u4F55\u6388\u6743\u7801\u3002\u53D1\u9001\u300C\u83B7\u53D6\u6FC0\u6D3B\u7801\u300D\u83B7\u53D6\u3002");
    return;
  }
  const lines = mine.map(([code, v]) => `  ${code}\uFF08\u6FC0\u6D3B\u4E8E ${new Date(v.time).toLocaleString("zh-CN")}\uFF09`);
  await sendMsg(ctx, event, `\u4F60\u5DF2\u6FC0\u6D3B ${mine.length} \u4E2A\u6388\u6743\u7801\uFF1A
${lines.join("\n")}`);
}

// src/services/channel.ts
async function channelList(ctx, event) {
  const raw = await callApi(ctx, "get_qq_channel_list", {});
  const list = Array.isArray(raw) ? raw : raw?.data || [];
  if (!list || !list.length) {
    await sendMsg(ctx, event, "\u672A\u83B7\u53D6\u5230\u9891\u9053\u5217\u8868\uFF08\u53EF\u80FD\u5C1A\u672A\u63A5\u5165\u9891\u9053\u80FD\u529B\uFF09\u3002");
    return;
  }
  const lines = [];
  for (const g of list) {
    const guildId = g.guild_id || g.guildId || g.id;
    const guildName = g.guild_name || g.name || "\u672A\u547D\u540D\u9891\u9053\u7EC4";
    const rawCh = await callApi(ctx, "get_qq_channel_guild_member_list", { guild_id: guildId });
    const chs = Array.isArray(rawCh) ? rawCh : rawCh?.data || [];
    if (chs && chs.length) {
      lines.push(`\u{1F4E2} ${guildName}\uFF08${guildId}\uFF09\uFF1A`);
      for (const c of chs) {
        lines.push(`   - ${c.channel_name || c.name || "\u672A\u547D\u540D"}\uFF08${c.channel_id || c.id}\uFF09`);
      }
    } else {
      lines.push(`\u{1F4E2} ${guildName}\uFF08${guildId}\uFF09\uFF1A\u6682\u65E0\u9891\u9053`);
    }
  }
  await sendMsg(ctx, event, `\u9891\u9053\u5217\u8868\uFF08${list.length} \u4E2A\u9891\u9053\u7EC4\uFF09\uFF1A
${lines.join("\n")}`);
}
async function channelTest(ctx, event) {
  const channelId = String(state.config.channelId || "7989734378509876559").trim();
  if (!channelId) {
    await sendMsg(ctx, event, "\u672A\u914D\u7F6E\u6D4B\u8BD5\u9891\u9053 ID\uFF08\u53EF\u5728\u63D2\u4EF6\u914D\u7F6E\u4E2D\u8BBE\u7F6E channelId\uFF09\u3002");
    return;
  }
  const res = await callApi(ctx, "send_qq_channel_msg", {
    channel_id: channelId,
    message: `\u9891\u9053\u6D4B\u8BD5\uFF1A\u6765\u81EA${event.message_type === "group" ? `\u7FA4 ${event.group_id}` : "\u79C1\u804A"}\u7684\u6D4B\u8BD5\u6D88\u606F\uFF08${(/* @__PURE__ */ new Date()).toLocaleString("zh-CN")}\uFF09`
  });
  const ok = res && (res.status === "ok" || res.retcode === 0 || res.ok === true);
  if (ok) {
    await sendMsg(ctx, event, `\u2705 \u5DF2\u5411\u9891\u9053 ${channelId} \u53D1\u9001\u6D4B\u8BD5\u6D88\u606F\u3002`);
  } else {
    await sendMsg(ctx, event, `\u274C \u9891\u9053\u6D4B\u8BD5\u53D1\u9001\u5931\u8D25\uFF1A${res?.message || res?.error || "\u672A\u77E5\u9519\u8BEF"}`);
  }
}

// src/services/weather.ts
async function weather(ctx, event, city) {
  if (!city) {
    await sendMsg(ctx, event, "\u7528\u6CD5\uFF1A\u5929\u6C14 <\u57CE\u5E02>");
    return;
  }
  const cfg = state.config;
  const base = String(cfg.weatherApiUrl || "https://wttr.in").replace(/\/+$/, "");
  try {
    const url = `${base}/${encodeURIComponent(city)}?format=j1`;
    const res = await httpGet(url, 8e3);
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    const data = JSON.parse(res.body);
    const cur = data.current_condition && data.current_condition[0];
    const today = data.weather && data.weather[0];
    if (!cur) throw new Error("\u65E0\u6570\u636E");
    const temp = cur.temp_C;
    const desc = cur.lang_zh && cur.lang_zh[0] ? cur.lang_zh[0].value : cur.weatherDesc[0].value;
    const feels = cur.FeelsLikeC;
    const humidity = cur.humidity;
    let msg = `\u{1F324} ${city} \u5929\u6C14
\u5F53\u524D\uFF1A${temp}\u2103\uFF08\u4F53\u611F ${feels}\u2103\uFF09
\u5929\u6C14\uFF1A${desc}
\u6E7F\u5EA6\uFF1A${humidity}%`;
    if (today) {
      msg += `
\u6700\u9AD8\uFF1A${today.maxtempC}\u2103 / \u6700\u4F4E\uFF1A${today.mintempC}\u2103`;
    }
    await sendMsg(ctx, event, msg);
  } catch (e) {
    await sendMsg(ctx, event, `\u67E5\u8BE2\u5929\u6C14\u5931\u8D25\uFF08${e.message}\uFF09\u3002\u8BF7\u68C0\u67E5\u7F51\u7EDC\u6216 weatherApiUrl \u914D\u7F6E\u3002`);
  }
}

// src/services/song.ts
var SONG_SEARCH_URLS = {
  netease: (kw) => `https://music.163.com/#/search/m/?s=${encodeURIComponent(kw)}`,
  tencent: (kw) => `https://c.y.qq.com/base/fcgi-bin/u?__=yqr2kN_1&t=search&word=${encodeURIComponent(kw)}`,
  kugou: (kw) => `https://www.kugou.com/yy/html/search.html#searchType=yuanqu&searchKeyWord=${encodeURIComponent(kw)}`,
  migu: (kw) => `https://music.migu.cn/v3/music/search?q=${encodeURIComponent(kw)}`
};
var PLATFORM_NAMES = {
  netease: "\u7F51\u6613\u4E91",
  tencent: "QQ\u97F3\u4E50",
  kugou: "\u9177\u72D7",
  migu: "\u54AA\u5495"
};
async function song(ctx, event, keyword) {
  if (!keyword) {
    await sendMsg(ctx, event, "\u7528\u6CD5\uFF1A\u70B9\u6B4C/\u5531\u6B4C/\u5531\u9996\u6B4C <\u6B4C\u540D>");
    return;
  }
  const platforms = state.config.songPlatforms || ["netease", "tencent", "kugou"];
  const lines = [`\u{1F3B5} \u4E3A\u4F60\u627E\u5230\u300C${keyword}\u300D\u7684\u64AD\u653E/\u641C\u7D22\u94FE\u63A5\uFF1A`];
  for (const p of platforms) {
    const fn = SONG_SEARCH_URLS[p];
    if (fn) lines.push(`\u2022 ${PLATFORM_NAMES[p] || p}\uFF1A${fn(keyword)}`);
  }
  await sendMsg(ctx, event, lines.join("\n"));
}

// src/handlers/message.ts
function parseCommand(raw) {
  const text = stripCQ(raw);
  const prefix = state.config.commandPrefix || "";
  let body = text;
  if (prefix && body.startsWith(prefix)) {
    body = body.slice(prefix.length).trim();
  }
  const parts = body.trim().split(/\s+/);
  return {
    cmd: (parts[0] || "").toLowerCase(),
    args: body.trim().slice((parts[0] || "").length).trim(),
    parts
  };
}
function matchTextButton(raw) {
  if (!raw) return null;
  const t = stripCQ(raw);
  const lower = t.toLowerCase();
  if (lower.includes("\u6309\u94AE\u83DC\u5355")) return "button";
  if (lower.includes("\u56FE\u7247\u83DC\u5355")) return "image";
  return null;
}
async function handleMessage(ctx, event) {
  if (event.post_type !== "message") return;
  if (!state.config.enabled) return;
  const rawMsg = stripCQ(event.raw_message);
  if (event.message_type === "group" && !groupEnabled(event.group_id)) {
    if (isOwner(event.user_id) && /^(开启机器人|打开机器人|开机器人)$/.test(rawMsg)) {
      await sendMsg(ctx, event, setGroupSwitch(event, true));
    }
    return;
  }
  const raw = rawMsg;
  const { cmd, args, parts } = parseCommand(raw);
  const groupId = event.group_id ? String(event.group_id) : "";
  const btnStyle = matchTextButton(raw);
  if (btnStyle) {
    await showMenu(ctx, event, btnStyle);
    return;
  }
  const kwReply = keywordMatch(raw, groupId);
  if (kwReply && !cmd) {
    await sendMsg(ctx, event, kwReply);
    return;
  }
  switch (cmd) {
    case "\u83DC\u5355":
    case "\u4E3B\u83DC\u5355":
    case "\u5E2E\u52A9":
      await showMenu(ctx, event, "text");
      break;
    case "\u6309\u94AE\u83DC\u5355":
      await showMenu(ctx, event, "button");
      break;
    case "\u56FE\u7247\u83DC\u5355":
      await showMenu(ctx, event, "image");
      break;
    case "\u4ECA\u65E5\u8FD0\u52BF":
      await sendMsg(ctx, event, dailyFortune(event));
      break;
    case "\u4ECA\u65E5\u4EBA\u54C1":
      await sendMsg(ctx, event, dailyLuck(event));
      break;
    case "\u63B7\u9AB0\u5B50":
    case "\u9AB0\u5B50":
      await sendMsg(ctx, event, `\u{1F3B2} ${1 + Math.floor(Math.random() * 6)}`);
      break;
    case "\u731C\u62F3":
      await sendMsg(ctx, event, rockPaperScissors(args));
      break;
    case "\u9009\u62E9":
      await sendMsg(ctx, event, pickChoice(args));
      break;
    case "\u968F\u673A\u6570":
      await sendMsg(ctx, event, randomInRange(args));
      break;
    case "\u4ECA\u5929\u5403\u4EC0\u4E48":
      await sendMsg(ctx, event, whatToEat());
      break;
    case "\u62BDcp":
      await sendMsg(ctx, event, drawCp(parts, parts.slice(1).filter(Boolean)));
      break;
    case "\u626B\u96F7":
      await sendMsg(ctx, event, args ? minesweeperReveal(event, args) : minesweeperInit(event));
      break;
    case "\u6572\u6728\u9C7C":
      await sendMsg(ctx, event, woodFish(event));
      break;
    case "\u5F00\u5FC3\u519C\u573A":
      await sendMsg(ctx, event, farmView(event));
      break;
    case "\u79CD\u690D":
      await sendMsg(ctx, event, farmPlant(event, args));
      break;
    case "\u6536\u83B7":
      await sendMsg(ctx, event, farmHarvest(event, args));
      break;
    case "\u5F00\u57A6":
      await sendMsg(ctx, event, farmExpand(event));
      break;
    case "\u53BB\u9493\u9C7C":
    case "\u9493\u9C7C":
      await sendMsg(ctx, event, fishing(event));
      break;
    case "\u4ED9\u9006":
      await sendMsg(ctx, event, xianNi(event));
      break;
    case "\u7B7E\u5230":
      await sendMsg(ctx, event, doSignin(event));
      break;
    case "\u8865\u7B7E":
      await sendMsg(ctx, event, makeupSignin(event));
      break;
    case "\u6392\u884C\u699C":
      await sendMsg(ctx, event, leaderboard());
      break;
    case "\u4E2A\u4EBA\u4FE1\u606F":
    case "\u6211\u7684\u4FE1\u606F":
      await sendMsg(ctx, event, personalInfo(event));
      break;
    case "\u5929\u6C14":
      await weather(ctx, event, args);
      break;
    case "\u6BCF\u65E5\u6253\u5361":
    case "\u6253\u5361":
      await sendMsg(ctx, event, dailyCheckin(event));
      break;
    case "\u6BCF\u65E5\u5907\u6CE8":
      await sendMsg(ctx, event, dailyNote(event, args));
      break;
    case "\u8BBE\u7F6E\u6635\u79F0":
    case "\u6539\u7FA4\u540D\u7247":
      await setNickname(ctx, event, args);
      break;
    case "\u67E5\u5DE1":
      await sendMsg(ctx, event, chatTour(event));
      break;
    case "\u6DFB\u52A0\u5B9A\u65F6":
      await sendMsg(ctx, event, addSchedule(event, args));
      break;
    case "\u5B9A\u65F6\u5217\u8868":
      await sendMsg(ctx, event, listSchedules(event));
      break;
    case "\u5220\u9664\u5B9A\u65F6":
      await sendMsg(ctx, event, deleteSchedule(event, args));
      break;
    case "\u7FA4\u4FE1\u606F":
      await groupInfo(ctx, event);
      break;
    case "\u7FA4\u7EDF\u8BA1":
      await groupStats(ctx, event);
      break;
    case "\u5168\u5458\u7981\u8A00":
      if (!checkManagePermission(event)) {
        await sendMsg(ctx, event, "\u6CA1\u6709\u6743\u9650");
        break;
      }
      await groupMuteAll(ctx, event, true);
      break;
    case "\u89E3\u7981\u5168\u5458":
      if (!checkManagePermission(event)) {
        await sendMsg(ctx, event, "\u6CA1\u6709\u6743\u9650");
        break;
      }
      await groupMuteAll(ctx, event, false);
      break;
    case "\u7981\u8A00":
      if (!checkManagePermission(event)) {
        await sendMsg(ctx, event, "\u6CA1\u6709\u6743\u9650");
        break;
      }
      {
        const t = extractTarget(event, args);
        if (!t) {
          await sendMsg(ctx, event, "\u7528\u6CD5\uFF1A\u7981\u8A00 @\u67D0\u4EBA [\u5206\u949F]");
          break;
        }
        const dur = (parseInt(t.duration || "5") || 5) * 60;
        await groupMute(ctx, event, t.qq, dur);
      }
      break;
    case "\u89E3\u7981":
      if (!checkManagePermission(event)) {
        await sendMsg(ctx, event, "\u6CA1\u6709\u6743\u9650");
        break;
      }
      {
        const t = extractTarget(event, args);
        if (!t) {
          await sendMsg(ctx, event, "\u7528\u6CD5\uFF1A\u89E3\u7981 @\u67D0\u4EBA");
          break;
        }
        await groupMute(ctx, event, t.qq, 0);
      }
      break;
    case "\u8E22\u4EBA":
      if (!checkManagePermission(event)) {
        await sendMsg(ctx, event, "\u6CA1\u6709\u6743\u9650");
        break;
      }
      {
        const t = extractTarget(event, args);
        if (!t) {
          await sendMsg(ctx, event, "\u7528\u6CD5\uFF1A\u8E22\u4EBA @\u67D0\u4EBA");
          break;
        }
        await groupKick(ctx, event, t.qq);
      }
      break;
    case "\u7FA4\u6253\u5361":
      await groupPunchCard(ctx, event);
      break;
    case "\u6233\u4E00\u6233":
      {
        const t = extractTarget(event, args);
        await sendPoke(ctx, event, t ? t.qq : "");
      }
      break;
    case "\u8BBE\u4E3A\u7CBE\u534E":
      if (!checkManagePermission(event)) {
        await sendMsg(ctx, event, "\u6CA1\u6709\u6743\u9650");
        break;
      }
      await markEssence(ctx, event, args);
      break;
    case "\u7FA4\u516C\u544A":
      if (!checkManagePermission(event)) {
        await sendMsg(ctx, event, "\u6CA1\u6709\u6743\u9650");
        break;
      }
      await sendGroupAnnouncement(ctx, event, args);
      break;
    case "\u8BBE\u7F6E\u7FA4\u540D":
      if (!checkManagePermission(event)) {
        await sendMsg(ctx, event, "\u6CA1\u6709\u6743\u9650");
        break;
      }
      await setGroupName(ctx, event, args);
      break;
    case "\u8BBE\u7BA1\u7406":
      if (!checkOwner(event)) {
        await sendMsg(ctx, event, "\u6CA1\u6709\u6743\u9650");
        break;
      }
      {
        const t = extractTarget(event, args);
        if (!t) {
          await sendMsg(ctx, event, "\u7528\u6CD5\uFF1A\u8BBE\u7BA1\u7406 @\u67D0\u4EBA");
          break;
        }
        await setGroupAdmin(ctx, event, t.qq);
      }
      break;
    case "\u53D6\u6D88\u7BA1\u7406":
      if (!checkOwner(event)) {
        await sendMsg(ctx, event, "\u6CA1\u6709\u6743\u9650");
        break;
      }
      {
        const t = extractTarget(event, args);
        if (!t) {
          await sendMsg(ctx, event, "\u7528\u6CD5\uFF1A\u53D6\u6D88\u7BA1\u7406 @\u67D0\u4EBA");
          break;
        }
        await removeGroupAdmin(ctx, event, t.qq);
      }
      break;
    case "\u6DFB\u52A0\u5173\u952E\u8BCD":
      await sendMsg(ctx, event, addKeyword(event, args));
      break;
    case "\u5220\u9664\u5173\u952E\u8BCD":
      await sendMsg(ctx, event, delKeyword(args));
      break;
    case "\u5173\u952E\u8BCD\u5217\u8868":
      await sendMsg(ctx, event, keywordList("\u{1F4A1} \u5173\u952E\u8BCD\u5217\u8868"));
      break;
    case "\u83B7\u53D6\u6FC0\u6D3B\u7801":
    case "\u83B7\u53D6\u6388\u6743\u7801":
      await grantCode(ctx, event);
      break;
    case "\u6FC0\u6D3B":
      await activateCode(ctx, event, args);
      break;
    case "\u6388\u6743\u72B6\u6001":
      await authStatus(ctx, event);
      break;
    case "\u9891\u9053\u5217\u8868":
      if (!checkOwner(event)) {
        await sendMsg(ctx, event, "\u6CA1\u6709\u6743\u9650");
        break;
      }
      await channelList(ctx, event);
      break;
    case "\u9891\u9053\u6D4B\u8BD5":
      if (!checkOwner(event)) {
        await sendMsg(ctx, event, "\u6CA1\u6709\u6743\u9650");
        break;
      }
      await channelTest(ctx, event);
      break;
    case "\u8BBE\u7F6E\u4E3B\u4EBA":
      if (!isOwner(event.user_id)) {
        await sendMsg(ctx, event, "\u6CA1\u6709\u6743\u9650");
        break;
      }
      await sendMsg(ctx, event, setOwner(event, args));
      break;
    case "\u4E3B\u4EBA\u5217\u8868":
      if (!isOwner(event.user_id)) {
        await sendMsg(ctx, event, "\u6CA1\u6709\u6743\u9650");
        break;
      }
      await sendMsg(ctx, event, ownerInfo());
      break;
    case "\u5F00\u542F\u673A\u5668\u4EBA":
    case "\u6253\u5F00\u673A\u5668\u4EBA":
      if (!checkOwner(event)) {
        await sendMsg(ctx, event, "\u6CA1\u6709\u6743\u9650");
        break;
      }
      await sendMsg(ctx, event, setGroupSwitch(event, true));
      break;
    case "\u5173\u95ED\u673A\u5668\u4EBA":
      if (!checkOwner(event)) {
        await sendMsg(ctx, event, "\u6CA1\u6709\u6743\u9650");
        break;
      }
      await sendMsg(ctx, event, setGroupSwitch(event, false));
      break;
    case "\u7FA4\u5F00\u5173\u72B6\u6001":
    case "\u672C\u7FA4\u72B6\u6001":
      await sendMsg(ctx, event, groupSwitchStatus(event));
      break;
    case "\u5168\u5C40\u5F00\u542F":
      if (!isOwner(event.user_id)) {
        await sendMsg(ctx, event, "\u6CA1\u6709\u6743\u9650");
        break;
      }
      state.config.globalEnabled = true;
      state.saveConfig();
      await sendMsg(ctx, event, "\u2705 \u5168\u5C40\u6A21\u5F0F\u5DF2\u5F00\u542F\u3002");
      break;
    case "\u5168\u5C40\u5173\u95ED":
      if (!isOwner(event.user_id)) {
        await sendMsg(ctx, event, "\u6CA1\u6709\u6743\u9650");
        break;
      }
      state.config.globalEnabled = false;
      state.saveConfig();
      await sendMsg(ctx, event, "\u2705 \u5168\u5C40\u6A21\u5F0F\u5DF2\u5173\u95ED\uFF0C\u6240\u6709\u7FA4\u505C\u6B62\u54CD\u5E94\u3002");
      break;
    case "\u5B9A\u65F6\u5173\u673A":
      await sendMsg(ctx, event, scheduleShutdown(event, args));
      break;
    case "\u64A4\u56DE":
      if (!isOwner(event.user_id)) {
        await sendMsg(ctx, event, "\u6CA1\u6709\u6743\u9650");
        break;
      }
      await deleteMsg(ctx, event, args.match(/\d+/)?.[0] || "");
      break;
    case "\u8FD0\u884C\u65F6\u95F4":
    case "\u5728\u7EBF\u65F6\u95F4":
      await sendMsg(ctx, event, uptimeInfo());
      break;
    case "\u7248\u672C":
      await sendMsg(ctx, event, versionInfo(PLUGIN_VERSION));
      break;
    case "\u66F4\u65B0\u65E5\u5FD7":
      await sendMsg(ctx, event, changelog());
      break;
    case "\u8D5E\u52A9":
      await sendMsg(ctx, event, sponsorInfo());
      break;
    case "\u95EE\u5019":
    case "\u4F60\u597D":
    case "hello":
      await sendMsg(ctx, event, greetingInfo());
      break;
    case "\u70B9\u6B4C":
    case "\u5531\u6B4C":
    case "\u5531\u9996\u6B4C":
      await song(ctx, event, args);
      break;
    case "\u6DFB\u52A0\u8BCD\u5178":
      await sendMsg(ctx, event, addKeyword(event, args));
      break;
    case "\u8BCD\u5178\u5217\u8868":
      await sendMsg(ctx, event, keywordList("\u{1F4D6} \u8BCD\u5178\u5217\u8868"));
      break;
  }
}

// src/handlers/notice.ts
async function handleNotice(ctx, event) {
  if (event.post_type !== "notice") return;
  if (event.notice_type === "group_increase" && state.config.welcomeMsg) {
    const text = state.config.welcomeMsg.replace("{nickname}", `[CQ:at,qq=${event.user_id}]`);
    await sendMsg(ctx, { message_type: "group", group_id: event.group_id, user_id: event.user_id }, text);
  }
  if (event.notice_type === "group_decrease" && state.config.byeMsg) {
    await sendMsg(ctx, { message_type: "group", group_id: event.group_id, user_id: event.user_id }, state.config.byeMsg);
  }
}

// src/index.ts
var plugin_config_ui = [];
function startTimers() {
  const sched = setInterval(() => {
    try {
      checkSchedules();
    } catch (e) {
      state.ctx?.logger?.error("\u5B9A\u65F6\u4EFB\u52A1\u51FA\u9519", e);
    }
  }, 3e4);
  const chime = setInterval(() => {
    try {
      if (!state.config.hourlyChime) return;
      const d = /* @__PURE__ */ new Date();
      if (d.getMinutes() === 0) {
        const msg = `\u23F0 ${d.getHours()} \u70B9\u6574`;
        for (const gid of Object.keys(state.data.groupSwitches)) {
          if (!groupEnabled(gid)) continue;
          state.ctx?.actions.call("send_msg", { message: msg, message_type: "group", group_id: gid }, state.ctx.adapterName, state.ctx.pluginManager.config).catch(() => {
          });
        }
      }
    } catch {
    }
  }, 3e4);
  state.pushTimer(sched);
  state.pushTimer(chime);
}
async function plugin_init(ctx) {
  state.init(ctx);
  ctx.logger.info("\u667A\u80FD\u673A\u5668\u4EBA\u63D2\u4EF6\u521D\u59CB\u5316...");
  if (state.config.ownerIds && state.config.ownerIds.length) {
    const ids = String(state.config.ownerIds).split(/[，,;\s]+/).filter(Boolean);
    for (const id of ids) if (!state.data.owners.includes(id)) state.data.owners.push(id);
    state.saveData();
  }
  try {
    plugin_config_ui = buildConfigUI(ctx);
  } catch (e) {
    ctx.logger.warn("\u6784\u5EFA\u914D\u7F6E UI \u5931\u8D25:", e);
  }
  startTimers();
  ctx.logger.info("\u667A\u80FD\u673A\u5668\u4EBA\u63D2\u4EF6\u5C31\u7EEA");
}
async function plugin_onmessage(ctx, event) {
  try {
    await handleMessage(ctx, event);
  } catch (e) {
    ctx.logger.error("\u5904\u7406\u6D88\u606F\u5F02\u5E38:", e);
  }
}
async function plugin_onevent(ctx, event) {
  try {
    await handleNotice(ctx, event);
  } catch (e) {
    ctx.logger.error("\u5904\u7406\u901A\u77E5\u5F02\u5E38:", e);
  }
}
async function plugin_cleanup(ctx) {
  ctx.logger.info("\u667A\u80FD\u673A\u5668\u4EBA\u63D2\u4EF6\u6E05\u7406\u4E2D...");
  state.cleanup();
}
async function plugin_get_config() {
  return state.config;
}
async function plugin_set_config(_ctx, config) {
  state.replaceConfig(config);
}
export {
  plugin_cleanup,
  plugin_config_ui,
  plugin_get_config,
  plugin_init,
  plugin_onevent,
  plugin_onmessage,
  plugin_set_config
};
