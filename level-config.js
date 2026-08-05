/* ===== 全局级别配置 (B1 / B2) =====
 * - 读写 localStorage.english_level（默认 B1）
 * - 在页面顶部插入常驻 B1/B2 切换条
 * - 提供 window.EnglishLevel 工具：get/set/filter/applyCards
 * - 数据约定：条目无 level 字段 => 视为 B1；level:'B2' => B2
 *   切换级别时严格分离：B2 模式只显示 B2 内容，B1 完全隐藏
 */
(function () {
  'use strict';
  var KEY = 'english_level';
  var BAR_H = 38;

  function get() {
    try { var v = localStorage.getItem(KEY); return (v === 'B2') ? 'B2' : 'B1'; }
    catch (e) { return 'B1'; }
  }
  function set(lv) {
    try { localStorage.setItem(KEY, lv); } catch (e) {}
  }
  // 过滤数组：条目有 level 则匹配，无 level 视为 B1
  function filter(arr, key) {
    key = key || 'level';
    var lv = get();
    if (!Array.isArray(arr)) return arr;
    return arr.filter(function (it) {
      if (it && it[key]) return it[key] === lv;
      return lv === 'B1';
    });
  }
  // 过滤手册类静态卡片（含 data-level 属性的条目；无属性视为 B1）
  function applyCards(root) {
    root = root || document;
    var lv = get();
    var leveled = root.querySelectorAll('[data-level]');
    for (var i = 0; i < leveled.length; i++) {
      var c = leveled[i];
      c.style.display = (c.getAttribute('data-level') === lv) ? '' : 'none';
    }
    // 仅在使用分级约定的页面（存在已分级卡片，如手册）才隐藏未分级 .card，
    // 避免误伤入口页/模块页等以 .card 作为导航或结构容器的页面。
    // 注意：手册速记卡为 .flip-card，不在此选择器范围内，由各自渲染逻辑按级别过滤。
    if (lv === 'B2' && leveled.length > 0) {
      var def = root.querySelectorAll('.card:not([data-level])');
      for (var j = 0; j < def.length; j++) def[j].style.display = 'none';
    }
  }
  // 给手册/页面插入「当前级别暂无内容」提示（在指定容器里）
  function showEmptyNote(container, msg) {
    if (!container) return;
    var n = document.createElement('div');
    n.className = 'level-empty-note';
    n.innerHTML = msg || '当前级别（' + get() + '）暂未添加内容。<br>可在右上角切换到另一级别，或在「学习中心」管理范围。';
    container.appendChild(n);
  }

  function buildBar() {
    var lv = get();
    var bar = document.createElement('div');
    bar.id = 'level-bar';
    bar.innerHTML =
      '<span class="lb-title">📚 级别</span>' +
      '<button class="lb-btn" data-lv="B1">B1</button>' +
      '<button class="lb-btn" data-lv="B2">B2</button>' +
      '<span class="lb-sep"></span>' +
      '<a class="lb-home" href="index.html?v=20260805-1458">⌂ 学习中心</a>';
    document.body.insertBefore(bar, document.body.firstChild);
    document.body.classList.add('has-level-bar');
    var btns = bar.querySelectorAll('.lb-btn');
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].getAttribute('data-lv') === lv) btns[i].classList.add('active');
      btns[i].addEventListener('click', function () {
        var target = this.getAttribute('data-lv');
        if (target === get()) return;
        set(target);
        location.reload();
      });
    }
    // 注入样式
    var st = document.createElement('style');
    st.textContent =
      '#level-bar{position:sticky;top:0;z-index:99999;display:flex;align-items:center;gap:8px;' +
      'padding:6px 12px;background:#fff;border-bottom:1px solid #e5e7eb;' +
      'box-shadow:0 1px 4px rgba(0,0,0,.06);font-size:13px;color:#374151;font-family:inherit}' +
      '#level-bar .lb-title{font-weight:700;color:#6366f1}' +
      '#level-bar .lb-sep{flex:1}' +
      '#level-bar .lb-btn{border:1px solid #d1d5db;background:#fff;color:#374151;border-radius:8px;' +
      'padding:4px 14px;cursor:pointer;font-weight:700;font-size:13px;font-family:inherit}' +
      '#level-bar .lb-btn.active{background:#6366f1;color:#fff;border-color:#6366f1}' +
      '#level-bar .lb-home{color:#6366f1;text-decoration:none;font-weight:700;padding:4px 8px}' +
      'body.has-level-bar .top-bar{top:' + BAR_H + 'px}' +
      '.level-empty-note{padding:40px 20px;text-align:center;color:#6b7280;font-size:15px;line-height:1.8}';
    document.head.appendChild(st);
  }

  window.EnglishLevel = {
    get: get, set: set, filter: filter, applyCards: applyCards, showEmptyNote: showEmptyNote
  };

  function init() {
    buildBar();
    // 手册类静态卡片过滤
    try { applyCards(document); } catch (e) {}
    // 通知各工具重新渲染（若定义了钩子）
    try { if (typeof window.onLevelReady === 'function') window.onLevelReady(get()); } catch (e) {}
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
