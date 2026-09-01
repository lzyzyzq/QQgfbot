import { EventBus } from '../core/event-bus';

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
}

export interface PluginStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): void;
}

export interface PluginLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

export interface BotAPI {
  sendMessage(channelId: string, content: string, msgId?: string): Promise<any>;
  sendImageMessage(channelId: string, imageUrl: string, msgId?: string): Promise<any>;
  sendPrivateMessage(openid: string, content: string, msgId?: string): Promise<any>;
  sendGroupMessage(groupOpenid: string, content: string, msgId?: string): Promise<any>;
  sendKeyboardPrivate(openid: string, keyboard: any, msgId?: string): Promise<any>;
  sendKeyboardGroup(groupOpenid: string, keyboard: any, msgId?: string): Promise<any>;
  sendMarkdownPrivate(openid: string, markdown: string, templateId?: number, params?: any[], msgId?: string): Promise<any>;
  sendMarkdownGroup(groupOpenid: string, markdown: string, templateId?: number, params?: any[], msgId?: string): Promise<any>;
  sendGroupMarkdownWithImage(groupOpenid: string, markdown: string, imageUrl: string, msgId?: string): Promise<any>;
  uploadGroupImage(groupOpenid: string, imageUrl: string): Promise<any>;
  uploadGroupImageBuffer(groupOpenid: string, buffer: Buffer, filename?: string): Promise<any>;
  sendGroupImageMessage(groupOpenid: string, fileInfo: string, msgId?: string): Promise<any>;
  /** URL 上传语音到群富媒体（file_type=3，mp3/wav/ogg/silk），返回 file_info */
  uploadGroupVoice(groupOpenid: string, audioUrl: string, filename?: string): Promise<any>;
  /** 分片上传本地语音 buffer 到群富媒体（file_type=3），返回 file_info */
  uploadGroupVoiceBuffer(groupOpenid: string, buffer: Buffer, filename?: string): Promise<any>;
  /** 发送富媒体语音消息（msg_type=7） */
  sendGroupVoiceMessage(groupOpenid: string, fileInfo: string, msgId?: string): Promise<any>;
  /** 文本转语音（微软 Edge TTS 免费），返回 mp3 Buffer，失败返回 null */
  textToSpeech(text: string, voice?: string): Promise<Buffer | null>;
  sendGroupInfoCard(groupOpenid: string, card: any, msgId?: string): Promise<boolean>;
  sendGroupDashboard(groupOpenid: string, msgId?: string): Promise<boolean>;
  /** 发送「图片菜单」卡片：渲染发送者头像昵称+菜单项为 PNG 后经富媒体图片消息发送 */
  sendMenuCard(groupOpenid: string, menu: any, msgId?: string): Promise<boolean>;
  muteMember(groupOpenid: string, memberOpenid: string, durationSecs: number): Promise<any>;
  unmuteMember(groupOpenid: string, memberOpenid: string): Promise<any>;
  /** 更新已禁言成员到期时间 */
  updateMuteMember(groupOpenid: string, memberOpenid: string, durationSecs: number): Promise<any>;
  /** 查询群内禁言状态（群级规则 + 当前被禁言成员列表） */
  getRestrictChatSetting(groupOpenid: string): Promise<any>;
  kickMember(groupOpenid: string, memberOpenid: string, addBlacklist?: boolean, deleteMsgDays?: number): Promise<any>;
  deleteMessage(groupOpenid: string, messageId: string, hideTip?: boolean): Promise<any>;
  muteAll(groupOpenid: string, enable: boolean, durationSecs?: number): Promise<any>;
  setAnnouncement(groupOpenid: string, content: string): Promise<any>;
  deleteAnnouncement(groupOpenid: string, announcementId: string): Promise<any>;
  /** 获取群公告列表 */
  getAnnouncements(groupOpenid: string): Promise<any[]>;
  /** 获取入群申请列表 */
  getJoinRequests(groupOpenid: string): Promise<any[]>;
  // ---- 官方服务端接口：群信息（服务端 API） ----
  /** 获取群基础信息（群名/群头像/成员数/简介等），无权限时返回 null */
  getGroupInfo(groupOpenid: string): Promise<any>;
  /** 获取机器人在群状态（角色/接收消息设置等） */
  getGroupBotState(groupOpenid: string): Promise<any>;
  /** 获取群成员列表（数组，含 openid/昵称等），失败返回空数组 */
  getGroupMembers(groupOpenid: string): Promise<any[]>;
  // ---- 频道管理（频道 v1 API） ----
  /** 获取机器人所在的频道列表 */
  getGuilds(): Promise<any[]>;
  /** 获取频道信息 */
  getGuildDetail(guildId: string): Promise<any>;
  /** 获取频道的子频道列表 */
  getChannels(guildId: string): Promise<any[]>;
  /** 获取子频道信息 */
  getChannelDetail(channelId: string): Promise<any>;
  /** 获取子频道成员列表（官方无子频道级成员接口，内部读取频道成员） */
  getChannelMembers(channelId: string): Promise<any[]>;
  /** 撤回频道消息（删帖） */
  deleteChannelMessage(channelId: string, messageId: string): Promise<any>;
  /** 修改子频道用户权限（permissionBit 为权限位，add=true 授权 / false 收回） */
  setChannelUserPermission(channelId: string, userId: string, permissionBit: number, add: boolean): Promise<any>;
  /** 读取子频道消息/帖子列表 */
  getChannelMessages(channelId: string, pageSize?: number): Promise<any[]>;
  /** 创建子频道（payload: { name, type?, parent_id? }） */
  createChannel(guildId: string, payload: any): Promise<any>;
  /** 修改子频道（payload: { name }） */
  modifyChannel(channelId: string, payload: any): Promise<any>;
  /** 删除子频道 */
  deleteChannel(channelId: string): Promise<any>;
  /** 获取频道成员列表 */
  getGuildMembers(guildId: string, limit?: number, after?: string): Promise<any[]>;
  /** 移除频道成员 */
  removeGuildMember(guildId: string, userId: string): Promise<any>;
  /** 频道成员禁言（seconds 秒，传 0 表示解除） */
  muteGuildMember(guildId: string, userId: string, seconds: number): Promise<any>;
  /** 发布子频道公告（基于已发消息创建） */
  createChannelAnnounce(channelId: string, messageId: string): Promise<any>;
  /** 删除子频道公告（messageId 传 'all' 清空全部） */
  deleteChannelAnnounce(channelId: string, messageId: string): Promise<any>;
  /** 频道全局公告列表 */
  getGuildAnnounces(guildId: string): Promise<any[]>;
  /** 发布频道全局公告（基于已发消息创建，announceType 0=成员公告 1=欢迎公告） */
  createGuildAnnounce(guildId: string, channelId: string, messageId: string, announceType?: number): Promise<any>;
  /** 删除频道全局公告（messageId 传 'all' 清空全部） */
  deleteGuildAnnounce(guildId: string, messageId: string): Promise<any>;
  /** 频道成员信息（失败返回 null） */
  getGuildMember(guildId: string, userId: string): Promise<any>;
  /** 频道身份组列表 */
  getGuildRoles(guildId: string): Promise<any[]>;
  /** 创建频道身份组 */
  createGuildRole(guildId: string, name: string): Promise<any>;
  /** 修改频道身份组名称 */
  updateGuildRole(guildId: string, roleId: string, name: string): Promise<any>;
  /** 删除频道身份组 */
  deleteGuildRole(guildId: string, roleId: string): Promise<any>;
  /** 身份组添加成员 */
  createGuildRoleMember(guildId: string, roleId: string, userId: string): Promise<any>;
  /** 身份组移除成员 */
  deleteGuildRoleMember(guildId: string, roleId: string, userId: string): Promise<any>;
  /** 板块帖子列表（论坛子频道） */
  getThreads(channelId: string, pageSize?: number): Promise<any[]>;
  /** 帖子详情（失败返回 null） */
  getThreadDetail(channelId: string, threadId: string): Promise<any>;
  /** 发帖（format=1 文本帖，content 支持 Markdown） */
  postThread(channelId: string, title: string, content: string, format?: number): Promise<any>;
  /** 删帖 */
  deleteThread(channelId: string, threadId: string): Promise<any>;
  // ---- 自定义菜单与指令面板（服务端 API v2/menu、v2/panels） ----
  /** 查询全局自定义菜单 */
  getGlobalMenu(): Promise<any>;
  /** 修改全局自定义菜单 */
  setGlobalMenu(payload: any): Promise<any>;
  /** 查询指令面板列表 */
  getPanels(): Promise<any>;
  /** 创建指令面板 */
  createPanel(payload: any): Promise<any>;
  /** 查询指令面板详情 */
  getPanelDetail(panelId: string): Promise<any>;
  /** 修改指令面板 */
  updatePanel(panelId: string, payload: any): Promise<any>;
  /** 删除指令面板 */
  deletePanel(panelId: string): Promise<any>;
  /** 修改指令面板关联对象 */
  updatePanelTarget(panelId: string, payload: any): Promise<any>;
  getStatus(): string;
}

