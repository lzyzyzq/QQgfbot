// 娱乐群管 lzyqzb 引擎离线冒烟
const os=require('os');process.env.LZYQZB_DATA_DIR = os.tmpdir() + '/lzyqzb-smoke-' + process.pid;
const path = require('path');
const { EventEmitter } = require('events');
const bus = new EventEmitter();

const sent = [];
const kb = [];
const deleted = [];
const BOUND = '1234567890ABCDEF1234567890ABCDEF';
const bot = {
  sendGroupMessage: async (g, c) => { sent.push({ g, c }); },
  sendMarkdownGroup: async (g, m) => { sent.push({ g, m: 'md:' + m }); },
  sendKeyboardGroup: async (g, k) => { kb.push({ g, rows: k && k.rows }); },
  deleteMessage: async (g, m) => { deleted.push({ g, m }); },
  muteMember: async (g, m, d) => { sent.push({ act: 'mute', d }); },
  unmuteMember: async (g, m) => { sent.push({ act: 'unmute' }); },
  kickMember: async () => { sent.push({ act: 'kick' }); },
  muteAll: async () => { sent.push({ act: 'muteall' }); },
  getStatus: async () => 'ok',
};
const ctx = {
  config: {},
  bot,
  eventBus: bus,
  engine: { resolveOpenidByQq: (qq) => (String(qq) === '12345678' ? BOUND : null) },
  link: { mode: () => 'on', linkify: (t, cmd) => '[' + t + '](mqqapi://aio/%69nlinecmd?command=' + encodeURIComponent(cmd) + '&enter=false&reply=false)' },
  logger: { info: (...a) => {}, error: (...a) => console.log('  [logE]', ...a), warn: (...a) => console.log('  [logW]', ...a) },
};
const mod = require(require('path').join(__dirname, '..', 'plugins', '娱乐群管.js'));
mod.onEnable(ctx);

function fire(content, authorId) {
  sent.length = 0; kb.length = 0; deleted.length = 0;
  bus.emit('message.group', { id: 'msg_1', content, groupId: 'grpA', author: { id: authorId || 'AABBCCDDEEFF001122334455667788', name: '小明' }, type: 'message.group' });
  return new Promise((r) => setTimeout(r, 30)).then(() => ({ sent: sent.slice(), kb: kb.slice(), deleted: deleted.slice() }));
}

