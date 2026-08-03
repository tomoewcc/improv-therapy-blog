#!/usr/bin/env node
// 產生靜態網站：讀 content/*.md → 輸出 docs/
// 首頁的文章卡片在這裡就編譯進 HTML，前端不需要再讀 JSON。

import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, cpSync, existsSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { marked } from 'marked';

const ROOT = dirname(fileURLToPath(import.meta.url));
const CONTENT = join(ROOT, 'content');
const PAGES = join(ROOT, 'pages');
const ASSETS = join(ROOT, 'assets');
const OUT = join(ROOT, 'docs');

const config = JSON.parse(readFileSync(join(ROOT, 'site.config.json'), 'utf8'));
// 首頁 landing 的全部文案與清單。缺檔時退回空物件，首頁只剩文章卡片。
const landing = existsSync(join(ROOT, 'landing.json'))
  ? JSON.parse(readFileSync(join(ROOT, 'landing.json'), 'utf8'))
  : {};

/* ---------- 小工具 ---------- */

const esc = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const attr = (s = '') => esc(s);

/* ---------- 下線模式 ----------
   site.config.json 把 offline 設為 true：只產生一頁告示，
   文章、圖片、社群預覽圖完全不會進 docs/，等於網路上讀不到任何內容。
   要重新上架，把 offline 改回 false 再 npm run build 即可，原始檔都還在。 */
if (config.offline) {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  // 只帶 favicon，不複製任何文章圖片
  if (existsSync(join(ASSETS, 'favicon.svg'))) {
    mkdirSync(join(OUT, 'assets'), { recursive: true });
    cpSync(join(ASSETS, 'favicon.svg'), join(OUT, 'assets', 'favicon.svg'));
  }

  const notice = config.offlineNotice || '網站整理中，暫時關閉。';
  writeFileSync(join(OUT, 'index.html'), `<!doctype html>
<html lang="${attr(config.lang || 'zh-Hant')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(config.title)}</title>
<meta name="robots" content="noindex, nofollow">
<link rel="icon" type="image/svg+xml" href="assets/favicon.svg">
<style>
  *,*::before,*::after{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;padding:2rem;
    background:#f7f5f1;color:#23262b;line-height:1.8;
    font-family:"Noto Sans TC","PingFang TC",system-ui,-apple-system,sans-serif;
    overflow-wrap:break-word}
  main{max-width:30rem;text-align:center}
  h1{font-size:clamp(1.3rem,5vw,1.7rem);margin:0 0 .75rem;line-height:1.4}
  p{margin:0 0 1rem;color:#6c7178;font-size:.95rem}
  a{color:#a63f52}
  .mark{font-size:2rem;margin-bottom:1rem}
  @media(prefers-color-scheme:dark){
    body{background:#1c1f24;color:#e9e7e3}
    p{color:#a7aab0}
    a{color:#6fc4b8}
  }
</style>
</head>
<body>
<main>
  <div class="mark" aria-hidden="true">🎭</div>
  <h1>${esc(config.title)}</h1>
  <p>${esc(notice)}</p>
  <p>課程資訊與文章請見 <a href="https://www.chiachipsy.com/">chiachipsy.com</a></p>
</main>
</body>
</html>
`);
  writeFileSync(join(OUT, '.nojekyll'), '');
  console.log('✓ 下線模式：只產生告示頁 → docs/');
  console.log('  文章、圖片、社群預覽圖皆未輸出。改 site.config.json 的 offline 為 false 可恢復。');
  process.exit(0);
}

/** 取得檔案最後更新時間：優先用 git 最後一次 commit 時間，否則退回檔案 mtime */
function lastUpdated(filePath) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cI', '--', filePath], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (out) return out.slice(0, 10);
  } catch { /* 尚未 commit 或不在 git repo 內 */ }
  return new Date(statSync(filePath).mtime).toISOString().slice(0, 10);
}

/** 解析 front matter（--- 之間的 key: value） */
function parseFrontMatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    meta[kv[1]] = v;
  }
  return { meta, body: m[2] };
}

/** 從檔名或 front matter 決定網址 slug */
function toSlug(file, meta) {
  if (meta.slug) return meta.slug;
  return basename(file, '.md').replace(/^\d+[-_]/, '');
}

/* ---------- 圖片授權標示 ---------- */

