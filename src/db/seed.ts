import { getDb } from './index';

// ============================================================
// 种子函数：首次启动时从 plugins/ 目录注册全部插件并创建默认 dict.txt
// （内置插件不内嵌在代码中，统一以 plugins/*.js 文件作为唯一数据源）
// ============================================================
export function seedExamplePlugins() {
  const db = getDb();
  // 检查是否已有插件，若有则跳过，避免重复插入
  const count = db.prepare('SELECT COUNT(*) as count FROM plugins').get() as any;
  if (count.count > 0) return;

  const fs = require('fs');
  const path = require('path');
  const pluginsDir = path.join(process.cwd(), 'plugins');

  // 从 plugins/ 目录读取全部 *.js 插件并注册（enabled=1 默认启用、approved=1 直接批准）
  if (fs.existsSync(pluginsDir)) {
    const files = fs.readdirSync(pluginsDir).filter((f: string) => f.endsWith('.js'));
    for (const file of files) {
      const pluginName = file.replace(/\.js$/, '');
      try {
        const code = fs.readFileSync(path.join(pluginsDir, file), 'utf-8');
        db.prepare(
          `INSERT INTO plugins (id, name, description, code, enabled, version, type, approved, owner)
           VALUES (?, ?, ?, ?, 1, '1.0.0', 'code', 1, 'system')`
        ).run('file-' + pluginName, pluginName, '', code);
      } catch (e) {
        console.error('[seed] Failed to register plugin file: ' + file + ' ' + (e as Error).message);
      }
    }
  }

  // 创建初始 dict.txt 文件（若不存在）
  const dictPath = path.join(pluginsDir, 'dict.txt');
  if (!fs.existsSync(dictPath)) {
    const dictContent = [
      '# QQ Bot Dictionary File',
      '# Format: keyword|reply',
      '# Lines starting with # are comments',
      '# Reply can be text or JSON for buttons/markdown',
      '',
      '# 示例：',
      '# 菜单|{"type":"keyboard","content":"请选择功能","buttons":[["帮助","时间","天气"]]}',
      '# 运势|{"type":"markdown","content":"**今日运势**\\n{{fortune}}"}',
      '# 时间|当前时间：{{time}}',
      '# 骰子|🎲 掷出了 {{dice}} 点',
      '# 猜数字|{{number}}（这会开启猜数字游戏）',
      ''
    ].join('\n');
    fs.writeFileSync(dictPath, dictContent, 'utf8');
  }
}
