# 登山回憶

臺灣登山的回憶日誌，網頁版（PWA）。回家後匯入當天的 GPX 軌跡和照片，App 依拍攝時間把照片放到路線上，做成一篇可瀏覽的日誌，並能在貼著真實空拍影像的立體地形上播放整趟路線。

目前還在動工前的階段，程式尚未開始寫。方案、資料來源與畫面風格見 [docs/pwa-plan.md](docs/pwa-plan.md)。

## 目前有的東西

| 路徑 | 內容 |
|---|---|
| `docs/pwa-plan.md` | 方案文件 |
| `docs/verify/` | 動工前驗證的畫面 |
| `data/poi.sqlite` | 臺灣山區景點 23,718 筆（山頭、山屋、登山口等），欄位 `poi(id, name, kind, lat, lon, ele)` |

## 之前的 iPhone 原生版

原生 SwiftUI 版停在 `swift-final` 標籤，連同把魯地圖轉成離線圖磚與景點資料的工具。需要時可以取出：

```bash
git checkout swift-final
```

## 授權

景點資料 © OpenStreetMap contributors，採 ODbL 授權，整理自 Rudy Chung 的魯地圖 MOI.OSM Taiwan TOPO (https://rudymap.tw)。