/** 組出 CC BY 要求的標示：作品名 / 作者 / 授權條款，各自帶連結 */
function creditHtml(credit) {
  if (!credit) return '';
  const has = credit.title || credit.author || credit.license;
  if (!has) return '';

  const link = (text, url) =>
    url ? `<a href="${attr(url)}" rel="noopener noreferrer" target="_blank">${esc(text)}</a>` : esc(text);

  // CC 圖用「by 作者」；出版社／自有圖用 authorPrefix 改成「圖片提供」之類的說法，
  // 不要硬套一個實際上不存在的授權條款。
  const authorPrefix = credit.authorPrefix || 'by';

  const parts = [];
  if (credit.title) parts.push(link(credit.title, credit.titleUrl || credit.sourceUrl));
  if (credit.author) parts.push(`${authorPrefix} ${link(credit.author, credit.authorUrl)}`);
  if (credit.license) parts.push(`授權條款 ${link(credit.license, credit.licenseUrl)}`);

  return `<p class="credit">${esc(credit.prefix || '首圖')}：${parts.join('，')}</p>`;
}

/** 文章 front matter 裡的授權欄位攤平成物件 */
function creditFromMeta(meta) {
  if (!meta.heroCreditTitle && !meta.heroCreditAuthor && !meta.heroCreditLicense) return null;
  return {
    title: meta.heroCreditTitle,
    titleUrl: meta.heroCreditSourceUrl,
    author: meta.heroCreditAuthor,
    authorUrl: meta.heroCreditAuthorUrl,
    license: meta.heroCreditLicense,
    licenseUrl: meta.heroCreditLicenseUrl,
  };
}

/* ---------- 版型 ---------- */

// 新版 publishable key 優先，找不到才用舊版 anon key
const supabaseKey = config.supabase?.publishableKey || config.supabase?.anonKey || '';
const supabaseReady = Boolean(config.supabase?.url && supabaseKey);

/* ---------- 獨立頁面（關於我等，非文章）---------- */

const pages = (existsSync(PAGES) ? readdirSync(PAGES).filter((f) => f.endsWith('.md')) : [])
  .map((f) => {
    const full = join(PAGES, f);
    const { meta, body } = parseFrontMatter(readFileSync(full, 'utf8'));
    const slug = meta.slug || basename(f, '.md');
    return {
      slug,
      title: meta.title || slug,
      description: meta.description || '',
      updated: lastUpdated(full),
      ogImage: meta.ogImage || '',
      inNav: meta.nav === 'true',
      navLabel: meta.navLabel || meta.title || slug,
      navOrder: Number(meta.navOrder || 99),
      html: marked.parse(cjkBold(body)),
      url: `${slug}/`,
    };
  });

const navPages = pages.filter((p) => p.inNav).sort((a, b) => a.navOrder - b.navOrder);

/** 頁首導覽列；depth 決定相對路徑要往上幾層。
 *  landing.json 的 nav 用的是 #錨點，在文章頁要補回 index.html 才跳得回首頁對應區塊。 */
function navHtml(depth) {
  const base = depth > 0 ? '../'.repeat(depth) : '';
  const items = Array.isArray(landing.nav) && landing.nav.length
    ? landing.nav
    : [{ label: '全部文章', href: '#posts' }];

  const links = items.map((n) => {
    const href = n.href.startsWith('#')
      ? (depth > 0 ? `${base}index.html${n.href}` : n.href)
      : `${base}${n.href}`;
    return `<a href="${attr(href)}">${esc(n.label)}</a>`;
  }).concat(navPages.map((p) => `<a href="${base}${attr(p.url)}">${esc(p.navLabel)}</a>`));

  return links.join('\n      ');
}

/** 產生 1200×630 的社群預覽圖（og:image）。
 *  來源沒有變動就沿用既有檔案，所以重複建置不會一直重跑 sips。
 *  sips 是 macOS 內建工具；在其他平台建置會跳過並提示。 */
let ogSkipped = false;
function ensureOgImage(srcRel, name) {
  if (!srcRel) return '';
  const src = join(ROOT, srcRel);
  if (!existsSync(src)) return '';

  const outRel = `assets/og/${name}.jpg`;
  const out = join(ROOT, outRel);
  if (existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs) return outRel;

  const W = 1200, H = 630;
  try {
    mkdirSync(join(ASSETS, 'og'), { recursive: true });

    // 等比放大／縮小到「兩邊都不小於 1200×630」，再置中裁切。
    // 不能只用 -Z（那是 fit，長邊對齊）—— 直式或超寬的來源會被 sips 補上白邊。
    const info = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', src], { encoding: 'utf8' });
    const sw = Number(/pixelWidth:\s*(\d+)/.exec(info)?.[1]);
    const sh = Number(/pixelHeight:\s*(\d+)/.exec(info)?.[1]);
    const fitByHeight = sw && sh && sw / sh > W / H;   // 來源比目標寬 → 對齊高度
    const resample = fitByHeight ? ['--resampleHeight', String(H)] : ['--resampleWidth', String(W)];

    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '80',
      ...resample, src, '--out', out], { stdio: 'ignore' });
    execFileSync('sips', ['-c', String(H), String(W), out], { stdio: 'ignore' });
    return outRel;
  } catch {
    ogSkipped = true;
    return '';
  }
}

