// 回复可视化编辑器 · 公共底座
//
// 目标：让「无内置 blocks 模板」的指令型插件（OpenID查询/讲笑话/群主/词典回复…）
// 也能在后台像测试菜单一样：真实回复预览 + 行级编辑（增/删/改/排序）+ 保存到服务器 +
// 一键写回插件源码。
//
// 核心抽象 ReplySpec：
//   spec = { version, desc, branches: [ { key, label, scope[], triggers[], lines[] } ] }
//   line 类型：
//     { t:'text', v:'静态文本，原样一行' }                          // 固定行
//     { t:'val',  k:'openid', fb:'(未获取到…)' }                    // 取值行（换行输出值，空则 fb）
//     { t:'row',  pre:'QQ号：', k:'qq', fb:'', hide:true }          // 同行动态拼 pre+值(+post)，空值 hide 则整行隐藏
//     { t:'row',  pre:'所属机器人：', k:'botName', post:'（{botId}）', fb:'', hide:false }
//     { t:'link', pre:'群 OpenID 请', label:'发送「群OpenID查询」', cmd:'群OpenID查询', post:'' }
//     { t:'blank' }                                                 // 空行
//   data 键（渲染时替换）：openid / qq / nick / botName / botId / gid / fallback…
//
// 存储：config 表 key = plugin.file-{name}.reply   （机器人无关，全 bot 共用一套回复模板）
// 生效次序：config 覆盖值 > 内置默认 SPEC_DEFAULT（代码内置，保证离线/无库也能跑）。
// 双落地：
//   A 保存到 config（改服务器配置，即时渲染生效）
//   B 「生成并写入源码」把默认 SPEC 常量固化进插件并让插件回复走渲染（代码随之改变，可撤销）

export interface ReplyLine {
  t: 'text' | 'val' | 'row' | 'link' | 'blank';
  v?: string;       // text: 静态整行；link: post 尾部无
  k?: string;       // val/row 取的数据键
  fb?: string;      // val/row 空值回退文本
  hide?: boolean;   // row：数据为空时整行隐藏
  pre?: string;     // row/link 前缀
  post?: string;    // row/link 后缀
  label?: string;   // link 显示文字
  cmd?: string;     // link 回填指令（mqqapi inlinecmd）
}

export interface ReplyBranch {
  key: string;        // 编辑器/渲染定位用唯一键，如 'self' / 'self@guild'
  label: string;      // 展示名：如「OpenID查询（群）」
  scope: string[];    // group / c2c / guild
  triggers: string[]; // 触发指令展示用（如 'OpenID查询'）
  lines: ReplyLine[];
}

export interface ReplySpec {
  name: string;       // 插件名
  version: string;    // spec 结构版本
  desc: string;       // 用途说明（源自 manifest，可被 meta 覆盖）
  branches: ReplyBranch[];
}

// 渲染期替换数据
export interface ReplyCtxData {
  openid?: string;
  qq?: string;
  nick?: string;
  botName?: string;
  botId?: string;
  gid?: string;
  [k: string]: string | undefined;
}

export function cfgKeyFor(name: string): string {
  return 'plugin.file-' + String(name).replace(/\.py$/i, '').replace(/\s+/g, '') + '.reply';
}

// —— 值文本（val/row 的取值）；数据缺失回退 fb ——
function valOf(d: ReplyCtxData, k: string | undefined, fb: string | undefined): string {
  const raw = k ? d[k] : undefined;
  if (raw !== undefined && String(raw).length) return String(raw);
  return fb !== undefined && String(fb).length ? String(fb) : '';
}

// 文本链路解析（供渲染前预览做高亮）：把 [label](mqqapi…) / [label](http…) 形态保留原样
export function linkifyMarkdown(label: string, cmd: string): string {
  const encoded = encodeURIComponent(cmd).replace(/%2F/gi, '/').replace(/%3A/gi, ':');
  return '[' + label + '](mqqapi://aio/inlinecmd?command=' + encoded + '&enter=false&reply=false)';
}

