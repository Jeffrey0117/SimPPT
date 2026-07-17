# simppt — 單檔 Markdown 簡報播放器

2026-07-18 定案。自用工具，錄影用簡報：簡單文字、背景色、少量圖片。

## 決策脈絡

- ShotBoard 已有「Markdown 簡報 + 錄影」完整功能，但 Jeff 仍要一個超輕、瀏覽器雙擊就能用的獨立版本（錄影另外錄）。
- 不用 Slidev：功能過重，需求只用到 5%。

## 架構

- **單一 `index.html`，零依賴、零 build**：自寫 mini markdown parser（純函式，放在獨立 `<script id="simppt-parser">` 區塊，方便 node 測試抽取）。
- `decks/` 放 `.md` 簡報（範例：`decks/demo.md`）。
- 測試：`test/parser.test.mjs` 從 index.html 抽出 parser script 跑 node:assert 單元測試。

## Markdown 語法

```md
---
bg: #1a1a2e        ← 檔首 frontmatter = 全域預設（bg / color）
color: #ffffff
---

# 第一頁標題
簡單文字內容

--- bg=#0f3460     ← 分隔線同行 key=value 覆蓋該頁設定

# 第二頁換背景色
- 支援列表

---

![](img/pic.png)   ← 圖片自動置中縮放
```

- 分頁：獨立一行 `---`（恰好三個 dash；`----` 不算）。
- frontmatter：僅當檔首第一行是 `---` 且其後至閉合 `---` 之間全為 `key: value` 或空行時成立。
- 支援的 markdown 子集：`#`/`##`/`###` 標題、`-`/`*` 無序列表、`1.` 有序列表、`![]()` 圖片、`**粗體**`、`*斜體*`、`` `code` ``、`[連結]()`、段落。其餘原樣顯示。內容先 HTML escape。
- 空白頁（無內容無設定）自動略過；只有 `bg` 設定的頁保留（純色頁）。

## 圖片處理

`file://` 下讀不到 .md 的相對路徑圖片，因此：

- **拖整個資料夾**（或「開啟資料夾」按鈕 showDirectoryPicker）：.md + 圖片一起進來，圖片轉 blob URL，依相對路徑對應（先精確比對、再檔名比對）。
- 純文字簡報：直接拖 .md 或「開啟檔案」。
- 圖片也可用 http(s) 絕對網址。

## 播放

- 滿版背景色、內容置中，字體 `vw` 單位隨螢幕縮放（錄影全螢幕 = 乾淨 16:9 畫面）。
- 鍵盤：`←/→/Space` 翻頁、`Home/End` 首尾頁、`F` 全螢幕、`P` 切換頁碼顯示（預設隱藏，錄影乾淨）。
- 滑鼠：點擊左側 1/4 上一頁，其餘區域下一頁。
- 預設主題：深色（bg `#101014`、文字 `#f5f5f5`）。

## 編輯體驗

用「開啟檔案／資料夾」按鈕（File System Access API，Chrome/Edge）載入時，每秒 polling `lastModified`，變更即自動重新載入並停留在當前頁 — 零依賴 hot reload。拖曳載入則無自動重載（File 物件改動後不可重讀）。

## 不做（YAGNI）

動畫轉場、程式碼高亮、匯出 PDF/PPTX、主題系統、部署、簡報者視圖。要了再加。
