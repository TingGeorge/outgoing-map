# 登山回憶

把一趟登山的 GPX 軌跡和照片，做成一篇可以翻閱的日誌：照片依拍攝時間放到路線上，沿途的山頭與景點自動標出，還能在貼著真實空拍影像的立體地形上重播整趟路。這是一個網頁 App（PWA），可以加到手機主畫面全螢幕使用。

網址：https://tinggeorge.github.io/outgoing-map/

## 怎麼用

1. 第一次開啟時，照著教學到 Thunderforest 免費領一把地圖鑰匙（API Key），貼上就好。
2. 回到家，按「新的回憶」，選當天登山 App 匯出的 GPX 檔和照片。
3. 打開日誌看路線、照片和海拔，寫幾句日記，或按「立體播放」重走一次。

需要的只有一把免費的 Thunderforest 鑰匙，不用帳號、不用付費。

## 隱私

回憶、照片和鑰匙都只存在你這台裝置的瀏覽器裡，不會上傳到任何伺服器。地圖鑰匙只在載入地圖時由裝置直接交給 Thunderforest。要備份或換手機，在每篇回憶的選單裡匯出，再到設定匯入。

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
| `npm run build && npx playwright test -c playwright.build.config.ts` | 針對建置結果（以 `/outgoing-map/` 子路徑提供，埠 5193）測 PWA：manifest、Service Worker 與離線、正式版的地圖（有鑰匙時） |

網址用 hash 路由：`#/welcome` 鑰匙教學、`#/` 首頁、`#/new` 新的回憶、`#/trip/:id` 日誌、`#/trip/:id/fly` 立體播放、`#/settings` 設定。裝置上沒有金鑰時一律導到 `#/welcome`。

| 資料夾 | 負責 |
|---|---|
| `src/types.ts` | 共用資料模型 |
| `src/core/` | 純邏輯：GPX 解析、距離與爬升、路線、照片依時間放上軌跡、時間軸、海拔剖面 |
| `src/poi/` | 景點資料載入、沿路線的景點查詢 |
| `src/storage/` | IndexedDB（行程、軌跡、照片資料與檔案）、照片匯入、行程匯出與匯入（zip） |
| `src/key/` | Thunderforest 金鑰的儲存與驗證 |
| `src/map/` | 圖磚網址、來源標示、平面與立體地圖的 MapLibre 樣式；`maplibre.ts` 載入 MapLibre |
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

### 模組的實際行為

