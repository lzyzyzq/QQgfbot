/* ============================================================
 * QQTester · 共享「模拟群消息」气泡测试视图组件
 * 供 index.html / menu-editor.html 等后台页面共用：
 *   - window.QQTester.open(pluginName, { botValue }) 打开测试会话
 *   - 渲染「用户消息（右侧气泡）→ 机器人回复（左侧气泡）」
 *   - 复用页面 localStorage.admin_token 的鉴权方式调用 /api/plugins/test
 * 纯静态文件，无外部依赖。用法：<script src="tester.js"></script>
 * ============================================================ */
(function(){
  var TOKEN = 'admin_token';
  var root = null, curPlugin = '', busy = false, botValue = null;

  function $(id){ return document.getElementById(id); }
  function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function api(url, opts){
    opts = opts || {};
    var headers = {};
    var token = localStorage.getItem(TOKEN) || '';
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (opts.body) headers['Content-Type'] = 'application/json';
    return fetch(url, Object.assign({}, opts, { headers: Object.assign({}, headers, opts.headers || {}), credentials: 'same-origin', cache: 'no-store' }))
      .then(function(r){
        return r.text().then(function(txt){
          var d = null;
          try { d = JSON.parse(txt); } catch(e){}
          if (d && typeof d === 'object') return { ok: r.ok, status: r.status, data: d };
          return { ok: false, status: r.status, data: { error: '后端返回异常 HTTP ' + r.status } };
        });
      })
      .catch(function(err){ return { ok: false, status: 0, data: { error: '网络请求失败：' + (err && err.message || err) } }; });
  }

  function style(){
    if ($('qqt-style')) return;
    var st = document.createElement('style');
    st.id = 'qqt-style';
    st.textContent =
      '.qqt-root{position:fixed;inset:0;z-index:80;background:rgba(15,23,42,.5);display:none;align-items:center;justify-content:center;padding:16px}' +
      '.qqt-root.active{display:flex}' +
      '.qqt{width:min(560px,96vw);height:min(680px,92vh);background:#f3f5f8;border-radius:16px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 18px 60px rgba(0,0,0,.35)}' +
      '.qqt-head{display:flex;align-items:center;gap:8px;padding:12px 16px;background:linear-gradient(135deg,#1e3a8a,#2563eb);color:#fff;font-size:14px;font-weight:600}' +
      '.qqt-head .qqt-fn{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.qqt-head .qqt-scene{background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.35);color:#fff;border-radius:8px;font-size:12px;padding:3px 6px}' +
      '.qqt-x{background:none;border:none;color:#fff;font-size:16px;cursor:pointer;padding:2px 6px;opacity:.9}' +
      '.qqt-msgs{flex:1;overflow-y:auto;padding:16px 14px;display:flex;flex-direction:column;gap:10px;background:#eef1f5}' +
      '.qqt-row{display:flex;gap:8px;max-width:86%;align-items:flex-start}' +
      '.qqt-row.me{flex-direction:row-reverse;align-self:flex-end}' +
      '.qqt-av{width:30px;height:30px;border-radius:8px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;background:linear-gradient(135deg,#93c5fd,#2563eb)}' +
      '.qqt-row.me .qqt-av{background:linear-gradient(135deg,#6ee7b7,#059669)}' +
      '.qqt-bubble{background:#fff;border-radius:4px 12px 12px 12px;padding:8px 12px;font-size:13px;line-height:1.7;color:#1f2937;white-space:pre-wrap;word-break:break-word;box-shadow:0 1px 2px rgba(0,0,0,.06)}' +
      '.qqt-row.me .qqt-bubble{background:#95ec69;border-radius:12px 4px 12px 12px}' +
      '.qqt-tag{display:inline-block;font-size:10px;background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe;border-radius:6px;padding:0 5px;margin-right:6px;vertical-align:1px}' +
      '.qqt-row.err .qqt-bubble{background:#fee2e2;color:#991b1b}' +
      '.qqt-row.sys .qqt-bubble{background:transparent;color:#94a3b8;box-shadow:none;font-size:11px;text-align:center;width:100%;max-width:100%}' +
      '.qqt-input{border-top:1px solid #e2e8f0;background:#fff;padding:10px 12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}' +
      '.qqt-input input[type=text]{flex:1;min-width:120px;border:1px solid #d9e2ef;border-radius:8px;padding:8px 10px;font-size:13px;outline:none}' +
      '.qqt-input input:focus{border-color:#2563eb}' +
      '.qqt-send{border:none;border-radius:8px;background:#2563eb;color:#fff;padding:8px 14px;font-size:13px;cursor:pointer}' +
      '.qqt-send:disabled{opacity:.5;cursor:not-allowed}' +
      '.qqt-bot-hint{width:100%;font-size:11px;color:#94a3b8;display:flex;gap:6px;align-items:center}' +
      '.qqt-bot-hint select{flex:1;min-width:0;border:1px solid #d9e2ef;border-radius:8px;font-size:12px;padding:4px 6px;color:#475569}';
    document.head.appendChild(st);
  }

  function ensureRoot(){
    style();
    if (root) return;
    root = document.createElement('div');
    root.className = 'qqt-root';
    root.id = 'qqtTesterRoot';
    root.innerHTML =
      '<div class="qqt">' +
        '<div class="qqt-head">' +
          '<span>模拟群消息 · </span><span class="qqt-fn" id="qqtTitle"></span>' +
          '<select class="qqt-scene" id="qqtScene" title="测试场景"><option value="group">群聊</option><option value="c2c">私聊</option></select>' +
          '<button class="qqt-x" id="qqtClose" title="关闭">X</button>' +
        '</div>' +
        '<div class="qqt-msgs" id="qqtMsgs"></div>' +
        '<div class="qqt-input">' +
          '<input type="text" id="qqtMsg" placeholder="输入要模拟触发的群消息" maxlength="200">' +
          '<button class="qqt-send" id="qqtSend">测试</button>' +
          '<div class="qqt-bot-hint"><span>触发机器人：</span><select id="qqtBot"></select></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(root);
    root.addEventListener('click', function(e){ if (e.target === root) close(); });
    $('qqtClose').onclick = close;
    $('qqtSend').onclick = send;
    var msg = $('qqtMsg');
    msg.addEventListener('keydown', function(e){ if (e.key === 'Enter') send(); });
  }

  function fillBotSelect(){
    var sel = $('qqtBot');
    sel.innerHTML = '';
    var candidates = [];
    if (botValue && botValue.value){
      var cv = botValue.value();
      if (cv) candidates.push(cv);
    }
    var others = [];
    var bsel = $(botValue && botValue.selectId || null);
    if (bsel && bsel.tagName === 'SELECT'){
      Array.prototype.forEach.call(bsel.options, function(o){ if (o.value) others.push(o.value); });
    }
    others.forEach(function(v){ if (candidates.indexOf(v) < 0) candidates.push(v); });
    if (!candidates.length) candidates = [''];
    candidates.forEach(function(v, i){
      var o = document.createElement('option');
      o.value = v;
      o.textContent = v || '（未选机器人 → 使用平台默认）';
      sel.appendChild(o);
    });
  }

  function scrollBottom(){
    var m = $('qqtMsgs');
    m.scrollTop = m.scrollHeight;
  }
  function bubble(cls, av, tagHtml, text){
    var msgs = $('qqtMsgs');
    var row = document.createElement('div');
    row.className = 'qqt-row' + (cls ? ' ' + cls : '');
    var avEl = document.createElement('div');
    avEl.className = 'qqt-av';
    avEl.textContent = av;
    var bub = document.createElement('div');
    bub.className = 'qqt-bubble';
    bub.innerHTML = (tagHtml || '') + esc(text);
    row.appendChild(avEl);
    row.appendChild(bub);
    msgs.appendChild(row);
    scrollBottom();
  }
  function sys(msg){
    var row = document.createElement('div');
    row.className = 'qqt-row sys';
    var bub = document.createElement('div');
    bub.className = 'qqt-bubble';
    bub.textContent = msg;
    row.appendChild(bub);
    $('qqtMsgs').appendChild(row);
    scrollBottom();
  }

  function send(){
    if (busy) return;
    var txt = $('qqtMsg').value.trim();
    if (!txt){ sys('请输入要模拟触发的消息内容'); return; }
    var scene = $('qqtScene').value;
    var botId = $('qqtBot').value;
    busy = true;
    $('qqtSend').disabled = true;
    bubble('me', 'U', null, txt);
    sys('正在模拟触发「' + curPlugin + '」…（' + (scene === 'group' ? '群聊' : '私聊') + (botId ? ' · 机器人 ' + botId : '') + '）');
    api('/api/plugins/test', {
      method: 'POST',
      body: JSON.stringify({
        plugin_name: curPlugin,
        message: txt,
        user_id: 'TESTUSER',
        user_name: '测试用户',
        group_id: scene === 'group' ? 'TESTGROUP' : '',
        group_name: '测试群聊',
        bot_id: botId
      })
    }).then(function(r){
      busy = false;
      $('qqtSend').disabled = false;
      renderIncoming(r.data, r);
    });
  }

  function renderIncoming(d, r){
    d = d || {};
    if (!r || !r.ok){
      bubble('err', 'B', '<span class="qqt-tag">[失败]</span>', (d.error || d.msg || ('HTTP ' + (r && r.status || '?'))) + ((r && r.status === 403) ? '\n（无测试权限，请联系超级主人开通）' : ''));
      return;
    }
    var replies = d.replies || [];
    var msgs = d.messages || [];
    var n = 0;
    replies.forEach(function(x){ bubble('', 'B', '<span class="qqt-tag">回复</span>', String(x)); n++; });
    msgs.forEach(function(x){
      if (typeof x === 'string'){ bubble('', 'B', '<span class="qqt-tag">消息</span>', x); }
      else if (x && typeof x === 'object'){
        var tag = '<span class="qqt-tag">' + esc(x.type || '消息') + '</span>';
        var body = x.content ? (typeof x.content === 'string' ? x.content : JSON.stringify(x.content)) : JSON.stringify(x);
        bubble('', 'B', tag, body);
      }
      n++;
    });
    if (d.error) bubble('err', 'B', '<span class="qqt-tag">[失败]</span>', String(d.error));
    if (!n){
      if (d.status === 'ok' || d.ok) sys('已触发，插件无消息输出（可能静默处理或未授权发送）');
      else sys('已触发，无可见输出（status=' + esc(d.status || '?') + '）');
    }
  }

  // 供既有后台测试功能复用：直接把一次测试请求的结果渲染为气泡会话
  function showReplies(pluginName, opts){
    opts = opts || {};
    ensureRoot();
    curPlugin = pluginName || curPlugin;
    botValue = (opts.selectId || opts.botValue) ? { selectId: opts.selectId } : null;
    if (opts.botValue) botValue = { value: opts.botValue };
    $('qqtTitle').textContent = curPlugin;
    $('qqtMsgs').innerHTML = '';
    fillBotSelect();
    var bv = $('qqtBot').value;
    $('qqtMsg').placeholder = '输入要模拟触发「' + curPlugin + '」的群消息';
    root.classList.add('active');
    sys(opts.note || '使用已选机器人「' + (opts.botId || bv || '默认') + '」触发的测试结果：');
    if (opts.input) bubble('me', 'U', null, opts.input);
    renderIncoming(opts, { ok: !opts.error && !opts.httpError, status: opts.httpStatus });
    if (window !== undefined && window !== this){}
  }

  function open(pluginName, opts){
    curPlugin = pluginName || '';
    botValue = opts || null;
    ensureRoot();
    $('qqtTitle').textContent = curPlugin;
    $('qqtMsgs').innerHTML = '';
    fillBotSelect();
    $('qqtMsg').value = '群信息';
    $('qqtMsg').placeholder = curPlugin ? '输入要模拟触发「' + curPlugin + '」的群消息' : '输入要模拟触发的群消息';
    root.classList.add('active');
    sys('模拟会话已就绪：发送后将调用 /api/plugins/test 触发插件，并把回复以气泡展示。');
    $('qqtMsg').focus();
    $('qqtMsg').select();
  }
  function close(){
    if (root) root.classList.remove('active');
  }
  function isOpen(){ return !!(root && root.classList.contains('active')); }

  window.QQTester = { open: open, close: close, isOpen: isOpen };
})();
