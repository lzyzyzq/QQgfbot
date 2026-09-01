import { state } from '../core/state';
import { todayStr, seededRandom, pickRandomFromList, pickWeighted } from '../core/utils';
import type { GroupEvent } from '../types';

const FOOD_LIST = ['火锅', '烤肉', '麻辣烫', '黄焖鸡', '兰州拉面', '沙县小吃', '汉堡', '披萨', '寿司', '烧烤', '螺蛳粉', '炸鸡', '饺子', '煲仔饭', '酸菜鱼', '煲汤', '肠粉', '铁板烧', '串串香', '云南米线'];
const FORTUNE_LIST = ['大吉', '中吉', '小吉', '小凶', '中凶', '大凶'];
const REALT_LIST = ['凡人', '练气', '筑基', '金丹', '元婴', '化神', '炼虚', '合体', '大乘', '渡劫', '仙帝', '仙尊', '仙王', '真仙'];
const FISH_LIST = [
  { name: '破草鞋', weight: 30, score: 1 },
  { name: '小虾米', weight: 25, score: 2 },
  { name: '鲫鱼', weight: 18, score: 5 },
  { name: '鲤鱼', weight: 12, score: 8 },
  { name: '草鱼', weight: 8, score: 10 },
  { name: '金鱼', weight: 4, score: 20 },
  { name: '锦鲤', weight: 2, score: 50 },
  { name: '神龙', weight: 1, score: 200 },
];
const CROP_LIST = [
  { name: '萝卜', cost: 10, yield: 30, time: 30 },
  { name: '白菜', cost: 20, yield: 60, time: 60 },
  { name: '小麦', cost: 40, yield: 120, time: 120 },
  { name: '番茄', cost: 80, yield: 240, time: 240 },
  { name: '南瓜', cost: 160, yield: 500, time: 480 },
  { name: '金苹果', cost: 500, yield: 2000, time: 720 },
];

export function dailyFortune(event: GroupEvent): string {
  const uid = String(event.user_id);
  const rand = seededRandom(uid + todayStr());
  const fortune = FORTUNE_LIST[Math.floor(rand() * FORTUNE_LIST.length)];
  const lucky = 1 + Math.floor(rand() * 9);
  const color = ['红色', '金色', '蓝色', '绿色', '紫色', '白色'][Math.floor(rand() * 6)];
  return `今日运势（${todayStr()}）
运势：${fortune}
幸运数字：${lucky}
幸运颜色：${color}
宜：${['喝水', '摸鱼', '晒太阳', '发呆', '躺平', '吃饭'][Math.floor(rand() * 6)]}`;
}

export function dailyLuck(event: GroupEvent): string {
  const uid = String(event.user_id);
  const rand = seededRandom(uid + todayStr());
  const pct = Math.floor(rand() * 100);
  const level = pct >= 90 ? '欧皇附体' : pct >= 70 ? '运气不错' : pct >= 40 ? '平平无奇' : pct >= 15 ? '有点非' : '非酋本酋';
  return `今日人品：${pct}%
评价：${level}`;
}

export function rockPaperScissors(choice: string): string {
  const map: Record<string, number> = { 石头: 0, 剪刀: 1, 布: 2 };
  const names = ['石头', '剪刀', '布'];
  const c = map[choice];
  if (c === undefined) return '用法：猜拳 石头/剪刀/布';
  const bot = Math.floor(Math.random() * 3);
  let result: string;
  if (c === bot) result = '平局！';
  else if ((c + 1) % 3 === bot) result = '你输了~';
  else result = '你赢了！';
  return `你出：${names[c]}
我出：${names[bot]}
${result}`;
}

export function randomInRange(arg: string): string {
  const m = arg.match(/(\d+)\s*[-~到]\s*(\d+)/);
  if (!m) return '用法：随机数 1-100';
  const min = Math.min(parseInt(m[1]), parseInt(m[2]));
  const max = Math.max(parseInt(m[1]), parseInt(m[2]));
  return `随机数（${min}-${max}）：${min + Math.floor(Math.random() * (max - min + 1))}`;
}

