/* ============================================================
 * practice_publish.js  —  课后练习「发布到各模块」+ 云同步共享库
 * 被以下页面引入：
 *   - 课后练习.html        （作为编辑/同步中枢；设置 window.__practiceEditor=true）
 *   - 词汇拼写训练营.html   （mergeSpelling）
 *   - 英语测试达人.html     （mergeTestMaster）
 *   - 学习模块.html         （mergeLearningModule）
 *   - 英语学习手册.html     （mergeHandbook，DOMContentLoaded 自动执行）
 *
 * 设计要点：
 *  1) 课后练习是唯一编辑入口；发布内容存 localStorage['english_practice_published']。
 *  2) 4 个工具在加载时读取该 localStorage 并注入；不支持发布的设备只要打开过
 *     课后练习（它会自动从云拉取）即可看到。
 *  3) 云同步复用 GitHub Gist：token 与「测试达人」共享（testmaster_sync_token），
 *     gist 用独立文件 english_practice_sync.json，与测试达人互不干扰。
 *  4) 4 个工具额外做 best-effort 的云端刷新：若云端 published 更新，则更新本地
 *     并自动刷新一次页面，保证跨设备一致。
 * ============================================================ */
(function () {
  'use strict';

  var STORE_KEY = 'english_practice_published';   // 已发布条目数组
  var SYNC_TOKEN_KEY = 'practice_sync_token';      // 专用令牌 key（默认回退测试达人）
  var SYNC_GIST_KEY = 'practice_sync_gist';        // 专用 Gist id key
  var SYNC_FILE = 'english_practice_sync.json';     // Gist 内文件名
  var TESTMASTER_TOKEN_KEY = 'testmaster_sync_token';

  function getToken() {
    try {
      return localStorage.getItem(SYNC_TOKEN_KEY) || localStorage.getItem(TESTMASTER_TOKEN_KEY) || '';
    } catch (e) { return ''; }
  }
  function getGist() {
    try { return localStorage.getItem(SYNC_GIST_KEY) || ''; } catch (e) { return ''; }
  }
  function setToken(t) { try { if (t) localStorage.setItem(SYNC_TOKEN_KEY, t); else localStorage.removeItem(SYNC_TOKEN_KEY); } catch (e) {} }
  function setGist(g) { try { if (g) localStorage.setItem(SYNC_GIST_KEY, g); else localStorage.removeItem(SYNC_GIST_KEY); } catch (e) {} }

  function apiHeaders(token) {
    return { 'Authorization': 'token ' + token, 'Content-Type': 'application/json', 'Accept': 'application/vnd.github.v3+json' };
  }

  /* ---------- 发布条目读写 ---------- */
  function loadPublished() {
    try { var a = JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function savePublished(arr) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(arr)); } catch (e) {}
  }

  function normalizeEntry(e) {
    if (!e || !e.lesson) return null;
    // 词汇条目：支持字符串或 {en,cn,ph}；按 "/"、"," 拆分成独立词条，便于拼写/测试
    var vocab = [];
    (e.vocab || []).forEach(function (v) {
      var raw = (typeof v === 'string') ? v : (v && v.en ? v.en : '');
      var cn = (v && v.cn) ? v.cn : '';
      if (!raw) return;
      raw.split('/').forEach(function (part) {
        part.split(',').forEach(function (p) {
          p = (p || '').trim();
          if (p) vocab.push({ en: p, cn: cn });
        });
      });
    });
    var patterns = (e.patterns || []).filter(function (v) { return (v || '').trim(); });
    return {
      lesson: e.lesson,
      level: e.level || 'B2',
      vocab: vocab,
      patterns: patterns,
      savedAt: e.savedAt || Date.now()
    };
  }

  // 由 课后练习 调用：新增/更新某课的发布内容（按 lesson 去重替换，保留较新者）
  function publishLesson(lesson, vocab, patterns, level) {
    if (!lesson) return false;
    var entry = normalizeEntry({ lesson: lesson, level: level || 'B2', vocab: vocab || [], patterns: patterns || [] });
    if (!entry) return false;
    var arr = loadPublished();
    var keep = arr.filter(function (x) { return x.lesson !== lesson; });
    keep.push(entry);
    savePublished(keep);
    return true;
  }
  function unpublishLesson(lesson) {
    savePublished(loadPublished().filter(function (x) { return x.lesson !== lesson; }));
  }

  // 把远端 published 数组合并进本地（按 lesson 去重，远端较新则覆盖）
  function mergePublishedIntoLocal(remoteArr) {
    if (!Array.isArray(remoteArr) || !remoteArr.length) return false;
    var local = loadPublished();
    var map = {};
    local.forEach(function (e) { if (e && e.lesson) map[e.lesson] = e; });
    var changed = false;
    remoteArr.forEach(function (e) {
      var n = normalizeEntry(e); if (!n) return;
      var cur = map[n.lesson];
      if (!cur || (n.savedAt || 0) > (cur.savedAt || 0)) { map[n.lesson] = n; changed = true; }
    });
    if (changed) {
      var out = []; Object.keys(map).forEach(function (k) { out.push(map[k]); });
      savePublished(out);
    }
    return changed;
  }

  /* ---------- 合并到 词汇拼写训练营 ---------- */
  function mergeSpelling(WORDS) {
    if (!WORDS || typeof WORDS.push !== 'function') return;
    var arr = loadPublished();
    if (!arr.length) return;
    var existing = {};
    WORDS.forEach(function (w) { if (w && w.en) existing[w.en.toLowerCase()] = 1; });
    arr.forEach(function (entry) {
      var topic = '课后练习·' + entry.lesson;
      entry.vocab.forEach(function (v) {
        var en = (typeof v === 'string' ? v : (v && v.en)) || '';
        en = en.trim();
        if (!en) return;
        if (existing[en.toLowerCase()]) return;
        existing[en.toLowerCase()] = 1;
        // opts 留空 -> 拼写训练营会自动生成干扰项
        WORDS.push({
          en: en,
          cn: (v && v.cn) || '',
          ph: (v && v.ph) || '',
          topic: topic,
          level: entry.level || 'B2',
          opts: [],
          explain: '来自课后练习 ' + entry.lesson + '。'
        });
      });
    });
  }

  /* ---------- 合并到 英语测试达人 ---------- */
  function mergeTestMaster(Q) {
    if (!Q) return;
    var arr = loadPublished();
    if (!arr.length) return;
    if (!Q.vocab) Q.vocab = [];
    if (!Q.phrase) Q.phrase = [];
    var vocabIds = {}; Q.vocab.forEach(function (q) { if (q && q.id) vocabIds[q.id] = 1; });
    var phraseIds = {}; Q.phrase.forEach(function (q) { if (q && q.id) phraseIds[q.id] = 1; });
    arr.forEach(function (entry) {
      var badge = '课后练习·' + entry.lesson;
      entry.vocab.forEach(function (v) {
        var en = (typeof v === 'string' ? v : (v && v.en)) || '';
        en = en.trim();
        if (!en) return;
        var cn = (v && v.cn) || '';
        var id = 'ppv_' + entry.lesson + '_' + en.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (vocabIds[id]) return; vocabIds[id] = 1;
        Q.vocab.push({
          id: id, cat: 'vocab', type: 'type', badge: badge, level: entry.level || 'B2',
          q: '拼写出单词：' + en,
          ans: [en],
          explain: '来自课后练习 ' + entry.lesson + ' 的词汇清单。' + (cn ? ('<br>释义：' + cn) : ''),
          tip: ''
        });
      });
      entry.patterns.forEach(function (p) {
        var pt = p.trim();
        var id = 'ppp_' + entry.lesson + '_' + pt.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (phraseIds[id]) return; phraseIds[id] = 1;
        Q.phrase.push({
          id: id, cat: 'phrase', type: 'type', badge: badge, level: entry.level || 'B2',
          q: '写出句型：' + pt,
          ans: [pt],
          explain: '来自课后练习 ' + entry.lesson + ' 的句型清单。',
          tip: ''
        });
      });
    });
  }

  /* ---------- 合并到 学习模块 ---------- */
  function mergeLearningModule(MODULES) {
    if (!MODULES) return;
    var arr = loadPublished();
    arr.forEach(function (entry) {
      var key = 'prac_' + entry.lesson;
      var mods = [];
      if (entry.vocab.length) {
        var vlist = entry.vocab.map(function (v) {
          var en = (typeof v === 'string' ? v : (v && v.en)) || '';
          var cn = (v && v.cn) || '';
          return '• ' + escHtml(en) + (cn ? (' — ' + escHtml(cn)) : '');
        }).join('<br>');
        mods.push({ type: 'vocab', title: '课后练习词汇 · ' + entry.lesson, content: vlist });
      }
      if (entry.patterns.length) {
        var plist = entry.patterns.map(function (p) { return '• ' + escHtml(p); }).join('<br>');
        mods.push({ type: 'phrase', title: '课后练习句型 · ' + entry.lesson, content: plist });
      }
      MODULES[key] = {
        phase: '📘 课后练习',
        theme: entry.lesson + ' 课后练习',
        icon: '📝',
        level: entry.level || 'B2',
        modules: mods,
        _publish: true
      };
    });
  }

  /* ---------- 合并到 英语学习手册（DOM 注入） ---------- */
  function escHtml(s) {
    return (s == null ? '' : String(s))
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function mergeHandbook() {
    if (typeof document === 'undefined') return;
    var arr = loadPublished();
    injectSection('vocab', 'vocab', arr);
    injectSection('phrase', 'phrase', arr);
  }

  function injectSection(sectionId, kind, arr) {
    var sec = document.getElementById(sectionId);
    if (!sec) return;
    var grid = sec.querySelector('.grid-2') || sec;
    // 清除旧注入
    var old = grid.querySelectorAll('[data-publish]');
    for (var i = 0; i < old.length; i++) { if (old[i].parentNode) old[i].parentNode.removeChild(old[i]); }
    if (!arr.length) { applyCardsSafe(); return; }

    var frag = document.createDocumentFragment();
    arr.forEach(function (entry) {
      if (!entry.vocab.length && !entry.patterns.length) return;
      if (kind === 'vocab' && !entry.vocab.length) return;
      if (kind === 'phrase' && !entry.patterns.length) return;

      var card = document.createElement('div');
      card.className = 'card';
      card.setAttribute('data-publish', entry.lesson);
      card.setAttribute('data-level', entry.level || 'B2');
      card.setAttribute('data-keywords', '课后练习 ' + entry.lesson + (kind === 'vocab' ? ' 词汇' : ' 句型'));

      var title = document.createElement('div');
      title.className = 'card-title';
      title.innerHTML = '📝 课后练习' + (kind === 'vocab' ? '词汇' : '句型') +
        ' <span class="badge badge-' + (kind === 'vocab' ? 'vocab' : 'phrase') + '">' + escHtml(entry.lesson) + '</span>';
      card.appendChild(title);

      var wrap = document.createElement('div');
      wrap.className = 'table-scroll';
      var table = document.createElement('table');
      table.className = 'study-table';
      var tbody = document.createElement('tbody');

      if (kind === 'vocab') {
        tbody.appendChild(makeRow(['英文', '音标', '时态/复数', '中文'], true));
        entry.vocab.forEach(function (v) {
          tbody.appendChild(makeRow([
            '<td class="en">' + escHtml(v.en) + '<span class="spk">🔊</span></td>',
            escHtml(v.ph || ''),
            '',
            escHtml(v.cn || '—')
          ], false));
        });
      } else {
        tbody.appendChild(makeRow(['搭配', '音标', '含义'], true));
        entry.patterns.forEach(function (p) {
          tbody.appendChild(makeRow([
            '<td class="en">' + escHtml(p) + '<span class="spk">🔊</span></td>',
            '',
            '来自课后练习'
          ], false));
        });
      }
      table.appendChild(tbody);
      wrap.appendChild(table);
      card.appendChild(wrap);
      frag.appendChild(card);
    });
    grid.appendChild(frag);
    applyCardsSafe();
  }

  function makeRow(cells, isHeader) {
    var tr = document.createElement('tr');
    cells.forEach(function (c) {
      var td = document.createElement(isHeader ? 'th' : 'td');
      if (isHeader) td.textContent = c;
      else td.innerHTML = c;
      tr.appendChild(td);
    });
    return tr;
  }

  function applyCardsSafe() {
    try { if (window.EnglishLevel && window.EnglishLevel.applyCards) window.EnglishLevel.applyCards(document); }
    catch (e) {}
  }

  /* ---------- 云端读写（GitHub Gist） ---------- */
  function cloudRead(cb) {
    var token = getToken(), gist = getGist();
    if (!token || !gist) { if (cb) cb(null); return; }
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var to = setTimeout(function () { if (ctrl) try { ctrl.abort(); } catch (e) {} }, 7000);
    fetch('https://api.github.com/gists/' + gist, {
      method: 'GET', headers: apiHeaders(token), signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (g) {
        clearTimeout(to);
        var f = g.files && g.files[SYNC_FILE];
        if (f && f.content) { try { if (cb) cb(JSON.parse(f.content)); } catch (e) { if (cb) cb(null); } }
        else if (cb) cb(null);
      })
      .catch(function () { clearTimeout(to); if (cb) cb(null); });
  }

  function cloudWrite(obj, cb) {
    var token = getToken(), gist = getGist();
    if (!token) { if (cb) cb(false, 'no-token'); return; }
    var content = JSON.stringify(obj);
    var body = gist
      ? JSON.stringify({ files: {} }) // placeholder, replaced below
      : JSON.stringify({ description: 'English Practice Sync (auto)', public: false, files: {} });
    var filesObj = {}; filesObj[SYNC_FILE] = { content: content };
    body = gist
      ? JSON.stringify({ files: filesObj })
      : JSON.stringify({ description: 'English Practice Sync (auto)', public: false, files: filesObj });
    var url = gist ? ('https://api.github.com/gists/' + gist) : 'https://api.github.com/gists';
    var method = gist ? 'PATCH' : 'POST';
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var to = setTimeout(function () { if (ctrl) try { ctrl.abort(); } catch (e) {} }, 9000);
    fetch(url, { method: method, headers: apiHeaders(token), body: body, signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (g) {
        clearTimeout(to);
        if (!gist && g && g.id) setGist(g.id);
        if (cb) cb(true, g && g.id ? g.id : gist);
      })
      .catch(function (e) { clearTimeout(to); if (cb) cb(false, e.message); });
  }

  // 4 个工具调用：若云端 published 较新，则更新本地并返回 true
  function refreshFromCloud(cb) {
    cloudRead(function (obj) {
      if (!obj || !Array.isArray(obj.published)) { if (cb) cb(false); return; }
      var localMax = loadPublished().reduce(function (m, e) { return Math.max(m, e.savedAt || 0); }, 0);
      var remoteMax = obj.published.reduce(function (m, e) { return Math.max(m, e.savedAt || 0); }, 0);
      if (remoteMax > localMax) {
        var changed = mergePublishedIntoLocal(obj.published);
        if (cb) cb(changed);
      } else if (cb) cb(false);
    });
  }

  // 课后练习调用：把云端 store+published 合并进本地
  function syncPracticeFromCloud(localStore, cb) {
    cloudRead(function (obj) {
      if (!obj) { if (cb) cb(false); return; }
      var changed = false;
      if (obj.store && typeof obj.store === 'object') {
        Object.keys(obj.store).forEach(function (k) {
          var r = obj.store[k]; if (!r) return;
          var l = localStore[k];
          if (!l || (r.updatedAt || 0) > (l.updatedAt || 0)) { localStore[k] = r; changed = true; }
        });
      }
      if (mergePublishedIntoLocal(obj.published)) changed = true;
      if (cb) cb(changed);
    });
  }

  // 4 个工具：DOM 就绪后 best-effort 刷新云端，若更新则刷新一次页面（带防重入）
  function maybeRefreshAndReload() {
    try {
      if (window.__practiceEditor) return;        // 课后练习自己处理同步
      if (sessionStorage.getItem('pp_refreshed')) return;
      refreshFromCloud(function (updated) {
        if (updated) { sessionStorage.setItem('pp_refreshed', '1'); location.reload(); }
      });
    } catch (e) {}
  }

  // 暴露 API
  window.PracPublish = {
    STORE_KEY: STORE_KEY,
    SYNC_TOKEN_KEY: SYNC_TOKEN_KEY,
    SYNC_GIST_KEY: SYNC_GIST_KEY,
    SYNC_FILE: SYNC_FILE,
    getToken: getToken,
    getGist: getGist,
    setToken: setToken,
    setGist: setGist,
    loadPublished: loadPublished,
    savePublished: savePublished,
    publishLesson: publishLesson,
    unpublishLesson: unpublishLesson,
    mergePublishedIntoLocal: mergePublishedIntoLocal,
    mergeSpelling: mergeSpelling,
    mergeTestMaster: mergeTestMaster,
    mergeLearningModule: mergeLearningModule,
    mergeHandbook: mergeHandbook,
    cloudRead: cloudRead,
    cloudWrite: cloudWrite,
    refreshFromCloud: refreshFromCloud,
    syncPracticeFromCloud: syncPracticeFromCloud,
    maybeRefreshAndReload: maybeRefreshAndReload
  };

  // 英语学习手册：DOM 就绪后注入卡片
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { mergeHandbook(); maybeRefreshAndReload(); });
    } else {
      mergeHandbook(); maybeRefreshAndReload();
    }
  }
})();
