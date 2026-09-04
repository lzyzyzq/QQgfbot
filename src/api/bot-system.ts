import { Router, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { getDb, getConfig, setConfig } from '../db/index';
import { createLogger } from '../utils/logger';
import { getBot, getBotInstance } from '../core/bot';
import { renderGroupStatsCard, renderUpdateCard, renderBotStatusCard } from '../core/card';
import { sendReply as sendPhpReply } from '../core/php-plugin';
import { collectGroupStatsFull, collectGroupRanking } from '../core/group-stats';
import { loadAdminRoleByQQ } from '../core/napcat';
import {
  getSwitchStates,
  setSwitchState,
  listScheduleTasks,
  createScheduleTask,
  updateScheduleTask,
  deleteScheduleTask,
  toggleScheduleTask,
} from '../shared/bot-controls';

// 机器人插件专用系统信息接口（仅允许本机调用）
// 机器人端"版本/更新日志/运行时间"通过该接口与网页后端共享同一数据源
const router = Router();
const logger = createLogger('bot-system');

// 城市中文名 → 拼音（wttr.in 仅支持拼音/英文城市）
const CITY_MAP: Record<string, string> = {
  '北京': 'Beijing', '上海': 'Shanghai', '广州': 'Guangzhou', '深圳': 'Shenzhen',
  '成都': 'Chengdu', '重庆': 'Chongqing', '杭州': 'Hangzhou', '武汉': 'Wuhan',
  '西安': 'Xi_an', '南京': 'Nanjing', '天津': 'Tianjin', '苏州': 'Suzhou',
  '长沙': 'Changsha', '郑州': 'Zhengzhou', '东莞': 'Dongguan', '青岛': 'Qingdao',
  '沈阳': 'Shenyang', '昆明': 'Kunming', '大连': 'Dalian', '厦门': 'Xiamen',
  '福州': 'Fuzhou', '哈尔滨': 'Haerbin', '济南': 'Jinan', '南宁': 'Nanning',
  '长春': 'Changchun', '石家庄': 'Shijiazhuang', '太原': 'Taiyuan', '贵阳': 'Guiyang',
  '南昌': 'Nanchang', '合肥': 'Hefei', '兰州': 'Lanzhou', '三亚': 'Sanya',
  '香港': 'Hongkong', '澳门': 'Macau', '台北': 'Taipei', '佛山': 'Foshan',
  '宁波': 'Ningbo', '无锡': 'Wuxi', '珠海': 'Zhuhai', '海口': 'Haikou',
};

// 城市 → 所在省级行政区名称（用于匹配中国天气网省级预警）
const CITY_PROVINCE: Record<string, string> = {
  '北京': '北京市', '上海': '上海市', '重庆': '重庆市', '天津': '天津市',
  '广州': '广东省', '深圳': '广东省', '东莞': '广东省', '佛山': '广东省', '珠海': '广东省',
  '成都': '四川省', '杭州': '浙江省', '宁波': '浙江省',
  '武汉': '湖北省', '西安': '陕西省', '南京': '江苏省', '苏州': '江苏省', '无锡': '江苏省',
  '长沙': '湖南省', '郑州': '河南省', '青岛': '山东省', '济南': '山东省',
  '沈阳': '辽宁省', '大连': '辽宁省', '厦门': '福建省', '福州': '福建省',
  '哈尔滨': '黑龙江省', '南宁': '广西壮族自治区', '长春': '吉林省',
  '石家庄': '河北省', '太原': '山西省', '贵阳': '贵州省', '南昌': '江西省',
  '合肥': '安徽省', '兰州': '甘肃省', '三亚': '海南省', '海口': '海南省',
  '昆明': '云南省',
};

// worldweatheronline weatherCode → 中文天气描述
const WEATHER_CODES: Record<string, string> = {
  '113': '☀️ 晴', '116': '⛅ 多云', '119': '☁️ 阴', '122': '☁️ 阴天',
  '143': '🌫 薄雾', '148': '🌫 烟雾', '149': '🌫 烟霾', '176': '🌦 零星小雨', '179': '🌨 零星小雪',
  '182': '🌧 零星冻雨', '185': '🌧 零星冻毛毛雨', '200': '⛈ 雷阵雨', '227': '🌬 吹雪',
  '230': '❄️ 暴风雪', '248': '🌫 雾', '260': '🌫 冻雾', '263': '🌦 小毛毛雨',
  '266': '🌧 毛毛雨', '281': '🌧 冻毛毛雨', '284': '🌧 强冻毛毛雨', '293': '🌦 小阵雨',
  '296': '🌧 小雨', '299': '🌧 中雨', '302': '🌧 中雨', '305': '🌧 大雨',
  '308': '🌧 大雨', '311': '🌧 小冻雨', '314': '🌧 中到大冻雨', '317': '🌧 小冻雨',
  '320': '🌧 中到大冻雨', '323': '🌨 小阵雪', '326': '❄️ 小雪', '329': '🌨 中雪',
  '332': '❄️ 中雪', '335': '❄️ 大雪', '338': '❄️ 大雪', '350': '🌨 冰粒',
  '353': '🌦 小阵雨', '356': '🌧 中到大阵雨', '359': '🌧 强阵雨', '362': '🌧 小阵冻雨',
  '365': '🌧 中到大阵冻雨', '368': '🌨 小阵雪', '371': '🌨 中到大阵雪', '374': '🌨 小阵冰粒',
  '377': '🌨 中到大阵冰粒', '386': '⛈ 雷阵小雨', '389': '⛈ 雷阵雨', '392': '⛈ 雷阵小雪',
  '395': '⛈ 雷阵大雪',
};

// Open-Meteo 数据源（免费无 Key，支持 5 天预报）：常用城市坐标
const OPENM_COORDS: Record<string, [number, number]> = {
  '北京': [39.9042, 116.4074], '上海': [31.2304, 121.4737], '广州': [23.1291, 113.2644], '深圳': [22.5431, 114.0579],
  '成都': [30.5728, 104.0668], '重庆': [29.563, 106.5516], '杭州': [30.2741, 120.1551], '武汉': [30.5928, 114.3055],
  '西安': [34.3416, 108.9398], '南京': [32.0603, 118.7969], '天津': [39.3434, 117.3616], '苏州': [31.2989, 120.5853],
  '长沙': [28.2282, 112.9388], '郑州': [34.7466, 113.6254], '东莞': [23.0207, 113.7518], '青岛': [36.0671, 120.3826],
  '沈阳': [41.8057, 123.4315], '昆明': [25.0389, 102.7183], '大连': [38.914, 121.6147], '厦门': [24.4798, 118.0894],
  '福州': [26.0745, 119.2965], '哈尔滨': [45.8038, 126.535], '济南': [36.6512, 117.1201], '南宁': [22.817, 108.3669],
  '长春': [43.8171, 125.3235], '石家庄': [38.0428, 114.5149], '太原': [37.8706, 112.5489], '贵阳': [26.647, 106.6302],
  '南昌': [28.682, 115.8579], '合肥': [31.8206, 117.2272], '兰州': [36.0611, 103.8343], '三亚': [18.2528, 109.5119],
  '香港': [22.3193, 114.1694], '澳门': [22.1987, 113.5439], '台北': [25.033, 121.5654], '佛山': [23.0218, 113.1219],
  '宁波': [29.8683, 121.544], '无锡': [31.4912, 120.3119], '珠海': [22.2707, 113.5767], '海口': [20.0444, 110.1995],
};

// Open-Meteo WMO 天气代码 → 中文天气描述
const WMO_CODES: Record<string, string> = {
  '0': '☀️ 晴', '1': '🌤 基本晴朗', '2': '⛅ 局部多云', '3': '☁️ 阴',
  '45': '🌫 雾', '48': '🌫 冻雾',
  '51': '🌦 小毛毛雨', '53': '🌦 毛毛雨', '55': '🌧 中毛毛雨',
  '56': '🌧 冻毛毛雨', '57': '🌧 强冻毛毛雨',
  '61': '🌧 小雨', '63': '🌧 中雨', '65': '🌧 大雨',
  '66': '🌧 冻雨', '67': '🌧 强冻雨',
  '71': '❄️ 小雪', '73': '❄️ 中雪', '75': '❄️ 大雪', '77': '🌨 雪粒',
  '80': '🌦 小阵雨', '81': '🌧 中阵雨', '82': '🌧 强阵雨',
  '85': '🌨 小阵雪', '86': '🌨 大阵雪',
  '95': '⛈ 雷暴', '96': '⛈ 雷暴冰雹', '99': '⛈ 强雷暴冰雹',
};

function degToDir(deg: number): string {
  if (isNaN(deg)) return '';
  const dirs = ['北', '北东北', '东北', '东东北', '东', '东东南', '东南', '南东南', '南', '南西南', '西南', '西西南', '西', '西西北', '西北', '北西北'];
  return dirs[Math.round(((deg % 360) / 22.5)) % 16] + '风';
}

// 风速 km/h → 蒲福风级（截图展示的「北风3级」）
function kmhToLevel(kmh: any): string {
  const km = Number(kmh);
  if (isNaN(km) || km < 1) return '0';
  if (km < 6) return '1';
  if (km < 12) return '2';
  if (km < 20) return '3';
  if (km < 29) return '4';
  if (km < 39) return '5';
  if (km < 50) return '6';
  if (km < 62) return '7';
  if (km < 75) return '8';
  if (km < 89) return '9';
  if (km < 103) return '10';
  if (km < 118) return '11';
  return '12';
}

// 紫外线指数 → 等级 + 防护建议（WHO 分级）
function uvLevel(u: any): { level: string; tip: string } {
  const n = Number(u);
  if (isNaN(n)) return { level: '', tip: '' };
  if (n < 3) return { level: '最弱', tip: '无需防护' };
  if (n < 6) return { level: '弱', tip: '外出建议防晒' };
  if (n < 8) return { level: '中等', tip: '外出戴遮阳帽或涂防晒霜' };
  if (n < 11) return { level: '强', tip: '减少外出，注意防晒' };
  return { level: '很强', tip: '尽量避免外出' };
}

// AQI 指数 → 等级（US AQI）
function aqiLevel(n: any): string {
  const a = Number(n);
  if (isNaN(a) || a < 0) return '';
  if (a <= 50) return '优';
  if (a <= 100) return '良';
  if (a <= 150) return '轻度污染';
  if (a <= 200) return '中度污染';
  if (a <= 300) return '重度污染';
  return '严重污染';
}

// 查询 Open-Meteo 7 天预报（返回统一天气结构），无坐标/失败返回 null
async function fetchOpenMeteo(cityName: string): Promise<any | null> {
  const coord = OPENM_COORDS[cityName];
  if (!coord) return null;
  try {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + coord[0] + '&longitude=' + coord[1]
      + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,weather_code,surface_pressure,visibility'
      + '&hourly=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,uv_index_max,sunrise,sunset'
      + '&timezone=Asia%2FShanghai&forecast_days=7&forecast_hours=12';
    const r = await fetchWithTimeout(url, 8000);
    if (!r.ok) return null;
    const d: any = await r.json();
    if (!d?.current || !Array.isArray(d.daily?.time)) return null;
    const cur = d.current;
    const dd = d.daily;
    const wmoOf = (c: any): string => WMO_CODES[String(c ?? '')] || '';
    const days = dd.time.map((t: string, i: number) => ({
      date: String(t),
      desc: wmoOf(dd.weather_code?.[i]),
      minT: String(dd.temperature_2m_min?.[i] ?? ''),
      maxT: String(dd.temperature_2m_max?.[i] ?? ''),
    }));
    const uv = uvLevel(dd.uv_index_max?.[0]);
    const hourly = ((d.hourly?.time || []).slice(0, 12)).map((t: string, i: number) => ({
      time: String(t).slice(11, 16),
      temp: d.hourly.temperature_2m?.[i] ?? '',
      desc: wmoOf(d.hourly.weather_code?.[i]),
      rain: '',
    }));
    const sunrise = dd.sunrise?.[0] ? String(dd.sunrise[0]).slice(11, 16) : '';
    const sunset = dd.sunset?.[0] ? String(dd.sunset[0]).slice(11, 16) : '';
    const visibility = Number(cur.visibility);
    const uvIdx = dd.uv_index_max?.[0];
    return {
      city: cityName,
      desc: wmoOf(cur.weather_code),
      temp: String(cur.temperature_2m ?? ''),
      feels: String(cur.apparent_temperature ?? ''),
      humidity: String(cur.relative_humidity_2m ?? ''),
      wind: String(Math.round(Number(cur.wind_speed_10m ?? 0))),
      windLevel: kmhToLevel(cur.wind_speed_10m),
      winddir: degToDir(Number(cur.wind_direction_10m ?? NaN)),
      minT: days[0]?.minT ?? '',
      maxT: days[0]?.maxT ?? '',
      date: days[0]?.date ?? '',
      updateTime: '',
      hourly,
      today: (wmoOf(cur.weather_code) ? '当前' + wmoOf(cur.weather_code) : '') + '，最高' + (days[0]?.maxT ?? '') + '°C',
      tomorrow: days[1] ? { date: days[1].date, desc: days[1].desc, minT: days[1].minT, maxT: days[1].maxT } : null,
      forecast5: days.slice(0, 5),
      forecast7: days,
      warnings: [],
      uvIndex: uvIdx != null ? String(uvIdx) : '',
      uvLevel: uv.level,
      uvTip: uv.tip,
      sunrise,
      sunset,
      pressure: String(Math.round(Number(cur.surface_pressure ?? 0)) || ''),
      visibility: (!isNaN(visibility) && visibility > 0) ? String(Math.round(visibility / 1000 * 10) / 10) : '',
    };
  } catch {
    return null;
  }
}

// 查询 Open-Meteo 空气质量（US AQI + PM2.5/PM10），无坐标/失败返回 null
async function fetchAirQuality(cityName: string): Promise<any | null> {
  const coord = OPENM_COORDS[cityName];
  if (!coord) return null;
  try {
    const url = 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=' + coord[0] + '&longitude=' + coord[1]
      + '&current=us_aqi,pm2_5,pm10&timezone=Asia%2FShanghai';
    const r = await fetchWithTimeout(url, 8000);
    if (!r.ok) return null;
    const d: any = await r.json();
    const c = d?.current;
    if (!c || c.us_aqi == null) return null;
    const aqi = Number(c.us_aqi);
    return { aqi: String(aqi), level: aqiLevel(aqi), pm25: c.pm2_5 != null ? String(Math.round(Number(c.pm2_5) * 10) / 10) : '', pm10: c.pm10 != null ? String(Math.round(Number(c.pm10) * 10) / 10) : '' };
  } catch {
    return null;
  }
}

// ---------- 气象预警（中国天气网·国家预警信息发布中心，免费公开接口） ----------
const WARN_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  'Referer': 'https://sq.weather.com.cn/alarmMap/list.html',
  'Accept': '*/*',
};
const ALARM_LIST_URL = 'https://product.weather.com.cn/alarm/grepalarm_cn.php';