- storage：`listTrips` 依 `startAt`（沒有就 `createdAt`）新到舊；`listPhotos` 依 `takenAt` 舊到新，沒有時間的排最後。
- storage：同一趟行程裡，內容相同的照片（原始檔 SHA-256 相同）不會重複加入，會出現在 `failed`。`failed[].reason` 是可以直接顯示的中文句子（`PHOTO_FAILURE`：已加入過、HEIC 無法開啟、不是照片檔、無法讀取）。`onProgress(done, total)` 每處理完一個檔案呼叫一次，失敗的也算。
- storage：行程沒有封面或封面被刪時，自動用 `listPhotos` 的第一張當封面。
- storage：`saveTrack`、`addPhotos`、`deletePhoto`、`importTrip` 之後會自動重算 `hasTrack`、`stats`、`startAt`/`endAt`、`photoCount`、封面與每張照片的 `placement`；畫面在這些呼叫之後要重新 `getTrip` / `listPhotos`。路線沒有點時 `stats` 是 `null`。`saveTrack(id, [])` 會移除軌跡。
- storage：丟出的錯誤都是 `Error`，`message` 是可以直接顯示的中文（找不到這篇回憶、找不到這張照片、裝置的儲存空間不足…、無法存取裝置上的資料…、登山回憶已在另一個分頁更新…）。`deleteTrip` / `deletePhoto` 對不存在的 id 不會出錯。
- storage：`getPhotoUrl` 每次回傳新的 object URL，用完要 `URL.revokeObjectURL`（例如在 effect 的 cleanup）。`Photo.width`/`height` 是轉正後、長邊最多 2048 的尺寸；縮圖長邊最多 480。
- storage：`exportTrip` 回傳 zip `Blob`，建議檔名 `${title}-${yyyy-mm-dd}.hiking.zip`（日期用 `startAt`，沒有就 `createdAt`；`/\:*?"<>|` 換成 `-`）。`importTrip` 一律給新的 id，匯入兩次會得到兩趟獨立的行程；檔案不對時丟出的 `message` 可直接顯示。
- storage 需要安全環境（https 或 localhost）。
- core：`parseGpx` 失敗時丟出的 `message` 可直接顯示（這個檔案不是有效的 GPX、GPX 裡沒有軌跡點）。`buildRoute(track, photos)` 回傳的 `Route` 當成不可變。`routeStats` 的爬升用 5 公尺的遲滯門檻。`buildTimeline` 已排好順序，沒有時間或放不上路線的照片在最後。`elevationProfile` 在路線沒有海拔時回傳 `null`。
- poi：`poisAlongRoute(route)` 是 async（會先載入 `poi.json`，載入失敗會 reject，下次呼叫會重試）。往返路線上同一個景點只列一次。多數非山頂的景點 `ele` 是 `null`。種類的中文：`peak` 山頂、`trailhead` 登山口、`hut` 山屋、`shelter` 避難小屋、`campsite` 營地、`viewpoint` 觀景點、`water` 水源、`waterfall` 瀑布、`lake` 湖泊、`hotspring` 溫泉。
- key：`validateKey` 對格式不對的字串不發請求直接回 `'invalid'`；瀏覽器分不出「金鑰被拒絕」和「額度用完」，兩者都會讓圖磚載入失敗。
- pwa：`<InstallHint />` 不需要 props，自己決定要不要顯示；`requestPersistentStorage()` 不會丟錯。
- map：地圖一律用 `loadMapLibre()` 載入（只載一次，連同 CSS 與 worker 網址）；地圖容器加上 `mapContainer` class，它會鋪滿最近一個有定位的父層（`position: absolute; inset: 0`，蓋過 MapLibre 的 `position: relative`），父層自己決定大小。
- 路由：`goBack(fallback)` 在 App 內有上一頁時等於瀏覽器的上一頁，從外部連結直接打開時改成換到 `fallback`。畫面的返回鈕都用它；要回到上一個畫面的操作不要用 `navigate` 往前推一頁。
- 用詞：一趟紀錄叫「回憶」（量詞「篇」），檔案叫「GPX 檔」，地圖上的線叫「路線」，Thunderforest 的 API Key 叫「鑰匙」。
- 畫面除了 welcome 與 home 都是延遲載入；載入失敗（例如更新後離線）會顯示重新載入的畫面。Service Worker 預先快取所有 chunk，所以離線也打得開。
- 測試金鑰的規則照上面 `.env` 的那一條。旅程測試 `tests/e2e/journey.spec.ts` 用真的鑰匙走完整個 App；設 `JOURNEY_SHOTS=<資料夾>` 會存下每個畫面的截圖。

## 之前的 iPhone 原生版

原生 SwiftUI 版停在 `swift-final` 標籤，連同把魯地圖轉成離線圖磚與景點資料的工具。需要時可以取出：

```bash
git checkout swift-final
```

## 授權

程式碼採 MIT 授權，見 `LICENSE`。

`data/poi.sqlite` 與由它產生的景點資料 © OpenStreetMap contributors，採 ODbL 授權，整理自 Rudy Chung 的魯地圖 MOI.OSM Taiwan TOPO (https://rudymap.tw)。

地圖圖磚與影像屬於各自的提供者（Thunderforest、OpenStreetMap contributors、內政部國土測繪中心，以及地形資料來源），不在本授權範圍內。
