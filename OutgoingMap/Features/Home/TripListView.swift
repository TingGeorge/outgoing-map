import SwiftUI
import PhotosUI

struct TripListView: View {
    @Binding var path: [UUID]
    @Binding var recording: Bool

    @Environment(TripStore.self) private var store
    @Environment(MapData.self) private var mapData
    @Environment(\.dynamicTypeSize) private var typeSize

    @State private var showMapData = false
    @State private var renaming: Trip?
    @State private var renameText = ""
    @State private var deleting: Trip?
    @State private var errorMessage: String?

    @State private var picking = false
    @State private var picked: [PhotosPickerItem] = []
    @State private var importer = PhotoImporter()
    @State private var importSummary: ImportSummary?
    @State private var importTripID: UUID?
    @State private var showImport = false

    var body: some View {
        Group {
            if store.trips.isEmpty {
                ContentUnavailableView {
                    Label("還沒有回憶", systemImage: "mountain.2")
                } description: {
                    Text("按「開始記錄」，健行時手機會在背景稀疏地記下軌跡。\n或按「從照片建立」，直接用當天的照片組成回憶。")
                }
            } else {
                List(store.trips) { trip in
                    Button { open(trip) } label: { TripCard(trip: trip) }
                        .buttonStyle(.plain)
                        .listRowSeparator(.hidden)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                        .swipeActions(edge: .trailing) {
                            Button("刪除", systemImage: "trash", role: .destructive) { deleting = trip }
                            Button("重新命名", systemImage: "pencil") { startRename(trip) }.tint(.accentColor)
                        }
                        .contextMenu {
                            Button("重新命名", systemImage: "pencil") { startRename(trip) }
                            Button("刪除", systemImage: "trash", role: .destructive) { deleting = trip }
                        }
                }
                .listStyle(.plain)
            }
        }
        .navigationTitle("回憶")
        .background(Color(.systemGroupedBackground))
        .safeAreaInset(edge: .top, spacing: 0) {
            if !mapData.isInstalled { mapBanner }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { actions }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("離線地圖", systemImage: "map") { showMapData = true }
            }
        }
        #if DEBUG
        .task {
            guard let folder = UserDefaults.standard.string(forKey: "importPhotosFolder") else { return }
            let urls = ((try? FileManager.default.contentsOfDirectory(atPath: folder)) ?? []).sorted().map { URL(filePath: folder).appending(path: $0) }
            let now = Date.now
            let trip = Trip(title: "健行 ", startedAt: now, endedAt: now, intervalMinutes: 0, state: .finished)
            let summary = await importer.run(count: urls.count, into: trip, store: store, mapData: mapData) { try? Data(contentsOf: urls[$0]) }
            print("importPhotosFolder:", summary.line)
        }
        #endif
        .sheet(isPresented: $showMapData) { MapDataView() }
        .photosPicker(isPresented: $picking, selection: $picked, matching: .images, preferredItemEncoding: .current)
        .onChange(of: picked) { _, items in
            guard !items.isEmpty else { return }
            picked = []
            createTrip(from: items)
        }
        .sheet(isPresented: $showImport) {
            ImportProgressSheet(importer: importer, summary: importSummary) {
                showImport = false
                if let id = importTripID, (importSummary?.added ?? 0) > 0 { path.append(id) }
            }
        }
        .alert("重新命名", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("旅程名稱", text: $renameText)
            Button("儲存") { commitRename() }
            Button("取消", role: .cancel) {}
        }
        .confirmationDialog(
            "刪除「\(deleting?.title ?? "")」？",
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            titleVisibility: .visible,
            presenting: deleting
        ) { trip in
            Button("刪除", role: .destructive) { delete(trip) }
        } message: { _ in
            Text("旅程會移到 App 的垃圾桶資料夾，之後可以從「檔案」App 找回。")
        }
        .alert("發生問題", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("好", role: .cancel) {}
        } message: {
            Text(errorMessage ?? "")
        }
    }

    private var mapBanner: some View {
        Button { showMapData = true } label: {
            HStack(spacing: 12) {
                Image(systemName: "map")
                VStack(alignment: .leading, spacing: 2) {
                    Text("尚未安裝離線地圖").font(.subheadline.bold())
                    Text("沒有它就看不到地形底圖，點此看安裝方式").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
            }
            .padding(12)
            .background(Color.accentColor.opacity(0.14), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
        }
        .buttonStyle(.plain)
    }

    private var actions: some View {
        let start = Button { recording = true } label: {
            Label("開始記錄", systemImage: "record.circle").frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)

        let fromPhotos = Button { picking = true } label: {
            Label("從照片建立", systemImage: "photo.on.rectangle.angled").frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)

        return (typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(spacing: 10)) : AnyLayout(HStackLayout(spacing: 12))) {
            start
            fromPhotos
        }
        .controlSize(.large)
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(.bar)
    }

    private func open(_ trip: Trip) {
        if trip.state == .recording { recording = true } else { path.append(trip.id) }
    }

    private func startRename(_ trip: Trip) {
        renameText = trip.title
        renaming = trip
    }

    private func commitRename() {
        let title = renameText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard var trip = renaming, !title.isEmpty else { return }
        trip.title = title
        do { try store.save(trip) } catch { errorMessage = error.localizedDescription }
    }

    private func delete(_ trip: Trip) {
        do { try store.delete(trip) } catch { errorMessage = error.localizedDescription }
    }

    private func createTrip(from items: [PhotosPickerItem]) {
        let now = Date.now
        let trip = Trip(
            title: "健行 " + now.formatted(.dateTime.month().day().locale(Format.locale)),
            startedAt: now, endedAt: now, intervalMinutes: 0, state: .finished
        )
        importTripID = trip.id
        importSummary = nil
        showImport = true
        Task { importSummary = await importer.run(items, into: trip, store: store, mapData: mapData) }
    }
}
