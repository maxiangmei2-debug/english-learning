/* MC03WB-20260813 */
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
  // 按级别过滤：无 level 字段视为 B1
  function getEntriesByLevel(level) {
    var all = loadRaw();
    return all.filter(function (e) {
      var lv = e.level || 'B1';
      return lv === level;
    });
  }
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

  function isTestable(e) {
    if (e.noTest) return false;
    var m = (e.meaning || '').trim();
    var c = (e.content || '').trim();
    if (!m || m === '（释义）') return false;               // 无释义或占位符，无法出“意思是？”题
    if (e.type === 'grammar') return false;                // 语法规则/搭配模板不适合当前选择题形式
    if (/[→＋+\：]/.test(c)) return false;                  // 变形/组合规则也跳过
    if (/^[\u4e00-\u9fff]/.test(c)) return false;           // 内容以中文开头：不适合出“英文→中文”选择题
    if (!/[a-zA-Z\u4e00-\u9fff]/.test(c)) return false;    // 内容没有字母/中文（如 ## / 纯符号）无法出题
    if (/^#+/.test(c)) return false;                        // Markdown 标题标记不适合当内容
    if (/^[一二三四五六七八九十]+、/.test(m)) return false; // 释义是章节标题而非真正释义
    if (/[\u4e00-\u9fff]/.test(m) && /[a-zA-Z]/.test(m) && m.length < 6) return false; // 释义是中英混杂的占位/规则
    return true;
  }
  function applyToTestMaster() {
    if (typeof Q === 'undefined') return;
    var lv = (function () { try { return localStorage.getItem('english_level') === 'B2' ? 'B2' : 'B1'; } catch (e) { return 'B1'; } })();
    var entries = getEntriesByLevel(lv).filter(isTestable);
    if (!entries.length) return;
    entries.forEach(function (e) {
      var cat = CAT_MAP[e.type];
      if (!cat || !Q[cat]) return;
      var correct = e.meaning || '（释义）';
      // 干扰项只从同类型条目里选，避免“月份”混进“搭配”题
      var sameType = entries.filter(function (x) { return x.type === e.type && x.meaning !== correct; });
      var distract = unique(shuffle(sameType.map(function (x) { return x.meaning; }))).slice(0, 3);
      // 兜底：从同分类已有题目里借用释义（避免 placeholder 选项）
      if (distract.length < 3) {
        var pool = (Q[cat] || []).filter(function (q) { return q.ans !== undefined && q.opts && q.opts.length >= 4; });
        var extra = unique(shuffle(pool.map(function (q) { return q.opts[q.ans]; }).filter(function (m) { return m && m !== correct; }))).slice(0, 3 - distract.length);
        distract = distract.concat(extra);
      }
      while (distract.length < 3) distract.push('（其他' + (TYPE_NAME[e.type] || '知识点') + '）');
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
    // KB 注入完成后，再用测试达人的坏题过滤器清一遍（处理中文 content / 干扰项错乱）
    try { if (typeof window.filterBadQuestions === 'function') window.filterBadQuestions(); } catch (e) {}
  }
  function buildExplain(e) {
    var s = '【我的知识库】<br>';
    if (e.ph) s += '<span class="ph">' + escapeHtml(e.ph) + '</span><br>';
    s += '<span class="en">' + escapeHtml(e.content) + '</span> = ' + escapeHtml(e.meaning || '') + '<br>';
    if (e.example) s += '例句：' + escapeHtml(e.example) + '<br>';
    if (e.exampleZh) s += '翻译：' + escapeHtml(e.exampleZh) + '<br>';
    if (e.note) s += '📝 笔记：' + escapeHtml(e.note) + '<br>';
    return s;
  }
  function applyToVocabGame() {
    if (typeof VOCAB === 'undefined') return;
    var lv = (function () { try { return localStorage.getItem('english_level') === 'B2' ? 'B2' : 'B1'; } catch (e) { return 'B1'; } })();
    var list = getEntriesByLevel(lv)
      .filter(function (e) { return e.type === 'word' || e.type === 'phrase'; })
      .map(function (e) { return [e.content, e.meaning || '']; });
    if (list.length) VOCAB['📥 我的知识库'] = list;
  }
  function applyToSpelling() {
    if (typeof WORDS === 'undefined') return;
    var lv = (function () { try { return localStorage.getItem('english_level') === 'B2' ? 'B2' : 'B1'; } catch (e) { return 'B1'; } })();
    var entries = getEntriesByLevel(lv).filter(function (e) { return e.type === 'word' || e.type === 'phrase'; });
    var all = entries.map(function (e) { return { cn: e.meaning || '', en: e.content }; });
    entries.forEach(function (e) {
      var correct = { cn: e.meaning || '', en: e.content };
      var pool = shuffle(all.filter(function (x) { return x.en !== e.content; })).slice(0, 3);
      while (pool.length < 3) pool.push({ cn: '（其他）', en: 'other' });
      var opts = [correct].concat(pool);
      var item = {
        en: e.content, cn: e.meaning || '', ph: e.ph || '', topic: '我的知识库',
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
    var lv = (function () { try { return localStorage.getItem('english_level') === 'B2' ? 'B2' : 'B1'; } catch (e) { return 'B1'; } })();
    var entries = getEntriesByLevel(lv);
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
        if (e.ph) html += '<div style="font-size:13px;margin:4px 0;color:#0d9488;" class="en">🔊 ' + escapeHtml(e.ph) + '</div>';
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
    // 1) 语法：含语法关键词，或纯中文长解释，或含规则符号（+ / →）
    if (/(时态|语法|被动|从句|分词|结构是|表示|用法|过去式|将来时|现在完成|过去完成|进行时|虚拟|条件句|比较级|最高级|感叹句|祈使句|tense|grammar)/i.test(raw)) return 'grammar';
    if (/[一-鿿]/.test(raw) && raw.length > 24 && /[。；;]/.test(raw)) return 'grammar';
    if (/→/.test(content)) return 'grammar';                     // 变形/转换规则，如 sixteen → sixteenth
    if (/[＋+]/.test(content) && /[一-鿿]/.test(raw)) return 'grammar'; // 搭配模板，如 on + 星期
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
    // 去掉常见的 Markdown 标题 / 列表标记，避免把 "## 一、星期" 拆成 content="##"
    raw = raw.replace(/^[\s]*#{1,6}\s+/, '').replace(/^[\s]*[-*•]\s+/, '').replace(/^[\s]*\d+(?:[.．、]|\))\s+/, '');
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
    var lv = (function () { try { return localStorage.getItem('english_level') === 'B2' ? 'B2' : 'B1'; } catch (e) { return 'B1'; } })();
    var stats = { total: 0, word: 0, phrase: 0, sentence: 0, grammar: 0, error: 0 };
    lines.forEach(function (line) {
      var e = parseEntry(line);
      if (!e) return;
      e.id = 'kb_' + Date.now() + '_' + Math.floor(Math.random() * 1e6).toString(36);
      e.createdAt = Date.now();
      e.level = lv;          // 记录所属级别，便于 B1/B2 分离
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
    var lv = (function () { try { return localStorage.getItem('english_level') === 'B2' ? 'B2' : 'B1'; } catch (e) { return 'B1'; } })();
    var entries = getEntriesByLevel(lv);
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
        if (e.ph) html += '<div style="font-size:13px;color:#0d9488;margin-top:2px;" class="en">🔊 ' + escapeHtml(e.ph) + '</div>';
        if (e.example) html += '<div style="font-size:13px;color:#7c3aed;margin-top:4px;">📌 ' + escapeHtml(e.example) + '</div>';
        if (e.note) html += '<div style="font-size:13px;color:#6b7280;margin-top:4px;">📝 ' + escapeHtml(e.note) + '</div>';
        html += '</div>';
      });
      html += '</div>';
    }
    sec.innerHTML = html;
    container.appendChild(sec);
  }

  /* ---------------- 内置种子内容（一次性注入，按内容去重） ---------------- */
  // 把高频基础词（星期 / 月份 / 序数词 / 日期句型）作为默认知识库，
  // 用户首次打开任意模块即自动注入到 5 个学习模块；已手动添加过的不会重复。
  var SEED_KEY = 'english_kb_seed_v';
  var KB_SEED = {
    version: '20260813-mc03',
    items: [
      // —— 星期 ——
      { id: 'seed_monday',    content: 'Monday',    meaning: '星期一', type: 'word', ph: '/ˈmʌndeɪ/',     level: 'B1' },
      { id: 'seed_tuesday',   content: 'Tuesday',   meaning: '星期二', type: 'word', ph: '/ˈtjuːzdeɪ/',   level: 'B1' },
      { id: 'seed_wednesday', content: 'Wednesday', meaning: '星期三', type: 'word', ph: '/ˈwenzdeɪ/',    level: 'B1' },
      { id: 'seed_thursday',  content: 'Thursday',  meaning: '星期四', type: 'word', ph: '/ˈθɜːrzdeɪ/',  level: 'B1' },
      { id: 'seed_friday',    content: 'Friday',    meaning: '星期五', type: 'word', ph: '/ˈfraɪdeɪ/',   level: 'B1' },
      { id: 'seed_saturday',  content: 'Saturday',  meaning: '星期六', type: 'word', ph: '/ˈsætərdeɪ/',  level: 'B1' },
      { id: 'seed_sunday',    content: 'Sunday',    meaning: '星期日', type: 'word', ph: '/ˈsʌndeɪ/',     level: 'B1' },
      // —— 月份 ——
      { id: 'seed_january',   content: 'January',   meaning: '一月',   type: 'word', ph: '/ˈdʒænjueri/',  level: 'B1' },
      { id: 'seed_february',  content: 'February',  meaning: '二月',   type: 'word', ph: '/ˈfebrueri/',   level: 'B1' },
      { id: 'seed_march',     content: 'March',     meaning: '三月',   type: 'word', ph: '/mɑːrtʃ/',     level: 'B1' },
      { id: 'seed_april',     content: 'April',     meaning: '四月',   type: 'word', ph: '/ˈeɪprəl/',    level: 'B1' },
      { id: 'seed_may',       content: 'May',       meaning: '五月',   type: 'word', ph: '/meɪ/',        level: 'B1' },
      { id: 'seed_june',      content: 'June',      meaning: '六月',   type: 'word', ph: '/dʒuːn/',      level: 'B1' },
      { id: 'seed_july',      content: 'July',      meaning: '七月',   type: 'word', ph: '/dʒuˈlaɪ/',    level: 'B1' },
      { id: 'seed_august',    content: 'August',    meaning: '八月',   type: 'word', ph: '/ˈɔːɡəst/',    level: 'B1' },
      { id: 'seed_september', content: 'September', meaning: '九月',   type: 'word', ph: '/sepˈtembər/', level: 'B1' },
      { id: 'seed_october',   content: 'October',   meaning: '十月',   type: 'word', ph: '/ɑːkˈtoʊbər/', level: 'B1' },
      { id: 'seed_november',  content: 'November',  meaning: '十一月', type: 'word', ph: '/noʊˈvembər/', level: 'B1' },
      { id: 'seed_december',  content: 'December',  meaning: '十二月', type: 'word', ph: '/dɪˈsembər/',  level: 'B1' },
      // —— 序数词（第几，1st–12th）——
      { id: 'seed_first',    content: 'first',    meaning: '第一（1st）',  type: 'word', ph: '/fɜːrst/',   level: 'B1' },
      { id: 'seed_second',   content: 'second',   meaning: '第二（2nd）',  type: 'word', ph: '/ˈsekənd/',  level: 'B1' },
      { id: 'seed_third',    content: 'third',    meaning: '第三（3rd）',  type: 'word', ph: '/θɜːrd/',   level: 'B1' },
      { id: 'seed_fourth',   content: 'fourth',   meaning: '第四（4th）',  type: 'word', ph: '/fɔːrθ/',   level: 'B1' },
      { id: 'seed_fifth',    content: 'fifth',    meaning: '第五（5th）',  type: 'word', ph: '/fɪfθ/',    level: 'B1' },
      { id: 'seed_sixth',    content: 'sixth',    meaning: '第六（6th）',  type: 'word', ph: '/sɪksθ/',   level: 'B1' },
      { id: 'seed_seventh',  content: 'seventh',  meaning: '第七（7th）',  type: 'word', ph: '/ˈsevnθ/',  level: 'B1' },
      { id: 'seed_eighth',   content: 'eighth',   meaning: '第八（8th）',  type: 'word', ph: '/eɪtθ/',    level: 'B1' },
      { id: 'seed_ninth',    content: 'ninth',    meaning: '第九（9th）',  type: 'word', ph: '/naɪnθ/',   level: 'B1' },
      { id: 'seed_tenth',    content: 'tenth',    meaning: '第十（10th）', type: 'word', ph: '/tenθ/',    level: 'B1' },
      { id: 'seed_eleventh', content: 'eleventh', meaning: '第十一（11th）', type: 'word', ph: '/ɪˈlevnθ/', level: 'B1' },
      { id: 'seed_twelfth',  content: 'twelfth',  meaning: '第十二（12th）', type: 'word', ph: '/twelfθ/',  level: 'B1' },
      // —— 实用搭配 / 句型（含经典易错点 on/in）——
      { id: 'seed_on_monday', content: 'on Monday',     meaning: '在星期一（表“在周几”用 on）', type: 'phrase', level: 'B1' },
      { id: 'seed_in_july',   content: 'in July',       meaning: '在七月（表“在几月”用 in）',   type: 'phrase', level: 'B1' },
      { id: 'seed_what_day',  content: 'What day is it today?', meaning: '今天是星期几？', type: 'sentence', level: 'B1' },
      { id: 'seed_what_date', content: "What's the date today?", meaning: '今天是几月几号？', type: 'sentence', level: 'B1' },
      { id: 'seed_birthday',  content: 'My birthday is on May 1st.', meaning: '我的生日在五月一号。', type: 'sentence', level: 'B1' },
      // —— 序数词构成规则（仅展示，不进测试题）——
      { id: 'seed_ordinal_rule', content: '序数词（第几）构成规则', noTest: true, type: 'grammar', level: 'B1',
        meaning: '1、2、3 特殊：first / second / third（缩写 1st / 2nd / 3rd）；其余多数直接加 -th（4th fourth, 6th sixth…）。注意拼写变化：5→fifth，8→eighth，9→ninth，12→twelfth。十几（13–19）在基数词后加 -th（thirteenth）；整十（20/30）把 y 变 ie 加 -th（twentieth, thirtieth）；21/22/23 用 1st/2nd/3rd（twenty-first = 21st）。' }
    ,
      { id: 'seed_b2_comfort', content: 'comfort', meaning: 'n. 舒适', type: 'word', ph: '/ˈkʌmfət/', level: 'B2' },
      { id: 'seed_b2_uncomfortable', content: 'uncomfortable', meaning: 'adj. 不舒服的', type: 'word', ph: '/ʌnˈkʌmftəbl/', level: 'B2' },
      { id: 'seed_b2_tense', content: 'tense', meaning: 'adj. 紧张的', type: 'word', ph: '/tens/', level: 'B2' },
      { id: 'seed_b2_relaxed', content: 'relaxed', meaning: 'adj. 放松的', type: 'word', ph: '/rɪˈlækst/', level: 'B2' },
      { id: 'seed_b2_airport', content: 'airport', meaning: 'n. 机场', type: 'word', ph: '/ˈeəpɔːt/', level: 'B2' },
      { id: 'seed_b2_cuisine', content: 'cuisine', meaning: 'n. 菜肴；菜系', type: 'word', ph: '/kwɪˈziːn/', level: 'B2' },
      { id: 'seed_b2_passenger', content: 'passenger', meaning: 'n. 乘客', type: 'word', ph: '/ˈpæsɪndʒə(r)/', level: 'B2' },
      { id: 'seed_b2_flight', content: 'flight', meaning: 'n. 航班', type: 'word', ph: '/flaɪt/', level: 'B2' },
      { id: 'seed_b2_design', content: 'design', meaning: 'n. 设计', type: 'word', ph: '/dɪˈzaɪn/', level: 'B2' },
      { id: 'seed_b2_appearance', content: 'appearance', meaning: 'n. 外观', type: 'word', ph: '/əˈpɪərəns/', level: 'B2' },
      { id: 'seed_b2_stressed', content: 'stressed', meaning: 'adj. 焦虑的', type: 'word', ph: '/strest/', level: 'B2' },
      { id: 'seed_b2_upset', content: 'upset', meaning: 'adj. 心烦的', type: 'word', ph: '/ʌpˈset/', level: 'B2' },
      { id: 'seed_b2_nervous', content: 'nervous', meaning: 'adj. 紧张不安的', type: 'word', ph: '/ˈnɜːvəs/', level: 'B2' },
      { id: 'seed_b2_overweight', content: 'overweight', meaning: 'adj. 超重的', type: 'word', ph: '/ˌəʊvəˈweɪt/', level: 'B2' },
      { id: 'seed_b2_expensive', content: 'expensive', meaning: 'adj. 昂贵的', type: 'word', ph: '/ɪkˈspensɪv/', level: 'B2' },
      { id: 'seed_b2_crowded', content: 'crowded', meaning: 'adj. 拥挤的', type: 'word', ph: '/ˈkraʊdɪd/', level: 'B2' },
      { id: 'seed_b2_caviar', content: 'caviar', meaning: 'n. 鱼子酱', type: 'word', ph: '/ˌkæviˈɑː(r)/', level: 'B2' },
      { id: 'seed_b2_destination', content: 'destination', meaning: 'n. 目的地', type: 'word', ph: '/ˌdestɪˈneɪʃn/', level: 'B2' },
      { id: 'seed_b2_terminal', content: 'terminal', meaning: 'n. 航站楼', type: 'word', ph: '/ˈtɜːmɪnl/', level: 'B2' },
      { id: 'seed_b2_duty_free', content: 'duty-free', meaning: 'adj. 免税的', type: 'word', ph: '/ˌdjuːti ˈfriː/', level: 'B2' },
      { id: 'seed_b2_family', content: 'family', meaning: 'n. 家庭', type: 'word', ph: '/ˈfæməli/', level: 'B2' },
      { id: 'seed_b2_member', content: 'member', meaning: 'n. 成员', type: 'word', ph: '/ˈmembə(r)/', level: 'B2' },
      { id: 'seed_b2_opinion', content: 'opinion', meaning: 'n. 观点', type: 'word', ph: '/əˈpɪnjən/', level: 'B2' },
      { id: 'seed_b2_expectation', content: 'expectation', meaning: 'n. 期待', type: 'word', ph: '/ˌekspekˈteɪʃn/', level: 'B2' },
      { id: 'seed_b2_sibling', content: 'sibling', meaning: 'n. 兄弟姐妹', type: 'word', ph: '/ˈsɪblɪŋ/', level: 'B2' },
      { id: 'seed_b2_relationship', content: 'relationship', meaning: 'n. 人际关系', type: 'word', ph: '/rɪˈleɪʃnʃɪp/', level: 'B2' },
      { id: 'seed_b2_relative', content: 'relative', meaning: 'n. 亲戚', type: 'word', ph: '/ˈrelətɪv/', level: 'B2' },
      { id: 'seed_b2_responsibility', content: 'responsibility', meaning: 'n. 责任', type: 'word', ph: '/rɪˌspɒnsəˈbɪləti/', level: 'B2' },
      { id: 'seed_b2_chore', content: 'chore', meaning: 'n. 家务杂活', type: 'word', ph: '/tʃɔː(r)/', level: 'B2' },
      { id: 'seed_b2_housework', content: 'housework', meaning: 'n. 家务', type: 'word', ph: '/ˈhaʊswɜːk/', level: 'B2' },
      { id: 'seed_b2_argument', content: 'argument', meaning: 'n. 争吵', type: 'word', ph: '/ˈɑːɡjuːmənt/', level: 'B2' },
      { id: 'seed_b2_marriage', content: 'marriage', meaning: 'n. 婚姻', type: 'word', ph: '/ˈmærɪdʒ/', level: 'B2' },
      { id: 'seed_b2_complain', content: 'complain', meaning: 'v. 抱怨', type: 'word', ph: '/kəmˈpleɪn/', level: 'B2' },
      { id: 'seed_b2_messy', content: 'messy', meaning: 'adj. 杂乱的', type: 'word', ph: '/ˈmesi/', level: 'B2' },
      { id: 'seed_b2_unreasonable', content: 'unreasonable', meaning: 'adj. 不合理的', type: 'word', ph: '/ʌnˈriːznəbl/', level: 'B2' },
      { id: 'seed_b2_reasonable', content: 'reasonable', meaning: 'adj. 合理的', type: 'word', ph: '/ˈriːznəbl/', level: 'B2' },
      { id: 'seed_b2_nag', content: 'nag', meaning: 'v. 唠叨', type: 'word', ph: '/næɡ/', level: 'B2' },
      { id: 'seed_b2_influence', content: 'influence', meaning: 'n. 影响', type: 'word', ph: '/ˈɪnfluəns/', level: 'B2' },
      { id: 'seed_b2_sweep', content: 'sweep', meaning: 'v. 扫', type: 'word', ph: '/swiːp/', level: 'B2' },
      { id: 'seed_b2_mop', content: 'mop', meaning: 'v. 拖地', type: 'word', ph: '/mɒp/', level: 'B2' },
      { id: 'seed_b2_laundry', content: 'laundry', meaning: 'n. 要洗的衣服', type: 'word', ph: '/ˈlɔːndri/', level: 'B2' },
      { id: 'seed_b2_grocery', content: 'grocery', meaning: 'n. 杂货', type: 'word', ph: '/ˈɡrəʊsəri/', level: 'B2' },
      { id: 'seed_b2_interview', content: 'interview', meaning: 'n. 面试', type: 'word', ph: '/ˈɪntəvjuː/', level: 'B2' },
      { id: 'seed_b2_interviewer', content: 'interviewer', meaning: 'n. 面试官', type: 'word', ph: '/ˈɪntəvjuːə(r)/', level: 'B2' },
      { id: 'seed_b2_interviewee', content: 'interviewee', meaning: 'n. 面试者', type: 'word', ph: '/ˌɪntəvjuːˈiː/', level: 'B2' },
      { id: 'seed_b2_skill', content: 'skill', meaning: 'n. 技能', type: 'word', ph: '/skɪl/', level: 'B2' },
      { id: 'seed_b2_ability', content: 'ability', meaning: 'n. 能力', type: 'word', ph: '/əˈbɪləti/', level: 'B2' },
      { id: 'seed_b2_leadership', content: 'leadership', meaning: 'n. 领导力', type: 'word', ph: '/ˈliːdəʃɪp/', level: 'B2' },
      { id: 'seed_b2_manage', content: 'manage', meaning: 'v. 管理', type: 'word', ph: '/ˈmænɪdʒ/', level: 'B2' },
      { id: 'seed_b2_vision', content: 'vision', meaning: 'n. 远见；规划', type: 'word', ph: '/ˈvɪʒn/', level: 'B2' },
      { id: 'seed_b2_intern', content: 'intern', meaning: 'n. 实习生', type: 'word', ph: '/ˈɪntɜːn/', level: 'B2' },
      { id: 'seed_b2_employee', content: 'employee', meaning: 'n. 雇员', type: 'word', ph: '/ɪmˈplɔɪiː/', level: 'B2' },
      { id: 'seed_b2_employ', content: 'employ', meaning: 'v. 雇佣', type: 'word', ph: '/ɪmˈplɔɪ/', level: 'B2' },
      { id: 'seed_b2_corporation', content: 'corporation', meaning: 'n. 公司', type: 'word', ph: '/ˌkɔːpəˈreɪʃn/', level: 'B2' },
      { id: 'seed_b2_graduate', content: 'graduate', meaning: 'v. 毕业', type: 'word', ph: '/ˈɡrædʒuət/', level: 'B2' },
      { id: 'seed_b2_vice', content: 'vice', meaning: 'adj. 副的', type: 'word', ph: '/vaɪs/', level: 'B2' },
      { id: 'seed_b2_president', content: 'president', meaning: 'n. 总裁', type: 'word', ph: '/ˈprezɪdənt/', level: 'B2' },
      { id: 'seed_b2_oversee', content: 'oversee', meaning: 'v. 监管', type: 'word', ph: '/ˌəʊvəˈsiː/', level: 'B2' },
      { id: 'seed_b2_develop', content: 'develop', meaning: 'v. 研发', type: 'word', ph: '/dɪˈveləp/', level: 'B2' },
      { id: 'seed_b2_physical', content: 'physical', meaning: 'adj. 实体的', type: 'word', ph: '/ˈfɪzɪkl/', level: 'B2' },
      { id: 'seed_b2_profit', content: 'profit', meaning: 'n. 利润', type: 'word', ph: '/ˈprɒfɪt/', level: 'B2' },
      { id: 'seed_b2_shocked', content: 'shocked', meaning: 'adj. 震惊的', type: 'word', ph: '/ʃɒkt/', level: 'B2' },
      { id: 'seed_b2_surprised', content: 'surprised', meaning: 'adj. 惊讶的', type: 'word', ph: '/səˈpraɪzd/', level: 'B2' },
      { id: 'seed_b2_personality', content: 'personality', meaning: 'n. 性格', type: 'word', ph: '/ˌpɜːsəˈnæləti/', level: 'B2' },
      { id: 'seed_b2_festival', content: 'festival', meaning: 'n. 节日', type: 'word', ph: '/ˈfestɪvl/', level: 'B2' },
      { id: 'seed_b2_celebrate', content: 'celebrate', meaning: 'v. 庆祝', type: 'word', ph: '/ˈselɪbreɪt/', level: 'B2' },
      { id: 'seed_b2_tradition', content: 'tradition', meaning: 'n. 传统', type: 'word', ph: '/trəˈdɪʃn/', level: 'B2' },
      { id: 'seed_b2_activity', content: 'activity', meaning: 'n. 活动', type: 'word', ph: '/ækˈtɪvəti/', level: 'B2' },
      { id: 'seed_b2_custom', content: 'custom', meaning: 'n. 习俗', type: 'word', ph: '/ˈkʌstəm/', level: 'B2' },
      { id: 'seed_b2_decorate', content: 'decorate', meaning: 'v. 装饰', type: 'word', ph: '/ˈdekəreɪt/', level: 'B2' },
      { id: 'seed_b2_decoration', content: 'decoration', meaning: 'n. 装饰品', type: 'word', ph: '/ˌdekəˈreɪʃn/', level: 'B2' },
      { id: 'seed_b2_costume', content: 'costume', meaning: 'n. 服饰', type: 'word', ph: '/ˈkɒstjuːm/', level: 'B2' },
      { id: 'seed_b2_religious', content: 'religious', meaning: 'adj. 宗教的', type: 'word', ph: '/rɪˈlɪdʒəs/', level: 'B2' },
      { id: 'seed_b2_symbol', content: 'symbol', meaning: 'n. 象征', type: 'word', ph: '/ˈsɪmbl/', level: 'B2' },
      { id: 'seed_b2_symbolic', content: 'symbolic', meaning: 'adj. 象征意义的', type: 'word', ph: '/sɪmˈbɒlɪk/', level: 'B2' },
      { id: 'seed_b2_parade', content: 'parade', meaning: 'n. 游行', type: 'word', ph: '/pəˈreɪd/', level: 'B2' },
      { id: 'seed_b2_exchange', content: 'exchange', meaning: 'v. 交换', type: 'word', ph: '/ɪksˈtʃeɪndʒ/', level: 'B2' },
      { id: 'seed_b2_Christmas', content: 'Christmas', meaning: 'n. 圣诞节', type: 'word', ph: '/ˈkrɪsməs/', level: 'B2' },
      { id: 'seed_b2_Halloween', content: 'Halloween', meaning: 'n. 万圣节', type: 'word', ph: '/ˌhæləʊˈiːn/', level: 'B2' },
      { id: 'seed_b2_Easter', content: 'Easter', meaning: 'n. 复活节', type: 'word', ph: '/ˈiːstə(r)/', level: 'B2' },
      { id: 'seed_b2_Thanksgiving', content: 'Thanksgiving', meaning: 'n. 感恩节', type: 'word', ph: '/ˌθæŋksˈɡɪvɪŋ/', level: 'B2' },
      { id: 'seed_b2_stranded', content: 'stranded', meaning: 'adj. 被困的', type: 'word', ph: '/ˈstrændɪd/', level: 'B2' },
      { id: 'seed_b2_deserted', content: 'deserted', meaning: 'adj. 荒芜的', type: 'word', ph: '/dɪˈzɜːtɪd/', level: 'B2' },
      { id: 'seed_b2_tropical', content: 'tropical', meaning: 'adj. 热带的', type: 'word', ph: '/ˈtrɒpɪkl/', level: 'B2' },
      { id: 'seed_b2_relentless', content: 'relentless', meaning: 'adj. 无休止的', type: 'word', ph: '/rɪˈlentləs/', level: 'B2' },
      { id: 'seed_b2_soar', content: 'soar', meaning: 'v. 飙升', type: 'word', ph: '/sɔː(r)/', level: 'B2' },
      { id: 'seed_b2_fierce', content: 'fierce', meaning: 'adj. 猛烈的', type: 'word', ph: '/fɪəs/', level: 'B2' },
      { id: 'seed_b2_plummet', content: 'plummet', meaning: 'v. 骤降', type: 'word', ph: '/ˈplʌmɪt/', level: 'B2' },
      { id: 'seed_b2_venomous', content: 'venomous', meaning: 'adj. 有毒的', type: 'word', ph: '/ˈvenəməs/', level: 'B2' },
      { id: 'seed_b2_submerge', content: 'submerge', meaning: 'v. 淹没', type: 'word', ph: '/səbˈmɜːdʒ/', level: 'B2' },
      { id: 'seed_b2_drinkable', content: 'drinkable', meaning: 'adj. 可饮用的', type: 'word', ph: '/ˈdrɪŋkəbl/', level: 'B2' },
      { id: 'seed_b2_shelter', content: 'shelter', meaning: 'n. 庇护所', type: 'word', ph: '/ˈʃeltə(r)/', level: 'B2' },
      { id: 'seed_b2_storm', content: 'storm', meaning: 'n. 暴风雨', type: 'word', ph: '/stɔːm/', level: 'B2' },
      { id: 'seed_b2_inflatable', content: 'inflatable', meaning: 'adj. 可充气的', type: 'word', ph: '/ɪnˈfleɪtəbl/', level: 'B2' },
      { id: 'seed_b2_raft', content: 'raft', meaning: 'n. 救生筏', type: 'word', ph: '/rɑːft/', level: 'B2' },
      { id: 'seed_b2_candidate', content: 'candidate', meaning: 'n. 候选人', type: 'word', ph: '/ˈkændɪdət/', level: 'B2' },
      { id: 'seed_b2_advice', content: 'advice', meaning: 'n. 建议', type: 'word', ph: '/ədˈvaɪs/', level: 'B2' },
      { id: 'seed_b2_land', content: 'land', meaning: 'v. 成功获得', type: 'word', ph: '/lænd/', level: 'B2' },
      { id: 'seed_b2_cloud', content: 'cloud', meaning: 'n. 云朵', type: 'word', ph: '/klaʊd/', level: 'B2' },
      { id: 'seed_b2_wall', content: 'wall', meaning: 'n. 墙壁', type: 'word', ph: '/wɔːl/', level: 'B2' },
      { id: 'seed_b2_scratch', content: 'scratch', meaning: 'v. 划伤；快速记下', type: 'word', ph: '/skrætʃ/', level: 'B2' },
      { id: 'seed_b2_call', content: 'call', meaning: 'n. 岗位；呼叫', type: 'word', ph: '/kɔːl/', level: 'B2' },
      { id: 'seed_b2_impress', content: 'impress', meaning: 'v. 使印象深刻', type: 'word', ph: '/ɪmˈpres/', level: 'B2' },
      { id: 'seed_b2_phonebook', content: 'phonebook', meaning: 'n. 纸质电话簿', type: 'word', ph: '/ˈfəʊnbʊk/', level: 'B2' },
      { id: 'seed_b2_perfume', content: 'perfume', meaning: 'n. 香水', type: 'word', ph: '/ˈpɜːfjuːm/', level: 'B2' },
      { id: 'seed_b2_diamond', content: 'diamond', meaning: 'n. 钻石', type: 'word', ph: '/ˈdaɪəmənd/', level: 'B2' },
      { id: 'seed_b2_traveler', content: 'traveler', meaning: 'n. 旅客', type: 'word', ph: '/ˈtrævələ(r)/', level: 'B2' },
      { id: 'seed_b2_amazing', content: 'amazing', meaning: 'adj. 令人惊叹的', type: 'word', ph: '/əˈmeɪzɪŋ/', level: 'B2' },
      { id: 'seed_b2_comfort', content: 'comfort', meaning: '舒适', type: 'word', ph: '/ˈkʌmfət/', level: 'B2' },
      { id: 'seed_b2_uncomfortable', content: 'uncomfortable', meaning: '不舒服的', type: 'word', ph: '/ʌnˈkʌmftəbl/', level: 'B2' },
      { id: 'seed_b2_tense', content: 'tense', meaning: '紧张的', type: 'word', ph: '/tens/', level: 'B2' },
      { id: 'seed_b2_relaxed', content: 'relaxed', meaning: '放松的', type: 'word', ph: '/rɪˈlækst/', level: 'B2' },
      { id: 'seed_b2_airport', content: 'airport', meaning: '机场', type: 'word', ph: '/ˈeəpɔːt/', level: 'B2' },
      { id: 'seed_b2_cuisine', content: 'cuisine', meaning: '菜肴；菜系', type: 'word', ph: '/kwɪˈziːn/', level: 'B2' },
      { id: 'seed_b2_passenger', content: 'passenger', meaning: '乘客', type: 'word', ph: '/ˈpæsɪndʒə(r)/', level: 'B2' },
      { id: 'seed_b2_flight', content: 'flight', meaning: '航班', type: 'word', ph: '/flaɪt/', level: 'B2' },
      { id: 'seed_b2_design', content: 'design', meaning: '设计', type: 'word', ph: '/dɪˈzaɪn/', level: 'B2' },
      { id: 'seed_b2_appearance', content: 'appearance', meaning: '外观', type: 'word', ph: '/əˈpɪərəns/', level: 'B2' },
      { id: 'seed_b2_stressed', content: 'stressed', meaning: '焦虑的', type: 'word', ph: '/strest/', level: 'B2' },
      { id: 'seed_b2_upset', content: 'upset', meaning: '心烦的', type: 'word', ph: '/ʌpˈset/', level: 'B2' },
      { id: 'seed_b2_nervous', content: 'nervous', meaning: '紧张不安的', type: 'word', ph: '/ˈnɜːvəs/', level: 'B2' },
      { id: 'seed_b2_overweight', content: 'overweight', meaning: '超重的', type: 'word', ph: '/ˌəʊvəˈweɪt/', level: 'B2' },
      { id: 'seed_b2_expensive', content: 'expensive', meaning: '昂贵的', type: 'word', ph: '/ɪkˈspensɪv/', level: 'B2' },
      { id: 'seed_b2_crowded', content: 'crowded', meaning: '拥挤的', type: 'word', ph: '/ˈkraʊdɪd/', level: 'B2' },
      { id: 'seed_b2_caviar', content: 'caviar', meaning: '鱼子酱', type: 'word', ph: '/ˌkæviˈɑː(r)/', level: 'B2' },
      { id: 'seed_b2_destination', content: 'destination', meaning: '目的地', type: 'word', ph: '/ˌdestɪˈneɪʃn/', level: 'B2' },
      { id: 'seed_b2_terminal', content: 'terminal', meaning: '航站楼', type: 'word', ph: '/ˈtɜːmɪnl/', level: 'B2' },
      { id: 'seed_b2_duty_free', content: 'duty-free', meaning: '免税的', type: 'word', ph: '/ˌdjuːti ˈfriː/', level: 'B2' },
      { id: 'seed_b2_family', content: 'family', meaning: '家庭', type: 'word', ph: '/ˈfæməli/', level: 'B2' },
      { id: 'seed_b2_member', content: 'member', meaning: '成员', type: 'word', ph: '/ˈmembə(r)/', level: 'B2' },
      { id: 'seed_b2_opinion', content: 'opinion', meaning: '观点', type: 'word', ph: '/əˈpɪnjən/', level: 'B2' },
      { id: 'seed_b2_expectation', content: 'expectation', meaning: '期待', type: 'word', ph: '/ˌekspekˈteɪʃn/', level: 'B2' },
      { id: 'seed_b2_sibling', content: 'sibling', meaning: '兄弟姐妹', type: 'word', ph: '/ˈsɪblɪŋ/', level: 'B2' },
      { id: 'seed_b2_relationship', content: 'relationship', meaning: '人际关系', type: 'word', ph: '/rɪˈleɪʃnʃɪp/', level: 'B2' },
      { id: 'seed_b2_relative', content: 'relative', meaning: '亲戚', type: 'word', ph: '/ˈrelətɪv/', level: 'B2' },
      { id: 'seed_b2_responsibility', content: 'responsibility', meaning: '责任', type: 'word', ph: '/rɪˌspɒnsəˈbɪləti/', level: 'B2' },
      { id: 'seed_b2_chore', content: 'chore', meaning: '家务杂活', type: 'word', ph: '/tʃɔː(r)/', level: 'B2' },
      { id: 'seed_b2_housework', content: 'housework', meaning: '家务', type: 'word', ph: '/ˈhaʊswɜːk/', level: 'B2' },
      { id: 'seed_b2_argument', content: 'argument', meaning: '争吵', type: 'word', ph: '/ˈɑːɡjuːmənt/', level: 'B2' },
      { id: 'seed_b2_marriage', content: 'marriage', meaning: '婚姻', type: 'word', ph: '/ˈmærɪdʒ/', level: 'B2' },
      { id: 'seed_b2_complain', content: 'complain', meaning: '抱怨', type: 'word', ph: '/kəmˈpleɪn/', level: 'B2' },
      { id: 'seed_b2_messy', content: 'messy', meaning: '杂乱的', type: 'word', ph: '/ˈmesi/', level: 'B2' },
      { id: 'seed_b2_unreasonable', content: 'unreasonable', meaning: '不合理的', type: 'word', ph: '/ʌnˈriːznəbl/', level: 'B2' },
      { id: 'seed_b2_reasonable', content: 'reasonable', meaning: '合理的', type: 'word', ph: '/ˈriːznəbl/', level: 'B2' },
      { id: 'seed_b2_nag', content: 'nag', meaning: '唠叨', type: 'word', ph: '/næɡ/', level: 'B2' },
      { id: 'seed_b2_influence', content: 'influence', meaning: '影响', type: 'word', ph: '/ˈɪnfluəns/', level: 'B2' },
      { id: 'seed_b2_sweep', content: 'sweep', meaning: '扫', type: 'word', ph: '/swiːp/', level: 'B2' },
      { id: 'seed_b2_mop', content: 'mop', meaning: '拖地', type: 'word', ph: '/mɒp/', level: 'B2' },
      { id: 'seed_b2_laundry', content: 'laundry', meaning: '要洗的衣服', type: 'word', ph: '/ˈlɔːndri/', level: 'B2' },
      { id: 'seed_b2_grocery', content: 'grocery', meaning: '杂货', type: 'word', ph: '/ˈɡrəʊsəri/', level: 'B2' },
      { id: 'seed_b2_interview', content: 'interview', meaning: '面试', type: 'word', ph: '/ˈɪntəvjuː/', level: 'B2' },
      { id: 'seed_b2_interviewer', content: 'interviewer', meaning: '面试官', type: 'word', ph: '/ˈɪntəvjuːə(r)/', level: 'B2' },
      { id: 'seed_b2_interviewee', content: 'interviewee', meaning: '面试者', type: 'word', ph: '/ˌɪntəvjuːˈiː/', level: 'B2' },
      { id: 'seed_b2_skill', content: 'skill', meaning: '技能', type: 'word', ph: '/skɪl/', level: 'B2' },
      { id: 'seed_b2_ability', content: 'ability', meaning: '能力', type: 'word', ph: '/əˈbɪləti/', level: 'B2' },
      { id: 'seed_b2_leadership', content: 'leadership', meaning: '领导力', type: 'word', ph: '/ˈliːdəʃɪp/', level: 'B2' },
      { id: 'seed_b2_manage', content: 'manage', meaning: '管理', type: 'word', ph: '/ˈmænɪdʒ/', level: 'B2' },
      { id: 'seed_b2_vision', content: 'vision', meaning: '远见；规划', type: 'word', ph: '/ˈvɪʒn/', level: 'B2' },
      { id: 'seed_b2_intern', content: 'intern', meaning: '实习生', type: 'word', ph: '/ˈɪntɜːn/', level: 'B2' },
      { id: 'seed_b2_employee', content: 'employee', meaning: '雇员', type: 'word', ph: '/ɪmˈplɔɪiː/', level: 'B2' },
      { id: 'seed_b2_employ', content: 'employ', meaning: '雇佣', type: 'word', ph: '/ɪmˈplɔɪ/', level: 'B2' },
      { id: 'seed_b2_corporation', content: 'corporation', meaning: '公司', type: 'word', ph: '/ˌkɔːpəˈreɪʃn/', level: 'B2' },
      { id: 'seed_b2_graduate', content: 'graduate', meaning: '毕业', type: 'word', ph: '/ˈɡrædʒuət/', level: 'B2' },
      { id: 'seed_b2_vice', content: 'vice', meaning: '副的', type: 'word', ph: '/vaɪs/', level: 'B2' },
      { id: 'seed_b2_president', content: 'president', meaning: '总裁', type: 'word', ph: '/ˈprezɪdənt/', level: 'B2' },
      { id: 'seed_b2_oversee', content: 'oversee', meaning: '监管', type: 'word', ph: '/ˌəʊvəˈsiː/', level: 'B2' },
      { id: 'seed_b2_develop', content: 'develop', meaning: '研发', type: 'word', ph: '/dɪˈveləp/', level: 'B2' },
      { id: 'seed_b2_physical', content: 'physical', meaning: '实体的', type: 'word', ph: '/ˈfɪzɪkl/', level: 'B2' },
      { id: 'seed_b2_profit', content: 'profit', meaning: '利润', type: 'word', ph: '/ˈprɒfɪt/', level: 'B2' },
      { id: 'seed_b2_shocked', content: 'shocked', meaning: '震惊的', type: 'word', ph: '/ʃɒkt/', level: 'B2' },
      { id: 'seed_b2_surprised', content: 'surprised', meaning: '惊讶的', type: 'word', ph: '/səˈpraɪzd/', level: 'B2' },
      { id: 'seed_b2_personality', content: 'personality', meaning: '性格', type: 'word', ph: '/ˌpɜːsəˈnæləti/', level: 'B2' },
      { id: 'seed_b2_festival', content: 'festival', meaning: '节日', type: 'word', ph: '/ˈfestɪvl/', level: 'B2' },
      { id: 'seed_b2_celebrate', content: 'celebrate', meaning: '庆祝', type: 'word', ph: '/ˈselɪbreɪt/', level: 'B2' },
      { id: 'seed_b2_tradition', content: 'tradition', meaning: '传统', type: 'word', ph: '/trəˈdɪʃn/', level: 'B2' },
      { id: 'seed_b2_activity', content: 'activity', meaning: '活动', type: 'word', ph: '/ækˈtɪvəti/', level: 'B2' },
      { id: 'seed_b2_custom', content: 'custom', meaning: '习俗', type: 'word', ph: '/ˈkʌstəm/', level: 'B2' },
      { id: 'seed_b2_decorate', content: 'decorate', meaning: '装饰', type: 'word', ph: '/ˈdekəreɪt/', level: 'B2' },
      { id: 'seed_b2_decoration', content: 'decoration', meaning: '装饰品', type: 'word', ph: '/ˌdekəˈreɪʃn/', level: 'B2' },
      { id: 'seed_b2_costume', content: 'costume', meaning: '服饰', type: 'word', ph: '/ˈkɒstjuːm/', level: 'B2' },
      { id: 'seed_b2_religious', content: 'religious', meaning: '宗教的', type: 'word', ph: '/rɪˈlɪdʒəs/', level: 'B2' },
      { id: 'seed_b2_symbol', content: 'symbol', meaning: '象征', type: 'word', ph: '/ˈsɪmbl/', level: 'B2' },
      { id: 'seed_b2_symbolic', content: 'symbolic', meaning: '象征意义的', type: 'word', ph: '/sɪmˈbɒlɪk/', level: 'B2' },
      { id: 'seed_b2_parade', content: 'parade', meaning: '游行', type: 'word', ph: '/pəˈreɪd/', level: 'B2' },
      { id: 'seed_b2_exchange', content: 'exchange', meaning: '交换', type: 'word', ph: '/ɪksˈtʃeɪndʒ/', level: 'B2' },
      { id: 'seed_b2_Christmas', content: 'Christmas', meaning: '圣诞节', type: 'word', ph: '/ˈkrɪsməs/', level: 'B2' },
      { id: 'seed_b2_Halloween', content: 'Halloween', meaning: '万圣节', type: 'word', ph: '/ˌhæləʊˈiːn/', level: 'B2' },
      { id: 'seed_b2_Easter', content: 'Easter', meaning: '复活节', type: 'word', ph: '/ˈiːstə(r)/', level: 'B2' },
      { id: 'seed_b2_Thanksgiving', content: 'Thanksgiving', meaning: '感恩节', type: 'word', ph: '/ˌθæŋksˈɡɪvɪŋ/', level: 'B2' },
      { id: 'seed_b2_stranded', content: 'stranded', meaning: '被困的', type: 'word', ph: '/ˈstrændɪd/', level: 'B2' },
      { id: 'seed_b2_deserted', content: 'deserted', meaning: '荒芜的', type: 'word', ph: '/dɪˈzɜːtɪd/', level: 'B2' },
      { id: 'seed_b2_tropical', content: 'tropical', meaning: '热带的', type: 'word', ph: '/ˈtrɒpɪkl/', level: 'B2' },
      { id: 'seed_b2_relentless', content: 'relentless', meaning: '无休止的', type: 'word', ph: '/rɪˈlentləs/', level: 'B2' },
      { id: 'seed_b2_soar', content: 'soar', meaning: '飙升', type: 'word', ph: '/sɔː(r)/', level: 'B2' },
      { id: 'seed_b2_fierce', content: 'fierce', meaning: '猛烈的', type: 'word', ph: '/fɪəs/', level: 'B2' },
      { id: 'seed_b2_plummet', content: 'plummet', meaning: '骤降', type: 'word', ph: '/ˈplʌmɪt/', level: 'B2' },
      { id: 'seed_b2_venomous', content: 'venomous', meaning: '有毒的', type: 'word', ph: '/ˈvenəməs/', level: 'B2' },
      { id: 'seed_b2_submerge', content: 'submerge', meaning: '淹没', type: 'word', ph: '/səbˈmɜːdʒ/', level: 'B2' },
      { id: 'seed_b2_drinkable', content: 'drinkable', meaning: '可饮用的', type: 'word', ph: '/ˈdrɪŋkəbl/', level: 'B2' },
      { id: 'seed_b2_shelter', content: 'shelter', meaning: '庇护所', type: 'word', ph: '/ˈʃeltə(r)/', level: 'B2' },
      { id: 'seed_b2_storm', content: 'storm', meaning: '暴风雨', type: 'word', ph: '/stɔːm/', level: 'B2' },
      { id: 'seed_b2_inflatable', content: 'inflatable', meaning: '可充气的', type: 'word', ph: '/ɪnˈfleɪtəbl/', level: 'B2' },
      { id: 'seed_b2_raft', content: 'raft', meaning: '救生筏', type: 'word', ph: '/rɑːft/', level: 'B2' },
      { id: 'seed_b2_candidate', content: 'candidate', meaning: '候选人', type: 'word', ph: '/ˈkændɪdət/', level: 'B2' },
      { id: 'seed_b2_advice', content: 'advice', meaning: '建议', type: 'word', ph: '/ədˈvaɪs/', level: 'B2' },
      { id: 'seed_b2_land', content: 'land', meaning: '成功获得', type: 'word', ph: '/lænd/', level: 'B2' },
      { id: 'seed_b2_cloud', content: 'cloud', meaning: '云朵', type: 'word', ph: '/klaʊd/', level: 'B2' },
      { id: 'seed_b2_wall', content: 'wall', meaning: '墙壁', type: 'word', ph: '/wɔːl/', level: 'B2' },
      { id: 'seed_b2_scratch', content: 'scratch', meaning: '划伤；快速记下', type: 'word', ph: '/skrætʃ/', level: 'B2' },
      { id: 'seed_b2_call', content: 'call', meaning: '岗位；呼叫', type: 'word', ph: '/kɔːl/', level: 'B2' },
      { id: 'seed_b2_impress', content: 'impress', meaning: '使印象深刻', type: 'word', ph: '/ɪmˈpres/', level: 'B2' },
      { id: 'seed_b2_phonebook', content: 'phonebook', meaning: '纸质电话簿', type: 'word', ph: '/ˈfəʊnbʊk/', level: 'B2' },
      { id: 'seed_b2_perfume', content: 'perfume', meaning: '香水', type: 'word', ph: '/ˈpɜːfjuːm/', level: 'B2' },
      { id: 'seed_b2_diamond', content: 'diamond', meaning: '钻石', type: 'word', ph: '/ˈdaɪəmənd/', level: 'B2' },
      { id: 'seed_b2_traveler', content: 'traveler', meaning: '旅客', type: 'word', ph: '/ˈtrævələ(r)/', level: 'B2' },
      { id: 'seed_b2_amazing', content: 'amazing', meaning: '令人惊叹的', type: 'word', ph: '/əˈmeɪzɪŋ/', level: 'B2' },
      { id: 'seed_b2_comfort', content: 'comfort', meaning: '舒适', type: 'word', ph: '/ˈkʌmfət/', level: 'B2' },
      { id: 'seed_b2_uncomfortable', content: 'uncomfortable', meaning: '不舒服的', type: 'word', ph: '/ʌnˈkʌmftəbl/', level: 'B2' },
      { id: 'seed_b2_tense', content: 'tense', meaning: '紧张的', type: 'word', ph: '/tens/', level: 'B2' },
      { id: 'seed_b2_relaxed', content: 'relaxed', meaning: '放松的', type: 'word', ph: '/rɪˈlækst/', level: 'B2' },
      { id: 'seed_b2_airport', content: 'airport', meaning: '机场', type: 'word', ph: '/ˈeəpɔːt/', level: 'B2' },
      { id: 'seed_b2_cuisine', content: 'cuisine', meaning: '菜肴；菜系', type: 'word', ph: '/kwɪˈziːn/', level: 'B2' },
      { id: 'seed_b2_passenger', content: 'passenger', meaning: '乘客', type: 'word', ph: '/ˈpæsɪndʒə(r)/', level: 'B2' },
      { id: 'seed_b2_flight', content: 'flight', meaning: '航班', type: 'word', ph: '/flaɪt/', level: 'B2' },
      { id: 'seed_b2_design', content: 'design', meaning: '设计', type: 'word', ph: '/dɪˈzaɪn/', level: 'B2' },
      { id: 'seed_b2_appearance', content: 'appearance', meaning: '外观', type: 'word', ph: '/əˈpɪərəns/', level: 'B2' },
      { id: 'seed_b2_stressed', content: 'stressed', meaning: '焦虑的', type: 'word', ph: '/strest/', level: 'B2' },
      { id: 'seed_b2_upset', content: 'upset', meaning: '心烦的', type: 'word', ph: '/ʌpˈset/', level: 'B2' },
      { id: 'seed_b2_nervous', content: 'nervous', meaning: '紧张不安的', type: 'word', ph: '/ˈnɜːvəs/', level: 'B2' },
      { id: 'seed_b2_overweight', content: 'overweight', meaning: '超重的', type: 'word', ph: '/ˌəʊvəˈweɪt/', level: 'B2' },
      { id: 'seed_b2_expensive', content: 'expensive', meaning: '昂贵的', type: 'word', ph: '/ɪkˈspensɪv/', level: 'B2' },
      { id: 'seed_b2_crowded', content: 'crowded', meaning: '拥挤的', type: 'word', ph: '/ˈkraʊdɪd/', level: 'B2' },
      { id: 'seed_b2_caviar', content: 'caviar', meaning: '鱼子酱', type: 'word', ph: '/ˌkæviˈɑː(r)/', level: 'B2' },
      { id: 'seed_b2_destination', content: 'destination', meaning: '目的地', type: 'word', ph: '/ˌdestɪˈneɪʃn/', level: 'B2' },
      { id: 'seed_b2_terminal', content: 'terminal', meaning: '航站楼', type: 'word', ph: '/ˈtɜːmɪnl/', level: 'B2' },
      { id: 'seed_b2_duty_free', content: 'duty-free', meaning: '免税的', type: 'word', ph: '/ˌdjuːti ˈfriː/', level: 'B2' },
      { id: 'seed_b2_family', content: 'family', meaning: '家庭', type: 'word', ph: '/ˈfæməli/', level: 'B2' },
      { id: 'seed_b2_member', content: 'member', meaning: '成员', type: 'word', ph: '/ˈmembə(r)/', level: 'B2' },
      { id: 'seed_b2_opinion', content: 'opinion', meaning: '观点', type: 'word', ph: '/əˈpɪnjən/', level: 'B2' },
      { id: 'seed_b2_expectation', content: 'expectation', meaning: '期待', type: 'word', ph: '/ˌekspekˈteɪʃn/', level: 'B2' },
      { id: 'seed_b2_sibling', content: 'sibling', meaning: '兄弟姐妹', type: 'word', ph: '/ˈsɪblɪŋ/', level: 'B2' },
      { id: 'seed_b2_relationship', content: 'relationship', meaning: '人际关系', type: 'word', ph: '/rɪˈleɪʃnʃɪp/', level: 'B2' },
      { id: 'seed_b2_relative', content: 'relative', meaning: '亲戚', type: 'word', ph: '/ˈrelətɪv/', level: 'B2' },
      { id: 'seed_b2_responsibility', content: 'responsibility', meaning: '责任', type: 'word', ph: '/rɪˌspɒnsəˈbɪləti/', level: 'B2' },
      { id: 'seed_b2_chore', content: 'chore', meaning: '家务杂活', type: 'word', ph: '/tʃɔː(r)/', level: 'B2' },
      { id: 'seed_b2_housework', content: 'housework', meaning: '家务', type: 'word', ph: '/ˈhaʊswɜːk/', level: 'B2' },
      { id: 'seed_b2_argument', content: 'argument', meaning: '争吵', type: 'word', ph: '/ˈɑːɡjuːmənt/', level: 'B2' },
      { id: 'seed_b2_marriage', content: 'marriage', meaning: '婚姻', type: 'word', ph: '/ˈmærɪdʒ/', level: 'B2' },
      { id: 'seed_b2_complain', content: 'complain', meaning: '抱怨', type: 'word', ph: '/kəmˈpleɪn/', level: 'B2' },
      { id: 'seed_b2_messy', content: 'messy', meaning: '杂乱的', type: 'word', ph: '/ˈmesi/', level: 'B2' },
      { id: 'seed_b2_unreasonable', content: 'unreasonable', meaning: '不合理的', type: 'word', ph: '/ʌnˈriːznəbl/', level: 'B2' },
      { id: 'seed_b2_reasonable', content: 'reasonable', meaning: '合理的', type: 'word', ph: '/ˈriːznəbl/', level: 'B2' },
      { id: 'seed_b2_nag', content: 'nag', meaning: '唠叨', type: 'word', ph: '/næɡ/', level: 'B2' },
      { id: 'seed_b2_influence', content: 'influence', meaning: '影响', type: 'word', ph: '/ˈɪnfluəns/', level: 'B2' },
      { id: 'seed_b2_sweep', content: 'sweep', meaning: '扫', type: 'word', ph: '/swiːp/', level: 'B2' },
      { id: 'seed_b2_mop', content: 'mop', meaning: '拖地', type: 'word', ph: '/mɒp/', level: 'B2' },
      { id: 'seed_b2_laundry', content: 'laundry', meaning: '要洗的衣服', type: 'word', ph: '/ˈlɔːndri/', level: 'B2' },
      { id: 'seed_b2_grocery', content: 'grocery', meaning: '杂货', type: 'word', ph: '/ˈɡrəʊsəri/', level: 'B2' },
      { id: 'seed_b2_interview', content: 'interview', meaning: '面试', type: 'word', ph: '/ˈɪntəvjuː/', level: 'B2' },
      { id: 'seed_b2_interviewer', content: 'interviewer', meaning: '面试官', type: 'word', ph: '/ˈɪntəvjuːə(r)/', level: 'B2' },
      { id: 'seed_b2_interviewee', content: 'interviewee', meaning: '面试者', type: 'word', ph: '/ˌɪntəvjuːˈiː/', level: 'B2' },
      { id: 'seed_b2_skill', content: 'skill', meaning: '技能', type: 'word', ph: '/skɪl/', level: 'B2' },
      { id: 'seed_b2_ability', content: 'ability', meaning: '能力', type: 'word', ph: '/əˈbɪləti/', level: 'B2' },
      { id: 'seed_b2_leadership', content: 'leadership', meaning: '领导力', type: 'word', ph: '/ˈliːdəʃɪp/', level: 'B2' },
      { id: 'seed_b2_manage', content: 'manage', meaning: '管理', type: 'word', ph: '/ˈmænɪdʒ/', level: 'B2' },
      { id: 'seed_b2_vision', content: 'vision', meaning: '远见；规划', type: 'word', ph: '/ˈvɪʒn/', level: 'B2' },
      { id: 'seed_b2_intern', content: 'intern', meaning: '实习生', type: 'word', ph: '/ˈɪntɜːn/', level: 'B2' },
      { id: 'seed_b2_employee', content: 'employee', meaning: '雇员', type: 'word', ph: '/ɪmˈplɔɪiː/', level: 'B2' },
      { id: 'seed_b2_employ', content: 'employ', meaning: '雇佣', type: 'word', ph: '/ɪmˈplɔɪ/', level: 'B2' },
      { id: 'seed_b2_corporation', content: 'corporation', meaning: '公司', type: 'word', ph: '/ˌkɔːpəˈreɪʃn/', level: 'B2' },
      { id: 'seed_b2_graduate', content: 'graduate', meaning: '毕业', type: 'word', ph: '/ˈɡrædʒuət/', level: 'B2' },
      { id: 'seed_b2_vice', content: 'vice', meaning: '副的', type: 'word', ph: '/vaɪs/', level: 'B2' },
      { id: 'seed_b2_president', content: 'president', meaning: '总裁', type: 'word', ph: '/ˈprezɪdənt/', level: 'B2' },
      { id: 'seed_b2_oversee', content: 'oversee', meaning: '监管', type: 'word', ph: '/ˌəʊvəˈsiː/', level: 'B2' },
      { id: 'seed_b2_develop', content: 'develop', meaning: '研发', type: 'word', ph: '/dɪˈveləp/', level: 'B2' },
      { id: 'seed_b2_physical', content: 'physical', meaning: '实体的', type: 'word', ph: '/ˈfɪzɪkl/', level: 'B2' },
      { id: 'seed_b2_profit', content: 'profit', meaning: '利润', type: 'word', ph: '/ˈprɒfɪt/', level: 'B2' },
      { id: 'seed_b2_shocked', content: 'shocked', meaning: '震惊的', type: 'word', ph: '/ʃɒkt/', level: 'B2' },
      { id: 'seed_b2_surprised', content: 'surprised', meaning: '惊讶的', type: 'word', ph: '/səˈpraɪzd/', level: 'B2' },
      { id: 'seed_b2_personality', content: 'personality', meaning: '性格', type: 'word', ph: '/ˌpɜːsəˈnæləti/', level: 'B2' },
      { id: 'seed_b2_festival', content: 'festival', meaning: '节日', type: 'word', ph: '/ˈfestɪvl/', level: 'B2' },
      { id: 'seed_b2_celebrate', content: 'celebrate', meaning: '庆祝', type: 'word', ph: '/ˈselɪbreɪt/', level: 'B2' },
      { id: 'seed_b2_tradition', content: 'tradition', meaning: '传统', type: 'word', ph: '/trəˈdɪʃn/', level: 'B2' },
      { id: 'seed_b2_activity', content: 'activity', meaning: '活动', type: 'word', ph: '/ækˈtɪvəti/', level: 'B2' },
      { id: 'seed_b2_custom', content: 'custom', meaning: '习俗', type: 'word', ph: '/ˈkʌstəm/', level: 'B2' },
      { id: 'seed_b2_decorate', content: 'decorate', meaning: '装饰', type: 'word', ph: '/ˈdekəreɪt/', level: 'B2' },
      { id: 'seed_b2_decoration', content: 'decoration', meaning: '装饰品', type: 'word', ph: '/ˌdekəˈreɪʃn/', level: 'B2' },
      { id: 'seed_b2_costume', content: 'costume', meaning: '服饰', type: 'word', ph: '/ˈkɒstjuːm/', level: 'B2' },
      { id: 'seed_b2_religious', content: 'religious', meaning: '宗教的', type: 'word', ph: '/rɪˈlɪdʒəs/', level: 'B2' },
      { id: 'seed_b2_symbol', content: 'symbol', meaning: '象征', type: 'word', ph: '/ˈsɪmbl/', level: 'B2' },
      { id: 'seed_b2_symbolic', content: 'symbolic', meaning: '象征意义的', type: 'word', ph: '/sɪmˈbɒlɪk/', level: 'B2' },
      { id: 'seed_b2_parade', content: 'parade', meaning: '游行', type: 'word', ph: '/pəˈreɪd/', level: 'B2' },
      { id: 'seed_b2_exchange', content: 'exchange', meaning: '交换', type: 'word', ph: '/ɪksˈtʃeɪndʒ/', level: 'B2' },
      { id: 'seed_b2_Christmas', content: 'Christmas', meaning: '圣诞节', type: 'word', ph: '/ˈkrɪsməs/', level: 'B2' },
      { id: 'seed_b2_Halloween', content: 'Halloween', meaning: '万圣节', type: 'word', ph: '/ˌhæləʊˈiːn/', level: 'B2' },
      { id: 'seed_b2_Easter', content: 'Easter', meaning: '复活节', type: 'word', ph: '/ˈiːstə(r)/', level: 'B2' },
      { id: 'seed_b2_Thanksgiving', content: 'Thanksgiving', meaning: '感恩节', type: 'word', ph: '/ˌθæŋksˈɡɪvɪŋ/', level: 'B2' },
      { id: 'seed_b2_stranded', content: 'stranded', meaning: '被困的', type: 'word', ph: '/ˈstrændɪd/', level: 'B2' },
      { id: 'seed_b2_deserted', content: 'deserted', meaning: '荒芜的', type: 'word', ph: '/dɪˈzɜːtɪd/', level: 'B2' },
      { id: 'seed_b2_tropical', content: 'tropical', meaning: '热带的', type: 'word', ph: '/ˈtrɒpɪkl/', level: 'B2' },
      { id: 'seed_b2_relentless', content: 'relentless', meaning: '无休止的', type: 'word', ph: '/rɪˈlentləs/', level: 'B2' },
      { id: 'seed_b2_soar', content: 'soar', meaning: '飙升', type: 'word', ph: '/sɔː(r)/', level: 'B2' },
      { id: 'seed_b2_fierce', content: 'fierce', meaning: '猛烈的', type: 'word', ph: '/fɪəs/', level: 'B2' },
      { id: 'seed_b2_plummet', content: 'plummet', meaning: '骤降', type: 'word', ph: '/ˈplʌmɪt/', level: 'B2' },
      { id: 'seed_b2_venomous', content: 'venomous', meaning: '有毒的', type: 'word', ph: '/ˈvenəməs/', level: 'B2' },
      { id: 'seed_b2_submerge', content: 'submerge', meaning: '淹没', type: 'word', ph: '/səbˈmɜːdʒ/', level: 'B2' },
      { id: 'seed_b2_drinkable', content: 'drinkable', meaning: '可饮用的', type: 'word', ph: '/ˈdrɪŋkəbl/', level: 'B2' },
      { id: 'seed_b2_shelter', content: 'shelter', meaning: '庇护所', type: 'word', ph: '/ˈʃeltə(r)/', level: 'B2' },
      { id: 'seed_b2_storm', content: 'storm', meaning: '暴风雨', type: 'word', ph: '/stɔːm/', level: 'B2' },
      { id: 'seed_b2_inflatable', content: 'inflatable', meaning: '可充气的', type: 'word', ph: '/ɪnˈfleɪtəbl/', level: 'B2' },
      { id: 'seed_b2_raft', content: 'raft', meaning: '救生筏', type: 'word', ph: '/rɑːft/', level: 'B2' },
      { id: 'seed_b2_candidate', content: 'candidate', meaning: '候选人', type: 'word', ph: '/ˈkændɪdət/', level: 'B2' },
      { id: 'seed_b2_advice', content: 'advice', meaning: '建议', type: 'word', ph: '/ədˈvaɪs/', level: 'B2' },
      { id: 'seed_b2_land', content: 'land', meaning: '成功获得', type: 'word', ph: '/lænd/', level: 'B2' },
      { id: 'seed_b2_cloud', content: 'cloud', meaning: '云朵', type: 'word', ph: '/klaʊd/', level: 'B2' },
      { id: 'seed_b2_wall', content: 'wall', meaning: '墙壁', type: 'word', ph: '/wɔːl/', level: 'B2' },
      { id: 'seed_b2_scratch', content: 'scratch', meaning: '划伤；快速记下', type: 'word', ph: '/skrætʃ/', level: 'B2' },
      { id: 'seed_b2_call', content: 'call', meaning: '岗位；呼叫', type: 'word', ph: '/kɔːl/', level: 'B2' },
      { id: 'seed_b2_impress', content: 'impress', meaning: '使印象深刻', type: 'word', ph: '/ɪmˈpres/', level: 'B2' },
      { id: 'seed_b2_phonebook', content: 'phonebook', meaning: '纸质电话簿', type: 'word', ph: '/ˈfəʊnbʊk/', level: 'B2' },
      { id: 'seed_b2_perfume', content: 'perfume', meaning: '香水', type: 'word', ph: '/ˈpɜːfjuːm/', level: 'B2' },
      { id: 'seed_b2_diamond', content: 'diamond', meaning: '钻石', type: 'word', ph: '/ˈdaɪəmənd/', level: 'B2' },
      { id: 'seed_b2_traveler', content: 'traveler', meaning: '旅客', type: 'word', ph: '/ˈtrævələ(r)/', level: 'B2' },
      { id: 'seed_b2_amazing', content: 'amazing', meaning: '令人惊叹的', type: 'word', ph: '/əˈmeɪzɪŋ/', level: 'B2' },
      { id: 'seed_b2_comfort', content: 'comfort', meaning: '舒适', type: 'word', ph: '/ˈkʌmfət/', level: 'B2' },
      { id: 'seed_b2_uncomfortable', content: 'uncomfortable', meaning: '不舒服的', type: 'word', ph: '/ʌnˈkʌmftəbl/', level: 'B2' },
      { id: 'seed_b2_tense', content: 'tense', meaning: '紧张的', type: 'word', ph: '/tens/', level: 'B2' },
      { id: 'seed_b2_relaxed', content: 'relaxed', meaning: '放松的', type: 'word', ph: '/rɪˈlækst/', level: 'B2' },
      { id: 'seed_b2_airport', content: 'airport', meaning: '机场', type: 'word', ph: '/ˈeəpɔːt/', level: 'B2' },
      { id: 'seed_b2_cuisine', content: 'cuisine', meaning: '菜肴；菜系', type: 'word', ph: '/kwɪˈziːn/', level: 'B2' },
      { id: 'seed_b2_passenger', content: 'passenger', meaning: '乘客', type: 'word', ph: '/ˈpæsɪndʒə(r)/', level: 'B2' },
      { id: 'seed_b2_flight', content: 'flight', meaning: '航班', type: 'word', ph: '/flaɪt/', level: 'B2' },
      { id: 'seed_b2_design', content: 'design', meaning: '设计', type: 'word', ph: '/dɪˈzaɪn/', level: 'B2' },
      { id: 'seed_b2_appearance', content: 'appearance', meaning: '外观', type: 'word', ph: '/əˈpɪərəns/', level: 'B2' },
      { id: 'seed_b2_stressed', content: 'stressed', meaning: '焦虑的', type: 'word', ph: '/strest/', level: 'B2' },
      { id: 'seed_b2_upset', content: 'upset', meaning: '心烦的', type: 'word', ph: '/ʌpˈset/', level: 'B2' },
      { id: 'seed_b2_nervous', content: 'nervous', meaning: '紧张不安的', type: 'word', ph: '/ˈnɜːvəs/', level: 'B2' },
      { id: 'seed_b2_overweight', content: 'overweight', meaning: '超重的', type: 'word', ph: '/ˌəʊvəˈweɪt/', level: 'B2' },
      { id: 'seed_b2_expensive', content: 'expensive', meaning: '昂贵的', type: 'word', ph: '/ɪkˈspensɪv/', level: 'B2' },
      { id: 'seed_b2_crowded', content: 'crowded', meaning: '拥挤的', type: 'word', ph: '/ˈkraʊdɪd/', level: 'B2' },
      { id: 'seed_b2_caviar', content: 'caviar', meaning: '鱼子酱', type: 'word', ph: '/ˌkæviˈɑː(r)/', level: 'B2' },
      { id: 'seed_b2_destination', content: 'destination', meaning: '目的地', type: 'word', ph: '/ˌdestɪˈneɪʃn/', level: 'B2' },
      { id: 'seed_b2_terminal', content: 'terminal', meaning: '航站楼', type: 'word', ph: '/ˈtɜːmɪnl/', level: 'B2' },
      { id: 'seed_b2_duty_free', content: 'duty-free', meaning: '免税的', type: 'word', ph: '/ˌdjuːti ˈfriː/', level: 'B2' },
      { id: 'seed_b2_family', content: 'family', meaning: '家庭', type: 'word', ph: '/ˈfæməli/', level: 'B2' },
      { id: 'seed_b2_member', content: 'member', meaning: '成员', type: 'word', ph: '/ˈmembə(r)/', level: 'B2' },
      { id: 'seed_b2_opinion', content: 'opinion', meaning: '观点', type: 'word', ph: '/əˈpɪnjən/', level: 'B2' },
      { id: 'seed_b2_expectation', content: 'expectation', meaning: '期待', type: 'word', ph: '/ˌekspekˈteɪʃn/', level: 'B2' },
      { id: 'seed_b2_sibling', content: 'sibling', meaning: '兄弟姐妹', type: 'word', ph: '/ˈsɪblɪŋ/', level: 'B2' },
      { id: 'seed_b2_relationship', content: 'relationship', meaning: '人际关系', type: 'word', ph: '/rɪˈleɪʃnʃɪp/', level: 'B2' },
      { id: 'seed_b2_relative', content: 'relative', meaning: '亲戚', type: 'word', ph: '/ˈrelətɪv/', level: 'B2' },
      { id: 'seed_b2_responsibility', content: 'responsibility', meaning: '责任', type: 'word', ph: '/rɪˌspɒnsəˈbɪləti/', level: 'B2' },
      { id: 'seed_b2_chore', content: 'chore', meaning: '家务杂活', type: 'word', ph: '/tʃɔː(r)/', level: 'B2' },
      { id: 'seed_b2_housework', content: 'housework', meaning: '家务', type: 'word', ph: '/ˈhaʊswɜːk/', level: 'B2' },
      { id: 'seed_b2_argument', content: 'argument', meaning: '争吵', type: 'word', ph: '/ˈɑːɡjuːmənt/', level: 'B2' },
      { id: 'seed_b2_marriage', content: 'marriage', meaning: '婚姻', type: 'word', ph: '/ˈmærɪdʒ/', level: 'B2' },
      { id: 'seed_b2_complain', content: 'complain', meaning: '抱怨', type: 'word', ph: '/kəmˈpleɪn/', level: 'B2' },
      { id: 'seed_b2_messy', content: 'messy', meaning: '杂乱的', type: 'word', ph: '/ˈmesi/', level: 'B2' },
      { id: 'seed_b2_unreasonable', content: 'unreasonable', meaning: '不合理的', type: 'word', ph: '/ʌnˈriːznəbl/', level: 'B2' },
      { id: 'seed_b2_reasonable', content: 'reasonable', meaning: '合理的', type: 'word', ph: '/ˈriːznəbl/', level: 'B2' },
      { id: 'seed_b2_nag', content: 'nag', meaning: '唠叨', type: 'word', ph: '/næɡ/', level: 'B2' },
      { id: 'seed_b2_influence', content: 'influence', meaning: '影响', type: 'word', ph: '/ˈɪnfluəns/', level: 'B2' },
      { id: 'seed_b2_sweep', content: 'sweep', meaning: '扫', type: 'word', ph: '/swiːp/', level: 'B2' },
      { id: 'seed_b2_mop', content: 'mop', meaning: '拖地', type: 'word', ph: '/mɒp/', level: 'B2' },
      { id: 'seed_b2_laundry', content: 'laundry', meaning: '要洗的衣服', type: 'word', ph: '/ˈlɔːndri/', level: 'B2' },
      { id: 'seed_b2_grocery', content: 'grocery', meaning: '杂货', type: 'word', ph: '/ˈɡrəʊsəri/', level: 'B2' },
      { id: 'seed_b2_interview', content: 'interview', meaning: '面试', type: 'word', ph: '/ˈɪntəvjuː/', level: 'B2' },
      { id: 'seed_b2_interviewer', content: 'interviewer', meaning: '面试官', type: 'word', ph: '/ˈɪntəvjuːə(r)/', level: 'B2' },
      { id: 'seed_b2_interviewee', content: 'interviewee', meaning: '面试者', type: 'word', ph: '/ˌɪntəvjuːˈiː/', level: 'B2' },
      { id: 'seed_b2_skill', content: 'skill', meaning: '技能', type: 'word', ph: '/skɪl/', level: 'B2' },
      { id: 'seed_b2_ability', content: 'ability', meaning: '能力', type: 'word', ph: '/əˈbɪləti/', level: 'B2' },
      { id: 'seed_b2_leadership', content: 'leadership', meaning: '领导力', type: 'word', ph: '/ˈliːdəʃɪp/', level: 'B2' },
      { id: 'seed_b2_manage', content: 'manage', meaning: '管理', type: 'word', ph: '/ˈmænɪdʒ/', level: 'B2' },
      { id: 'seed_b2_vision', content: 'vision', meaning: '远见；规划', type: 'word', ph: '/ˈvɪʒn/', level: 'B2' },
      { id: 'seed_b2_intern', content: 'intern', meaning: '实习生', type: 'word', ph: '/ˈɪntɜːn/', level: 'B2' },
      { id: 'seed_b2_employee', content: 'employee', meaning: '雇员', type: 'word', ph: '/ɪmˈplɔɪiː/', level: 'B2' },
      { id: 'seed_b2_employ', content: 'employ', meaning: '雇佣', type: 'word', ph: '/ɪmˈplɔɪ/', level: 'B2' },
      { id: 'seed_b2_corporation', content: 'corporation', meaning: '公司', type: 'word', ph: '/ˌkɔːpəˈreɪʃn/', level: 'B2' },
      { id: 'seed_b2_graduate', content: 'graduate', meaning: '毕业', type: 'word', ph: '/ˈɡrædʒuət/', level: 'B2' },
      { id: 'seed_b2_vice', content: 'vice', meaning: '副的', type: 'word', ph: '/vaɪs/', level: 'B2' },
      { id: 'seed_b2_president', content: 'president', meaning: '总裁', type: 'word', ph: '/ˈprezɪdənt/', level: 'B2' },
      { id: 'seed_b2_oversee', content: 'oversee', meaning: '监管', type: 'word', ph: '/ˌəʊvəˈsiː/', level: 'B2' },
      { id: 'seed_b2_develop', content: 'develop', meaning: '研发', type: 'word', ph: '/dɪˈveləp/', level: 'B2' },
      { id: 'seed_b2_physical', content: 'physical', meaning: '实体的', type: 'word', ph: '/ˈfɪzɪkl/', level: 'B2' },
      { id: 'seed_b2_profit', content: 'profit', meaning: '利润', type: 'word', ph: '/ˈprɒfɪt/', level: 'B2' },
      { id: 'seed_b2_shocked', content: 'shocked', meaning: '震惊的', type: 'word', ph: '/ʃɒkt/', level: 'B2' },
      { id: 'seed_b2_surprised', content: 'surprised', meaning: '惊讶的', type: 'word', ph: '/səˈpraɪzd/', level: 'B2' },
      { id: 'seed_b2_personality', content: 'personality', meaning: '性格', type: 'word', ph: '/ˌpɜːsəˈnæləti/', level: 'B2' },
      { id: 'seed_b2_festival', content: 'festival', meaning: '节日', type: 'word', ph: '/ˈfestɪvl/', level: 'B2' },
      { id: 'seed_b2_celebrate', content: 'celebrate', meaning: '庆祝', type: 'word', ph: '/ˈselɪbreɪt/', level: 'B2' },
      { id: 'seed_b2_tradition', content: 'tradition', meaning: '传统', type: 'word', ph: '/trəˈdɪʃn/', level: 'B2' },
      { id: 'seed_b2_activity', content: 'activity', meaning: '活动', type: 'word', ph: '/ækˈtɪvəti/', level: 'B2' },
      { id: 'seed_b2_custom', content: 'custom', meaning: '习俗', type: 'word', ph: '/ˈkʌstəm/', level: 'B2' },
      { id: 'seed_b2_decorate', content: 'decorate', meaning: '装饰', type: 'word', ph: '/ˈdekəreɪt/', level: 'B2' },
      { id: 'seed_b2_decoration', content: 'decoration', meaning: '装饰品', type: 'word', ph: '/ˌdekəˈreɪʃn/', level: 'B2' },
      { id: 'seed_b2_costume', content: 'costume', meaning: '服饰', type: 'word', ph: '/ˈkɒstjuːm/', level: 'B2' },
      { id: 'seed_b2_religious', content: 'religious', meaning: '宗教的', type: 'word', ph: '/rɪˈlɪdʒəs/', level: 'B2' },
      { id: 'seed_b2_symbol', content: 'symbol', meaning: '象征', type: 'word', ph: '/ˈsɪmbl/', level: 'B2' },
      { id: 'seed_b2_symbolic', content: 'symbolic', meaning: '象征意义的', type: 'word', ph: '/sɪmˈbɒlɪk/', level: 'B2' },
      { id: 'seed_b2_parade', content: 'parade', meaning: '游行', type: 'word', ph: '/pəˈreɪd/', level: 'B2' },
      { id: 'seed_b2_exchange', content: 'exchange', meaning: '交换', type: 'word', ph: '/ɪksˈtʃeɪndʒ/', level: 'B2' },
      { id: 'seed_b2_Christmas', content: 'Christmas', meaning: '圣诞节', type: 'word', ph: '/ˈkrɪsməs/', level: 'B2' },
      { id: 'seed_b2_Halloween', content: 'Halloween', meaning: '万圣节', type: 'word', ph: '/ˌhæləʊˈiːn/', level: 'B2' },
      { id: 'seed_b2_Easter', content: 'Easter', meaning: '复活节', type: 'word', ph: '/ˈiːstə(r)/', level: 'B2' },
      { id: 'seed_b2_Thanksgiving', content: 'Thanksgiving', meaning: '感恩节', type: 'word', ph: '/ˌθæŋksˈɡɪvɪŋ/', level: 'B2' },
      { id: 'seed_b2_stranded', content: 'stranded', meaning: '被困的', type: 'word', ph: '/ˈstrændɪd/', level: 'B2' },
      { id: 'seed_b2_deserted', content: 'deserted', meaning: '荒芜的', type: 'word', ph: '/dɪˈzɜːtɪd/', level: 'B2' },
      { id: 'seed_b2_tropical', content: 'tropical', meaning: '热带的', type: 'word', ph: '/ˈtrɒpɪkl/', level: 'B2' },
      { id: 'seed_b2_relentless', content: 'relentless', meaning: '无休止的', type: 'word', ph: '/rɪˈlentləs/', level: 'B2' },
      { id: 'seed_b2_soar', content: 'soar', meaning: '飙升', type: 'word', ph: '/sɔː(r)/', level: 'B2' },
      { id: 'seed_b2_fierce', content: 'fierce', meaning: '猛烈的', type: 'word', ph: '/fɪəs/', level: 'B2' },
      { id: 'seed_b2_plummet', content: 'plummet', meaning: '骤降', type: 'word', ph: '/ˈplʌmɪt/', level: 'B2' },
      { id: 'seed_b2_venomous', content: 'venomous', meaning: '有毒的', type: 'word', ph: '/ˈvenəməs/', level: 'B2' },
      { id: 'seed_b2_submerge', content: 'submerge', meaning: '淹没', type: 'word', ph: '/səbˈmɜːdʒ/', level: 'B2' },
      { id: 'seed_b2_drinkable', content: 'drinkable', meaning: '可饮用的', type: 'word', ph: '/ˈdrɪŋkəbl/', level: 'B2' },
      { id: 'seed_b2_shelter', content: 'shelter', meaning: '庇护所', type: 'word', ph: '/ˈʃeltə(r)/', level: 'B2' },
      { id: 'seed_b2_storm', content: 'storm', meaning: '暴风雨', type: 'word', ph: '/stɔːm/', level: 'B2' },
      { id: 'seed_b2_inflatable', content: 'inflatable', meaning: '可充气的', type: 'word', ph: '/ɪnˈfleɪtəbl/', level: 'B2' },
      { id: 'seed_b2_raft', content: 'raft', meaning: '救生筏', type: 'word', ph: '/rɑːft/', level: 'B2' },
      { id: 'seed_b2_candidate', content: 'candidate', meaning: '候选人', type: 'word', ph: '/ˈkændɪdət/', level: 'B2' },
      { id: 'seed_b2_advice', content: 'advice', meaning: '建议', type: 'word', ph: '/ədˈvaɪs/', level: 'B2' },
      { id: 'seed_b2_land', content: 'land', meaning: '成功获得', type: 'word', ph: '/lænd/', level: 'B2' },
      { id: 'seed_b2_cloud', content: 'cloud', meaning: '云朵', type: 'word', ph: '/klaʊd/', level: 'B2' },
      { id: 'seed_b2_wall', content: 'wall', meaning: '墙壁', type: 'word', ph: '/wɔːl/', level: 'B2' },
      { id: 'seed_b2_scratch', content: 'scratch', meaning: '划伤；快速记下', type: 'word', ph: '/skrætʃ/', level: 'B2' },
      { id: 'seed_b2_call', content: 'call', meaning: '岗位；呼叫', type: 'word', ph: '/kɔːl/', level: 'B2' },
      { id: 'seed_b2_impress', content: 'impress', meaning: '使印象深刻', type: 'word', ph: '/ɪmˈpres/', level: 'B2' },
      { id: 'seed_b2_phonebook', content: 'phonebook', meaning: '纸质电话簿', type: 'word', ph: '/ˈfəʊnbʊk/', level: 'B2' },
      { id: 'seed_b2_perfume', content: 'perfume', meaning: '香水', type: 'word', ph: '/ˈpɜːfjuːm/', level: 'B2' },
      { id: 'seed_b2_diamond', content: 'diamond', meaning: '钻石', type: 'word', ph: '/ˈdaɪəmənd/', level: 'B2' },
      { id: 'seed_b2_traveler', content: 'traveler', meaning: '旅客', type: 'word', ph: '/ˈtrævələ(r)/', level: 'B2' },
      { id: 'seed_b2_amazing', content: 'amazing', meaning: '令人惊叹的', type: 'word', ph: '/əˈmeɪzɪŋ/', level: 'B2' },
      { id: 'seed_mc03_tet', content: 'Tet', meaning: '越南农历新年（春节）', type: 'word', ph: '/tet/', level: 'B2' },
      { id: 'seed_mc03_envelope', content: 'envelope', meaning: '信封', type: 'word', ph: '/ˈenvələʊp/', level: 'B2' },
      { id: 'seed_mc03_beverage', content: 'beverage', meaning: '饮料（较正式的说法）', type: 'word', ph: '/ˈbevərɪdʒ/', level: 'B2' },
      { id: 'seed_mc03_symbol', content: 'symbol', meaning: '象征；标志', type: 'word', ph: '/ˈsɪmbl/', level: 'B2' },
      { id: 'seed_mc03_apply', content: 'apply', meaning: '申请（通常指正式书面请求，如申请工作、学校）', type: 'word', ph: '/əˈplaɪ/', level: 'B2' },
      { id: 'seed_mc03_monarch', content: 'monarch', meaning: '君主（国王或女王）', type: 'word', ph: '/ˈmɒnək/', level: 'B2' },
      { id: 'seed_mc03_vietnam', content: 'Vietnam', meaning: '越南', type: 'word', ph: '/ˌvjetˈnæm/', level: 'B2' },
      { id: 'seed_mc03_vietnamese', content: 'Vietnamese', meaning: '越南的；越南人（语）', type: 'word', ph: '/ˌvjetnəˈmiːz/', level: 'B2' },
      { id: 'seed_mc03_alcohol', content: 'alcohol', meaning: '酒精；含酒精的饮料', type: 'word', ph: '/ˈælkəhɒl/', level: 'B2' },
      { id: 'seed_mc03_karaoke', content: 'karaoke', meaning: '卡拉 OK', type: 'word', ph: '/ˌkæriˈəʊki/', level: 'B2' },
      { id: 'seed_mc03_citizen', content: 'citizen', meaning: '公民', type: 'word', ph: '/ˈsɪtɪzn/', level: 'B2' },
      { id: 'seed_mc03_expectancy', content: 'expectancy', meaning: '预期；期望', type: 'word', ph: '/ɪkˈspektənsi/', level: 'B2' },
      { id: 'seed_mc03_life_expectancy', content: 'life expectancy', meaning: '预期寿命', type: 'word', ph: '', level: 'B2' },
      { id: 'seed_mc03_controversial', content: 'controversial', meaning: '有争议的', type: 'word', ph: '/ˌkɒntrəˈvɜːʃl/', level: 'B2' },
      { id: 'seed_mc03_policy', content: 'policy', meaning: '政策', type: 'word', ph: '/ˈpɒləsi/', level: 'B2' },
      { id: 'seed_mc03_protest', content: 'protest', meaning: '/v. 抗议；反对', type: 'word', ph: '/ˈprəʊtest/', level: 'B2' },
      { id: 'seed_mc03_cold_beverages', content: 'cold beverages', meaning: '冷饮', type: 'phrase', level: 'B2' },
      { id: 'seed_mc03_for_the_whole_night', content: 'for the whole night', meaning: '整整一夜', type: 'phrase', level: 'B2' },
      { id: 'seed_mc03_live_up_to', content: 'live up to + 数字', meaning: '达到（某个数字 / 标准）', type: 'phrase', level: 'B2' },
      { id: 'seed_mc03_be_recognised_as', content: 'be recognised as', meaning: '被认可为；被认为是', type: 'phrase', level: 'B2' },
      { id: 'seed_mc03_a_symbol_of', content: 'a symbol of', meaning: '……的象征', type: 'phrase', level: 'B2' },
      { id: 'seed_mc03_fill_out_the_application_form', content: 'fill out the application form', meaning: '填写申请表', type: 'phrase', level: 'B2' },
      { id: 'seed_mc03_before_the_deadline', content: 'before the deadline', meaning: '在截止日期之前', type: 'phrase', level: 'B2' },
      { id: 'seed_mc03_take_to_the_streets', content: 'take to the streets', meaning: '走上街头（游行 / 庆祝）', type: 'phrase', level: 'B2' },
      { id: 'seed_mc03_in_protest', content: 'in protest', meaning: '以示抗议', type: 'phrase', level: 'B2' },
      { id: 'seed_mc03_should_be_doing_sth', content: 'should be doing sth', meaning: '（现在）应该正在做（含“本该 / 责备”意味）', type: 'phrase', level: 'B2' },
      { id: 'seed_mc03_what_i_like_about_her_is_her_sense_of_humor', content: 'What I like about her is her sense of humor.', meaning: '我最喜欢她的一点是她的幽默感。', type: 'sentence', level: 'B2' },
      { id: 'seed_mc03_what_i_really_hate_about_this_is_the_fact_that_it_wastes_my_time', content: 'What I really hate about this is the fact that it wastes my time.', meaning: '我真正讨厌这一点的是它浪费了我的时间。', type: 'sentence', level: 'B2' },
      { id: 'seed_mc03_this_is_what_i_mean_when_i_say_we_need_a_clear_plan', content: 'This is what I mean when I say we need a clear plan.', meaning: '这就是我说“我们需要一个清晰的计划”时的意思。', type: 'sentence', level: 'B2' },
      { id: 'seed_mc03_what_i_don_t_understand_is_why_we_re_here', content: 'What I don\'t understand is why we\'re here.', meaning: '我不理解的是我们为什么会在这里。', type: 'sentence', level: 'B2' },
      { id: 'seed_mc03_that_s_exactly_what_happens_every_year_in_vietnam', content: 'That\'s exactly what happens every year in Vietnam.', meaning: '那正是越南每年发生的事。', type: 'sentence', level: 'B2' },
      { id: 'seed_mc03_grammar1', content: 'what 引导自由关系从句', noTest: true, type: 'grammar', level: 'B2', meaning: 'what = the thing(s) that，在句中作名词短语，可作主语或宾语。中文“……的是”常用 What 前置；that 不能引导自由关系从句；which / how 不能替代 what。' },
      { id: 'seed_mc03_grammar2', content: 'should be doing', noTest: true, type: 'grammar', level: 'B2', meaning: '进行式情态，表示“当下本该正在做”，常含责备 / 遗憾。对比 should do 仅表“应该做”。' },
]
  };
  function runSeed() {
    try {
      var cur = localStorage.getItem(SEED_KEY);
      if (cur === KB_SEED.version) return; // 本版本种子已注入过
      var arr = loadRaw();
      var exists = function (content) {
        var c = (content || '').toLowerCase();
        return arr.some(function (e) { return (e.content || '').toLowerCase() === c; });
      };
      KB_SEED.items.forEach(function (it) {
        if (exists(it.content)) return; // 用户已手动添加过同内容则跳过，避免重复
        arr.push({
          id: it.id, content: it.content, meaning: it.meaning || '',
          type: it.type, level: it.level || 'B1',
          ph: it.ph || '', example: it.example || '', exampleZh: it.exampleZh || '',
          note: it.note || '', noTest: !!it.noTest,
          createdAt: Date.now(), updatedAt: Date.now()
        });
      });
      saveRaw(arr);
      localStorage.setItem(SEED_KEY, KB_SEED.version);
    } catch (e) { console.warn('KB seed', e); }
  }

  /* ---------------- 历史数据迁移：把不适合选择题的条目标记为 noTest ---------------- */
  function migrateKB() {
    var arr = loadRaw();
    var changed = false;
    arr.forEach(function (e) {
      if (e.noTest) return;
      var m = (e.meaning || '').trim();
      var c = (e.content || '').trim();
      // 语法规则、释义为空/占位符、含规则符号的条目，都不适合出“是什么意思”选择题
      if (e.type === 'grammar' || !m || m === '（释义）' || /[→＋+\：]/.test(c)) {
        e.noTest = true;
        e.updatedAt = Date.now();
        changed = true;
      }
      // 新增：把内容无字母/中文、纯符号、Markdown 标题、释义为章节标题的旧数据也标记为 noTest
      if (!/[a-zA-Z\u4e00-\u9fff]/.test(c) || /^#+/.test(c) || /^[一二三四五六七八九十]+、/.test(m)) {
        e.noTest = true;
        e.updatedAt = Date.now();
        changed = true;
      }
    });
    if (changed) saveRaw(arr);
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
    getEntries: getEntries, getEntriesByLevel: getEntriesByLevel, getByType: getByType, upsert: upsert, remove: removeEntry,
    exportJSON: exportJSON, importJSON: importJSON,
    pushSync: pushSync, pullSync: pullSync, ensureGist: ensureGist,
    loadSyncCfg: loadSyncCfg, saveSyncCfg: saveSyncCfg, apply: apply,
    addFromText: addFromText, parseEntry: parseEntry, classifyType: classifyType
  };

  /* ---------------- 启动：配置了云同步则先拉取再注入 ---------------- */
  (function boot() {
    var cfg = loadSyncCfg();
    function run() { migrateKB(); runSeed(); apply(); }
    if (cfg && cfg.token && cfg.gist) {
      pullSync().then(run, run);
    } else {
      run();
    }
  })();
})();
