/**
 * 发送回复消息
 * @param {object} event - 消息事件对象
 * @param {string} content - 要发送的内容
 * @param {object} ctx - 插件上下文
 * 
 * @example
 * await sendReply(event, "你好", ctx);
 */
export async function sendReply(event, content, ctx) {
  if (!ctx.actions || !content) return;

  const params = {
    message: content,
    message_type: event.message_type,
    ...event.message_type === "group" ? { group_id: String(event.group_id) } : { user_id: String(event.user_id) }
  };

  try {
    await ctx.actions.call("send_msg", params, ctx.adapterName, ctx.pluginManager.config);
  } catch (error) {
    console.error("发送消息失败:", error);
  }
}

/**
 * 发送合并消息（转发消息）
 * @param {object} event - 消息事件对象
 * @param {array} messages - 消息数组，每个元素必须是对象格式：{ text: "内容", name: "昵称", qq: 123456 }
 * @param {object} ctx - 插件上下文
 * 
 * @example
 * await sendForward(event, [
 *   { text: "消息1", name: "张三", qq: 111111 },
 *   { text: "消息2", name: "李四", qq: 222222 }
 * ], ctx);
 */
export async function sendForward(event, messages, ctx) {
  if (!ctx.actions || !Array.isArray(messages)) return;

  const forwardData = messages.map((msg) => ({
    type: "node",
    data: {
      name: msg.name || "用户",
      uin: msg.qq || event.user_id,
      content: msg.text || ""
    }
  }));

  const params = {
    message: forwardData,
    message_type: event.message_type,
    ...event.message_type === "group" ? { group_id: String(event.group_id) } : { user_id: String(event.user_id) }
  };

  try {
    await ctx.actions.call("send_msg", params, ctx.adapterName, ctx.pluginManager.config);
  } catch (error) {
    console.error("发送合并消息失败:", error);
  }
}

export function giveAT(message) {
  if (!Array.isArray(message)) {
    return [];
  }
  
  return message
    .filter(s => s.type === "at" && s.data?.qq && s.data.qq !== "all")
    .map(s => s.data.qq);
}


/**
 * 获取消息中的图片 URL
 * @param {array} message - 消息段数组
 * @returns {array} 图片 URL 数组
 * 
 * @example
 * const images = getImages(event.message);
 * // 返回: ["http://...", "http://..."]
 */
export function giveImages(message) {
  if (!Array.isArray(message)) {
    return [];
  }
  
  return message
    .filter(s => s.type === "image" && s.data?.url)
    .map(s => s.data.url);
}

/**
 * 获取消息中的纯文本内容
 * @param {array} message - 消息段数组
 * @returns {string} 纯文本内容
 * 
 * @example
 * const text = getText(event.message);
 * // 返回: "你好世界"
 */
export function giveText(message) {
  if (!Array.isArray(message)) {
    return "";
  }
  
  return message
    .filter(s => s.type === "text")
    .map(s => s.data?.text || "")
    .join("");
}


/**
 * 调用 NapCat API（自动处理 No data returned 错误）
 * @param {object} ctx - 插件上下文
 * @param {string} action - API 名称
 * @param {object} params - API 参数
 * @returns {object} API 返回结果
 * 
 * @example
 * const result = await BOTAPI(ctx, "set_group_ban", { group_id: "123", user_id: "456", duration: 60 });
 * if (result.retcode === 0) {
 *   console.log("禁言成功");
 * }
 */
// 来自：napcat-plugin-group-manager 群管插件 
export async function BOTAPI(ctx, action, params) {
  try {
    const result = await ctx.actions.call(action, params, ctx.adapterName, ctx.pluginManager.config);
    return result;
  } catch (error) {
    // NapCat 的某些 API 虽然执行成功但不返回数据，返回成功响应
    if (typeof error === "object" && error.message && error.message.includes("No data returned")) {
      return { status: "ok", retcode: 0, data: null };
    }
    throw error;
  }
}