// 渲染期对整行再做 {key} 占位插值（支持 post/pre 引用其它数据键，如 post:'（{botId}）'）
function interpolate(s: string, d: ReplyCtxData): string {
  return String(s).replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, k: string) => {
    const v = d[k];
    return v !== undefined && String(v).length ? String(v) : '';
  });
}

// 渲染某分支 → 文本（多行）。renderer 供插件端与预览端共用逻辑。
export function renderBranch(branch: ReplyBranch, d: ReplyCtxData): string {
  const out: string[] = [];
  for (const ln of branch.lines || []) {
    switch (ln.t) {
      case 'blank':
        out.push('');
        break;
      case 'text':
        out.push(ln.v || '');
        break;
      case 'val': {
        const v = valOf(d, ln.k, ln.fb);
        out.push(interpolate(v, d));
        break;
      }
      case 'row': {
        const v = valOf(d, ln.k, ln.fb);
        if (!v && ln.hide) break;
        out.push(interpolate((ln.pre || '') + v + (ln.post || ''), d));
        break;
      }
      case 'link':
        out.push((ln.pre || '') + linkifyMarkdown(ln.label || '', ln.cmd || '') + (ln.post || ''));
        break;
    }
  }
  return out.join('\n');
}

// —— 预览用真实上下文（尽力而为：真值优先，缺省占位）——
// 说明：openid/qq/nick 属「触发用户」，与后台登录管理员未必一致；
// botName/botId 为编辑器当前选中机器人真实值；gid 无真实会话时给占位示例。
export function makePreviewData(botName?: string, botId?: string, extra?: Record<string, string>): ReplyCtxData {
  const bn = botName || '测试娱乐';
  const bid = botId || '1905248267';
  const d: ReplyCtxData = {
    openid: '3ADE9500A4F4074CD987367B5109857B',
    qq: '123456789',
    nick: '示例昵称',
    botName: bn,
    botId: bid,
    botShow: (bn && bn !== bid) ? bn + '（' + bid + '）' : bid,
    gid: '9C724B2EE6C3D4A18F1B2A5C7E8F9A0B',
    guildId: 'BOT_GUILD_' + bid.slice(-6),
    atOpenids: 'F6E1C9A82B3D4E5F60718293A4B5C6D7',
  };
  if (extra) Object.assign(d, extra);
  return d;
}

