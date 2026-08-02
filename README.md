# 心理師的即興課

靜態部落格。Markdown 寫文章 → `build.mjs` 產生 `docs/` → GitHub Pages 與 Cloudflare Pages 同時服務同一份輸出。

## 日常流程

```bash
npm run build      # 重新產生 docs/
npm run dev        # 建置後在 http://localhost:8080 預覽
```

### 新增一篇文章

1. 在 `content/` 建立 `.md` 檔，例如 `004-listening.md`
2. 開頭放 front matter：

```markdown
---
title: 文章標題
date: 2026-08-10
summary: 顯示在首頁卡片上的一段簡介。
author: tomoewcc
hero: assets/hero-listening.jpg
heroAlt: 圖片替代文字
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
`hero` 以下的欄位都可省略；省略時會用 `site.config.json` 裡的預設值。

### 修改既有文章

改完 `content/` 裡的 `.md`，重新 build 再 commit 即可。
**更新日期取自該檔案最後一次 git commit 時間**，不必手動維護。
（尚未 commit 的檔案會退回用檔案 mtime。）

## 網址結構

| 頁面 | 網址 |
|---|---|
| 首頁 | `/` |
| 文章 | `/posts/<slug>/` |

`slug` 預設取自檔名去掉開頭編號（`003-status-transactions.md` → `status-transactions`），
也可以在 front matter 用 `slug:` 指定。

## HERO 圖片

- 圖檔放 `assets/`，在 front matter 用 `hero:` 指定；首頁的預設圖在 `site.config.json`
- 版型會等比例縮放，**寬度上限等於內容文字區寬度**（`--content-width`，預設 44rem）
- 授權標示自動渲染在頁尾，格式符合 CC BY 要求的「作品名 / 作者 / 授權條款」三要素
- 圖檔不存在時該頁 HERO 區會自動略過，不會出現破圖

## 瀏覽計數器（Supabase）

1. 在 Supabase SQL Editor 執行 `supabase/schema.sql`
2. 把 Project URL 和 **anon public key** 填進 `site.config.json` 的 `supabase` 區塊
3. `npm run build`

沒填的時候計數器顯示 `—`，版型位置保留，不影響其他功能。

安全性：anon key 本來就會公開在前端。`page_views` 開了 RLS，anon **只有讀取權限**；
寫入一律走 `increment_page_view()` 這個 SECURITY DEFINER 函式，前端無法直接改數字。
**絕對不要**把 service_role key 放進這個專案。

計數規則：同一瀏覽階段對同一頁只計一次（用 `sessionStorage` 擋重新整理灌水）。

## 部署

`docs/` 是建置產物，**會 commit 進版控**（GitHub Pages 需要）。

- **GitHub Pages** — Settings → Pages → `main` 分支 `/docs` 資料夾
- **Cloudflare Pages** — 連動同一個 repo，build command 留空，output directory 設 `docs`

push 到 `main` 後兩邊都會自動更新。
