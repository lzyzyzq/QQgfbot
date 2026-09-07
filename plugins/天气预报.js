// 天气预报 v1.0.0 - 央视分区播报风格全国天气 + 分区明细 + 单城市详情
// 数据源：本地增强接口 /api/bot/weather（Open-Meteo 7 天 + 国家预警，失败回退 wttr.in）
// 形态：1) 「天气预报 / 央视天气 / 全国天气」→ 央视式分区文字播报 + 分区汇总图
//       2) 「天气预报 华东/华北/…」→ 指定地理区逐城明细
//       3) 「天气预报 城市名」→ 单城市多日详情
// @ts-nocheck
module.exports = {
  manifest: {
    id: 'mod-cctv-forecast',
    name: '天气预报',
    version: '1.0.0',
    description: '天气预报：央视分区播报（华北/东北/华东/华中/华南/西南/西北），发送「天气预报」全国分区、「天气预报 华东」分区明细、「天气预报 上海」城市详情',
    author: '511742399'
  },

  async init() {},

  methods: {
    handleCommand: async function(ctx, data) {
      return module.exports.handleMessage(ctx, data);
    }
  },

  onEnable: function(ctx) {
    ctx.logger.info('天气预报 v1.0.0 已加载');
    var self = this;
    ctx.eventBus.on('message.group', async function(data) {
      try { await self.handleMessage(ctx, data); } catch (e) {}
    });
    ctx.eventBus.on('message.c2c', async function(data) {
      try { await self.handleMessage(ctx, data); } catch (e) {}
    });
  },

  // 事件兜底（老事件驱动，真实环境由 eventBus 派发）
  async onEvent(event, ctx) {
    if (event.eventType !== 'GROUP_AT_MESSAGE_CREATE') return;
    if ([7, 3, 8, 2].indexOf(event.msgType) >= 0) return;
    try {
      var content = String(event.content || '').replace(/^\s*(?:<@!?[A-Za-z0-9_\-]+>|@\S+)\s*/, '').trim();
      if (isForecastCmd(content)) {
        var g = event.groupOpenid || event.group_openid || event.groupId;
        if (!g) return;
        await handleMessage(ctx, { groupId: g, id: event.msgId || event.id || '', content: content });
      }
    } catch (e) {}
  },

  handleMessage: async function(ctx, data) {
    try {
      var content = String(data.content || '').replace(/^\s*(?:<@!?[A-Za-z0-9_\-]+>|@\S+)\s*/, '').trim();
      if (!isForecastCmd(content)) return;
      var groupId = data.groupId;
      if (!groupId) return;
      await runForecast(ctx, groupId, data.id || '', content);
    } catch (e) {}
  }
};

// ============================================================
// 七大地理区（央视天气预报常用分区口径）
// ============================================================
var REGIONS = [
  { name: '华北', cities: ['北京', '天津', '石家庄', '太原', '呼和浩特'] },
  { name: '东北', cities: ['沈阳', '长春', '哈尔滨'] },
  { name: '华东', cities: ['上海', '南京', '杭州', '合肥', '福州', '南昌', '济南'] },
  { name: '华中', cities: ['郑州', '武汉', '长沙'] },
  { name: '华南', cities: ['广州', '南宁', '海口'] },
  { name: '西南', cities: ['重庆', '成都', '贵阳', '昆明', '拉萨'] },
  { name: '西北', cities: ['西安', '兰州', '西宁', '银川', '乌鲁木齐'] }
];

function isForecastCmd(c) {
  if (!c) return false;
  return c === '天气预报' || c === '央视天气' || c === '全国天气' || c === '分区天气' ||
    c.indexOf('天气预报 ') === 0 || c === '天气地图';
}

// ============================================================
// 数据获取：本地增强天气接口（Open-Meteo 优先 + 国家预警，失败回退 wttr.in）
// ============================================================
function localBase() {
  return 'http://127.0.0.1:' + (process.env.PORT || '3000');
}

function httpGet(path) {
  return new Promise(function(resolve) {
    try {
      var httpMod = require('http');
      var req = httpMod.get(localBase() + path, { headers: { 'User-Agent': 'curl/7.0' } }, function(res) {
        var body = '';
        res.on('data', function(c) { body += c; });
        res.on('end', function() {
          try { resolve(JSON.parse(body)); } catch (e) { resolve(null); }
        });
      });
      req.on('error', function() { resolve(null); });
      req.setTimeout(9000, function() { try { req.destroy(); } catch (e) {} resolve(null); });
    } catch (e) { resolve(null); }
  });
}

