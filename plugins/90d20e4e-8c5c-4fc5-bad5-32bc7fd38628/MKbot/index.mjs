import fs from 'fs';
import path from 'path';
import { setDataPath } from './lib/function.mjs';
import { sendReply } from './lib/Bot.mjs';
import { handleMessage as handleTestMessage, handleScheduledTask as handleScheduledTask2, handleNotice, handleRequest } from './RC/test.mjs';

let logger = null;
let plugin_config_ui = [];
let dataPath = "";

const plugin_init = async (ctx) => {
  logger = ctx.logger;
  dataPath = ctx.configPath ? path.dirname(ctx.configPath) : "./data";
  
  // 确保数据文件夹存在
  if (!fs.existsSync(dataPath)) {
    fs.mkdirSync(dataPath, { recursive: true });
  }
  
  // 告诉库模块数据文件夹在哪里
  setDataPath(dataPath);
  
  logger.info("MK 插件已初始化");
  logger.info("没事别更新！更新前要记得备份！");
  logger.error("没事别更新！更新前要记得备份！");
  logger.warn("没事别更新！更新前要记得备份！");
  logger.info("没事别更新！更新前要记得备份！");
  logger.error("没事别更新！更新前要记得备份！");
  logger.warn("没事别更新！更新前要记得备份！");
  
  // 【配置面板】
  const configPath = ctx.configPath;
  let currentConfig = {};
  
  // 如果配置文件不存在，创建默认配置
  if (!fs.existsSync(configPath)) {
    currentConfig = { OwnerQQs: [], nowoner: true, nowonernr: "你不是她......." };
    fs.writeFileSync(configPath, JSON.stringify(currentConfig, null, 2), 'utf-8');
    logger.info("配置文件已创建");
  } else {
    try {
      currentConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      
      // 如果 OwnerQQs 是字符串，转换成数组
      if (typeof currentConfig.OwnerQQs === 'string') {
        const qqArray = currentConfig.OwnerQQs
          .split(/[,，、\s&|]+/)
          .map(qq => qq.trim())
          .filter(qq => qq && /^\d+$/.test(qq));
        currentConfig.OwnerQQs = qqArray;
      }
      
      // 确保 nowoner 存在，默认为 true
      if (currentConfig.nowoner === undefined) {
        currentConfig.nowoner = true;
      }
      
      // 确保 nowonernr 存在，默认为提示文本
      if (currentConfig.nowonernr === undefined) {
        currentConfig.nowonernr = "你不是她.......";
      }
      
      fs.writeFileSync(configPath, JSON.stringify(currentConfig, null, 2), 'utf-8');
    } catch (e) {
      logger.error("配置文件格式错误，使用默认配置");
      currentConfig = { OwnerQQs: [], nowoner: true, nowonernr: "你不是她......." };
    }
  }
  
  const ownerQQsArray = currentConfig.OwnerQQs || [];
  const ownerQQsDisplay = Array.isArray(ownerQQsArray) ? ownerQQsArray.join(", ") : "";
  const nowoner = currentConfig.nowoner ?? true;
  const nowonernr = currentConfig.nowonernr ?? "你不是她.......";
  
  plugin_config_ui = [
    ctx.NapCatConfig.text("OwnerQQs", "主人 QQ", ownerQQsDisplay, "多个 QQ 用逗号分隔，如：123456,789012"),
    ctx.NapCatConfig.boolean("nowoner", "非主人回复开关", nowoner),
    ctx.NapCatConfig.text("nowonernr", "非主人回复", nowonernr)
  ];
  
  // 【定时任务】每秒执行一次所有 RC 插件的定时任务
  setInterval(async () => {
    await handleScheduledTask2(ctx);
  }, 1000);

  // 【WebUI 路由】
  try {
    const base = ctx.router;
    const ROUTE_PREFIX = "/mkbot";
    
    const wrapPath = (p) => {
      if (!p) return ROUTE_PREFIX;
      return p.startsWith("/") ? `${ROUTE_PREFIX}${p}` : `${ROUTE_PREFIX}/${p}`;
    };

    if (base && base.static) {
      base.static(wrapPath("/static"), "webui");
    }

    if (base && base.get) {
      // 获取插件信息
      base.get(wrapPath("/static/plugin-info.js"), (_req, res) => {
        try {
          res.type("application/javascript");
          res.send(`window.__PLUGIN_NAME__ = ${JSON.stringify(ctx.pluginName)};`);
        } catch (e) {
          res.status(500).send("// failed to generate plugin-info");
        }
      });

      // 获取配置
      base.get(wrapPath("/config"), (_req, res) => {
        try {
          const configPath = ctx.configPath;
          let config = {};
          if (fs.existsSync(configPath)) {
            config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          }
          res.json({ code: 0, data: config });
        } catch (error) {
          logger?.error("获取配置失败:", error);
          res.status(500).json({ code: -1, message: "获取配置失败" });
        }
      });

      // 获取群聊列表
      base.get(wrapPath("/groups"), async (_req, res) => {
        try {
          const groups = await ctx.actions.call(
            "get_group_list",
            {},
            ctx.adapterName,
            ctx.pluginManager.config
          );
          res.json({ code: 0, data: { groups: groups || [] } });
        } catch (error) {
          logger?.error("获取群聊列表失败:", error);
          res.status(500).json({ code: -1, message: "获取群聊列表失败" });
        }
      });

      // 获取好友列表
      base.get(wrapPath("/friends"), async (_req, res) => {
        try {
          const friends = await ctx.actions.call(
            "get_friend_list",
            {},
            ctx.adapterName,
            ctx.pluginManager.config
          );
          res.json({ code: 0, data: { friends: friends || [] } });
        } catch (error) {
          logger?.error("获取好友列表失败:", error);
          res.status(500).json({ code: -1, message: "获取好友列表失败" });
        }
      });

      // 保存配置
      if (base.post) {
        base.post(wrapPath("/config"), async (req, res) => {
          try {
            let body = req.body;
            if (!body || Object.keys(body).length === 0) {
              try {
                const raw = await new Promise((resolve) => {
                  let data = "";
                  req.on("data", (chunk) => data += chunk);
                  req.on("end", () => resolve(data));
                });
                if (raw) body = JSON.parse(raw);
              } catch (e) {
                logger?.error("解析请求体失败:", e);
              }
            }

            const configPath = ctx.configPath;
            const configDir = path.dirname(configPath);
            if (!fs.existsSync(configDir)) {
              fs.mkdirSync(configDir, { recursive: true });
            }

            let config = {};
            if (fs.existsSync(configPath)) {
              config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            }

            // 合并新配置
            Object.assign(config, body || {});
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

            logger?.info("配置已保存");
            res.json({ code: 0, message: "ok" });
          } catch (error) {
            logger?.error("保存配置失败:", error);
            res.status(500).json({ code: -1, message: "保存配置失败" });
          }
        });
      }

      // 获取更新公告
      if (base && base.get) {
        base.get(wrapPath("/announcement"), async (_req, res) => {
          try {
            const http = await import('http');
            const request = http.get('http://cnmb.xiaoyaxiao.xin/mkbot/gxgg.txt', (response) => {
              let data = '';
              response.on('data', (chunk) => {
                data += chunk;
              });
              response.on('end', () => {
                res.json({ code: 0, data: data });
              });
            });
            
            request.on('error', (error) => {
              logger?.error("获取公告失败:", error.message);
              res.status(500).json({ code: -1, message: "获取公告失败: " + error.message });
            });
            
            request.setTimeout(5000, () => {
              request.destroy();
              res.status(500).json({ code: -1, message: "获取公告超时" });
            });
          } catch (error) {
            logger?.error("获取公告失败:", error.message);
            res.status(500).json({ code: -1, message: "获取公告失败: " + error.message });
          }
        });
      }

      // 注册 WebUI 页面
      if (base.page) {
        base.page({
          path: "mkbot-dashboard",
          title: "MKbot插件",
          icon: "",
          htmlFile: "webui/dashboard.html",
          description: "管理 MKbot 插件功能"
        });
        logger?.info("WebUI 页面已注册");
      }
    }

    logger?.info("WebUI 路由已注册");
  } catch (e) {
    logger?.warn("注册 WebUI 路由失败:", e);
  }
};