export interface PluginConfig {
  [key: string]: any;
}

export interface PluginEngineAPI {
  enableAllExcept(exceptId: string): Promise<void>;
  disableAllExcept(exceptId: string): Promise<void>;
  isAllOthersEnabled(exceptId: string): boolean;
  isAllOthersDisabled(exceptId: string): boolean;
  callPlugin(name: string, method: string, ...args: any[]): Promise<any>;
  findPluginByName(name: string): string | null;
  /** 跨插件读取指定插件（名称或 id）的 storage 值：getPluginStorage('签到系统','checkin_xxx_total') */
  getPluginStorage(target: string, key: string): string | null;
  enable(id: string): Promise<void>;
  disable(id: string): Promise<void>;
  reload(id: string): Promise<any>;
  getPluginConfig(id: string): Record<string, string>;
  setPluginConfig(id: string, key: string, value: string): void;
  // ---- 全局回复模式（文字 / 按钮 / 文字链接） ----
  /** 当前全局模式：text | button | text_link */
  getGlobalMode(): string;
  /** 设置全局模式，全插件共享生效 */
  setGlobalMode(mode: string): void;
  /** 全局文字外显模式：on=外显文字渲染为 mqqapi 链接，off=纯文本（config global_link_mode） */
  getLinkMode(): string;
  /** 写全局文字外显模式：on / off */
  setLinkMode(mode: string): void;
  /** 生成菜单链接 markdown：item.type='link' 直接跳转，否则 mqqapi inlinecmd 回填指令（enter=false 不自动发送，reply=false 不引用） */
  menuLink(label: string, item: { type?: string; value: string }): string;
  /** 按全局文字外显模式渲染外显文字：on 返回 [text](mqqapi://aio/%69nlinecmd?command=cmd)，off 返回原 text */
  linkify(text: string, cmd: string): string;
  /** 面板对外基础地址（panel.host 配置），未配置返回空串 */
  getPanelBaseUrl(): string;
  /** 生成"文字链接点击回复"落地页 URL（点击后自动触发对应指令并回复到群）；未配置面板域名返回空串 */
  buildClickUrl(groupOpenid: string, userOpenid: string, action: string): string;
  /** 机器人自身昵称（config bot.name，未配置时兜底"空空爱追剧"） */
  getBotName(): string;
  /** 按机器人 AppID 查名称（data/bots.json registry，未登记回退 config bot.name） */
  getBotNameById(botId: string): string;
  /** 群 OpenID → 群名（groups 表缓存，无则返回空串） */
  getGroupName(groupOpenid: string): string;
  /** 群 OpenID → 数字群号（groups 表 group_number，未同步则返回空串） */
  getGroupNumber(groupOpenid: string): string;
  /** 读全局 config 表值（如 bot.chime_texts），未配置返回空串 */
  getConfigValue(key: string): string;
  /** 写全局 config 表值（供插件与网页后端定时任务等联动），成功返回 true */
  setConfigValue(key: string, value: string): boolean;
  /** 读全局用户自定义变量（面板「插件卡片·后台编辑器」变量管理创建，config plugin.vars），未定义返回 null */
  getVariable(name: string): string | null;
  /** 写全局用户自定义变量（面板与插件联动），成功返回 true */
  setVariable(name: string, value: string): boolean;
  /** 列出全部用户自定义变量：{ 名称: 值 } */
  listVariables(): Record<string, string>;
  /** 该机器人已分配（可配置按群开关）的插件名列表；该机器人无分配记录时返回全部已启用插件 */
  listAssignedPlugins(botId: string): Array<{ id: string; name: string }>;
  /** 写插件按群开关：mode 为 allow（仅此群启用）/ deny（此群禁用）/ 其他（清除配置跟随全局），写入后重置缓存 */
  setPluginGroupMode(pluginId: string, groupId: string, mode: string): { ok: boolean; mode?: string; error?: string };
  /** 读插件在指定群的门控模式：allow / deny / null（未配置跟随全局） */
  getPluginGroupMode(pluginId: string, groupId: string): string | null;
  /** 读后台设置的群内成员角色（group_members.role）：owner / admin / member / user / 空（未设置，回退实时查询） */
  getGroupMemberRole(groupId: string, memberOpenid: string): string;
  /** 查群主：返回 group_members 中 role=owner 的成员 { openid, qq_id, nickname, role }，无则返回 null */
  findGroupOwner(groupId: string): { openid: string; qq_id: string; nickname: string; role: string } | null;
  /** 用户信息聚合：OpenID → { openid, qq_number, nickname, avatar, permission, auth_code, auth_role, logs } */
  getUserProfile(openid: string, limit?: number): any;
  /** 绑定 OpenID → QQ（写入 user_mappings，同步 admin.json/group_members） */
  bindUserQQ(openid: string, qq: string, nickname?: string): { ok: boolean; error?: string };
  /** 解绑 OpenID → QQ（清除 user_mappings + group_members + admin.json 关联） */
  unbindUser(openid: string): { ok: boolean; error?: string };
  /** 群 OpenID → 数字群号绑定（写入 groups.group_number，群不存在时自动收录） */
  bindGroupNumber(groupOpenid: string, groupNumber: string, name?: string): { ok: boolean; error?: string };
  /** 群成员头像 URL：优先该群内成员绑定的 QQ（qlogo），其次用户全局绑定，未绑定返回空串 */
  getGroupMemberAvatar(groupId: string, openid: string): string;
  /** QQ 号 → 绑定的 OpenID（user_mappings 优先，其次该 QQ 最近活跃的群成员），无绑定返回 null */
  resolveOpenidByQq(qq: string): string | null;
  /** 群内按昵称（或 OpenID 精确）查成员 OpenID：精确匹配优先，无匹配返回 null */
  getGroupMemberOpenidByNickname(groupId: string, nickname: string): string | null;
  /** 群信息聚合：群OpenID → { id, group_number, name, avatar, member_count, active_members, first_seen, last_active, bot_id, logs } */
  getGroupProfile(groupId: string, limit?: number): any;
}

