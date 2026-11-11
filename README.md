# 登山回憶

臺灣登山的回憶日誌，網頁版（PWA）。回家後匯入當天的 GPX 軌跡和照片，App 依拍攝時間把照片放到路線上，做成一篇可瀏覽的日誌，並能在貼著真實空拍影像的立體地形上播放整趟路線。

目前還在動工前的階段，程式尚未開始寫。方案、資料來源與畫面風格見 [docs/pwa-plan.md](docs/pwa-plan.md)。

## 目前有的東西

| 路徑 | 內容 |
|---|---|
| `docs/pwa-plan.md` | 方案文件 |
| `docs/verify/` | 動工前驗證的畫面 |
| `data/poi.sqlite` | 臺灣山區景點 23,718 筆（山頭、山屋、登山口等），欄位 `poi(id, name, kind, lat, lon, ele)` |

## 開發

需要 Node 20.19 以上。

| 指令 | 用途 |
|---|---|
| `npm run dev` | 開發伺服器，預設 5173；換埠用 `npm run dev -- --port 5180` |
| `node scripts/build-poi.mjs` | 由 `data/poi.sqlite` 重新產生 `public/poi.json`（需要 `sqlite3` 指令） |
| `npm run build` / `npm run preview` | 型別檢查後建置到 `dist/`；預覽建置結果 |
| `npm run typecheck` | TypeScript 檢查 |
| `npm run test` | 單元測試（Vitest，happy-dom） |
| `npm run e2e` | 端對端測試（Playwright，chromium 與 webkit，390×844）；換埠用 `E2E_PORT=5190 npm run e2e` |
| `npm run build && npx playwright test -c playwright.build.config.ts` | 針對建置結果（以 `/outgoing-map/` 子路徑提供，埠 5193）測 PWA：manifest、Service Worker、離線重新載入 |

網址用 hash 路由：`#/welcome` 金鑰教學、`#/` 首頁、`#/new` 建立行程、`#/trip/:id` 日誌、`#/trip/:id/fly` 立體播放、`#/settings` 設定。裝置上沒有金鑰時一律導到 `#/welcome`。

| 資料夾 | 負責 |
|---|---|
| `src/types.ts` | 共用資料模型 |
| `src/core/` | 純邏輯：GPX 解析、距離與爬升、路線、照片依時間放上軌跡、時間軸、海拔剖面 |
| `src/poi/` | 景點資料載入、沿路線的景點查詢 |
| `src/storage/` | IndexedDB（行程、軌跡、照片資料與檔案）、照片匯入、行程匯出與匯入（zip） |
| `src/key/` | Thunderforest 金鑰的儲存與驗證 |
| `src/map/` | 圖磚網址、來源標示、平面與立體地圖的 MapLibre 樣式 |
| `src/ui/` | 設計 token、共用元件、圖示、日期與數字格式 |
| `src/pwa/` | 加入主畫面提示、持久儲存 |
| `src/screens/<畫面>/` | welcome、home、new-trip、journal、flyover、settings |
| `tests/fixtures/` | 合歡北峰 GPX（有與沒有時間）、4 張帶 EXIF 的照片 |

模組之間的約定：

- 時間一律是 UTC 毫秒。GPX 的時間是 UTC。照片的 `DateTimeOriginal` 是當地時間，有 `OffsetTimeOriginal` 就用它，否則當成 `+08:00`；只在 `core.exifTimeToEpoch` 換算。用 exifr 讀時要加 `reviveValues: false`，拿原始字串。
- 照片對位：有 GPX 時，拍攝時間落在軌跡時間前後 30 分鐘內就依時間內插到軌跡上（`'track'`）；不然用照片自己的 GPS（`'exif'`）；都沒有就是 `'none'`。
- 沒有 GPX 時，路線由照片的 GPS 依時間連成，`Route.source` 是 `'photos'`，畫面要說「路線由照片位置連成，匯入 GPX 會更準」。
- `storage` 在存軌跡、加或刪照片後，自己重算行程的日期、統計、照片數與每張照片的對位。
- 金鑰只存在 `localStorage`，不進匯出檔。`.env` 裡的 `THUNDERFOREST_API_KEY` 只給端對端測試用（`process.env.THUNDERFOREST_API_KEY`，沒有就跳過），不可印出、寫進檔案或打包；Playwright 已關閉 trace、截圖與錄影。

## 之前的 iPhone 原生版

原生 SwiftUI 版停在 `swift-final` 標籤，連同把魯地圖轉成離線圖磚與景點資料的工具。需要時可以取出：

```bash
git checkout swift-final
```

## 授權

程式碼採 MIT 授權，見 `LICENSE`。

`data/poi.sqlite` 與由它產生的景點資料 © OpenStreetMap contributors，採 ODbL 授權，整理自 Rudy Chung 的魯地圖 MOI.OSM Taiwan TOPO (https://rudymap.tw)。

地圖圖磚與影像屬於各自的提供者（Thunderforest、OpenStreetMap contributors、內政部國土測繪中心，以及地形資料來源），不在本授權範圍內。