// 单城解析 → { name, desc, temp, minT, maxT, humidity, wind, today, warnings:[...] }
function fetchCity(city) {
  return httpGet('/api/bot/weather?city=' + encodeURIComponent(city)).then(function(lj) {
    if (!lj || !lj.ok) return null;
    var f = (lj.forecast7 && lj.forecast7.length) ? lj.forecast7 : (lj.forecast5 || []);
    var d0 = f && f.length ? f[0] : null;
    var out = {
      name: String(lj.city || city),
      desc: String(lj.desc || ''),
      temp: lj.temp != null ? String(lj.temp) : '',
      minT: d0 && d0.minT != null ? String(d0.minT) : '',
      maxT: d0 && d0.maxT != null ? String(d0.maxT) : '',
      humidity: lj.humidity != null ? String(lj.humidity) : '',
      wind: lj.wind != null ? String(lj.wind) : '',
      today: String(lj.today || ''),
      warnings: (lj.warnings && lj.warnings.length) ? lj.warnings : []
    };
    return out;
  });
}

// 并发抓取整组城市；失败城市返回 null（避免一条数据错误拖垮全组）
function fetchGroup(cities) {
  var ps = [];
  for (var i = 0; i < cities.length; i++) {
    ps.push(fetchCity(cities[i]).then(function(w) { return w; }, function() { return null; }));
  }
  return Promise.all(ps);
}

// 带并发上限的批量任务（tasks 为无参函数数组），按入参顺序回填结果
function runLimit(tasks, limit) {
  var out = new Array(tasks.length);
  var idx = 0;
  function next() {
    if (idx >= tasks.length) return Promise.resolve();
    var cur = idx++;
    return Promise.resolve().then(tasks[cur]).then(function(v) { out[cur] = v; }, function() { out[cur] = null; }).then(next);
  }
  var runners = [];
  for (var k = 0; k < Math.min(limit || 3, tasks.length); k++) runners.push(next());
  return Promise.all(runners).then(function() { return out; });
}

// ============================================================
// 文字编排
// ============================================================
// 全国分区文字（央视播报风格，逐区逐城）
function buildNationalText(resMap) {
  var out = ['🌤 全国天气预报（央视 · 分区播报）', '━━━━━━━━━━━━━━━━'];
  for (var r = 0; r < REGIONS.length; r++) {
    var reg = REGIONS[r];
    var list = (resMap[reg.name] || []);
    var cells = [];
    for (var c = 0; c < list.length; c++) {
      var w = list[c];
      if (!w) { cells.push(reg.cities[c] + ' 数据缺失'); continue; }
      var cell = w.desc + ' ' + (w.minT !== '' || w.maxT !== '' ? (w.minT !== '' ? w.minT : '?') + '~' + (w.maxT !== '' ? w.maxT : '?') : '');
      cells.push(cell);
    }
    out.push('【' + reg.name + '】' + (cells.length ? cells.join('，') : ''));
  }
  out.push('━━━━━━━━━━━━━━━━');
  out.push('发送「天气预报 华东」看分区逐城\n发送「天气预报 城市名」查多日详情');
  return out.join('\n');
}

// 单区明细文字（含今日高低温和预警）
function buildRegionText(reg, list) {
  var out = ['🌤 ' + reg.name + '地区天气预报', '━━━━━━━━━━━━━━━━'];
  for (var c = 0; c < list.length; c++) {
    var w = list[c];
    if (!w) { out.push('· ' + reg.cities[c] + '：数据缺失'); continue; }
    var line = '· ' + w.name + '：' + (w.desc || '--') + ' ' + (w.temp !== '' ? w.temp + '℃' : '');
    if (w.minT !== '' || w.maxT !== '') line += '（' + (w.minT !== '' ? w.minT : '?') + '~' + (w.maxT !== '' ? w.maxT : '?') + '℃）';
    if (w.humidity !== '') line += ' 湿度' + w.humidity + '%';
    if (w.wind !== '') line += ' ' + w.wind;
    out.push(line);
    if (w.today) out.push('   ↳ ' + w.today);
    for (var x = 0; x < w.warnings.length; x++) {
      out.push('   ⚠️ ' + String(w.warnings[x].type || '').slice(0, 20) + (w.warnings[x].level || '') + '：' + String(w.warnings[x].content || '').slice(0, 40));
    }
  }
  out.push('━━━━━━━━━━━━━━━━');
  out.push('发送「天气预报」看全国分区');
  return out.join('\n');
}