export interface PluginIdentity {
  /** OpenID → 绑定的 QQ 号 */
  getQQ(openid: string): string | null;
  /** QQ 号 → 绑定的所有 OpenID（多机器人） */
  getOpenids(qq: string): Array<{ openid: string; bot_id: string }>;
  /** OpenID → 绑定信息（QQ号 + 昵称） */
  getInfo(openid: string): { openid: string; qq_number: string; nickname: string } | null;
  /** 两个 OpenID 是否属于同一用户（按 QQ 号对比） */
  isSameUser(openidA: string, openidB: string): boolean;
}

export interface PluginContext {
  pluginId: string;
  bot: BotAPI;
  eventBus: Pick<EventBus, 'on' | 'off'>;
  logger: PluginLogger;
  storage: PluginStorage;
  config: PluginConfig;
  engine: PluginEngineAPI;
  identity: PluginIdentity;
  /** data/ 下文件型数据（data/database 目录 JSON/文本文件读写，路径安全限制在目录内） */
  data: {
    /** 读取 JSON 文件，不存在或解析失败返回 fallback（缺省 null） */
    readJSON(name: string, fallback?: any): any;
    /** 写入 JSON 文件（美化 2 空格），成功返回 true */
    writeJSON(name: string, obj: any): boolean;
    /** 删除文件，成功或不存在均返回 true */
    remove(name: string): boolean;
    /** 读取原始文本，不存在返回 fallback（缺省 null） */
    readText(name: string, fallback?: string): string | null;
  };
  /** 全局文字外显链接工具（新增全局变量：mqqapi 链接式外显文字，受全局切换控制） */
  link: {
    /** 当前全局文字外显模式：on=链接式，off=纯文本 */
    mode(): string;
    /** 生成菜单链接 markdown（不受开关影响，始终链接式）：type='link' 直接跳转，否则回填指令 */
    menuLink(label: string, item: { type?: string; value: string }): string;
    /** 按全局开关渲染外显文字：on 返回 mqqapi 链接，off 返回原文本 */
    linkify(text: string, cmd: string): string;
  };
}

export interface Plugin {
  manifest: PluginManifest;
  onLoad?: (ctx: PluginContext) => void | Promise<void>;
  onUnload?: (ctx: PluginContext) => void | Promise<void>;
  onEnable?: (ctx: PluginContext) => void | Promise<void>;
  onDisable?: (ctx: PluginContext) => void | Promise<void>;
  methods?: Record<string, (...args: any[]) => any>;
}

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  enabled: boolean;
  loaded: boolean;
  hasError: boolean;
  errorMessage?: string;
  type: string;
  has_webui: boolean;
  approved?: boolean;
  owner?: string;
  fileType?: string;
}