let alarmListCache: { t: number; data: any } = { t: 0, data: null };
let alarmDetailCache: Record<string, { t: number; data: any }> = {};

async function fetchWithTimeout(url: string, timeoutMs = 6000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, headers: WARN_HEADERS });
  } finally {
    clearTimeout(timer);
  }
}

// 解析 `var alarminfo={...}` 形式的 JS 赋值
function parseAlarmScript(text: string): any | null {
  const m = text.match(/var alarminfo=(\{.*\})/s);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

// 全国预警列表（60s 缓存）
async function getAlarmList(): Promise<any | null> {
  if (alarmListCache.data && Date.now() - alarmListCache.t < 60000) return alarmListCache.data;
  try {
    const r = await fetchWithTimeout(ALARM_LIST_URL);
    if (!r.ok) return alarmListCache.data;
    const parsed = parseAlarmScript(await r.text());
    if (parsed) { alarmListCache = { t: Date.now(), data: parsed }; return parsed; }
    return alarmListCache.data;
  } catch {
    return alarmListCache.data;
  }
}

// 预警详情（300s 缓存）
async function getAlarmDetail(file: string): Promise<any | null> {
  const hit = alarmDetailCache[file];
  if (hit && Date.now() - hit.t < 300000) return hit.data;
  try {
    const r = await fetchWithTimeout('https://product.weather.com.cn/alarm/webdata/' + file);
    if (!r.ok) return null;
    const parsed = parseAlarmScript(await r.text());
    alarmDetailCache[file] = { t: Date.now(), data: parsed };
    return parsed;
  } catch {
    return null;
  }
}

// 匹配某城市/省份的生效预警
function matchWarnings(list: any, city: string, province: string): Array<{ area: string; file: string; title: string; kind: number }> {
  const rows = (list?.data || []) as string[][];
  const hits: Array<{ area: string; file: string; title: string; kind: number }> = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const area = r[0] || '';
    const file = r[1] || '';
    const title = r[6] || '';
    if (!file || seen.has(file)) continue;
    if (area.includes(city)) {
      seen.add(file);
      hits.push({ area, file, title, kind: 0 });
    } else if (province && area === province) {
      seen.add(file);
      hits.push({ area, file, title, kind: 1 });
    }
  }
  return hits;
}

