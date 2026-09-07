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

    '充值系统': {
  "name": "充值系统",
  "version": "1.0.0",
  "desc": "充值/充值菜单、查积分/余额、我的订单、我要充值、付款完成；主人：确认充值/取消充值/充值订单/充值说明",
  "branches": [
    {
      "key": "menu",
      "label": "充值菜单（充值/充值菜单）",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "充值",
        "充值菜单"
      ],
      "lines": [
        {
          "t": "text",
          "v": "充值套餐（1 积分=0.01 元）："
        },
        {
          "t": "val",
          "k": "packRows"
        },
        {
          "t": "blank"
        },
        {
          "t": "text",
          "v": "回复「我要充值<金额>」下单，例如：我要充值30"
        }
      ]
    },
    {
      "key": "orderNoPack",
      "label": "我要充值-没有该金额档位（提示可用档位）",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "我要充值<金额>"
      ],
      "lines": [
        {
          "t": "text",
          "v": "没有该金额档位，可用档位：{packs} 元"
        }
      ]
    },
    {
      "key": "orderPlaced",
      "label": "我要充值-下单成功（单号/金额/付款步骤）",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "我要充值<金额>"
      ],
      "lines": [
        {
          "t": "text",
          "v": "下单成功，单号：{no}"
        },
        {
          "t": "text",
          "v": "金额：{yuan} 元 → {points} 积分"
        },
        {
          "t": "blank"
        },
        {
          "t": "text",
          "v": "【付款步骤】"
        },
        {
          "t": "val",
          "k": "note"
        },
        {
          "t": "text",
          "v": "付款后请回复：付款完成 {no}"
        }
      ]
    },
    {
      "key": "balance",
      "label": "查积分/余额-当前积分与最近记录",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "查积分",
        "余额",
        "查余额"
      ],
      "lines": [
        {
          "t": "text",
          "v": "当前积分：{bal}"
        },
        {
          "t": "row",
          "pre": "最近记录：",
          "k": "ledger",
          "fb": "（暂无）"
        }
      ]
    },
    {
      "key": "myOrdersEmpty",
      "label": "我的订单-暂无订单",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "我的订单",
        "充值订单查询"
      ],
      "lines": [
        {
          "t": "text",
          "v": "你还没有充值订单。回复「我要充值30」试试。"
        }
      ]
    },
    {
      "key": "myOrders",
      "label": "我的订单-最近订单列表",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "我的订单",
        "充值订单查询"
      ],
      "lines": [
        {
          "t": "text",
          "v": "我的订单（最近 {count} 条）："
        },
        {
          "t": "val",
          "k": "rows"
        }
      ]
    },
    {
      "key": "paidNoOrder",
      "label": "付款完成-找不到订单",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "付款完成 <单号>"
      ],
      "lines": [
        {
          "t": "text",
          "v": "找不到订单：{no}"
        }
      ]
    },
    {
      "key": "paidNotYours",
      "label": "付款完成-该订单不属于你",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "付款完成 <单号>"
      ],
      "lines": [
        {
          "t": "text",
          "v": "该订单不属于你，请核对单号。"
        }
      ]
    },
    {
      "key": "paidStatus",
      "label": "付款完成-订单非待付款（当前状态）",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "付款完成 <单号>"
      ],
      "lines": [
        {
          "t": "text",
          "v": "订单当前状态：{status}"
        }
      ]
    },
    {
      "key": "paidOk",
      "label": "付款完成-已记录付款等待管理员确认",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "付款完成 <单号>"
      ],
      "lines": [
        {
          "t": "text",
          "v": "已记录付款，等待管理员确认。单号：{no}"
        },
        {
          "t": "text",
          "v": "管理员收到到账后会执行「确认充值 {no}」。"
        }
      ]
    },
    {
      "key": "ordersEmpty",
      "label": "充值订单列表-暂无任何订单（主人）",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "充值订单",
        "充值订单列表"
      ],
      "lines": [
        {
          "t": "text",
          "v": "暂无任何充值订单。"
        }
      ]
    },
    {
      "key": "orders",
      "label": "充值订单列表-最近20条含待确认与操作指引（主人）",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "充值订单",
        "充值订单列表"
      ],
      "lines": [
        {
          "t": "text",
          "v": "充值订单（最近 {count} 条，待确认 {pending}）："
        },
        {
          "t": "val",
          "k": "rows"
        },
        {
          "t": "blank"
        },
        {
          "t": "text",
          "v": "确认到账：确认充值 <单号>"
        },
        {
          "t": "text",
          "v": "取消订单：取消充值 <单号>"
        }
      ]
    },
    {
      "key": "confirmNoOrder",
      "label": "确认充值-找不到订单（主人）",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "确认充值 <单号>"
      ],
      "lines": [
        {
          "t": "text",
          "v": "找不到订单：{no}"
        }
      ]
    },
    {
      "key": "confirmDone",
      "label": "确认充值-订单已确认过无需重复（主人）",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "确认充值 <单号>"
      ],
      "lines": [
        {
          "t": "text",
          "v": "订单已确认过，无需重复：{no}"
        }
      ]
    },
    {
      "key": "confirmCancelled",
      "label": "确认充值-订单已取消无法确认（主人）",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "确认充值 <单号>"
      ],
      "lines": [
        {
          "t": "text",
          "v": "订单已取消，无法确认：{no}"
        }
      ]
    },
    {
      "key": "confirmOk",
      "label": "确认充值-成功并已通知对方（主人）",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "确认充值 <单号>"
      ],
      "lines": [
        {
          "t": "text",
          "v": "已确认 {no}（{yuan} 元 → +{points} 积分），并已通知对方。"
        }
      ]
    },
    {
      "key": "notifyCredited",
      "label": "充值到账-确认后对下单人的主动推送通知（主人触发）",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "确认充值 <单号>"
      ],
      "lines": [
        {
          "t": "text",
          "v": "充值到账！"
        },
        {
          "t": "text",
          "v": "单号：{no}"
        },
        {
          "t": "text",
          "v": "金额：{yuan} 元 → +{points} 积分"
        },
        {
          "t": "text",
          "v": "当前积分：{bal}"
        }
      ]
    },
    {
      "key": "cancelNoOrder",
      "label": "取消充值-找不到订单（主人）",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "取消充值 <单号>"
      ],
      "lines": [
        {
          "t": "text",
          "v": "找不到订单：{no}"
        }
      ]
    },
    {
      "key": "cancelBadStatus",
      "label": "取消充值-订单已完成或已取消（主人）",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "取消充值 <单号>"
      ],
      "lines": [
        {
          "t": "text",
          "v": "订单状态为 {status}，无需取消。"
        }
      ]
    },
    {
      "key": "cancelOk",
      "label": "取消充值-成功（主人）",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "取消充值 <单号>"
      ],
      "lines": [
        {
          "t": "text",
          "v": "已取消订单 {no}"
        }
      ]
    },
    {
      "key": "noteSet",
      "label": "充值说明-付款说明已更新（主人）",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "充值说明 <文案>"
      ],
      "lines": [
        {
          "t": "text",
          "v": "付款说明已更新。"
        }
      ]
    }
  ]
},
      '关键词回复': {
  "name": "关键词回复",
  "version": "1.0.0",
  "desc": "频道内发送含「帮助/help/菜单/menu」任意关键词的消息时，自动回复常用命令帮助文本",
  "branches": [
    {
      "key": "help",
      "label": "帮助文本（命中 帮助/help/菜单/menu）",
      "scope": [
        "guild"
      ],
      "triggers": [
        "帮助",
        "help",
        "菜单",
        "menu"
      ],
      "lines": [
        {
          "t": "text",
          "v": "你好！常用命令："
        },
        {
          "t": "text",
          "v": "- 签到"
        },
        {
          "t": "text",
          "v": "- 个人信息"
        },
        {
          "t": "text",
          "v": "- 词典"
        },
        {
          "t": "text",
          "v": "- 插件列表"
        }
      ]
    }
  ]
},
      '列表读取': {
  "name": "列表读取",
  "version": "1.0.0",
  "desc": "更新内容/版本列表/插件列表/广播列表 的表头、空态与错误文案（列表循环主体与尾行指引源码拼接，不走模板）",
  "branches": [
    {
      "key": "update_head",
      "label": "更新内容 · 成功表头（版本+来源）",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "更新内容"
      ],
      "lines": [
        {
          "t": "text",
          "v": "最新版本：v{version} {host}"
        }
      ]
    },
    {
      "key": "update_err",
      "label": "更新内容 · 读取云端失败",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "更新内容"
      ],
      "lines": [
        {
          "t": "text",
          "v": "读取云端更新配置失败：8091 不可用。"
        }
      ]
    },
    {
      "key": "rel_head",
      "label": "版本列表 · 成功表头（数量+来源）",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "版本列表"
      ],
      "lines": [
        {
          "t": "text",
          "v": "版本列表（{n} 个，最新 {n} 个） {host}"
        }
      ]
    },
    {
      "key": "rel_empty",
      "label": "版本列表 · 空态",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "版本列表"
      ],
      "lines": [
        {
          "t": "text",
          "v": "版本列表为空（仓库暂无 Release）。"
        }
      ]
    },
    {
      "key": "rel_err",
      "label": "版本列表 · 读取云端失败",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "版本列表"
      ],
      "lines": [
        {
          "t": "text",
          "v": "读取版本列表失败：8091 不可用。"
        }
      ]
    },
    {
      "key": "plug_head",
      "label": "插件列表 · 成功表头（数量+来源）",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "插件列表"
      ],
      "lines": [
        {
          "t": "text",
          "v": "插件 / 文档包（{n} 个） {host}"
        }
      ]
    },
    {
      "key": "plug_empty",
      "label": "插件列表 · 空态",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "插件列表"
      ],
      "lines": [
        {
          "t": "text",
          "v": "插件列表为空（site-config.json 未配置插件）。"
        }
      ]
    },
    {
      "key": "plug_err",
      "label": "插件列表 · 读取云端失败",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "插件列表"
      ],
      "lines": [
        {
          "t": "text",
          "v": "读取插件列表失败：GitHub Pages / raw / 8091 均不可用。"
        }
      ]
    },
    {
      "key": "bc_head",
      "label": "广播列表 · 成功表头（数量+来源）",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "广播列表"
      ],
      "lines": [
        {
          "t": "text",
          "v": "云端广播任务列表（{n} 条） {host}"
        }
      ]
    },
    {
      "key": "bc_empty",
      "label": "广播列表 · 空态",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "广播列表"
      ],
      "lines": [
        {
          "t": "text",
          "v": "云端暂无广播任务（broadcast.json 为空）。"
        }
      ]
    },
    {
      "key": "bc_err",
      "label": "广播列表 · 读取云端失败",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "广播列表"
      ],
      "lines": [
        {
          "t": "text",
          "v": "读取云端广播目录失败：GitHub Pages / raw / 8091 均不可用。"
        }
      ]
    },
    {
      "key": "err_gen",
      "label": "通用读取异常（fetch/解析抛错）",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "更新内容",
        "版本列表",
        "插件列表",
        "广播列表"
      ],
      "lines": [
        {
          "t": "text",
          "v": "读取失败：{msg}"
        }
      ]
    }
  ]
},
      '娱乐中心': {
  "name": "娱乐中心",
  "version": "3.0.0",
  "desc": "今日运势/骰子/猜拳/选择/随机数/吃什么/人品/仙逆/抽老婆老公/扫雷/木鱼/农场/钓鱼/笑话/猜数字 等功能的纯文本回复模板；按钮与主菜单渲染路径不动",
  "branches": [
    {
      "key": "fortune",
      "label": "今日运势/运势（结果）",
      "scope": [
        "group"
      ],
      "triggers": [
        "今日运势",
        "运势"
      ],
      "lines": [
        {
          "t": "text",
          "v": "🔮 今日运势"
        },
        {
          "t": "text",
          "v": "{fortune}"
        }
      ]
    },
    {
      "key": "dice",
      "label": "掷骰子（单颗骰）",
      "scope": [
        "group"
      ],
      "triggers": [
        "掷骰子",
        "掷骰子 1d6"
      ],
      "lines": [
        {
          "t": "text",
          "v": "🎲 掷出了 {point} 点"
        }
      ]
    },
    {
      "key": "diceMulti",
      "label": "掷骰子（多颗骰）",
      "scope": [
        "group"
      ],
      "triggers": [
        "掷骰子 2d6"
      ],
      "lines": [
        {
          "t": "text",
          "v": "🎲 掷骰结果"
        },
        {
          "t": "text",
          "v": "{rolls} = {point}"
        }
      ]
    },
    {
      "key": "rpsHelp",
      "label": "猜拳（空参/参数无效帮助）",
      "scope": [
        "group"
      ],
      "triggers": [
        "猜拳"
      ],
      "lines": [
        {
          "t": "text",
          "v": "✊ 猜拳"
        },
        {
          "t": "text",
          "v": "请发送：猜拳 石头/剪刀/布"
        }
      ]
    },
    {
      "key": "rps",
      "label": "猜拳（结果）",
      "scope": [
        "group"
      ],
      "triggers": [
        "猜拳 x"
      ],
      "lines": [
        {
          "t": "text",
          "v": "✊ 猜拳"
        },
        {
          "t": "text",
          "v": "你出：{you}"
        },
        {
          "t": "text",
          "v": "🤖 我出：{bot}"
        },
        {
          "t": "text",
          "v": "{result}"
        }
      ]
    },
    {
      "key": "chooseHelp",
      "label": "随机选择（选项不足帮助）",
      "scope": [
        "group"
      ],
      "triggers": [
        "选择"
      ],
      "lines": [
        {
          "t": "text",
          "v": "🎯 随机选择"
        },
        {
          "t": "text",
          "v": "格式：选择 选项1 选项2 选项3..."
        }
      ]
    },
    {
      "key": "choose",
      "label": "随机选择（结果）",
      "scope": [
        "group"
      ],
      "triggers": [
        "选择 x"
      ],
      "lines": [
        {
          "t": "text",
          "v": "🎯 随机选择结果"
        },
        {
          "t": "text",
          "v": "📌 {option}"
        },
        {
          "t": "blank"
        },
        {
          "t": "text",
          "v": "从 {count} 个选项中随机选出！"
        }
      ]
    },
    {
      "key": "random",
      "label": "随机数（结果）",
      "scope": [
        "group"
      ],
      "triggers": [
        "随机数"
      ],
      "lines": [
        {
          "t": "text",
          "v": "🔢 随机数"
        },
        {
          "t": "text",
          "v": "范围：{min} ~ {max}"
        },
        {
          "t": "text",
          "v": "结果：{num}"
        }
      ]
    },
    {
      "key": "food",
      "label": "今天吃什么（结果）",
      "scope": [
        "group"
      ],
      "triggers": [
        "今天吃什么"
      ],
      "lines": [
        {
          "t": "text",
          "v": "🍽 今天吃什么？"
        },
        {
          "t": "text",
          "v": "推荐：{food}"
        },
        {
          "t": "blank"
        },
        {
          "t": "text",
          "v": "快去吃吧！"
        }
      ]
    },
    {
      "key": "karma",
      "label": "今日人品（结果）",
      "scope": [
        "group"
      ],
      "triggers": [
        "今日人品"
      ],
      "lines": [
        {
          "t": "text",
          "v": "👤 今日人品值"
        },
        {
          "t": "text",
          "v": "分数：{score}/100"
        },
        {
          "t": "text",
          "v": "评价：{level}"
        }
      ]
    },
    {
      "key": "xianni",
      "label": "仙逆（修炼结果）",
      "scope": [
        "group"
      ],
      "triggers": [
        "仙逆"
      ],
      "lines": [
        {
          "t": "text",
          "v": "🧘 仙逆修炼"
        },
        {
          "t": "text",
          "v": "境界：{realm} (Lv.{realmLv})"
        },
        {
          "t": "text",
          "v": "经验：{exp}/{maxExp}"
        },
        {
          "t": "text",
          "v": "灵石：{stones}"
        },
        {
          "t": "text",
          "v": "修炼次数：{times}"
        },
        {
          "t": "blank"
        },
        {
          "t": "text",
          "v": "获得经验：+{expGain} 灵石：+{stoneGain}"
        }
      ]
    },
    {
      "key": "spouse",
      "label": "抽老婆/抽老公（结果）",
      "scope": [
        "group"
      ],
      "triggers": [
        "抽老婆",
        "抽老公"
      ],
      "lines": [
        {
          "t": "text",
          "v": "💕 今日{spouse}"
        },
        {
          "t": "text",
          "v": "你的{spouse}是：{name}！"
        },
        {
          "t": "text",
          "v": "💑 要好好珍惜哦~"
        }
      ]
    },
    {
      "key": "msActive",
      "label": "扫雷（游戏进行中提示）",
      "scope": [
        "group"
      ],
      "triggers": [
        "扫雷"
      ],
      "lines": [
        {
          "t": "text",
          "v": "💣 扫雷游戏正在进行中！"
        },
        {
          "t": "text",
          "v": "发送\"扫雷 1,1\" 翻开格子"
        }
      ]
    },
    {
      "key": "msStart",
      "label": "扫雷（开始）",
      "scope": [
        "group"
      ],
      "triggers": [
        "扫雷"
      ],
      "lines": [
        {
          "t": "text",
          "v": "💣 扫雷游戏开始！"
        },
        {
          "t": "text",
          "v": "{size}x{size} 共{mines}颗雷"
        },
        {
          "t": "text",
          "v": "发送\"扫雷 行,列\"翻开格子"
        }
      ]
    },
    {
      "key": "msNone",
      "label": "扫雷（无进行中游戏）",
      "scope": [
        "group"
      ],
      "triggers": [
        "扫雷 x"
      ],
      "lines": [
        {
          "t": "text",
          "v": "💣 没有进行中的游戏，发送\"扫雷\"开始"
        }
      ]
    },
    {
      "key": "msFormat",
      "label": "扫雷（坐标格式错误）",
      "scope": [
        "group"
      ],
      "triggers": [
        "扫雷 x"
      ],
      "lines": [
        {
          "t": "text",
          "v": "格式：扫雷 行,列"
        },
        {
          "t": "text",
          "v": "例如：扫雷 1,1"
        }
      ]
    },
    {
      "key": "msRange",
      "label": "扫雷（位置越界）",
      "scope": [
        "group"
      ],
      "triggers": [
        "扫雷 x"
      ],
      "lines": [
        {
          "t": "text",
          "v": "位置超出范围！"
        }
      ]
    },
    {
      "key": "msOpened",
      "label": "扫雷（已翻开提示）",
      "scope": [
        "group"
      ],
      "triggers": [
        "扫雷 x"
      ],
      "lines": [
        {
          "t": "text",
          "v": "这个格子已经翻开了！"
        }
      ]
    },
    {
      "key": "msBoom",
      "label": "扫雷（踩雷结束）",
      "scope": [
        "group"
      ],
      "triggers": [
        "扫雷 x"
      ],
      "lines": [
        {
          "t": "text",
          "v": "💥 踩到地雷！游戏结束！"
        }
      ]
    },
    {
      "key": "msWin",
      "label": "扫雷（胜利）",
      "scope": [
        "group"
      ],
      "triggers": [
        "扫雷 x"
      ],
      "lines": [
        {
          "t": "text",
          "v": "🎉 恭喜你赢了！所有安全格子已翻开！"
        }
      ]
    },
    {
      "key": "msNext",
      "label": "扫雷（继续·安全格进度）",
      "scope": [
        "group"
      ],
      "triggers": [
        "扫雷 x"
      ],
      "lines": [
        {
          "t": "text",
          "v": "继续扫雷！已翻开 {revealed}/{total} 个安全格子"
        }
      ]
    },
    {
      "key": "muyu",
      "label": "敲木鱼（结果）",
      "scope": [
        "group"
      ],
      "triggers": [
        "敲木鱼"
      ],
      "lines": [
        {
          "t": "text",
          "v": "🙏 敲木鱼"
        },
        {
          "t": "text",
          "v": "{phrase} (+{gain}功德)"
        },
        {
          "t": "text",
          "v": "总功德：{merit}"
        },
        {
          "t": "text",
          "v": "敲击次数：{count}"
        }
      ]
    },
    {
      "key": "farmPlant",
      "label": "开心农场（种下）",
      "scope": [
        "group"
      ],
      "triggers": [
        "开心农场"
      ],
      "lines": [
        {
          "t": "text",
          "v": "🌾 开心农场"
        },
        {
          "t": "text",
          "v": "你种下了 {crop}！"
        },
        {
          "t": "text",
          "v": "等待10秒收获..."
        }
      ]
    },
    {
      "key": "farmWait",
      "label": "开心农场（生长中）",
      "scope": [
        "group"
      ],
      "triggers": [
        "开心农场"
      ],
      "lines": [
        {
          "t": "text",
          "v": "🌾 作物还在生长中..."
        },
        {
          "t": "text",
          "v": "还需 {wait} 秒"
        }
      ]
    },
    {
      "key": "farmHarvest",
      "label": "开心农场（收获）",
      "scope": [
        "group"
      ],
      "triggers": [
        "开心农场"
      ],
      "lines": [
        {
          "t": "text",
          "v": "🌾 收获成功！"
        },
        {
          "t": "text",
          "v": "获得 {gain} 金币！"
        },
        {
          "t": "text",
          "v": "当前金币：{coins}"
        },
        {
          "t": "text",
          "v": "已种植：{times} 次"
        }
      ]
    },
    {
      "key": "fish",
      "label": "去钓鱼（结果）",
      "scope": [
        "group"
      ],
      "triggers": [
        "去钓鱼"
      ],
      "lines": [
        {
          "t": "text",
          "v": "🎣 去钓鱼"
        },
        {
          "t": "text",
          "v": "钓到了：{fish}"
        },
        {
          "t": "text",
          "v": "卖了 {value} 金币！"
        },
        {
          "t": "text",
          "v": "总金币：{coins}"
        },
        {
          "t": "text",
          "v": "总收获：{count} 条"
        }
      ]
    },
    {
      "key": "joke",
      "label": "笑话/讲笑话（结果）",
      "scope": [
        "group"
      ],
      "triggers": [
        "笑话",
        "讲笑话"
      ],
      "lines": [
        {
          "t": "text",
          "v": "😄 讲笑话"
        },
        {
          "t": "text",
          "v": "━━━━━━━━━━"
        },
        {
          "t": "text",
          "v": "{joke}"
        }
      ]
    },
    {
      "key": "guessStart",
      "label": "猜数字（新局开始）",
      "scope": [
        "group"
      ],
      "triggers": [
        "猜数字"
      ],
      "lines": [
        {
          "t": "text",
          "v": "🎯 猜数字游戏"
        },
        {
          "t": "text",
          "v": "我已经想好一个 1-100 之间的数字！"
        },
        {
          "t": "text",
          "v": "发送\"猜数字 数字\"开始猜吧！"
        },
        {
          "t": "text",
          "v": "例：猜数字 50"
        }
      ]
    },
    {
      "key": "guessOver",
      "label": "猜数字（上局结束·再来一局）",
      "scope": [
        "group"
      ],
      "triggers": [
        "猜数字"
      ],
      "lines": [
        {
          "t": "text",
          "v": "🎯 上一局答案：{answer}"
        },
        {
          "t": "text",
          "v": "发送\"猜数字 数字\"或点击按钮再来一局"
        }
      ]
    },
    {
      "key": "guessPlaying",
      "label": "猜数字（进行中状态）",
      "scope": [
        "group"
      ],
      "triggers": [
        "猜数字"
      ],
      "lines": [
        {
          "t": "text",
          "v": "🎯 猜数字进行中"
        },
        {
          "t": "text",
          "v": "目标在 1-100 之间，已猜 {tries} 次"
        },
        {
          "t": "text",
          "v": "发送\"猜数字 数字\"继续！"
        }
      ]
    },
    {
      "key": "guessInvalid",
      "label": "猜数字（非法输入）",
      "scope": [
        "group"
      ],
      "triggers": [
        "猜数字 x"
      ],
      "lines": [
        {
          "t": "text",
          "v": "❌ 请输入 1-100 之间的整数"
        },
        {
          "t": "text",
          "v": "例：猜数字 50"
        }
      ]
    },
    {
      "key": "guessWin",
      "label": "猜数字（猜中）",
      "scope": [
        "group"
      ],
      "triggers": [
        "猜数字 x"
      ],
      "lines": [
        {
          "t": "text",
          "v": "🎉 恭喜猜中！答案就是 {answer}"
        },
        {
          "t": "text",
          "v": "你一共猜了 {tries} 次！"
        }
      ]
    },
    {
      "key": "guessHint",
      "label": "猜数字（大小提示）",
      "scope": [
        "group"
      ],
      "triggers": [
        "猜数字 x"
      ],
      "lines": [
        {
          "t": "text",
          "v": "🎯 猜数字"
        },
        {
          "t": "text",
          "v": "你猜 {guess} → {hint}"
        },
        {
          "t": "text",
          "v": "已猜 {tries} 次，继续发送\"猜数字 数字\""
        }
      ]
    },
    {
      "key": "fallback",
      "label": "未知指令",
      "scope": [
        "group"
      ],
      "triggers": [
        "其他"
      ],
      "lines": [
        {
          "t": "text",
          "v": "❓ 未知指令"
        },
        {
          "t": "text",
          "v": "发送\"娱乐功能\"查看所有娱乐项目"
        }
      ]
    }
  ]
},
      '实用工具': {
  "name": "实用工具",
  "version": "1.2.1",
  "desc": "每日备注/每日打卡/设置昵称/查询天气（帮助与失败提示）等纯文本回复模板；个人信息头像卡与天气图片保持富媒体原样",
  "branches": [
    {
      "key": "noteView",
      "label": "每日备注（查看·今日已有内容）",
      "scope": [
        "group"
      ],
      "triggers": [
        "每日备注"
      ],
      "lines": [
        {
          "t": "text",
          "v": "📝 今日备注"
        },
        {
          "t": "text",
          "v": "{note}"
        }
      ]
    },
    {
      "key": "noteEmpty",
      "label": "每日备注（查看·今日暂无备注）",
      "scope": [
        "group"
      ],
      "triggers": [
        "每日备注"
      ],
      "lines": [
        {
          "t": "text",
          "v": "📝 今日暂无备注"
        },
        {
          "t": "text",
          "v": "发送\"每日备注 内容\" 记录今天"
        }
      ]
    },
    {
      "key": "noteSaveEmpty",
      "label": "每日备注（保存·内容为空提示）",
      "scope": [
        "group"
      ],
      "triggers": [
        "每日备注 x"
      ],
      "lines": [
        {
          "t": "text",
          "v": "📝 请填写备注内容"
        },
        {
          "t": "text",
          "v": "格式：每日备注 今天的心情/日记"
        }
      ]
    },
    {
      "key": "noteSaved",
      "label": "每日备注（保存成功）",
      "scope": [
        "group"
      ],
      "triggers": [
        "每日备注 x"
      ],
      "lines": [
        {
          "t": "text",
          "v": "✅ 今日备注已保存！"
        },
        {
          "t": "text",
          "v": "📝 {note}"
        }
      ]
    },
    {
      "key": "checkinDup",
      "label": "每日打卡（今日已打卡）",
      "scope": [
        "group"
      ],
      "triggers": [
        "每日打卡"
      ],
      "lines": [
        {
          "t": "text",
          "v": "✅ 今天已经打过卡了！"
        },
        {
          "t": "text",
          "v": "明天再来吧~"
        }
      ]
    },
    {
      "key": "checkinOk",
      "label": "每日打卡（成功+points/连续/加奖行）",
      "scope": [
        "group"
      ],
      "triggers": [
        "每日打卡"
      ],
      "lines": [
        {
          "t": "text",
          "v": "✅ 打卡成功！"
        },
        {
          "t": "text",
          "v": "获得积分：+{points}"
        },
        {
          "t": "text",
          "v": "累计积分：{total}"
        },
        {
          "t": "text",
          "v": "连续打卡：{streak} 天"
        },
        {
          "t": "row",
          "k": "reward7",
          "hide": true
        },
        {
          "t": "row",
          "k": "reward30",
          "hide": true
        }
      ]
    },
    {
      "key": "nickView",
      "label": "设置昵称（查看当前昵称）",
      "scope": [
        "group"
      ],
      "triggers": [
        "设置昵称"
      ],
      "lines": [
        {
          "t": "text",
          "v": "✏️ 当前昵称：{nick}"
        },
        {
          "t": "text",
          "v": "发送\"设置昵称 新昵称\" 修改"
        }
      ]
    },
    {
      "key": "nickSet",
      "label": "设置昵称（修改成功）",
      "scope": [
        "group"
      ],
      "triggers": [
        "设置昵称 x"
      ],
      "lines": [
        {
          "t": "text",
          "v": "✅ 昵称已设置为：{nick}"
        }
      ]
    },
    {
      "key": "nickErr",
      "label": "设置昵称（空/超长错误）",
      "scope": [
        "group"
      ],
      "triggers": [
        "设置昵称 x"
      ],
      "lines": [
        {
          "t": "text",
          "v": "昵称长度1-20个字符"
        }
      ]
    },
    {
      "key": "weatherHelp",
      "label": "查询天气（帮助句）",
      "scope": [
        "group"
      ],
      "triggers": [
        "查询天气",
        "天气"
      ],
      "lines": [
        {
          "t": "text",
          "v": "🌤 查询天气"
        },
        {
          "t": "text",
          "v": "格式：查询天气 城市名"
        },
        {
          "t": "text",
          "v": "例：查询天气 北京"
        }
      ]
    },
    {
      "key": "weatherCityEmpty",
      "label": "查询天气（城市为空提示）",
      "scope": [
        "group"
      ],
      "triggers": [
        "查询天气 x"
      ],
      "lines": [
        {
          "t": "text",
          "v": "🌤 请填写城市名"
        },
        {
          "t": "text",
          "v": "格式：查询天气 城市名"
        }
      ]
    },
    {
      "key": "weatherFail",
      "label": "天气文本兜底（接口无返回）",
      "scope": [
        "group"
      ],
      "triggers": [
        "查询天气 x"
      ],
      "lines": [
        {
          "t": "text",
          "v": "❌ 查询失败，请检查城市名"
        }
      ]
    },
    {
      "key": "weatherErr",
      "label": "天气文本兜底（接口异常）",
      "scope": [
        "group"
      ],
      "triggers": [
        "查询天气 x"
      ],
      "lines": [
        {
          "t": "text",
          "v": "❌ 天气查询失败：{msg}"
        }
      ]
    },
    {
      "key": "fallback",
      "label": "未知指令",
      "scope": [
        "group"
      ],
      "triggers": [
        "其他"
      ],
      "lines": [
        {
          "t": "text",
          "v": "❓ 未知指令"
        },
        {
          "t": "text",
          "v": "发送\"实用功能\"查看所有实用工具"
        }
      ]
    }
  ]
},
      '签到系统': {
  "name": "签到系统",
  "version": "2.1.1",
  "desc": "每日签到、补签、积分与排行榜回复（排行行项由代码动态追加，模板覆盖表头）",
  "branches": [
    {
      "key": "disabled",
      "label": "系统停用（后台开关 switch.checkin=0）",
      "scope": [
        "group"
      ],
      "triggers": [
        "签到",
        "补签",
        "签到排行",
        "积分排行"
      ],
      "lines": [
        {
          "t": "text",
          "v": "签到系统已停用"
        }
      ]
    },
    {
      "key": "already",
      "label": "签到-今天已签过，明天再来",
      "scope": [
        "group"
      ],
      "triggers": [
        "签到"
      ],
      "lines": [
        {
          "t": "text",
          "v": "你今天已经签过到了，明天再来吧！"
        }
      ]
    },
    {
      "key": "ok",
      "label": "签到成功（bonus 为满月/连续天数/幸运暴击追加文本）",
      "scope": [
        "group"
      ],
      "triggers": [
        "签到"
      ],
      "lines": [
        {
          "t": "text",
          "v": "签到成功！+ {points} 积分{bonus}\n累计积分：{total} | 连续签到：{streak}天"
        }
      ]
    },
    {
      "key": "makeup-already",
      "label": "补签-今天已签过，无需补签",
      "scope": [
        "group"
      ],
      "triggers": [
        "补签"
      ],
      "lines": [
        {
          "t": "text",
          "v": "你今天已经签到过了，无需补签。"
        }
      ]
    },
    {
      "key": "makeup-yesterday",
      "label": "补签-昨天已签到",
      "scope": [
        "group"
      ],
      "triggers": [
        "补签"
      ],
      "lines": [
        {
          "t": "text",
          "v": "昨天已签到，无需补签。发送\"签到\"即可。"
        }
      ]
    },
    {
      "key": "makeup-low",
      "label": "补签-积分不足（消耗30）",
      "scope": [
        "group"
      ],
      "triggers": [
        "补签"
      ],
      "lines": [
        {
          "t": "text",
          "v": "补签需要消耗30积分，你的积分不足（当前：{total}）。"
        }
      ]
    },
    {
      "key": "makeup-ok",
      "label": "补签成功（消耗30积分，恢复连续天数）",
      "scope": [
        "group"
      ],
      "triggers": [
        "补签"
      ],
      "lines": [
        {
          "t": "text",
          "v": "补签成功！消耗30积分，连续签到恢复为{streak}天。\n剩余积分：{total}"
        }
      ]
    },
    {
      "key": "rank-empty",
      "label": "排行榜-暂无签到数据",
      "scope": [
        "group"
      ],
      "triggers": [
        "签到排行",
        "积分排行"
      ],
      "lines": [
        {
          "t": "text",
          "v": "暂无签到数据，发送\"签到\"成为第一名！"
        }
      ]
    },
    {
      "key": "rank-top",
      "label": "排行榜-表头 TOP{topN}（名次行由代码动态追加，不入模板）",
      "scope": [
        "group"
      ],
      "triggers": [
        "签到排行",
        "积分排行"
      ],
      "lines": [
        {
          "t": "text",
          "v": "积分排行榜 TOP{topN}："
        }
      ]
    }
  ]
},
      '绑定管理': {
  "name": "绑定管理",
  "version": "1.1.0",
  "desc": "绑定QQ：OpenID 绑定到 QQ 号；绑定QQ群：把当前群绑定到数字群号；绑定用户：群主/管理员给指定用户绑定（QQ+OpenID）",
  "branches": [
    {
      "key": "unbind-ok",
      "label": "解绑成功（解绑QQ/解绑绑定）",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "解绑QQ",
        "解绑qq",
        "解绑绑定"
      ],
      "lines": [
        {
          "t": "text",
          "v": "✅ 已解绑当前 OpenID 的 QQ 绑定{botTag}"
        }
      ]
    },
    {
      "key": "unbind-fail",
      "label": "解绑失败（含无解绑权限/未绑定）",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "解绑QQ",
        "解绑qq",
        "解绑绑定"
      ],
      "lines": [
        {
          "t": "text",
          "v": "❌ 解绑失败：{err}"
        }
      ]
    },
    {
      "key": "bindUser-help",
      "label": "绑定指定用户 · 帮助说明",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "绑定用户",
        "绑定指定用户"
      ],
      "lines": [
        {
          "t": "text",
          "v": "👤 绑定指定用户"
        },
        {
          "t": "text",
          "v": "发送「绑定用户 QQ号 OpenID」"
        },
        {
          "t": "row",
          "pre": "例：绑定用户 123456789 ",
          "k": "openid",
          "fb": "abc...DEF"
        },
        {
          "t": "text",
          "v": "仅群主/管理员可操作，用于帮成员绑定身份（成员不便操作时使用）"
        },
        {
          "t": "link",
          "pre": "OpenID 可通过成员",
          "label": "发送「OpenID查询」",
          "cmd": "OpenID查询",
          "post": "获取"
        }
      ]
    },
    {
      "key": "bindUser-badqq",
      "label": "绑定指定用户 · QQ号格式错误",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "绑定用户 QQ号 OpenID"
      ],
      "lines": [
        {
          "t": "text",
          "v": "❌ QQ 号应为 5-11 位数字，请检查后重试"
        }
      ]
    },
    {
      "key": "bindUser-badoid",
      "label": "绑定指定用户 · OpenID 格式错误",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "绑定用户 QQ号 OpenID"
      ],
      "lines": [
        {
          "t": "text",
          "v": "❌ OpenID 格式不正确，请通过「OpenID查询」获取完整 OpenID"
        }
      ]
    },
    {
      "key": "bindUser-denied",
      "label": "绑定指定用户 · 非群主/管理员被拒",
      "scope": [
        "group"
      ],
      "triggers": [
        "绑定用户 QQ号 OpenID"
      ],
      "lines": [
        {
          "t": "text",
          "v": "🔒 仅群主/管理员可绑定指定用户"
        }
      ]
    },
    {
      "key": "bindUser-ok",
      "label": "绑定指定用户 · 成功",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "绑定用户 QQ号 OpenID"
      ],
      "lines": [
        {
          "t": "text",
          "v": "✅ 绑定成功"
        },
        {
          "t": "row",
          "pre": "OpenID：",
          "k": "uoid"
        },
        {
          "t": "text",
          "v": "QQ：{uqq}{botTag}"
        },
        {
          "t": "text",
          "v": "该用户已可跨机器人识别身份"
        }
      ]
    },
    {
      "key": "bindUser-fail",
      "label": "绑定指定用户 · 引擎绑定失败",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "绑定用户 QQ号 OpenID"
      ],
      "lines": [
        {
          "t": "text",
          "v": "❌ 绑定失败：{err}"
        }
      ]
    },
    {
      "key": "bindQQ-help",
      "label": "绑定QQ · 帮助说明",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "绑定QQ",
        "绑定qq"
      ],
      "lines": [
        {
          "t": "text",
          "v": "📱 绑定QQ"
        },
        {
          "t": "text",
          "v": "发送「绑定QQ 你的QQ号」"
        },
        {
          "t": "text",
          "v": "例：绑定QQ 123456789"
        },
        {
          "t": "text",
          "v": "绑定后可跨机器人识别你的身份"
        },
        {
          "t": "text",
          "v": "需要解绑发「解绑QQ」"
        }
      ]
    },
    {
      "key": "bindQQ-badqq",
      "label": "绑定QQ · QQ号格式错误",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "绑定QQ 你的QQ号"
      ],
      "lines": [
        {
          "t": "text",
          "v": "❌ QQ 号应为 5-11 位数字，请检查后重试"
        }
      ]
    },
    {
      "key": "bindQQ-ok",
      "label": "绑定QQ · 成功（含 OpenID查询 指引链接）",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "绑定QQ 你的QQ号"
      ],
      "lines": [
        {
          "t": "text",
          "v": "✅ 绑定成功"
        },
        {
          "t": "row",
          "pre": "QQ：",
          "k": "qq"
        },
        {
          "t": "row",
          "pre": "昵称：",
          "k": "nickname",
          "fb": "未知",
          "post": "{botTag}"
        },
        {
          "t": "link",
          "label": "发送「OpenID查询」",
          "cmd": "OpenID查询",
          "post": "可查看绑定信息"
        }
      ]
    },
    {
      "key": "bindQQ-fail",
      "label": "绑定QQ · 引擎绑定失败",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "绑定QQ 你的QQ号"
      ],
      "lines": [
        {
          "t": "text",
          "v": "❌ 绑定失败：{err}"
        }
      ]
    },
    {
      "key": "bindGroup-denied-help",
      "label": "绑定QQ群入口 · 非群主/管理员被拒（含操作指引）",
      "scope": [
        "group"
      ],
      "triggers": [
        "绑定QQ群",
        "绑定qq群"
      ],
      "lines": [
        {
          "t": "text",
          "v": "🔒 仅群主/管理员或机器人管理员可绑定QQ群"
        },
        {
          "t": "text",
          "v": "发送「绑定QQ群 群号」绑定当前群到数字群号"
        }
      ]
    },
    {
      "key": "bindGroup-help",
      "label": "绑定QQ群 · 帮助说明",
      "scope": [
        "group"
      ],
      "triggers": [
        "绑定QQ群",
        "绑定qq群"
      ],
      "lines": [
        {
          "t": "text",
          "v": "👥 绑定QQ群"
        },
        {
          "t": "text",
          "v": "发送「绑定QQ群 群号」"
        },
        {
          "t": "text",
          "v": "例：绑定QQ群 123456789"
        },
        {
          "t": "text",
          "v": "绑定后群成员行自动带群号"
        }
      ]
    },
    {
      "key": "bindGroup-denied",
      "label": "绑定QQ群带群号 · 非群主/管理员被拒",
      "scope": [
        "group"
      ],
      "triggers": [
        "绑定QQ群 群号"
      ],
      "lines": [
        {
          "t": "text",
          "v": "🔒 仅群主/管理员或机器人管理员可绑定QQ群"
        }
      ]
    },
    {
      "key": "bindGroup-ok",
      "label": "绑定QQ群 · 成功",
      "scope": [
        "group"
      ],
      "triggers": [
        "绑定QQ群 群号"
      ],
      "lines": [
        {
          "t": "text",
          "v": "✅ 群绑定成功"
        },
        {
          "t": "row",
          "pre": "群 OpenID：",
          "k": "gid"
        },
        {
          "t": "text",
          "v": "群号：{gnum}{botTag}"
        },
        {
          "t": "text",
          "v": "群成员行已自动关联该群号"
        }
      ]
    },
    {
      "key": "bindGroup-fail",
      "label": "绑定QQ群 · 引擎绑定失败",
      "scope": [
        "group"
      ],
      "triggers": [
        "绑定QQ群 群号"
      ],
      "lines": [
        {
          "t": "text",
          "v": "❌ 绑定失败：{err}"
        }
      ]
    }
  ]
},
      '群信息': {
  "name": "群信息",
  "version": "1.0.0",
  "desc": "群活跃统计看板的生成过程提示与失败/不支持降级文案（看板图片本身由服务端渲染，不走模板）",
  "branches": [
    {
      "key": "generating",
      "label": "正在生成看板（生成前的过程提示）",
      "scope": [
        "group"
      ],
      "triggers": [
        "群信息",
        "群活跃",
        "群数据",
        "活跃统计"
      ],
      "lines": [
        {
          "t": "text",
          "v": "⏳ 正在生成群活跃统计看板..."
        }
      ]
    },
    {
      "key": "failed",
      "label": "看板生成失败（结果提示）",
      "scope": [
        "group"
      ],
      "triggers": [
        "群信息",
        "群活跃",
        "群数据",
        "活跃统计"
      ],
      "lines": [
        {
          "t": "text",
          "v": "❌ 群信息看板生成失败，请查看运行记录"
        }
      ]
    },
    {
      "key": "unsupported",
      "label": "服务端不支持看板（降级提示）",
      "scope": [
        "group"
      ],
      "triggers": [
        "群信息",
        "群活跃",
        "群数据",
        "活跃统计"
      ],
      "lines": [
        {
          "t": "text",
          "v": "当前版本不支持群信息看板，请升级服务端"
        }
      ]
    }
  ]
},
      '菜单模式': {
  "name": "菜单模式",
  "version": "1.1.0",
  "desc": "菜单模式/文字外显模式的查看、切换确认短文案与权限拒绝文案（文字指令清单 TEXT_MENU 不走模板）",
  "branches": [
    {
      "key": "mode",
      "label": "「菜单模式」查看当前模式（群内）",
      "scope": [
        "group"
      ],
      "triggers": [
        "菜单模式"
      ],
      "lines": [
        {
          "t": "text",
          "v": "🔀 菜单模式"
        },
        {
          "t": "text",
          "v": "━━━━━━━━━━━━━━"
        },
        {
          "t": "text",
          "v": "当前全局菜单模式：{modeName}"
        },
        {
          "t": "link",
          "pre": "仅群主/群管理可切换：",
          "label": "发送「切换文字菜单」",
          "cmd": "切换文字菜单",
          "post": "或「切换图片菜单」。"
        }
      ]
    },
    {
      "key": "mode@c2c",
      "label": "「菜单模式」查看当前模式（私聊）",
      "scope": [
        "c2c"
      ],
      "triggers": [
        "菜单模式"
      ],
      "lines": [
        {
          "t": "text",
          "v": "🔀 菜单模式"
        },
        {
          "t": "text",
          "v": "━━━━━━━━━━━━━━"
        },
        {
          "t": "text",
          "v": "当前全局菜单模式：{modeName}"
        },
        {
          "t": "link",
          "label": "发送「切换文字菜单」",
          "cmd": "切换文字菜单",
          "post": "或「切换图片菜单」即可切换。"
        }
      ]
    },
    {
      "key": "linkMode",
      "label": "「文字外显 / 文字外显模式」查看当前外显模式",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "文字外显",
        "文字外显模式"
      ],
      "lines": [
        {
          "t": "text",
          "v": "🔗 文字外显模式"
        },
        {
          "t": "text",
          "v": "━━━━━━━━━━━━━━"
        },
        {
          "t": "text",
          "v": "当前：{lmName}"
        },
        {
          "t": "text",
          "v": "发送「文字外显 开」→ 所有插件菜单入口渲染为链接式"
        },
        {
          "t": "text",
          "v": "发送「文字外显 关」→ 所有插件菜单入口渲染为纯文本"
        },
        {
          "t": "text",
          "v": "开启后点击链接，指令会填入输入框，点发送即可使用"
        }
      ]
    },
    {
      "key": "linkOn",
      "label": "「文字外显 开/链接/on」切换成功确认",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "文字外显 开",
        "文字外显 链接",
        "文字外显 on"
      ],
      "lines": [
        {
          "t": "text",
          "v": "🔗 已开启文字外显链接模式：所有插件菜单入口渲染为 mqqapi 链接，点击后指令回填输入框。发送「新版菜单」查看效果。"
        }
      ]
    },
    {
      "key": "linkOff",
      "label": "「文字外显 关/文本/off」切换成功确认",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "文字外显 关",
        "文字外显 文本",
        "文字外显 off"
      ],
      "lines": [
        {
          "t": "text",
          "v": "📝 已关闭文字外显链接模式：所有插件菜单入口渲染为纯文本。"
        }
      ]
    },
    {
      "key": "permLink",
      "label": "切换文字外显模式权限拒绝",
      "scope": [
        "group"
      ],
      "triggers": [
        "文字外显 开",
        "文字外显 关",
        "文字外显 链接",
        "文字外显 文本"
      ],
      "lines": [
        {
          "t": "text",
          "v": "⛔ 权限不足：切换文字外显模式仅群主/群管理可操作！"
        }
      ]
    },
    {
      "key": "menuImage",
      "label": "「切换图片菜单 / 菜单模式 图片」切换成功确认",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "切换图片菜单",
        "菜单模式 图片"
      ],
      "lines": [
        {
          "t": "text",
          "v": "🖼 已切换为图片模式：菜单将以图片卡片发送。发送「新版菜单」查看效果。"
        }
      ]
    },
    {
      "key": "menuText",
      "label": "「切换文字菜单 / 菜单模式 文字」切换成功确认",
      "scope": [
        "group",
        "c2c"
      ],
      "triggers": [
        "切换文字菜单",
        "菜单模式 文字"
      ],
      "lines": [
        {
          "t": "text",
          "v": "🔤 已切换为文字模式：菜单将以按钮/文字发送。发送「新版菜单」查看效果。"
        }
      ]
    },
    {
      "key": "permMenu",
      "label": "切换菜单模式权限拒绝",
      "scope": [
        "group"
      ],
      "triggers": [
        "切换文字菜单",
        "切换图片菜单",
        "菜单模式 文字",
        "菜单模式 图片"
      ],
      "lines": [
        {
          "t": "text",
          "v": "⛔ 权限不足：切换菜单模式仅群主/群管理可操作！"
        }
      ]
    }
  ]
},
      '讲笑话': {
  "name": "讲笑话",
  "version": "1.0.1",
  "desc": "随机讲一个内置笑话并以语音条朗读（{joke} 为随机笑话内容）",
  "branches": [
    {
      "key": "joke",
      "label": "笑话文字卡片（{joke} 为随机笑话，语音条发送逻辑不受模板影响）",
      "scope": [
        "group"
      ],
      "triggers": [
        "来段笑话",
        "讲个笑话",
        "讲个段子",
        "来段段子",
        "语音笑话",
        "笑话语音"
      ],
      "lines": [
        {
          "t": "text",
          "v": "😄 讲笑话"
        },
        {
          "t": "text",
          "v": "━━━━━━━━━━━━━━"
        },
        {
          "t": "text",
          "v": "{joke}"
        },
        {
          "t": "text",
          "v": "━━━━━━━━━━━━━━"
        },
        {
          "t": "text",
          "v": "🎤 语音版同步播放中…"
        }
      ]
    },
    {
      "key": "tts-fail",
      "label": "语音生成失败回退提示（紧随文字卡片后发送）",
      "scope": [
        "group"
      ],
      "triggers": [
        "来段笑话",
        "讲个笑话",
        "讲个段子",
        "来段段子",
        "语音笑话",
        "笑话语音"
      ],
      "lines": [
        {
          "t": "text",
          "v": "⚠️ 语音生成失败，已改为文字版，请查看上方笑话内容。"
        }
      ]
    }
  ]
},
      '问候插件': {
  "name": "问候插件",
  "version": "1.0.0",
  "desc": "自动回复用户的问候消息，{greeting} 由 JS 按当前小时注入（夜深了/早上好/下午好/晚上好）",
  "branches": [
    {
      "key": "greet",
      "label": "问候自动回复（{greeting} 由 JS 按小时注入）",
      "scope": [
        "group",
        "c2c",
        "guild"
      ],
      "triggers": [
        "你好",
        "hello",
        "hi",
        "嗨",
        "在吗",
        "早上好",
        "下午好",
        "晚上好"
      ],
      "lines": [
        {
          "t": "text",
          "v": "{greeting}！有什么可以帮助你的吗？"
        }
      ]
    }
  ]
},
  };
    return map[name] || null;
}