// 单城市多日详情文字
function buildCityText(w, city) {
  if (!w) return '❌ 未查到「' + city + '」的天气数据，请检查城市名（如：天气预报 上海）。';
  var out = ['🌤 ' + w.name + '天气预报', '━━━━━━━━━━━━━━━━'];
  out.push('当前：' + (w.desc || '--') + (w.temp !== '' ? ' ' + w.temp + '℃' : ''));
  if (w.minT !== '' || w.maxT !== '') out.push('今日：' + (w.minT !== '' ? w.minT : '?') + '~' + (w.maxT !== '' ? w.maxT : '?') + '℃');
  if (w.humidity !== '') out.push('湿度：' + w.humidity + '%');
  if (w.today) out.push('趋势：' + w.today);
  if (w.warnings && w.warnings.length) {
    var w0 = w.warnings[0];
    out.push('⚠️ ' + String(w0.type || '').slice(0, 24) + (w0.level || '') + '：' + String(w0.content || '').slice(0, 60));
  }
  out.push('━━━━━━━━━━━━━━━━');
  out.push('发送「天气预报」看全国分区');
  return out.join('\n');
}

// ============================================================
// 分区汇总图（sharp SVG 渲染；不带地图轮廓，仅分区示意卡）
// ============================================================
var FONT = 'PingFang SC, Microsoft YaHei, sans-serif';

function escSvg(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderForecastPng(rows, title) {
  return new Promise(function(resolve) {
    try {
      var sharp = require('sharp');
      var W = 760;
      var headH = 92;
      var rowH = 64;
      var H = headH + rows.length * rowH + 26;
      var cards = [];
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var y = headH + 8 + i * rowH;
        var isHi = !!row.highlight;
        var chip = isHi ? '#f59e0b' : '#3b82f6';
        var names = [];
        for (var c = 0; c < row.items.length; c++) {
          var w = row.items[c];
          names.push(escSvg(w.name + ' ' + (w.desc || '--') + (w.temp !== '' ? ' ' + w.temp + '℃' : '')));
        }
        cards.push(
          '<rect x="36" y="' + y + '" width="' + (W - 72) + '" height="' + (rowH - 8) + '" rx="12" fill="' + (isHi ? '#3b2f12' : '#1e293b') + '" stroke="' + (isHi ? 'rgba(245,158,11,.55)' : 'rgba(30,41,59,.0)') + '"/>' +
          '<rect x="50" y="' + (y + 10) + '" width="86" height="30" rx="8" fill="' + chip + '"/>' +
          '<text x="93" y="' + (y + 31) + '" font-family="' + FONT + '" font-size="17" font-weight="bold" fill="#fff" text-anchor="middle">' + escSvg(row.name) + '</text>' +
          '<text x="152" y="' + (y + 30) + '" font-family="' + FONT + '" font-size="15" fill="#cbd5e1">' + names.join('　｜　') + '</text>'
        );
      }
      var svg = '<svg width="' + W + '" height="' + H + '" xmlns="http://www.w3.org/2000/svg">' +
        '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1e1b4b"/><stop offset="1" stop-color="#312e81"/></linearGradient></defs>' +
        '<rect width="' + W + '" height="' + H + '" fill="url(#bg)"/>' +
        '<text x="38" y="52" font-family="' + FONT + '" font-size="30" font-weight="bold" fill="#fff">' + escSvg(title || '全国天气预报') + '</text>' +
        '<text x="38" y="80" font-family="' + FONT + '" font-size="13" fill="#a5b4cf">央视分区口径 · ' + escSvg(bjNow()) + ' · 数据源 Open-Meteo / 国家预警</text>' +
        cards.join('') +
        '<text x="' + (W - 38) + '" y="' + (H - 6) + '" font-family="' + FONT + '" font-size="12" fill="#64748b" text-anchor="end">PHP · QQ机器人平台 · 天气预报</text>' +
        '</svg>';
      sharp(Buffer.from(svg)).png().toBuffer().then(function(buf) { resolve(buf); }, function() { resolve(null); });
    } catch (e) { resolve(null); }
  });
}