export function pickChoice(args: string): string {
  const items = args.split(/[、,，;；\s]+/).filter(Boolean);
  if (items.length < 2) return '用法：选择 选项A 选项B 选项C';
  return `我帮你选了：${pickRandomFromList(items)}`;
}

export function whatToEat(): string {
  return `今天吃：${pickRandomFromList(FOOD_LIST)}`;
}

export function drawCp(parts: string[], members: string[]): string {
  if (members && members.length >= 2) {
    return `💞 ${members[0]} ❤ ${members[1]}`;
  }
  return '用法：抽CP 名字A 名字B';
}

function renderMine(grid: number[][], revealed: boolean[][], w: number, h: number, lost: boolean): string {
  const rows: string[] = [];
  rows.push('   ' + Array.from({ length: w }, (_, i) => String(i + 1)).join(' '));
  grid.forEach((row, r) => {
    const line = row
      .map((v, c) => {
        if (lost && v === -1) return '💣';
        if (!revealed[r][c]) return '■';
        return v === 0 ? '·' : String(v);
      })
      .join(' ');
    rows.push(String.fromCharCode(65 + r) + ' ' + line);
  });
  rows.push('发送「扫雷 A1」翻开格子');
  return rows.join('\n');
}

export function minesweeperInit(event: GroupEvent): string {
  const uid = String(event.user_id);
  const w = 9, h = 9, mines = 10;
  const grid: number[][] = Array.from({ length: h }, () => Array(w).fill(0));
  const bomb: boolean[][] = Array.from({ length: h }, () => Array(w).fill(false));
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
  const revealed: boolean[][] = Array.from({ length: h }, () => Array(w).fill(false));
  state.data.mines[uid] = { grid, bomb, revealed, w, h };
  state.saveData();
  return renderMine(grid, revealed, w, h, false);
}

export function minesweeperReveal(event: GroupEvent, arg: string): string {
  const uid = String(event.user_id);
  const game: any = state.data.mines[uid];
  if (!game) return '没有进行中的扫雷游戏，发送「扫雷」开始一局。';
  const m = arg.match(/^([A-Za-z])(\d+)$/);
  if (!m) return '格式：扫雷 A1';
  const r = m[1].toUpperCase().charCodeAt(0) - 65;
  const c = parseInt(m[2]) - 1;
  if (r < 0 || r >= game.h || c < 0 || c >= game.w) return '越界啦，再试一次。';
  if (game.revealed[r][c]) return '这个格子已经翻过了。';
  if (game.bomb[r][c]) {
    delete state.data.mines[uid];
    state.saveData();
    return renderMine(game.grid, game.revealed.map((row) => row.map(() => true)), game.w, game.h, true) + '\n💥 踩到地雷了！游戏结束。';
  }
  const queue = [[r, c]];
  while (queue.length) {
    const [cr, cc] = queue.pop() as number[];
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
    return renderMine(game.grid, game.revealed, game.w, game.h, false) + '\n🎉 扫雷成功！';
  }
  return renderMine(game.grid, game.revealed, game.w, game.h, false);
}

export function woodFish(event: GroupEvent): string {
  const uid = String(event.user_id);
  state.data.woodFish[uid] = (state.data.woodFish[uid] || 0) + 1;
  state.saveData();
  return `🔨 功德 +1，累计功德 ${state.data.woodFish[uid]}`;
}

export function fishing(event: GroupEvent): string {
  const uid = String(event.user_id);
  const st: any = state.data.fishing[uid] || { count: 0, score: 0, best: '' };
  const fish = pickWeighted(FISH_LIST, Math.random);
  st.count++;
  st.score += fish.score;
  if (fish.score >= 20) st.best = fish.name;
  state.data.fishing[uid] = st;
  state.saveData();
  return `🎣 你钓到了：${fish.name}（+${fish.score}分）
累计钓鱼 ${st.count} 次，总分 ${st.score}${st.best ? `，最佳记录：${st.best}` : ''}`;
}

