// 打包脚本：构建后生成 TS 版与纯 JS 版交付 zip
// 关键：入口必须为 ESM 格式的 index.mjs（引擎 loadZipPlugin 走 import()，mod.default 即插件本体；
//       CJS 的 module.exports={default:plugin} 会被包成 {default:{default:plugin}}，onEnable 丢失）
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const AdmZip = require('/workspace/node_modules/adm-zip');

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname));

// ---- 构建 dist ----
mkdirSync(path.join(root, 'dist'), { recursive: true });
rmSync(path.join(root, 'dist', 'webui'), { recursive: true, force: true });
cpSync(path.join(root, 'src', 'webui'), path.join(root, 'dist', 'webui'), { recursive: true });

await build({
  entryPoints: [path.join(root, 'src', 'index.ts')],
  outfile: path.join(root, 'dist', 'index.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2020',
  legalComments: 'none',
});

await build({
  entryPoints: [path.join(root, 'src', 'index.ts')],
  outfile: path.join(root, 'dist', 'index.cjs'),
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'es2020',
  legalComments: 'none',
});

const PKG = {
  name: 'unified-menu-plugin',
  version: "1.2.1",
  description: '统一菜单插件：按钮菜单/权限修复/全功能补全（娱乐/签到/授权/群管/频道/DIC）',
  main: 'index.mjs',
  webui: 'webui/index.html',
  author: '511742399',
};
const PKG_JSON = JSON.stringify(PKG, null, 2) + '\n';

function addDir(zip, absDir, zipPrefix) {
  for (const name of readdirSafe(absDir)) {
    const abs = path.join(absDir, name);
    const rel = zipPrefix ? zipPrefix + '/' + name : name;
    if (statSafe(abs)?.isDirectory()) {
      addDir(zip, abs, rel);
    } else {
      zip.addLocalFile(abs, path.dirname(rel));
    }
  }
}
function readdirSafe(d) { try { return require('fs').readdirSync(d); } catch { return []; } }
function statSafe(p) { try { return require('fs').statSync(p); } catch { return null; } }

// ---- TS 版 zip：根入口 index.mjs + webui/ + src + dist ----
const tsTmp = path.join('/tmp/opencode', 'pack-ts');
rmSync(tsTmp, { recursive: true, force: true });
mkdirSync(tsTmp, { recursive: true });
const tsv = path.join(tsTmp, 'unified-menu-plugin');
mkdirSync(tsv, { recursive: true });
cpSync(path.join(root, 'dist', 'index.mjs'), path.join(tsv, 'index.mjs'));
cpSync(path.join(root, 'dist', 'webui'), path.join(tsv, 'webui'), { recursive: true });
cpSync(path.join(root, 'dist'), path.join(tsv, 'dist'), { recursive: true });
cpSync(path.join(root, 'src'), path.join(tsv, 'src'), { recursive: true });
cpSync(path.join(root, 'build.mjs'), path.join(tsv, 'build.mjs'));
cpSync(path.join(root, 'tsconfig.json'), path.join(tsv, 'tsconfig.json'));
cpSync(path.join(root, 'README.md'), path.join(tsv, 'README.md'));
writeFileSync(path.join(tsv, 'package.json'), PKG_JSON);

const zipTS = new AdmZip();
addDir(zipTS, tsTmp, '');
zipTS.writeZip('/workspace/unified-menu-plugin-v1.2.1.zip');

// ---- JS 版 zip：根入口 index.mjs(ESM) + webui/ ----
const jsTmp = path.join('/tmp/opencode', 'pack-js');
rmSync(jsTmp, { recursive: true, force: true });
mkdirSync(jsTmp, { recursive: true });
const jsv = path.join(jsTmp, 'unified-menu-plugin-js');
mkdirSync(jsv, { recursive: true });
cpSync(path.join(root, 'dist', 'index.mjs'), path.join(jsv, 'index.mjs'));
cpSync(path.join(root, 'dist', 'webui'), path.join(jsv, 'webui'), { recursive: true });
cpSync(path.join(root, 'README.md'), path.join(jsv, 'README.md'));
writeFileSync(path.join(jsv, 'package.json'), PKG_JSON);

const zipJS = new AdmZip();
addDir(zipJS, jsTmp, '');
zipJS.writeZip('/workspace/unified-menu-plugin-js-v1.2.1.zip');

console.log('pack ok:');
console.log('  TS /workspace/unified-menu-plugin-v1.2.1.zip  (' + zipTS.toBuffer().length + 'B)');
console.log('  JS /workspace/unified-menu-plugin-js-v1.2.1.zip (' + zipJS.toBuffer().length + 'B)');
