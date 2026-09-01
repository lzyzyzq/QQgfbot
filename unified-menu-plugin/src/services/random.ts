export function luck(): string {
  const pool = [
    '大吉','中吉','小吉','吉','末吉','凶','大凶','中凶','小凶','末凶',
  ];
  const advices = [
    '今天适合发送「主菜单」查看惊喜',
    '适合签到，积分翻倍',
    '适合点一首喜欢的歌',
    '适合和群友玩一把猜数字',
    '今天运势不错，试试老虎机',
  ];
  const g = pool[Math.floor(Math.random() * pool.length)];
  const a = advices[Math.floor(Math.random() * advices.length)];
  return '🎴 今日运势：' + g + '\n💡 建议：' + a;
}

export function dice(args: string): string {
  const m = (args || '').match(/(\d+)d(\d+)/i);
  if (m) {
    const n = Math.min(parseInt(m[1], 10) || 1, 20);
    const sides = Math.max(parseInt(m[2], 10) || 6, 2);
    const rolls = Array.from({ length: n }, () => Math.floor(Math.random() * sides) + 1);
    return '🎲 ' + n + 'd' + sides + '：' + rolls.join(' + ') + ' = ' + rolls.reduce((a, b) => a + b, 0);
  }
  return '🎲 骰子结果：' + (Math.floor(Math.random() * 6) + 1) + ' 点';
}

export function rps(user: string): string {
  const opts = ['石头', '剪刀', '布'];
  const bot = opts[Math.floor(Math.random() * 3)];
  const u = (user || '').trim();
  if (!opts.includes(u)) {
    return '✊ 猜拳：请回复「猜拳 石头/剪刀/布」';
  }
  const win = (u === '石头' && bot === '剪刀') || (u === '剪刀' && bot === '布') || (u === '布' && bot === '石头');
  const draw = u === bot;
  let res = '🤖 平手';
  if (!draw) res = win ? '🎉 你赢了' : '😔 你输了';
  return '✊ 你出「' + u + '」，机器人出「' + bot + '」\n' + res;
}

export function wheel(): string {
  const pool = ['幸运+10', '再来一次', '谢谢参与', '🎁 小奖品', '积分翻倍', '恭喜发财', '打工人加油', '欧皇附体'];
  return '🎡 幸运大转盘：' + pool[Math.floor(Math.random() * pool.length)];
}

export function pick(args: string): string {
  const opts = (args || '').split(/\s+/).filter(Boolean);
  if (opts.length < 2) return '🎯 选择：发送「选择 火锅 烧烤 奶茶」让我随机帮你选';
  return '🎯 选择结果：' + opts[Math.floor(Math.random() * opts.length)] + '（从 ' + opts.length + ' 个选项中）';
}

export function randnum(args: string): string {
  const parts = (args || '').split(/\s+/).map((s) => parseInt(s, 10));
  const lo = isNaN(parts[0]) ? 1 : parts[0];
  const hi = isNaN(parts[1]) ? 100 : parts[1];
  if (hi < lo) return '🔢 随机数：范围错误（最小值大于最大值）';
  const n = Math.floor(Math.random() * (hi - lo + 1)) + lo;
  return '🔢 随机数（' + lo + '~' + hi + '）：' + n;
}

export function food(): string {
  const foods = ['🍜 火锅', '🍱 日料', '🍕 披萨', '🍔 汉堡', '🥗 轻食沙拉', '🍢 烧烤', '🍲 麻辣烫', '🥟 饺子', '🍣 寿司', '🍝 意面', '🍚 盖浇饭', '🥘 咖喱饭'];
  return '🍜 今天吃什么：' + foods[Math.floor(Math.random() * foods.length)] + '！';
}

export function integrity(): string {
  const p = Math.floor(Math.random() * 101);
  const level = p >= 90 ? '人间极品' : p >= 70 ? '正直善良' : p >= 40 ? '普普通通' : '有待提高';
  return '👤 今日人品：' + p + '分（' + level + '）\n💡 多签到、多互动，人品值更高哦~';
}

const CP_POOL = ['蔡徐坤', '小仙女', '隔壁老王', '电竞大神', '班花', '邻家妹妹', '霸道总裁', '温柔学姐', '猫咪', '二哈'];
export function cp(gender: string): string {
  const who = CP_POOL[Math.floor(Math.random() * CP_POOL.length)];
  const type = gender.includes('老公') ? '老公' : '老婆';
  return '💕 今日' + type + '已抽取：' + who + '\n祝你们天长地久！';
}

export function woodfish(): string {
  const pool = ['功德+1', '功德+2', '功德+3', '功德+5', '功德+10'];
  const gain = pool[Math.floor(Math.random() * pool.length)];
  return '🪵 敲木鱼：咚咚咚……' + gain + ' 🧘';
}

const JOKES = [
  '程序员最讨厌的两件事：一是写文档，二是别人不写文档。',
  '老板问程序员：你知道为什么程序总在周五出 bug 吗？程序员：因为周五我要下班。',
  '产品经理：「这个需求很简单，怎么实现我不管。」程序员：「……」',
  '程序员相亲：她说她有房有车有存款，我默默打开了 VS Code，写了 100 行代码。',
  '为什么程序员分不清万圣节和圣诞节？因为 Oct 31 == Dec 25。',
  '领导：「这个项目要赶进度，大家周末加个班。」程序员的周末：周六修 bug，周日修 bug 的 bug。',
  '两只程序员在路上走，忽然一只对另一只说：我们交换一下内存条吧。',
];
export function joke(): string {
  return '😄 ' + JOKES[Math.floor(Math.random() * JOKES.length)];
}