function bjNow() {
  var d = new Date(Date.now() + 8 * 3600 * 1000);
  var p = function(n) { return n < 10 ? '0' + n : '' + n; };
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
}

// ============================================================
// 主流程
// ============================================================
async function runForecast(ctx, groupId, msgId, content) {
  var args = content;
  var isMap = content === '天气地图';
  // 剥离指令前缀
  for (var k = 0; k < 5; k++) {
    var pre = ['天气预报 ', '天气预报', '央视天气', '全国天气', '分区天气'][k];
    if (args.indexOf(pre) === 0) { args = args.slice(pre.length).trim(); break; }
  }

  var regNames = [];
  for (var rr = 0; rr < REGIONS.length; rr++) regNames.push(REGIONS[rr].name);

  var mode = 'national';
  var targetRegion = null;
  var cityQuery = '';
  if (isMap) mode = 'national';
  else if (args === '') mode = 'national';
  else if (regNames.indexOf(args) >= 0) { mode = 'region'; targetRegion = args; }
  else { mode = 'city'; cityQuery = args; }

  // 1) 单城市：纯文本多日详情
  if (mode === 'city') {
    var wc = await fetchCity(cityQuery);
    await sendTextSafe(ctx, groupId, msgId, buildCityText(wc, cityQuery));
    return;
  }

  // 2) 全国 / 分区
  var regs = (mode === 'region')
    ? REGIONS.filter(function(r) { return r.name === targetRegion; })
    : REGIONS;

  var rows = [];
  var textParts = [];
  var resMap = {};
  var regsTasks = [];
  for (var ri = 0; ri < regs.length; ri++) {
    regsTasks.push(function(regIdx) {
      return function() {
        var reg = regs[regIdx];
        return fetchGroup(reg.cities).then(function(list) {
          resMap[reg.name] = list;
          // 图中每区只取前 3 城代表，避免排不下
          var shown = [];
          var lim = mode === 'region' ? list.length : Math.min(3, list.length);
          for (var cj = 0; cj < lim; cj++) {
            var w = list[cj];
            if (!w) continue;
            shown.push(w);
          }
          if (shown.length === 0) shown = [{ name: reg.cities[0], desc: '--', temp: '' }];
          rows[regIdx] = { name: reg.name, items: shown, highlight: mode === 'region' };
        });
      };
    }(ri));
  }
  await runLimit(regsTasks, 4);

  if (mode === 'region') {
    textParts.push(buildRegionText(regs[0], resMap[targetRegion]));
  } else {
    textParts.push(buildNationalText(resMap));
  }
  var text = textParts.join('\n\n');

  // 图片优先，失败仅回退文字
  var png = await renderForecastPng(rows, mode === 'region' ? (targetRegion + '地区天气预报') : '全国天气预报');
  var imgSent = false;
  if (png && ctx.bot && ctx.bot.uploadGroupImageBuffer) {
    try {
      var up = await ctx.bot.uploadGroupImageBuffer(groupId, png, 'forecast.png');
      if (up && (up.file_info || up.url)) {
        await ctx.bot.sendGroupImageMessage(groupId, up.file_info || up.url, msgId);
        imgSent = true;
      }
    } catch (e) {}
  }
  await sendTextSafe(ctx, groupId, msgId, text);
  if (typeof imgSent === 'boolean' && !imgSent && !png) {
    // 无声即可，文字已覆盖信息
  }
}

async function sendTextSafe(ctx, groupId, msgId, text) {
  try {
    if (!text) return;
    if (ctx.bot && ctx.bot.sendGroupMessage) await ctx.bot.sendGroupMessage(groupId, text, msgId);
    else if (ctx.bot && ctx.bot.sendMessage) await ctx.bot.sendMessage(groupId, text);
  } catch (e) {}
}

// 供引擎测试与本地 smoke 使用（生产无副作用）
module.exports.__test = { REGIONS: REGIONS, renderForecastPng: renderForecastPng, buildNationalText: buildNationalText };
