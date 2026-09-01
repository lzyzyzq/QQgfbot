// 群活跃统计聚合模块
// 基于本地 system_logs / group_members / groups 表聚合单群活跃数据，
// 供「群信息」看板卡片渲染使用（不依赖无权限的 QQ 群信息接口）
import { getDb } from '../db/index';
import { createLogger } from '../utils/logger';

const logger = createLogger('group-stats');

export interface DashboardMetric {
  label: string;
  value: string;
  sub?: string;
  delta?: string;
  deltaUp?: boolean;
  color: string;
}

export interface DashboardTopItem {
  name: string;
  masked: string;
  count: number;
}

export interface DashboardRecentItem {
  name: string;
  masked: string;
  lastSeen: string;
}

export interface GroupDashboardData {
  groupName: string;
  groupId: string;
  date: string;
  until: string;
  metrics: DashboardMetric[];
  topUsers: DashboardTopItem[];
  recentUsers: DashboardRecentItem[];
  elapsedMs: number;
}

export interface GroupRankItem {
  groupId: string;
  name: string;
  groupNumber: string;
  count: number;
}

export interface GroupStatsFull {
  groupName: string;
  groupId: string;
  date: string;
  until: string;
  metrics: DashboardMetric[];
  topUsers: DashboardTopItem[];
  recentUsers: DashboardRecentItem[];
  groupRanking: GroupRankItem[];
  elapsedMs: number;
}

const pad = (n: number | string) => String(n).padStart(2, '0');

function maskId(id: string): string {
  const s = String(id || '');
  if (s.length <= 8) return s;
  return s.slice(0, 3) + '****' + s.slice(-3);
}

function fmtCount(n: number): string {
  return n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, '') + 'w' : String(n);
}