(async () => {
  let r, ok = 0, fail = 0;
  const check = (name, cond, extra) => { if (cond) { ok++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); } };

  r = await fire('菜单');
  check('菜单->按钮键盘', r.kb.length === 1 && r.kb[0].rows.length >= 3, r);
  const act = r.kb[0].rows.map((row) => row.map((b) => b.action.data)).flat();
  check('菜单按钮含抓猪/我的信息', act.indexOf('抓猪') >= 0 && act.indexOf('我的信息') >= 0, act);

  r = await fire('娱乐群管');
  check('娱乐群管->与菜单同出按钮键盘(词库含该触发词不被吞)', r.kb.length === 1 && r.kb[0].rows.length >= 3, r);

  r = await fire('随机输出');
  check('随机输出(示例规则)->随机结果文本', r.sent.length >= 1 && r.sent[0].c.indexOf('本次随机结果') >= 0, r.sent);

  r = await fire('管理菜单');
  check('管理菜单按钮(主人判定读为空仍出按钮)', r.kb.length === 1, r);

  r = await fire('主人面板');
  check('主人面板(未认证→❌)', r.sent.length === 1 && r.sent[0].c.indexOf('您不是本机器人主人') >= 0, r.sent);

  r = await fire('设置主人 999999');
  check('设置主人错误码→❌ 且不写盘', r.sent.length === 1 && r.sent[0].c.indexOf('认证码错误') >= 0, r.sent);

  r = await fire('绑定主人');
  check('裸绑定主人→给帮助不静默', r.sent.length === 1 && r.sent[0].c.indexOf('设置主人 认证码') >= 0, r.sent);

  r = await fire('抓猪');
  const c = r.sent.map((x) => x.c).join('\n');
  check('抓猪两条回复且统计累计', /🐷 .*只|🐷/.test(c) && /累计抓猪 1 次/.test(c), r.sent);

  r = await fire('钓鱼');
  check('钓鱼累计', r.sent.map((x) => x.c).join('\n').indexOf('累计钓鱼 1 次') >= 0, r.sent);

  r = await fire('我的信息');
  check('我的信息 昵称/抓猪数回读', /小明/.test(r.sent[0].c) && /抓猪：1 次/.test(r.sent[0].c), r.sent);

  r = await fire('查天气 北京');
  check('查天气(本地随机)', r.sent.map((x) => x.c).join('\n').indexOf('北京') >= 0, r.sent);

  r = await fire('掷骰子');
  check('掷骰子 1-6', /[1-6] 点/.test(r.sent[0] && r.sent[0].c), r.sent);

  r = await fire('抛硬币');
  check('抛硬币 正面/反面', /(正面|反面)/.test(r.sent[0] && r.sent[0].c), r.sent);

  r = await fire('随机数 1 100');
  check('随机数生成规则', /🎲/.test(r.sent[0] && r.sent[0].c), r.sent);

  r = await fire('计算 (2+3)*4');
  check('计算规则', r.sent[0] && r.sent[0].c.indexOf('20') >= 0, r.sent);

  r = await fire('留言 @AABBCCDDEEFF001122334455667788 明天吃饭');
  check('留言(改进版)+写盘', r.sent.length === 1 && r.sent[0].c.indexOf('✅') >= 0, r.sent);

  r = await fire('查看留言');
  check('查看留言 从列表读回', r.sent[0] && r.sent[0].c.indexOf('明天吃饭') >= 0, r.sent);

  r = await fire('清屏');
  check('清屏 输出换行文本', r.sent.length === 1 && r.sent[0].c.indexOf('屏幕已清理') >= 0, r.sent);

  r = await fire('不存在的指令xyzq');
  check('无关消息零回复', r.sent.length === 0 && r.kb.length === 0, r);

  r = await fire('禁言 <@DDEEFF00112233445566778899AABB>');
  check('禁言(主人未认证→只回权限拒绝不动作)', r.sent.length === 1 && r.sent[0].c.indexOf('无权') >= 0, r.sent);

  // 认证成功路径：绑定主人（词库认证码 = 511742399）
  r = await fire('设置主人 511742399');
  check('设置主人 绑定成功写盘', r.sent.length === 1 && r.sent[0].c.indexOf('✅') >= 0, r.sent);
  r = await fire('绑定主人 511742399');
  check('绑定主人 别名同样可绑', r.sent.length === 1 && r.sent[0].c.indexOf('✅') >= 0, r.sent);
  r = await fire('禁言 <@DDEEFF00112233445566778899AABB>', 'AABBCCDDEEFF001122334455667788');
  check('绑定后 禁言动作(mock)执行', r.sent.some((x) => x.act === 'mute'), r.sent);

  // ---- 新词库扩展功能（签到/猜大小/发积分/追加留言换行/延时） ----
  r = await fire('签到');
  check('签到 首次+10 写盘', r.sent.length === 1 && r.sent[0].c.indexOf('签到成功') >= 0 && r.sent[0].c.indexOf('+10') >= 0, r.sent);
  r = await fire('签到');
  check('签到 同日重复拦截', r.sent.length === 1 && r.sent[0].c.indexOf('已经签到过') >= 0, r.sent);

  r = await fire('猜大小 大 5');
  const gz = r.sent.map((x) => x.c).join('\n');
  check('猜大小 结算正常(非积分不足/无响应)', gz.indexOf('🎲') >= 0 && gz.indexOf('积分不足') < 0, r.sent);

  r = await fire('发积分 @CCDDEEFF00112233445566778899AABB 5');
  check('发积分 @目标清洗+写盘', r.sent.length === 1 && r.sent[0].c.indexOf('已向对方发放 5 积分') >= 0, r.sent);
  r = await fire('我的信息', 'CCDDEEFF00112233445566778899AABB');
  check('我的信息 他群成员积分回读=5', r.sent[0].c.indexOf('积分：5') >= 0, r.sent[0].c);

  r = await fire('留言 @AABBCCDDEEFF001122334455667788 一起看电影', 'CCDDEEFF00112233445566778899AABB');
  check('留言 第二条追加(|分隔内容含空格)', r.sent.length === 1 && r.sent[0].c.indexOf('✅') >= 0, r.sent);
  r = await fire('查看留言');
  const ml = r.sent[0] ? r.sent[0].c : '';
  check('查看留言 两条记录换行合并回读', ml.indexOf('明天吃饭') >= 0 && ml.indexOf('一起看电影') >= 0 && ml.indexOf('\n') >= 0, ml);

  r = await fire('放烟花');
  check('延时命令 受理回执', r.sent.length === 1 && r.sent[0].c.indexOf('5 秒后') >= 0, r.sent);

  r = await fire('今日运势');
  check('今日运势 签文输出', r.sent[0] && r.sent[0].c.indexOf('今日运势') >= 0, r.sent);

  r = await fire('解禁 <@DDEEFF00112233445566778899AABB>', 'AABBCCDDEEFF001122334455667788');
  check('绑定后 解除禁言回执', r.sent.some((x) => x.c && x.c.indexOf('已受理') >= 0), r.sent);

  // ---- 4.2.90 扩展：菜单外显 / 禁言分钟 / 批量禁言 / 数字QQ发积分 / 清屏撤回 ----
  r = await fire('菜单');
  check('菜单含文字外显 markdown', r.sent.some((x) => x.m && x.m.indexOf('mqqapi://aio/') >= 0), r.sent);

  r = await fire('禁言 <@DDEEFF00112233445566778899AABB> 5', 'AABBCCDDEEFF001122334455667788');
  check('禁言带分钟→mute_seconds=300', r.sent.some((x) => x.act === 'mute' && x.d === 300), r.sent);

  r = await fire('批量禁言 <@DDEEFF00112233445566778899AABB>,<@EEFF00112233445566778899AABBCC>', 'AABBCCDDEEFF001122334455667788');
  check('批量禁言→两名成员各禁言一次', r.sent.filter((x) => x.act === 'mute').length === 2, r.sent);

  r = await fire('发积分 12345678 7', 'AABBCCDDEEFF001122334455667788');
  check('发积分 数字QQ→解析后写盘', r.sent.length === 1 && r.sent[0].c.indexOf('已向对方发放 7 积分') >= 0, r.sent);
  r = await fire('我的信息', BOUND);
  check('QQ映射目标 我的信息积分=7', r.sent[0].c.indexOf('积分：7') >= 0, r.sent[0].c);

  r = await fire('清屏');
  check('清屏→撤回指令消息', r.deleted.length === 1 && r.deleted[0].m === 'msg_1', r.deleted);

  r = await fire('功能');
  check('功能大全→外显 markdown', r.sent.some((x) => x.m && x.m.indexOf('mqqapi://aio/') >= 0), r.sent);

  r = await fire('菜单');
  const kbActions = r.kb[0].rows.map((row) => row.map((b) => b.action)).flat();
  check('菜单含 url 链接按钮', kbActions.some((a) => a && a.type === 0 && a.data && a.data.url), kbActions);

  const fsLib = require('fs');
  const rootTxt = fsLib.readFileSync(path.join(__dirname, '..', 'plugins', '娱乐群管.txt'), 'utf8');
  const runTxt = fsLib.readFileSync(path.join(__dirname, '..', 'plugins', '词库', '娱乐群管.txt'), 'utf8');
  check('默认词库与运行目录副本一致', rootTxt === runTxt);

  // ---- 4.2.92：重启广播外显链接走 markdown；全局外显关闭时退回纯文字，绝不回显源码 ----
  const rc = require(path.join(__dirname, '..', 'plugins', '重启控制.js'));
  const stOn = rc.statusText({ botName: 'Bot', memTotalMb: 2048, memUsedMb: 1024, memPct: 50 }, '', { link: ctx.link });
  check('重启广播外显 markdown', stOn.indexOf('[测试菜单](mqqapi://aio/') >= 0, stOn);
  const stOff = rc.statusText({ memTotalMb: 2048, memUsedMb: 1024, memPct: 50 }, '', { link: { mode: () => 'off', linkify: (t) => t } });
  check('外显关闭→纯文字标签且无源码', stOff.indexOf('mqqapi://') < 0 && stOff.indexOf('📌 菜单：测试菜单') >= 0, stOff);

  require('fs').rmSync(process.env.LZYQZB_DATA_DIR,{recursive:true,force:true});console.log('\n== ' + ok + ' passed, ' + fail + ' failed ==');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
