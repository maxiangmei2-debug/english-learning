/* MC19WB-20260813 */
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
  /* INJECT-WB-20261019-KB */
/* INJECT-WB-20261026-KB */
/* INJECT-WB-20261028-KB */
var KB_SEED = /* SEED-MC21-WB */
{
    version: '20260914-mc21',
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
      /* INJECT-MC30-SUPP-20261016-KB */
      { id: 'seed_b2_mc30_feature', content: 'feature', meaning: 'n. 特征', type: 'word', level: 'B2' },
      { id: 'seed_b2_mc30_introverted', content: 'introverted', meaning: 'adj. 内向的', type: 'word', level: 'B2' },
      { id: 'seed_b2_mc30_enthusiastic', content: 'enthusiastic', meaning: 'adj. 热情的', type: 'word', level: 'B2' },
      { id: 'seed_b2_mc30_passionate', content: 'passionate', meaning: 'adj. 充满激情的', type: 'word', level: 'B2' },
      { id: 'seed_b2_mc30_overwhelming', content: 'overwhelming', meaning: 'adj. 令人难以招架的（贬义）', type: 'word', level: 'B2' },
      { id: 'seed_b2_mc30_overwhelmed', content: 'overwhelmed', meaning: 'adj.（人）感到不堪重负的', type: 'word', level: 'B2' },
      { id: 'seed_b2_mc30_energetic', content: 'energetic', meaning: 'adj. 精力充沛的', type: 'word', level: 'B2' },
      { id: 'seed_b2_mc30_content', content: 'content', meaning: 'adj. 满足的', type: 'word', level: 'B2' },
      { id: 'seed_b2_mc30_neutral', content: 'neutral', meaning: 'adj. 中立的；情绪平淡的', type: 'word', level: 'B2' },
      { id: 'seed_b2_mc30_clumsy', content: 'clumsy', meaning: 'adj. 笨拙的', type: 'word', level: 'B2' },
      { id: 'seed_b2_mc30_insufferable', content: 'insufferable', meaning: 'adj. 让人难以忍受的', type: 'word', level: 'B2' },
      { id: 'seed_b2_mc30_prompt', content: 'prompt', meaning: 'adj. 及时的；立刻的', type: 'word', level: 'B2' },
      { id: 'seed_b2_mc30_tedious', content: 'tedious', meaning: 'adj. 令人厌烦的、乏味的', type: 'word', level: 'B2' },
      { id: 'seed_b2_mc30_tiresome', content: 'tiresome', meaning: 'adj. 令人厌烦的、乏味的', type: 'word', level: 'B2' },
      { id: 'seed_b2_mc30_kindof', content: 'kind of', meaning: '有点儿（口语）', type: 'word', level: 'B2' },
      { id: 'seed_b2_mc30_inagoodmood', content: 'in a good mood', meaning: '心情好', type: 'word', level: 'B2' },
      { id: 'seed_b2_mc30_beinthemoodfor', content: 'be in the mood for', meaning: '有兴致做某事', type: 'word', level: 'B2' },
      { id: 'seed_b2_mc30_getalongwith', content: 'get along with', meaning: '和某人相处', type: 'word', level: 'B2' },
      { id: 'seed_b2_mc30_getasmileoutof', content: 'get a smile out of', meaning: '逗某人笑出来', type: 'word', level: 'B2' },
      { id: 'seed_b2_mc30_noappetite', content: 'no appetite', meaning: '没有胃口', type: 'word', level: 'B2' },
      { id: 'seed_b2_mc30_overthetop', content: 'over the top', meaning: '做得过火，夸张', type: 'word', level: 'B2' },
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
,
      { id: 'seed_mc19wb_department', content: 'department', meaning: '部门', type: 'word', ph: '/dɪˈpɑːtmənt/', level: 'B2' },
      { id: 'seed_mc19wb_colleague', content: 'colleague', meaning: '同事（易错：不要写成 college 大学）', type: 'word', ph: '/ˈkɒliːɡ/', level: 'B2' },
      { id: 'seed_mc19wb_order', content: 'order', meaning: '订单', type: 'word', ph: '/ˈɔːdə(r)/', level: 'B2' },
      { id: 'seed_mc19wb_management', content: 'management', meaning: '管理', type: 'word', ph: '/ˈmænɪdʒmənt/', level: 'B2' },
      { id: 'seed_mc19wb_director', content: 'director', meaning: '主管、总监', type: 'word', ph: '/dəˈrektə(r)/', level: 'B2' },
      { id: 'seed_mc19wb_process', content: 'process', meaning: '流程，工序', type: 'word', ph: '/ˈprəʊses/', level: 'B2' },
      { id: 'seed_mc19wb_mobile', content: 'mobile', meaning: '移动电话；adj. 移动的（mobile phone 手机；勿写 moilephone）', type: 'word', ph: '/ˈməʊbaɪl/', level: 'B2' },
      { id: 'seed_mc19wb_access', content: 'access', meaning: '权限，访问资格', type: 'word', ph: '/ˈækses/', level: 'B2' },
      { id: 'seed_mc19wb_internal', content: 'internal', meaning: '内部的', type: 'word', ph: '/ɪnˈtɜːnl/', level: 'B2' },
      { id: 'seed_mc19wb_credential', content: 'credential', meaning: '账号凭证，资质', type: 'word', ph: '/krəˈdenʃl/', level: 'B2' },
      { id: 'seed_mc19wb_logistics', content: 'logistics', meaning: '后勤，物流', type: 'word', ph: '/ləˈdʒɪstɪks/', level: 'B2' },
      { id: 'seed_mc19wb_guidance', content: 'guidance', meaning: '指导', type: 'word', ph: '/ˈɡaɪdns/', level: 'B2' },
      { id: 'seed_mc19wb_teammate', content: 'teammate', meaning: '队友，同事', type: 'word', ph: '/ˈtiːmmeɪt/', level: 'B2' },
      { id: 'seed_mc19wb_buddy', content: 'buddy', meaning: '搭档，帮扶伙伴', type: 'word', ph: '/ˈbʌdi/', level: 'B2' },
      { id: 'seed_mc19wb_mentor', content: 'mentor', meaning: '导师，带教前辈', type: 'word', ph: '/ˈmentɔː(r)/', level: 'B2' },
      { id: 'seed_mc19wb_printer', content: 'printer', meaning: '打印机', type: 'word', ph: '/ˈprɪntə(r)/', level: 'B2' },
      { id: 'seed_mc19wb_nervous', content: 'nervous', meaning: '紧张的', type: 'word', ph: '/ˈnɜːvəs/', level: 'B2' },
      { id: 'seed_mc19wb_anxious', content: 'anxious', meaning: '焦虑的', type: 'word', ph: '/ˈæŋkʃəs/', level: 'B2' },
      { id: 'seed_mc19wb_embarrassed', content: 'embarrassed', meaning: '尴尬的（负面情绪形容词）', type: 'word', ph: '/ɪmˈbærəst/', level: 'B2' },
      { id: 'seed_mc19wb_scared', content: 'scared', meaning: '害怕的', type: 'word', ph: '/skeəd/', level: 'B2' },
      { id: 'seed_mc19wb_frightened', content: 'frightened', meaning: '害怕的', type: 'word', ph: '/ˈfraɪtnd/', level: 'B2' },
      { id: 'seed_mc19wb_excited', content: 'excited', meaning: '兴奋的', type: 'word', ph: '/ɪkˈsaɪtɪd/', level: 'B2' },
      { id: 'seed_mc19wb_interested', content: 'interested', meaning: '感兴趣的', type: 'word', ph: '/ˈɪntrəstɪd/', level: 'B2' },
      { id: 'seed_mc19wb_purple', content: 'purple', meaning: '紫色的', type: 'word', ph: '/ˈpɜːpl/', level: 'B2' },
      { id: 'seed_mc19wb_dark', content: 'dark', meaning: '深色的', type: 'word', ph: '/dɑːk/', level: 'B2' },
      { id: 'seed_mc19wb_direct', content: 'direct', meaning: '直属的，直接的', type: 'word', ph: '/daɪˈrekt/', level: 'B2' },
      { id: 'seed_mc19wb_introduce', content: 'introduce', meaning: '介绍', type: 'word', ph: '/ˌɪntrəˈdjuːs/', level: 'B2' },
      { id: 'seed_mc19wb_deal', content: 'deal', meaning: '处理，对接', type: 'word', ph: '/diːl/', level: 'B2' },
      { id: 'seed_mc19wb_learn', content: 'learn', meaning: '学习', type: 'word', ph: '/lɜːn/', level: 'B2' },
      { id: 'seed_mc19wb_remember', content: 'remember', meaning: '记住', type: 'word', ph: '/rɪˈmembə(r)/', level: 'B2' },
      { id: 'seed_mc19wb_note', content: 'note', meaning: '记录', type: 'word', ph: '/nəʊt/', level: 'B2' },
      { id: 'seed_mc19wb_set_up', content: 'set up', meaning: '搭建，开通', type: 'word', ph: '', level: 'B2' },
      { id: 'seed_mc19wb_introduce_oneself', content: 'introduce oneself', meaning: '自我介绍', type: 'word', ph: '', level: 'B2' },
      { id: 'seed_mc19wb_welcome_to_the_department', content: 'Welcome to the department', meaning: '欢迎来到本部门', type: 'phrase', level: 'B2' },
      { id: 'seed_mc19wb_show_sb_around', content: 'show sb around', meaning: '带某人四处参观', type: 'phrase', level: 'B2' },
      { id: 'seed_mc19wb_introduce_you_to_them_all', content: 'introduce you to them all', meaning: '把所有人介绍给你', type: 'phrase', level: 'B2' },
      { id: 'seed_mc19wb_deal_with_new_orders', content: 'deal with new orders', meaning: '处理新订单（deal with 必须带 with）', type: 'phrase', level: 'B2' },
      { id: 'seed_mc19wb_work_closely_with_sb', content: 'work closely with sb', meaning: '和某人紧密协作', type: 'phrase', level: 'B2' },
      { id: 'seed_mc19wb_order_management_team', content: 'order management team', meaning: '订单管理团队', type: 'phrase', level: 'B2' },
      { id: 'seed_mc19wb_ordering_process', content: 'ordering process', meaning: '下单流程', type: 'phrase', level: 'B2' },
      { id: 'seed_mc19wb_marketing_director', content: 'marketing director', meaning: '市场总监', type: 'phrase', level: 'B2' },
      { id: 'seed_mc19wb_internal_it_systems', content: 'internal IT systems', meaning: '内部信息技术系统', type: 'phrase', level: 'B2' },
      { id: 'seed_mc19wb_email_access', content: 'email access', meaning: '邮箱登录权限', type: 'phrase', level: 'B2' },
      { id: 'seed_mc19wb_work_in_communications', content: 'work in communications', meaning: '任职于通讯部门（介词 in 固定）', type: 'phrase', level: 'B2' },
      { id: 'seed_mc19wb_next_to_the_printer', content: 'next to the printer', meaning: '打印机旁边', type: 'phrase', level: 'B2' },
      { id: 'seed_mc19wb_introduce_oneself_to_sb', content: 'introduce oneself to sb', meaning: '向某人自我介绍', type: 'phrase', level: 'B2' },
      { id: 'seed_mc19wb_put_some_faces_to_names', content: 'put some faces to names', meaning: '认脸对应人名（职场地道固定习语）', type: 'phrase', level: 'B2' },
      { id: 'seed_mc19wb_don_t_worry_about_it', content: 'Don\'t worry about it', meaning: '别担心这件事（末尾 it 不可省略）', type: 'phrase', level: 'B2' },
      { id: 'seed_mc19wb_take_notes', content: 'take notes', meaning: '记笔记', type: 'phrase', level: 'B2' },
      { id: 'seed_mc19wb_physical_and_digital_logistics', content: 'physical and digital logistics', meaning: '线下与线上后勤事务', type: 'phrase', level: 'B2' },
      { id: 'seed_mc19wb_access_credentials', content: 'access credentials', meaning: '登录凭证', type: 'phrase', level: 'B2' },
      { id: 'seed_mc19wb_basic_it_setup', content: 'basic IT setup', meaning: '基础账号开通设置', type: 'phrase', level: 'B2' },
      { id: 'seed_mc19wb_direct_manager', content: 'direct manager', meaning: '直属上级', type: 'phrase', level: 'B2' },
      { id: 'seed_mc19wb_immediate_teammates', content: 'immediate teammates', meaning: '同组同事', type: 'phrase', level: 'B2' },
      { id: 'seed_mc19wb_assigned_buddy_mentor', content: 'assigned buddy/mentor', meaning: '指派帮扶搭档 / 带教导师', type: 'phrase', level: 'B2' },
      { id: 'seed_mc19wb_as_clear_as_day', content: 'as clear as day', meaning: '一清二楚，十分清晰', type: 'phrase', level: 'B2' },
      { id: 'seed_mc19wb_quite_a_a_very', content: 'quite a + 名词 / a very + 形容词', meaning: '十分……', type: 'phrase', level: 'B2' },
      { id: 'seed_mc19wb_i_was_felt_nervous_anxious', content: 'I was / felt nervous/anxious', meaning: '我感到紧张焦虑', type: 'phrase', level: 'B2' },
      { id: 'seed_mc19wb_feel_embarrassed_because', content: 'feel embarrassed because…', meaning: '因为……感到尴尬', type: 'phrase', level: 'B2' },
      { id: 'seed_mc19wb_by_the_window', content: 'by the window', meaning: '在窗边', type: 'phrase', level: 'B2' },
      { id: 'seed_mc19wb_beside_him', content: 'beside him', meaning: '在他身旁', type: 'phrase', level: 'B2' },
      { id: 'seed_mc19wb_on_the_phone', content: 'on the phone', meaning: '正在打电话', type: 'phrase', level: 'B2' },
      { id: 'seed_mc19wb_welcome_to_the_department_yuki_let_me_sh', content: 'Welcome to the department, Yuki. Let me show you around and tell you about your new colleagues. I\'ll introduce you to th', meaning: '欢迎来到部门，由纪。我带你四处看看，给你介绍新同事。稍后我会把大家一一介绍给你。', type: 'sentence', level: 'B2' },
      { id: 'seed_mc19wb_who_are_those_people_over_there', content: 'Who are those people over there?', meaning: '那边那些人是谁？', type: 'sentence', level: 'B2' },
      { id: 'seed_mc19wb_that_s_the_order_management_team_luciana', content: 'That\'s the order management team. Luciana deals with new orders. She\'s the one with short, dark hair.', meaning: '那是订单管理团队。露西安娜处理新订单。就是那个留着深色短发的人。', type: 'sentence', level: 'B2' },
      { id: 'seed_mc19wb_you_ll_probably_work_closely_with_her_wh', content: 'You\'ll probably work closely with her while you are learning about our ordering process.', meaning: '在学习我们下单流程的过程中，你可能会和她密切合作。', type: 'sentence', level: 'B2' },
      { id: 'seed_mc19wb_oh_you_mean_the_one_by_the_window_in_the', content: 'Oh, you mean the one by the window? In the green shirt? Ah, that\'s Ian. He\'s the marketing director.', meaning: '哦，你是说窗边那位？穿绿衬衫的？啊，那是伊恩。他是市场总监。', type: 'sentence', level: 'B2' },
      { id: 'seed_mc19wb_and_that_s_maria_beside_him_she_s_respon', content: 'And that\'s Maria beside him. She\'s responsible for the internal IT systems.', meaning: '他旁边是玛丽亚。她负责内部 IT 系统。', type: 'sentence', level: 'B2' },
      { id: 'seed_mc19wb_i_ll_try_to_remember_all_of_this_i_shoul', content: 'I\'ll try to remember all of this. I should probably be taking notes!', meaning: '我会努力记住这些。我大概应该记笔记！', type: 'sentence', level: 'B2' },
      { id: 'seed_mc19wb_don_t_worry_about_it_for_now_it_s_just_g', content: 'Don\'t worry about it. For now it\'s just good to put some faces to names.', meaning: '别担心。目前能把名字和脸对上号就很好了。', type: 'sentence', level: 'B2' },
      { id: 'seed_mc19wb_who_do_i_talk_to_about_setting_up_my_mob', content: 'Who do I talk to about setting up my mobile phone with email access?', meaning: '我该找谁给我的手机设置邮箱访问权限？', type: 'sentence', level: 'B2' },
      { id: 'seed_mc19wb_no_you_need_to_talk_to_sebastian_who_wor', content: 'No, you need to talk to Sebastian who works in communications.', meaning: '不，你得找在通讯部门工作的塞巴斯蒂安。', type: 'sentence', level: 'B2' },
      { id: 'seed_mc19wb_i_ll_introduce_myself_to_him_later', content: 'I\'ll introduce myself to him later.', meaning: '我稍后向他自我介绍。', type: 'sentence', level: 'B2' },
      { id: 'seed_mc19wb_i_still_remember_my_first_day_at_work_as', content: 'I still remember my first day at work as clear as day.', meaning: '我仍清楚记得我第一天上班的情景。', type: 'sentence', level: 'B2' },
      { id: 'seed_mc19wb_i_was_quite_a_nervous_person', content: 'I was quite a nervous person.', meaning: '我以前是个很紧张的人。', type: 'sentence', level: 'B2' },
      { id: 'seed_mc19wb_i_felt_very_nervous_because_i_didn_t_kno', content: 'I felt very nervous because I didn\'t know whether I did well or not.', meaning: '我很紧张，因为我不知道自己做得好不好。', type: 'sentence', level: 'B2' },
      { id: 'seed_mc19wb_yuki_is_new_in_the_office', content: 'Yuki is new in the office.', meaning: '由纪是办公室新人。', type: 'sentence', level: 'B2' },
      { id: 'seed_mc19wb_she_is_responsible_for_it_internal_syste', content: 'She is responsible for IT internal systems.', meaning: '她负责 IT 内部系统。', type: 'sentence', level: 'B2' },
      { id: 'seed_mc19wb_grammar1', content: 'should be doing', noTest: true, type: 'grammar', level: 'B2', meaning: 'should be doing 表示“本该正在做”，强调持续动作或当下未做；与 should do（单次建议）不同。结构：should + be + doing。' },
      { id: 'seed_mc19wb_errors', content: 'MC19 专属易错点', noTest: true, type: 'grammar', level: 'B2', meaning: 'colleges → colleagues 同事 / college 大学，形近词极易混淆 thoes → those 那些，代词，拼写易错 manager → management order management team 订单管理组，manager 是经理 pupral → purple 紫色，拼写错误 moile → mobile 移动 latter → later later 稍后；latter 后者，形近易错 gay → guy guy 男士、小伙子，词义完全不同 colleague（同事） ↔ college（大学） 听写直接写错词义' },

    { id: 'seed_mcamuse_fac0', content: 'bathroom', meaning: '卫生间', type: 'word', level: 'B1', ph: '/ˈbɑːθruːm/' },
    { id: 'seed_mcamuse_fac1', content: 'public toilets', meaning: '公共厕所', type: 'word', level: 'B1', ph: '/ˈpʌblɪk ˈtɔɪləts/' },
    { id: 'seed_mcamuse_fac2', content: 'car park', meaning: '停车场（英式）', type: 'word', level: 'B1', ph: '/kɑː pɑːk/' },
    { id: 'seed_mcamuse_fac3', content: 'parking lot', meaning: '停车场（美式）', type: 'word', level: 'B1', ph: '/ˈpɑːrkɪŋ lɑːt/' },
    { id: 'seed_mcamuse_fac4', content: 'dining hall', meaning: '食堂；就餐区', type: 'word', level: 'B1', ph: '/ˈdaɪnɪŋ hɔːl/' },
    { id: 'seed_mcamuse_fac5', content: 'restaurant', meaning: '餐厅', type: 'word', level: 'B1', ph: '/ˈrestrɒnt/' },
    { id: 'seed_mcamuse_fac6', content: 'café', meaning: '咖啡馆', type: 'word', level: 'B1', ph: '/ˈkæfeɪ/' },
    { id: 'seed_mcamuse_fac7', content: 'sick bay', meaning: '医务室', type: 'word', level: 'B1', ph: '/sɪk beɪ/' },
    { id: 'seed_mcamuse_fac8', content: 'emergency area', meaning: '紧急集合区', type: 'word', level: 'B1', ph: '/ɪˈmɜːdʒənsi ˈeəriə/' },
    { id: 'seed_mcamuse_fac9', content: 'security facility', meaning: '安保设施', type: 'word', level: 'B1', ph: '/səˈkjʊərəti fəˈsɪləti/' },
    { id: 'seed_mcamuse_fac10', content: 'information centre', meaning: '咨询中心', type: 'word', level: 'B1', ph: '/ˌɪnfəˈmeɪʃn ˈsentə/' },
    { id: 'seed_mcamuse_fac11', content: 'souvenir shop', meaning: '纪念品店', type: 'word', level: 'B1', ph: '/ˌsuːvənɪə ʃɒp/' },
    { id: 'seed_mcamuse_fac12', content: 'gift shop', meaning: '礼品店', type: 'word', level: 'B1', ph: '/ɡɪft ʃɒp/' },
    { id: 'seed_mcamuse_ride0', content: 'roller-coaster', meaning: '过山车', type: 'word', level: 'B1', ph: '/ˈrəʊlə kəʊstə/' },
    { id: 'seed_mcamuse_ride1', content: 'ferris wheel', meaning: '摩天轮', type: 'word', level: 'B1', ph: '/ˈferɪs wiːl/' },
    { id: 'seed_mcamuse_ride2', content: 'carousel', meaning: '旋转木马', type: 'word', level: 'B1', ph: '/ˈkærəsel/' },
    { id: 'seed_mcamuse_ride3', content: 'merry-go-round', meaning: '旋转木马', type: 'word', level: 'B1', ph: '/ˈmeri ɡəʊ raʊnd/' },
    { id: 'seed_mcamuse_ride4', content: 'bumper cars', meaning: '碰碰车', type: 'word', level: 'B1', ph: '/ˈbʌmpə kɑːz/' },
    { id: 'seed_mcamuse_ride5', content: 'pirate ship', meaning: '海盗船', type: 'word', level: 'B1', ph: '/ˈpaɪrət ʃɪp/' },
    { id: 'seed_mcamuse_ride6', content: 'spinning teacups', meaning: '旋转茶杯', type: 'word', level: 'B1', ph: '/ˈspɪnɪŋ ˈtiːkʌps/' },
    { id: 'seed_mcamuse_adj0', content: 'thrilling', meaning: '刺激的', type: 'word', level: 'B1', ph: '/ˈθrɪlɪŋ/' },
    { id: 'seed_mcamuse_adj1', content: 'exciting', meaning: '令人兴奋的', type: 'word', level: 'B1', ph: '/ɪkˈsaɪtɪŋ/' },
    { id: 'seed_mcamuse_adj2', content: 'fun', meaning: '有趣的', type: 'word', level: 'B1', ph: '/fʌn/' },
    { id: 'seed_mcamuse_adj3', content: 'scary', meaning: '吓人的', type: 'word', level: 'B1', ph: '/ˈskeəri/' },
    { id: 'seed_mcamuse_adj4', content: 'relaxing', meaning: '令人放松的', type: 'word', level: 'B1', ph: '/rɪˈlæksɪŋ/' },
    { id: 'seed_mcamuse_adj5', content: 'amazing', meaning: '令人惊叹的', type: 'word', level: 'B1', ph: '/əˈmeɪzɪŋ/' },
    { id: 'seed_mcamuse_adj6', content: 'romantic', meaning: '浪漫的', type: 'word', level: 'B1', ph: '/rəʊˈmæntɪk/' },
    { id: 'seed_mcamuse_adj7', content: 'fantastic', meaning: '极好的', type: 'word', level: 'B1', ph: '/fænˈtæstɪk/' },
    { id: 'seed_mcamuse_adj8', content: 'wonderful', meaning: '精彩的', type: 'word', level: 'B1', ph: '/ˈwʌndəfl/' },
    { id: 'seed_mcamuse_adj9', content: 'excellent', meaning: '优秀的', type: 'word', level: 'B1', ph: '/ˈeksələnt/' },
    { id: 'seed_mcamuse_adj10', content: 'superb', meaning: '极好的', type: 'word', level: 'B1', ph: '/suːˈpɜːb/' },
    { id: 'seed_mcamuse_adj11', content: 'comfortable', meaning: '舒适的', type: 'word', level: 'B1', ph: '/ˈkʌmftəbl/' },
    { id: 'seed_mcamuse_adj12', content: 'great', meaning: '很棒的', type: 'word', level: 'B1', ph: '/ɡreɪt/' },
    { id: 'seed_mcamuse_adj13', content: 'large', meaning: '大的', type: 'word', level: 'B1', ph: '/lɑːdʒ/' },
    { id: 'seed_mcamuse_adj14', content: 'huge', meaning: '巨大的', type: 'word', level: 'B1', ph: '/hjuːdʒ/' },
    { id: 'seed_mcamuse_adj15', content: 'noisy', meaning: '吵闹的', type: 'word', level: 'B1', ph: '/ˈnɔɪzi/' },
    { id: 'seed_mcamuse_adj16', content: 'lively', meaning: '热闹的', type: 'word', level: 'B1', ph: '/ˈlaɪvli/' },
    { id: 'seed_mcamuse_adj17', content: 'energetic', meaning: '充满活力的', type: 'word', level: 'B1', ph: '/ˌenəˈdʒetɪk/' },
    { id: 'seed_mcamuse_adj18', content: 'safe', meaning: '安全的', type: 'word', level: 'B1', ph: '/seɪf/' },
    { id: 'seed_mcamuse_adj19', content: 'nostalgic', meaning: '怀旧的', type: 'word', level: 'B2', ph: '/nɒˈstældʒɪk/' },
    { id: 'seed_mcamuse_adj20', content: 'dazzling', meaning: '耀眼的', type: 'word', level: 'B2', ph: '/ˈdæzlɪŋ/' },
    { id: 'seed_mcamuse_adj21', content: 'spectacular', meaning: '壮观的', type: 'word', level: 'B2', ph: '/spekˈtækjələ/' },
    { id: 'seed_mcamuse_adj22', content: 'exhilarating', meaning: '令人振奋的', type: 'word', level: 'B2', ph: '/ɪɡˈzɪləreɪtɪŋ/' },
    { id: 'seed_mcamuse_adj23', content: 'bustling', meaning: '熙熙攘攘的', type: 'word', level: 'B2', ph: '/ˈbʌslɪŋ/' },
    { id: 'seed_mcamuse_adj24', content: 'electrifying', meaning: '令人激动的', type: 'word', level: 'B2', ph: '/ɪˈlektrɪfaɪɪŋ/' },
    { id: 'seed_mcamuse_adj25', content: 'dynamic', meaning: '充满活力的', type: 'word', level: 'B2', ph: '/daɪˈnæmɪk/' },
    { id: 'seed_mcamuse_nbw0', content: 'niche', meaning: '小众的；利基', type: 'word', level: 'B2', ph: '/niːʃ/' },
    { id: 'seed_mcamuse_nbw1', content: 'viral', meaning: '病毒式传播的', type: 'word', level: 'B2', ph: '/ˈvaɪrəl/' },
    { id: 'seed_mcamuse_nbw2', content: 'fad', meaning: '一时的狂热', type: 'word', level: 'B2', ph: '/fæd/' },
    { id: 'seed_mcamuse_nbw3', content: 'hype', meaning: '炒作；宣传', type: 'word', level: 'B2', ph: '/haɪp/' },
    { id: 'seed_mcamuse_nbw4', content: 'overrated', meaning: '被高估的', type: 'word', level: 'B2', ph: '/ˌəʊvəˈreɪtɪd/' },
    { id: 'seed_mcamuse_nbw5', content: 'underrated', meaning: '被低估的', type: 'word', level: 'B2', ph: '/ˌʌndəˈreɪtɪd/' },
    { id: 'seed_mcamuse_nbw6', content: 'outdated', meaning: '过时的', type: 'word', level: 'B2', ph: '/ˌaʊtˈdeɪtɪd/' },
    { id: 'seed_mcamuse_nbw7', content: 'cutting-edge', meaning: '前沿的；尖端的', type: 'word', level: 'B2', ph: '/ˌkʌtɪŋ ˈedʒ/' },
    { id: 'seed_mcamuse_nbw8', content: 'innovative', meaning: '创新的', type: 'word', level: 'B2', ph: '/ˈɪnəvətɪv/' },
    { id: 'seed_mcamuse_nbw9', content: 'vintage', meaning: '复古的（优质老物）', type: 'word', level: 'B2', ph: '/ˈvɪntɪdʒ/' },
    { id: 'seed_mcamuse_nbw10', content: 'retro style', meaning: '复古风格', type: 'word', level: 'B2', ph: '/ˈretroʊ staɪl/' },
    { id: 'seed_mcamuse_nbw11', content: 'live-streaming', meaning: '直播的', type: 'word', level: 'B2', ph: '/ˈlɪv striːmɪŋ/' },
    { id: 'seed_mcamuse_nbw12', content: 'overheads', meaning: '日常开支；管理费', type: 'word', level: 'B2', ph: '/ˈəʊvəhedz/' },
    { id: 'seed_mcamuse_nbw13', content: 'decorate', meaning: '装饰；布置', type: 'word', level: 'B2', ph: '/ˈdekəreɪt/' },
    { id: 'seed_mcamuse_nbw14', content: 'decoration', meaning: '装饰；装饰品', type: 'word', level: 'B2', ph: '/ˌdekəˈreɪʃn/' },
    { id: 'seed_mcamuse_nbw15', content: 'spooky', meaning: '阴森恐怖的', type: 'word', level: 'B2', ph: '/ˈspuːki/' },
    { id: 'seed_mcamuse_nbw16', content: 'folk music', meaning: '民间音乐', type: 'word', level: 'B2', ph: '/fəʊk ˈmjuːzɪk/' },
    { id: 'seed_mcamuse_nbw17', content: 'lunar month', meaning: '农历月', type: 'word', level: 'B2', ph: '/ˈluːnə mʌnθ/' },
    { id: 'seed_mcamuse_nbw18', content: 'nostalgia', meaning: '怀旧；乡愁', type: 'word', level: 'B2', ph: '/nɒˈstældʒə/' },
    { id: 'seed_mcamuse_nbw19', content: 'nervousness', meaning: '紧张；不安', type: 'word', level: 'B2', ph: '/ˈnɜːvəsnəs/' },
    { id: 'seed_mcamuse_nbw20', content: 'sincere', meaning: '真诚的', type: 'word', level: 'B2', ph: '/sɪnˈsɪə/' },
    { id: 'seed_mcamuse_nbw21', content: 'influence', meaning: '影响', type: 'word', level: 'B2', ph: '/ˈɪnfluəns/' },
    { id: 'seed_mcamuse_ph0', content: 'put ... away', meaning: '把…收起来放好', type: 'phrase', level: 'B2', ph: '/pʊt əˈweɪ/' },
    { id: 'seed_mcamuse_ph1', content: 'tend to do sth', meaning: '往往会做某事', type: 'phrase', level: 'B2', ph: '/tend tə duː/' },
    { id: 'seed_mcamuse_ph2', content: 'stock up on', meaning: '囤积；备足', type: 'phrase', level: 'B2', ph: '/stɒk ʌp ɒn/' },
    { id: 'seed_mcamuse_ph3', content: 'help out around the house', meaning: '在家里帮忙做家务', type: 'phrase', level: 'B2', ph: '/help aʊt əˈraʊnd ðə haʊs/' },
    { id: 'seed_mcamuse_ph4', content: 'nag', meaning: '唠叨；抱怨', type: 'phrase', level: 'B2', ph: '/næɡ/' },
    { id: 'seed_mcamuse_ph5', content: 'gonna', meaning: '将要（口语）= going to', type: 'phrase', level: 'B2', ph: '/ˈɡənə/' },
    { id: 'seed_mcamuse_ph6', content: 'go for it', meaning: '放手去做；加油', type: 'phrase', level: 'B2', ph: '/ɡəʊ fər ɪt/' },
    { id: 'seed_mcamuse_ph7', content: 'in charge of', meaning: '负责；掌管', type: 'phrase', level: 'B2', ph: '/ɪn tʃɑːdʒ ɒv/' },
    { id: 'seed_mcamuse_ph8', content: 'despite', meaning: '尽管（介词）', type: 'phrase', level: 'B2', ph: '/dɪˈspaɪt/' },
    { id: 'seed_mcamuse_ph9', content: 'make up for it', meaning: '弥补；补偿', type: 'phrase', level: 'B2', ph: '/meɪk ʌp fər ɪt/' },
    { id: 'seed_mcamuse_sent0', content: 'Good morning, everyone. Welcome to Happy Valley. I am your tour guide today.', meaning: '大家早上好，欢迎来到欢乐谷。我是今天的导游。', type: 'sentence', level: 'B2' },
    { id: 'seed_mcamuse_sent1', content: 'Please keep your personal belongings safe.', meaning: '请保管好您的个人物品。（祈使句）', type: 'sentence', level: 'B2' },
    { id: 'seed_mcamuse_sent2', content: 'Don’t run in the park.', meaning: '不要在园区里奔跑。（祈使句否定）', type: 'sentence', level: 'B2' },
    { id: 'seed_mcamuse_sent3', content: 'Since it is crowded, we should queue.', meaning: '因为人很多，我们应该排队。（since 表原因 + should）', type: 'sentence', level: 'B2' },
    { id: 'seed_mcamuse_sent4', content: 'You must fasten your seat belt.', meaning: '你一定要系好安全带。（must 强制）', type: 'sentence', level: 'B2' },
    { id: 'seed_mcamuse_sent5', content: 'This roller-coaster is too thrilling. I dare not ride it.', meaning: '这个过山车太刺激了，我不敢坐。', type: 'sentence', level: 'B2' },
    { id: 'seed_mcamuse_grammar1', content: 'Imperative 祈使句', meaning: '祈使句以动词原形开头，表指令或建议。肯定 Keep left.；否定 Don\'t run.。常作开场引导与园区规则。', type: 'grammar', level: 'B2', noTest: true },
    { id: 'seed_mcamuse_grammar2', content: 'Modals of persuasion', meaning: 'should 表建议，must 表强制/必要；since = because 引导原因，如 Since it\'s crowded, we should wait. 口语可用 gonna 代替 going to，despite 是介词，后接名词/动名词（完整句用 although/though）。', type: 'grammar', level: 'B2', noTest: true }
    // —— MC15 The Perfect Apology ——
    ,{ id: 'seed_mc15_voucher', content: 'voucher', meaning: 'n. 代金券；票券', type: 'word', ph: '/ˈvaʊtʃər/', level: 'B2' }
    ,{ id: 'seed_mc15_compensate', content: 'compensate', meaning: 'v. 补偿；赔偿', type: 'word', ph: '/ˈkɒmpenseɪt/', level: 'B2' }
    ,{ id: 'seed_mc15_malfunction', content: 'technical malfunction', meaning: 'n. 技术故障', type: 'word', ph: '/ˈteknɪkl mælˈfʌŋkʃn/', level: 'B2' }
    ,{ id: 'seed_mc15_furious', content: 'furious', meaning: 'adj. 狂怒的；暴怒的', type: 'word', ph: '/ˈfjʊəriəs/', level: 'B2' }
    ,{ id: 'seed_mc15_frustration', content: 'frustration', meaning: 'n. 挫败感；沮丧', type: 'word', ph: '/frʌsˈtreɪʃn/', level: 'B2' }
    ,{ id: 'seed_mc15_deserve', content: 'deserve', meaning: 'v. 应得；值得', type: 'word', ph: '/dɪˈzɜːv/', level: 'B2' }
    ,{ id: 'seed_mc15_heartfelt', content: 'heartfelt', meaning: 'adj. 由衷的；真诚的', type: 'word', ph: '/ˈhɑːrtfelt/', level: 'B2' }
    ,{ id: 'seed_mc15_thorn', content: 'thorn', meaning: 'n. 荆棘；刺', type: 'word', ph: '/θɔːn/', level: 'B2' }
    ,{ id: 'seed_mc15_dedication', content: 'dedication', meaning: 'n. 奉献；敬业精神', type: 'word', ph: '/ˌdedɪˈkeɪʃn/', level: 'B2' }
    ,{ id: 'seed_mc15_promotion', content: 'promotion', meaning: 'n. 晋升；促销', type: 'word', ph: '/prəˈməʊʃn/', level: 'B2' }
    ,{ id: 'seed_mc15_memorial', content: 'memorial', meaning: 'n. 纪念碑；纪念仪式 adj. 纪念的', type: 'word', ph: '/məˈmɔːriəl/', level: 'B2' }
    ,{ id: 'seed_mc15_departed', content: 'departed', meaning: 'adj. 已故的；过去的', type: 'word', ph: '/dɪˈpɑːtɪd/', level: 'B2' }
    ,{ id: 'seed_mc15_complicated', content: 'complicated', meaning: 'adj. 复杂的', type: 'word', ph: '/ˈkɒmplɪkeɪtɪd/', level: 'B2' }
    ,{ id: 'seed_mc15_struggle', content: 'struggle', meaning: 'v. 挣扎；努力 n. 奋斗', type: 'word', ph: '/ˈstrʌɡl/', level: 'B2' }
    ,{ id: 'seed_mc15_nominate', content: 'nominate', meaning: 'v. 提名；任命', type: 'word', ph: '/ˈnɒmɪneɪt/', level: 'B2' }
    // MC15 白板短语
    ,{ id: 'seed_mc15_rebook', content: 'rebook / reschedule another flight', meaning: '重新预订/改签另一班航班', type: 'phrase', level: 'B2' }
    ,{ id: 'seed_mc15_terminal', content: 'stay in the terminal / lounge / board area', meaning: '待在航站楼/休息室/登机区', type: 'phrase', level: 'B2' }
    ,{ id: 'seed_mc15_overnight', content: 'stay overnight at a hotel', meaning: '在酒店过夜', type: 'phrase', level: 'B2' }
    ,{ id: 'seed_mc15_update', content: 'provide an update', meaning: '提供最新消息/进展更新', type: 'phrase', level: 'B2' }
    ,{ id: 'seed_mc15_makeup', content: 'make it up to you', meaning: '弥补你/补偿你（做某事来补偿）', type: 'phrase', level: 'B2' }
    ,{ id: 'seed_mc15_treat', content: 'treat sb. to dinner', meaning: '请某人吃晚餐', type: 'phrase', level: 'B2' }
    ,{ id: 'seed_mc15_snowstorm', content: 'be hit by huge snowstorm', meaning: '遭到暴风雪袭击', type: 'phrase', level: 'B2' }
    ,{ id: 'seed_mc15_grounded', content: 'cause flights to be delayed / grounded', meaning: '导致航班延误/停飞', type: 'phrase', level: 'B2' }
    ,{ id: 'seed_mc15_letdown', content: 'let sb. down', meaning: '让某人失望', type: 'phrase', level: 'B2' }
    ,{ id: 'seed_mc15_outline', content: 'out of line', meaning: '出格；越界；不当', type: 'phrase', level: 'B2' }
    // MC15 make-up 系列短语
    ,{ id: 'seed_mc15_makeupto', content: 'make up to sb', meaning: '巴结讨好某人（to后接人，带有目的性去讨好）', type: 'phrase', level: 'B2' }
    ,{ id: 'seed_mc15_makeupfor', content: 'make up for sth', meaning: '弥补补偿某事（for后接事物/行为）', type: 'phrase', level: 'B2' }
    ,{ id: 'seed_mc15_makeupwith', content: 'make up with sb', meaning: '和解和好某人（with后接人，重归于好）', type: 'phrase', level: 'B2' }
    // MC15 其他搭配
    ,{ id: 'seed_mc15_speech', content: 'deliver a speech', meaning: '发表演讲', type: 'phrase', level: 'B2' }
    ,{ id: 'seed_mc15_memservice', content: 'memorial service', meaning: '纪念仪式', type: 'phrase', level: 'B2' }
    ,{ id: 'seed_mc15_gratitude', content: 'deep gratitude', meaning: '深深的感激', type: 'phrase', level: 'B2' }
    ,{ id: 'seed_mc15_heartfelt2', content: 'heartfelt thanks / sympathy', meaning: '由衷的感谢/同情', type: 'phrase', level: 'B2' }
    ,{ id: 'seed_mc15_sensefrust', content: 'a sense of frustration', meaning: '挫败感', type: 'phrase', level: 'B2' }
    ,{ id: 'seed_mc15_strugglewith', content: 'struggle with sth', meaning: '在某事上挣扎/苦苦应对', type: 'phrase', level: 'B2' }
    ,{ id: 'seed_mc15_nominated', content: 'be nominated for', meaning: '被提名为…', type: 'phrase', level: 'B2' }
    // MC15 原句
    ,{ id: 'seed_mc15_sent0', content: 'The flight was delayed because we were hit by a huge snowstorm.', meaning: '航班延误了，因为我们遭到了暴风雪袭击。', type: 'sentence', level: 'B2' }
    ,{ id: 'seed_mc15_sent1', content: 'We had to stay overnight at a hotel near the airport.', meaning: '我们不得不在机场附近的酒店过夜。', type: 'sentence', level: 'B2' }
    ,{ id: 'seed_mc15_sent2', content: 'I know this is frustrating, but we will make it up to you.', meaning: '我知道这很令人沮丧，但我们会补偿你的。', type: 'sentence', level: 'B2' }
    ,{ id: 'seed_mc15_sent3', content: 'The airline will provide an update as soon as possible.', meaning: '航空公司会尽快提供最新消息。', type: 'sentence', level: 'B2' }
    ,{ id: 'seed_mc15_sent4', content: "I don't want to let you down, so I will treat you to dinner.", meaning: '我不想让你失望，所以我请你吃晚餐。', type: 'sentence', level: 'B2' }
    // MC15 make-up 讲义例句
    ,{ id: 'seed_mc15_sent5', content: 'He always tries to make up to his boss.', meaning: '他总是试图巴结讨好老板。', type: 'sentence', level: 'B2' }
    ,{ id: 'seed_mc15_sent6', content: 'I want to make up for my mistake.', meaning: '我想弥补我的错误。', type: 'sentence', level: 'B2' }
    ,{ id: 'seed_mc15_sent7', content: 'They finally made up with each other.', meaning: '他们终于和解和好了。', type: 'sentence', level: 'B2' }
    ,{ id: 'seed_mc15_sent8', content: 'This gift is to make up for the inconvenience.', meaning: '这份礼物是为了弥补不便。', type: 'sentence', level: 'B2' }
    // MC15 选词填空句
    ,{ id: 'seed_mc15_sent9', content: 'The passengers were furious about the technical malfunction.', meaning: '乘客们对技术故障感到狂怒。', type: 'sentence', level: 'B2' }
    ,{ id: 'seed_mc15_sent10', content: 'She deserved a heartfelt apology from the airline.', meaning: '她应得航空公司由衷的道歉。', type: 'sentence', level: 'B2' }
    ,{ id: 'seed_mc15_sent11', content: 'The airline offered a voucher to compensate for the delay.', meaning: '航空公司提供了一张代金券来补偿延误。', type: 'sentence', level: 'B2' }
    // MC15 汉译英
    ,{ id: 'seed_mc15_sent12', content: 'We waited at the airport for 11 hours because the snowstorm caused all flights to be grounded.', meaning: '我们在机场等了11个小时，因为暴风雪导致所有航班停飞。', type: 'sentence', level: 'B2' }
    // MC15 语法要点
    ,{ id: 'seed_mc15_grammar1', content: 'Past Perfect 过去完成时', meaning: 'had + 过去分词，表示过去某时间点之前已完成的动作。例：The flight had already left when we arrived.', type: 'grammar', level: 'B2', noTest: true }
    ,{ id: 'seed_mc15_grammar2', content: 'Relative clause with who', meaning: 'who 引导修饰人的定语从句。例：The passenger who was furious demanded a refund.', type: 'grammar', level: 'B2', noTest: true }
    ,{ id: 'seed_mc15_grammar3', content: 'had to + verb', meaning: 'had to + 动词原形，表示过去被迫/必须做某事。例：We had to stay overnight at a hotel.', type: 'grammar', level: 'B2', noTest: true }
    ,{ id: 'seed_mc15_grammar4', content: 'Reported speech tense backshift', meaning: '间接引语时态倒退：直接引语变间接引语时，时态往过去倒退一级。例："I am sorry" → He said he was sorry.', type: 'grammar', level: 'B2', noTest: true }
    ,{ id: 'seed_mc15_grammar5', content: 'Present participle as adverbial', meaning: '现在分词(v-ing)作伴随状语，表示同时发生的伴随动作。例：She stood at the gate, waiting for an update.', type: 'grammar', level: 'B2', noTest: true }
    ,{ id: 'seed_mc15_grammar6', content: 'Fixed preposition collocations', meaning: '固定搭配介词：compensate for（补偿某事）、frustrated with（对…沮丧）。例：They compensated us for the delay.', type: 'grammar', level: 'B2', noTest: true }
    ,{ id: 'seed_mc15_grammar7', content: 'Noun meaning distinction', meaning: '名词词义区分：frustration（挫败感）vs disappointment（失望）。例：Her frustration turned into anger.', type: 'grammar', level: 'B2', noTest: true }
    ,{ id: 'seed_mc15_grammar8', content: 'Third person singular', meaning: '三单变形：一般现在时主语第三人称单数，动词加 -s/-es。例：The airline provides regular updates.', type: 'grammar', level: 'B2', noTest: true }
    ,{ id: 'seed_mc15_grammar9', content: 'make up for + noun', meaning: 'make up for + 名词/动名词，固定搭配"弥补某事物"。例：We will make up for the inconvenience.', type: 'grammar', level: 'B2', noTest: true }
    ,{ id: 'seed_mc15_grammar10', content: 'Writing format for apology letters', meaning: '正式道歉信格式：Dear + 称呼，正文，Yours sincerely + 署名。注意标点、大小写、分段规范。', type: 'grammar', level: 'B2', noTest: true }
    // MC15 记忆口诀
    ,{ id: 'seed_mc15_mnemonic', content: 'make up 记忆口诀', meaning: 'to后接人去讨好，for后接事做补偿，with接人是和好。make up to sb（巴结讨好），make up for sth（弥补补偿），make up with sb（和解和好）。', type: 'grammar', level: 'B2', noTest: true }
,
    // —— MC34 白板补充2（旅行期待 / 核心词汇 / 愿望清单 / 第一条件句）——
    ,{ id: 'seed_mc34w2_mountain', content: 'mountain', meaning: 'n. 山', type: 'word', ph: '/ˈmaʊntən/', level: 'B2' }
    ,{ id: 'seed_mc34w2_everest', content: 'Mount Everest', meaning: 'n. 珠穆朗玛峰（世界最高峰）', type: 'word', ph: '/ˌmaʊnt ˈevərɪst/', level: 'B2' }
    ,{ id: 'seed_mc34w2_himalayas', content: 'the Himalayas', meaning: 'n. 喜马拉雅山脉', type: 'word', ph: '/ðə ˌhɪməˈleɪəz/', level: 'B2' }
    ,{ id: 'seed_mc34w2_hiking', content: 'hiking', meaning: 'n. 徒步（休闲/短途步行旅行）', type: 'word', ph: '/ˈhaɪkɪŋ/', level: 'B2' }
    ,{ id: 'seed_mc34w2_wellness', content: 'wellness travel', meaning: 'n. 康养旅行（以健康、水疗、放松为目的的旅行）', type: 'word', level: 'B2' }
    ,{ id: 'seed_mc34w2_roadtrip', content: 'roadtrip', meaning: 'n. 公路旅行（自驾沿途露营/住宿）', type: 'word', ph: '/ˈrəʊdtrɪp/', level: 'B2' }
    ,{ id: 'seed_mc34w2_ostrich', content: 'ostrich', meaning: 'n. 鸵鸟', type: 'word', ph: '/ˈɒstrɪtʃ/', level: 'B2' }
    ,{ id: 'seed_mc34w2_oxygen', content: 'oxygen tank', meaning: 'n. 氧气瓶（高海拔/水下呼吸用）', type: 'word', level: 'B2' }
    ,{ id: 'seed_mc34w2_env', content: 'environmentalists', meaning: 'n. 环保主义者（致力于保护环境的人）', type: 'word', ph: '/ɪnˌvaɪrənˈmentəlɪsts/', level: 'B2' }
    ,{ id: 'seed_mc34w2_palace', content: 'palace', meaning: 'n. 宫殿（国王/女王等居住的宏伟建筑）', type: 'word', ph: '/ˈpæləs/', level: 'B2' }
    ,{ id: 'seed_mc34w2_impulsive', content: 'impulsive', meaning: 'adj. 冲动的（凭一时冲动行事的）', type: 'word', ph: '/ɪmˈpʌlsɪv/', level: 'B2' }
    ,{ id: 'seed_mc34w2_minor', content: 'minor problem', meaning: '小问题（minor = 较小的、次要的）', type: 'phrase', ph: '/ˈmaɪnə(r)/', level: 'B2' }
    // 旅行期待表达
    ,{ id: 'seed_mc34w2_localcuisine', content: 'to eat the local cuisine', meaning: '品尝当地美食', type: 'phrase', level: 'B2' }
    ,{ id: 'seed_mc34w2_tradact', content: 'to experience traditional activities', meaning: '体验传统活动', type: 'phrase', level: 'B2' }
    ,{ id: 'seed_mc34w2_arch', content: 'to see different architecture', meaning: '看不同的建筑（风格）', type: 'phrase', level: 'B2' }
    // 人生愿望清单
    ,{ id: 'seed_mc34w2_once', content: 'once-in-a-lifetime', meaning: 'adj. 一生一次的（极其难得）', type: 'phrase', level: 'B2' }
    ,{ id: 'seed_mc34w2_lottery', content: 'win a lottery', meaning: '中彩票', type: 'phrase', level: 'B2' }
    ,{ id: 'seed_mc34w2_birth', content: 'give birth', meaning: '生孩子', type: 'phrase', level: 'B2' }
    ,{ id: 'seed_mc34w2_perfect', content: 'Mr / Mrs Perfect', meaning: '完美先生 / 完美女士（理想伴侣）', type: 'phrase', level: 'B2' }
    // 句子
    ,{ id: 'seed_mc34w2_sent1', content: 'If you study, you will pass the exam.', meaning: '如果你学习，你就会通过考试。', type: 'sentence', level: 'B2' }
    ,{ id: 'seed_mc34w2_sent2', content: 'If it rains tomorrow, we may cancel the picnic.', meaning: '如果明天下雨，我们可能取消野餐。', type: 'sentence', level: 'B2' }
    ,{ id: 'seed_mc34w2_sent3', content: 'If you prefer snow, you can try skiing.', meaning: '如果你喜欢雪，你可以尝试滑雪。', type: 'sentence', level: 'B2' }
    ,{ id: 'seed_mc34w2_sent4', content: 'Voluntourism is a once-in-a-lifetime experience.', meaning: '志愿者旅游是一生一次的经历。', type: 'sentence', level: 'B2' }
    // 语法（不进选择题）
    ,{ id: 'seed_mc34w2_g1', content: 'First Conditional 第一条件句', meaning: 'if + 一般现在时，主句用 can/will/may/might + 动词原形；谈论我们认为真实或可能的未来情况。例：If you study, you will pass.', type: 'grammar', level: 'B2', noTest: true }
    ,{ id: 'seed_mc34w2_g2', content: 'First Conditional 易错点', meaning: '① if 从句用一般现在时，不能用 will（❌ If you will study…）；② 主语三单动词加 -s（it rains）；③ 主句四个情态动词 can/will/may/might，不混用 should。', type: 'grammar', level: 'B2', noTest: true }

  
    // —— MC34 白板补充3（核心词汇 / 特色旅行 / 动物自然 / 装备 / 环境文明 / 愿望清单 / 第一条件句）——
    ,{ id: 'seed_mc34w3_trekking', content: 'trekking', meaning: 'n. 徒步旅行，长途跋涉（多日、野外）', type: 'word', ph: '/ˈtrekɪŋ/', level: 'B2' }
    ,{ id: 'seed_mc34w3_safari', content: 'safari', meaning: 'n. 游猎之旅（在非洲观赏/拍摄野生动物的旅行）', type: 'word', ph: '/səˈfɑːri/', level: 'B2' }
    ,{ id: 'seed_mc34w3_sandboarding', content: 'sandboarding', meaning: 'n. 滑沙运动', type: 'word', ph: '/ˈsændbɔːdɪŋ/', level: 'B2' }
    ,{ id: 'seed_mc34w3_waterrafting', content: 'water rafting', meaning: 'n. 激流漂流', type: 'word', level: 'B2' }
    ,{ id: 'seed_mc34w3_antarctica', content: 'Antarctica', meaning: 'n. 南极洲', type: 'word', ph: '/ænˈtɑːktɪkə/', level: 'B2' }
    ,{ id: 'seed_mc34w3_penguins', content: 'penguins', meaning: 'n. 企鹅（复数）', type: 'word', ph: '/ˈpeŋɡwɪnz/', level: 'B2' }
    ,{ id: 'seed_mc34w3_igloo', content: 'igloo', meaning: 'n. 冰屋（因纽特人用硬雪建造的圆形房屋）', type: 'word', ph: '/ˈɪɡluː/', level: 'B2' }
    ,{ id: 'seed_mc34w3_civilization', content: 'civilization', meaning: 'n. 文明（有自己政府和许多组织的发达社会）', type: 'word', ph: '/ˌsɪvəlaɪˈzeɪʃn/', level: 'B2' }
    ,{ id: 'seed_mc34w3_exotic', content: 'exotic', meaning: 'adj. 异国情调的（来自异国、不同寻常且令人兴奋的事物）', type: 'word', ph: '/ɪɡˈzɒtɪk/', level: 'B2' }
    ,{ id: 'seed_mc34w3_sporty', content: 'sporty', meaning: 'adj. 爱好运动的，健壮的（体格健壮、非常健康）', type: 'word', ph: '/ˈspɔːti/', level: 'B2' }
    ,{ id: 'seed_mc34w3_accommodation', content: 'accommodation', meaning: 'n. 住宿（可以居住或停留的不同场所）', type: 'word', ph: '/əˌkɒməˈdeɪʃn/', level: 'B2' }
    ,{ id: 'seed_mc34w3_marriage', content: 'marriage', meaning: 'n. 婚姻，结婚', type: 'word', ph: '/ˈmærɪdʒ/', level: 'B2' }
    ,{ id: 'seed_mc34w3_studyuni', content: 'study university', meaning: '上大学（求学）', type: 'phrase', level: 'B2' }
    ,{ id: 'seed_mc34w3_architecture', content: 'architecture', meaning: 'n. 建筑，建筑风格', type: 'word', ph: '/ˈɑːkɪtektʃə(r)/', level: 'B2' }
    ,{ id: 'seed_mc34w3_sent1', content: 'If you prefer snow, you can try skiing or snowboarding in the Alps.', meaning: '如果你更喜欢冰雪，你可以去阿尔卑斯山尝试滑雪或单板滑雪。', type: 'sentence', level: 'B2' }
    ,{ id: 'seed_mc34w3_sent2', content: 'Voluntourism is a tour where travellers do voluntary work to help local people.', meaning: '义工旅行是旅行者做志愿工作帮助当地人的旅行。', type: 'sentence', level: 'B2' }
    ,{ id: 'seed_mc34w3_sent3', content: 'If the weather is good, we will go hiking.', meaning: '如果天气好，我们会去徒步。', type: 'sentence', level: 'B2' }
    ,{ id: 'seed_mc34w3_g1', content: 'First Conditional 易错点', meaning: '① if 从句用一般现在时，不用 will（❌ If it will rain…）；② 主语三单动词加 -s（it rains / she studies）；③ 主句四个情态动词 will / can / may / might。', type: 'grammar', level: 'B2', noTest: true }
  /* INJECT-MC34-WB3-KB */
    // —— MC13 白板补充（I Think We Would Really Click｜描述朋友结识新朋友）——
    ,{ id: 'seed_mc13wb_click', content: 'click', meaning: 'v.（与某人）一拍即合、合得来（形容投缘）', type: 'word', ph: '/klɪk/', level: 'B2' }
    ,{ id: 'seed_mc13wb_getalong', content: 'get along', meaning: 'phr. 相处融洽，合得来', type: 'phrase', level: 'B2' }
    ,{ id: 'seed_mc13wb_hititoff', content: 'hit it off', meaning: 'phr.（初次见面就）投缘、合得来（固定搭配，hit 不接宾语拆分）', type: 'phrase', level: 'B2' }
    ,{ id: 'seed_mc13wb_twopeas', content: 'two peas in a pod', meaning: 'phr. 一模一样、非常合得来的一对（形容极其相像/投缘）', type: 'phrase', level: 'B2' }
    ,{ id: 'seed_mc13wb_compatible', content: 'compatible', meaning: 'adj. 合得来的；兼容的（别与 comparable 比较的 混淆）', type: 'word', ph: '/kəmˈpætəbl/', level: 'B2' }
    ,{ id: 'seed_mc13wb_enthusiastic', content: 'enthusiastic', meaning: 'adj. 热情的、热心的', type: 'word', ph: '/ɪnˌθjuːziˈæstɪk/', level: 'B2' }
    ,{ id: 'seed_mc13wb_incredibly', content: 'incredibly', meaning: 'adv. 极其、难以置信地（程度副词，修饰形容词：incredibly kind）', type: 'word', level: 'B2' }
    // 句型（不进选择题）
    ,{ id: 'seed_mc13wb_s1', content: 'I would like to introduce my classmate/friend to you, [name].', meaning: '我想向你介绍我的同学/朋友，[名字]。', type: 'sentence', level: 'B2', noTest: true }
    ,{ id: 'seed_mc13wb_s2', content: 'I think I would really click with him because we share the same hobbies.', meaning: '我觉得我和他真的很合得来，因为我们有相同的爱好。', type: 'sentence', level: 'B2', noTest: true }
    ,{ id: 'seed_mc13wb_s3', content: 'We wouldn\'t click at all because we have totally different personalities.', meaning: '我们一点都不合得来，因为性格完全不同。', type: 'sentence', level: 'B2', noTest: true }
    ,{ id: 'seed_mc13wb_s4', content: 'That\'s all, thank you for listening.', meaning: '我的介绍完了，谢谢大家聆听。', type: 'sentence', level: 'B2', noTest: true }
    // 语法（不进选择题）
    ,{ id: 'seed_mc13wb_g1', content: '描述他人：性格用 be + adj.，外貌/爱好用 have + n.，穿着用 wear / be in + 衣服', meaning: '例：He is reliable and easy-going.（性格）He has short black hair.（外貌）He is in a blue suit.（穿着）。注意 tall 形容人高，high 形容物高。', type: 'grammar', level: 'B2', noTest: true }
    ,{ id: 'seed_mc13wb_g2', content: 'MC13 易错复盘', meaning: '① hit it off 是固定短语，不可拆开（❌ hit off with him）；② compatible 合得来的 ≠ comparable 可比较的；③ 形容人高用 tall，形容物/山高用 high；④ 穿着用 wear / be in，不用 with；⑤ 形容词前加程度副词 incredibly/very/quite/somewhat/slightly。', type: 'grammar', level: 'B2', noTest: true }
    // —— MC18 白板补充（Carnival Time｜狂欢节节日文化）——
    ,{ id: 'seed_mc18wb_ethnic', content: 'ethnic', meaning: 'adj. 民族的、种族的（ethnic groups 民族群体）', type: 'word', ph: '/ˈeθnɪk/', level: 'B2' }
    ,{ id: 'seed_mc18wb_rejoicing', content: 'rejoicing', meaning: 'n. 欢庆、喜悦（rejoice 的名词形式）', type: 'word', ph: '/rɪˈdʒɔɪsɪŋ/', level: 'B2' }
    ,{ id: 'seed_mc18wb_flamboyant', content: 'flamboyant', meaning: 'adj. 华丽的、张扬的（形容服饰/表演夺目）', type: 'word', ph: '/flæmˈbɔɪənt/', level: 'B2' }
    ,{ id: 'seed_mc18wb_passionate', content: 'passionate', meaning: 'adj. 热情的、充满激情的', type: 'word', ph: '/ˈpæʃənət/', level: 'B2' }
    ,{ id: 'seed_mc18wb_streamer', content: 'streamer', meaning: 'n. 彩带、飘带（节日装饰用）', type: 'word', ph: '/ˈstriːmə(r)/', level: 'B2' }
    ,{ id: 'seed_mc18wb_unbelievable', content: 'unbelievable', meaning: 'adj. 难以置信的、惊人的', type: 'word', ph: '/ˌʌnbɪˈliːvəbl/', level: 'B2' }
    ,{ id: 'seed_mc18wb_recommend', content: 'recommend', meaning: 'v. 推荐（recommend sb. sth. / recommend sth. to sb.）', type: 'word', ph: '/ˌrekəˈmend/', level: 'B2' }
    // 必背搭配（不进拼写，进手册）
    ,{ id: 'seed_mc18wb_p1', content: 'book a hotel room', meaning: '预订酒店房间', type: 'phrase', level: 'B2' }
    ,{ id: 'seed_mc18wb_p2', content: 'in advance', meaning: '提前、事先（房间/票很快订满，要提前订）', type: 'phrase', level: 'B2' }
    ,{ id: 'seed_mc18wb_p3', content: 'fill up really quickly', meaning: '（房间/票）很快就订满', type: 'phrase', level: 'B2' }
    ,{ id: 'seed_mc18wb_p4', content: 'all over Brazil', meaning: '全巴西各地', type: 'phrase', level: 'B2' }
    ,{ id: 'seed_mc18wb_p5', content: 'dance the samba', meaning: '跳桑巴舞', type: 'phrase', level: 'B2' }
    ,{ id: 'seed_mc18wb_p6', content: 'annual Carnival', meaning: '一年一度的狂欢节', type: 'phrase', level: 'B2' }
    // 句型（不进选择题）
    ,{ id: 'seed_mc18wb_s1', content: 'Carnival in Rio is really something.', meaning: '里约的狂欢节真的很了不起。', type: 'sentence', level: 'B2', noTest: true }
    ,{ id: 'seed_mc18wb_s2', content: 'The Carnival in Rio takes place every year before Lent.', meaning: '里约狂欢节每年大斋节前举行。', type: 'sentence', level: 'B2', noTest: true }
    ,{ id: 'seed_mc18wb_s3', content: 'People dance the samba in the streets during Carnival.', meaning: '狂欢节期间人们在街上跳桑巴舞。', type: 'sentence', level: 'B2', noTest: true }
    // 语法（不进选择题）
    ,{ id: 'seed_mc18wb_g1', content: '时间定语从句（when）', meaning: '修饰表示时间的先行词（the day / the time / Carnival）时用 when 引导定语从句，when = 介词 + which，在从句中作时间状语。例：Carnival is a time (when) people celebrate together.', type: 'grammar', level: 'B2', noTest: true }
    ,{ id: 'seed_mc18wb_g2', content: 'MC18 易错复盘', meaning: '① recommend 后接 doing 或 sb. sth.，不接 that 从句虚拟（口语少用）；② in advance 固定搭配，advance 不加 s；③ 被动 be celebrated / be held / be decorated；④ last 作动词意为“持续”（The festival lasts a week.），不作形容词“最后的”误用；⑤ costume 服饰 ≠ custom 习俗。', type: 'grammar', level: 'B2', noTest: true }
    // MC18 补充：way 作口语程度副词 + way in advance
    ,{ id: 'seed_mc18wb_p7', content: 'way in advance', meaning: 'phr. 远远提前、提前很久（way 作口语程度副词，= far / much，强调提前的时间很长；对比 in advance 只是“提前”）', type: 'phrase', level: 'B2' }
    ,{ id: 'seed_mc18wb_wayadv', content: 'way (adverb of degree)', meaning: '口语中 way 可作程度副词，意为 far / much（远远、大大、非常），用来加强语气：way in advance = 提前很久；way better = 好得多；way more expensive = 贵得多。此用法非正式口语，书面慎用。', type: 'grammar', level: 'B2', noTest: true }
    // —— MC40 白板补充（When Work Ends｜职场落幕 / 解雇场景）——
    ,{ id: 'seed_mc40wb_fire', content: 'fire', meaning: 'v. 解雇（职场：He was fired.）', type: 'word', ph: '/ˈfaɪə(r)/', level: 'B2' }
    ,{ id: 'seed_mc40wb_sack', content: 'sack', meaning: 'v.【英口语】解雇（They sacked him.）', type: 'word', ph: '/sæk/', level: 'B2' }
    ,{ id: 'seed_mc40wb_dismiss', content: 'dismiss', meaning: 'v. 免职，遣散（较正式：He was dismissed for poor performance.）', type: 'word', ph: '/dɪsˈmɪs/', level: 'B2' }
    ,{ id: 'seed_mc40wb_colleague', content: 'colleague', meaning: 'n. 同事', type: 'word', ph: '/ˈkɒliːɡ/', level: 'B2' }
    ,{ id: 'seed_mc40wb_cooperate', content: 'cooperate', meaning: 'v. 合作，协作', type: 'word', ph: '/kəʊˈɒpəreɪt/', level: 'B2' }
    ,{ id: 'seed_mc40wb_corporate', content: 'corporate', meaning: 'adj. 公司的；企业的', type: 'word', ph: '/ˈkɔːpərət/', level: 'B2' }
    ,{ id: 'seed_mc40wb_compensation', content: 'compensation', meaning: 'n. 补偿金，赔偿（职场：severance compensation 解雇赔偿）', type: 'word', ph: '/ˌkɒmpenˈseɪʃn/', level: 'B2' }
    ,{ id: 'seed_mc40wb_shadow', content: 'shadow', meaning: 'v. 跟班学习，跟随观摩（职场：shadow someone 跟着某人见习）', type: 'word', ph: '/ˈʃædəʊ/', level: 'B2' }
    ,{ id: 'seed_mc40wb_petrol', content: 'petrol', meaning: 'n.【英】汽油（美式 gas / gasoline）', type: 'word', ph: '/ˈpetrəl/', level: 'B2' }
    ,{ id: 'seed_mc40wb_overestimate', content: 'overestimate', meaning: 'v. 高估（前缀 over- 表过度）', type: 'word', ph: '/ˌəʊvərˈestɪmeɪt/', level: 'B2' }
    ,{ id: 'seed_mc40wb_underrated', content: 'underrated', meaning: 'adj. 被低估的（前缀 under- 表不足）', type: 'word', ph: '/ˌʌndəˈreɪtɪd/', level: 'B2' }
    ,{ id: 'seed_mc40wb_overrated', content: 'overrated', meaning: 'adj. 被高估的（前缀 over- 表过度）', type: 'word', ph: '/ˌəʊvərˈreɪtɪd/', level: 'B2' }
    ,{ id: 'seed_mc40wb_upset', content: 'upset', meaning: 'adj. 难过的，不高兴的（I was upset or something.）', type: 'word', ph: '/ʌpˈset/', level: 'B2' }
    ,{ id: 'seed_mc40wb_letgo', content: 'let go', meaning: 'phr.（被）辞退，放走（较委婉，常指裁员）', type: 'phrase', level: 'B2' }
    ,{ id: 'seed_mc40wb_shadowsomeone', content: 'shadow someone', meaning: 'phr. 跟着某人跟班学习、观摩工作', type: 'phrase', level: 'B2' }
    ,{ id: 'seed_mc40wb_intransition', content: 'in transition', meaning: 'phr. 处于过渡期', type: 'phrase', level: 'B2' }
    ,{ id: 'seed_mc40wb_transitionperiod', content: 'transition period', meaning: 'phr. 过渡阶段', type: 'phrase', level: 'B2' }
    ,{ id: 'seed_mc40wb_abuck', content: 'a buck', meaning: 'phr. 一美元（美/澳/新口语）', type: 'phrase', level: 'B2' }
    ,{ id: 'seed_mc40wb_dole', content: 'be on the dole', meaning: 'phr.【英式口语】领失业救济金', type: 'phrase', level: 'B2' }
    ,{ id: 'seed_mc40wb_treatmeal', content: 'treat sb to a meal', meaning: 'phr. 请客吃饭（treat sb to sth 款待某人）', type: 'phrase', level: 'B2' }
    ,{ id: 'seed_mc40wb_g1', content: 'treat 一词多义', meaning: 'treat sb (with respect) 对待；treat sb to sth 请客；treat (n.) 乐事。语境决定含义，别把“对待”和“请客”混淆。', type: 'grammar', level: 'B2', noTest: true }
    ,{ id: 'seed_mc40wb_g2', content: 'under-/over- 前缀', meaning: 'under- 表不足：underestimate 低估 / underrated 被低估的；over- 表过度：overestimate 高估 / overrated 被高估的。成对记忆。', type: 'grammar', level: 'B2', noTest: true }
    ,{ id: 'seed_mc40wb_g3', content: 'get to be + adj.', meaning: '到头来变得……（强调经过一段时间后最终进入某种状态）：He got to be the boss. 他到头来成了经理。', type: 'grammar', level: 'B2', noTest: true }
    ,{ id: 'seed_mc40wb_g4', content: '口语缩写 gonna / cos', meaning: 'gonna = going to（将要）；cos = because（因为）。均为非正式口语写法，书面/正式场合用完整形式。', type: 'grammar', level: 'B2', noTest: true }
    ,{ id: 'seed_mc40wb_g5', content: '解雇同义辨析 fire / sack / let go / dismiss', meaning: 'fire 最通用；sack【英口语】解雇；dismiss 较正式（免职/遣散）；let go 更委婉（常指裁员）。四者都可表“解雇”。', type: 'grammar', level: 'B2', noTest: true }
    ,{ id: 'seed_mc40wb_g6', content: 'or something（句尾口语短语）', meaning: '三大场景：①不确定确切事物 ②缓和语气/让说法更随意 ③淡化刚才所说。永远加在句末，使表达不精确、更轻松非正式。', type: 'grammar', level: 'B2', noTest: true }
    ,{ id: 'seed_mc40wb_s1', content: 'Let me treat you to a meal to say thanks.', meaning: '我请你吃顿饭表示感谢。', type: 'sentence', level: 'B2', noTest: true }
    ,{ id: 'seed_mc40wb_s2', content: 'She was dismissed for being late too often.', meaning: '她因为经常迟到被解雇了。', type: 'sentence', level: 'B2', noTest: true }
    ,{ id: 'seed_mc40wb_s3', content: 'After losing his job, he was on the dole for months.', meaning: '失业后他领了几个月救济金。', type: 'sentence', level: 'B2', noTest: true }
      ,{ id: "seed_mc31b_casual", content: "casual", meaning: "休闲的，随意的", type: "word", ph: "/ˈkæʒuəl/", level: "B2" }
    ,{ id: "seed_mc31b_suburb", content: "suburb", meaning: "郊区", type: "word", ph: "/ˈsʌbɜːb/", level: "B2" }
    ,{ id: "seed_mc31b_relaunch", content: "relaunch", meaning: "重新推出，以新方式重启", type: "word", ph: "/ˌriːˈlɔːntʃ/", level: "B2" }
    ,{ id: "seed_mc31b_collection", content: "collection", meaning: "系列（一批相关商品）", type: "word", ph: "/kəˈlekʃn/", level: "B2" }
    ,{ id: "seed_mc31b_consultant", content: "consultant", meaning: "顾问", type: "word", ph: "/kənˈsʌltənt/", level: "B2" }
    ,{ id: "seed_mc31b_profit", content: "profit", meaning: "利润", type: "word", ph: "/ˈprɒfɪt/", level: "B2" }
    ,{ id: "seed_mc31b_casual_clothes", content: "casual clothes", meaning: "休闲服饰", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_mc31b_near___outside_the_city", content: "near / outside the city", meaning: "在城市周边 / 城外", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_mc31b_go_on_sale", content: "go on sale", meaning: "上市开售", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_mc31b_for_sale", content: "for sale", meaning: "待售（可购买）", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_mc31b_aim_to_do", content: "aim to do", meaning: "力求；目标是", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_mc31b_g_aim_to___one", content: "aim to = one’s goal is to（同义句型转换）", meaning: "aim to do（动词短语）≈ one’s goal is to do（名词句型）。例：The brand aims to expand. = The brand’s goal is to expand.", type: "grammar", ph: "", level: "B2", noTest: true }
    ,{ id: "seed_mc32b_postpone", content: "postpone", meaning: "推迟", type: "word", ph: "/pəˈspəʊn/", level: "B2" }
    ,{ id: "seed_mc32b_agenda", content: "agenda", meaning: "会议议程", type: "word", ph: "/əˈdʒendə/", level: "B2" }
    ,{ id: "seed_mc32b_updated", content: "updated", meaning: "更新的，最新的", type: "word", ph: "/ʌpˈdeɪtɪd/", level: "B2" }
    ,{ id: "seed_mc32b_invite", content: "invite", meaning: "邀请；招致（麻烦、危险）｜n. invitation 邀请函", type: "word", ph: "/ɪnˈvaɪt/", level: "B2" }
    ,{ id: "seed_mc32b_decide_to", content: "decide to", meaning: "决定去做", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_mc32b_at_a_later_time", content: "at a later time", meaning: "在晚些时候", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_mc32b_put_off", content: "put off", meaning: "推迟（=postpone）", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_mc32b_postpone_sth___doing_sth", content: "postpone sth / doing sth", meaning: "推迟某事 / 推迟做某事", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_mc32b_postpone_sth_until___to_", content: "postpone sth until / to…", meaning: "将某事推迟至……", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_mc32b_bring___forward_to", content: "bring … forward to", meaning: "把（时间）提前至……", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_mc32b_on_the_agenda", content: "on the agenda", meaning: "列入议程", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_mc32b_top_of_the_agenda", content: "top of the agenda", meaning: "首要议程", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_mc32b_look_forward_to_doing", content: "look forward to doing", meaning: "期待做某事（to 是介词，后接 doing / 名词）", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_mc32b_invite_sb_to_sp", content: "invite sb to sp", meaning: "邀请某人去某地", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_mc32b_invite_trouble___danger", content: "invite trouble / danger", meaning: "自找麻烦，招致风险", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_mc32b_g_look_forward", content: "look forward to + doing（to 是介词）", meaning: "look forward to 中的 to 是介词，后接名词或动名词。例：I look forward to hearing from you. 不可接动词原形。", type: "grammar", ph: "", level: "B2", noTest: true }
    ,{ id: "seed_mc32b_g_postpone___p", content: "postpone / put off + doing", meaning: "推迟做某事用 postpone / put off doing sth，不可接动词原形。", type: "grammar", ph: "", level: "B2", noTest: true }
    ,{ id: "seed_oth4_decorate", content: "decorate", meaning: "装饰｜decoration n. 装饰", type: "word", ph: "/ˈdekəreɪt/", level: "B2" }
    ,{ id: "seed_oth4_bare", content: "bare", meaning: "光秃秃的", type: "word", ph: "/beə(r)/", level: "B2" }
    ,{ id: "seed_oth4_decor", content: "decor", meaning: "装饰风格，软装", type: "word", ph: "/ˈdeɪkɔː(r)/", level: "B2" }
    ,{ id: "seed_oth4_catalogue", content: "catalogue", meaning: "目录，货品清单", type: "word", ph: "/ˈkætəlɒɡ/", level: "B2" }
    ,{ id: "seed_oth4_pattern", content: "pattern", meaning: "图案 → patterned adj. 带花纹的", type: "word", ph: "/ˈpætn/", level: "B2" }
    ,{ id: "seed_oth4_marble", content: "marble", meaning: "大理石", type: "word", ph: "/ˈmɑːbl/", level: "B2" }
    ,{ id: "seed_oth4_impulsive", content: "impulsive", meaning: "冲动的", type: "word", ph: "/ɪmˈpʌlsɪv/", level: "B2" }
    ,{ id: "seed_oth4_peer", content: "peer", meaning: "同龄人", type: "word", ph: "/pɪə(r)/", level: "B2" }
    ,{ id: "seed_oth4_scrape", content: "scrape", meaning: "刮擦", type: "word", ph: "/skreɪp/", level: "B2" }
    ,{ id: "seed_oth4_workshop", content: "workshop", meaning: "研讨会，工坊", type: "word", ph: "/ˈwɜːkʃɒp/", level: "B2" }
    ,{ id: "seed_oth4_regulate", content: "regulate", meaning: "管控，调节", type: "word", ph: "/ˈreɡjuleɪt/", level: "B2" }
    ,{ id: "seed_oth4_container", content: "container", meaning: "容器", type: "word", ph: "/kənˈteɪnə(r)/", level: "B2" }
    ,{ id: "seed_oth4_whale", content: "whale", meaning: "鲸鱼", type: "word", ph: "/weɪl/", level: "B2" }
    ,{ id: "seed_oth4_equivalent", content: "equivalent", meaning: "等价的；对等物", type: "word", ph: "/ɪˈkwɪvələnt/", level: "B2" }
    ,{ id: "seed_oth4_wisdom", content: "wisdom", meaning: "智慧", type: "word", ph: "/ˈwɪzdəm/", level: "B2" }
    ,{ id: "seed_oth4_leisure", content: "leisure", meaning: "闲暇", type: "word", ph: "/ˈleʒə(r)/", level: "B2" }
    ,{ id: "seed_oth4_cemetery", content: "cemetery", meaning: "墓地", type: "word", ph: "/ˈsemətri/", level: "B2" }
    ,{ id: "seed_oth4_fast", content: "fast", meaning: "快速的；v. 禁食", type: "word", ph: "/fɑːst/", level: "B2" }
    ,{ id: "seed_oth4_enthusiasm", content: "enthusiasm", meaning: "热情", type: "word", ph: "/ɪnˈθjuːziæzəm/", level: "B2" }
    ,{ id: "seed_oth4_streamer", content: "streamer", meaning: "主播", type: "word", ph: "/ˈstriːmə(r)/", level: "B2" }
    ,{ id: "seed_oth4_emphasize", content: "emphasize", meaning: "强调", type: "word", ph: "/ˈemfəsaɪz/", level: "B2" }
    ,{ id: "seed_oth4_dilemma", content: "dilemma", meaning: "两难困境", type: "word", ph: "/dɪˈlemə/", level: "B2" }
    ,{ id: "seed_oth4_superstition", content: "superstition", meaning: "迷信", type: "word", ph: "/ˌsuːpəˈstɪʃn/", level: "B2" }
    ,{ id: "seed_oth4_scam", content: "scam", meaning: "骗局", type: "word", ph: "/skæm/", level: "B2" }
    ,{ id: "seed_oth4_underrated", content: "underrated", meaning: "被低估的", type: "word", ph: "/ˌʌndəˈreɪtɪd/", level: "B2" }
    ,{ id: "seed_oth4_corporate", content: "corporate", meaning: "公司的，企业的", type: "word", ph: "/ˈkɔːpərət/", level: "B2" }
    ,{ id: "seed_oth4_cooperate", content: "cooperate", meaning: "合作", type: "word", ph: "/kəʊˈɒpəreɪt/", level: "B2" }
    ,{ id: "seed_oth4_meantime", content: "meantime", meaning: "其间", type: "word", ph: "/ˈmiːntaɪm/", level: "B2" }
    ,{ id: "seed_oth4_peer_pressure", content: "peer pressure", meaning: "同辈压力", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_oth4_give_in", content: "give in", meaning: "屈服", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_oth4_give_in_to_peer_pressure", content: "give in to peer pressure", meaning: "屈服于同辈压力", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_oth4_personal_contacts", content: "personal contacts", meaning: "人脉", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_oth4_get_a_smile_out_of_sb", content: "get a smile out of sb", meaning: "逗某人笑", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_oth4_in_a_good_mood", content: "in a good mood", meaning: "心情好", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_oth4_leisure_time", content: "leisure time", meaning: "闲暇时光", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_oth4_in_honor_of_", content: "in honor of…", meaning: "为纪念……；向…… 致敬", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_oth4_clown_size", content: "clown size", meaning: "超大号", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_oth4_in_the_meantime", content: "in the meantime", meaning: "与此同时", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_oth4_g______even_", content: "让步连词 even though / even if", meaning: "even though 尽管（事实，≈ although / while）；even if 即使（假设，未必真实）。", type: "grammar", ph: "", level: "B2", noTest: true }
    ,{ id: "seed_oth4_g________hav", content: "情态动词 + have done（对过去推测 / 虚拟）", meaning: "must have done 过去一定做过（肯定推测）；should have done 本应该做（实际没做）；could have done 本可以做（实际没做）。", type: "grammar", ph: "", level: "B2", noTest: true }
    ,{ id: "seed_oth4_g___________", content: "口语讨论句型（装修主题）", meaning: "表达重要：I think ___ is the most important category. / ___ is really important to me. / For me, ___ matters more than ___. 表达不重要：I don’t think ___ is very important. / Compared with ___, ___ is less important. / ___ is not a big priority for me. 总结：We decided to create a ___ living room. / For the sofa, we chose the ___. / In total, we spent $___ out of our $1500 budget and collected ___ stars.", type: "grammar", ph: "", level: "B2", noTest: true }
    ,{ id: "seed_mc31b_casual", content: "casual", meaning: "休闲的，随意的", type: "word", ph: "/ˈkæʒuəl/", level: "B2" }
    ,{ id: "seed_mc31b_suburb", content: "suburb", meaning: "郊区", type: "word", ph: "/ˈsʌbɜːb/", level: "B2" }
    ,{ id: "seed_mc31b_relaunch", content: "relaunch", meaning: "重新推出，以新方式重启", type: "word", ph: "/ˌriːˈlɔːntʃ/", level: "B2" }
    ,{ id: "seed_mc31b_collection", content: "collection", meaning: "系列（一批相关商品）", type: "word", ph: "/kəˈlekʃn/", level: "B2" }
    ,{ id: "seed_mc31b_consultant", content: "consultant", meaning: "顾问", type: "word", ph: "/kənˈsʌltənt/", level: "B2" }
    ,{ id: "seed_mc31b_profit", content: "profit", meaning: "利润", type: "word", ph: "/ˈprɒfɪt/", level: "B2" }
    ,{ id: "seed_mc31b_casual_clothes", content: "casual clothes", meaning: "休闲服饰", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_mc31b_near___outside_the_city", content: "near / outside the city", meaning: "在城市周边 / 城外", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_mc31b_go_on_sale", content: "go on sale", meaning: "上市开售", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_mc31b_for_sale", content: "for sale", meaning: "待售（可购买）", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_mc31b_aim_to_do", content: "aim to do", meaning: "力求；目标是", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_mc31b_g_aim_to___one", content: "aim to = one’s goal is to（同义句型转换）", meaning: "aim to do（动词短语）≈ one’s goal is to do（名词句型）。例：The brand aims to expand. = The brand’s goal is to expand.", type: "grammar", ph: "", level: "B2", noTest: true }
    ,{ id: "seed_mc32b_postpone", content: "postpone", meaning: "推迟", type: "word", ph: "/pəˈspəʊn/", level: "B2" }
    ,{ id: "seed_mc32b_agenda", content: "agenda", meaning: "会议议程", type: "word", ph: "/əˈdʒendə/", level: "B2" }
    ,{ id: "seed_mc32b_updated", content: "updated", meaning: "更新的，最新的", type: "word", ph: "/ʌpˈdeɪtɪd/", level: "B2" }
    ,{ id: "seed_mc32b_invite", content: "invite", meaning: "邀请；招致（麻烦、危险）｜n. invitation 邀请函", type: "word", ph: "/ɪnˈvaɪt/", level: "B2" }
    ,{ id: "seed_mc32b_decide_to", content: "decide to", meaning: "决定去做", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_mc32b_at_a_later_time", content: "at a later time", meaning: "在晚些时候", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_mc32b_put_off", content: "put off", meaning: "推迟（=postpone）", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_mc32b_postpone_sth___doing_sth", content: "postpone sth / doing sth", meaning: "推迟某事 / 推迟做某事", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_mc32b_postpone_sth_until___to_", content: "postpone sth until / to…", meaning: "将某事推迟至……", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_mc32b_bring___forward_to", content: "bring … forward to", meaning: "把（时间）提前至……", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_mc32b_on_the_agenda", content: "on the agenda", meaning: "列入议程", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_mc32b_top_of_the_agenda", content: "top of the agenda", meaning: "首要议程", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_mc32b_look_forward_to_doing", content: "look forward to doing", meaning: "期待做某事（to 是介词，后接 doing / 名词）", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_mc32b_invite_sb_to_sp", content: "invite sb to sp", meaning: "邀请某人去某地", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_mc32b_invite_trouble___danger", content: "invite trouble / danger", meaning: "自找麻烦，招致风险", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_mc32b_g_look_forward", content: "look forward to + doing（to 是介词）", meaning: "look forward to 中的 to 是介词，后接名词或动名词。例：I look forward to hearing from you. 不可接动词原形。", type: "grammar", ph: "", level: "B2", noTest: true }
    ,{ id: "seed_mc32b_g_postpone___p", content: "postpone / put off + doing", meaning: "推迟做某事用 postpone / put off doing sth，不可接动词原形。", type: "grammar", ph: "", level: "B2", noTest: true }
    ,{ id: "seed_oth4_decorate", content: "decorate", meaning: "装饰｜decoration n. 装饰", type: "word", ph: "/ˈdekəreɪt/", level: "B2" }
    ,{ id: "seed_oth4_bare", content: "bare", meaning: "光秃秃的", type: "word", ph: "/beə(r)/", level: "B2" }
    ,{ id: "seed_oth4_decor", content: "decor", meaning: "装饰风格，软装", type: "word", ph: "/ˈdeɪkɔː(r)/", level: "B2" }
    ,{ id: "seed_oth4_catalogue", content: "catalogue", meaning: "目录，货品清单", type: "word", ph: "/ˈkætəlɒɡ/", level: "B2" }
    ,{ id: "seed_oth4_pattern", content: "pattern", meaning: "图案 → patterned adj. 带花纹的", type: "word", ph: "/ˈpætn/", level: "B2" }
    ,{ id: "seed_oth4_marble", content: "marble", meaning: "大理石", type: "word", ph: "/ˈmɑːbl/", level: "B2" }
    ,{ id: "seed_oth4_impulsive", content: "impulsive", meaning: "冲动的", type: "word", ph: "/ɪmˈpʌlsɪv/", level: "B2" }
    ,{ id: "seed_oth4_peer", content: "peer", meaning: "同龄人", type: "word", ph: "/pɪə(r)/", level: "B2" }
    ,{ id: "seed_oth4_scrape", content: "scrape", meaning: "刮擦", type: "word", ph: "/skreɪp/", level: "B2" }
    ,{ id: "seed_oth4_workshop", content: "workshop", meaning: "研讨会，工坊", type: "word", ph: "/ˈwɜːkʃɒp/", level: "B2" }
    ,{ id: "seed_oth4_regulate", content: "regulate", meaning: "管控，调节", type: "word", ph: "/ˈreɡjuleɪt/", level: "B2" }
    ,{ id: "seed_oth4_container", content: "container", meaning: "容器", type: "word", ph: "/kənˈteɪnə(r)/", level: "B2" }
    ,{ id: "seed_oth4_whale", content: "whale", meaning: "鲸鱼", type: "word", ph: "/weɪl/", level: "B2" }
    ,{ id: "seed_oth4_equivalent", content: "equivalent", meaning: "等价的；对等物", type: "word", ph: "/ɪˈkwɪvələnt/", level: "B2" }
    ,{ id: "seed_oth4_wisdom", content: "wisdom", meaning: "智慧", type: "word", ph: "/ˈwɪzdəm/", level: "B2" }
    ,{ id: "seed_oth4_leisure", content: "leisure", meaning: "闲暇", type: "word", ph: "/ˈleʒə(r)/", level: "B2" }
    ,{ id: "seed_oth4_cemetery", content: "cemetery", meaning: "墓地", type: "word", ph: "/ˈsemətri/", level: "B2" }
    ,{ id: "seed_oth4_fast", content: "fast", meaning: "快速的；v. 禁食", type: "word", ph: "/fɑːst/", level: "B2" }
    ,{ id: "seed_oth4_enthusiasm", content: "enthusiasm", meaning: "热情", type: "word", ph: "/ɪnˈθjuːziæzəm/", level: "B2" }
    ,{ id: "seed_oth4_streamer", content: "streamer", meaning: "主播", type: "word", ph: "/ˈstriːmə(r)/", level: "B2" }
    ,{ id: "seed_oth4_emphasize", content: "emphasize", meaning: "强调", type: "word", ph: "/ˈemfəsaɪz/", level: "B2" }
    ,{ id: "seed_oth4_dilemma", content: "dilemma", meaning: "两难困境", type: "word", ph: "/dɪˈlemə/", level: "B2" }
    ,{ id: "seed_oth4_superstition", content: "superstition", meaning: "迷信", type: "word", ph: "/ˌsuːpəˈstɪʃn/", level: "B2" }
    ,{ id: "seed_oth4_scam", content: "scam", meaning: "骗局", type: "word", ph: "/skæm/", level: "B2" }
    ,{ id: "seed_oth4_underrated", content: "underrated", meaning: "被低估的", type: "word", ph: "/ˌʌndəˈreɪtɪd/", level: "B2" }
    ,{ id: "seed_oth4_corporate", content: "corporate", meaning: "公司的，企业的", type: "word", ph: "/ˈkɔːpərət/", level: "B2" }
    ,{ id: "seed_oth4_cooperate", content: "cooperate", meaning: "合作", type: "word", ph: "/kəʊˈɒpəreɪt/", level: "B2" }
    ,{ id: "seed_oth4_meantime", content: "meantime", meaning: "其间", type: "word", ph: "/ˈmiːntaɪm/", level: "B2" }
    ,{ id: "seed_oth4_peer_pressure", content: "peer pressure", meaning: "同辈压力", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_oth4_give_in", content: "give in", meaning: "屈服", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_oth4_give_in_to_peer_pressure", content: "give in to peer pressure", meaning: "屈服于同辈压力", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_oth4_personal_contacts", content: "personal contacts", meaning: "人脉", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_oth4_get_a_smile_out_of_sb", content: "get a smile out of sb", meaning: "逗某人笑", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_oth4_in_a_good_mood", content: "in a good mood", meaning: "心情好", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_oth4_leisure_time", content: "leisure time", meaning: "闲暇时光", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_oth4_in_honor_of_", content: "in honor of…", meaning: "为纪念……；向…… 致敬", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_oth4_clown_size", content: "clown size", meaning: "超大号", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_oth4_in_the_meantime", content: "in the meantime", meaning: "与此同时", type: "phrase", ph: "", level: "B2" }
    ,{ id: "seed_oth4_g______even_", content: "让步连词 even though / even if", meaning: "even though 尽管（事实，≈ although / while）；even if 即使（假设，未必真实）。", type: "grammar", ph: "", level: "B2", noTest: true }
    ,{ id: "seed_oth4_g________hav", content: "情态动词 + have done（对过去推测 / 虚拟）", meaning: "must have done 过去一定做过（肯定推测）；should have done 本应该做（实际没做）；could have done 本可以做（实际没做）。", type: "grammar", ph: "", level: "B2", noTest: true }
    ,{ id: "seed_oth4_g___________", content: "口语讨论句型（装修主题）", meaning: "表达重要：I think ___ is the most important category. / ___ is really important to me. / For me, ___ matters more than ___. 表达不重要：I don’t think ___ is very important. / Compared with ___, ___ is less important. / ___ is not a big priority for me. 总结：We decided to create a ___ living room. / For the sofa, we chose the ___. / In total, we spent $___ out of our $1500 budget and collected ___ stars.", type: "grammar", ph: "", level: "B2", noTest: true }
/* INJECT-MC13-18-WB-KB */
    ,
    {"id":"seed_mc21_v_relent","content":"relent","meaning":"v. 变缓和；减弱（relentless 的词根）（relent /rɪˈlent/）","type":"vocab","ph":"/rɪˈlent/","level":"B2","noTest":true},
    {"id":"seed_mc21_v_rifle","content":"rifle","meaning":"n. 步枪（rifle /ˈraɪfl/）","type":"vocab","ph":"/ˈraɪfl/","level":"B2","noTest":true},
    {"id":"seed_mc21_v_axe","content":"axe","meaning":"n. 斧头（axe /æks/）","type":"vocab","ph":"/æks/","level":"B2","noTest":true},
    {"id":"seed_mc21_v_rope","content":"rope","meaning":"n. 绳子；绳索（rope /rəʊp/）","type":"vocab","ph":"/rəʊp/","level":"B2","noTest":true},
    {"id":"seed_mc21_v_mirror","content":"mirror","meaning":"n. 镜子（可反光发信号）（mirror /ˈmɪrə(r)/）","type":"vocab","ph":"/ˈmɪrə(r)/","level":"B2","noTest":true},
    {"id":"seed_mc21_v_choice","content":"choice","meaning":"n. 选择；选择权（choose 的名词）（choice /tʃɔɪs/）","type":"vocab","ph":"/tʃɔɪs/","level":"B2","noTest":true},
    {"id":"seed_mc21_v_choose","content":"choose","meaning":"v. 选择（choose – chose – chosen）（choose /tʃuːz/）","type":"vocab","ph":"/tʃuːz/","level":"B2","noTest":true},
    {"id":"seed_mc21_v_tide","content":"tide","meaning":"n. 潮水；潮汐（tide /taɪd/）","type":"vocab","ph":"/taɪd/","level":"B2","noTest":true},
    {"id":"seed_mc21_v_leave","content":"leave","meaning":"v. 离开；留下（leave /liːv/）","type":"vocab","ph":"/liːv/","level":"B2","noTest":true},
    {"id":"seed_mc21_v_luggage","content":"luggage","meaning":"n. 行李（不可数名词）（luggage /ˈlʌɡɪdʒ/）","type":"vocab","ph":"/ˈlʌɡɪdʒ/","level":"B2","noTest":true},
    {"id":"seed_mc21_v_plan","content":"plan","meaning":"n./v. 计划（可数）（plan /plæn/）","type":"vocab","ph":"/plæn/","level":"B2","noTest":true},
    {"id":"seed_mc21_v_advance","content":"advance","meaning":"n./v. 前进；提前（in advance 提前）（advance /ədˈvɑːns/）","type":"vocab","ph":"/ədˈvɑːns/","level":"B2","noTest":true},
    {"id":"seed_mc21_p_protect_from_","content":"protect ... from ...","meaning":"保护……免受……","type":"phrase","ph":"","level":"B2","noTest":true},
    {"id":"seed_mc21_p_treat_injuries","content":"treat injuries","meaning":"处理伤口","type":"phrase","ph":"","level":"B2","noTest":true},
    {"id":"seed_mc21_p_prevent_from_getting_infecte","content":"prevent ... from getting infected","meaning":"防止……感染","type":"phrase","ph":"","level":"B2","noTest":true},
    {"id":"seed_mc21_p_build_a_shelter","content":"build (a) shelter","meaning":"搭建庇护所","type":"phrase","ph":"","level":"B2","noTest":true},
    {"id":"seed_mc21_p_climb_rocks","content":"climb rocks","meaning":"攀爬岩石","type":"phrase","ph":"","level":"B2","noTest":true},
    {"id":"seed_mc21_p_halfway_up_the_mountains","content":"halfway up the mountains","meaning":"半山腰","type":"phrase","ph":"","level":"B2","noTest":true},
    {"id":"seed_mc21_p_leave_the_beach_because_of_t","content":"leave the beach because of the high tide","meaning":"因为涨潮而离开海滩","type":"phrase","ph":"","level":"B2","noTest":true},
    {"id":"seed_mc21_p_keep_making_fire_all_the_tim","content":"keep making fire all the time","meaning":"一直不断地生火","type":"phrase","ph":"","level":"B2","noTest":true},
    {"id":"seed_mc21_p_send_strong_signals","content":"send strong signals","meaning":"发出强烈的信号","type":"phrase","ph":"","level":"B2","noTest":true},
    {"id":"seed_mc21_p_fire_a_gun","content":"fire a gun","meaning":"开枪；发射","type":"phrase","ph":"","level":"B2","noTest":true},
    {"id":"seed_mc21_p_because_of_","content":"because of + 名词","meaning":"因为……（后接名词，不接句子）","type":"phrase","ph":"","level":"B2","noTest":true},
    {"id":"seed_mc21_p_all_the_time","content":"all the time","meaning":"一直；始终","type":"phrase","ph":"","level":"B2","noTest":true},
    {"id":"seed_mc21_p_the_first_challenge_is_doing","content":"the first challenge is doing sth.","meaning":"第一个挑战是做某事","type":"phrase","ph":"","level":"B2","noTest":true},
    {"id":"seed_mc21_s_the_first_challenge_is_findi","content":"The first challenge is finding clean water.","meaning":"第一个挑战是找到干净的水。","type":"sentence","ph":"","level":"B2","noTest":true},
    {"id":"seed_mc21_s_we_d_better_build_a_shelter_","content":"We'd better build a shelter before dark.","meaning":"我们最好在天黑前搭建一个庇护所。","type":"sentence","ph":"","level":"B2","noTest":true},
    {"id":"seed_mc21_s_it_s_a_good_idea_to_send_str","content":"It's a good idea to send strong signals.","meaning":"发出强烈的信号是个好主意。","type":"sentence","ph":"","level":"B2","noTest":true},
    {"id":"seed_mc21_s_we_will_have_to_climb_rocks_","content":"We will have to climb rocks to get a better view.","meaning":"我们将不得不爬上岩石，以便看得更远。","type":"sentence","ph":"","level":"B2","noTest":true},
    {"id":"seed_mc21_s_we_might_have_to_leave_the_b","content":"We might have to leave the beach because of the high tide.","meaning":"因为涨潮，我们可能不得不离开海滩。","type":"sentence","ph":"","level":"B2","noTest":true},
    {"id":"seed_mc21_s_i_m_afraid_that_we_don_t_hav","content":"I'm afraid that we don't have enough water.","meaning":"恐怕我们没有足够的水。","type":"sentence","ph":"","level":"B2","noTest":true},
    {"id":"seed_mc21_g_because_of_vs_because_","content":"because of + 名词 vs because + 句子","meaning":"because of 后接名词/名词短语（because of the high tide）；because 后接完整句子（because the tide is high）。","type":"grammar","ph":"","level":"B2","noTest":true},
    {"id":"seed_mc21_g_luggage_plan_","content":"luggage 不可数 / plan 可数","meaning":"luggage 是不可数名词：much luggage、a piece of luggage（✗ many luggages）；plan 是可数名词，单数须加限定词：our plan / the plan / a plan。","type":"grammar","ph":"","level":"B2","noTest":true},
    {"id":"seed_mc21_g_keep_doing_be_doing_","content":"keep + doing 与 be + doing 表语","meaning":"keep doing 持续/反复做某事（keep making fire）；主语为 challenge 时 be 后接 doing（The first challenge is having clean water）。","type":"grammar","ph":"","level":"B2","noTest":true},
    {"id":"seed_mc21_g__that_if_whether_","content":"宾语从句（that / if-whether / 特殊疑问词）","meaning":"陈述句用 that（可省）：I am afraid (that) we are lost.；一般疑问句用 if / whether + 陈述语序：I do not know if we can survive.；特殊疑问句保留疑问词并改陈述语序：Tell me what we should do first.","type":"grammar","ph":"","level":"B2","noTest":true},
      /* INJECT-MC3738-WB-KB */
      {"id":"seed_mc37_electronic","content":"electronic","meaning":"adj. 电子的","type":"word","ph":"/ɪˈlektrɑːnɪk/","level":"B2"},
      {"id":"seed_mc37_explicit","content":"explicit","meaning":"adj. 直接的，清楚的，详细的","type":"word","ph":"/ɪkˈsplɪsɪt/","level":"B2"},
      {"id":"seed_mc37_implicit","content":"implicit","meaning":"adj. 含蓄的；不直接言明的（反义：explicit）","type":"word","ph":"/ɪmˈplɪsɪt/","level":"B2"},
      {"id":"seed_mc37_approach","content":"approach","meaning":"n. 方法；v. 靠近/处理（问题）","type":"word","ph":"/əˈprəʊtʃ/","level":"B2"},
      {"id":"seed_mc37_recognition","content":"recognition","meaning":"n. 认出，认可（同源 recognize）","type":"word","ph":"/ˌrekəɡˈnɪʃn/","level":"B2"},
      {"id":"seed_mc37_comeupwith","content":"come up with","meaning":"想出（主意、解决方案）","type":"phrase","level":"B2"},
      {"id":"seed_mc37_negotiatewith","content":"negotiate with sb","meaning":"和某人协商（接人加 with）","type":"phrase","level":"B2"},
      {"id":"seed_mc38_available","content":"available","meaning":"adj. 有空的；可获得的","type":"word","ph":"/əˈveɪləbl/","level":"B2"},
      {"id":"seed_mc38_present","content":"present","meaning":"adj. 在场的；出席的","type":"word","ph":"/ˈpreznt/","level":"B2"},
      {"id":"seed_mc38_rundown","content":"run-down","meaning":"adj. 疲惫的；破旧的","type":"word","ph":"/ˌrʌn ˈdaʊn/","level":"B2"},
      {"id":"seed_mc38_bearound","content":"be around","meaning":"有空，可以联系上（≈ available/present）","type":"phrase","level":"B2"},
      {"id":"seed_mc38_seeyouaround","content":"see you around","meaning":"后会有期 / 回头见","type":"phrase","level":"B2"},
      {"id":"seed_mc38_rundown_v","content":"run down","meaning":"（人）筋疲力尽；（事物）衰败，破旧（动词短语）","type":"phrase","level":"B2"},
/* INJECT-MC36-WB-KB */
{"id":"seed_mc36fb_w1","content":"understanding","meaning":"体谅的，善解人意的","type":"word","ph":"/ˌʌndərˈstændɪŋ/","level":"B2"},
{"id":"seed_mc36fb_w2","content":"sleepover","meaning":"过夜聚会","type":"word","ph":"/ˈsliːpəʊvə(r)/","level":"B2"},
{"id":"seed_mc36fb_w3","content":"instead","meaning":"取而代之（adv.）","type":"word","ph":"/ɪnˈsted/","level":"B2"},
{"id":"seed_mc36fb_w4","content":"camp","meaning":"露营（v.）","type":"word","ph":"/kæmp/","level":"B2"},
{"id":"seed_mc36fb_w5","content":"demanding","meaning":"要求高的，费力的","type":"word","ph":"/dɪˈmɑːndɪŋ/","level":"B2"},
{"id":"seed_mc36fb_w6","content":"expectation","meaning":"期望（n.）","type":"word","ph":"/ˌekspekˈteɪʃn/","level":"B2"},
{"id":"seed_mc36fb_w7","content":"spoil","meaning":"溺爱，娇惯（v.）","type":"word","ph":"/spɔɪl/","level":"B2"},
{"id":"seed_mc36fb_w8","content":"greedy","meaning":"贪婪的（adj.）","type":"word","ph":"/ˈɡriːdi/","level":"B2"},
{"id":"seed_mc36fb_w9","content":"compromise","meaning":"妥协（n./v.）","type":"word","ph":"/ˈkɒmprəmaɪz/","level":"B2"},
{"id":"seed_mc36fb_w10","content":"lane","meaning":"车道；范围，领域（n.）","type":"word","ph":"/leɪn/","level":"B2"},
{"id":"seed_mc36fb_w11","content":"millionaire","meaning":"百万富翁（n.）","type":"word","ph":"/ˌmɪljəˈneə(r)/","level":"B2"},
{"id":"seed_mc36fb_w12","content":"idiot","meaning":"傻瓜，蠢货（n.）","type":"word","ph":"/ˈɪdiət/","level":"B2"},
{"id":"seed_mc36fb_p1","content":"be cool about sth","meaning":"对某事随和、理解","type":"phrase","ph":"","level":"B2"},
{"id":"seed_mc36fb_p2","content":"stay in one's lane","meaning":"不插手别人的事，守自己本分","type":"phrase","ph":"","level":"B2"},
{"id":"seed_mc36fb_p3","content":"get involved in sth","meaning":"卷入/插手某事","type":"phrase","ph":"","level":"B2"},
{"id":"seed_mc36fb_p4","content":"a big player","meaning":"重要人物","type":"phrase","ph":"","level":"B2"},
{"id":"seed_mc36fb_p5","content":"a big shot","meaning":"大人物，厉害角色","type":"phrase","ph":"","level":"B2"},
{"id":"seed_mc36fb_p6","content":"let sb be","meaning":"不去干涉某人，随某人去","type":"phrase","ph":"","level":"B2"},
{"id":"seed_mc36fb_p7","content":"hand out money","meaning":"给钱","type":"phrase","ph":"","level":"B2"},
{"id":"seed_mc36fb_p8","content":"don't give me that look","meaning":"别用这种眼神看我","type":"phrase","ph":"","level":"B2"},
{"id":"seed_mc36fb_p9","content":"just think about it","meaning":"好好想一想","type":"phrase","ph":"","level":"B2"},
{"id":"seed_mc36fb_p10","content":"give me some support","meaning":"给我一些支持","type":"phrase","ph":"","level":"B2"},
{"id":"seed_mc36fb_g1","content":"be being + adj.","meaning":"强调当下临时表现出的状态（非一贯性格）","type":"grammar","ph":"","level":"B2"},
{"id":"seed_mc36fb_g2","content":"the hell 反讽","meaning":"The hell + 主语 + 动词 = 否定反驳，意思与字面相反","type":"grammar","ph":"","level":"B2"},
{"id":"seed_mc36fb_g3","content":"gonna / gotta","meaning":"口语简写：gonna=going to；gotta=(have) got to=必须（书面禁用）","type":"grammar","ph":"","level":"B2"}
    ,{"id":"seed_wb_1_mc39","content":"internship","meaning":"实习；实习期","type":"word","level":"B2","ph":"/ˈɪntɜːnʃɪp/"}
    ,{"id":"seed_wb_2_mc39","content":"profile","meaning":"个人资料；简历；侧面","type":"word","level":"B2","ph":"/ˈprəʊfaɪl/"}
    ,{"id":"seed_wb_3_mc39","content":"qualified","meaning":"合格的；胜任的","type":"word","level":"B2","ph":"/ˈkwɒlɪfaɪd/"}
    ,{"id":"seed_wb_4_mc39","content":"overqualified","meaning":"资历过高的","type":"word","level":"B2","ph":"/ˌəʊvəˈkwɒlɪfaɪd/"}
    ,{"id":"seed_wb_5_mc39","content":"impressed","meaning":"印象深刻的","type":"word","level":"B2","ph":"/ɪmˈprest/"}
    ,{"id":"seed_wb_6_mc39","content":"senior","meaning":"资深的；年长的","type":"word","level":"B2","ph":"/ˈsiːniə(r)/"}
    ,{"id":"seed_wb_7_mc39","content":"junior","meaning":"初级的；资历浅的","type":"word","level":"B2","ph":"/ˈdʒuːniə(r)/"}
    ,{"id":"seed_wb_8_mc39","content":"odd","meaning":"奇怪的；临时的","type":"word","level":"B2","ph":"/ɒd/"}
    ,{"id":"seed_wb_9_mc39","content":"VP","meaning":"副总裁（vice president）","type":"word","level":"B2","ph":"/ˌviː ˈpiː/"}
    ,{"id":"seed_wb_10_mc39","content":"fire away","meaning":"尽管问吧；请随便提问","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_11_mc39","content":"be qualified for","meaning":"胜任…；有资格做…","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_12_mc39","content":"way overqualified","meaning":"way 作副词“远远”，远远资历过高","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_13_mc39","content":"be impressed by/with sth","meaning":"对…印象深刻","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_14_mc39","content":"It’s your call.","meaning":"你决定吧；由你说了算","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_15_mc39","content":"nail it","meaning":"搞定；做得漂亮","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_16_mc39","content":"make it","meaning":"成功；做到；赶上","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_17_mc40","content":"ridiculous","meaning":"荒谬的；可笑的","type":"word","level":"B2","ph":"/rɪˈdɪkjələs/"}
    ,{"id":"seed_wb_18_mc40","content":"silly","meaning":"傻的；愚蠢的","type":"word","level":"B2","ph":"/ˈsɪli/"}
    ,{"id":"seed_wb_19_mc40","content":"underestimate","meaning":"低估","type":"word","level":"B2","ph":"/ˌʌndərˈestɪmeɪt/"}
    ,{"id":"seed_wb_20_mc40","content":"grand","meaning":"一千美元；宏大的","type":"word","level":"B2","ph":"/ɡrænd/"}
    ,{"id":"seed_wb_21_mc40","content":"buck","meaning":"美元（美/澳口语）","type":"word","level":"B2","ph":"/bʌk/"}
    ,{"id":"seed_wb_22_mc40","content":"cozy","meaning":"温暖舒适的；安逸的","type":"word","level":"B2","ph":"/ˈkəʊzi/"}
    ,{"id":"seed_wb_23_mc40","content":"mortgage","meaning":"按揭贷款；抵押贷款","type":"word","level":"B2","ph":"/ˈmɔːɡɪdʒ/"}
    ,{"id":"seed_wb_24_mc40","content":"a grand","meaning":"一千美元","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_25_mc40","content":"pay my mortgage","meaning":"偿还房贷","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_26_mc06","content":"occasionally","meaning":"偶尔","type":"word","level":"B2","ph":"/əˈkeɪʒnəli/"}
    ,{"id":"seed_wb_27_mc06","content":"Bachelor’s degree","meaning":"学士学位","type":"word","level":"B2","ph":"/ˈbætʃələz dɪˈɡriː/"}
    ,{"id":"seed_wb_28_mc06","content":"Master’s degree","meaning":"硕士学位","type":"word","level":"B2","ph":"/ˈmɑːstəz dɪˈɡriː/"}
    ,{"id":"seed_wb_29_mc06","content":"Doctor’s degree","meaning":"博士学位","type":"word","level":"B2","ph":"/ˈdɒktəz dɪˈɡriː/"}
    ,{"id":"seed_wb_30_mc06","content":"PR","meaning":"公共关系（public relations）","type":"word","level":"B2","ph":"/ˌpiː ˈɑː(r)/"}
    ,{"id":"seed_wb_31_mc06","content":"stressful","meaning":"压力大的","type":"word","level":"B2","ph":"/ˈstresfl/"}
    ,{"id":"seed_wb_32_mc06","content":"fulfilling","meaning":"有成就感的","type":"word","level":"B2","ph":"/fʊlˈfɪlɪŋ/"}
    ,{"id":"seed_wb_33_mc06","content":"challenging","meaning":"有挑战的","type":"word","level":"B2","ph":"/ˈtʃælɪndʒɪŋ/"}
    ,{"id":"seed_wb_34_mc06","content":"rewarding","meaning":"有回报的","type":"word","level":"B2","ph":"/rɪˈwɔːdɪŋ/"}
    ,{"id":"seed_wb_35_mc06","content":"boring","meaning":"无聊的","type":"word","level":"B2","ph":"/ˈbɔːrɪŋ/"}
    ,{"id":"seed_wb_36_mc06","content":"repetitive","meaning":"重复的","type":"word","level":"B2","ph":"/rɪˈpetətɪv/"}
    ,{"id":"seed_wb_37_mc06","content":"motivating","meaning":"激励人的","type":"word","level":"B2","ph":"/ˈməʊtɪveɪtɪŋ/"}
    ,{"id":"seed_wb_38_mc06","content":"fixed schedule","meaning":"固定时间表","type":"word","level":"B2","ph":"/fɪkst ˈskedʒuːl/"}
    ,{"id":"seed_wb_39_mc06","content":"flexible schedule","meaning":"弹性时间表","type":"word","level":"B2","ph":"/ˈfleksəbl ˈskedʒuːl/"}
    ,{"id":"seed_wb_40_mc06","content":"commute","meaning":"通勤","type":"word","level":"B2","ph":"/kəˈmjuːt/"}
    ,{"id":"seed_wb_41_mc06","content":"indecisive","meaning":"优柔寡断的","type":"word","level":"B2","ph":"/ˌɪndɪˈsaɪsɪv/"}
    ,{"id":"seed_wb_42_mc06","content":"strategic","meaning":"战略性的","type":"word","level":"B2","ph":"/strəˈtiːdʒɪk/"}
    ,{"id":"seed_wb_43_mc06","content":"nurse","meaning":"护士","type":"word","level":"B2","ph":"/nɜːs/"}
    ,{"id":"seed_wb_44_mc06","content":"degree","meaning":"学位；程度","type":"word","level":"B2","ph":"/dɪˈɡriː/"}
    ,{"id":"seed_wb_45_mc06","content":"qualification","meaning":"资格；资质","type":"word","level":"B2","ph":"/ˌkwɒlɪfɪˈkeɪʃn/"}
    ,{"id":"seed_wb_46_mc06","content":"tiring","meaning":"令人疲倦的","type":"word","level":"B2","ph":"/ˈtaɪərɪŋ/"}
    ,{"id":"seed_wb_47_mc06","content":"tired","meaning":"疲倦的","type":"word","level":"B2","ph":"/ˈtaɪəd/"}
    ,{"id":"seed_wb_48_mc06","content":"health","meaning":"健康","type":"word","level":"B2","ph":"/helθ/"}
    ,{"id":"seed_wb_49_mc06","content":"safety","meaning":"安全","type":"word","level":"B2","ph":"/ˈseɪfti/"}
    ,{"id":"seed_wb_50_mc06","content":"mains power","meaning":"主电源","type":"word","level":"B2","ph":"/meɪnz ˈpaʊə(r)/"}
    ,{"id":"seed_wb_51_mc06","content":"investment banking","meaning":"投资银行（业）","type":"word","level":"B2","ph":"/ɪnˈvestmənt ˈbæŋkɪŋ/"}
    ,{"id":"seed_wb_52_mc06","content":"communicator","meaning":"沟通者；交流者","type":"word","level":"B2","ph":"/kəˈmjuːnɪkeɪtə(r)/"}
    ,{"id":"seed_wb_53_mc06","content":"stress","meaning":"压力；强调","type":"word","level":"B2","ph":"/stres/"}
    ,{"id":"seed_wb_54_mc06","content":"pound","meaning":"英镑","type":"word","level":"B2","ph":"/paʊnd/"}
    ,{"id":"seed_wb_55_mc06","content":"useful","meaning":"有用的","type":"word","level":"B2","ph":"/ˈjuːsfl/"}
    ,{"id":"seed_wb_56_mc06","content":"lose my appetite","meaning":"没胃口","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_57_mc06","content":"dress code","meaning":"着装规范","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_58_mc06","content":"on-the-job training","meaning":"在职培训","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_59_mc06","content":"pros and cons","meaning":"利与弊；优缺点","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_60_mc06","content":"work with people","meaning":"与人共事","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_61_mc06","content":"work long hours","meaning":"工作时间长","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_62_mc06","content":"deal with","meaning":"处理；应对","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_63_mc06","content":"do well at school","meaning":"学业优秀","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_64_mc06","content":"nursing degree","meaning":"护理学位","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_65_mc06","content":"get a job","meaning":"找到工作","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_66_mc06","content":"be good at doing sth","meaning":"擅长做…","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_67_mc06","content":"make decisions","meaning":"做决定","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_68_mc06","content":"work in a team","meaning":"在团队中工作","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_69_mc06","content":"on your own","meaning":"独自（= by yourself）","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_70_mc06","content":"work with a company","meaning":"与某公司合作","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_71_mc06","content":"switch off","meaning":"关掉（电源等）","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_72_mc06","content":"wear a suit","meaning":"穿西装","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_73_mc06","content":"be my own boss","meaning":"自己当老板","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_74_mc06","content":"look after","meaning":"照顾","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_75_mc06","content":"go wrong","meaning":"出错","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_76_mc06","content":"lose money","meaning":"亏钱","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_77_mc06","content":"work well with sb","meaning":"与某人配合默契","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_78_oth","content":"mistress","meaning":"情妇","type":"word","level":"B2","ph":"/ˈmɪstrəs/"}
    ,{"id":"seed_wb_79_oth","content":"sacrifice","meaning":"牺牲","type":"word","level":"B2","ph":"/ˈsækrɪfaɪs/"}
    ,{"id":"seed_wb_80_oth","content":"gold digger","meaning":"拜金者（为钱接近异性的人）","type":"word","level":"B2","ph":"/ɡəʊld ˈdɪɡə(r)/"}
    ,{"id":"seed_wb_81_oth","content":"spouse","meaning":"配偶","type":"word","level":"B2","ph":"/spaʊs/"}
    ,{"id":"seed_wb_82_oth","content":"hassle","meaning":"麻烦；困扰","type":"word","level":"B2","ph":"/ˈhæsl/"}
    ,{"id":"seed_wb_83_oth","content":"hassle-free","meaning":"无烦恼的；省心的","type":"word","level":"B2","ph":"/ˈhæsl friː/"}
    ,{"id":"seed_wb_84_oth","content":"as far as I’m concerned","meaning":"就我而言","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_85_oth","content":"if you ask me","meaning":"如果你问我；依我看","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_86_oth","content":"in my opinion","meaning":"在我看来","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_87_oth","content":"I believe (that)","meaning":"我相信","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_88_oth","content":"I think (that)","meaning":"我认为","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_89_oth","content":"What do you think?","meaning":"你怎么看？","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_90_oth","content":"How do you feel about…?","meaning":"你对…感觉如何？","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_91_oth","content":"Do you agree?","meaning":"你同意吗？","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_92_g_mc39","content":"be qualified for / be impressed by","meaning":"be qualified for sth 胜任；be impressed by/with sth 对…印象深刻。by/with 介词固定。","type":"grammar","level":"B2","noTest":true}
    ,{"id":"seed_wb_93_g_mc39","content":"way 作副词","meaning":"way 放在形容词前表“远远/大大”：way overqualified 远远资历过高；way better 好得多。","type":"grammar","level":"B2","noTest":true}
    ,{"id":"seed_wb_94_g_mc39","content":"It’s your call. = up to you","meaning":"口语：决定权在你。call 这里指决定。","type":"grammar","level":"B2","noTest":true}
    ,{"id":"seed_wb_95_g_mc39","content":"young vs old 职场对比","meaning":"Young people have more energy and are creative. / Old people have rich experience and stay calm. 用对比结构表达观点。","type":"grammar","level":"B2","noTest":true}
    ,{"id":"seed_wb_96_g_mc40","content":"听力场景：离职/裁员/收入与开销","meaning":"When Work Ends 主题：离职（quit/leave）、裁员（lay off/be made redundant）、收入（income/salary）、生活开销（rent/mortgage/bills）。","type":"grammar","level":"B2","noTest":true}
    ,{"id":"seed_wb_97_g_mc06","content":"动词 + doing 固定搭配","meaning":"enjoy + doing；start + doing / to do；be good at + doing；without + doing。动名词作宾语/解释。","type":"grammar","level":"B2","noTest":true}
    ,{"id":"seed_wb_98_g_mc06","content":"while + be doing","meaning":"while you are working with a company 当你与公司合作时，强调动作正在进行。","type":"grammar","level":"B2","noTest":true}
    ,{"id":"seed_wb_99_g_mc06","content":"-ing / -ed 形容词","meaning":"tiring 令人疲倦的（修饰物）；tired 感到疲倦的（修饰人）。","type":"grammar","level":"B2","noTest":true}
    ,{"id":"seed_wb_100_g_mc06","content":"不定式 to do 表目的","meaning":"To become a nurse, you need a nursing degree. to do 表目的。","type":"grammar","level":"B2","noTest":true}
    ,{"id":"seed_wb_101_g_mc06","content":"定语从句 who / 省略关系代词","meaning":"the patient (that) you look after；who 指人，关系代词作宾语可省略。","type":"grammar","level":"B2","noTest":true}
    ,{"id":"seed_wb_102_g_mc06","content":"what 主语从句","meaning":"What I do is look after other people’s money. what 引导主语从句。","type":"grammar","level":"B2","noTest":true}
    ,{"id":"seed_wb_103_g_mc06","content":"be in + 行业","meaning":"I’m in investment banking. be in + 行业名词。","type":"grammar","level":"B2","noTest":true}
    ,{"id":"seed_wb_104_g_mc06","content":"第一条件句 if + 一般现在","meaning":"If something goes wrong, I deal with a lot of stress. if + 一般现在表可能。","type":"grammar","level":"B2","noTest":true}
    ,{"id":"seed_wb_105_g_oth","content":"⚠️ 误区：I am agree / I am disagree","meaning":"错误！agree 是动词，不与 be 连用。正确：I agree. / I disagree.","type":"grammar","level":"B2","noTest":true}
    ,{"id":"seed_wb_106_g_oth","content":"表达观点句型","meaning":"I think (that)… / In my opinion… / As far as I’m concerned… / If you ask me…","type":"grammar","level":"B2","noTest":true}
    ,{"id":"seed_wb_107_g_oth","content":"同意与礼貌不同意","meaning":"强烈同意：I completely agree. / I couldn’t agree more. 礼貌不同意：I’m afraid I disagree. / I’m not so sure about that.","type":"grammar","level":"B2","noTest":true}
    ,{"id":"seed_wb_108_s_mc39","content":"Young people have more energy and are creative.","meaning":"年轻人更有活力也更有创造力。","type":"sentence","level":"B2","noTest":true}
    ,{"id":"seed_wb_109_s_mc39","content":"Old people have rich experience and can solve problems calmly.","meaning":"年长者经验丰富，能冷静地解决问题。","type":"sentence","level":"B2","noTest":true}
    ,{"id":"seed_wb_110_s_mc39","content":"He is way overqualified for this internship.","meaning":"他做这份实习远远资历过高了。","type":"sentence","level":"B2","noTest":true}
    ,{"id":"seed_wb_111_s_mc40","content":"That idea sounds ridiculous to me.","meaning":"那个想法在我听来很荒谬。","type":"sentence","level":"B2","noTest":true}
    ,{"id":"seed_wb_112_s_mc40","content":"He overestimated how much he could save.","meaning":"他高估了自己能存下的钱。","type":"sentence","level":"B2","noTest":true}
    ,{"id":"seed_wb_113_s_mc40","content":"I pay my mortgage every month.","meaning":"我每个月偿还房贷。","type":"sentence","level":"B2","noTest":true}
    ,{"id":"seed_wb_114_s_mc06","content":"How do you feel about working with people?","meaning":"你对与人共事感觉如何？","type":"sentence","level":"B2","noTest":true}
    ,{"id":"seed_wb_115_s_mc06","content":"I find my job very rewarding.","meaning":"我觉得我的工作很有成就感。","type":"sentence","level":"B2","noTest":true}
    ,{"id":"seed_wb_116_s_mc06","content":"What do you do for a living?","meaning":"你是做什么工作的？","type":"sentence","level":"B2","noTest":true}
    ,{"id":"seed_wb_117_s_mc06","content":"I love my job—working with people.","meaning":"我热爱我的工作——与人打交道。","type":"sentence","level":"B2","noTest":true}
    ,{"id":"seed_wb_118_s_mc06","content":"To become a nurse, you need a nursing degree.","meaning":"要成为护士，你需要护理学位。","type":"sentence","level":"B2","noTest":true}
    ,{"id":"seed_wb_119_s_mc06","content":"I’m good at making decisions.","meaning":"我擅长做决定。","type":"sentence","level":"B2","noTest":true}
    ,{"id":"seed_wb_120_s_mc06","content":"I’m in investment banking.","meaning":"我从事投资银行业。","type":"sentence","level":"B2","noTest":true}
    ,{"id":"seed_wb_121_s_mc06","content":"What I do is look after other people’s money.","meaning":"我的工作是照看别人的钱。","type":"sentence","level":"B2","noTest":true}
    ,{"id":"seed_wb_122_s_oth","content":"Being single is much better than being married.","meaning":"单身比结婚好得多。","type":"sentence","level":"B2","noTest":true}
    ,{"id":"seed_wb_123_s_oth","content":"In my opinion, being single is hassle-free.","meaning":"在我看来，单身没有琐事烦扰。","type":"sentence","level":"B2","noTest":true}
    ,{"id":"seed_wb_124_s_oth","content":"I think that being single is perfect.","meaning":"我认为单身很完美。","type":"sentence","level":"B2","noTest":true}
    ,{"id":"seed_wb_125_s_oth","content":"As far as I’m concerned, there is no happiness in marriage.","meaning":"在我看来，婚姻里没有幸福。","type":"sentence","level":"B2","noTest":true}

    ,{"id":"seed_wb_1_mc02","content":"bunk beds","meaning":"上下铺","type":"word","level":"B2","ph":"/bʌŋk bedz/"}
    ,{"id":"seed_wb_2_mc02","content":"capsule hotels","meaning":"胶囊旅馆","type":"word","level":"B2","ph":"/ˈkæpsjuːl həʊˈtelz/"}
    ,{"id":"seed_wb_3_mc02","content":"budget hotels","meaning":"经济型酒店","type":"word","level":"B2","ph":"/ˈbʌdʒɪt həʊˈtelz/"}
    ,{"id":"seed_wb_4_mc02","content":"motel","meaning":"汽车旅馆","type":"word","level":"B2","ph":"/məʊˈtel/"}
    ,{"id":"seed_wb_5_mc02","content":"youth hostels","meaning":"青年旅舍","type":"word","level":"B2","ph":"/juːθ ˈhɒstlz/"}
    ,{"id":"seed_wb_6_mc02","content":"dormitory","meaning":"宿舍","type":"word","level":"B2","ph":"/ˈdɔːmətri/"}
    ,{"id":"seed_wb_7_mc02","content":"Air B&B","meaning":"民宿（Airbnb）","type":"word","level":"B2","ph":"/ˌeə biː ən biː/"}
    ,{"id":"seed_wb_8_mc02","content":"resort","meaning":"度假村；度假胜地","type":"word","level":"B2","ph":"/rɪˈzɔːt/"}
    ,{"id":"seed_wb_9_mc02","content":"villa","meaning":"别墅","type":"word","level":"B2","ph":"/ˈvɪlə/"}
    ,{"id":"seed_wb_10_mc02","content":"yurt","meaning":"蒙古包；毡房","type":"word","level":"B2","ph":"/jɜːt/"}
    ,{"id":"seed_wb_11_mc02","content":"meditation","meaning":"冥想","type":"word","level":"B2","ph":"/ˌmedɪˈteɪʃn/"}
    ,{"id":"seed_wb_12_mc02","content":"locker","meaning":"储物柜","type":"word","level":"B2","ph":"/ˈlɒkə(r)/"}
    ,{"id":"seed_wb_13_mc02","content":"belongings","meaning":"随身物品；财物","type":"word","level":"B2","ph":"/bɪˈlɒŋɪŋz/"}
    ,{"id":"seed_wb_14_mc02","content":"convenient","meaning":"方便的","type":"word","level":"B2","ph":"/kənˈviːniənt/"}
    ,{"id":"seed_wb_15_mc02","content":"clean","meaning":"干净的","type":"word","level":"B2","ph":"/kliːn/"}
    ,{"id":"seed_wb_16_mc02","content":"cost-effective","meaning":"性价比高的","type":"word","level":"B2","ph":"/ˌkɒst ɪˈfektɪv/"}
    ,{"id":"seed_wb_17_mc02","content":"filthy","meaning":"脏得要命的","type":"word","level":"B2","ph":"/ˈfɪlθi/"}
    ,{"id":"seed_wb_18_mc02","content":"cramped","meaning":"狭窄拥挤的","type":"word","level":"B2","ph":"/kræmpt/"}
    ,{"id":"seed_wb_19_mc02","content":"spacious","meaning":"宽敞的","type":"word","level":"B2","ph":"/ˈspeɪʃəs/"}
    ,{"id":"seed_wb_20_mc02","content":"roomy","meaning":"宽敞的","type":"word","level":"B2","ph":"/ˈruːmi/"}
    ,{"id":"seed_wb_22_mc02","content":"well-equipped","meaning":"设备齐全的","type":"word","level":"B2","ph":"/ˌwel ɪˈkwɪpt/"}
    ,{"id":"seed_wb_23_mc02","content":"multi-functional","meaning":"多功能的","type":"word","level":"B2","ph":"/ˌmʌlti ˈfʌŋkʃənl/"}
    ,{"id":"seed_wb_24_mc02","content":"well-ventilated","meaning":"通风良好的","type":"word","level":"B2","ph":"/ˌwel ˈventɪleɪtɪd/"}
    ,{"id":"seed_wb_25_mc02","content":"stuffy","meaning":"闷热的；不通风的","type":"word","level":"B2","ph":"/ˈstʌfi/"}
    ,{"id":"seed_wb_26_mc02","content":"bright","meaning":"明亮的","type":"word","level":"B2","ph":"/braɪt/"}
    ,{"id":"seed_wb_27_mc02","content":"couch potato","meaning":"电视迷；久坐不动的人","type":"word","level":"B2","ph":"/kaʊtʃ pəˈteɪtəʊ/"}
    ,{"id":"seed_wb_28_mc02","content":"social butterfly","meaning":"社交达人；交际花","type":"word","level":"B2","ph":"/ˈsəʊʃl ˈbʌtəflaɪ/"}
    ,{"id":"seed_wb_29_mc02","content":"mind-blowing","meaning":"令人震撼的；极其惊艳的","type":"word","level":"B2","ph":"/ˈmaɪnd bləʊɪŋ/"}
    ,{"id":"seed_wb_30_mc02","content":"manual","meaning":"手动的；手册","type":"word","level":"B2","ph":"/ˈmænjuəl/"}
    ,{"id":"seed_wb_31_mc02","content":"automatic","meaning":"自动的","type":"word","level":"B2","ph":"/ˌɔːtəˈmætɪk/"}
    ,{"id":"seed_wb_32_mc02","content":"feel like doing sth","meaning":"想要做某事","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_33_mc02","content":"It takes … to do sth","meaning":"做某事需要花费（时间/金钱）","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_34_mc02","content":"in other words","meaning":"换句话说","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_35_mc02","content":"not a fan of …","meaning":"不喜欢…；不是…的粉丝","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_36_mc02","content":"hang out with sb","meaning":"和某人一起玩；闲逛","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_37_mc02","content":"a home from home","meaning":"像家一样的地方；宾至如归","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_38_g_mc02","content":"现在完成时 + 最高级","meaning":"What is the best place you have ever lived in? 用 have ever + 过去分词谈论至今的经历，常与最高级 the best 搭配。","type":"grammar","level":"B2","noTest":true}
    ,{"id":"seed_wb_39_g_mc02","content":"It takes sb + 时间 + to do sth","meaning":"It takes me 20 minutes to get to the airport. it 是形式主语，真正主语是 to do。","type":"grammar","level":"B2","noTest":true}
    ,{"id":"seed_wb_40_g_mc02","content":"that 引导的定语从句描述空间","meaning":"Spaces that are bright and well-ventilated make people feel relaxed. that 从句修饰 spaces，谓语随先行词用复数。","type":"grammar","level":"B2","noTest":true}
    ,{"id":"seed_wb_41_s_mc02","content":"What's the best place you have ever lived in?","meaning":"你住过的最好的地方是哪里？","type":"sentence","level":"B2","noTest":true}
    ,{"id":"seed_wb_42_s_mc02","content":"Why did you like it?","meaning":"你为什么喜欢它？","type":"sentence","level":"B2","noTest":true}
    ,{"id":"seed_wb_43_s_mc02","content":"Spaces that are bright and well-ventilated make people feel relaxed.","meaning":"明亮通风的空间让人感到放松。","type":"sentence","level":"B2","noTest":true}
    ,{"id":"seed_wb_44_s_mc02","content":"I am not a fan of cramped hotel rooms.","meaning":"我不喜欢狭窄拥挤的酒店房间。","type":"sentence","level":"B2","noTest":true}
    ,{"id":"seed_wb_45_mc04","content":"scenery","meaning":"风景（不可数）","type":"word","level":"B2","ph":"/ˈsiːnəri/"}
    ,{"id":"seed_wb_46_mc04","content":"journey","meaning":"旅程","type":"word","level":"B2","ph":"/ˈdʒɜːni/"}
    ,{"id":"seed_wb_47_mc04","content":"airsick","meaning":"晕机的","type":"word","level":"B2","ph":"/ˈeəsɪk/"}
    ,{"id":"seed_wb_48_mc04","content":"seasick","meaning":"晕船的","type":"word","level":"B2","ph":"/ˈsiːsɪk/"}
    ,{"id":"seed_wb_49_mc04","content":"carsick","meaning":"晕车的","type":"word","level":"B2","ph":"/ˈkɑːsɪk/"}
    ,{"id":"seed_wb_50_mc04","content":"delay","meaning":"延误；推迟","type":"word","level":"B2","ph":"/dɪˈleɪ/"}
    ,{"id":"seed_wb_51_mc04","content":"cancel","meaning":"取消","type":"word","level":"B2","ph":"/ˈkænsl/"}
    ,{"id":"seed_wb_52_mc04","content":"report","meaning":"报告；报到","type":"word","level":"B2","ph":"/rɪˈpɔːt/"}
    ,{"id":"seed_wb_53_mc04","content":"receptionist","meaning":"前台接待员","type":"word","level":"B2","ph":"/rɪˈsepʃənɪst/"}
    ,{"id":"seed_wb_54_mc04","content":"cruise","meaning":"游轮；乘船游览","type":"word","level":"B2","ph":"/kruːz/"}
    ,{"id":"seed_wb_55_mc04","content":"engine","meaning":"发动机；引擎","type":"word","level":"B2","ph":"/ˈendʒɪn/"}
    ,{"id":"seed_wb_56_mc04","content":"power cut","meaning":"停电","type":"word","level":"B2","ph":"/ˈpaʊə kʌt/"}
    ,{"id":"seed_wb_57_mc04","content":"candle","meaning":"蜡烛","type":"word","level":"B2","ph":"/ˈkændl/"}
    ,{"id":"seed_wb_58_mc04","content":"get to one's destination","meaning":"到达目的地","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_59_mc04","content":"enjoy the scenery / journey","meaning":"欣赏风景／享受旅程","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_60_mc04","content":"avoid traffic jams","meaning":"避开堵车","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_61_mc04","content":"feel nervous about flying","meaning":"对坐飞机感到紧张","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_62_mc04","content":"miss a connecting flight","meaning":"错过转机航班","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_63_mc04","content":"book another flight / hotel","meaning":"预订另一班航班／另一家酒店","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_64_mc04","content":"have one's flight delayed / cancelled","meaning":"航班被延误／取消","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_65_mc04","content":"get food poisoning","meaning":"食物中毒","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_66_mc04","content":"get lost in an unfamiliar place","meaning":"在陌生地方迷路","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_67_mc04","content":"ask for directions","meaning":"问路","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_68_mc04","content":"have trouble doing sth","meaning":"做某事有困难","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_69_mc04","content":"luckily / eventually / in the end","meaning":"幸运的是／最终／最后","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_70_g_mc04","content":"have sth done（使役／遭遇）","meaning":"have + 宾语 + 过去分词：① 遭遇不愉快 I had my luggage stolen. 我的行李被偷了；② 请人代做 I had my hair cut. 我理了发。B2 重点结构。","type":"grammar","level":"B2","noTest":true}
    ,{"id":"seed_wb_71_g_mc04","content":"when 从句 + 过去进行时","meaning":"When I was traveling, luckily, I met a local guide. 从句用过去进行时交代背景，主句用一般过去时叙述事件。","type":"grammar","level":"B2","noTest":true}
    ,{"id":"seed_wb_72_g_mc04","content":"prefer doing / prefer to do","meaning":"I prefer traveling by train. = I prefer to travel by train. 对比时用 prefer A to B，此处 to 是介词。","type":"grammar","level":"B2","noTest":true}
    ,{"id":"seed_wb_73_s_mc04","content":"I prefer traveling by train.","meaning":"我更喜欢坐火车旅行。","type":"sentence","level":"B2","noTest":true}
    ,{"id":"seed_wb_74_s_mc04","content":"People sometimes get sick when they are on vacation.","meaning":"人们度假时有时会生病。","type":"sentence","level":"B2","noTest":true}
    ,{"id":"seed_wb_75_s_mc04","content":"Once, I missed my connecting flight. When I was traveling, luckily, a stranger helped me.","meaning":"有一次我错过了转机航班。旅行途中，幸运的是，一位陌生人帮了我。","type":"sentence","level":"B2","noTest":true}
    ,{"id":"seed_wb_76_s_mc04","content":"I had my luggage stolen on the cruise.","meaning":"我在游轮上行李被偷了。","type":"sentence","level":"B2","noTest":true}
    ,{"id":"seed_wb_77_mc28","content":"allergic","meaning":"过敏的","type":"word","level":"B2","ph":"/əˈlɜːdʒɪk/"}
    ,{"id":"seed_wb_78_mc28","content":"allergy","meaning":"过敏（症）","type":"word","level":"B2","ph":"/ˈælədʒi/"}
    ,{"id":"seed_wb_79_mc28","content":"subscription","meaning":"订阅（服务）","type":"word","level":"B2","ph":"/səbˈskrɪpʃn/"}
    ,{"id":"seed_wb_80_mc28","content":"assistant","meaning":"助手；店员","type":"word","level":"B2","ph":"/əˈsɪstənt/"}
    ,{"id":"seed_wb_81_mc28","content":"assist","meaning":"协助；帮助","type":"word","level":"B2","ph":"/əˈsɪst/"}
    ,{"id":"seed_wb_82_mc28","content":"assistance","meaning":"帮助；协助","type":"word","level":"B2","ph":"/əˈsɪstəns/"}
    ,{"id":"seed_wb_83_mc28","content":"complaint","meaning":"投诉；抱怨","type":"word","level":"B2","ph":"/kəmˈpleɪnt/"}
    ,{"id":"seed_wb_84_mc28","content":"annoyed","meaning":"恼火的；烦的","type":"word","level":"B2","ph":"/əˈnɔɪd/"}
    ,{"id":"seed_wb_85_mc28","content":"angry","meaning":"生气的","type":"word","level":"B2","ph":"/ˈæŋɡri/"}
    ,{"id":"seed_wb_86_mc28","content":"disappointed","meaning":"失望的","type":"word","level":"B2","ph":"/ˌdɪsəˈpɔɪntɪd/"}
    ,{"id":"seed_wb_87_mc28","content":"have / cancel a subscription","meaning":"订阅／取消订阅","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_88_mc28","content":"take ages to do sth","meaning":"做某事花很长时间","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_89_mc28","content":"carry on doing sth","meaning":"继续做某事","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_90_mc28","content":"carry on with sth","meaning":"继续做某事","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_91_mc28","content":"offer any help","meaning":"提供任何帮助","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_92_g_mc28","content":"第二条件句（与现在事实相反）","meaning":"If + 一般过去时, would / could / might + 动词原形。If I were you, I would complain. 如果我是你，我就会投诉。be 动词统一用 were。","type":"grammar","level":"B2","noTest":true}
    ,{"id":"seed_wb_93_g_mc28","content":"第三条件句（与过去事实相反）","meaning":"If + had done, would / could / might + have done。If they had replied, I would have used the company again. 如果他们当时回复了，我就会继续用这家公司。","type":"grammar","level":"B2","noTest":true}
    ,{"id":"seed_wb_94_g_mc28","content":"条件句易错点","meaning":"❌ If I would have known ✅ If I had known。条件从句里不用 would，主句才用 would + have done。","type":"grammar","level":"B2","noTest":true}
    ,{"id":"seed_wb_95_s_mc28","content":"I had an unpleasant experience when I ordered a subscription online.","meaning":"我在网上订购一项订阅服务时有过一次不愉快的经历。","type":"sentence","level":"B2","noTest":true}
    ,{"id":"seed_wb_96_s_mc28","content":"It happened last month.","meaning":"这件事发生在上个月。","type":"sentence","level":"B2","noTest":true}
    ,{"id":"seed_wb_97_s_mc28","content":"I expected that they would reply within a day.","meaning":"我原本期望他们一天内回复。","type":"sentence","level":"B2","noTest":true}
    ,{"id":"seed_wb_98_s_mc28","content":"But nobody answered my emails or offered any help.","meaning":"但没有人回复我的邮件，也没有提供任何帮助。","type":"sentence","level":"B2","noTest":true}
    ,{"id":"seed_wb_99_s_mc28","content":"I felt annoyed and disappointed.","meaning":"我感到恼火又失望。","type":"sentence","level":"B2","noTest":true}
    ,{"id":"seed_wb_100_s_mc28","content":"If they had replied, I would use the company again.","meaning":"如果他们当时回复了，我就会继续用这家公司。","type":"sentence","level":"B2","noTest":true}
    ,{"id":"seed_wb_101_mc04","content":"but","meaning":"转折：后面常跟真正的麻烦或结果","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_102_mc04","content":"luckily","meaning":"幸运的是：引出化险为夷的部分","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_103_mc04","content":"eventually","meaning":"最终：强调经过一段曲折后才发生","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_104_mc04","content":"in the end","meaning":"最后：与 eventually 近义，用于收尾","type":"phrase","level":"B2"}

    ,{"id":"seed_wb_1_mc38","content":"excuse","meaning":"借口；理由","type":"word","level":"B2","ph":"/ɪkˈskjuːs/"}
    ,{"id":"seed_wb_2_mc38","content":"slippery","meaning":"滑的","type":"word","level":"B2","ph":"/ˈslɪpəri/"}
    ,{"id":"seed_wb_3_mc38","content":"incorrect","meaning":"不正确的","type":"word","level":"B2","ph":"/ˌɪnkəˈrekt/"}
    ,{"id":"seed_wb_4_mc38","content":"sudden","meaning":"突然的","type":"word","level":"B2","ph":"/ˈsʌdn/"}
    ,{"id":"seed_wb_5_mc38","content":"accident","meaning":"事故；意外","type":"word","level":"B2","ph":"/ˈæksɪdənt/"}
    ,{"id":"seed_wb_6_mc38","content":"attend","meaning":"参加；出席","type":"word","level":"B2","ph":"/əˈtend/"}
    ,{"id":"seed_wb_7_mc38","content":"reported speech","meaning":"间接引语；转述","type":"word","level":"B2","ph":"/rɪˈpɔːtɪd spiːtʃ/"}
    ,{"id":"seed_wb_8_mc38","content":"direct speech","meaning":"直接引语","type":"word","level":"B2","ph":"/dəˈrekt spiːtʃ/"}
    ,{"id":"seed_wb_9_mc38","content":"make excuses","meaning":"找借口","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_10_mc38","content":"around here / there","meaning":"在这附近 / 在那附近","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_11_mc38","content":"a sudden road accident","meaning":"一起突发的交通事故","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_12_mc38","content":"be attending a meeting","meaning":"正在开会","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_13_mc38","content":"give the date of …","meaning":"提供…的日期","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_14_mc38","content":"the time is wrong / incorrect","meaning":"时间（显示）不对","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_15_mc38","content":"say that + 从句","meaning":"说……","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_16_mc38","content":"tell sb that + 从句","meaning":"告诉某人……","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_17_mc38","content":"a pair of glasses","meaning":"一副眼镜","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_18_mc38","content":"watch the time","meaning":"看时间","type":"phrase","level":"B2"}
    ,{"id":"seed_wb_19_g_mc38","content":"一般现在时 → 一般过去时","meaning":"\"I travel a lot in my job.\" → Jane said that she travelled a lot in her job. travel → travelled（英式双写 l）。","type":"grammar","level":"B2","noTest":true}
    ,{"id":"seed_wb_20_g_mc38","content":"现在进行时 → 过去进行时","meaning":"\"I'm making a cake.\" → Jake told me he was making a cake. am/is → was。","type":"grammar","level":"B2","noTest":true}
    ,{"id":"seed_wb_21_g_mc38","content":"现在完成时 → 过去完成时","meaning":"\"I've finished my task.\" → James said he had finished his task. have done → had done。","type":"grammar","level":"B2","noTest":true}
    ,{"id":"seed_wb_22_g_mc38","content":"一般过去时 → 过去完成时","meaning":"\"I had sushi last week.\" → Sue said she had had sushi last week. had（吃）→ had had。","type":"grammar","level":"B2","noTest":true}
    ,{"id":"seed_wb_23_g_mc38","content":"过去进行时 → 过去完成进行时","meaning":"\"It was raining all day.\" → He told me it had been raining all day. was doing → had been doing。","type":"grammar","level":"B2","noTest":true}
    ,{"id":"seed_wb_24_g_mc38","content":"say vs tell","meaning":"say (that)… 不接人；tell sb (that)… 必须接人。❌ Jane said me… ✅ Jane told me… / Jane said that…","type":"grammar","level":"B2","noTest":true}
    ,{"id":"seed_wb_25_s_mc38","content":"Jane said that she travelled a lot in her job.","meaning":"简说她工作里经常出差。","type":"sentence","level":"B2","noTest":true}
    ,{"id":"seed_wb_26_s_mc38","content":"Jake told me he was making a cake.","meaning":"杰克告诉我他在做蛋糕。","type":"sentence","level":"B2","noTest":true}
    ,{"id":"seed_wb_27_s_mc38","content":"Alex said that he had a lot of classes this week.","meaning":"亚历克斯说他这周有很多课。","type":"sentence","level":"B2","noTest":true}
    ,{"id":"seed_wb_28_s_mc38","content":"Alex told me that he was going to watch a movie later.","meaning":"亚历克斯告诉我他晚点要去看电影。","type":"sentence","level":"B2","noTest":true}
    ,{"id":"seed_wb_29_s_mc38","content":"Alex said that they had played football last week.","meaning":"亚历克斯说他们上周踢了足球。","type":"sentence","level":"B2","noTest":true}
    ,{"id":"seed_wb_30_s_mc38","content":"I was attending a meeting.","meaning":"我当时正在开会。","type":"sentence","level":"B2","noTest":true}
    ,{"id":"seed_wb_31_s_mc38","content":"The floor was slippery.","meaning":"地板很滑。","type":"sentence","level":"B2","noTest":true}
    ,{"id":"seed_wb_32_s_mc38","content":"Other department didn't give the date of this project.","meaning":"其他部门没有提供这个项目的日期。","type":"sentence","level":"B2","noTest":true}
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