export function collectGroupStats(groupOpenid: string): GroupDashboardData {
  const t0 = Date.now();
  const db = getDb();
  try {
    const g = db.prepare('SELECT name FROM groups WHERE id = ?').get(groupOpenid) as any;
    const groupName = g?.name || '未命名群';

    const today = "date(created_at,'localtime') = date('now','localtime')";
    const yest = "date(created_at,'localtime') = date('now','localtime','-1 day')";
    const week = "date(created_at,'localtime') >= date('now','localtime','-6 days')";

    const sc = (sql: string, ...args: any[]): number => {
      try { const r = db.prepare(sql).get(...args) as any; return r?.c || 0; } catch { return 0; }
    };

    const memberCount = sc(`SELECT COUNT(*) c FROM group_members WHERE group_id = ?`, groupOpenid);
    const todayActive = sc(`SELECT COUNT(*) c FROM group_members WHERE group_id = ? AND date(last_seen,'localtime') = date('now','localtime')`, groupOpenid);
    const todayMsgs = sc(`SELECT COUNT(*) c FROM system_logs WHERE category='message' AND group_id = ? AND ${today}`, groupOpenid);
    const yestMsgs = sc(`SELECT COUNT(*) c FROM system_logs WHERE category='message' AND group_id = ? AND ${yest}`, groupOpenid);
    const todaySends = sc(`SELECT COUNT(*) c FROM system_logs WHERE category='send' AND group_id = ? AND ${today}`, groupOpenid);
    const yestSends = sc(`SELECT COUNT(*) c FROM system_logs WHERE category='send' AND group_id = ? AND ${yest}`, groupOpenid);
    const weekMsgs = sc(`SELECT COUNT(*) c FROM system_logs WHERE category='message' AND group_id = ? AND ${week}`, groupOpenid);
    const todayJoined = sc(`SELECT COUNT(*) c FROM system_logs WHERE category='member' AND message='群成员加入' AND group_id = ? AND ${today}`, groupOpenid);
    const todayLeft = sc(`SELECT COUNT(*) c FROM system_logs WHERE category='member' AND message='群成员退出' AND group_id = ? AND ${today}`, groupOpenid);

    // 最近活跃时段：今日该群消息按小时分布取峰值
    let peakHour = '--';
    let peakCount = 0;
    try {
      const hr = db.prepare(
        `SELECT strftime('%H', created_at, 'localtime') h, COUNT(*) c FROM system_logs
         WHERE category='message' AND group_id = ? AND ${today} GROUP BY h ORDER BY c DESC LIMIT 1`
      ).get(groupOpenid) as any;
      if (hr) { peakHour = String(hr.h); peakCount = hr.c || 0; }
    } catch {}

    // 群内今日最活跃成员 Top3
    const topUsers: DashboardTopItem[] = [];
    try {
      const rows = db.prepare(
        `SELECT user_id, COUNT(*) c FROM system_logs
         WHERE category='message' AND group_id = ? AND ${today} AND user_id != '' AND user_id IS NOT NULL
         GROUP BY user_id ORDER BY c DESC LIMIT 3`
      ).all(groupOpenid) as any[];
      for (const r of rows) {
        const gm = db.prepare('SELECT nickname, qq_id FROM group_members WHERE group_id = ? AND member_openid = ?').get(groupOpenid, r.user_id) as any;
        const name = (gm?.nickname || gm?.qq_id || maskId(r.user_id)).substring(0, 12);
        topUsers.push({ name, masked: maskId(r.user_id), count: r.c });
      }
    } catch {}

    // 最近活跃成员 Top3
    const recentUsers: DashboardRecentItem[] = [];
    try {
      const rows = db.prepare(
        'SELECT member_openid, nickname, qq_id, last_seen FROM group_members WHERE group_id = ? ORDER BY last_seen DESC LIMIT 3'
      ).all(groupOpenid) as any[];
      for (const r of rows) {
        const name = (r.nickname || r.qq_id || maskId(r.member_openid || '')).substring(0, 12);
        let seen = '--:--';
        try { seen = new Date(String(r.last_seen) + 'Z').toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }); } catch {}
        recentUsers.push({ name, masked: maskId(r.member_openid || ''), lastSeen: seen });
      }
    } catch {}

    const mkDelta = (cur: number, prev: number): { delta: string; deltaUp: boolean } | undefined => {
      if (prev <= 0) return undefined;
      const diff = cur - prev;
      return { delta: (diff >= 0 ? '+' : '') + diff, deltaUp: diff >= 0 };
    };

    const now = new Date();
    const dMsgs = mkDelta(todayMsgs, yestMsgs);
    const dSends = mkDelta(todaySends, yestSends);

    const metrics: DashboardMetric[] = [
      { label: '群成员数', value: fmtCount(memberCount), color: '#3b82f6' },
      { label: '今日活跃成员', value: fmtCount(todayActive), color: '#22c55e' },
      { label: '今日消息数', value: fmtCount(todayMsgs), delta: dMsgs?.delta, deltaUp: dMsgs?.deltaUp, color: '#8b5cf6' },
      { label: '机器人回复', value: fmtCount(todaySends), delta: dSends?.delta, deltaUp: dSends?.deltaUp, color: '#f59e0b' },
      { label: '本周消息数', value: fmtCount(weekMsgs), color: '#06b6d4' },
      { label: '最近活跃时段', value: peakHour === '--' ? '--' : peakHour + ':00', sub: peakCount ? peakCount + '条' : '', color: '#ec4899' },
      { label: '今日加群', value: fmtCount(todayJoined), color: '#10b981' },
      { label: '今日退群', value: fmtCount(todayLeft), color: '#f43f5e' },
    ];

    return {
      groupName,
      groupId: groupOpenid,
      date: pad(now.getMonth() + 1) + '-' + pad(now.getDate()),
      until: pad(now.getHours()) + ':' + pad(now.getMinutes()),
      metrics,
      topUsers,
      recentUsers,
      elapsedMs: Date.now() - t0,
    };
  } catch (e: any) {
    logger.error(`collectGroupStats error: ${e.message}`);
    const now = new Date();
    return {
      groupName: '未命名群',
      groupId: groupOpenid,
      date: pad(now.getMonth() + 1) + '-' + pad(now.getDate()),
      until: pad(now.getHours()) + ':' + pad(now.getMinutes()),
      metrics: [],
      topUsers: [],
      recentUsers: [],
      elapsedMs: Date.now() - t0,
    };
  }
}

