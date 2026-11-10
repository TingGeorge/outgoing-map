import SwiftUI

struct MapDataView: View {
    @Environment(MapData.self) private var mapData
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    status("地圖圖磚", detail: "taiwan.mbtiles", ok: mapData.tiles != nil)
                    status("景點資料", detail: "poi.sqlite", ok: mapData.pois != nil)
                    status("海拔資料", detail: "dem 資料夾", ok: mapData.elevation != nil)
                    Button("重新檢查", systemImage: "arrow.clockwise") { mapData.reload() }
                } header: {
                    Text(mapData.isInstalled ? "離線地圖已安裝" : "離線地圖尚未安裝")
                } footer: {
                    Text("沒有離線地圖也能用照片建立回憶，只是看不到地形底圖。")
                }

                Section("如何安裝") {
                    Label("用傳輸線把 iPhone 接上 Mac", systemImage: "cable.connector")
                    Label("開啟 Finder，在側邊欄選你的 iPhone，切到「檔案」分頁", systemImage: "macwindow")
                    Label("把電腦上的 MapData 資料夾拖進「登山回憶」", systemImage: "folder.badge.plus")
                    Label("等傳輸完成後回到這裡按「重新檢查」", systemImage: "checkmark.circle")
                }

                Section("資料來源") {
                    Text(verbatim: "地圖 © Rudy Chung 魯地圖 MOI.OSM Taiwan TOPO (https://rudymap.tw) · © OpenStreetMap contributors (ODbL) · 內政部 20m DTM (政府資料開放授權條款) · JAXA AW3D30 · Map style CC BY-NC-SA 3.0, based on OpenAndroMaps Elevate by Tobias Kühn.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("離線地圖")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { dismiss() }
                }
            }
        }
    }

    private func status(_ name: String, detail: String, ok: Bool) -> some View {
        HStack {
            VStack(alignment: .leading) {
                Text(name)
                Text(detail).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Image(systemName: ok ? "checkmark.circle.fill" : "xmark.circle")
                .foregroundStyle(ok ? Color.accentColor : .secondary)
                .accessibilityLabel(ok ? "已安裝" : "未安裝")
        }
    }
}