/** 相對路徑轉成絕對網址 —— 社群平台不接受相對的 og:image */
function absUrl(rel) {
  const base = (config.baseUrl || '').replace(/\/+$/, '');
  if (!rel) return '';
  if (/^https?:\/\//.test(rel)) return rel;
  return base ? `${base}/${rel.replace(/^\/+/, '')}` : '';
}

/** 圖檔還沒放進 assets/ 時就不要渲染 hero，免得出現破圖 */
const missingHero = new Set();
function heroExists(src) {
  if (!src) return false;
  const ok = existsSync(join(ROOT, src));
  if (!ok) missingHero.add(src);
  return ok;
}

function counterScript() {
  // 沒設定 Supabase 時完全不載入，計數器位置會顯示為 "—"
  if (!supabaseReady) return '';
  return `<script>window.SITE_SUPABASE=${JSON.stringify({
    url: config.supabase.url,
    anonKey: supabaseKey,
    table: config.supabase.table || 'page_views',
    rpc: config.supabase.rpc || 'increment_page_view',
  })};</script>
  <script src="${'{{BASE}}'}assets/counter.js" defer></script>`;
}

function layout({ title, description, bodyClass, content, credit, depth, pageSlug, ogImage, ogType, pagePath }) {
  const base = depth > 0 ? '../'.repeat(depth) : '';
  const year = new Date().getFullYear();

  return `<!doctype html>
<html lang="${attr(config.lang || 'zh-Hant')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${attr(description || '')}">
<meta name="author" content="${attr(config.author)}">
<meta property="og:title" content="${attr(title)}">
<meta property="og:description" content="${attr(description || '')}">
<meta property="og:type" content="${attr(ogType || 'website')}">
<meta property="og:site_name" content="${attr(config.title)}">
<meta property="og:locale" content="zh_TW">${absUrl(pagePath) ? `
<meta property="og:url" content="${attr(absUrl(pagePath))}">
<link rel="canonical" href="${attr(absUrl(pagePath))}">` : ''}${absUrl(ogImage) ? `
<meta property="og:image" content="${attr(absUrl(ogImage))}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${attr(description || title)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${attr(absUrl(ogImage))}">` : ''}
<meta name="twitter:title" content="${attr(title)}">
<meta name="twitter:description" content="${attr(description || '')}">
<link rel="stylesheet" href="${base}assets/style.css">
<link rel="icon" type="image/svg+xml" href="${base}assets/favicon.svg">
<link rel="mask-icon" href="${base}assets/favicon.svg" color="#a63f52">
<meta name="theme-color" content="#a63f52">
</head>
<body class="${attr(bodyClass)}" data-page-slug="${attr(pageSlug)}">
<a class="skip-link" href="#main">跳到主要內容</a>

<header class="site-header">
  <div class="wrap-wide">
    <a class="site-title" href="${base}index.html">${esc(config.title)}</a>
    <nav class="site-nav">
      ${navHtml(depth)}
    </nav>
  </div>
</header>

<main id="main">
${content}
</main>

<footer class="site-footer">
  <div class="wrap-wide">
    ${credit || ''}
    <p class="foot-meta">© ${year} ${esc(config.author)} ・ ${esc(config.title)}</p>
    <p class="foot-meta foot-views">
      全站瀏覽：<span class="counter" data-slug="__total__" aria-live="polite">—</span>
    </p>
  </div>
</footer>

${counterScript().replaceAll('{{BASE}}', base)}
</body>
</html>
`;
}

/* ---------- 讀文章 ---------- */

const files = existsSync(CONTENT)
  ? readdirSync(CONTENT).filter((f) => f.endsWith('.md'))
  : [];

const posts = files.map((f) => {
  const full = join(CONTENT, f);
  const raw = readFileSync(full, 'utf8');
  const { meta, body } = parseFrontMatter(raw);
  const slug = toSlug(f, meta);

  return {
    slug,
    title: meta.title || slug,
    date: (meta.date || '').slice(0, 10),
    updated: lastUpdated(full),
    summary: meta.summary || '',
    author: meta.author || config.author,
    hero: meta.hero || '',
    heroAlt: meta.heroAlt || '',
    // 卡片封面；沒指定就沿用文章主圖
    cover: meta.cover || meta.hero || '',
    coverAlt: meta.coverAlt || meta.heroAlt || '',
    credit: creditFromMeta(meta),
    html: marked.parse(cjkBold(body), { mangle: false, headerIds: true }),
    url: `posts/${slug}/`,
  };
});

// 需求 7：最新的在前。以發布日排序，同日則以更新日再排
posts.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.updated || '').localeCompare(a.updated || ''));

