#!/usr/bin/env node
// 开发与使用文档包构建：把 docs/ + 示例组合成 qqbot-dev-docs.zip
// 用法：node scripts/build-dev-docs-zip.mjs
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';

const ROOT = path.resolve();
const STAGE = path.join(os.tmpdir(), 'qqbot-dev-docs-stage');
const OUT = path.join(ROOT, 'qqbot-dev-docs.zip');

// 源(相对工作区) -> zip 内路径
const FILES = [
  ['docs/文档包README.md', '开发文档/README.md'],
  ['docs/插件索引与命令总览.md', '开发文档/插件索引与命令总览.md'],
  ['docs/终端开发与使用文档.md', '开发文档/终端开发与使用文档.md'],
  ['docs/PHP插件开发文档.md', '开发文档/PHP插件开发文档.md'],
  ['docs/Python插件开发文档.md', '开发文档/Python插件开发文档.md'],
  ['docs/插件API帮助文档.md', '开发文档/插件API帮助文档.md'],
  ['docs/BotAPI参考.md', '开发文档/BotAPI参考.md'],
  ['docs/CQ码参考.md', '开发文档/CQ码参考.md'],
  ['docs/go-cqhttp-API参考.md', '开发文档/go-cqhttp-API参考.md'],
  ['docs/NapCat-Termux-部署.md', '开发文档/NapCat-Termux-部署.md'],
  ['docs/NapCat插件兼容层.md', '开发文档/NapCat插件兼容层.md'],
  ['docs/编辑器-使用说明.md', '开发文档/编辑器-使用说明.md'],
  ['docs/插件功能', '开发文档/插件功能'],
  ['plugins/测试.py', '开发文档/示例/测试.py'],
  ['plugins/python-plugin-template.zip', '开发文档/python-plugin-template.zip'],
];

for (const [src, dst] of FILES) {
  const s = path.join(ROOT, src);
  const d = path.join(STAGE, dst);
  if (!fs.existsSync(s)) { console.warn(`[skip] 缺少源文件: ${src}`); continue; }
  fs.mkdirSync(path.dirname(d), { recursive: true });
  fs.cpSync(s, d, { recursive: true, force: true });
  console.log(`[stage] ${src} -> ${dst}`);
}

fs.mkdirSync(STAGE, { recursive: true });
execFileSync('zip', ['-rFS', OUT, '开发文档'], { cwd: STAGE, stdio: 'inherit' });

const size = fs.statSync(OUT).size;
const list = execFileSync('unzip', ['-l', OUT], { encoding: 'utf-8' });
console.log(`\n[zip] ${OUT} (${(size / 1024).toFixed(1)} KB)\n${list}`);