// —— 内置默认 ReplySpec 字典（首批样板；后续插件逐个补录）——
export function builtinReplySpec(name: string): ReplySpec | null {
  const map: Record<string, ReplySpec> = {
    'OpenID查询': {
      name: 'OpenID查询',
      version: '1.0.0',
      desc: '查询自己的 OpenID / 群 OpenID / 频道 OpenID，可 @ 其他用户查询其 OpenID（帮助多机器人 OpenID 对账与身份识别）',
      branches: [
        {
          key: 'self',
          label: 'OpenID查询（群/私聊/频道 · 自己）',
          scope: ['group', 'c2c', 'guild'],
          triggers: ['OpenID查询', '我的OpenID'],
          lines: [
            { t: 'text', v: '你的 OpenID：' },
            { t: 'val', k: 'openid', fb: '(未获取到，请确认已通过机器人所在群/私聊交互过)' },
            { t: 'row', pre: 'QQ号：', k: 'qq', hide: true },
            { t: 'row', pre: '昵称：', k: 'nick', hide: true },
            { t: 'row', pre: '所属机器人：', k: 'botShow', hide: true },
          ],
        },
        {
          key: 'self@group',
          label: 'OpenID查询（群内 · 追加群OpenID指引）',
          scope: ['group'],
          triggers: ['OpenID查询'],
          lines: [
            { t: 'text', v: '你的 OpenID：' },
            { t: 'val', k: 'openid', fb: '(未获取到，请确认已通过机器人所在群/私聊交互过)' },
            { t: 'row', pre: 'QQ号：', k: 'qq', hide: true },
            { t: 'row', pre: '昵称：', k: 'nick', hide: true },
            { t: 'row', pre: '所属机器人：', k: 'botShow', hide: true },
            { t: 'link', pre: '群 OpenID 请', label: '发送「群OpenID查询」', cmd: '群OpenID查询' },
          ],
        },
        {
          key: 'self@c2c',
          label: 'OpenID查询（私聊）',
          scope: ['c2c'],
          triggers: ['OpenID查询'],
          lines: [
            { t: 'text', v: '你的 OpenID：' },
            { t: 'val', k: 'openid', fb: '(未获取到)' },
            { t: 'row', pre: '昵称：', k: 'nick', hide: true },
            { t: 'row', pre: '所属机器人：', k: 'botShow', hide: true },
          ],
        },
        {
          key: 'self@guild',
          label: 'OpenID查询（频道）',
          scope: ['guild'],
          triggers: ['OpenID查询'],
          lines: [
            { t: 'text', v: '你的 OpenID：' },
            { t: 'val', k: 'openid', fb: '(未获取到)' },
            { t: 'row', pre: '昵称：', k: 'nick', hide: true },
            { t: 'row', pre: '所属机器人：', k: 'botShow', hide: true },
          ],
        },
        {
          key: 'at',
          label: 'OpenID查询 @用户（有人被 @）',
          scope: ['group'],
          triggers: ['OpenID查询 @xxx'],
          lines: [
            { t: 'text', v: '被 @ 用户们的 OpenID：' },
            { t: 'val', k: 'atOpenids' },
            { t: 'text', v: '（每个机器人下 OpenID 不同，请在使用对应机器人的群内查询）' },
          ],
        },
        {
          key: 'atEmpty',
          label: 'OpenID查询 @用户（未 @ 到人）',
          scope: ['group'],
          triggers: ['OpenID查询 @xxx'],
          lines: [
            { t: 'text', v: '请 @ 一个用户来查询他的 OpenID，例如：OpenID查询 @张三' },
          ],
        },
        {
          key: 'group',
          label: '群OpenID查询（群内）',
          scope: ['group'],
          triggers: ['群OpenID查询'],
          lines: [
            { t: 'text', v: '当前群 OpenID：' },
            { t: 'val', k: 'gid', fb: '(未获取到)' },
            { t: 'row', pre: '所属机器人：', k: 'botShow', hide: true },
            { t: 'link', pre: '你的 OpenID 请', label: '发送「OpenID查询」', cmd: 'OpenID查询' },
          ],
        },
        {
          key: 'group@guild',
          label: '频道OpenID查询（频道内）',
          scope: ['guild'],
          triggers: ['频道OpenID查询'],
          lines: [
            { t: 'text', v: '当前频道 OpenID：' },
            { t: 'val', k: 'gid', fb: '(未获取到)' },
            { t: 'row', pre: '频道ID：', k: 'guildId', hide: true },
            { t: 'row', pre: '所属机器人：', k: 'botShow', hide: true },
          ],
        },
      ],
    },
    },
    '群主': {
      name: '群主',
      version: '1.0.0',
      desc: '查询本群群主/管理员信息',
      branches: [
        {
          key: 'none',
          label: '未记录群主（无 owner 数据）',
          scope: ['group'],
          triggers: ['群主', '谁是群主', '查群主', '群主是谁', '群主信息'],
          lines: [
            { t: 'text', v: '👑 尚未记录本群群主信息。' },
            { t: 'text', v: '请先让群主在群内发一条消息，机器人记录后即可查询。' },
          ],
        },
        {
          key: 'owner',
          label: '群主/群管理员信息（owner 命中）',
          scope: ['group'],
          triggers: ['群主', '谁是群主', '查群主', '群主是谁', '群主信息'],
          lines: [
            { t: 'text', v: '👑 {role}信息' },
            { t: 'text', v: '━━━━━━━━━━━━━━' },
            { t: 'row', pre: '昵称：', k: 'nick', fb: '未知' },
            { t: 'row', pre: 'QQ：', k: 'qq', hide: true },
            { t: 'row', pre: '角色：', k: 'role' },
            { t: 'text', v: '━━━━━━━━━━━━━━' },
            { t: 'text', v: '发送「主菜单」查看更多' },
          ],
        },
      ],
    },
  };
  return map[name] || null;
}
