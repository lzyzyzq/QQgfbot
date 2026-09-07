#!/usr/bin/env node
/**
 * 版本发布自动化（WP5）
 *  用法：
 *    node scripts/release.js 4.2.76 [--from v4.2.75] [--note "一句话更新说明"]
 *        [--base-url https://8091-xxxx.monkeycode-ai.online]
 *        [--gh]   （附带创建 GitHub Release，需要 gh 已登录）
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
let baseUrl = '';
let doGh = false;
for (let i = 1; i < args.length; i++) {
  if (args[i] === '--from') fromTag = args[++i] || '';
  else if (args[i] === '--note') note = args[++i] || '';
  else if (args[i] === '--base-url') baseUrl = args[++i] || '';
  else if (args[i] === '--gh') doGh = true;
}
if (!/^\d+\.\d+\.\d+$/.test(ver)) {
  console.error('用法: node scripts/release.js <X.Y.Z> [--from vPrev] [--note 说明] [--base-url URL] [--gh]');
  process.exit(1);
}
const tag = 'v' + ver;
const zipName = 'qqbot-card-editor-patch-' + ver + '.zip';
const zipPath = path.join(ROOT, zipName);

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
console.log('基线 tag：' + fromTag + ' → ' + tag);

const changed = sh('git diff --name-only ' + fromTag + '..HEAD').split('\n').filter(Boolean);
const changedFiltered = changed.filter((f) => {
  if (/\.zip$/.test(f) || /\.png$|\.jpg$|\.jpeg$|\.gif$/.test(f)) return false; // 大资源不打进补丁
  return true;
});
console.log('变更文件 ' + changedFiltered.length + ' 个');

// 2) bump package.json
const pkgPath = path.join(ROOT, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
if (pkg.version !== ver) {
  pkg.version = ver;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log('package.json version -> ' + ver);
}

// 3) CHANGELOG 新段落
const clPath = path.join(ROOT, 'CHANGELOG.md');
const clOld = fs.existsSync(clPath) ? fs.readFileSync(clPath, 'utf8') : '';
const commitLines = sh('git log --oneline --no-merges ' + fromTag + '..HEAD').split('\n').filter(Boolean);
const date = new Date().toISOString().slice(0, 10);
if (!new RegExp('^## ' + ver.replace(/\./g, '\\.') + '（' + date + '）', 'm').test(clOld)) {
  const clLines = [
    '## ' + ver + '（' + date + '）',
    '',
  ];
  if (note) {
    clLines.push('### 发布说明', '', note, '');
  }
  clLines.push('### 提交', '');
  for (const c of commitLines) clLines.push('- ' + c);
  clLines.push('', '---', '');
  const clNew = clLines.join('\n') + clOld;
  fs.writeFileSync(clPath, clNew, 'utf8');
  console.log('CHANGELOG 已更新（' + commitLines.length + ' 条提交）');
} else {
  console.log('CHANGELOG 已有 ' + ver + ' 段落，跳过');
}
// 供 --gh 正文复用
const clBlock = [];
if (note) clBlock.push(note, '');
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
uc.ok = true;
uc.version = ver;
uc.patchUrl = pUrl;
uc.fullUrl = String(uc.fullUrl || '');
uc.mirrors = [
  { name: '8091 唯一更新源（补丁）', patchUrl: pUrl },
];
uc.changeLog = changeLog;
fs.writeFileSync(ucPath, JSON.stringify(uc, null, 2) + '\n', 'utf8');
console.log('update-config.json 已登记 ' + ver);

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