// 跨群活跃排行：今日各群消息数 TopN（排除空 group_id）
export function collectGroupRanking(limit = 5): GroupRankItem[] {
  const db = getDb();
  try {
    const today = "date(created_at,'localtime') = date('now','localtime')";
    const rows = db.prepare(
      `SELECT group_id, COUNT(*) c FROM system_logs
       WHERE category='message' AND group_id != '' AND group_id IS NOT NULL AND ${today}
       GROUP BY group_id ORDER BY c DESC LIMIT ?`
    ).all(limit) as any[];
    return rows.map((r) => {
      let name = '';
      let groupNumber = '';
      try {
        const g = db.prepare('SELECT name, group_number FROM groups WHERE id = ?').get(r.group_id) as any;
        if (g) { name = g.name || ''; groupNumber = String(g.group_number || ''); }
      } catch {}
      return { groupId: String(r.group_id), name, groupNumber, count: r.c || 0 };
    });
  } catch {
    return [];
  }
}

// 完整单群活跃统计（PHP「群信息」插件用，数据与旧版看板同源）：
// metrics 8 项 + 最活跃成员 Top5 + 最近活跃成员 Top5 + 跨群排行 Top5
export function collectGroupStatsFull(groupOpenid: string): GroupStatsFull {
  const t0 = Date.now();
  const db = getDb();
  try {
    const g = db.prepare('SELECT name FROM groups WHERE id = ?').get(groupOpenid) as any;
    const groupName = g?.name || '未命名群';

    const today = "date(created_at,'localtime') = date('now','localtime')";
    const yest = "date(created_at,'localtime') = date('now','localtime','-1 day')";
    const week = "date(created_at,'localtime') >= date('now','localtime','-6 days')";

    const sc = (sql: string, ...args: any[]): number => {
      try { const r = db.prepare(sql).get(...args) as any; return r?.c || 0; } catch { return 0; }
    };

    const memberCount = sc(`SELECT COUNT(*) c FROM group_members WHERE group_id = ?`, groupOpenid);
    const todayActive = sc(`SELECT COUNT(*) c FROM group_members WHERE group_id = ? AND date(last_seen,'localtime') = date('now','localtime')`, groupOpenid);
    const todayMsgs = sc(`SELECT COUNT(*) c FROM system_logs WHERE category='message' AND group_id = ? AND ${today}`, groupOpenid);
    const yestMsgs = sc(`SELECT COUNT(*) c FROM system_logs WHERE category='message' AND group_id = ? AND ${yest}`, groupOpenid);
    const todaySends = sc(`SELECT COUNT(*) c FROM system_logs WHERE category='send' AND group_id = ? AND ${today}`, groupOpenid);
    const yestSends = sc(`SELECT COUNT(*) c FROM system_logs WHERE category='send' AND group_id = ? AND ${yest}`, groupOpenid);
    const weekMsgs = sc(`SELECT COUNT(*) c FROM system_logs WHERE category='message' AND group_id = ? AND ${week}`, groupOpenid);
    const todayJoined = sc(`SELECT COUNT(*) c FROM system_logs WHERE category='member' AND message='群成员加入' AND group_id = ? AND ${today}`, groupOpenid);
    const todayLeft = sc(`SELECT COUNT(*) c FROM system_logs WHERE category='member' AND message='群成员退出' AND group_id = ? AND ${today}`, groupOpenid);

    let peakHour = '--';
    let peakCount = 0;
    try {
      const hr = db.prepare(
        `SELECT strftime('%H', created_at, 'localtime') h, COUNT(*) c FROM system_logs
         WHERE category='message' AND group_id = ? AND ${today} GROUP BY h ORDER BY c DESC LIMIT 1`
      ).get(groupOpenid) as any;
      if (hr) { peakHour = String(hr.h); peakCount = hr.c || 0; }
    } catch {}

    const topUsers: DashboardTopItem[] = [];
    try {
      const rows = db.prepare(
        `SELECT user_id, COUNT(*) c FROM system_logs
         WHERE category='message' AND group_id = ? AND ${today} AND user_id != '' AND user_id IS NOT NULL
         GROUP BY user_id ORDER BY c DESC LIMIT 5`
      ).all(groupOpenid) as any[];
      for (const r of rows) {
        const gm = db.prepare('SELECT nickname, qq_id FROM group_members WHERE group_id = ? AND member_openid = ?').get(groupOpenid, r.user_id) as any;
        const name = (gm?.nickname || gm?.qq_id || maskId(r.user_id)).substring(0, 12);
        topUsers.push({ name, masked: maskId(r.user_id), count: r.c });
      }
    } catch {}

    const recentUsers: DashboardRecentItem[] = [];
    try {
      const rows = db.prepare(
        'SELECT member_openid, nickname, qq_id, last_seen FROM group_members WHERE group_id = ? ORDER BY last_seen DESC LIMIT 5'
      ).all(groupOpenid) as any[];
      for (const r of rows) {
        const name = (r.nickname || r.qq_id || maskId(r.member_openid || '')).substring(0, 12);
        let seen = '--:--';
        try { seen = new Date(String(r.last_seen) + 'Z').toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }); } catch {}
        recentUsers.push({ name, masked: maskId(r.member_openid || ''), lastSeen: seen });
      }
    } catch {}

    const mkDelta = (cur: number, prev: number): { delta: string; deltaUp: boolean } | undefined => {
      if (prev <= 0) return undefined;
      const diff = cur - prev;
      return { delta: (diff >= 0 ? '+' : '') + diff, deltaUp: diff >= 0 };
    };

    const now = new Date();
    const dMsgs = mkDelta(todayMsgs, yestMsgs);
    const dSends = mkDelta(todaySends, yestSends);

    const metrics: DashboardMetric[] = [
      { label: '群成员数', value: fmtCount(memberCount), color: '#3b82f6' },
      { label: '今日活跃成员', value: fmtCount(todayActive), color: '#22c55e' },
      { label: '今日消息数', value: fmtCount(todayMsgs), delta: dMsgs?.delta, deltaUp: dMsgs?.deltaUp, color: '#8b5cf6' },
      { label: '机器人回复', value: fmtCount(todaySends), delta: dSends?.delta, deltaUp: dSends?.deltaUp, color: '#f59e0b' },
      { label: '本周消息数', value: fmtCount(weekMsgs), color: '#06b6d4' },
      { label: '最近活跃时段', value: peakHour === '--' ? '--' : peakHour + ':00', sub: peakCount ? peakCount + '条' : '', color: '#ec4899' },
      { label: '今日加群', value: fmtCount(todayJoined), color: '#10b981' },
      { label: '今日退群', value: fmtCount(todayLeft), color: '#f43f5e' },
    ];

    return {
      groupName,
      groupId: groupOpenid,
      date: pad(now.getMonth() + 1) + '-' + pad(now.getDate()),
      until: pad(now.getHours()) + ':' + pad(now.getMinutes()),
      metrics,
      topUsers,
      recentUsers,
      groupRanking: collectGroupRanking(5),
      elapsedMs: Date.now() - t0,
    };
  } catch (e: any) {
    logger.error(`collectGroupStatsFull error: ${e.message}`);
    const now = new Date();
    return {
      groupName: '未命名群',
      groupId: groupOpenid,
      date: pad(now.getMonth() + 1) + '-' + pad(now.getDate()),
      until: pad(now.getHours()) + ':' + pad(now.getMinutes()),
      metrics: [],
      topUsers: [],
      recentUsers: [],
      groupRanking: [],
      elapsedMs: Date.now() - t0,
    };
  }
}
