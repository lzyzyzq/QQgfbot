#!/usr/bin/env node
/**
 * 版本发布自动化（WP5）
 *  版本号规则：major.minor.patch；patch 0-99，minor 0-9，major 无上限（1.0.99→1.1.0；1.9.99→2.0.0）。
 *  用法：
 *    node scripts/release.js 1.0.0 [--from v4.2.100] [--note "一句话更新说明"]
 *        [--framework-note "框架修复/新增说明（会写入 CHANGELOG 框架升级段）"]
 *        [--base-url https://8091-xxxx.monkeycode-ai.online]
 *        [--auto]  （从基线 tag 按进位规则自动算下一个版本）
 *        [--gh]   （附带创建 GitHub Release，需要 gh 已登录）
 *
 *  改动范围约定：plugins/ 目录=插件升级；其余源码=框架升级。CHANGELOG 会分开两段，
 *  并据此维护 update-config.json 的 frameworkVersion / pluginVersion（均从 1.0.0 起）。
 *
 *  流程：
 *    1) 校验工作区干净 + 当前 main 已 push
 *    2) 升级 package.json.version（若低于目标）
 *    3) 依据 git log（自 --from 指定 tag，缺省取最近的 v* 标签）写 CHANGELOG.md 新段落
 *    4) npm run build（tsc 编译 dist）
 *    5) 打补丁包 qqbot-card-editor-patch-<ver>.zip（变更文件 + 全量 dist + CHANGELOG + package.json + update-config.json）
 *    6) 更新 update-config.json（version / changeLog / patchUrl 基址取自 --base-url 或旧配置）
 *    7) git add 并 commit（双写：包与登记入仓库）→ tag v<ver> → push main + tag
 *    8) --gh 时：gh release create v<ver> <zip>（正文取本次 CHANGELOG 段）
 *
 * 产物 zip 位于仓库根目录 = 8091 更新源目录（python -m http.server 8091 直接服务 /workspace），无需另发。
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const ROOT = path.resolve(__dirname, '..');

function run(cmd, opts) {
  return execSync(cmd, Object.assign({ cwd: ROOT, stdio: 'pipe', encoding: 'utf8' }, opts)).trim();
}
function sh(cmd) {
  return run(cmd);
}

const args = process.argv.slice(2);
let ver = args[0] || '';
let fromTag = '';
let note = '';
let frameworkNote = '';
let baseUrl = '';
let doGh = false;
let autoVer = false;
const extraFiles = [];
for (let i = 1; i < args.length; i++) {
  if (args[i] === '--from') fromTag = args[++i] || '';
  else if (args[i] === '--note') note = args[++i] || '';
  else if (args[i] === '--framework-note') frameworkNote = args[++i] || '';
  else if (args[i] === '--base-url') baseUrl = args[++i] || '';
  else if (args[i] === '--gh') doGh = true;
  else if (args[i] === '--auto') autoVer = true;
  else if (args[i] === '--extra-file') extraFiles.push(args[++i] || '');
}
if (ver === '--auto') { autoVer = true; ver = ''; }

// 版本号规则（用户定）：major.minor.patch；patch 0-99，minor 0-9，major 无上限。
// 例：1.0.99 → 1.1.0；1.9.99 → 2.0.0；2.9.99 → 3.0.0。目前统一从 1.0.0 起算。
function parseVer(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v || ''));
  return m ? { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) } : null;
}
function bumpVer(v) {
  let major = v.major, minor = v.minor, patch = v.patch + 1;
  if (patch > 99) { patch = 0; minor += 1; }
  if (minor > 9) { minor = 0; major += 1; }
  return major + '.' + minor + '.' + patch;
}

// 0) 工作区校验
const status = sh('git status --porcelain');
if (status) {
  console.error('工作区有未提交改动，请先提交/清理：\n' + status);
  process.exit(1);
}
sh('git pull --ff-only origin main');

// 1) 确定基线 tag 与变更文件
if (!fromTag) {
  fromTag = sh('git tag --sort=-v:refname | head -1') || '';
}
if (!fromTag) {
  console.error('未找到任何历史 tag 作为基线，请用 --from 指定（例如 v4.2.75）');
  process.exit(1);
}
// 解析目标版本：显式传入则校验；--auto/未传则按规则从基线 tag 自动进位
if (autoVer || !ver) {
  const base = parseVer(String(fromTag).replace(/^v/, ''));
  if (!base) {
    console.error('无法从基线 tag 解析版本号：' + fromTag);
    process.exit(1);
  }
  ver = bumpVer(base);
  console.log('自动进位版本：' + fromTag + ' → v' + ver);
}
const vParsed = parseVer(ver);
if (!vParsed) {
  console.error('用法: node scripts/release.js <X.Y.Z> [--from vPrev] [--note 说明] [--framework-note 框架说明] [--base-url URL] [--gh] [--auto]');
  process.exit(1);
}
if (vParsed.patch > 99) { console.error('补丁号必须为 0-99；满 99 自动进位（1.0.99 → 1.1.0）'); process.exit(1); }
if (vParsed.minor > 9) { console.error('次版本号必须为 0-9；满 9.99 自动进位（1.9.99 → 2.0.0）'); process.exit(1); }
const tag = 'v' + ver;
const zipName = 'qqbot-card-editor-patch-' + ver + '.zip';
const zipPath = path.join(ROOT, zipName);
console.log('基线 tag：' + fromTag + ' → ' + tag);

// core.quotepath=false：git 默认会把中文/非 ASCII 文件名转义成八进制，导致
// addFile 在磁盘上找不到同名文件而静默漏包（4.2.79 事故根因：娱乐群管.js/.txt 缺失）。
// 另提供 --extra-file <rel>（可重复）：显式把某文件强制打进补丁，不依赖 git diff 判定。
const changed = sh('git -c core.quotepath=false diff --name-only ' + fromTag + '..HEAD').split('\n').filter(Boolean);
for (const f of extraFiles) {
  if (!changed.includes(f)) changed.push(f);
}
const changedFiltered = changed.filter((f) => {
  if (/\.zip$/.test(f) || /\.png$|\.jpg$|\.jpeg$|\.gif$/.test(f)) return false; // 大资源不打进补丁
  return true;
});
console.log('变更文件 ' + changedFiltered.length + ' 个' + (extraFiles.length ? '（含 --extra-file 显式补入 ' + extraFiles.length + ' 个）' : ''));
for (const f of changedFiltered) console.log('  + ' + f);
const missing = changedFiltered.filter((f) => !fs.existsSync(path.join(ROOT, f)));
if (missing.length) {
  console.error('以下变更文件在磁盘上不存在，中止打包（避免静默漏包）：\n' + missing.join('\n'));
  process.exit(1);
}

// 2) bump package.json
const pkgPath = path.join(ROOT, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
if (pkg.version !== ver) {
  pkg.version = ver;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log('package.json version -> ' + ver);
}

// 3) 归类改动范围：plugins/ 目录=插件升级；其余（排除 dist/CHANGELOG/版本登记/站点刷新等生成物）=框架升级
const GEN_EXCLUDE = [
  /^dist\//, /^CHANGELOG\.md$/, /^update-config\.json$/, /^package(-lock)?\.json$/,
  /^downloads\.html$/, /^index\.html$/, /^releases\.(html|json)$/, /^\.release-body-/,
];
const isGenerated = (f) => GEN_EXCLUDE.some((re) => re.test(f));
const pluginChanged = changedFiltered.some((f) => f.startsWith('plugins/'));
const frameworkChanged = changedFiltered.some((f) => !f.startsWith('plugins/') && !isGenerated(f));
console.log('改动范围：' + (frameworkChanged ? '框架升级 ' : '') + (pluginChanged ? '插件升级' : ''));
if (!frameworkChanged && !pluginChanged) {
  console.log('警告：未识别到框架或插件源码改动（仅生成物），更新日志将只含提交列表');
}

// 解析提交及其改动文件，用于把更新日志按「框架升级 / 插件升级」分开
const rawLog = sh("git -c core.quotepath=false log --no-merges --pretty=format:@@%h|%s --name-only " + fromTag + '..HEAD');
const commits = [];
{
  let cur = null;
  for (const line of rawLog.split('\n')) {
    if (line.startsWith('@@')) {
      const body = line.slice(2);
      const p = body.indexOf('|');
      cur = { sha: body.slice(0, p), subject: body.slice(p + 1), files: [] };
      commits.push(cur);
    } else if (line.trim() && cur) {
      cur.files.push(line.trim());
    }
  }
}
function commitKind(subject) {
  if (/修复|修正|fix|bug/i.test(subject)) return '修复';
  if (/新增|添加|增加|add|feat|新功能|支持/i.test(subject)) return '新增';
  return '变更';
}
const frameworkCommits = commits.filter((c) => c.files.some((f) => !f.startsWith('plugins/') && !isGenerated(f)));
const pluginCommits = commits.filter((c) => c.files.some((f) => f.startsWith('plugins/')));

// 4) CHANGELOG 新段落（框架升级 / 插件升级分开写，符合“框架升级≠插件升级”的约定）
const clPath = path.join(ROOT, 'CHANGELOG.md');
const clOld = fs.existsSync(clPath) ? fs.readFileSync(clPath, 'utf8') : '';
const commitLines = sh('git log --oneline --no-merges ' + fromTag + '..HEAD').split('\n').filter(Boolean);
const date = new Date().toISOString().slice(0, 10);
function bulletGroup(title, list, extra) {
  const out = ['### ' + title, ''];
  if (extra) out.push(extra, '');
  if (list.length) {
    const order = ['新增', '修复', '变更'];
    for (const k of order) {
      const items = list.filter((c) => commitKind(c.subject) === k);
      for (const c of items) out.push('- ' + k + '：' + c.subject + '（' + c.sha + '）');
    }
  } else {
    out.push('- （无）');
  }
  out.push('');
  return out;
}
if (!new RegExp('^## ' + ver.replace(/\./g, '\\.') + '（' + date + '）', 'm').test(clOld)) {
  const clLines = ['## ' + ver + '（' + date + '）', ''];
  if (note) clLines.push('### 发布说明', '', note, '');
  if (frameworkChanged || frameworkNote) {
    clLines.push(...bulletGroup('框架升级（框架文件变更）', frameworkCommits, frameworkNote ? ('**框架修复/新增说明**：' + frameworkNote) : ''));
  }
  if (pluginChanged) {
    clLines.push(...bulletGroup('插件升级 / 新增插件（plugins/ 目录变更）', pluginCommits, ''));
  }
  if (!frameworkChanged && !pluginChanged) {
    clLines.push('### 提交', '');
    for (const c of commitLines) clLines.push('- ' + c);
    clLines.push('');
  }
  clLines.push('---', '');
  const clNew = clLines.join('\n') + clOld;
  fs.writeFileSync(clPath, clNew, 'utf8');
  console.log('CHANGELOG 已更新（框架 ' + frameworkCommits.length + ' 条 / 插件 ' + pluginCommits.length + ' 条）');
} else {
  console.log('CHANGELOG 已有 ' + ver + ' 段落，跳过');
}
// 供 --gh 正文复用
const clBlock = [];
if (note) clBlock.push(note, '');
if (frameworkNote) clBlock.push('框架修复/新增：' + frameworkNote, '');
clBlock.push(...commitLines.map((c) => '- ' + c));


// 4) 编译 dist
run('npm run build');
console.log('tsc 编译完成');

// 5) 打补丁包：变更文件 + 全量 dist + CHANGELOG + package.json + update-config.json
const zip = new AdmZip();
const used = new Set();
function addFile(rel) {
  const fp = path.join(ROOT, rel);
  if (used.has(rel) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) return;
  used.add(rel);
  zip.addLocalFile(fp, path.dirname(rel));
}
for (const f of changedFiltered) addFile(f);
if (fs.existsSync(path.join(ROOT, 'dist'))) {
  for (const f of walkDir(path.join(ROOT, 'dist'))) addFile(f);
}
addFile('CHANGELOG.md');
addFile('package.json');
addFile('update-config.json');
zip.writeZip(zipPath);
console.log('补丁包：' + zipName + '（' + used.size + ' 文件）');

// 6) update-config.json 登记
const ucPath = path.join(ROOT, 'update-config.json');
let uc = {};
try { uc = JSON.parse(fs.readFileSync(ucPath, 'utf8')); } catch (e) {}
let host = baseUrl.replace(/\/+$/, '');
if (!host) {
  const oldUrl = String(uc.patchUrl || '');
  const m = oldUrl.match(/^(https?:\/\/[^/]+)/);
  if (m) host = m[1];
}
if (!host) {
  console.error('无法推断更新源基址（原 update-config.json 无 patchUrl 且未给 --base-url）');
  process.exit(1);
}
const pUrl = host + '/' + zipName;
const changeLog = (note ? note : '【' + ver + '】见 CHANGELOG：' + commitLines.slice(0, 8).join('；') + '。');
// 框架版本 / 插件版本：各自只在对应范围有改动时更新为本次发布版本；两者独立于补丁版本
let frameworkVersion = String(uc.frameworkVersion || '1.0.0');
let pluginVersion = String(uc.pluginVersion || '1.0.0');
if (frameworkChanged) frameworkVersion = ver;
if (pluginChanged) pluginVersion = ver;
uc.ok = true;
uc.version = ver;
uc.frameworkVersion = frameworkVersion;
uc.pluginVersion = pluginVersion;
uc.patchUrl = pUrl;
uc.fullUrl = String(uc.fullUrl || '');
uc.mirrors = [
  { name: '8091 唯一更新源（补丁）', patchUrl: pUrl },
];
uc.changeLog = changeLog;
if (frameworkChanged || pluginChanged) {
  uc.changeType = (frameworkChanged ? '框架升级' : '') + (frameworkChanged && pluginChanged ? ' + ' : '') + (pluginChanged ? '插件升级' : '');
}
fs.writeFileSync(ucPath, JSON.stringify(uc, null, 2) + '\n', 'utf8');
console.log('update-config.json 已登记 ' + ver + '（框架版本 ' + frameworkVersion + '，插件版本 ' + pluginVersion + '，范围 ' + (uc.changeType || '补丁') + '）');

// 7) commit + tag + push（仓库双写：源码 + 包 + 登记 + CHANGELOG；zip 被 gitignore 故强制入库）
sh('git add package.json CHANGELOG.md update-config.json');
sh('git add -f ' + zipName);
sh('git commit -m "release: ' + ver + '（自动发布）"');
sh('git tag ' + tag);
sh('git push origin main --tags');
console.log('已推送 main + tag ' + tag);

// 8) GitHub Release（可选）
if (doGh) {
  const ghOk = sh('gh auth status') || '';
  if (ghOk.indexOf('Logged in') >= 0) {
    const body = clBlock.join('\n').trim();
    const bf = path.join(ROOT, '.release-body-' + ver + '.md');
    fs.writeFileSync(bf, body, 'utf8');
    sh('gh release create ' + tag + ' "' + zipPath + '" --title "' + tag + '" --notes-file "' + bf + '"');
    fs.unlinkSync(bf);
    console.log('GitHub Release 已创建：' + tag);
  } else {
    console.warn('gh 未登录，跳过 GitHub Release（可 gh auth login 后手动：gh release create ' + tag + ' ' + zipName + '）');
  }
}

console.log('完成。' + zipName + ' 位于仓库根目录，8091 更新源即时可用：' + host + '/' + zipName);
console.log('外网校验：md5sum ' + zipName);

function walkDir(dir) {
  const out = [];
  try {
    for (const n of fs.readdirSync(dir)) {
      const fp = path.join(dir, n);
      if (fs.statSync(fp).isDirectory()) out.push(...walkDir(fp));
      else out.push(path.relative(ROOT, fp).split(path.sep).join('/'));
    }
  } catch (e) {}
  return out;
}
