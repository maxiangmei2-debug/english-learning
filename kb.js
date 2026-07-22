/* ============================================================
 * kb.js — 我的知识库 共享模块
 * 职责：
 *   1. 提供 window.KB 存储/导入导出/云同步 API
 *   2. 在「英语学习手册 / 测试达人 / 词汇大闯关 / 拼写训练营」
 *      加载时，把知识库内容自动注入到对应模块的运行数据
 *   3. 可选 GitHub Gist 云同步（跨设备：手机/电脑共用一份）
 * 设计：纯前端、零依赖。各模块在 </body> 前引入本文件即可。
 * ============================================================ */
(function () {
  'use strict';

  var KB_KEY = 'english_kb';          // 本地条目数组
  var SYNC_KEY = 'english_kb_sync';   // 云同步配置 {token,gist}
  var GIST_FILE = 'kb.json';          // Gist 内文件名

  /* ---------------- 工具 ---------------- */
  function escapeHtml(s) {
    return (s == null ? '' : String(s))
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function unique(a) { var s = {}, o = []; a.forEach(function (x) { if (!s[x]) { s[x] = 1; o.push(x); } }); return o; }

  /* ---------------- 本地存储 API ---------------- */
  function loadRaw() {
    try { return JSON.parse(localStorage.getItem(KB_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function saveRaw(arr) { localStorage.setItem(KB_KEY, JSON.stringify(arr)); }
  function getEntries() { return loadRaw(); }
  function getByType(t) { return loadRaw().filter(function (e) { return e.type === t; }); }

  function upsert(entry) {
    var arr = loadRaw();
    entry.updatedAt = Date.now();
    var i = -1;
    for (var k = 0; k < arr.length; k++) { if (arr[k].id === entry.id) { i = k; break; } }
    if (i >= 0) arr[i] = entry; else arr.push(entry);
    saveRaw(arr);
    return entry;
  }
  function removeEntry(id) {
    saveRaw(loadRaw().filter(function (e) { return e.id !== id; }));
  }
  function exportJSON() { return JSON.stringify(loadRaw(), null, 2); }
  function importJSON(text) {
    var arr = JSON.parse(text);
    if (!Array.isArray(arr)) throw new Error('格式错误：应为数组');
    saveRaw(arr);
  }

  /* ---------------- 云同步 (GitHub Gist) ---------------- */
  function loadSyncCfg() {
    try { return JSON.parse(localStorage.getItem(SYNC_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function saveSyncCfg(c) { localStorage.setItem(SYNC_KEY, JSON.stringify(c)); }
  function apiHeaders(token) {
    return { 'Authorization': 'token ' + token, 'Content-Type': 'application/json', 'Accept': 'application/vnd.github.v3+json' };
  }
  function mergePulled(pulled) {
    var local = loadRaw(), map = {};
    local.forEach(function (e) { map[e.id] = e; });
    pulled.forEach(function (e) {
      var ex = map[e.id];
      if (!ex || (e.updatedAt || 0) > (ex.updatedAt || 0)) map[e.id] = e;
    });
    saveRaw(Object.keys(map).map(function (k) { return map[k]; }));
  }
  function pushSync() {
    var cfg = loadSyncCfg();
    if (!cfg.token || !cfg.gist) return Promise.reject(new Error('未配置云同步'));
    var body = {}; body[GIST_FILE] = { content: exportJSON() };
    return fetch('https://api.github.com/gists/' + cfg.gist, {
      method: 'PATCH', headers: apiHeaders(cfg.token),
      body: JSON.stringify({ files: body })
    }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function pullSync() {
    var cfg = loadSyncCfg();
    if (!cfg.token || !cfg.gist) return Promise.reject(new Error('未配置云同步'));
    return fetch('https://api.github.com/gists/' + cfg.gist, { headers: apiHeaders(cfg.token) })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (g) {
        var f = g.files && g.files[GIST_FILE];
        if (!f || !f.content) return;
        var pulled = JSON.parse(f.content);
        if (Array.isArray(pulled)) mergePulled(pulled);
      });
  }
  function ensureGist() {
    var cfg = loadSyncCfg();
    if (!cfg.token) return Promise.reject(new Error('未配置 token'));
    if (cfg.gist) return Promise.resolve(cfg.gist);
    var body = {}; body[GIST_FILE] = { content: exportJSON() };
    return fetch('https://api.github.com/gists', {
      method: 'POST', headers: apiHeaders(cfg.token),
      body: JSON.stringify({ description: 'English KB (我的知识库)', public: false, files: body })
    }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (g) { cfg.gist = g.id; saveSyncCfg(cfg); return g.id; });
  }

  /* ---------------- 注入到当前模块 ---------------- */
  // 类型 → 测试达人分类 / 手册徽章
  var CAT_MAP = { word: 'vocab', phrase: 'phrase', sentence: 'scene', grammar: 'grammar', error: 'error' };
  var BADGE_MAP = { word: '单词', phrase: '搭配', sentence: '句型', grammar: '语法', error: '易错' };
  var TYPE_NAME = { word: '单词', phrase: '短语/搭配', sentence: '句型', grammar: '语法', error: '易错' };

  function applyToTestMaster() {
    if (typeof Q === 'undefined') return;
    var entries = getEntries();
    if (!entries.length) return;
    var allMeanings = entries.map(function (e) { return e.meaning || '（释义）'; });
    entries.forEach(function (e) {
      var cat = CAT_MAP[e.type];
      if (!cat || !Q[cat]) return;
      var correct = e.meaning || '（释义）';
      var distract = unique(shuffle(allMeanings.filter(function (m) { return m !== correct; }))).slice(0, 3);
      while (distract.length < 3) distract.push('（其他知识点）');
      var opts = unique(shuffle([correct].concat(distract)));
      var ans = opts.indexOf(correct);
      var qObj = {
        id: 'kb_' + e.id,
        cat: cat,
        type: 'choice',
        badge: BADGE_MAP[e.type] || '知识库',
        q: '「' + e.content + '」' + (e.type === 'sentence' ? '这句话的意思是？' : '的意思是？'),
        opts: opts,
        ans: ans,
        explain: buildExplain(e),
        tip: ''
      };
      var ex = -1;
      for (var k = 0; k < Q[cat].length; k++) { if (Q[cat][k].id === qObj.id) { ex = k; break; } }
      if (ex >= 0) Q[cat][ex] = qObj; else Q[cat].push(qObj);
    });
  }
  function buildExplain(e) {
    var s = '【我的知识库】<br>';
    s += '<span class="en">' + escapeHtml(e.content) + '</span> = ' + escapeHtml(e.meaning || '') + '<br>';
    if (e.example) s += '例句：' + escapeHtml(e.example) + '<br>';
    if (e.exampleZh) s += '翻译：' + escapeHtml(e.exampleZh) + '<br>';
    if (e.note) s += '📝 笔记：' + escapeHtml(e.note) + '<br>';
    return s;
  }
  function applyToVocabGame() {
    if (typeof VOCAB === 'undefined') return;
    var list = getEntries()
      .filter(function (e) { return e.type === 'word' || e.type === 'phrase'; })
      .map(function (e) { return [e.content, e.meaning || '']; });
    if (list.length) VOCAB['📥 我的知识库'] = list;
  }
  function applyToSpelling() {
    if (typeof WORDS === 'undefined') return;
    var entries = getEntries().filter(function (e) { return e.type === 'word' || e.type === 'phrase'; });
    var all = entries.map(function (e) { return { cn: e.meaning || '', en: e.content }; });
    entries.forEach(function (e) {
      var correct = { cn: e.meaning || '', en: e.content };
      var pool = shuffle(all.filter(function (x) { return x.en !== e.content; })).slice(0, 3);
      while (pool.length < 3) pool.push({ cn: '（其他）', en: 'other' });
      var opts = [correct].concat(pool);
      var item = {
        en: e.content, cn: e.meaning || '', ph: '', topic: '我的知识库',
        opts: opts,
        explain: '【我的知识库】' +
          (e.example ? ('例句：' + escapeHtml(e.example) + '<br>') : '') +
          (e.note ? ('笔记：' + escapeHtml(e.note)) : '')
      };
      var idx = -1;
      for (var k = 0; k < WORDS.length; k++) { if (WORDS[k].en === e.content && WORDS[k].topic === '我的知识库') { idx = k; break; } }
      if (idx >= 0) WORDS[idx] = item; else WORDS.push(item);
    });
  }
  function applyToHandbook() {
    var nav = document.querySelector('nav');
    if (!nav || !document.getElementById('grammar')) return; // 仅在手册页
    if (document.getElementById('kb')) return;              // 防重复注入

    // 纯 CSS tab：用原生锚点 <a href="#kb"> 触发 :target 切换，完全不依赖 JS / ~ 兄弟选择器
    var btn = document.createElement('a');
    btn.className = 'nav-btn';
    btn.href = '#kb';
    btn.setAttribute('data-tab', 'kb');
    btn.innerHTML = '📥 <span class="nav-label-desktop">我的知识库</span><span class="nav-label-mobile">知识库</span>';
    var inner = nav.querySelector('.nav-inner') || nav;
    inner.appendChild(btn);

    var sec = document.createElement('div');
    sec.className = 'section';
    sec.id = 'kb';
    var entries = getEntries();
    var html = '<div class="section-title"><span class="icon">📥</span> 我的知识库</div>';
    html += '<p style="color:var(--gray-600);font-size:13px;margin-bottom:12px;">你日常维护的学习内容，自动同步到这里。去「英语学习中心 → 我的知识库」中添加 / 编辑。</p>';
    if (!entries.length) {
      html += '<p style="color:#888;">还没有内容。打开「英语学习中心 → 我的知识库」添加你想学的内容吧。</p>';
    } else {
      entries.forEach(function (e) {
        var btype = e.type === 'word' ? 'vocab' : (e.type === 'phrase' ? 'phrase' : (e.type === 'sentence' ? 'scene' : (e.type === 'grammar' ? 'grammar' : 'error')));
        html += '<div class="card" style="margin-bottom:14px;">';
        html += '<div class="card-title">' + escapeHtml(e.content) + ' <span class="badge badge-' + btype + '">' + (TYPE_NAME[e.type] || '') + '</span></div>';
        html += '<div style="font-size:14px;margin:6px 0;"><b>释义：</b>' + escapeHtml(e.meaning || '') + '</div>';
        if (e.example) html += '<div style="font-size:13px;margin:4px 0;" class="en">📌 ' + escapeHtml(e.example) + '</div>';
        if (e.exampleZh) html += '<div style="font-size:13px;color:#666;">' + escapeHtml(e.exampleZh) + '</div>';
        if (e.note) html += '<div style="font-size:13px;margin-top:6px;color:#7c3aed;">📝 ' + escapeHtml(e.note) + '</div>';
        html += '</div>';
      });
    }
    sec.innerHTML = html;
    var container = document.querySelector('.container');
    if (container) container.appendChild(sec);
  }

  /* ---------------- 自动识别（无需选类型） ---------------- */
  // 从原始文本判断类型：grammar / sentence / word / phrase
  function classifyType(raw, content) {
    raw = raw || '';
    content = (content || '').trim();
    // 1) 语法：含语法关键词，或纯中文长解释
    if (/(时态|语法|被动|从句|分词|结构是|表示|用法|过去式|将来时|现在完成|过去完成|进行时|虚拟|条件句|比较级|最高级|感叹句|祈使句|tense|grammar)/i.test(raw)) return 'grammar';
    if (/[一-鿿]/.test(raw) && raw.length > 24 && /[。；;]/.test(raw)) return 'grammar';
    // 2) 句子：以标点结尾 或 含主谓结构
    if (/[.?!。？！]$/.test(content)) return 'sentence';
    if (/\b(is|are|was|were|do|does|did|have|has|can|will|would|should|may|might|must|I|you|he|she|we|they|it)\b/i.test(content) && /[.?!。？！]/.test(content)) return 'sentence';
    // 3) 单词：纯单个英文词
    if (/^[A-Za-z][A-Za-z'’-]*$/.test(content)) return 'word';
    // 4) 短语：2~6 个英文词
    var eng = content.split(/\s+/).filter(function (w) { return /^[A-Za-z]/.test(w); });
    if (eng.length >= 2 && eng.length <= 6) return 'phrase';
    if (eng.length === 1) return 'word';
    return 'phrase';
  }
  // 从一行文本解析出一条知识库条目（自动提取「内容 / 释义」）
  function parseEntry(raw) {
    raw = (raw || '').trim();
    if (!raw) return null;
    var content = raw, meaning = '';
    // 显式分隔符 = : ：
    var sep = raw.match(/^(.+?)\s*(?:=|:|：)\s*(.+)$/);
    if (sep && sep[2].trim().length) {
      content = sep[1].trim();
      meaning = sep[2].trim();
    } else {
      // 英文头 + 中文尾（首个中文字符前为内容，后为释义）
      var ci = raw.search(/[一-鿿]/);
      if (ci > 0) {
        content = raw.slice(0, ci).trim();
        meaning = raw.slice(ci).trim();
      }
    }
    return {
      content: content,
      meaning: meaning,
      type: classifyType(raw, content),
      example: '', exampleZh: '', note: ''
    };
  }
  // 从整段文本（每行一条）批量解析并保存，返回统计
  function addFromText(text) {
    var lines = (text || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    var stats = { total: 0, word: 0, phrase: 0, sentence: 0, grammar: 0, error: 0 };
    lines.forEach(function (line) {
      var e = parseEntry(line);
      if (!e) return;
      e.id = 'kb_' + Date.now() + '_' + Math.floor(Math.random() * 1e6).toString(36);
      e.createdAt = Date.now();
      upsert(e);
      stats.total++;
      stats[e.type] = (stats[e.type] || 0) + 1;
    });
    return stats;
  }

  function applyToStudyPlan() {
    var container = document.querySelector('.container');
    if (!container) return;
    if (document.getElementById('kbSelfStudy')) return; // 防重复
    var entries = getEntries();
    var typeName = { word: '单词', phrase: '搭配', sentence: '句型', grammar: '语法', error: '易错' };
    var sec = document.createElement('div');
    sec.className = 'progress-section';
    sec.id = 'kbSelfStudy';
    sec.style.marginTop = '24px';
    var html = '<div class="section-head">📥 我的知识库（自选复习）</div>';
    if (!entries.length) {
      html += '<p style="color:#9ca3af;font-size:13px;">还没有内容。去「英语学习中心 → 我的知识库」添加你想学的内容吧。</p>';
    } else {
      html += '<div style="display:flex;flex-direction:column;gap:8px">';
      entries.forEach(function (e) {
        html += '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:12px;">';
        html += '<div style="font-weight:700;color:#111827;">' + escapeHtml(e.content) +
          ' <span style="font-size:11px;padding:2px 8px;border-radius:12px;background:#ede9fe;color:#6d28d9;">' + (typeName[e.type] || '') + '</span></div>';
        if (e.meaning) html += '<div style="font-size:14px;color:#374151;margin-top:4px;">释义：' + escapeHtml(e.meaning) + '</div>';
        if (e.example) html += '<div style="font-size:13px;color:#7c3aed;margin-top:4px;">📌 ' + escapeHtml(e.example) + '</div>';
        if (e.note) html += '<div style="font-size:13px;color:#6b7280;margin-top:4px;">📝 ' + escapeHtml(e.note) + '</div>';
        html += '</div>';
      });
      html += '</div>';
    }
    sec.innerHTML = html;
    container.appendChild(sec);
  }

  function apply() {
    try { applyToHandbook(); } catch (e) { console.warn('KB→handbook', e); }
    try { applyToTestMaster(); } catch (e) { console.warn('KB→testmaster', e); }
    try { applyToVocabGame(); } catch (e) { console.warn('KB→vocabgame', e); }
    try { applyToSpelling(); } catch (e) { console.warn('KB→spelling', e); }
    try { applyToStudyPlan(); } catch (e) { console.warn('KB→studyplan', e); }
  }

  /* ---------------- 暴露 API ---------------- */
  window.KB = {
    getEntries: getEntries, getByType: getByType, upsert: upsert, remove: removeEntry,
    exportJSON: exportJSON, importJSON: importJSON,
    pushSync: pushSync, pullSync: pullSync, ensureGist: ensureGist,
    loadSyncCfg: loadSyncCfg, saveSyncCfg: saveSyncCfg, apply: apply,
    addFromText: addFromText, parseEntry: parseEntry, classifyType: classifyType
  };

  /* ---------------- 启动：配置了云同步则先拉取再注入 ---------------- */
  (function boot() {
    var cfg = loadSyncCfg();
    function run() { apply(); }
    if (cfg && cfg.token && cfg.gist) {
      pullSync().then(run, run);
    } else {
      run();
    }
  })();
})();
