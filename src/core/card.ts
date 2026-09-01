import sharp from 'sharp';

export interface InfoCardData {
  avatarUrl: string;
  nickname: string;
  groupName: string;
  qq: string;
  openid: string;
  permission: string;
  authText: string;
  streak: string;
  note: string;
}

const CARD_W = 760;
const FONT = 'Noto Sans CJK SC, Noto Sans SC, Noto Sans, WenQuanYi Zen Hei, WenQuanYi Micro Hei, Droid Sans Fallback, Source Han Sans SC, PingFang SC, Microsoft YaHei, sans-serif';
const FIELD_TOP = 236; // 字段区首行 baseline
const FIELD_GAP = 44;  // 字段行间距
const LABEL_X = 48;    // 标签列 x
const VALUE_X = 176;   // 值列 x

function escSvg(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 过滤 emoji / 符号，避免 sharp(librsvg) 无 emoji 字体时渲染成方块乱码
function stripEmoji(s: string): string {
  return String(s || '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2300}-\u{23FF}\u{FE0F}\u{200D}\u{2190}-\u{21FF}]/gu, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// 按近似宽度截断文本，防止值超出卡片右边界（中文按 fontSize 宽、其他字符按 0.6*fontSize）
function fit(s: string, maxW: number, fontSize: number): string {
  const w = (ch: string) => /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch) ? fontSize : fontSize * 0.6;
  let total = 0;
  let out = '';
  for (const ch of String(s || '')) {
    const cw = w(ch);
    if (total + cw > maxW) return out.length > 0 ? out + '...' : out;
    out += ch;
    total += cw;
  }
  return out;
}

// 固定北京时间（UTC+8），任意时区部署均正确
function bjTime(): string {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

async function downloadAvatar(url: string, nickname: string): Promise<{ image: string; fallback: string }> {
  const first = (nickname || '?').charAt(0);
  const fallback = `<circle cx="100" cy="148" r="52" fill="#334155"/><text x="100" y="148" font-family="${FONT}" font-size="40" fill="#cbd5e1" text-anchor="middle" dominant-baseline="central">${escSvg(first)}</text>`;
  try {
    const res = await fetch(url);
    if (!res || !res.ok) return { image: '', fallback };
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
    if (!/^image\/(jpeg|png|webp|gif)$/.test(mime)) return { image: '', fallback };
    return {
      image: `<image x="48" y="96" width="104" height="104" preserveAspectRatio="xMidYMid slice" clip-path="url(#av)" href="data:${mime};base64,${buf.toString('base64')}"/>`,
      fallback,
    };
  } catch {
    return { image: '', fallback };
  }
}

// 生成「个人信息」卡片图：头像 + 全部字段合成为一张 PNG，经富媒体消息发送。
// QQ 平台不支持 markdown 图片语法，图片消息是唯一能把头像放进信息卡的方式。
export async function renderInfoCard(data: InfoCardData): Promise<Buffer> {
  const av = await downloadAvatar(data.avatarUrl, data.nickname);
  const rows: { label: string; value: string }[] = [
    { label: '群名', value: data.groupName || '-' },
    { label: '昵称', value: data.nickname || '-' },
    { label: 'QQ号', value: data.qq || '未绑定' },
    { label: 'OpenID', value: data.openid || '-' },
    { label: '权限', value: data.permission || '普通用户' },
    { label: '授权', value: data.authText || '' },
    { label: '连续打卡', value: data.streak + ' 天' },
    { label: '今日备注', value: data.note || '无' },
  ];

  // 副标题：权限 · 群名，过长则截断
  const subTitle = fit(stripEmoji((data.permission ? data.permission + ' · ' : '') + (data.groupName || '')), 520, 20);

  const rowSvgs = rows.map((r, i) => {
    const y = FIELD_TOP + i * FIELD_GAP;
    const label = fit(r.label, 124, 22);
    const value = fit(stripEmoji(r.value), CARD_W - VALUE_X - 40, 22);
    return `<text x="${LABEL_X}" y="${y}" font-family="${FONT}" font-size="22" fill="#e2e8f0">${escSvg(label)}</text><text x="${VALUE_X}" y="${y}" font-family="${FONT}" font-size="22" fill="#7dd3fc">${escSvg(value)}</text>`;
  });

  const cardH = FIELD_TOP + rows.length * FIELD_GAP + 40;
  const titleColor = '#f8fafc';
  const svg = `<svg width="${CARD_W}" height="${cardH}" xmlns="http://www.w3.org/2000/svg">
  <defs><clipPath id="av"><circle cx="100" cy="148" r="52"/></clipPath></defs>
  <rect x="0" y="0" width="${CARD_W}" height="${cardH}" rx="24" fill="#0f172a"/>
  <rect x="0" y="0" width="${CARD_W}" height="66" rx="24" fill="#1e293b"/>
  <text x="40" y="46" font-family="${FONT}" font-size="30" font-weight="bold" fill="${titleColor}">个人信息</text>
  <circle cx="100" cy="148" r="54" fill="#1e293b"/>
  <circle cx="100" cy="148" r="52" fill="#334155"/>
  ${av.image || av.fallback}
  <text x="180" y="126" font-family="${FONT}" font-size="28" font-weight="bold" fill="#ffffff">${escSvg(fit(stripEmoji(data.nickname || '未知用户'), 460, 28))}</text>
  <text x="180" y="158" font-family="${FONT}" font-size="20" fill="#94a3b8">${escSvg(subTitle)}</text>
  <line x1="40" y1="206" x2="${CARD_W - 40}" y2="206" stroke="#1e293b"/>
  ${rowSvgs.join('\n  ')}
  <line x1="40" y1="${cardH - 34}" x2="${CARD_W - 40}" y2="${cardH - 34}" stroke="#1e293b"/>
  <text x="${CARD_W - 40}" y="${cardH - 16}" font-family="${FONT}" font-size="14" fill="#64748b" text-anchor="end">QQ机器人 · 个人信息</text>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// ===== 群活跃统计看板卡片（「群信息」插件用）=====

export interface GroupDashboardRenderData {
  groupName: string;
  groupId: string;
  date: string;
  until: string;
  metrics: { label: string; value: string; sub?: string; delta?: string; deltaUp?: boolean; color: string }[];
  topUsers: { name: string; masked: string; count: number }[];
  recentUsers: { name: string; masked: string; lastSeen: string }[];
  elapsedMs: number;
}

const DASH_W = 760;

// 渲染群活跃统计看板，返回 PNG buffer
export async function renderGroupDashboard(data: GroupDashboardRenderData): Promise<Buffer> {
  const dashH = 930;
  const gridX = 48;
  const gap = 12;
  const cardW = (DASH_W - gridX * 2 - gap) / 2;
  const cardH = 98;
  const rowTop = [236, 346, 456, 566];
  const colX = [gridX, gridX + cardW + gap];

  // 顶部横幅
  const banner = `
  <defs>
    <linearGradient id="gH" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1e40af"/>
      <stop offset="1" stop-color="#3b82f6"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${DASH_W}" height="210" fill="url(#gH)"/>
  <circle cx="660" cy="30" r="120" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="26"/>
  <circle cx="720" cy="150" r="70" fill="none" stroke="rgba(255,255,255,.10)" stroke-width="18"/>
  <text x="48" y="82" font-family="${FONT}" font-size="44" font-weight="bold" fill="#ffffff">${escSvg(data.date + ' 活跃统计')}</text>
  <rect x="48" y="104" width="${Math.min(560, 40 + fit((data.groupName + '（截至' + data.until + '）'), 520, 16).length * 16)}" height="34" rx="17" fill="rgba(255,255,255,.18)"/>
  <text x="62" y="127" font-family="${FONT}" font-size="16" fill="#e0f2fe">${escSvg(fit(data.groupName + '（截至' + data.until + '）', 520, 16))}</text>
  <text x="${DASH_W - 40}" y="46" font-family="${FONT}" font-size="14" letter-spacing="2" fill="#bfdbfe" text-anchor="end">DATA DASHBOARD</text>`;

  // 指标卡片
  const metrics = (data.metrics || []).slice(0, 8);
  const metricCards = metrics.map((m, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = colX[col];
    const y = rowTop[row] || (rowTop[0] + (row - rowTop.length) * (cardH + gap));
    const delta = m.delta ? `<text x="${x + cardW - 14}" y="${y + 76}" font-family="${FONT}" font-size="13" font-weight="bold" fill="${m.deltaUp ? '#16a34a' : '#dc2626'}" text-anchor="end">${m.deltaUp ? '▲' : '▼'} ${escSvg(m.delta)}</text>` : '';
    const sub = m.sub ? `<text x="${x + cardW - 14}" y="${y + 76}" font-family="${FONT}" font-size="13" fill="#64748b" text-anchor="end">${escSvg(m.sub)}</text>` : '';
    return `
  <rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="14" fill="#f8fafc" stroke="#e2e8f0"/>
  <circle cx="${x + 22}" cy="${y + 24}" r="5" fill="${m.color}"/>
  <text x="${x + 36}" y="${y + 29}" font-family="${FONT}" font-size="14" fill="#64748b">${escSvg(m.label)}</text>
  <text x="${x + 20}" y="${y + 78}" font-family="${FONT}" font-size="30" font-weight="bold" fill="#0f172a">${escSvg(m.value)}</text>
  ${delta || sub}`;
  });

  // 底部 Top3 模块
  const rankColors = ['#f59e0b', '#94a3b8', '#d97706'];
  const barW = 176;
  const topMax = Math.max(1, ...(data.topUsers || []).map(t => t.count));
  const topRows = (data.topUsers || []).slice(0, 3).map((t, i) => {
    const y = 810 + i * 56;
    return `
  <circle cx="${gridX + 40}" cy="${y}" r="14" fill="${rankColors[i] || '#94a3b8'}"/>
  <text x="${gridX + 40}" y="${y + 5}" font-family="${FONT}" font-size="15" font-weight="bold" fill="#fff" text-anchor="middle">${i + 1}</text>
  <text x="${gridX + 66}" y="${y + 5}" font-family="${FONT}" font-size="14" fill="#0f172a">${escSvg(fit(stripEmoji(t.name), 180, 14))}</text>
  <text x="${gridX + 260}" y="${y + 5}" font-family="${FONT}" font-size="13" font-weight="bold" fill="#334155" text-anchor="end">${t.count}条</text>
  <rect x="${gridX + 66}" y="${y + 14}" width="${barW}" height="6" rx="3" fill="#e2e8f0"/>
  <rect x="${gridX + 66}" y="${y + 14}" width="${Math.max(6, Math.round(barW * t.count / topMax))}" height="6" rx="3" fill="${rankColors[i] || '#f59e0b'}"/>`;
  });
  const recentMaxW = 176;
  const recentRows = (data.recentUsers || []).slice(0, 3).map((r, i) => {
    const y = 810 + i * 56;
    const w = Math.max(20, recentMaxW - i * 28);
    return `
  <circle cx="${gridX + 20 + cardW + 40}" cy="${y}" r="14" fill="${rankColors[i] || '#94a3b8'}"/>
  <text x="${gridX + 20 + cardW + 40}" y="${y + 5}" font-family="${FONT}" font-size="15" font-weight="bold" fill="#fff" text-anchor="middle">${i + 1}</text>
  <text x="${gridX + 20 + cardW + 66}" y="${y + 5}" font-family="${FONT}" font-size="14" fill="#0f172a">${escSvg(fit(stripEmoji(r.name), 180, 14))}</text>
  <text x="${gridX + 20 + cardW + 260}" y="${y + 5}" font-family="${FONT}" font-size="13" fill="#64748b" text-anchor="end">${escSvg(r.lastSeen)}</text>
  <rect x="${gridX + 20 + cardW + 66}" y="${y + 14}" width="${w}" height="6" rx="3" fill="#e2e8f0"/>
  <rect x="${gridX + 20 + cardW + 66}" y="${y + 14}" width="${Math.max(6, Math.round(w * (3 - i) / 3))}" height="6" rx="3" fill="#22c55e"/>`;
  });

  const botBox = 688;
  const footId = (data.groupId || '').substring(0, 12);
  const svg = `<svg width="${DASH_W}" height="${dashH}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${DASH_W}" height="${dashH}" rx="24" fill="#ffffff"/>
  ${banner}
  ${metricCards.join('\n')}
  <rect x="${colX[0]}" y="${botBox}" width="${cardW}" height="204" rx="14" fill="#f8fafc" stroke="#e2e8f0"/>
  <rect x="${colX[0]}" y="${botBox + 18}" width="6" height="20" rx="3" fill="#3b82f6"/>
  <text x="${colX[0] + 20}" y="${botBox + 34}" font-family="${FONT}" font-size="17" font-weight="bold" fill="#0f172a">最活跃成员</text>
  ${topRows.join('\n')}
  <rect x="${colX[1]}" y="${botBox}" width="${cardW}" height="204" rx="14" fill="#f8fafc" stroke="#e2e8f0"/>
  <rect x="${colX[1]}" y="${botBox + 18}" width="6" height="20" rx="3" fill="#22c55e"/>
  <text x="${colX[1] + 20}" y="${botBox + 34}" font-family="${FONT}" font-size="17" font-weight="bold" fill="#0f172a">最近活跃成员</text>
  ${recentRows.join('\n')}
  <text x="${DASH_W / 2}" y="${dashH - 16}" font-family="${FONT}" font-size="13" fill="#94a3b8" text-anchor="middle">${escSvg(footId)} · 群活跃统计 · 查询耗时 ${data.elapsedMs}ms</text>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// ===== 群活跃统计长图卡片（竖版仪表盘，PHP「群信息」插件用）=====

export interface GroupStatsCardData {
  date: string;                              // 标题日期，如 "08-31"
  groupName: string;                         // 群名（已按 官方→本地绑定→OpenID 解析）
  groupDesc: string;                         // 群名补充（如群号），可为空
  until: string;                             // 截至时间，如 "11:43"
  metrics: { label: string; value: string; color: string }[]; // 8 项指标
  topActive: { name: string; value: string; score: number }[]; // 最活跃成员 Top5
  topRecent: { name: string; value: string; score: number }[]; // 最近活跃成员 Top5
  topGroups: { name: string; value: string; score: number }[]; // 最活跃的群 Top5（跨所有群）
  footer?: string;
  elapsedMs?: number;                           // 聚合查询耗时（毫秒），用于页脚展示
}

const STATS_W = 760;
const STATS_RANK_COLORS = ['#f59e0b', '#94a3b8', '#d97706', '#eab308', '#f97316'];

// 渲染竖版群活跃统计长图，返回 PNG buffer。布局：蓝渐变横幅 + 2x4 指标网格 + 左右排行卡 + 底部群排行卡 + 页脚
export async function renderGroupStatsCard(data: GroupStatsCardData): Promise<Buffer> {
  const bannerH = 210;
  const gridX = 48;
  const gap = 12;
  const cardW = (STATS_W - gridX * 2 - gap) / 2;
  const metricH = 96;
  const metricGap = 10;
  const metricRows = Math.max(1, Math.ceil((data.metrics || []).length / 2));
  const metricTop = 236;
  const metricBottom = metricTop + metricRows * (metricH + metricGap) - metricGap;
  const rankTop = metricBottom + 22;
  const rankRowsN = Math.max((data.topActive || []).length, (data.topRecent || []).length);
  const rankH = 46 + Math.max(1, rankRowsN) * 52 + 24;
  const groupsTop = rankTop + rankH + 20;
  const groupsH = 46 + Math.max(1, (data.topGroups || []).length) * 52 + 24;
  const footY = groupsTop + groupsH + 26;
  const dashH = footY + 30;

  const colX = [gridX, gridX + cardW + gap];

  // 顶部横幅（蓝渐变 + 装饰圆 + 标题 + 群名胶囊）
  const banner = `
  <defs>
    <linearGradient id="sG" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1e40af"/>
      <stop offset="1" stop-color="#3b82f6"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${STATS_W}" height="${bannerH}" fill="url(#sG)"/>
  <circle cx="${STATS_W - 90}" cy="36" r="120" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="26"/>
  <circle cx="${STATS_W - 40}" cy="${bannerH - 60}" r="70" fill="none" stroke="rgba(255,255,255,.10)" stroke-width="18"/>
  <text x="48" y="84" font-family="${FONT}" font-size="44" font-weight="bold" fill="#ffffff">${escSvg(fit(stripEmoji(data.date + ' 活跃统计'), STATS_W - 220, 44))}</text>
  <text x="${STATS_W - 40}" y="46" font-family="${FONT}" font-size="14" letter-spacing="2" fill="#bfdbfe" text-anchor="end">DATA DASHBOARD</text>
  <rect x="48" y="108" width="${Math.min(600, 48 + (fit(stripEmoji((data.groupName || '') + (data.groupDesc ? ' · ' + data.groupDesc : '') + '（截至' + data.until + '）'), 560, 16).length) * 16)}" height="36" rx="18" fill="rgba(255,255,255,.18)"/>
  <text x="64" y="132" font-family="${FONT}" font-size="16" fill="#e0f2fe">${escSvg(fit(stripEmoji((data.groupName || '') + (data.groupDesc ? ' · ' + data.groupDesc : '') + '（截至' + data.until + '）'), 560, 16))}</text>`;

  // 指标卡片（2 列网格）
  const metrics = (data.metrics || []).slice(0, 8);
  const metricCards = metrics.map((m, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = colX[col];
    const y = metricTop + row * (metricH + metricGap);
    return `
  <rect x="${x}" y="${y}" width="${cardW}" height="${metricH}" rx="14" fill="#f8fafc" stroke="#e2e8f0"/>
  <circle cx="${x + 22}" cy="${y + 24}" r="5" fill="${m.color || '#3b82f6'}"/>
  <text x="${x + 36}" y="${y + 30}" font-family="${FONT}" font-size="14" fill="#64748b">${escSvg(fit(stripEmoji(m.label), cardW - 60, 14))}</text>
  <text x="${x + 20}" y="${y + 80}" font-family="${FONT}" font-size="30" font-weight="bold" fill="#0f172a">${escSvg(fit(stripEmoji(m.value), cardW - 40, 30))}</text>`;
  });

  // 排行条目渲染（名次圆标 + 名称 + 右侧数值 + 进度条）
  const renderRankRows = (rows: { name: string; value: string; score: number }[], x: number, colors: string[]) =>
    (rows || []).slice(0, 5).map((r, i) => {
      const y = rankTop + 46 + i * 52;
      return `
  <circle cx="${x + 20}" cy="${y}" r="13" fill="${colors[i] || '#94a3b8'}"/>
  <text x="${x + 20}" y="${y + 5}" font-family="${FONT}" font-size="14" font-weight="bold" fill="#fff" text-anchor="middle">${i + 1}</text>
  <text x="${x + 44}" y="${y + 5}" font-family="${FONT}" font-size="14" fill="#0f172a">${escSvg(fit(stripEmoji(r.name), 150, 14))}</text>
  <text x="${x + cardW - 14}" y="${y + 5}" font-family="${FONT}" font-size="13" font-weight="bold" fill="#334155" text-anchor="end">${escSvg(r.value)}</text>
  <rect x="${x + 44}" y="${y + 14}" width="${cardW - 58}" height="6" rx="3" fill="#e2e8f0"/>
  <rect x="${x + 44}" y="${y + 14}" width="${Math.max(6, Math.round((cardW - 58) * Math.max(0, Math.min(1, r.score))))}" height="6" rx="3" fill="${colors[i] || '#f59e0b'}"/>`;
    }).join('\n');

  const rankTopMax = Math.max(1, ...(data.topActive || []).map(r => r.score));
  const rankRecentMax = Math.max(1, ...(data.topRecent || []).map(r => r.score));
  const topRows = renderRankRows((data.topActive || []).map(r => ({ ...r, score: r.score / rankTopMax })), colX[0], STATS_RANK_COLORS);
  const recentRows = renderRankRows((data.topRecent || []).map(r => ({ ...r, score: r.score / rankRecentMax })), colX[1], ['#22c55e', '#4ade80', '#86efac', '#16a34a', '#15803d']);

  // 最活跃的群（底部横跨卡片）
  const groupsMax = Math.max(1, ...(data.topGroups || []).map(r => r.score));
  const groupRows = (data.topGroups || []).slice(0, 5).map((r, i) => {
    const y = groupsTop + 46 + i * 52;
    return `
  <circle cx="${gridX + 20}" cy="${y}" r="13" fill="#8b5cf6"/>
  <text x="${gridX + 20}" y="${y + 5}" font-family="${FONT}" font-size="14" font-weight="bold" fill="#fff" text-anchor="middle">${i + 1}</text>
  <text x="${gridX + 44}" y="${y + 5}" font-family="${FONT}" font-size="14" fill="#0f172a">${escSvg(fit(stripEmoji(r.name), 400, 14))}</text>
  <text x="${STATS_W - gridX - 14}" y="${y + 5}" font-family="${FONT}" font-size="13" font-weight="bold" fill="#334155" text-anchor="end">${escSvg(r.value)}</text>
  <rect x="${gridX + 44}" y="${y + 14}" width="${STATS_W - gridX * 2 - 58}" height="6" rx="3" fill="#ede9fe"/>
  <rect x="${gridX + 44}" y="${y + 14}" width="${Math.max(6, Math.round((STATS_W - gridX * 2 - 58) * Math.max(0, Math.min(1, r.score / groupsMax))))}" height="6" rx="3" fill="#8b5cf6"/>`;
  }).join('\n');

  const footer = data.footer || 'QQ机器人 · 群活跃统计';
  const footText = data.elapsedMs ? `${footer} · 查询耗时${Math.round(data.elapsedMs)}ms` : footer;
  const svg = `<svg width="${STATS_W}" height="${dashH}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${STATS_W}" height="${dashH}" rx="24" fill="#ffffff"/>
  ${banner}
  ${metricCards.join('\n')}
  <rect x="${colX[0]}" y="${rankTop}" width="${cardW}" height="${rankH}" rx="14" fill="#f8fafc" stroke="#e2e8f0"/>
  <rect x="${colX[0]}" y="${rankTop + 16}" width="6" height="20" rx="3" fill="#f59e0b"/>
  <text x="${colX[0] + 20}" y="${rankTop + 32}" font-family="${FONT}" font-size="17" font-weight="bold" fill="#0f172a">最活跃成员</text>
  ${topRows || `<text x="${colX[0] + 20}" y="${rankTop + 80}" font-family="${FONT}" font-size="14" fill="#94a3b8">暂无数据</text>`}
  <rect x="${colX[1]}" y="${rankTop}" width="${cardW}" height="${rankH}" rx="14" fill="#f8fafc" stroke="#e2e8f0"/>
  <rect x="${colX[1]}" y="${rankTop + 16}" width="6" height="20" rx="3" fill="#22c55e"/>
  <text x="${colX[1] + 20}" y="${rankTop + 32}" font-family="${FONT}" font-size="17" font-weight="bold" fill="#0f172a">最近活跃成员</text>
  ${recentRows || `<text x="${colX[1] + 20}" y="${rankTop + 80}" font-family="${FONT}" font-size="14" fill="#94a3b8">暂无数据</text>`}
  <rect x="${gridX}" y="${groupsTop}" width="${STATS_W - gridX * 2}" height="${groupsH}" rx="14" fill="#f8fafc" stroke="#e2e8f0"/>
  <rect x="${gridX}" y="${groupsTop + 16}" width="6" height="20" rx="3" fill="#8b5cf6"/>
  <text x="${gridX + 20}" y="${groupsTop + 32}" font-family="${FONT}" font-size="17" font-weight="bold" fill="#0f172a">最活跃的群</text>
  ${groupRows || `<text x="${gridX + 20}" y="${groupsTop + 80}" font-family="${FONT}" font-size="14" fill="#94a3b8">暂无数据</text>`}
  <text x="${STATS_W / 2}" y="${footY}" font-family="${FONT}" font-size="13" fill="#94a3b8" text-anchor="middle">${escSvg(fit(stripEmoji(footText), STATS_W - 200, 13))}</text>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// ===== 通用菜单卡片（图片菜单模式）=====

export interface MenuCardItem {
  label: string;
  desc?: string;
}

export interface MenuCardData {
  title: string;
  avatarUrl: string;
  nickname: string;
  qq: string;
  openid: string;
  subtitle?: string;
  items: MenuCardItem[];
  footer?: string;
}

const MENU_W = 760;
const MENU_BANNER_H = 128;
const MENU_USER_H = 96;
const MENU_ROW_H = 72;
const MENU_ROW_GAP = 14;
const MENU_ITEM_COLOR = ['#3b82f6', '#22c55e', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#14b8a6', '#f97316'];

// 渲染通用菜单卡片，返回 PNG buffer。顶部发送者头像昵称 + 菜单网格 + 底部 PHP 标识。
export async function renderMenuCard(data: MenuCardData): Promise<Buffer> {
  const items = (data.items || []).slice(0, 24);
  const cols = 2;
  const rows = Math.ceil(items.length / cols);
  const itemW = (MENU_W - 48 * 2 - 14) / 2;
  const gridTop = MENU_BANNER_H + MENU_USER_H + 20;
  const gridH = rows * MENU_ROW_H + (rows - 1) * MENU_ROW_GAP;
  const cardH = gridTop + gridH + 56;

  // 头像：QQ 号可下载时内嵌，失败降级为首字母占位
  const AV_CX = 76, AV_CY = MENU_BANNER_H + 48;
  let avatarSvg = `<circle cx="${AV_CX}" cy="${AV_CY}" r="36" fill="#334155"/><text x="${AV_CX}" y="${AV_CY}" font-family="${FONT}" font-size="26" fill="#cbd5e1" text-anchor="middle" dominant-baseline="central">${escSvg(stripEmoji((data.nickname || '?').charAt(0)))}</text>`;
  if (data.avatarUrl) {
    try {
      const res = await fetch(data.avatarUrl);
      if (res && res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        const mime = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
        if (/^image\/(jpeg|png|webp|gif)$/.test(mime)) {
          avatarSvg = `<image x="${AV_CX - 36}" y="${AV_CY - 36}" width="72" height="72" preserveAspectRatio="xMidYMid slice" clip-path="url(#mAv)" href="data:${mime};base64,${buf.toString('base64')}"/>`;
        }
      }
    } catch {}
  }

  const gridItems = items.map((it, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = 48 + col * (itemW + 14);
    const y = gridTop + row * (MENU_ROW_H + MENU_ROW_GAP);
    const color = MENU_ITEM_COLOR[i % MENU_ITEM_COLOR.length];
    const label = fit(stripEmoji(it.label || '项'), itemW - 84, 22);
    const desc = it.desc ? fit(stripEmoji(it.desc), itemW - 84, 14) : '';
    return `
  <rect x="${x}" y="${y}" width="${itemW}" height="${MENU_ROW_H}" rx="14" fill="#1e293b"/>
  <circle cx="${x + 30}" cy="${y + MENU_ROW_H / 2}" r="17" fill="${color}"/>
  <text x="${x + 30}" y="${y + MENU_ROW_H / 2 + 6}" font-family="${FONT}" font-size="16" font-weight="bold" fill="#ffffff" text-anchor="middle">${i + 1}</text>
  <text x="${x + 60}" y="${y + (desc ? 30 : MENU_ROW_H / 2 + 8)}" font-family="${FONT}" font-size="22" font-weight="bold" fill="#f1f5f9">${escSvg(label)}</text>
  ${desc ? `<text x="${x + 60}" y="${y + 56}" font-family="${FONT}" font-size="14" fill="#94a3b8">${escSvg(desc)}</text>` : ''}`;
  });

  const sub = data.subtitle ? `<text x="48" y="${MENU_BANNER_H - 18}" font-family="${FONT}" font-size="15" fill="#bfdbfe">${escSvg(fit(stripEmoji(data.subtitle), MENU_W - 96, 15))}</text>` : '';
  const qqLine = fit(stripEmoji('QQ: ' + (data.qq || '未绑定') + ' · OpenID: ' + (data.openid || '-')), MENU_W - 200, 16);
  const footer = data.footer || 'QQ机器人 · 功能菜单';
  const footerText = `${stripEmoji(footer)} · ${bjTime()}`;
  const svg = `<svg width="${MENU_W}" height="${cardH}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="mBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1e3a8a"/>
      <stop offset="1" stop-color="#2563eb"/>
    </linearGradient>
    <clipPath id="mAv"><circle cx="76" cy="${MENU_BANNER_H + 48}" r="36"/></clipPath>
  </defs>
  <rect x="0" y="0" width="${MENU_W}" height="${cardH}" rx="24" fill="#0f172a"/>
  <rect x="0" y="0" width="${MENU_W}" height="${MENU_BANNER_H}" fill="url(#mBg)"/>
  <circle cx="${MENU_W - 70}" cy="20" r="90" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="22"/>
  <circle cx="${MENU_W - 40}" cy="110" r="50" fill="none" stroke="rgba(255,255,255,.10)" stroke-width="14"/>
  <text x="40" y="52" font-family="${FONT}" font-size="34" font-weight="bold" fill="#ffffff">${escSvg(fit(stripEmoji(data.title || '功能菜单'), MENU_W - 200, 34))}</text>
  <rect x="${MENU_W - 128}" y="26" width="88" height="34" rx="17" fill="rgba(255,255,255,.2)"/>
  <text x="${MENU_W - 84}" y="49" font-family="${FONT}" font-size="15" font-weight="bold" letter-spacing="2" fill="#ffffff" text-anchor="middle">MENU</text>
  ${sub}
  <line x1="40" y1="${MENU_BANNER_H - 2}" x2="${MENU_W - 40}" y2="${MENU_BANNER_H - 2}" stroke="rgba(255,255,255,.15)"/>
  <circle cx="${AV_CX}" cy="${AV_CY}" r="38" fill="#1e293b"/>
  ${avatarSvg}
  <text x="132" y="${MENU_BANNER_H + 40}" font-family="${FONT}" font-size="26" font-weight="bold" fill="#ffffff">${escSvg(fit(stripEmoji(data.nickname || '未知用户'), MENU_W - 160, 26))}</text>
  <text x="132" y="${MENU_BANNER_H + 68}" font-family="${FONT}" font-size="16" fill="#94a3b8">${escSvg(qqLine)}</text>
  <line x1="40" y1="${gridTop - 12}" x2="${MENU_W - 40}" y2="${gridTop - 12}" stroke="#1e293b"/>
  ${gridItems.join('\n')}
  <line x1="40" y1="${gridTop + gridH + 14}" x2="${MENU_W - 40}" y2="${gridTop + gridH + 14}" stroke="#1e293b"/>
  <text x="${MENU_W - 40}" y="${cardH - 18}" font-family="${FONT}" font-size="14" fill="#64748b" text-anchor="end">${escSvg(fit(footerText, MENU_W - 260, 14))}</text>
  <rect x="40" y="${cardH - 34}" width="54" height="20" rx="10" fill="#334155"/>
  <text x="67" y="${cardH - 20}" font-family="${FONT}" font-size="12" font-weight="bold" fill="#7dd3fc" text-anchor="middle">PHP</text>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export interface UpdateCardData {
  version: string;      // 更新包版本
  current: string;      // 当前部署版本
  patchUrl: string;
  fullUrl: string;
  changeLog: string;    // 更新内容
  hasUpdate: boolean;
  checkedAt?: string;   // 检查时间
  lastUpdate?: string;  // 上次更新时间
  recordCount?: number; // 更新记录条数
}

// 更新系统菜单图片：版本对比 + 更新内容 + 更新历史 + 操作命令
export async function renderUpdateCard(data: UpdateCardData): Promise<Buffer> {
  const W = 760;
  const BANNER = 128;
  const PAD_X = 40;
  // 智能断行：优先在空格处断（照顾英文命令），否则按 max 字符截断
  const wrapText = (s: string, max: number): string[] => {
    const out: string[] = [];
    let rest = s.trim();
    while (rest.length > max) {
      let cut = max;
      const sp = rest.lastIndexOf(' ', max);
      if (sp > max * 0.5) cut = sp;
      out.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest !== '') out.push(rest);
    return out;
  };
  const lines: string[] = [];
  for (const l of String(data.changeLog || '暂无更新内容').split('\n')) {
    if (l.trim() === '') { lines.push(' '); continue; }
    lines.push(...wrapText(l, 42));
  }
  const bodyH = Math.max(2, lines.length) * 26;
  const logTitleH = 36;
  const logH = logTitleH + bodyH + 16;
  const infoH = 96;
  const histH = 42;
  const cmdH = 2 * 58 + 20;
  const footerH = 40;
  const infoY0 = BANNER + 14;
  const logY0 = infoY0 + infoH + 14;
  const histY0 = logY0 + logH + 14;
  const cmdY0 = histY0 + histH + 14;
  const H = cmdY0 + cmdH + footerH;

  const has = !!data.hasUpdate;
  const status = has ? '发现新版本' : '已是最新版本';
  const statusColor = has ? '#fbbf24' : '#22c55e';
  // 检查时间精简显示 MM-DD HH:MM
  const fmtShort = (s: string): string => {
    const m = String(s || '').match(/(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
    return m ? `${m[1]}-${m[2]} ${m[3]}:${m[4]}` : String(s || '').slice(0, 12);
  };
  const checkedAt = fmtShort(data.checkedAt || bjTime());
  const lastUpdate = data.lastUpdate || '从未更新';
  const recordCount = data.recordCount || 0;

  // 版本信息三列卡
  const infoCards = [
    { label: '当前版本', value: data.current || '-', color: '#64748b', dot: '#3b82f6' },
    { label: '更新包版本', value: data.version || '-', color: has ? '#fbbf24' : '#22c55e', dot: has ? '#f59e0b' : '#22c55e' },
    { label: '检查时间', value: checkedAt, color: '#94a3b8', dot: '#8b5cf6' },
  ].map((c, i) => {
    const x = 48 + i * 236;
    return `<rect x="${x}" y="${infoY0}" width="220" height="84" rx="14" fill="#1e293b"/>
  <circle cx="${x + 26}" cy="${infoY0 + 24}" r="6" fill="${c.dot}"/>
  <text x="${x + 44}" y="${infoY0 + 30}" font-family="${FONT}" font-size="13" fill="#94a3b8">${escSvg(c.label)}</text>
  <text x="${x + 18}" y="${infoY0 + 68}" font-family="${FONT}" font-size="26" font-weight="bold" fill="${c.color}">${escSvg(fit(stripEmoji(c.value), 190, 26))}</text>`;
  }).join('\n');

  // 更新内容
  const logRows = lines.map((l, i) =>
    `<text x="${PAD_X + 18}" y="${logY0 + logTitleH + 20 + i * 26}" font-family="${FONT}" font-size="15" fill="${l === ' ' ? '#1e293b' : '#a5b4cf'}">${escSvg(fit(stripEmoji(l), W - 2 * PAD_X - 36, 15))}</text>`).join('\n');

  // 更新历史行
  const hist = `<rect x="${PAD_X}" y="${histY0}" width="${W - 2 * PAD_X}" height="34" rx="12" fill="#1e293b"/>
  <text x="${PAD_X + 16}" y="${histY0 + 22}" font-family="${FONT}" font-size="14" fill="#94a3b8">上次更新 ${escSvg(fit(stripEmoji(lastUpdate), 300, 14))}</text>
  <text x="${W - PAD_X - 16}" y="${histY0 + 22}" font-family="${FONT}" font-size="14" fill="#94a3b8" text-anchor="end">更新记录 ${recordCount} 条</text>`;

  // 命令按钮 2x2
  const cmdRows = [
    { label: '更新补丁', desc: '下载补丁包升级' },
    { label: '更新全量', desc: '下载全量包升级' },
    { label: '检查更新', desc: '对比版本状态' },
    { label: '更新记录', desc: '查看更新历史' },
  ].map((c, i) => {
    const x = 48 + (i % 2) * 340;
    const y = cmdY0 + 20 + Math.floor(i / 2) * 58;
    const color = MENU_ITEM_COLOR[i % MENU_ITEM_COLOR.length];
    return `<rect x="${x}" y="${y}" width="318" height="46" rx="10" fill="#1e293b"/>
  <circle cx="${x + 24}" cy="${y + 23}" r="11" fill="${color}"/>
  <text x="${x + 44}" y="${y + 28}" font-family="${FONT}" font-size="16" font-weight="bold" fill="#f1f5f9">${escSvg(c.label)}</text>
  <text x="${x + 118}" y="${y + 28}" font-family="${FONT}" font-size="12" fill="#64748b">${escSvg(c.desc)}</text>`;
  }).join('\n');

  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="uBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1e1b4b"/>
      <stop offset="0.55" stop-color="#312e81"/>
      <stop offset="1" stop-color="#4c1d95"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${W}" height="${H}" rx="24" fill="#0f172a"/>
  <rect x="0" y="0" width="${W}" height="${BANNER}" fill="url(#uBg)"/>
  <circle cx="${W - 52}" cy="24" r="92" fill="none" stroke="rgba(255,255,255,.10)" stroke-width="24"/>
  <circle cx="${W - 120}" cy="108" r="56" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="16"/>
  <text x="40" y="54" font-family="${FONT}" font-size="34" font-weight="bold" fill="#ffffff">更新系统</text>
  <text x="42" y="86" font-family="${FONT}" font-size="14" letter-spacing="3" fill="#c4b5fd">UPDATE SYSTEM</text>
  <rect x="${W - 176}" y="32" width="136" height="36" rx="18" fill="${has ? 'rgba(251,191,36,.16)' : 'rgba(34,197,94,.16)'}" stroke="${statusColor}" stroke-width="1.5"/>
  <text x="${W - 108}" y="56" font-family="${FONT}" font-size="15" font-weight="bold" fill="${statusColor}" text-anchor="middle">${escSvg(status)}</text>
  <text x="40" y="116" font-family="${FONT}" font-size="13" fill="#93a4f7">仅超级主人可操作 · 自动下载/解压/重启</text>
  ${infoCards}
  <rect x="${PAD_X}" y="${logY0}" width="${W - 2 * PAD_X}" height="${logH}" rx="14" fill="#1e293b"/>
  <text x="${PAD_X + 16}" y="${logY0 + 26}" font-family="${FONT}" font-size="17" font-weight="bold" fill="#e2e8f0">更新内容</text>
  <line x1="${PAD_X + 16}" y1="${logY0 + 36}" x2="${W - PAD_X - 16}" y2="${logY0 + 36}" stroke="#334155"/>
  ${logRows}
  ${hist}
  <rect x="${PAD_X}" y="${cmdY0}" width="${W - 2 * PAD_X}" height="${cmdH}" rx="14" fill="#111c30"/>
  <text x="${PAD_X + 16}" y="${cmdY0 + 16}" font-family="${FONT}" font-size="13" font-weight="bold" fill="#64748b">操作命令</text>
  ${cmdRows}
  <text x="${W - PAD_X}" y="${H - 14}" font-family="${FONT}" font-size="13" fill="#64748b" text-anchor="end">QQ机器人 · 更新系统 · ${bjTime()}</text>
  <rect x="40" y="${H - 32}" width="54" height="20" rx="10" fill="#334155"/>
  <text x="67" y="${H - 18}" font-family="${FONT}" font-size="12" font-weight="bold" fill="#7dd3fc" text-anchor="middle">PHP</text>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export interface BotStatusCardData {
  ok?: boolean;          // false = 错误状态图
  error?: string;        // ok=false 时的错误信息
  status: string;        // 状态文字：运行中 / 已重启 / 异常
  version: string;       // 当前部署版本
  uptimeText: string;    // 运行时长
  port: string;          // 监听端口
  pid: string;           // 进程 PID
  memory: string;        // 内存占用
  nodeVersion: string;   // Node 版本
  pluginCount: string;   // 插件数
  groupCount: string;    // 群数
  botName: string;       // 机器人名称
  checkedAt?: string;    // 检查时间
}

// 生成「机器人状态」卡片图：重启/自启后广播到全群；失败时渲染错误图
export async function renderBotStatusCard(data: BotStatusCardData): Promise<Buffer> {
  const W = 760;
  const BANNER = 128;
  const PAD_X = 40;
  const isErr = data.ok === false;
  const infoY0 = BANNER + 16;
  const infoH = 92;
  const rowsY0 = infoY0 + infoH + 18;

  const rows: { label: string; value: string }[] = [
    { label: '进程 PID', value: data.pid || '-' },
    { label: '内存占用', value: data.memory || '-' },
    { label: 'Node 版本', value: data.nodeVersion || '-' },
    { label: '插件数量', value: data.pluginCount || '-' },
    { label: '所在群数', value: data.groupCount || '-' },
    { label: '机器人', value: data.botName || '-' },
  ];
  const rowH = 34;
  const rowsH = rows.length * rowH + 8;
  const footerH = 42;
  const H = rowsY0 + rowsH + footerH;

  const grad = isErr ? ['#7f1d1d', '#991b1b', '#450a0a'] : ['#064e3b', '#047857', '#134e4a'];
  const statusColor = isErr ? '#f87171' : '#34d399';
  const statusText = isErr ? '重启失败' : (data.status || '运行中');

  // 三列信息卡
  const infoCards = [
    { label: '部署版本', value: data.version || '-', dot: '#3b82f6' },
    { label: '运行时长', value: data.uptimeText || '-', dot: '#8b5cf6' },
    { label: '监听端口', value: data.port || '-', dot: '#f59e0b' },
  ].map((c, i) => {
    const x = 48 + i * 236;
    return `<rect x="${x}" y="${infoY0}" width="220" height="84" rx="14" fill="#1e293b"/>
  <circle cx="${x + 26}" cy="${infoY0 + 24}" r="6" fill="${c.dot}"/>
  <text x="${x + 44}" y="${infoY0 + 30}" font-family="${FONT}" font-size="13" fill="#94a3b8">${escSvg(c.label)}</text>
  <text x="${x + 18}" y="${infoY0 + 68}" font-family="${FONT}" font-size="24" font-weight="bold" fill="#e2e8f0">${escSvg(fit(stripEmoji(c.value), 190, 24))}</text>`;
  }).join('\n');

  const rowSvgs = rows.map((r, i) => {
    const y = rowsY0 + 24 + i * rowH;
    return `<text x="${PAD_X + 16}" y="${y}" font-family="${FONT}" font-size="15" fill="#94a3b8">${escSvg(r.label)}</text>
  <text x="${PAD_X + 16 + 120}" y="${y}" font-family="${FONT}" font-size="15" fill="#e2e8f0">${escSvg(fit(stripEmoji(r.value), W - 2 * PAD_X - 160, 15))}</text>`;
  }).join('\n');

  const errBlock = isErr && data.error ? (() => {
    const msg = fit(stripEmoji(data.error), W - 2 * PAD_X - 40, 14);
    return `<rect x="${PAD_X}" y="${rowsY0 + rowsH + 2}" width="${W - 2 * PAD_X}" height="44" rx="12" fill="#450a0a" stroke="#7f1d1d"/>
  <text x="${PAD_X + 16}" y="${rowsY0 + rowsH + 30}" font-family="${FONT}" font-size="14" fill="#fecaca">${escSvg(msg)}</text>`;
  })() : '';

  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="sBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${grad[0]}"/>
      <stop offset="0.55" stop-color="${grad[1]}"/>
      <stop offset="1" stop-color="${grad[2]}"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${W}" height="${H}" rx="24" fill="#0f172a"/>
  <rect x="0" y="0" width="${W}" height="${BANNER}" fill="url(#sBg)"/>
  <circle cx="${W - 52}" cy="24" r="92" fill="none" stroke="rgba(255,255,255,.10)" stroke-width="24"/>
  <circle cx="${W - 120}" cy="108" r="56" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="16"/>
  <text x="40" y="54" font-family="${FONT}" font-size="34" font-weight="bold" fill="#ffffff">机器人状态</text>
  <text x="42" y="86" font-family="${FONT}" font-size="14" letter-spacing="3" fill="rgba(255,255,255,.7)">BOT STATUS</text>
  <rect x="${W - 176}" y="32" width="136" height="36" rx="18" fill="rgba(255,255,255,.12)" stroke="${statusColor}" stroke-width="1.5"/>
  <text x="${W - 108}" y="56" font-family="${FONT}" font-size="15" font-weight="bold" fill="${statusColor}" text-anchor="middle">${escSvg(statusText)}</text>
  <text x="40" y="116" font-family="${FONT}" font-size="13" fill="rgba(255,255,255,.6)">${isErr ? '重启/自启过程中发生错误' : '机器人运行状态一览 · 启动后自动广播'}</text>
  ${infoCards}
  <rect x="${PAD_X}" y="${rowsY0}" width="${W - 2 * PAD_X}" height="${rowsH}" rx="14" fill="#111c30"/>
  ${rowSvgs}
  ${errBlock}
  <text x="${W - PAD_X}" y="${H - 14}" font-family="${FONT}" font-size="13" fill="#64748b" text-anchor="end">QQ机器人 · ${data.checkedAt || bjTime()}</text>
  <rect x="40" y="${H - 32}" width="54" height="20" rx="10" fill="#334155"/>
  <text x="67" y="${H - 18}" font-family="${FONT}" font-size="12" font-weight="bold" fill="#7dd3fc" text-anchor="middle">PHP</text>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export interface TextCardData {
  title?: string;   // 顶部标题，默认「定时播报」
  text: string;     // 播报正文（多行）
  footer?: string;  // 底部文字，默认当前时间
}

// 将播报文本渲染为 PNG：定时任务选择「图片」发送时使用
export async function renderTextCard(data: TextCardData): Promise<Buffer> {
  const W = 760;
  const PAD_X = 40;
  const BANNER = 108;
  const LINE_H = 30;
  const FONT_SIZE = 18;
  const maxW = W - 2 * PAD_X - 36;
  const cw = (ch: string) => /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch) ? FONT_SIZE : FONT_SIZE * 0.6;
  const wrap = (s: string): string[] => {
    const out: string[] = [];
    let line = '';
    let total = 0;
    for (const ch of String(s || '')) {
      const wch = cw(ch);
      if (total + wch > maxW && line !== '') {
        out.push(line);
        line = ch;
        total = wch;
      } else {
        line += ch;
        total += wch;
      }
    }
    if (line !== '') out.push(line);
    return out;
  };
  const lines: string[] = [];
  for (const l of String(data.text || '').split('\n')) {
    if (l.trim() === '') { lines.push(' '); continue; }
    lines.push(...wrap(stripEmoji(l)));
  }
  const bodyH = Math.max(2, lines.length) * LINE_H + 20;
  const footerH = 44;
  const H = BANNER + bodyH + footerH;
  const title = stripEmoji(data.title || '定时播报');
  const footer = data.footer || bjTime();

  const bodyRows = lines.map((l, i) =>
    `<text x="${PAD_X + 18}" y="${BANNER + 34 + i * LINE_H}" font-family="${FONT}" font-size="${FONT_SIZE}" fill="${l === ' ' ? '#1e293b' : '#dbe3f0'}">${escSvg(fit(stripEmoji(l), maxW, FONT_SIZE))}</text>`).join('\n');

  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="tBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1e3a8a"/>
      <stop offset="1" stop-color="#2563eb"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${W}" height="${H}" rx="24" fill="#0f172a"/>
  <rect x="0" y="0" width="${W}" height="${BANNER}" fill="url(#tBg)"/>
  <circle cx="${W - 52}" cy="20" r="90" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="22"/>
  <circle cx="${W - 40}" cy="108" r="50" fill="none" stroke="rgba(255,255,255,.10)" stroke-width="14"/>
  <text x="40" y="58" font-family="${FONT}" font-size="32" font-weight="bold" fill="#ffffff">${escSvg(fit(title, W - 200, 32))}</text>
  <text x="42" y="88" font-family="${FONT}" font-size="13" letter-spacing="3" fill="rgba(255,255,255,.7)">SCHEDULED BROADCAST</text>
  <rect x="${PAD_X}" y="${BANNER + 8}" width="${W - 2 * PAD_X}" height="${bodyH}" rx="14" fill="#111c30"/>
  ${bodyRows}
  <text x="${W - PAD_X}" y="${H - 14}" font-family="${FONT}" font-size="13" fill="#64748b" text-anchor="end">QQ机器人 · ${escSvg(fit(stripEmoji(footer), 360, 13))}</text>
  <rect x="40" y="${H - 34}" width="54" height="20" rx="10" fill="#334155"/>
  <text x="67" y="${H - 20}" font-family="${FONT}" font-size="12" font-weight="bold" fill="#7dd3fc" text-anchor="middle">PHP</text>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