// 查询真实天气（Open-Meteo 5 天优先，wttr.in 兜底；后端代理解决插件沙箱不支持 https 的问题）
// 附带：中国天气网气象预警、今日逐3小时、今日趋势、明日预报
router.get('/weather', async (req: Request, res: Response) => {
  if (!isLocal(req)) { rejectNonLocal(res); return; }
  const cityName = ((req.query.city as string) || '北京').trim() || '北京';
  const en = CITY_MAP[cityName] || cityName;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  // 气象预警（公共，失败不阻塞主天气）
  let warnings: any[] = [];
  try {
    const list = await getAlarmList();
    const province = CITY_PROVINCE[cityName] || '';
    const matched = matchWarnings(list, cityName, province);
    const top = matched.slice(0, 3);
    for (const w of top) {
      const det = await getAlarmDetail(w.file);
      if (det) {
        warnings.push({
          area: w.area,
          type: det.SIGNALTYPE || '',
          level: det.SIGNALLEVEL || '',
          time: det.ISSUETIME || '',
          content: det.ISSUECONTENT || w.title,
          source: '国家预警信息发布中心',
        });
      } else {
        warnings.push({ area: w.area, type: '', level: '', time: '', content: w.title, source: '国家预警信息发布中心' });
      }
    }
  } catch {}

  // Open-Meteo 7 天预报优先（常用城市），失败回退 wttr.in
  try {
    const om = await fetchOpenMeteo(cityName);
    if (om) {
      const aq = await fetchAirQuality(cityName);
      if (aq) om.air = aq;
      om.warnings = warnings;
      clearTimeout(timer);
      res.json({ ok: true, ...om });
      return;
    }
  } catch {}

  try {
    const r = await fetch('https://wttr.in/' + encodeURIComponent(en) + '?format=j1', { signal: controller.signal });
    if (!r.ok) { res.json({ ok: false, error: 'HTTP ' + r.status }); return; }
    const data: any = await r.json();
    if (!data?.current_condition?.[0]) { res.json({ ok: false, error: 'wttr.in 数据异常' }); return; }
    const cur = data.current_condition[0];
    const desc = WEATHER_CODES[String(cur.weatherCode)] || cur.weatherDesc?.[0]?.value || '未知';
    const day0 = data.weather?.[0];
    const day1 = data.weather?.[1];

    // 当前本地时间（城市为北京时间 UTC+8；观测时间字段为 UTC）
    let utcHour = -1;
    const om = String(cur.observation_time || '').match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
    if (om) {
      let h = parseInt(om[1], 10);
      if (/PM/i.test(om[3]) && h < 12) h += 12;
      if (/AM/i.test(om[3]) && h === 12) h = 0;
      utcHour = h;
    }
    const localHour = utcHour >= 0 ? (utcHour + 8) % 24 : -1;

    // 今日逐3小时（含未来几档）
    let hourly: Array<{ time: string; temp: number | string; desc: string; rain: string }> = [];
    if (day0?.hourly && localHour >= 0) {
      const slots = (day0.hourly as any[])
        .map((h) => ({
          hour: (Math.floor(parseInt(String(h.time), 10) / 100)) % 24,
          temp: h.tempC,
          code: String(h.weatherCode),
          rain: String(h.chanceofrain ?? ''),
        }))
        .sort((a, b) => a.hour - b.hour);
      let idx = slots.findIndex((s) => s.hour >= localHour);
      if (idx === -1) idx = 0;
      for (let i = 0; i < Math.min(6, slots.length); i++) {
        const s = slots[(idx + i) % slots.length];
        hourly.push({
          time: (s.hour < 10 ? '0' + s.hour : String(s.hour)) + ':00',
          temp: s.temp,
          desc: WEATHER_CODES[s.code] || '',
          rain: s.rain,
        });
      }
    }

    // 今日趋势文案（状态变化 + 高温提示）
    let todayText = '';
    if (day0) {
      const maxT = Number(day0.maxtempC);
      const changes: string[] = [];
      let prev = desc;
      for (const s of hourly) {
        if (s.desc && s.desc !== prev) { changes.push(s.time.replace(':00', '时') + '转' + s.desc); prev = s.desc; }
      }
      if (changes.length) todayText = '当前' + desc + '，' + changes.join('，');
      else todayText = '今天全天' + desc;
      if (maxT >= 35) todayText += '，高温天气';
      todayText += '，最高' + day0.maxtempC + '°C';
    }

    // 明日
    let tomorrow: any = null;
    if (day1) {
      const d1slots = (day1.hourly || []).map((h: any) => ({ hour: Math.floor(parseInt(String(h.time), 10) / 100), code: String(h.weatherCode) }));
      const noon = d1slots.find((s: any) => s.hour === 12) || d1slots.find((s: any) => s.hour === 15) || d1slots[0];
      tomorrow = {
        date: day1.date || '',
        desc: (noon && WEATHER_CODES[noon.code]) || '',
        minT: day1.mintempC ?? '',
        maxT: day1.maxtempC ?? '',
      };
    }

    // 未来 7 天预报（含今天；wttr.in 免费接口通常只回 3 天）
    const forecast7 = (data.weather || []).slice(0, 7).map((d: any) => {
      const slots = (d.hourly || []).map((h: any) => ({ hour: Math.floor(parseInt(String(h.time), 10) / 100), code: String(h.weatherCode) }));
      const noon = slots.find((s: any) => s.hour === 12) || slots.find((s: any) => s.hour === 15) || slots[0];
      return {
        date: d.date || '',
        desc: (noon && WEATHER_CODES[noon.code]) || '',
        minT: d.mintempC ?? '',
        maxT: d.maxtempC ?? '',
      };
    });

    // 紫外线/日出日落（wttr.in 支持）
    const astro0 = day0?.astronomy?.[0];
    const uv = uvLevel(cur.uvIndex);
    const vis = Number(cur.visibilityKm);

    // 气象预警已在 handler 开头公共获取（warnings）
    res.json({
      ok: true,
      city: cityName,
      desc,
      temp: cur.temp_C,
      feels: cur.FeelsLikeC,
      humidity: cur.humidity,
      wind: cur.windspeedKmph,
      windLevel: kmhToLevel(cur.windspeedKmph),
      winddir: cur.winddir16Point,
      minT: day0?.mintempC ?? '',
      maxT: day0?.maxtempC ?? '',
      date: day0?.date ?? '',
      updateTime: localHour >= 0 ? (localHour < 10 ? '0' + localHour : String(localHour)) + ':' + (om ? om[2] : '00') : '',
      hourly,
      today: todayText,
      tomorrow,
      forecast5: forecast7.slice(0, 5),
      forecast7,
      warnings,
      uvIndex: cur.uvIndex ?? '',
      uvLevel: uv.level,
      uvTip: uv.tip,
      sunrise: astro0?.sunrise || '',
      sunset: astro0?.sunset || '',
      pressure: cur.pressure ?? '',
      visibility: (!isNaN(vis) && vis > 0) ? String(vis) : '',
    });
  } catch (e: any) {
    res.json({ ok: false, error: e?.name === 'AbortError' ? '请求超时' : (e?.message || '获取失败') });
  } finally {
    clearTimeout(timer);
  }
});

function isLocal(req: Request): boolean {
  const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
}

function rejectNonLocal(res: Response) {
  res.status(403).json({ error: 'Forbidden: local only' });
}

function loadAdminsFromFile(): any[] {
  try {
    const file = path.resolve(process.cwd(), 'data', 'admin.json');
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8')) as any[];
  } catch {}
  return [];
}

function persistAdmins(admins: any[]): void {
  try {
    const file = path.resolve(process.cwd(), 'data', 'admin.json');
    fs.writeFileSync(file, JSON.stringify(admins, null, 2));
  } catch {}
}

function isRealQqNumber(s: unknown): boolean {
  return /^\d{5,12}$/.test(String(s ?? '').trim());
}

// 机器人端校验：该 OpenID 是否为面板超级主人
// openid 按 bot(AppID) 隔离，同一用户在不同机器人实例的 openid 不同，
// 因此除直接匹配 openid 外，还按该 openid 绑定的真实 QQ 号匹配超主账号
function isSuperAdminByOpenid(openid: string): boolean {
  const admins = loadAdminsFromFile();
  if (admins.some(a => a && a.openid === openid && a.role === 'super_master')) return true;
  try {
    const row = getDb().prepare('SELECT qq_number FROM user_mappings WHERE openid = ?').get(openid) as any;
    if (row && row.qq_number) {
      return admins.some(a => a && a.qq && String(a.qq) === String(row.qq_number) && a.role === 'super_master');
    }
  } catch {}
  return false;
}

