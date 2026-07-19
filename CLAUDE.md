# SimPPT

零依賴單檔 Markdown 簡報工具。核心全在 `index.html`（parser 在 `<script id="simppt-parser">`，可被 node 測試抽取）；`server.js` 是選配的本機/線上 server（靜態 + `/__save` 寫檔 + `/__upload` 圖床代理）。

## 開發

- `npm start` → http://localhost:4646（`PORT` 可換）
- `npm test` → parser 單元測試（`test/parser.test.mjs`，從 index.html 抽 parser script 跑 node:assert）
- 改 parser 必跑測試；UI 邏輯改完用 `new Function(script)` 做語法檢查

## 部署（CloudPipe）

- 正式站：https://simppt.isnowfriend.com （cloudpipe 專案 id `simppt`，port 4036，pm2 `simppt`）
- 真實部署目錄：`Desktop\code\workhub\simppt`（cloudpipe git fetch/reset 在那裡）；本目錄（`Desktop\code\simppt`）是開發正本，push 到 GitHub `Jeffrey0117/SimPPT` 即自動部署
- `/__save`、`/__upload` 受 `SIMPPT_TOKEN` 環境變數保護（在 cloudpipe env，用 env API 讀）；瀏覽器端用 `?token=xxx` 開一次即記住（localStorage `simppt-token`）。本機無該環境變數則不設防

## 架構要點

- 單檔原則：不引外部依賴；favicon 是 inline SVG data URI
- 座標語法：區塊行尾 `{x= y= w= s= c= b=}`（百分比，相對 16:9 舞台）；行內 `{{文字|s= c= b=}}`；分隔線 `--- key=value`（加 `set` = 之後都生效）
- 預覽/播放/講者台三處共用同一渲染管線（`renderInto` + `.slide-scope` 字級 calc(--ts)），所有尺寸一律 vw 單位（16:9 基準），嚴禁混用 vh 否則預覽與播放不一致
- 會話保存：localStorage `simppt-session`（僅編輯視圖寫入）+ IndexedDB 檔案 handle + `simppt-history` 快照；`?role=stage` 觀眾視窗不寫會話
- 雙視窗同步：BroadcastChannel('simppt')