export function getFarm(event: GroupEvent): any {
  const uid = String(event.user_id);
  if (!state.data.farm[uid]) {
    state.data.farm[uid] = { coins: 100, plots: [{ crop: null, plantedAt: 0 }, { crop: null, plantedAt: 0 }, { crop: null, plantedAt: 0 }] };
  }
  return state.data.farm[uid];
}

export function farmView(event: GroupEvent): string {
  const f = getFarm(event);
  const lines: string[] = [`🌾 开心农场（金币：${f.coins}）`];
  f.plots.forEach((p: any, i: number) => {
    if (!p.crop) {
      lines.push(`  ${i + 1}. 空地`);
      return;
    }
    const def = CROP_LIST.find((c) => c.name === p.crop);
    const remain = Math.max(0, Math.ceil((p.plantedAt + (def ? def.time : 60) * 1000 - Date.now()) / 1000));
    lines.push(`  ${i + 1}. ${p.crop}${remain > 0 ? `（还有 ${remain}s 成熟）` : '（可收获）'}`);
  });
  lines.push('发送「种植 萝卜」「收获 1」「开垦」(100金币)');
  state.saveData();
  return lines.join('\n');
}

export function farmPlant(event: GroupEvent, cropName: string): string {
  const f = getFarm(event);
  const def = CROP_LIST.find((c) => c.name === cropName);
  if (!def) return `没有这个作物：${cropName}（可选：${CROP_LIST.map((c) => c.name).join('、')}）`;
  if (f.coins < def.cost) return `金币不足，种植${def.name}需要 ${def.cost} 金币。`;
  const empty = f.plots.findIndex((p: any) => !p.crop);
  if (empty === -1) return '没有空地了，先收获或开垦。';
  f.coins -= def.cost;
  f.plots[empty] = { crop: def.name, plantedAt: Date.now() };
  state.saveData();
  return `已种植 ${def.name}（${def.time}s 后成熟）。`;
}

export function farmHarvest(event: GroupEvent, idx: string): string {
  const f = getFarm(event);
  const i = parseInt(idx) - 1;
  if (isNaN(i) || i < 0 || i >= f.plots.length) return '格式：收获 1';
  const p = f.plots[i];
  if (!p.crop) return '这块地是空的。';
  const def = CROP_LIST.find((c) => c.name === p.crop);
  if (Date.now() < p.plantedAt + (def ? def.time : 60) * 1000) {
    const remain = Math.ceil((p.plantedAt + (def ? def.time : 60) * 1000 - Date.now()) / 1000);
    return `还没成熟，还需要 ${remain}s。`;
  }
  const gain = def ? def.yield : 30;
  f.coins += gain;
  f.plots[i] = { crop: null, plantedAt: 0 };
  state.saveData();
  return `收获成功！${def ? def.name : ''} 卖出 ${gain} 金币，当前金币：${f.coins}`;
}

export function farmExpand(event: GroupEvent): string {
  const f = getFarm(event);
  if (f.plots.length >= 6) return '最多 6 块地。';
  if (f.coins < 100) return '金币不足，开垦需要 100 金币。';
  f.coins -= 100;
  f.plots.push({ crop: null, plantedAt: 0 });
  state.saveData();
  return `开垦成功！现在有 ${f.plots.length} 块地。`;
}

export function xianNi(event: GroupEvent): string {
  const uid = String(event.user_id);
  const rand = seededRandom(uid + todayStr());
  const xp = 1 + Math.floor(rand() * 50);
  const realm = REALT_LIST[Math.min(REALT_LIST.length - 1, Math.floor(rand() * REALT_LIST.length))];
  const next = REALT_LIST[Math.min(REALT_LIST.length - 1, REALT_LIST.indexOf(realm) + 1)];
  return `🧘 仙逆修炼日志
今日修炼获得 ${xp} 点灵力
当前境界：${realm}
${next ? `下一境界：${next}` : '已达巅峰'}`;
}