/* ---------- 輸出 ---------- */

// OG 圖要先產生，才會被下面的 assets 複製一起帶進 docs/
// 社群預覽圖可以跟 HERO 主視覺分開：立體書封是直式，裁成 1200×630 會切掉大半，
// 分享用的橫幅另外指定 ogSrc 才對得上。沒設 ogSrc 就沿用 HERO 圖。
const homeOgImage = ensureOgImage(config.hero?.ogSrc || config.hero?.src, 'home');
for (const p of posts) p.ogImage = ensureOgImage(p.cover, p.slug);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
if (existsSync(ASSETS)) cpSync(ASSETS, join(OUT, 'assets'), { recursive: true });

// 文章頁
for (const p of posts) {
  const dir = join(OUT, 'posts', p.slug);
  mkdirSync(dir, { recursive: true });

  // 內文大圖用該篇自己的封面，跟首頁卡片一致；沒有封面就不放，
  // 不要退回首頁的實拍照 —— 那張跟文章內容無關。
  const heroSrc = p.cover || p.hero || '';
  const heroAlt = p.coverAlt || p.heroAlt || '';
  const heroBlock = heroExists(heroSrc)
    ? `<figure class="post-cover">
      <img src="../../${attr(heroSrc)}" alt="${attr(heroAlt)}" loading="eager" decoding="async">
    </figure>`
    : '';

  const dates = `<time datetime="${attr(p.date)}">發布 ${esc(p.date)}</time>`
    + (p.updated && p.updated !== p.date
      ? ` <span class="sep">・</span> <time datetime="${attr(p.updated)}">更新 ${esc(p.updated)}</time>`
      : '');

  const content = `<article class="post wrap">
  <header class="post-head">
    <h1>${esc(p.title)}</h1>
    <p class="post-meta">
      <span class="author">作者：${esc(p.author)}</span>
      <span class="sep">・</span>
      ${dates}
      <span class="sep">・</span>
      <span class="views">瀏覽 <span class="counter" data-slug="${attr(p.slug)}" aria-live="polite">—</span></span>
    </p>
  </header>
  ${heroBlock}
  <div class="prose">
${p.html}
  </div>
  <p class="back"><a href="../../index.html">← 回到全部文章</a></p>
</article>`;

  writeFileSync(
    join(dir, 'index.html'),
    layout({
      title: `${p.title} ・ ${config.title}`,
      description: p.summary,
      bodyClass: 'page-post',
      content,
      credit: creditHtml(p.credit || config.hero?.credit),
      depth: 2,
      pageSlug: p.slug,
      // 分享單篇時用該篇自己的封面，圖文才對得上
      ogImage: p.ogImage,
      ogType: 'article',
      pagePath: p.url,
    }),
  );
}

// 首頁：卡片直接寫進 HTML（需求 6）
// 沒有封面圖就整塊略過，不要留一大片空的佔位區
const cards = posts.map((p) => `      <li class="card${heroExists(p.cover) ? '' : ' card-textonly'}">
        ${heroExists(p.cover) ? `<a class="card-link" href="${attr(p.url)}" tabindex="-1" aria-hidden="true">
          <figure class="card-cover"><img src="${attr(p.cover)}" alt="${attr(p.coverAlt)}" loading="lazy" decoding="async"></figure>
        </a>` : ''}
        <div class="card-body">
        <a class="card-link" href="${attr(p.url)}">
          <h2 class="card-title">${esc(p.title)}</h2>
          <p class="card-summary">${esc(p.summary)}</p>
        </a>
        <p class="card-meta">
          <span class="author">${esc(p.author)}</span>
          <span class="sep">・</span>
          <time datetime="${attr(p.date)}">發布 ${esc(p.date)}</time>
          <span class="sep">・</span>
          <time datetime="${attr(p.updated)}">更新 ${esc(p.updated)}</time>
          <span class="sep">・</span>
          <span class="views">瀏覽 <span class="counter" data-slug="${attr(p.slug)}" aria-live="polite">—</span></span>
        </p>
        </div>
      </li>`).join('\n');

// HERO 上的大標可獨立於網站名稱設定；沒設就沿用網站名稱
const heroHeadline = config.hero?.headline || config.title;

/* ---------- landing 各區塊 ---------- */

/** marked 依 CommonMark 的 flanking 規則決定 **粗體** 的起訖，
 *  而中文標點會讓收尾的 ** 不符合 right-flanking：
 *  例如「**⋯⋯是活局。**活局對話」——收尾的 ** 前面是「。」、後面又緊接中文字，
 *  於是整段不會被解析成粗體，星號原樣印出來。
 *  在交給 marked 之前先自己換成 <strong>，繞開這條規則。
 *  程式碼區塊裡的星號要保持原樣，所以先挖走再放回去。 */
