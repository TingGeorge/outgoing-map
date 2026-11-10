# 登山回憶（OutgoingMap）

臺灣登山的回憶日誌 iPhone App。爬山時在背景定時記下位置，回家後選取當天的照片，App 依照片的時間與座標把它們放到離線的魯地圖上，做成一篇可瀏覽的日誌，並可在立體地形上播放整趟路線。

原生 SwiftUI，iOS 18 以上，沒有第三方套件，整個 App 不需要網路。

## 功能

- **背景記錄**：每 5、10 或 15 分鐘記一個點（時刻、座標、海拔、方向、速度、定位精度、氣壓、步數、電量），每一筆立刻寫入手機。
- **照片匯入**：從系統相簿選照片，讀取拍攝時間與 GPS。沒有記錄軌跡也可以只用照片建立行程。
- **日誌**：離線魯地圖上的路線、照片與沿途景點（山頭、山屋、登山口等），海拔剖面，逐張照片的註解，整趟的日記。
- **立體播放**：用高程資料做出立體地形並貼上魯地圖，路線逐步畫出，走到拍照點時照片彈出。
- **GPX 匯入**：匯入其他登山 App 錄的軌跡，路線會貼著實際走過的山徑。

## 安裝到 iPhone

1. 用 Xcode 開啟 `OutgoingMap.xcodeproj`。
2. 在 target `OutgoingMap` 的 Signing & Capabilities 選自己的 Team。
3. 接上 iPhone，選它當目的地後按 Run。
4. 放入離線地圖（約 3.1GB，只需做一次）：
   1. 執行 `./tools/mapdata/package.sh`，它會整理出 `MapData/device/MapData` 資料夾。
   2. iPhone 接著 Mac，打開 Finder，點側邊欄的 iPhone，切到「檔案」分頁。
   3. 把 `MapData/device/MapData` 整個資料夾拖到「登山回憶」上。
   4. 回到 App，點首頁右上角的地圖圖示，按「重新檢查」，三項都打勾就完成。

地圖資料不在這個 repo 裡（檔案太大）。要從頭重建，執行 `./tools/mapdata/build.sh full`，細節見 [tools/mapdata/README.md](tools/mapdata/README.md)。

## 開發

```bash
swift test
```

核心邏輯（軌跡檔、距離與爬升、照片對位、GPX、圖磚、高程、景點查詢）的檢查，在 macOS 上直接跑，不需要模擬器。

模擬器測試用的啟動參數（僅 Debug）：

- `-seedSampleTrip YES`：沒有任何行程時，建立一趟合歡北峰範例行程。
- `-recordIntervalSeconds 20`：把記錄間隔改成秒，方便測記錄流程。

## 程式結構

| 路徑 | 內容 |
|---|---|
| `OutgoingMap/Core/` | 純邏輯，只用 Foundation 與 SQLite3 |
| `OutgoingMap/App/` | App 進入點、`TripStore`（行程存檔）、`MapData`（離線地圖資料） |
| `OutgoingMap/Features/Recording/` | 背景記錄 |
| `OutgoingMap/Features/Map/` | 離線魯地圖元件（MapKit 加 MBTiles 圖磚） |
| `OutgoingMap/Features/Journal/` | 日誌與照片檢視 |
| `OutgoingMap/Features/Flyover/` | 立體路線播放（SceneKit） |
| `OutgoingMap/Features/Home/`、`Import/` | 首頁、照片與 GPX 匯入 |
| `tools/mapdata/` | 把魯地圖轉成離線圖磚、景點資料庫的流程 |

行程存在 App 的 `Documents/Trips/<id>/`：`trip.json`、`track.jsonl`（記錄的軌跡）、`gpx.jsonl`（匯入的軌跡）、`photos/`。刪除的行程會移到 `Documents/Trash/`，可從「檔案」App 取回。

## 還沒在真機驗證的事

以下只能在真的 iPhone 上確認，模擬器測不出來：

- 背景記錄連續數小時不被系統中斷，尤其是山上沒有訊號時。閒置時的定位精度設定在 `LocationRecorder.idleAccuracy`，若實測有漏點，改成 `kCLLocationAccuracyHundredMeters`。
- 實際耗電。
- 氣壓計與步數（模擬器不提供）。
- 立體播放在真機上的流暢度與記憶體用量。

## 地圖授權

地圖 © Rudy Chung 魯地圖 MOI.OSM Taiwan TOPO (https://rudymap.tw) · © OpenStreetMap contributors (ODbL) · 內政部 20m DTM (政府資料開放授權條款) · JAXA AW3D30 · Map style CC BY-NC-SA 3.0, based on OpenAndroMaps Elevate by Tobias Kühn.

地圖樣式為非商業授權，這個 App 僅供個人使用。
