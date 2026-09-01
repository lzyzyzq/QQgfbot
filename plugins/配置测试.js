// 配置测试 v1.0.0 - 验证「插件卡片·后台编辑器」配置与全局变量能准确作用到插件内部代码
// 用法（命令=调用名）：
//   「变量测试」                → 输出 编辑器保存的卡片标题 + 全部全局变量
//   「变量测试 设置 变量名=值」  → 写入全局变量（ctx.engine.setVariable）
//   「变量测试 读取 变量名」     → 读取单个全局变量（ctx.engine.getVariable）
//   「变量测试 清空 变量名」     → 将变量值清空
// 验证方法：
//   1) 在 menu-editor 选「配置测试」插件 → 改第一个 title 区块文字 → 保存
//   2) 群里发「变量测试」→ 输出的「编辑器卡片标题」应变为保存的新文字
//   3) 发「变量测试 设置 测试变量=hello」→ 输出的全局变量列表应包含 测试变量 = hello
module.exports = {
  manifest: {
    id: 'mod-config-test',
    name: '配置测试',
    version: '1.0.0',
    description: '验证编辑器配置与全局变量能否准确作用到插件内部代码（测试专用）：变量测试 / 变量测试 设置 名=值 / 变量测试 读取 名',
    author: 'system'
  },

  methods: {
    readPage: function(ctx, botId) {
      try {
        var raw = ctx.storage.get('config');
        var all = JSON.parse(raw || '{}');
        var cfg = (all[botId] && typeof all[botId] === 'object') ? all[botId] : {};
        var pages = (cfg.pages && typeof cfg.pages === 'object') ? cfg.pages : {};
        var main = (cfg.main_page && pages[cfg.main_page]) ? cfg.main_page : (Object.keys(pages)[0] || '');
        if (main && pages[main]) return { main: main, pages: pages, cfg: cfg };
      } catch (e) {}
      return null;
    },
    firstTitle: function(pages, main) {
      var page = (main && pages[main]) || null;
      if (page && Array.isArray(page.blocks)) {
        for (var i = 0; i < page.blocks.length; i++) {
          var b = page.blocks[i];
          if (b && b.type === 'title' && b.text) return String(b.text);
          if (b && b.type === '__group' && Array.isArray(b.children)) {
            for (var j = 0; j < b.children.length; j++) {
              var c = b.children[j];
              if (c && c.type === 'title' && c.text) return String(c.text);
            }
          }
        }
      }
      return '';
    },
    dumpVars: function(ctx) {
      try {
        if (ctx.engine && ctx.engine.listVariables) {
          var vars = ctx.engine.listVariables() || {};
          var keys = Object.keys(vars);
          if (!keys.length) return '（无）';
          return keys.map(function(k) { return '  ' + k + ' = ' + String(vars[k]); }).join('\n');
        }
      } catch (e) {}
      return '（listVariables 不可用）';
    }
  },

  onEnable: function(ctx) {
    ctx.logger.info('配置测试 v1.0.0 已加载');
    var self = this;
    ctx.eventBus.on('message.c2c', function(data) { try { self.handle(ctx, data); } catch (e) {} });
    ctx.eventBus.on('message.group', function(data) { try { self.handle(ctx, data); } catch (e) {} });
  },

  handle: async function(ctx, data) {
    try {
      var content = String(data.content || '').trim();
      var userId = (data.author && data.author.openid) || '';
      var groupId = data.groupId;
      var botId = data.botId || '';
      var msgId = data.id;
      var send = function(text) {
        if (groupId) return ctx.bot.sendGroupMessage(groupId, text, msgId);
        return ctx.bot.sendPrivateMessage(userId, text, msgId);
      };
      if (content !== '变量测试' && content.indexOf('变量测试 ') !== 0) return false;

      var cfgInfo = this.methods.readPage(ctx, botId);
      var title = cfgInfo ? this.methods.firstTitle(cfgInfo.pages, cfgInfo.main) : '';
      var titleLine = '📄 编辑器卡片标题：' + (title || '（编辑器未保存配置 / 无 title 区块）');

      // 写入全局变量
      var mSet = content.match(/^变量测试\s+设置\s+([^=\s]+)\s*=\s*(.+)$/);
      if (mSet) {
        var vn = String(mSet[1]).trim();
        var vv = String(mSet[2]).trim();
        try {
          if (ctx.engine && ctx.engine.setVariable) ctx.engine.setVariable(vn, vv);
          await send('✅ 已写入全局变量：' + vn + ' = ' + vv + '\n\n' + titleLine + '\n\n🔑 当前全局变量：\n' + this.methods.dumpVars(ctx));
        } catch (e) {
          await send('❌ 写入失败：' + (e && e.message || e));
        }
        return true;
      }

      // 读取单个变量
      var mRead = content.match(/^变量测试\s+读取\s+([^=\s]+)$/);
      if (mRead) {
        var rn = String(mRead[1]).trim();
        var val = null;
        try { if (ctx.engine && ctx.engine.getVariable) val = ctx.engine.getVariable(rn); } catch (e) {}
        await send('🔑 变量「' + rn + '」 = ' + (val === null || val === undefined ? '（未设置）' : String(val)));
        return true;
      }

      // 清空变量
      var mClear = content.match(/^变量测试\s+清空\s+([^=\s]+)$/);
      if (mClear) {
        var cn = String(mClear[1]).trim();
        try { if (ctx.engine && ctx.engine.setVariable) ctx.engine.setVariable(cn, ''); } catch (e) {}
        await send('🗑 已清空变量「' + cn + '」\n\n' + titleLine + '\n\n🔑 当前全局变量：\n' + this.methods.dumpVars(ctx));
        return true;
      }

      // 输出当前配置 + 全部变量 + data/database 文件读写
      if (content === '变量测试') {
        var fileLine = '';
        try {
          if (ctx.data && ctx.data.writeJSON) {
            var stats = ctx.data.readJSON('配置测试统计.json', {});
            if (!stats || typeof stats !== 'object') stats = {};
            stats.last_user = userId || 'unknown';
            stats.calls = (stats.calls || 0) + 1;
            stats.last_at = new Date().toISOString();
            ctx.data.writeJSON('配置测试统计.json', stats);
            fileLine = '\n\n📁 data/database 文件：配置测试统计.json（调用 ' + stats.calls + ' 次）';
          }
        } catch (e) {}
        await send('🧪 配置测试插件\n━━━━━━━━━━━━━━\n' + titleLine + '\n\n🔑 当前全局变量：\n' + this.methods.dumpVars(ctx) + fileLine);
        return true;
      }
      return false;
    } catch (e) {
      try { ctx.logger.error('配置测试 handle error: ' + (e && e.message)); } catch (_) {}
      return false;
    }
  }
};
