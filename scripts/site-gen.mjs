#!/usr/bin/env node
// 站点自动生成器（版本列表/补丁列表/插件下载 + Giscus 评论区）。
// 输入：git tag（v*）+ update-config.json + site-config.json；输出：releases.json / releases.html / downloads.html（仓库根，随 Pages 发布）。
// 运行环境：GitHub Actions（checkout 需 fetch-depth:0）或本地仓库根目录。零第三方依赖。
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ROOT = process.cwd();
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'site-config.json'), 'utf-8'));
const portal = cfg.portal;
const G = {
  releaseBase: (tag) => `https://github.com/${portal.owner}/${portal.repo}/releases/download/${tag}`,
  fullZip: (v) => `qqbot-card-editor-${v}.zip`,
  patchZip: (v) => `qqbot-card-editor-patch-${v}.zip`,
};

function sh(cmd) {
  try { return execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return ''; }
}

const cur = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'update-config.json'), 'utf-8')); } catch { return {}; }
})();
const currentVersion = String(cur.version || '');
const currentChangeLog = String(cur.changeLog || '');

const tags = sh(`git tag -l 'v*' --sort=-v:refname`).split('\n').filter(Boolean);
const releases = tags.map((tag) => {
  const v = String(tag).replace(/^v/, '');
  const date = sh(`git log -1 --format=%cd --date=short '${tag}'`) || '';
  const rel = G.releaseBase(tag);
  const mirrors = (portal.mirrors || []).map((m) => ({ name: m.name, prefix: m.prefix }));
  const mk = (zip) => ({
    main: `${rel}/${zip}`,
    mirrors: mirrors.map((m) => ({ name: m.name, url: `${m.prefix}${rel}/${zip}` })),
    si: `${portal.siBase}/${zip}`,
  });
  return {
    version: v,
    tag,
    date,
    isCurrent: v === currentVersion,
    patch: mk(G.patchZip(v)),
    full: mk(G.fullZip(v)),
  };
});

const plugins = (cfg.plugins || []).map((p) => ({
  file: p.file,
  name: p.name,
  desc: p.desc,
  pages: `${portal.pagesUrl}/${p.file}`,
  si: `${portal.siBase}/${p.file}`,
}));

const data = {
  site: portal.title,
  description: portal.description,
  owner: portal.owner,
  repo: portal.repo,
  repoUrl: portal.repoUrl,
  pagesUrl: portal.pagesUrl,
  configUrl: `${portal.pagesUrl}/update-config.json`,
  updateConfig: `${portal.pagesUrl}/update-config.json`,
  current: { version: currentVersion, changeLog: currentChangeLog },
  releases,
  plugins,
  giscus: cfg.giscus,
  // 稳定时间戳：取最新版本 tag 的发布日期；无 tag 时才用当前时间。避免无关内容空转提交。
  generatedAt: (() => {
    const d = releases.length && releases[0].date ? `${releases[0].date}T00:00:00.000Z` : new Date().toISOString();
    return d;
  })(),
};
fs.writeFileSync(path.join(ROOT, 'releases.json'), JSON.stringify(data, null, 2), 'utf-8');

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function giscusBlock() {
  return cfg.giscus && cfg.giscus.enabled && cfg.giscus.repoId && cfg.giscus.categoryId ? `
  <div class="box">
    <h2>评论区 / 留言</h2>
    <script src="https://giscus.app/client.js"
      data-repo="${esc(cfg.giscus.repo)}"
      data-repo-id="${esc(cfg.giscus.repoId)}"
      data-category="${esc(cfg.giscus.category || 'Announcements')}"
      data-category-id="${esc(cfg.giscus.categoryId)}"
      data-mapping="pathname" data-strict="1" data-reactions-enabled="1" data-emit-metadata="0"
      data-input-position="top" data-theme="light" data-lang="zh-CN" data-loading="lazy" async>
    </script>` : `
  <div class="box muted">评论区需启用 Giscus：在仓库开启 Discussions 并授权 Giscus App 后，把 <code>site-config.json</code> 的 <code>giscus.repoId/categoryId</code> 填上（giscus.app 生成），再跑一次本生成器即可。详见仓库 <code>docs/GitHub自动发布与站点维护.md</code>。</div>`;
}

