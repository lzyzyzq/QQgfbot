#!/usr/bin/env node
// 插件索引与命令总览生成器：扫描 plugins/ 顶层插件文件，输出 docs/插件索引与命令总览.md
// 用法：node scripts/gen-plugin-index.mjs
import fs from 'fs';
import path from 'path';

const PLUGINS_DIR = path.resolve('plugins');
const OUT = path.resolve('docs/插件索引与命令总览.md');

const NON_PLUGIN = new Set(['dict.txt', 'python-plugin-template.zip', 'php_helpers.php', 'php-example.php', '测试.py']);
const HINT = {
  'dict.txt': '词典数据文件（词典回复.js 使用），非插件',
  'python-plugin-template.zip': 'Python 插件工程模板压缩包，非插件',
  'php_helpers.php': 'PHP 插件辅助函数库（由 PHP 桥自动注入），非独立插件',
  'php-example.php': 'PHP 插件示例（演示辅助函数与回复类型），非独立插件',
  '测试.py': 'Python 插件示例 / 模板',
};

function readText(f) {
  try { return fs.readFileSync(f, 'utf-8'); } catch { return ''; }
}

function esc(s) {
  return String(s || '').replace(/\|/g, '\\|').replace(/`/g, '').replace(/[\r\n]+/g, ' ').trim();
}

// ---- JS：manifest + 命令提取 ----
function parseJs(file, src) {
  const out = { id: '', name: '', version: '', author: '', description: '' };
  const m = src.match(/manifest\s*:\s*\{[\s\S]*?\}/);
  if (m) {
    const id = m[0].match(/id\s*:\s*['"]([^'"]+)['"]/);
    const nm = m[0].match(/name\s*:\s*['"]([^'"]+)['"]/);
    const vv = m[0].match(/version\s*:\s*['"]([^'"]+)['"]/);
    const au = m[0].match(/author\s*:\s*['"]([^'"]+)['"]/);
    const de = m[0].match(/description\s*:\s*['"]([^'"]+)['"]/);
    if (id) out.id = id[1]; if (nm) out.name = nm[1]; if (vv) out.version = vv[1];
    if (au) out.author = au[1]; if (de) out.description = de[1];
  }
  const head = (src.match(/\/\/[^\n]{0,120}/) || [''])[0].replace(/^\/\/\s*/, '');
  if (!out.description && !out.name) out.description = head;
  return out;
}

// ---- 命令触发器提取（content === 'xx' / indexOf('xx' ...) / === "xx"） ----
function extractCommands(src) {
  const cmds = new Set();
  const re1 = /content\s*===?\s*['"]([^'"]{1,40})['"]/g;
  const re2 = /content\s*\.indexOf\(\s*['"]([^'"]{1,40})['"]/g;
  const re3 = /content\s*\.startsWith\(\s*['"]([^'"]{1,40})['"]/g;
  const re4 = /content\s*===?\s*['"]([^'"]{1,40})['"]\s*\|\|/g;
  for (const re of [re1, re2, re3, re4]) {
    let x; while ((x = re.exec(src))) {
      const v = x[1].trim();
      if (v && !/^(https?:\/\/)/.test(v) && !/[|:]/.test(v) && v.length <= 30) cmds.add(v);
    }
  }
  // 去掉明显非命令的长文本/模板
  const filtered = [...cmds].filter((c) => c && c.length >= 1 && !/[{}<>]/.test(c) && !/^(你|我|今天|发送|格式)/.test(c));
  return filtered;
}

function extractStorageKeys(src) {
  const keys = new Set();
  const re = /storage\.(get|set)\(\s*['"]([^'"]+)['"]/g;
  let x; while ((x = re.exec(src))) {
    let k = x[2];
    k = k.replace(/\$\{?[a-zA-Z_$][\w$]*\}?/g, '*').replace(/['"]\s*\+\s*[a-zA-Z_$][\w$]*/g, "''").replace(/[_']/g, (mm) => (mm === '_' ? '_' : ''));
    keys.add(k.replace(/['"]\s*\+\s*[a-zA-Z_$][\w$]*/g, '_*').replace(/\+\s*['"]?[a-zA-Z_$][\w$]*/g, '_*'));
  }
  return [...keys];
}

function extractApi(src) {
  const apis = new Set();
  const re = /\/api\/bot\/[a-z0-9-]+(?:\?|['"`]|$)/g;
  let x; while ((x = re.exec(src))) apis.add(x[0].replace(/[?'"`]+$/g, ''));
  return [...apis];
}

function extractKeywords(src) {
  const kw = new Set();
  const re = /module\.export|commands:\s*\[|keywords:\s*\[|handleCommand|handleGroupMessage|onMemberIncrease|onMessage|joinRequest|matchContent|if\s*\(.*\bincludes?\(|triggerWords|cmds\s*:/g;
  let x; while ((x = re.exec(src))) kw.add(x[0]);
  return [...kw];
}

// ---- PHP / Python：头注释描述 ----
function parseCommentPlugin(src, maxLines = 30) {
  const lines = src.split('\n').slice(0, maxLines);
  const notes = [];
  for (const l of lines) {
    const t = l.replace(/^(\/\/|#|\s*\*|\/\*|\*\/|<\?php)\s*/, '').trim();
    if (!t || t.startsWith('<?php') || t === '*/') continue;
    if (/^[=─\-—]+\s*$/.test(t)) continue;
    if (/^[-·]\s*$/.test(t)) continue;
    if (/\$[a-zA-Z_]\w*\s*=/.test(t) || /\b(STDIN|STDOUT|STDERR|json_decode|preg_)\b/.test(t)) break; // 代码行截断
    // 跳过“命令：”区块与其后的具体命令行
    if (/^命令[:：]/.test(t)) continue;
    if (/^\s*[^：\n]{1,24}\s+→/.test(t)) continue;
    if (/^\s*[^：\n]{1,24}\s+[（(].{0,30}[）)]/.test(t)) continue;
    notes.push(t);
    if (notes.length >= 8) break;
  }
  return notes.join('；');
}

function parseCommentCommands(src) {
  const cmds = new Set();
  const lines = src.split('\n').map((l) => l.replace(/^\s*(\/\/|#)\s*/, ''));
  for (const line of lines) {
    const m = line.match(/^\s*([^→\n:：]{1,26}?)\s*→/);
    if (!m) continue;
    for (const p of m[1].split('/')) {
      const c = p.trim().replace(/[。；,，]+$/, '');
      if (!c || c.length < 2 || c.length > 24) continue;
      if (c.includes('（') || c.includes('(')) continue;      // 说明性文字
      if (/^[a-z_$]{1,10}$/.test(c)) continue;                // 变量名/代码 token
      if (/[「」$@"#]|^系统|设置$/.test(c)) continue;          // 注释杂讯
      cmds.add(c);
    }
  }
  return [...cmds];
}

function listPlugins() {
  const entries = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .filter((n) => /\.(js|php|py)$/i.test(n))
    .sort((a, b) => a.localeCompare(b, 'zh'));

  const items = [];
  for (const f of entries) {
    const full = path.join(PLUGINS_DIR, f);
    const src = readText(full);
    const ext = path.extname(f).toLowerCase();
    const type = ext === '.js' ? 'JS' : ext === '.php' ? 'PHP' : 'PY';
    let info = { id: '', name: '', version: '', author: '', description: '' };
    let cmds = [];
    let keys = [];
    let apis = [];
    let keywords = [];
    let role = '插件';
    if (HINT[f]) { role = HINT[f]; }
    if (type === 'JS') {
      info = parseJs(f, src);
      cmds = extractCommands(src);
      keys = extractStorageKeys(src);
      apis = extractApi(src);
    } else if (type === 'PHP') {
      const notes = parseCommentPlugin(src);
      info.description = notes;
      cmds = parseCommentCommands(src);
      info.name = (src.match(/(?:插件|单文件|多功能)[^\n]{0,30}/) || [''])[0];
      if (f.includes('更新系统')) info.name = '更新系统插件';
      if (f.includes('终端')) info.name = '终端执行插件';
      if (f.includes('群信息') && type === 'PHP') info.name = '群信息插件';
    } else {
      const notes = parseCommentPlugin(src);
      info.description = notes;
      cmds = parseCommentCommands(src);
      info.name = (src.match(/#.*(测试|示例)[^\n]{0,20}/) || [f])[0];
    }
    const cmdText = cmds.length ? cmds.slice(0, 12).join('、') : '（事件驱动 / 见描述）';
    const fileName = f;
    // 去重：version/id 合并展示名
    const dispName = info.name && info.name !== f ? `${info.name}（${fileName}）` : fileName;
    items.push({ file: fileName, ext, type, role, info, cmds, keys, apis, keywords, cmdText, dispName });
  }
  return items;
}

function render(items) {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 16);
  const real = items.filter((i) => i.role === '插件');
  const nonPlugin = items.filter((i) => i.role !== '插件');
  const L = [];
  L.push('# 插件索引与命令总览');
  L.push('');
  L.push(`> 自动生成于 ${now}（UTC），扫描目录 \`plugins/\`。收录 **${real.length} 个插件文件** + ${nonPlugin.length} 个辅助/示例文件。`);
  L.push('> 用途：开发者/群主快速了解每个插件的能力、触发命令、存储键与后端接口依赖；详细开发说明见同目录其他文档。');
  L.push('');
  L.push('## 一、汇总清单');
  L.push('');
  L.push('| # | 文件 | 类型 | 插件 ID / 名称 | 版本 | 作者 | 说明 |');
  L.push('|---|------|------|----------------|------|------|------|');
  let i = 0;
  for (const it of items) {
    if (it.role !== '插件') {
      L.push(`| ${++i} | ${esc(it.file)} | ${it.type} | —（辅助/示例） | — | — | ${esc(it.role)} |`);
      continue;
    }
    const nameCell = it.info.id ? `${it.info.name}（\`${it.info.id}\`）` : (it.info.name || it.file);
    const author = it.info.author || '—';
    const desc = esc(it.info.description || it.role);
    const shortDesc = desc.length > 62 ? desc.slice(0, 62) + '…' : desc;
    L.push(`| ${++i} | ${esc(it.file)} | ${it.type} | ${esc(nameCell)} | ${esc(it.info.version || '—')} | ${esc(author)} | ${shortDesc} |`);
  }
  L.push('');
  L.push('## 二、插件明细');
  L.push('');
  let idx = 0;
  for (const it of items) {
    idx++;
    L.push(`### ${idx}. ${it.file}（${it.type}）`);
    L.push('');
    if (it.role !== '插件') {
      L.push(`${esc(it.role)}。${esc(it.info.description || '')}`);
      L.push('');
      continue;
    }
    L.push(`- **文件**：\`plugins/${it.file}\``);
    L.push(`- **ID / 名称**：${it.info.id ? '`' + esc(it.info.id) + '`' : '（无 manifest）'}${it.info.name ? ' / ' + esc(it.info.name) : ''}${it.info.version ? ' / v' + esc(it.info.version) : ''}${it.info.author ? ' / 作者 ' + esc(it.info.author) : ''}`);
    if (it.info.description) L.push(`- **说明**：${esc(it.info.description)}`);
    if (it.cmds.length) L.push(`- **触发命令**：${it.cmdText}`);
    if (it.keys.length) L.push(`- **存储键**：\`${it.keys.map((k) => esc(k)).join('`、`')}\``);
    if (it.apis.length) L.push(`- **后端接口依赖**：\`${it.apis.map((a) => esc(a)).join('`、`')}\``);
    L.push('');
  }
  L.push('---');
  L.push('> 维护：改动插件后重跑 `node scripts/gen-plugin-index.mjs` 重新生成。');
  L.push('');
  return L.join('\n');
}

const items = listPlugins();
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, render(items), 'utf-8');
console.log(`[gen-plugin-index] plugins=${items.length} -> ${OUT}`);
