/* 瀏覽計數器 —— 直接呼叫 Supabase REST，不載入 SDK。
 *
 * 頁面上任何 <span class="counter" data-slug="xxx"> 都會被填入次數：
 *   - data-slug="__total__" 顯示全站總和
 *   - 其餘顯示該 slug 的次數
 * 目前頁面的 slug 由 <body> 的 data-page-slug 決定，載入時 +1。
 *
 * 沒設定 Supabase 時 build.mjs 根本不會載入這支檔案，計數器維持 "—"。
 */
(function () {
  'use strict';

  var cfg = window.SITE_SUPABASE;
  if (!cfg || !cfg.url || !cfg.anonKey) return;

  var base = cfg.url.replace(/\/+$/, '');
  var headers = {
    apikey: cfg.anonKey,
    Authorization: 'Bearer ' + cfg.anonKey,
    'Content-Type': 'application/json',
  };

  var pageSlug = document.body.getAttribute('data-page-slug') || '';

  function fmt(n) {
    return typeof n === 'number' ? n.toLocaleString('zh-Hant') : '—';
  }

  function render(counts) {
    var total = 0;
    Object.keys(counts).forEach(function (k) { total += counts[k]; });

    document.querySelectorAll('.counter').forEach(function (el) {
      var slug = el.getAttribute('data-slug');
      var v = slug === '__total__' ? total : counts[slug];
      el.textContent = typeof v === 'number' ? fmt(v) : '0';
    });
  }

  /* 同一個瀏覽階段內對同一頁只計一次，避免重新整理灌水 */
  function shouldCount(slug) {
    if (!slug) return false;
    try {
      var key = 'viewed:' + slug;
      if (sessionStorage.getItem(key)) return false;
      sessionStorage.setItem(key, '1');
      return true;
    } catch (e) {
      return true; // 無痕模式等情況：照計
    }
  }

  function increment(slug) {
    return fetch(base + '/rest/v1/rpc/' + cfg.rpc, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ page_slug: slug }),
    }).catch(function () { /* 計數失敗不影響閱讀 */ });
  }

  function fetchAll() {
    return fetch(base + '/rest/v1/' + cfg.table + '?select=slug,views', { headers: headers })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        var counts = {};
        (rows || []).forEach(function (row) { counts[row.slug] = Number(row.views) || 0; });
        return counts;
      })
      .catch(function () { return {}; });
  }

  var task = shouldCount(pageSlug) ? increment(pageSlug) : Promise.resolve();
  task.then(fetchAll).then(render);
})();