function page(title, nav, body, showGiscus) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ${esc(data.site)}</title>
<style>
  :root{--bg:#f6f8fa;--card:#fff;--line:#d0d7de;--text:#1f2328;--muted:#57606a;--accent:#0969da;--ok:#1a7f37;--warn:#9a6700}
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--text)}
  header{background:var(--card);border-bottom:1px solid var(--line);padding:18px 20px}
  header .wrap{max-width:1024px;margin:0 auto}
  h1{margin:0 0 4px;font-size:22px}
  header p{margin:2px 0;color:var(--muted);font-size:14px}
  nav{margin-top:10px}
  nav a{display:inline-block;margin-right:8px;padding:6px 14px;border:1px solid var(--line);border-radius:20px;text-decoration:none;color:var(--text);font-size:13px;background:var(--card)}
  nav a:hover{border-color:var(--accent);color:var(--accent)}
  main{max-width:1024px;margin:22px auto;padding:0 16px}
  .box{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:18px;margin-bottom:18px}
  .muted{color:var(--muted)}
  h2{font-size:17px;margin:0 0 12px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{border:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}
  th{background:#f0f3f6;white-space:nowrap}
  code{background:#f0f3f6;padding:1px 6px;border-radius:4px;font-size:12px;word-break:break-all}
  .tag{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px}
  .tag-cur{background:#ddf4e4;color:var(--ok)}
  .tag-old{background:#f0f3f6;color:var(--muted)}
  .btn{display:inline-block;margin:2px 4px 2px 0;padding:4px 12px;border:1px solid var(--line);border-radius:6px;text-decoration:none;font-size:12px;color:var(--accent);background:#fff}
  .btn:hover{border-color:var(--accent);background:#f3f8ff}
  .btn-main{background:var(--accent);border-color:var(--accent);color:#fff}
  .changelog{white-space:pre-wrap;font-size:13px;color:var(--text);background:#fff8e6;border:1px solid #eed;padding:12px;border-radius:8px}
  .empty{color:var(--muted);padding:20px 0;text-align:center}
  footer{max-width:1024px;margin:26px auto 40px;padding:0 16px;color:var(--muted);font-size:12px}
  @media(max-width:640px){main,header .wrap,footer{padding-left:12px;padding-right:12px}table,thead,tbody,th,td,tr{display:block}thead{display:none}td{border:none;padding:4px 0}tr{border:1px solid var(--line);margin-bottom:10px;padding:8px;border-radius:8px}}
</style>
</head>
<body>
<header><div class="wrap">
  <h1>${esc(data.site)}</h1>
  <p>${esc(data.description)}</p>
  <nav><a href="${esc(portal.repoUrl)}">GitHub 仓库</a><a href="${esc(portal.pagesUrl)}">首页</a><a href="releases.html">版本列表</a><a href="downloads.html">补丁/插件下载</a></nav>
</div></header>
<main>
${body}
${showGiscus ? giscusBlock() : ''}
</main>
<footer>由 scripts/site-gen.mjs 自动生成（GitHub Actions 定时/发版触发，自动提交回仓库）· 生成时间 ${esc(data.generatedAt.replace('T', ' ').slice(0, 19))}</footer>
</body></html>`;
}

function versionTable() {
  if (!releases.length) return '<div class="box empty">暂无 Release（git tag 为空）</div>';
  const rows = releases.map((r) => {
    const dl = (zip, label) => {
      const main = r[zip === 'patch' ? 'patch' : 'full'].main;
      const mir = r[zip === 'patch' ? 'patch' : 'full'].mirrors;
      const si = r[zip === 'patch' ? 'patch' : 'full'].si;
      const links = [main, ...mir.map((m) => m.url), si];
      return `<a class="btn btn-main" href="${esc(main)}">${label}（主源）</a><br>` +
        links.map((u) => `<a class="btn" href="${esc(u)}">${esc(u.replace(/^https?:\/\//, '').split('/')[0])}</a>`).join('');
    };
    const note = r.isCurrent && currentChangeLog ? '<span class="tag tag-cur">当前</span>' : '';
    return `<tr><td><b>${esc(r.version)}</b> ${note}<br>${esc(r.date || '')}</td>
      <td>${dl('patch', '补丁包')}</td>
      <td>${dl('full', '全量包')}</td></tr>`;
  }).join('');
  return `<div class="box"><h2>版本列表 / 补丁列表</h2>
    <p class="muted">每个版本对应 GitHub Release 资产；下载前服务器端会对 GitHub Release / GitHub Pages / 加速镜像 / AI 服务器(8091) 自动 HEAD 测速择优。</p>
    <table><thead><tr><th>版本</th><th>补丁包（增量）</th><th>全量包</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function pluginBox() {
  if (!plugins.length) return '';
  const rows = plugins.map((p) => `<tr><td><b>${esc(p.name)}</b><br><code>${esc(p.file)}</code></td>
    <td>${esc(p.desc)}</td>
    <td><a class="btn btn-main" href="${esc(p.pages)}">GitHub Pages</a><a class="btn" href="${esc(p.si)}">AI 服务器(8091)</a></td></tr>`).join('');
  return `<div class="box"><h2>插件 / 文档下载</h2>
    <table><thead><tr><th>名称</th><th>说明</th><th>下载</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function updateBox() {
  if (!currentVersion) return '';
  return `<div class="box"><h2>最新版本 ${esc(currentVersion)} 更新内容</h2>
    <div class="changelog">${esc(currentChangeLog || '（暂无更新内容，见 update-config.json changeLog）')}</div>
    <p style="margin-top:10px"><a class="btn btn-main" href="${esc(data.updateConfig)}">update-config.json（服务器自动更新源）</a>
    <a class="btn" href="${esc(data.configUrl)}">从 GitHub Pages 获取更新配置</a></p></div>`;
}

function homeBody() {
  const quick = releases.length ? `<div class="box"><h2>历史版本</h2>
    <table><thead><tr><th>版本</th><th>下载</th><th></th></tr></thead><tbody>` +
    releases.map((r) => `<tr><td><b>${esc(r.version)}</b>${r.isCurrent ? ' <span class="tag tag-cur">当前</span>' : ''}<br>${esc(r.date || '')}</td>
      <td><a class="btn btn-main" href="${esc(r.patch.main)}">补丁包</a><a class="btn" href="${esc(r.full.main)}">全量包</a></td>
      <td><a class="btn" href="releases.html">全部镜像与备用源</a></td></tr>`).join('') +
    `</tbody></table></div>` : '';
  const srcs = (portal.mirrors || []).map((m) => `<tr><td>${esc(m.name)}</td><td><code>${esc(m.prefix)}…</code></td></tr>`).join('');
  const welcome = `<div class="box"><h2>欢迎使用「${esc(data.site)}」更新门户</h2>
    <p>这里是 ${esc(data.site)}（QQgfbot 4.x）的版本 / 补丁 / 插件下载与留言板。服务器与群内「更新系统」会自动对下列通道 HEAD 测速，快源优先、失败逐个兜底。</p>
    <p style="margin-top:10px"><a class="btn btn-main" href="releases.html">版本列表 / 补丁列表</a>
    <a class="btn btn-main" href="downloads.html">补丁 / 插件下载</a>
    <a class="btn" href="${esc(portal.repoUrl)}">GitHub 仓库</a>
    <a class="btn" href="${esc(portal.repoUrl)}/blob/main/README.md">项目说明（README）</a></p></div>`;
  const sources = `<div class="box"><h2>更新源 / 下载通道（自动择优）</h2>
    <table><thead><tr><th>通道</th><th>地址</th></tr></thead><tbody>
    <tr><td>GitHub Pages（主源，全球 CDN）</td><td><a class="btn btn-main" href="${esc(portal.pagesUrl)}/update-config.json">update-config.json</a><a class="btn" href="${esc(portal.pagesUrl)}">门户首页</a></td></tr>
    <tr><td>GitHub Release 直连</td><td><a class="btn" href="${esc(portal.repoUrl)}/releases">Release 页面</a></td></tr>
    ${srcs}
    <tr><td>AI 服务器（8091 备用源，临时预览域名）</td><td><code>${esc(portal.siBase)}/…</code></td></tr>
    </tbody></table></div>`;
  return welcome + updateBox() + quick + pluginBox() + sources;
}

fs.writeFileSync(path.join(ROOT, 'index.html'), page('首页', '', homeBody(), true), 'utf-8');
fs.writeFileSync(path.join(ROOT, 'releases.html'), page('版本与补丁列表', '', updateBox() + versionTable(), true), 'utf-8');
fs.writeFileSync(path.join(ROOT, 'downloads.html'), page('补丁与插件下载', '', updateBox() + pluginBox() + versionTable(), true), 'utf-8');

console.log(`[site-gen] tags=${tags.length} releases=${releases.length} plugins=${plugins.length} current=${currentVersion}`);