const plugin_onmessage = async (ctx, event) => {
  // 只处理消息事件
  if (event.post_type === "message") {
    await handleMessageEvent(ctx, event);
  }
};

const plugin_onevent = async (ctx, event) => {
  // 处理通知和请求事件
  if (event.post_type === "notice") {
    await handleNoticeEvent(ctx, event);
  } else if (event.post_type === "request") {
    await handleRequestEvent(ctx, event);
  }
};

// 处理消息事件
async function handleMessageEvent(ctx, event) {
  const message = event.raw_message?.trim() || "";

  let reply = await handleTestMessage(message, event, ctx);
  
  if (reply) {
    // 处理延迟消息
    if (reply.type === "delay") {
      for (const item of reply.messages) {
        if (item.delay > 0) {
          await new Promise(resolve => setTimeout(resolve, item.delay));
        }
        await sendReply(event, item.text, ctx);
      }
    }
    // 处理数组消息
    else if (Array.isArray(reply)) {
      for (const msg of reply) {
        await sendReply(event, msg, ctx);
      }
    }
    // 处理字符串消息
    else {
      await sendReply(event, reply, ctx);
    }
  }
}

// 处理通知事件
async function handleNoticeEvent(ctx, event) {
  try {
    logger?.info(`[通知事件] 收到通知: ${event.notice_type}`, event);
    await handleNotice(event, ctx);
  } catch (error) {
    logger?.error("处理通知事件失败:", error);
  }
}

// 处理请求事件
async function handleRequestEvent(ctx, event) {
  try {
    await handleRequest(event, ctx);
  } catch (error) {
    logger?.error("处理请求事件失败:", error);
  }
}

// 【配置变化监听】
function plugin_on_config_change(ctx, _, key, value) {
  const configPath = ctx.configPath;
  
  // 读取现有配置
  let config = {};
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (e) {
      config = {};
    }
  }
  
  if (key === "OwnerQQs") {
    const qqArray = value
      .split(/[,，、\s&|]+/)
      .map(qq => qq.trim())
      .filter(qq => qq && /^\d+$/.test(qq));
    
    config.OwnerQQs = qqArray;
    logger?.info(`主人 QQ 已更新: ${qqArray.join(", ")}`);
  }
  
  if (key === "nowoner") {
    config.nowoner = value;
    logger?.info(`认主已${value ? "启用" : "禁用"}`);
  }
  
  if (key === "nowonernr") {
    config.nowonernr = value;
    logger?.info(`非主人回复已更新`);
  }
  
  // 写入文件
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

export { plugin_init, plugin_onmessage, plugin_onevent, plugin_config_ui, plugin_on_config_change };