// 把 admin.json 的角色体系同步到 config 全局权限 key（super_master_id/mini_masters/members），
// 使插件 ctx.storage.get('super_master_id')/isSuper() 与面板登录/用户管理判断一致
export function syncPermConfig(): void {
  try {
    const db = getDb();
    const admins = loadAdminsFromFile().filter(Boolean);
    const openidOf = (a: any): string => {
      if (a && a.openid) return String(a.openid).trim();
      if (a && a.qq) {
        const row = db.prepare('SELECT openid FROM user_mappings WHERE qq_number = ?').get(String(a.qq)) as any;
        if (row && row.openid) return String(row.openid);
      }
      return '';
    };
    const supers = admins.filter(a => a.role === 'super_master');
    const masters = admins.filter(a => a.role === 'master');
    const members = admins.filter(a => a.role === 'member');
    if (supers.length) {
      const s = supers[0];
      const sId = openidOf(s);
      if (sId) setConfig('super_master_id', JSON.stringify({ id: sId, name: s.nickname || s.username || '超级主人' }));
    }
    const build = (arr: any[]) => arr.map(a => ({ id: openidOf(a), name: a.nickname || a.username || '', activated: true })).filter((x: any) => x.id);
    const ms = build(masters);
    const mem = build(members);
    if (ms.length) setConfig('mini_masters', JSON.stringify(ms));
    if (mem.length) setConfig('members', JSON.stringify(mem));
  } catch {}
}

// 自动学习：把群成员的 OpenID/头像/昵称 同步到对应面板用户资料（admin.json）
function syncAdminProfile(userOpenid: string, qqNumber: string, avatar: string, username: string, gmNick: string): string {
  try {
    const admins = loadAdminsFromFile();
    let matched = admins.find(a => a && a.openid === userOpenid) || null;
    if (!matched && isRealQqNumber(qqNumber)) matched = admins.find(a => a && a.qq && String(a.qq) === qqNumber) || null;
    if (matched) {
      const changes: string[] = [];
      if (matched.openid !== userOpenid) { matched.openid = userOpenid; changes.push('openid'); }
      if (isRealQqNumber(qqNumber) && matched.avatar !== avatar) { matched.avatar = avatar; changes.push('avatar'); }
      const nick = username || gmNick;
      if (nick && !matched.nickname) { matched.nickname = String(nick); changes.push('nickname'); }
      if (changes.length) { persistAdmins(admins); syncPermConfig(); }
      if (!isRealQqNumber(qqNumber) && isRealQqNumber(matched.qq)) return String(matched.qq);
    }
  } catch {}
  return qqNumber;
}

function getPackageVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8'));
    return pkg.version || '1.0.0';
  } catch {
    return '1.0.0';
  }
}

// 版本信息：网页端/框架版本号
router.get('/version', (_req: Request, res: Response) => {
  if (!isLocal(_req)) { rejectNonLocal(res); return; }
  const version = getPackageVersion();
  let frameworkVersion = '';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'external', 'NapCatQQ', 'package.json'), 'utf-8'));
    frameworkVersion = pkg.version || '';
  } catch {}
  res.json({
    platform: 'QQ Bot Platform',
    version,
    framework: { name: 'NapCatQQ', version: frameworkVersion },
    node: process.version,
  });
});

// 更新日志：读取网页端 CHANGELOG.md
router.get('/changelog', (_req: Request, res: Response) => {
  if (!isLocal(_req)) { rejectNonLocal(res); return; }
  const changelogPath = path.join(process.cwd(), 'CHANGELOG.md');
  if (fs.existsSync(changelogPath)) {
    res.json({ content: fs.readFileSync(changelogPath, 'utf-8') });
  } else {
    res.json({ content: '# 更新日志\n\n暂无更新记录。' });
  }
});

// 运行时间：机器人进程实际运行时间（秒）与启动时间
router.get('/uptime', (_req: Request, res: Response) => {
  if (!isLocal(_req)) { rejectNonLocal(res); return; }
  const startTime = new Date(Date.now() - Math.floor(process.uptime()) * 1000);
  const bj = new Date(Date.now() + 8 * 3600 * 1000);
  const p2 = (n: number) => (n < 10 ? '0' : '') + n;
  const WEEKS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  res.json({
    uptimeSeconds: Math.floor(process.uptime()),
    startedAt: startTime.toISOString(),
    pid: process.pid,
    beijingTime:
      bj.getUTCFullYear() + '年' + p2(bj.getUTCMonth() + 1) + '月' + p2(bj.getUTCDate()) + '日 ' +
      p2(bj.getUTCHours()) + ':' + p2(bj.getUTCMinutes()) + ':' + p2(bj.getUTCSeconds()) + ' ' + WEEKS[bj.getUTCDay()],
    serverTime: new Date().toString(),
    serverTimezone: (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } })(),
  });
});

