# 把天聊死，不如把愛聊活

《把天聊死，不如把愛聊活：看懂伴侶關係賽局，開展有效溝通的活局對話》的書籍 landing page。

Markdown 寫文章 + `landing.json` 寫首頁 → `build.mjs` 產生 `docs/` → GitHub Pages 與 Cloudflare Pages 服務同一份輸出。

## 日常流程

```bash
npm run build      # 重新產生 docs/
npm run dev        # 建置後在 http://localhost:8080 預覽
```

改完 → `npm run build` → commit + push。Cloudflare Pages 會自動部署。

## 網址結構

| 頁面 | 網址 |
|---|---|
| Landing（首頁） | `/` |
| 文章 | `/posts/<slug>/` |

`slug` 預設取自檔名去掉開頭編號（`001-dead-game-live-game.md` → `dead-game-live-game`），
也可以在 front matter 用 `slug:` 指定。

## 首頁 landing

全部文案與清單都在 **`landing.json`**，改完重新 build 就更新，不用碰 `build.mjs`。

區塊順序：HERO → 反常識主張 → 你會看懂什麼 → 溝通動物測驗 → 媒體訪談 → 各界推薦
→ 購書 → 加值資源 → 延伸閱讀 → 關於作者 → 文章卡片。

`nav` 陣列決定頁首導覽；`#錨點` 在文章頁會自動補成 `index.html#錨點`。

### 心理測驗嵌入

OOOPEN Lab 的內嵌是**付費加購功能**（「流量助攻：將測驗嵌入活動／品牌網頁」）。
沒加購時模組偵測到自己被 iframe 包住，會直接顯示「本模組已關閉嵌入使用」，
所以預設 `quiz.embed` 是 `false`，改出一張 CTA 卡片、另開分頁。

加購後：到 OOOPEN Lab 後台「分享與發布設定」複製嵌入語法 → 把 `landing.json` 的
`quiz.embed` 改成 `true`、`quiz.embedUrl` 換成它給的網址 → `npm run build`。
文案也會跟著切換（`bodyEmbed` 那句「不用跳走」只有內嵌版才會出現）。

## 新增一篇文章

1. 在 `content/` 建立 `.md` 檔，例如 `003-listening.md`
2. 開頭放 front matter：

```markdown
---
title: 文章標題
date: 2026-08-10
summary: 顯示在首頁卡片上的一段簡介。
author: 王家齊
cover: assets/cover-listening.jpg
coverAlt: 圖片替代文字
heroCreditTitle: 作品名稱
heroCreditSourceUrl: https://原始頁面
heroCreditAuthor: 攝影者
heroCreditAuthorUrl: https://攝影者頁面
heroCreditLicense: CC BY 4.0
heroCreditLicenseUrl: https://creativecommons.org/licenses/by/4.0/
---

正文從這裡開始。
```

3. `npm run build`
4. commit + push

首頁卡片會自動新增、**依發布日排序（最新在前）**，更新日期自動帶入。
`cover` 以下的欄位都可省略；沒有 `cover` 的文章會用純文字卡片，不會留一塊空的佔位區。

## 修改既有文章

改完 `content/` 裡的 `.md`，重新 build 再 commit 即可。
**更新日期取自該檔案最後一次 git commit 時間**，不必手動維護。
（尚未 commit 的檔案會退回用檔案 mtime。）

## 圖片與授權標示

- 首頁 HERO 圖在 `site.config.json` 的 `hero.src`；文章圖用 front matter 的 `cover:`
- `hero.layout`：`banner` = 整幅橫幅（圖本身已含文案時用），`side` = 圖文左右並排
- 文章內主圖會**等比例縮放，寬度上限等於內容文字區寬度**（`--content-width`，預設 44rem）
- 圖檔不存在時該頁 HERO 區會自動略過，不會出現破圖

授權標示自動渲染在頁尾。兩種用法：

| 情境 | 設定 |
|---|---|
| CC BY 圖 | `title` / `author` / `license` 三要素各自帶連結，`authorPrefix` 留空（預設 `by`） |
| 出版社或自有圖 | 填 `title` / `author`，`authorPrefix` 設成「圖片提供」，`license` 留空 |

**不要**幫沒有 CC 授權的圖硬掛一個授權條款。

## 瀏覽計數器（Supabase）

每篇文章各自獨立計數，首頁卡片顯示該篇次數，頁尾顯示全站總和。

1. 在 Supabase SQL Editor 執行 `supabase/schema.sql`
2. 把 Project URL 和 publishable key 填進 `site.config.json` 的 `supabase` 區塊
3. `npm run build`

沒填的時候計數器顯示 `—`，版型位置保留，不影響其他功能。

安全性：publishable key 本來就會公開在前端。`page_views` 開了 RLS，anon **只有讀取權限**；
寫入一律走 `increment_page_view()` 這個 SECURITY DEFINER 函式，前端無法直接改數字。
**絕對不要**把 service_role key 放進這個專案。

計數規則：同一瀏覽階段對同一頁只計一次（用 `sessionStorage` 擋重新整理灌水）。

## 下線開關

`site.config.json` 的 `offline` 設成 `true` → 只輸出一頁告示，文章與圖片完全不進 `docs/`，
網路上讀不到任何內容。改回 `false` 重新 build 即可上架，原始檔都還在。

## 部署

`docs/` 是建置產物，**會 commit 進版控**（GitHub Pages 需要）。

- **GitHub Pages** — Settings → Pages → `main` 分支 `/docs` 資料夾
- **Cloudflare Pages** — 專案 `improv-therapy-blog`，連動同一個 repo，build command 留空，output directory 設 `docs`

push 到 `main` 後兩邊都會自動更新。

## archive/

`archive/` 放的是前一版「心理師的即興課」的文章與圖片，保留原始檔但不會被建置輸出。