function cjkBold(src = '') {
  const stash = [];
  // 佔位符用 NUL，正常文稿不會出現，不會誤傷「第 3 次」這種內容
  let s = String(src).replace(/```[\s\S]*?```|`[^`\n]*`/g,
    (m) => `\u0000${stash.push(m) - 1}\u0000`);
  s = s.replace(/\*\*(?!\s)([\s\S]+?)(?<!\s)\*\*/g, '<strong>$1</strong>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[Number(i)]);
}

/** 段落文字允許用 **粗體**、[連結](網址) 這類行內語法 */
const inline = (s = '') => marked.parseInline(cjkBold(s));

/** 外部連結一律新分頁開啟，並補上 rel 防 tabnabbing */
const ext = (url) => (/^https?:\/\//.test(url) ? ' target="_blank" rel="noopener noreferrer"' : '');

function sectionHead(title, intro) {
  return `<header class="sec-head">
      <h2>${headlineHtml(title)}</h2>${intro ? `
      <p class="sec-intro">${inline(intro)}</p>` : ''}
    </header>`;
}

/** HERO：文字面板 + 選用照片。兩欄在桌機並排，手機自動疊成單欄，
 *  文字永遠不壓在圖上，長中文標題在窄螢幕也不會破框。 */
function heroSection() {
  const h = landing.hero || {};
  const actions = (h.actions || []).map((a) =>
    `<a class="btn ${a.style === 'primary' ? 'btn-primary' : 'btn-ghost'}" href="${attr(a.href)}"${ext(a.href)}>${esc(a.label)}</a>`
  ).join('\n        ');

  const hasImg = heroExists(config.hero?.src);
  // banner = 整幅橫幅（適合本身已含文字的宣傳圖）；side = 圖文並排
  const isBanner = (config.hero?.layout || 'side') === 'banner';

  const img = hasImg
    ? `<figure class="hero-media">
        <img src="${attr(config.hero.src)}" alt="${attr(config.hero.alt)}" loading="eager" decoding="async" fetchpriority="high">
      </figure>`
    : '';
  const media = hasImg && !isBanner ? img : '';
  const banner = hasImg && isBanner
    ? `  <div class="hero-banner wrap-wide">
    ${img}
  </div>\n`
    : '';

  // 破題句先出現，橫幅接在後面：讀者先讀到主張，再看到書
  return `<section class="hero${hasImg ? '' : ' hero-noimg'}${hasImg && isBanner ? ' hero-hasbanner' : ''}">
  <div class="hero-inner wrap-wide">
    <div class="hero-text">
      ${h.eyebrow ? `<p class="eyebrow">${esc(h.eyebrow)}</p>` : ''}
      <h1>${headlineHtml(heroHeadline)}</h1>
      ${h.lead ? `<p class="hero-lead">${headlineHtml(h.lead)}</p>` : ''}
      <p class="book-line">${esc(config.bookTitle || config.title)}${config.bookSubtitle ? `<span class="book-sub">${esc(config.bookSubtitle)}</span>` : ''}</p>
      ${actions ? `<div class="actions">
        ${actions}
      </div>` : ''}
      <p class="intro-meta">
        <span class="author">${esc(config.author)}${config.authorTitle ? `・${esc(config.authorTitle)}` : ''}</span>
        <span class="sep">・</span>
        <span class="views">本頁瀏覽 <span class="counter" data-slug="home" aria-live="polite">—</span></span>
      </p>
    </div>
    ${media}
  </div>
${banner}</section>`;
}

/** 一句反常識主張撐起整頁（參考 Feel-Good Productivity 的作法） */
function thesisSection() {
  const t = landing.thesis;
  if (!t) return '';
  return `<section class="sec sec-thesis" id="thesis">
  <div class="wrap">
    ${sectionHead(t.title)}
    ${t.claim ? `<p class="claim">${headlineHtml(t.claim)}</p>` : ''}
    <div class="prose">
      ${(t.paragraphs || []).map((p) => `<p>${inline(p)}</p>`).join('\n      ')}
    </div>
  </div>
</section>`;
}

/** 讀者不用猜買書後會得到什麼（參考 Atomic Habits 的作法） */
function learnSection() {
  const l = landing.learn;
  if (!l) return '';
  // eyebrow 優先用書裡的篇別（part），沒有才退回流水編號
  const items = (l.items || []).map((it, i) => `      <li class="learn-item">
        <span class="learn-no">${it.part ? esc(it.part) : `<span aria-hidden="true">${String(i + 1).padStart(2, '0')}</span>`}</span>
        <h3>${esc(it.title)}</h3>
        <p>${inline(it.body)}</p>
      </li>`).join('\n');
  return `<section class="sec sec-learn" id="learn">
  <div class="wrap-wide">
    ${sectionHead(l.title, l.intro)}
    <ol class="learn-list">
${items}
    </ol>
  </div>
</section>`;
}

/** 心理測驗區。
 *  q.embed = true  → 直接內嵌 iframe，讀者不用跳分頁。
 *  q.embed = false → 改出一張 CTA 卡片，另開分頁。
 *
 *  OOOPEN Lab 的內嵌是付費加購功能（「流量助攻：將測驗嵌入活動／品牌網頁」）。
 *  沒加購時模組偵測到自己被 iframe 包住，會直接顯示「本模組已關閉嵌入使用」，
 *  所以預設走卡片版；加購後把 landing.json 的 quiz.embed 改成 true 即可。 */
function quizSection() {
  const q = landing.quiz;
  if (!q) return '';
  const target = q.url || q.embedUrl;
  if (!target) return '';

  // 內嵌版才說得出「不用跳走」，卡片版要拿掉，免得文案跟實際行為不符
  const body = [q.body, q.embed ? q.bodyEmbed : ''].filter(Boolean).join('');

  const head = `<header class="sec-head">
      <h2>${headlineHtml(q.title)}</h2>
      ${q.subtitle ? `<p class="sec-sub">${esc(q.subtitle)}</p>` : ''}
      ${body ? `<p class="sec-intro">${inline(body)}</p>` : ''}
    </header>`;

  const inner = q.embed
    ? `<div class="embed embed-quiz">
      <iframe src="${attr(q.embedUrl)}" title="${attr(q.title)}" loading="lazy"
        allow="clipboard-write; fullscreen" referrerpolicy="no-referrer-when-downgrade"></iframe>
    </div>
    <p class="embed-fallback">測驗載入不出來？<a href="${attr(target)}" target="_blank" rel="noopener noreferrer">${esc(q.openLabel || '在新分頁開啟')}</a></p>`
    : `<div class="quiz-card">
      <p class="quiz-mark" aria-hidden="true">🐾</p>
      <p class="quiz-cta-lead">${esc(q.subtitle || q.title)}</p>
      <div class="actions">
        <a class="btn btn-primary" href="${attr(target)}" target="_blank" rel="noopener noreferrer">${esc(q.ctaLabel || '開始測驗')}</a>
      </div>
      ${q.note ? `<p class="quiz-note">${esc(q.note)}</p>` : ''}
    </div>`;

  return `<section class="sec sec-quiz" id="quiz">
  <div class="wrap">
    ${head}
    ${inner}
  </div>
</section>`;
}

/** 影音訪談嵌入 + Podcast 卡片 */
function mediaSection() {
  const m = landing.media;
  if (!m) return '';

  const videos = (m.videos || []).map((v) => `      <li class="video-item">
        <div class="embed embed-video">
          <iframe src="https://www.youtube-nocookie.com/embed/${attr(v.id)}" title="${attr(v.show + '：' + v.title)}"
            loading="lazy" allowfullscreen
            allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerpolicy="strict-origin-when-cross-origin"></iframe>
        </div>
        <p class="video-show">${esc(v.show)}</p>
        <h3 class="video-title">${esc(v.title)}</h3>
        ${v.note ? `<p class="video-note">${esc(v.note)}</p>` : ''}
      </li>`).join('\n');

  const pods = (m.podcasts || []).map((p) => `      <li class="pod-item">
        <a class="pod-link" href="${attr(p.url)}"${ext(p.url)}>
          <p class="pod-show">${esc(p.show)}${p.host ? `<span class="pod-host">${esc(p.host)}</span>` : ''}</p>
          <h3 class="pod-title">${esc(p.title)}</h3>
        </a>
        ${p.note ? `<p class="pod-note">${esc(p.note)}</p>` : ''}
        <p class="pod-go"><a href="${attr(p.url)}"${ext(p.url)}>在 ${esc(p.platform)} 收聽 →</a></p>
      </li>`).join('\n');

  return `<section class="sec sec-media" id="media">
  <div class="wrap-wide">
    ${sectionHead(m.title, m.intro)}
    ${videos ? `<ul class="video-list">
${videos}
    </ul>` : ''}
    ${pods ? `<h3 class="sub-head">${esc(m.podcastsTitle || '')}</h3>
    <ul class="pod-list">
${pods}
    </ul>` : ''}
  </div>
</section>`;
}

function praiseSection() {
  const p = landing.praise;
  if (!p) return '';
  const items = (p.items || []).map((q) => `      <li class="praise-item">
        <blockquote>${esc(q.quote)}</blockquote>
        <p class="praise-by">
          ${q.url ? `<a href="${attr(q.url)}"${ext(q.url)}>${esc(q.name)}</a>` : esc(q.name)}
          ${q.role ? `<span class="praise-role">${esc(q.role)}</span>` : ''}
        </p>
      </li>`).join('\n');
  return `<section class="sec sec-praise" id="praise">
  <div class="wrap-wide">
    ${sectionHead(p.title)}
    <ul class="praise-list">
${items}
    </ul>
  </div>
</section>`;
}

function buySection() {
  const b = landing.buy;
  if (!b) return '';

  const btns = (list) => (list || []).map((l) =>
    `<a class="btn ${l.primary ? 'btn-primary' : 'btn-ghost'}" href="${attr(l.href)}"${ext(l.href)}>${esc(l.label)}</a>`
  ).join('\n          ');

  // 通路多的時候分組（紙本／電子），只有一組就退回單純一排按鈕
  const links = Array.isArray(b.groups) && b.groups.length
    ? b.groups.map((g) => `<div class="buy-group">
        <p class="buy-group-label">${esc(g.label)}</p>
        <div class="actions">
          ${btns(g.links)}
        </div>
      </div>`).join('\n      ')
    : `<div class="actions">
          ${btns(b.links)}
        </div>`;

  const img = heroExists(b.image)
    ? `<figure class="buy-image"><img src="${attr(b.image)}" alt="${attr(b.imageAlt || '')}" loading="lazy" decoding="async"></figure>`
    : '';

  return `<section class="sec sec-buy" id="buy">
  <div class="wrap">
    <div class="buy-card">
      ${img}
      <h2>${esc(b.title)}</h2>
      ${b.intro ? `<p class="buy-intro">${esc(b.intro)}</p>` : ''}
      ${b.meta ? `<p class="buy-meta">${esc(b.meta)}</p>` : ''}
      ${links}
      ${b.extra ? `<p class="buy-extra"><a href="${attr(b.extra.href)}"${ext(b.extra.href)}>${esc(b.extra.label)} →</a></p>` : ''}
    </div>
  </div>
</section>`;
}

function resourcesSection() {
  const r = landing.resources;
  if (!r) return '';
  const items = (r.items || []).map((it) => `      <li class="res-item">
        <a href="${attr(it.href)}"${ext(it.href)}>
          <span class="res-label">${esc(it.label)}</span>
          <span class="res-title">${esc(it.title)}</span>
          ${it.note ? `<span class="res-note">${esc(it.note)}</span>` : ''}
        </a>
      </li>`).join('\n');
  return `<section class="sec sec-res" id="resources">
  <div class="wrap-wide">
    ${sectionHead(r.title, r.intro)}
    <ul class="res-list">
${items}
    </ul>
  </div>
</section>`;
}

function readingSection() {
  const r = landing.reading;
  if (!r) return '';
  const items = (r.items || []).map((it) => `      <li class="read-item">
        <p class="read-cond">${esc(it.condition)}</p>
        <h3><a href="${attr(it.href)}"${ext(it.href)}>${esc(it.title)}</a></h3>
        ${it.note ? `<p class="read-note">${esc(it.note)}</p>` : ''}
        ${it.extraHref ? `<p class="read-extra"><a href="${attr(it.extraHref)}"${ext(it.extraHref)}>${esc(it.extraLabel)} →</a></p>` : ''}
      </li>`).join('\n');
  return `<section class="sec sec-read" id="reading">
  <div class="wrap-wide">
    ${sectionHead(r.title)}
    <ul class="read-list">
${items}
    </ul>
  </div>
</section>`;
}

/** 常見問題。題目來自實際的社群疑問，每題標出書中對應的篇章。
 *  用 <details> 讓讀者自己展開，一次只讀他關心的那幾題；
 *  但 open 屬性給第一題，避免整區看起來像一片摺疊的清單。 */
function faqSection() {
  const f = landing.faq;
  if (!f || !Array.isArray(f.items) || !f.items.length) return '';

  const items = f.items.map((it, i) => `      <li class="faq-item">
        <details${i === 0 ? ' open' : ''}>
          <summary><span class="faq-q">${esc(it.q)}</span></summary>
          <div class="faq-a">
            <p>${inline(it.a)}</p>
            ${it.chapter ? `<p class="faq-ch">書中對應：${esc(it.chapter)}</p>` : ''}
          </div>
        </details>
      </li>`).join('\n');

  return `<section class="sec sec-faq" id="faq">
  <div class="wrap">
    ${sectionHead(f.title, f.intro)}
    <ul class="faq-list">
${items}
    </ul>
  </div>
</section>`;
}

function authorSection() {
  const a = landing.author;
  if (!a) return '';
  const photo = heroExists(a.photo)
    ? `<figure class="author-photo"><img src="${attr(a.photo)}" alt="${attr(a.photoAlt || a.name)}" loading="lazy" decoding="async"></figure>`
    : '';
  const links = (a.links || []).map((l) =>
    `<a href="${attr(l.href)}"${ext(l.href)}>${esc(l.label)}</a>`).join('\n          ');
  return `<section class="sec sec-author" id="author">
  <div class="wrap">
    <div class="author-card">
      ${photo}
      <div class="author-body">
        <h2>${esc(a.title)}</h2>
        <p class="author-name">${esc(a.name)}<span class="author-role">${esc(a.role || '')}</span></p>
        ${(a.paragraphs || []).map((p) => `<p>${inline(p)}</p>`).join('\n        ')}
        ${links ? `<p class="author-links">
          ${links}
        </p>` : ''}
      </div>
    </div>
  </div>
</section>`;
}

/** 中文大字若逐字流動，換行常切在詞中間（例如把「溝通」拆開）。
 *  以標點為界切段，每段包成 inline-block：換行優先發生在段與段之間。
 *  單段若真的比容器寬，inline-block 仍會自己折行，不會撐破版面。 */
function headlineHtml(text) {
  const parts = String(text).split(/(?<=[：，、；。？！])/).filter(Boolean);
  if (parts.length < 2) return esc(text);
  return parts.map((p) => `<span class="hl-seg">${esc(p)}</span>`).join('');
}

const postsSec = landing.postsSection || {};

// 首頁：landing 各區塊 + 文章卡片。卡片在這裡就編譯進 HTML（需求 6）
const home = [
  heroSection(),
  thesisSection(),
  learnSection(),
  quizSection(),
  mediaSection(),
  praiseSection(),
  buySection(),
  resourcesSection(),
  readingSection(),
  faqSection(),
  authorSection(),
  `<section class="sec listing" id="posts">
  <div class="wrap-wide">
    <h2 class="listing-title">${esc(postsSec.title || '延伸文章')}<span class="count">（${posts.length}）</span></h2>
    <ul class="cards">
${cards || `      <li class="card empty">${esc(postsSec.empty || '還沒有文章。')}</li>`}
    </ul>
  </div>
</section>`,
].filter(Boolean).join('\n');

writeFileSync(
  join(OUT, 'index.html'),
  layout({
    title: config.bookSubtitle ? `${config.title}：${config.bookSubtitle}` : config.title,
    description: config.description,
    bodyClass: 'page-home',
    content: home,
    credit: creditHtml(config.hero?.credit),
    depth: 0,
    pageSlug: 'home',
    // 分享首頁時用 HERO 圖
    ogImage: homeOgImage,
    ogType: 'website',
    pagePath: '/',
  }),
);

// 獨立頁面
for (const pg of pages) {
  const dir = join(OUT, pg.slug);
  mkdirSync(dir, { recursive: true });

  const content = `<article class="post wrap">
  <header class="post-head">
    <h1>${esc(pg.title)}</h1>
    <p class="post-meta"><time datetime="${attr(pg.updated)}">最後更新 ${esc(pg.updated)}</time></p>
  </header>
  <div class="prose">
${pg.html}
  </div>
</article>`;

  writeFileSync(
    join(dir, 'index.html'),
    layout({
      title: `${pg.title} ・ ${config.title}`,
      description: pg.description,
      bodyClass: 'page-static',
      content,
      credit: '',
      depth: 1,
      pageSlug: pg.slug,
      ogImage: pg.ogImage || homeOgImage,
      ogType: 'profile',
      pagePath: pg.url,
    }),
  );
}

// GitHub Pages 不要用 Jekyll 處理
writeFileSync(join(OUT, '.nojekyll'), '');

console.log(`✓ 建置完成：${posts.length} 篇文章、${pages.length} 個獨立頁面 → docs/`);
for (const pg of pages) console.log(`  · ${pg.title}  → ${pg.slug}/`);
for (const p of posts) console.log(`  - ${p.date}  ${p.title}  → posts/${p.slug}/`);
if (!supabaseReady) console.log('  ! Supabase 尚未設定，計數器顯示為 “—”（版型位置已保留）');
for (const src of missingHero) console.log(`  ! 找不到圖檔 ${src}，該頁 HERO 區暫時略過`);
if (ogSkipped) console.log('  ! sips 不可用，og:image 未產生（此工具僅 macOS 內建）');
if (!config.baseUrl) console.log('  ! site.config.json 的 baseUrl 是空的，og:image 需要絕對網址才會生效');