// 群信息：实时获取群基础信息 + 机器人在群状态（供机器人「群信息」命令/面板使用）
router.get('/group-info', async (req: Request, res: Response) => {
  if (!isLocal(req)) { rejectNonLocal(res); return; }
  const groupOpenid = (req.query.group_openid as string) || '';
  if (!groupOpenid) { res.status(400).json({ error: 'group_openid required' }); return; }
  try {
    const bot = getBot();
    const info = await bot.getGroupInfo(groupOpenid);
    const state = await bot.getGroupBotState(groupOpenid);
    if (info && info.group_name) {
      getDb().prepare(`
        INSERT INTO groups (id, name, last_active)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name
      `).run(groupOpenid, info.group_name);
    }
    res.json({ ok: true, group_openid: groupOpenid, info, state });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===== PHP 插件桥接端点（仅本机，供 PHP 插件查询官方群信息/群成员/渲染长图） =====
// PHP 插件运行在服务端本机，通过 curl http://127.0.0.1:PORT/api/bot/php-bridge/... 调用

// 群信息：按 botId 查询官方群信息（群名/群成员数），无 botId 用主机器人
router.get('/php-bridge/group-info', async (req: Request, res: Response) => {
  if (!isLocal(req)) { rejectNonLocal(res); return; }
  const groupOpenid = (req.query.group_openid as string) || '';
  const botId = (req.query.bot_id as string) || '';
  if (!groupOpenid) { res.status(400).json({ ok: false, error: 'group_openid required' }); return; }
  try {
    const bot = (botId && getBotInstance(botId)) || getBot();
    const info = await bot.getGroupInfo(groupOpenid);
    if (info && info.group_name) {
      getDb().prepare(`
        INSERT INTO groups (id, name, last_active)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name
      `).run(groupOpenid, info.group_name);
    }
    res.json({ ok: true, group_openid: groupOpenid, info });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 群成员分页：按 botId 查询官方群成员列表（limit + after 游标）
router.get('/php-bridge/group-members', async (req: Request, res: Response) => {
  if (!isLocal(req)) { rejectNonLocal(res); return; }
  const groupOpenid = (req.query.group_openid as string) || '';
  const botId = (req.query.bot_id as string) || '';
  const limit = parseInt((req.query.limit as string) || '50', 10);
  const after = (req.query.after as string) || '';
  if (!groupOpenid) { res.status(400).json({ ok: false, error: 'group_openid required' }); return; }
  try {
    const bot = (botId && getBotInstance(botId)) || getBot();
    const r = await bot.getGroupMembersPage(groupOpenid, Math.min(100, Math.max(1, limit || 50)), after);
    res.json({ ok: true, group_openid: groupOpenid, members: r.members, next_index: r.next_index });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 群详情：本地绑定信息（群名/群号），未绑定群号返回空
router.get('/php-bridge/group-detail', (req: Request, res: Response) => {
  if (!isLocal(req)) { rejectNonLocal(res); return; }
  const groupOpenid = (req.query.group_openid as string) || '';
  if (!groupOpenid) { res.status(400).json({ ok: false, error: 'group_openid required' }); return; }
  try {
    const db = getDb();
    const g = db.prepare('SELECT id, name, group_number, avatar FROM groups WHERE id = ?').get(groupOpenid) as any;
    res.json({ ok: true, group_openid: groupOpenid, group: g || null });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 群列表：当前机器人所在的所有群（本地记录，按归属机器人过滤，含群名/群号/人数/最后活跃）
router.get('/php-bridge/groups', (req: Request, res: Response) => {
  if (!isLocal(req)) { rejectNonLocal(res); return; }
  try {
    const reqBotId = String((req.query.bot_id as string) || '');
    const rows = reqBotId ? botGroupRows(reqBotId) : botGroupRows();
    res.json({ ok: true, bot_id: reqBotId || currentBotId(), groups: rows });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===== 机器人名称与所在群归属（多机器人同库按 bot_id 隔离） =====
const BOT_DEFAULT_NAME = '空空';

// 当前进程主机器人 AppID
function currentBotId(): string {
  try {
    const b = getBot();
    return (b && typeof (b as any).getBotId === 'function') ? String((b as any).getBotId()) : '';
  } catch {
    return '';
  }
}

// data/bots.json 注册的机器人数量（无注册表返回 0）
function botRegistryCount(): number {
  try {
    const file = path.resolve(process.cwd(), 'data', 'bots.json');
    if (!fs.existsSync(file)) return 0;
    const arr = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return Array.isArray(arr) ? arr.length : 0;
  } catch {
    return 0;
  }
}

// 机器人显示名：data/bots.json 注册表（按 AppID） → 配置 bot.name → 兜底默认名
function resolveBotName(botId?: string): string {
  const id = botId || currentBotId();
  if (id) {
    try {
      const file = path.resolve(process.cwd(), 'data', 'bots.json');
      if (fs.existsSync(file)) {
        const bots = JSON.parse(fs.readFileSync(file, 'utf-8')) as any[];
        if (Array.isArray(bots)) {
          const hit = bots.find((b: any) => b && String(b.appId || b.app_id || '') === String(id));
          if (hit && (hit.name || hit.appName)) return String(hit.name || hit.appName);
        }
      }
    } catch {}
  }
  try {
    return getConfig('bot.name') || BOT_DEFAULT_NAME;
  } catch {
    return BOT_DEFAULT_NAME;
  }
}

// 当前机器人所在群（本地记录）：优先按 group_members.bot_id / groups.bot_id 归属过滤；
// 无归属记录时，注册表仅一个机器人（或没有注册表）按全量兜底，多机器人则不下发其它机器人的群。
function botGroupRows(botId?: string): any[] {
  const db = getDb();
  const baseCols = 'id, name, group_number, avatar, member_count, last_active';
  const id = botId || currentBotId();
  const all = db.prepare(`SELECT ${baseCols} FROM groups ORDER BY last_active DESC`).all() as any[];
  if (!id || all.length === 0) return all;
  let ids: string[] = [];
  try {
    const rows = db.prepare(
      "SELECT gid FROM (SELECT group_id AS gid FROM group_members WHERE bot_id = ? AND group_id != '' UNION SELECT id AS gid FROM groups WHERE bot_id = ? AND id != '') WHERE gid != ''"
    ).all(id, id) as any[];
    ids = [...new Set(rows.map((r: any) => String(r.gid)))];
  } catch {}
  if (ids.length > 0) {
    const ph = ids.map(() => '?').join(',');
    try {
      return db.prepare(`SELECT ${baseCols} FROM groups WHERE id IN (${ph}) ORDER BY last_active DESC`).all(...ids) as any[];
    } catch {}
    return all;
  }
  return botRegistryCount() <= 1 ? all : [];
}

// 渲染群活跃统计长图：接收 GroupStatsCardData，返回 PNG base64
router.post('/php-bridge/render-stats-card', async (req: Request, res: Response) => {
  if (!isLocal(req)) { rejectNonLocal(res); return; }
  try {
    const data = req.body || {};
    const buf = await renderGroupStatsCard(data);
    res.json({ ok: true, base64: buf.toString('base64') });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 群活跃统计聚合：与旧版「群信息」看板同源（system_logs/group_members/groups），
// 返回 8 项指标 + 最活跃成员 Top5 + 最近活跃成员 Top5 + 跨群排行 Top5
router.get('/php-bridge/group-stats', (req: Request, res: Response) => {
  if (!isLocal(req)) { rejectNonLocal(res); return; }
  const groupOpenid = (req.query.group_openid as string) || '';
  if (!groupOpenid) { res.status(400).json({ ok: false, error: 'group_openid required' }); return; }
  try {
    const stats = collectGroupStatsFull(groupOpenid);
    res.json({ ok: true, group_openid: groupOpenid, stats });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 跨群活跃排行：今日各群消息数 Top5（PHP 插件「最活跃的群」卡片数据源）
router.get('/php-bridge/groups-ranking', (req: Request, res: Response) => {
  if (!isLocal(req)) { rejectNonLocal(res); return; }
  try {
    const limit = Math.min(10, Math.max(1, parseInt((req.query.limit as string) || '5', 10) || 5));
    const ranking = collectGroupRanking(limit);
    res.json({ ok: true, ranking });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 即时发送：PHP 插件「文字()/图片()」等调用后立即发送（不等脚本结束），
// 避免「更新补丁」这类耗时脚本超时被杀导致零回复。
// 支持 type: group / c2c / guild；reply 协议与 php-plugin sendReply 一致。
router.post('/php-bridge/send-reply', async (req: Request, res: Response) => {
  if (!isLocal(req)) { rejectNonLocal(res); return; }
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as any;
  const botId = String(body.bot_id || '');
  let bot: any = null;
  try { bot = (botId && getBotInstance(botId)) || getBot(); } catch { bot = null; }
  if (!bot) { res.status(400).json({ ok: false, error: 'bot unavailable' }); return; }
  const type = String(body.type || 'group');
  const payload = {
    type,
    content: String(body.content || ''),
    groupId: String(body.group_id || ''),
    channelId: String(body.channel_id || ''),
    userId: String(body.user_id || ''),
    msgId: String(body.msg_id || ''),
    botId,
  };
  let reply = (body.reply && typeof body.reply === 'object') ? body.reply : null;
  if (!reply) {
    reply = {
      type: String(body.kind || body.reply_type || 'text'),
      content: body.content,
      imageUrl: body.image_url || undefined,
      fileName: body.file_name || undefined,
    };
  }
  try {
    await sendPhpReply(bot, reply, type, payload);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
});

// 机器人状态卡：返回状态数据 + 渲染好的 PNG base64，供「重启控制」插件重启/自启后广播全群。
// 失败时 ok=false + error，插件据此渲染错误图。
router.get('/php-bridge/bot-status', async (_req: Request, res: Response) => {
  if (!isLocal(_req)) { rejectNonLocal(res); return; }
  try {
    const uptime = Math.floor(process.uptime());
    const days = Math.floor(uptime / 86400);
    const hours = Math.floor((uptime % 86400) / 3600);
    const mins = Math.floor((uptime % 3600) / 60);
    const secs = uptime % 60;
    const uptimeText = (days > 0 ? days + '天' : '') + (hours > 0 ? hours + '小时' : '') + (mins > 0 ? mins + '分' : '') + secs + '秒';
    let groupCount = 0;
    let pluginCount = 0;
    try {
      const botRows = botGroupRows();
      groupCount = botRows.length;
    } catch {}
    try {
      const dir = path.resolve(process.cwd(), 'plugins');
      if (fs.existsSync(dir)) {
        const names = new Set<string>();
        for (const n of fs.readdirSync(dir)) {
          if (n === '.tmp' || n.startsWith('.') || n.endsWith('.zip') || n.endsWith('.txt') || n.endsWith('.md')) continue;
          names.add(n);
        }
        pluginCount = names.size;
      }
    } catch {}
    const memMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
    const botName = resolveBotName();
    const port = process.env.PORT || String(getConfig('server.port') || '3000');
    const data = {
      ok: true,
      status: '运行中',
      version: getPackageVersion(),
      uptimeText,
      port,
      pid: String(process.pid),
      memory: memMb + ' MB',
      nodeVersion: process.version,
      pluginCount: String(pluginCount),
      groupCount: String(groupCount),
      botName,
      checkedAt: new Date(Date.now() + 8 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19),
    };
    const buf = await renderBotStatusCard(data);
    res.json({ ok: true, base64: buf.toString('base64'), status: data });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
});

// 更新配置：面板可配置的更新包信息（版本/补丁URL/全量URL/更新内容）
// 说明：该接口数据仅为版本号/下载地址/更新文案，无敏感信息，允许跨机访问，
// 供「更新系统」插件从远程面板（configUrl 指定）拉取统一配置使用。
router.get('/php-bridge/update-config', (req: Request, res: Response) => {
  res.json({
    ok: true,
    version: getConfig('update.version') || '4.2.59',
    patchUrl: getConfig('update.patch_url') || 'https://github.com/lzyzyzq/QQgfbot/releases/download/v4.2.59/qqbot-card-editor-patch-4.2.59.zip',
    fullUrl: getConfig('update.full_url') || 'https://github.com/lzyzyzq/QQgfbot/releases/download/v4.2.59/qqbot-card-editor-4.2.59-full.zip',
    changeLog: getConfig('update.changelog') || '',
    configUrl: getConfig('update.config_url') || '',
  });
});

// 超主判断：openid 是否属于超级主人（admin.json 超主 openid 或超主 QQ 名下的任一 OpenID）
router.post('/php-bridge/is-master', (req: Request, res: Response) => {
  if (!isLocal(req)) { rejectNonLocal(res); return; }
  try {
    const openid = String((req.body || {}).openid || '');
    if (!openid) { res.json({ ok: true, master: false }); return; }
    const adminsFile = path.join(process.cwd(), 'data', 'admin.json');
    let master = false;
    if (fs.existsSync(adminsFile)) {
      const admins = JSON.parse(fs.readFileSync(adminsFile, 'utf-8') || '[]');
      const s = (Array.isArray(admins) ? admins : []).find((a: any) => a && a.role === 'super_master');
      if (s) {
        if (s.openid === openid) master = true;
        if (!master && s.qq) {
          const db = getDb();
          const um = db.prepare('SELECT qq_number FROM user_mappings WHERE openid = ?').get(openid) as any;
          if (um && String(um.qq_number) === String(s.qq)) master = true;
        }
      }
    }
    res.json({ ok: true, master });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 渲染更新系统菜单图片（服务端 sharp，返回 base64）
router.post('/php-bridge/render-update-card', async (req: Request, res: Response) => {
  if (!isLocal(req)) { rejectNonLocal(res); return; }
  try {
    const buf = await renderUpdateCard((req.body || {}).data || {});
    res.json({ ok: true, base64: buf.toString('base64') });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 用户信息：群群名/用户名/用户ID(openid)/真实QQ号（供机器人"个人信息"等使用）
router.get('/userinfo', (req: Request, res: Response) => {
  if (!isLocal(req)) { rejectNonLocal(res); return; }  syncPermConfig();
  const userOpenid = (req.query.user_openid as string) || '';
  const groupOpenid = (req.query.group_openid as string) || '';
  if (!userOpenid) { res.status(400).json({ error: 'user_openid required' }); return; }
  try {
    const db = getDb();
    let groupName = '';
    if (groupOpenid) {
      const g = db.prepare('SELECT name FROM groups WHERE id = ?').get(groupOpenid) as any;
      groupName = g?.name || '';
    }
    const um = db.prepare('SELECT qq_number, nickname FROM user_mappings WHERE openid = ?').get(userOpenid) as any;
    let gmNick = '';
    let gmQq = '';
    if (groupOpenid) {
      const gm = db.prepare('SELECT qq_id, nickname FROM group_members WHERE group_id = ? AND member_openid = ?').get(groupOpenid, userOpenid) as any;
      if (gm) { gmNick = gm.nickname || ''; gmQq = gm.qq_id || ''; }
    }
    const isRealQq = (s: string) => /^\d{5,12}$/.test(s || '');
    let qqNumber = '';
    if (um && isRealQq(um.qq_number)) qqNumber = um.qq_number;
    else if (isRealQq(gmQq)) qqNumber = gmQq;
    const username = gmNick || (um?.nickname) || '';
    // 开放平台回调只有 OpenID 无真实 QQ：从主人系统（super_master_id/mini_masters/members）按 openid 反查 qqId
    if (!qqNumber) {
      try {
        const permRows = db.prepare("SELECT key, value FROM config WHERE key IN ('super_master_id','mini_masters','members')").all() as any[];
        for (const r of permRows) {
          let list: any[] = [];
          try { const v = JSON.parse(r.value); list = Array.isArray(v) ? v : [v]; } catch { continue; }
          for (const it of list) {
            if (it && (it.id === userOpenid || it.openid === userOpenid) && isRealQq(String(it.qqId || it.qq || ''))) {
              qqNumber = String(it.qqId || it.qq);
              break;
            }
          }
          if (qqNumber) break;
        }
      } catch (e) {}
    }
    let avatar = qqNumber ? `https://q1.qlogo.cn/g?b=qq&nk=${qqNumber}&s=640` : '';
    // 自动学习：把群成员 OpenID/头像/昵称 同步到对应面板用户资料，并按 openid 反查 QQ
    qqNumber = syncAdminProfile(userOpenid, qqNumber, avatar, username, gmNick);
    avatar = qqNumber ? `https://q1.qlogo.cn/g?b=qq&nk=${qqNumber}&s=640` : '';
    const authRow = db.prepare('SELECT COUNT(*) AS c FROM auth_codes WHERE used_by = ?').get(userOpenid) as any;
    const authRole = db.prepare('SELECT role, expires_at, is_permanent FROM auth_codes WHERE used_by = ? ORDER BY created_at DESC LIMIT 1').get(userOpenid) as any;
    // 面板权限：按 QQ号 / OpenID 匹配 admin.json 角色（与成员同步页权限列同源）
    const adminRoleMap = loadAdminRoleByQQ();
    let panelRole = qqNumber ? (adminRoleMap.get(qqNumber) || '') : '';
    if (!panelRole) panelRole = adminRoleMap.get(userOpenid) || '';
    res.json({
      group_name: groupName,
      username,
      user_openid: userOpenid,
      qq_number: qqNumber,
      avatar,
      authorized: (authRow?.c || 0) > 0,
      auth_role: authRole?.role || '',
      panel_role: panelRole || '',
      permission: panelRole || authRole?.role || '',
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 群列表：供机器人"整点报时"等定时任务作为发送目标群
router.get('/groups', (_req: Request, res: Response) => {
  if (!isLocal(_req)) { rejectNonLocal(res); return; }
  try {
    const db = getDb();
    const rows = db.prepare('SELECT id, name, group_number, avatar, member_count, last_active FROM groups ORDER BY last_active DESC').all() as any[];
    res.json({ groups: rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 修改群信息（群内超级主人命令调用）：群名 / 群号（群号变更自动生成群头像）
router.put('/groups/:id', (req: Request, res: Response) => {
  if (!isLocal(req)) { rejectNonLocal(res); return; }
  try {
    const id = String(req.params.id || '');
    const body = req.body || {};
    const db = getDb();
    const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(id) as any;
    if (!g) { res.json({ ok: false, error: '群不存在：' + id }); return; }
    const next = { name: g.name, group_number: g.group_number, avatar: g.avatar };
    if (body.name !== undefined) next.name = String(body.name).trim();
    if (body.group_number !== undefined) {
      next.group_number = String(body.group_number).trim();
      if (/^\d{6,15}$/.test(next.group_number)) next.avatar = `https://p.qlogo.cn/gh/${next.group_number}/${next.group_number}/0`;
    }
    if (body.avatar !== undefined && body.avatar !== '') next.avatar = String(body.avatar).trim();
    db.prepare('UPDATE groups SET name = ?, group_number = ?, avatar = ? WHERE id = ?').run(next.name, next.group_number, next.avatar, id);
    res.json({ ok: true, group: { ...next, id } });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 反馈提交（插件"反馈"命令调用，写入反馈列表供面板查看）
router.post('/feedback', (req: Request, res: Response) => {
  if (!isLocal(req)) { rejectNonLocal(res); return; }
  const body = req.body || {};
  const content = String(body.content || '').trim();
  if (!content) { res.json({ ok: false, error: '反馈内容不能为空' }); return; }
  try {
    const db = getDb();
    const id = require('crypto').randomUUID ? require('crypto').randomUUID() : String(Date.now());
    db.prepare(
      `INSERT INTO feedbacks (id, bot_id, user_openid, qq_number, nickname, content, contact, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now', 'localtime'))`
    ).run(id, String(body.bot_id || ''), String(body.user_openid || ''), String(body.qq_number || ''), String(body.nickname || ''), content, String(body.contact || ''));
    res.json({ ok: true, id });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 反馈列表（插件"反馈列表"命令调用，供群里超级主人查看）
router.get('/feedbacks', (_req: Request, res: Response) => {
  if (!isLocal(_req)) { rejectNonLocal(res); return; }
  try {
    const db = getDb();
    const rows = db.prepare(
      "SELECT id, bot_id, user_openid, qq_number, nickname, content, contact, status, reply, created_at, replied_at FROM feedbacks ORDER BY created_at DESC LIMIT 100"
    ).all() as any[];
    res.json({ feedbacks: rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 反馈回复：发私聊给反馈提交者 + 更新反馈状态（面板/群内超级主人共用）
async function replyFeedback(body: any): Promise<{ ok: boolean; error?: string }> {
  const id = String(body.id || '');
  const reply = String(body.reply || '').trim();
  if (!id || !reply) return { ok: false, error: '缺少 id 或回复内容' };
  try {
    const db = getDb();
    const f = db.prepare('SELECT * FROM feedbacks WHERE id = ?').get(id) as any;
    if (!f) return { ok: false, error: '反馈不存在：' + id };
    const botId = String(f.bot_id || '');
    let bot: any;
    try { bot = botId ? getBotInstance(botId) || getBot() : getBot(); } catch { bot = null; }
    if (!bot) return { ok: false, error: '机器人未初始化，无法发送回复' };
    const openid = String(f.user_openid || '');
    if (!openid) return { ok: false, error: '反馈提交者无 OpenID，无法私聊回复' };
    const sent = await bot.sendPrivateMessage(openid, '📩 反馈回复\n━━━━━━━━━━━━━━\n你的反馈：' + String(f.content || '') + '\n━━━━━━━━━━━━━━\n机器人的回复：\n' + reply + '\n━━━━━━━━━━━━━━\nPHP · QQ机器人平台');
    if (!sent) return { ok: false, error: '机器人私聊发送失败（OpenID: ' + openid.slice(0, 12) + '...）' };
    db.prepare("UPDATE feedbacks SET reply = ?, status = 'replied', replied_at = datetime('now', 'localtime') WHERE id = ?").run(reply, id);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

router.post('/feedback/reply', (req: Request, res: Response) => {
  if (!isLocal(req)) { rejectNonLocal(res); return; }
  replyFeedback(req.body || {}).then((r: any) => {
    if (r.ok) res.json({ ok: true });
    else res.json({ ok: false, error: r.error });
  }).catch((e: any) => { res.status(500).json({ ok: false, error: e.message }); });
});

// 绑定 QQ 号（群内消息新增绑定，绑定后不可修改）：openid ↔ QQ号
// 同时写入用户列表（user_mappings）、所在群（groups/group_members），自动获取头像与昵称
router.post('/bind-qq', (req: Request, res: Response) => {
  if (!isLocal(req)) { rejectNonLocal(res); return; }
  const { openid, qq_number, nickname, group_id, bot_id } = req.body || {};
  if (!openid || !qq_number) { res.status(400).json({ ok: false, error: '缺少 openid 或 qq_number' }); return; }
  const qq = String(qq_number).trim();
  if (!/^\d{5,12}$/.test(qq)) { res.json({ ok: false, error: 'QQ 号需为 5-12 位纯数字' }); return; }
  try {
    const db = getDb();
    db.exec(`CREATE TABLE IF NOT EXISTS user_mappings (openid TEXT PRIMARY KEY, qq_number TEXT NOT NULL, nickname TEXT DEFAULT '', last_updated DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    const existing = db.prepare('SELECT qq_number FROM user_mappings WHERE openid = ?').get(openid) as any;
    if (existing && /^\d{5,12}$/.test(existing.qq_number || '')) {
      res.json({ ok: false, error: '该用户已绑定 QQ 号 ' + existing.qq_number + '，绑定后不可修改' });
      return;
    }
    const nick = String(nickname || '').trim();
    const bindBotId = String(bot_id || '').trim();
    // 写入 user_mappings 时带 bot_id，保证 OpenID 列表/机器人隔离可按来源机器人识别
    db.prepare(`INSERT INTO user_mappings (openid, qq_number, nickname, bot_id, last_updated)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(openid) DO UPDATE SET qq_number=excluded.qq_number, nickname=CASE WHEN excluded.nickname<>'' THEN excluded.nickname ELSE nickname END, bot_id=CASE WHEN excluded.bot_id<>'' THEN excluded.bot_id ELSE bot_id END, last_updated=CURRENT_TIMESTAMP`)
      .run(openid, qq, nick, bindBotId);
    // 记录所在群：groups（群信息）+ group_members（成员归属）
    let group: any = null;
    if (group_id) {
      try {
        db.prepare(`INSERT INTO groups (id, name, member_count, last_active) VALUES (?, '', 0, CURRENT_TIMESTAMP)
          ON CONFLICT(id) DO UPDATE SET last_active=CURRENT_TIMESTAMP`).run(String(group_id));
        if (bot_id) {
          try { db.prepare('UPDATE groups SET bot_id = ? WHERE id = ? AND (bot_id IS NULL OR bot_id = \'\')').run(String(bot_id), String(group_id)); } catch {}
        }
        db.prepare(`INSERT INTO group_members (group_id, member_openid, qq_id, nickname, bot_id, first_seen, last_seen)
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT(group_id, member_openid) DO UPDATE SET qq_id=excluded.qq_id, nickname=CASE WHEN excluded.nickname<>'' THEN excluded.nickname ELSE nickname END, bot_id=CASE WHEN excluded.bot_id<>'' THEN excluded.bot_id ELSE bot_id END, last_seen=CURRENT_TIMESTAMP`)
          .run(String(group_id), openid, qq, nick, String(bot_id || ''));
        group = db.prepare('SELECT name, group_number, avatar FROM groups WHERE id = ?').get(String(group_id)) as any;
      } catch (e: any) {
        logger.warn(`bind-qq group record failed: ${e.message}`);
      }
    }
    res.json({
      ok: true,
      openid,
      qq_number: qq,
      nickname: nick,
      bound: true,
      avatar: `https://q1.qlogo.cn/g?b=qq&nk=${qq}&s=640`,
      group: group ? { id: group_id, name: group.name || '', group_number: group.group_number || '', avatar: group.avatar || '' } : null,
    });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===== 机器人端用户管理（仅超级主人可操作，operator=发送者 OpenID；数据源与面板一致 admin.json） =====
function safeUserView(a: any) {
  return { username: a.username, nickname: a.nickname || '', qq: a.qq || '', openid: a.openid || '', avatar: a.avatar || '', role: a.role || 'member', loginAble: a.loginAble !== false };
}

router.get('/admin-users', (req: Request, res: Response) => {
  if (!isLocal(req)) { rejectNonLocal(res); return; }
  const op = String(req.query.operator || '');
  if (!isSuperAdminByOpenid(op)) { res.status(403).json({ error: '仅超级主人可操作用户管理' }); return; }
  res.json({ users: loadAdminsFromFile().map(safeUserView) });
});

router.post('/admin-users', (req: Request, res: Response) => {
  if (!isLocal(req)) { rejectNonLocal(res); return; }
  const { operator, username, nickname, qq, openid, avatar, role } = req.body || {};
  if (!isSuperAdminByOpenid(String(operator || ''))) { res.status(403).json({ error: '仅超级主人可操作用户管理' }); return; }
  const q = String(qq || '').trim();
  const admins = loadAdminsFromFile();
  const name = String(username || '').trim() || (q ? 'qq_' + q : '');
  if (!name) { res.json({ ok: false, error: '缺少用户名或QQ号' }); return; }
  if (admins.some(a => a && a.username === name)) { res.json({ ok: false, error: '用户名已存在：' + name }); return; }
  if (q && !isRealQqNumber(q)) { res.json({ ok: false, error: 'QQ号需为 5-12 位纯数字' }); return; }
  admins.push({
    username: name,
    password: Math.random().toString(36).slice(2, 10),
    role: role || 'member',
    loginAble: true,
    qq: q || undefined,
    openid: String(openid || '').trim() || undefined,
    nickname: String(nickname || '').trim() || undefined,
    avatar: String(avatar || '').trim() || undefined,
  });
  persistAdmins(admins);
  syncPermConfig();
  res.json({ ok: true, username: name });
});

router.put('/admin-users/:username', (req: Request, res: Response) => {
  if (!isLocal(req)) { rejectNonLocal(res); return; }
  const { operator, nickname, qq, openid, avatar, role } = req.body || {};
  if (!isSuperAdminByOpenid(String(operator || ''))) { res.status(403).json({ error: '仅超级主人可操作用户管理' }); return; }
  const admins = loadAdminsFromFile();
  const user = admins.find(a => a && a.username === req.params.username);
  if (!user) { res.json({ ok: false, error: '用户不存在：' + req.params.username }); return; }
  if (qq !== undefined && String(qq).trim() !== '') {
    if (!isRealQqNumber(qq)) { res.json({ ok: false, error: 'QQ号需为 5-12 位纯数字' }); return; }
    user.qq = String(qq).trim();
  }
  if (openid !== undefined && String(openid).trim() !== '') user.openid = String(openid).trim();
  if (nickname !== undefined) user.nickname = nickname;
  if (avatar !== undefined) user.avatar = avatar;
  if (role !== undefined && user.role !== 'super_master') user.role = role;
  persistAdmins(admins);
  syncPermConfig();
  res.json({ ok: true });
});

router.delete('/admin-users/:username', (req: Request, res: Response) => {
  if (!isLocal(req)) { rejectNonLocal(res); return; }
  const op = String(req.query.operator || '');
  if (!isSuperAdminByOpenid(op)) { res.status(403).json({ error: '仅超级主人可操作用户管理' }); return; }
  const admins = loadAdminsFromFile();
  const idx = admins.findIndex(a => a && a.username === req.params.username);
  if (idx === -1) { res.json({ ok: false, error: '用户不存在：' + req.params.username }); return; }
  if (admins[idx].role === 'super_master') { res.json({ ok: false, error: '不能删除超级主人' }); return; }
  admins.splice(idx, 1);
  persistAdmins(admins);
  syncPermConfig();
  res.json({ ok: true });
});

// ===== 授权码管理（供超级主人群内指令操作后端授权码表） =====
function genCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function normalizeRole(role?: string | null): 'super_master' | 'master' | 'member' {
  const r = String(role || '').trim().toLowerCase();
  if (r === 'super_master' || r === 'super' || r === '超级主人' || r === '超主' || r === '超主人') return 'super_master';
  if (r === 'master' || r === '主人' || r === '小主人') return 'master';
  return 'member';
}

// 列表
router.get('/auth-codes', (_req: Request, res: Response) => {
  if (!isLocal(_req)) { rejectNonLocal(res); return; }
  try {
    const db = getDb();
    const rows = db.prepare('SELECT id, code, role, created_by, expires_at, is_permanent, used_by, used_at, created_at FROM auth_codes ORDER BY created_at DESC').all();
    res.json({ codes: rows });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 新增
router.post('/auth-codes', (req: Request, res: Response) => {
  if (!isLocal(req)) { rejectNonLocal(res); return; }
  try {
    const { role, expires_in_minutes } = req.body || {};
    const targetRole = normalizeRole(role);
    const code = genCode();
    const db = getDb();
    let expiresAt: string | null = null;
    let isPermanent = 1;
    if (expires_in_minutes && expires_in_minutes > 0) {
      isPermanent = 0;
      const d = new Date();
      d.setMinutes(d.getMinutes() + expires_in_minutes);
      expiresAt = d.toISOString();
    }
    const id = code + '-' + Date.now().toString(36);
    db.prepare('INSERT INTO auth_codes (id, code, created_by, role, expires_at, is_permanent, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime(\'now\'))')
      .run(id, code, 'bot', targetRole, expiresAt, isPermanent);
    res.json({ ok: true, code, role: targetRole, expires_at: expiresAt, is_permanent: !!isPermanent });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 修改（改角色/有效期）
router.put('/auth-codes', (req: Request, res: Response) => {
  if (!isLocal(req)) { rejectNonLocal(res); return; }
  try {
    const { code, role, expires_in_minutes } = req.body || {};
    if (!code) { res.json({ ok: false, error: '缺少 code' }); return; }
    const db = getDb();
    const row = db.prepare('SELECT * FROM auth_codes WHERE code = ?').get(String(code).toUpperCase()) as any;
    if (!row) { res.json({ ok: false, error: '授权码不存在' }); return; }
    if (role !== undefined && role !== null && String(role).trim() !== '') {
      db.prepare('UPDATE auth_codes SET role = ? WHERE id = ?').run(normalizeRole(role), row.id);
    }
    if (expires_in_minutes !== undefined) {
      const min = parseInt(String(expires_in_minutes), 10);
      if (min > 0) {
        const d = new Date();
        d.setMinutes(d.getMinutes() + min);
        db.prepare('UPDATE auth_codes SET is_permanent = 0, expires_at = ? WHERE id = ?').run(d.toISOString(), row.id);
      } else if (min <= 0) {
        db.prepare('UPDATE auth_codes SET is_permanent = 1, expires_at = NULL WHERE id = ?').run(row.id);
      }
    }
    res.json({ ok: true, code: row.code });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 删除
router.delete('/auth-codes', (req: Request, res: Response) => {
  if (!isLocal(req)) { rejectNonLocal(res); return; }
  try {
    const code = (req.query.code as string) || '';
    if (!code) { res.json({ ok: false, error: '缺少 code' }); return; }
    const db = getDb();
    const info = db.prepare('DELETE FROM auth_codes WHERE code = ?').run(String(code).toUpperCase());
    res.json({ ok: info.changes > 0, deleted: info.changes });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 验证/激活授权码（标记使用，供插件激活授权码走后端串联）
router.post('/auth-codes/verify', (req: Request, res: Response) => {
  if (!isLocal(req)) { rejectNonLocal(res); return; }
  try {
    const { code, openid } = req.body || {};
    if (!code) { res.json({ valid: false, error: '缺少授权码' }); return; }
    const db = getDb();
    const row = db.prepare('SELECT * FROM auth_codes WHERE code = ?').get(String(code).toUpperCase()) as any;
    if (!row) { res.json({ valid: false, error: '授权码无效' }); return; }
    if (!row.is_permanent && row.expires_at && new Date(row.expires_at) < new Date()) {
      res.json({ valid: false, error: '授权码已过期' }); return;
    }
    if (!row.used_by && openid) {
      db.prepare('UPDATE auth_codes SET used_by = ?, used_at = datetime(\'now\') WHERE id = ?').run(openid, row.id);
    }
    res.json({ valid: true, role: row.role, code: row.code });
  } catch (e: any) { res.status(500).json({ valid: false, error: e.message }); }
});

// 面板授权码登录开关：读
router.get('/panel-login', (_req: Request, res: Response) => {
  if (!isLocal(_req)) { rejectNonLocal(res); return; }
  res.json({ enabled: (getConfig('panel.auth_code_login') || '1') === '1' });
});

// 面板授权码登录开关：写
router.post('/panel-login', (req: Request, res: Response) => {
  if (!isLocal(req)) { rejectNonLocal(res); return; }
  const { enabled } = req.body || {};
  if (typeof enabled !== 'boolean') { res.json({ ok: false, error: 'enabled 需为布尔值' }); return; }
  setConfig('panel.auth_code_login', enabled ? '1' : '0');
  res.json({ ok: true, enabled });
});

// 功能开关列表（供插件按钮菜单 / 调度器读取，与网页面板同源）
router.get('/switches', (_req: Request, res: Response) => {
  if (!isLocal(_req)) { rejectNonLocal(res); return; }
  res.json({ switches: getSwitchStates() });
});

// 功能开关设置
router.post('/switches', (req: Request, res: Response) => {
  if (!isLocal(req)) { rejectNonLocal(res); return; }
  const { key, enabled } = req.body || {};
  if (!key || typeof enabled !== 'boolean') { res.json({ ok: false, error: '需要 key 与布尔 enabled' }); return; }
  const s = setSwitchState(String(key), enabled);
  if (!s) { res.json({ ok: false, error: '未知开关：' + key }); return; }
  res.json({ ok: true, switch: s });
});

// 定时任务列表
router.get('/schedule-tasks', (_req: Request, res: Response) => {
  if (!isLocal(_req)) { rejectNonLocal(res); return; }
  res.json({ tasks: listScheduleTasks() });
});

// 读取全局 config 值（供定时调度器等本地组件读取，如 bot.chime_texts）
router.get('/config', (req: Request, res: Response) => {
  if (!isLocal(req)) { rejectNonLocal(res); return; }
  const key = String(req.query.key || '');
  if (!key) { res.json({ value: '' }); return; }
  res.json({ value: getConfig(key) || '' });
});

// 新建定时任务（定时播报 / 定时开关）
router.post('/schedule-tasks', (req: Request, res: Response) => {
  if (!isLocal(req)) { rejectNonLocal(res); return; }
  const r = createScheduleTask(req.body || {});
  if (!r.ok) { res.json({ ok: false, error: r.error }); return; }
  res.json({ ok: true, task: r.task });
});

// 修改定时任务
router.put('/schedule-tasks', (req: Request, res: Response) => {
  if (!isLocal(req)) { rejectNonLocal(res); return; }
  const r = updateScheduleTask(req.body || {});
  if (!r.ok) { res.json({ ok: false, error: r.error }); return; }
  res.json({ ok: true, task: r.task });
});

// 删除定时任务
router.delete('/schedule-tasks', (req: Request, res: Response) => {
  if (!isLocal(req)) { rejectNonLocal(res); return; }
  const id = String(req.query.id || '');
  if (!id) { res.json({ ok: false, error: '缺少 id' }); return; }
  const r = deleteScheduleTask(id);
  res.json({ ok: r.ok });
});

// 启停定时任务
router.post('/schedule-tasks/toggle', (req: Request, res: Response) => {
  if (!isLocal(req)) { rejectNonLocal(res); return; }
  const id = String((req.body || {}).id || '');
  if (!id) { res.json({ ok: false, error: '缺少 id' }); return; }
  const r = toggleScheduleTask(id);
  if (!r.ok) { res.json({ ok: false, error: r.error }); return; }
  res.json({ ok: true, task: r.task });
});

export default router;
