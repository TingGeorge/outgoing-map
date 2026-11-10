import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

struct ImportProgressSheet: View {
    let importer: PhotoImporter
    let summary: ImportSummary?
    let onClose: () -> Void

    var body: some View {
        VStack(spacing: 20) {
            if let summary {
                Image(systemName: summary.added > 0 ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                    .font(.system(size: 44))
                    .foregroundStyle(summary.added > 0 ? Color.accentColor : .secondary)
                Text(summary.line)
                    .font(.headline)
                    .multilineTextAlignment(.center)
                Button("好", action: onClose)
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
            } else {
                ProgressView(value: Double(importer.done), total: Double(max(importer.total, 1)))
                Text("正在處理第 \(min(importer.done + 1, importer.total)) / \(importer.total) 張照片")
                    .font(.headline)
                Text("照片只會複製進這個 App，不會上傳。")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .presentationDetents([.medium])
        .interactiveDismissDisabled(summary == nil)
    }
}

struct AddPhotosButton: View {
    let tripID: UUID

    @Environment(TripStore.self) private var store
    @Environment(MapData.self) private var mapData
    @State private var items: [PhotosPickerItem] = []
    @State private var importer = PhotoImporter()
    @State private var summary: ImportSummary?
    @State private var showSheet = false

    var body: some View {
        PhotosPicker(selection: $items, matching: .images, preferredItemEncoding: .current, photoLibrary: .shared()) {
            Label("加入照片", systemImage: "photo.badge.plus")
        }
        .onChange(of: items) { _, picked in
            guard !picked.isEmpty, let trip = store.trips.first(where: { $0.id == tripID }) else { return }
            items = []
            summary = nil
            showSheet = true
            Task { summary = await importer.run(picked, into: trip, store: store, mapData: mapData) }
        }
        .sheet(isPresented: $showSheet) {
            ImportProgressSheet(importer: importer, summary: summary) { showSheet = false }
        }
    }
}

struct ImportGPXButton: View {
    let tripID: UUID

    @Environment(TripStore.self) private var store
    @State private var explain = false
    @State private var picking = false
    @State private var message: String?

    private static let gpx = [UTType(filenameExtension: "gpx"), UTType("com.topografix.gpx"), .xml].compactMap { $0 }

    var body: some View {
        Button("匯入 GPX 軌跡", systemImage: "point.topleft.down.to.point.bottomright.curvepath") {
            explain = true
        }
        .alert("匯入 GPX 軌跡", isPresented: $explain) {
            Button("選擇檔案") { picking = true }
            Button("取消", role: .cancel) {}
        } message: {
            Text("從其他登山 App 匯出的 GPX，能讓路線貼著真實的山徑。")
        }
        .fileImporter(isPresented: $picking, allowedContentTypes: Self.gpx) { result in
            Task { await importFile(result) }
        }
        .alert(message ?? "", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) {
            Button("好", role: .cancel) {}
        }
    }

    private func importFile(_ result: Result<URL, Error>) async {
        guard let trip = store.trips.first(where: { $0.id == tripID }) else { return }
        do {
            let url = try result.get()
            let points = try await Self.readGPX(url)
            guard !points.isEmpty else { message = "這個檔案裡找不到軌跡點。"; return }
            try store.setGPX(points, for: trip)
            message = "已匯入 \(points.count) 個軌跡點，路線會改用這條軌跡。"
        } catch {
            message = "無法匯入：\(error.localizedDescription)"
        }
    }

    @concurrent private static func readGPX(_ url: URL) async throws -> [TrackPoint] {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        return GPXParser.parse(data: try Data(contentsOf: url))
    }
}
