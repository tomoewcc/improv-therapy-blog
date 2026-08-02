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
const ASSETS = join(ROOT, 'assets');
const OUT = join(ROOT, 'docs');

const config = JSON.parse(readFileSync(join(ROOT, 'site.config.json'), 'utf8'));

/* ---------- 小工具 ---------- */

const esc = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const attr = (s = '') => esc(s);

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

  const parts = [];
  if (credit.title) parts.push(link(credit.title, credit.titleUrl || credit.sourceUrl));
  if (credit.author) parts.push(`by ${link(credit.author, credit.authorUrl)}`);
  if (credit.license) parts.push(`授權條款 ${link(credit.license, credit.licenseUrl)}`);

  return `<p class="credit">首圖：${parts.join('，')}</p>`;
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

  try {
    mkdirSync(join(ASSETS, 'og'), { recursive: true });
    // 先等比縮到長邊 1200，再置中裁成 1200×630
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '80',
      '-Z', '1200', src, '--out', out], { stdio: 'ignore' });
    execFileSync('sips', ['-c', '630', '1200', out], { stdio: 'ignore' });
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
<link rel="mask-icon" href="${base}assets/favicon.svg" color="#1c6f66">
<meta name="theme-color" content="#1c6f66">
</head>
<body class="${attr(bodyClass)}" data-page-slug="${attr(pageSlug)}">
<a class="skip-link" href="#main">跳到主要內容</a>

<header class="site-header">
  <div class="wrap-wide">
    <a class="site-title" href="${base}index.html">${esc(config.title)}</a>
    <nav class="site-nav"><a href="${base}index.html">全部文章</a></nav>
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
    html: marked.parse(body, { mangle: false, headerIds: true }),
    url: `posts/${slug}/`,
  };
});

// 需求 7：最新的在前。以發布日排序，同日則以更新日再排
posts.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.updated || '').localeCompare(a.updated || ''));

/* ---------- 輸出 ---------- */

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
if (existsSync(ASSETS)) cpSync(ASSETS, join(OUT, 'assets'), { recursive: true });

// 文章頁
for (const p of posts) {
  const dir = join(OUT, 'posts', p.slug);
  mkdirSync(dir, { recursive: true });

  const heroSrc = p.hero || config.hero?.src || '';
  const heroAlt = p.heroAlt || config.hero?.alt || '';
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
      ogImage: ensureOgImage(p.cover, p.slug),
      ogType: 'article',
      pagePath: p.url,
    }),
  );
}

// 首頁：卡片直接寫進 HTML（需求 6）
const cards = posts.map((p) => `      <li class="card">
        <a class="card-link" href="${attr(p.url)}" tabindex="-1" aria-hidden="true">
          ${heroExists(p.cover)
            ? `<figure class="card-cover"><img src="${attr(p.cover)}" alt="${attr(p.coverAlt)}" loading="lazy" decoding="async"></figure>`
            : `<div class="card-cover is-empty"><span aria-hidden="true">🎭</span></div>`}
        </a>
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

/** 中文標題若逐字流動，換行可能切在詞中間（例如把「人生」拆開）。
 *  以全形冒號為界切段，每段包成 inline-block，換行只會發生在段與段之間。 */
function headlineHtml(text) {
  const parts = String(text).split(/(?<=：)/).filter(Boolean);
  if (parts.length < 2) return esc(text);
  return parts.map((p) => `<span class="hl-seg">${esc(p)}</span>`).join('');
}

const introMeta = `<p class="intro-meta">
      <span class="author">${esc(config.author)}</span>
      <span class="sep">・</span>
      <span class="views">本頁瀏覽 <span class="counter" data-slug="home" aria-live="polite">—</span></span>
    </p>`;

// 有圖就做壓暗的橫幅、標題疊在圖上；沒圖則退回純文字前言
const home = `${heroExists(config.hero?.src)
  ? `<section class="hero-banner">
  <figure class="hero-figure" data-caption="${attr(config.hero?.captionPosition === 'top' ? 'top' : 'bottom')}">
    <img src="${attr(config.hero.src)}" alt="${attr(config.hero.alt)}" loading="eager" decoding="async" fetchpriority="high">
    <figcaption class="hero-caption">
      <h1>${headlineHtml(heroHeadline)}</h1>
      <p class="tagline">${esc(config.description)}</p>
      ${introMeta}
    </figcaption>
  </figure>
</section>`
  : `<section class="intro wrap">
  <h1>${headlineHtml(heroHeadline)}</h1>
  <p class="tagline">${esc(config.description)}</p>
  ${introMeta}
</section>`}
<section class="listing wrap-wide">
  <h2 class="listing-title">全部文章<span class="count">（${posts.length}）</span></h2>
  <ul class="cards">
${cards || '      <li class="card empty">還沒有文章。在 content/ 新增一個 .md 檔，再跑 npm run build。</li>'}
  </ul>
</section>`;

writeFileSync(
  join(OUT, 'index.html'),
  layout({
    title: config.title,
    description: config.description,
    bodyClass: 'page-home',
    content: home,
    credit: creditHtml(config.hero?.credit),
    depth: 0,
    pageSlug: 'home',
    // 分享首頁時用實拍照，傳達這是真的有在上的課
    ogImage: ensureOgImage(config.hero?.src, 'home'),
    ogType: 'website',
    pagePath: '/',
  }),
);

// GitHub Pages 不要用 Jekyll 處理
writeFileSync(join(OUT, '.nojekyll'), '');

console.log(`✓ 建置完成：${posts.length} 篇文章 → docs/`);
for (const p of posts) console.log(`  - ${p.date}  ${p.title}  → posts/${p.slug}/`);
if (!supabaseReady) console.log('  ! Supabase 尚未設定，計數器顯示為 “—”（版型位置已保留）');
for (const src of missingHero) console.log(`  ! 找不到圖檔 ${src}，該頁 HERO 區暫時略過`);
if (ogSkipped) console.log('  ! sips 不可用，og:image 未產生（此工具僅 macOS 內建）');
if (!config.baseUrl) console.log('  ! site.config.json 的 baseUrl 是空的，og:image 需要絕對網址才會生效');
