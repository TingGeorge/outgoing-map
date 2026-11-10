import Charts
import SwiftUI

struct JournalView: View {
    let tripID: UUID

    @Environment(TripStore.self) private var store
    @Environment(MapData.self) private var mapData
    @Environment(\.scenePhase) private var scenePhase

    @State private var derived: Derived?
    @State private var selection: String?
    @State private var fitRequest = 0
    @State private var diary = ""
    @State private var diaryLoaded = false
    @State private var viewerStart: ViewerStart?
    @State private var viewerLast: UUID?
    @State private var poiDetail: POI?
    @State private var renaming = false
    @State private var newTitle = ""
    @State private var showingFlyover = false
    @State private var saveError: String?

    @ScaledMetric private var cardWidth = 156.0

    private var trip: Trip? { store.trips.first { $0.id == tripID } }

    var body: some View {
        Group {
            if let trip, let derived {
                page(trip, derived)
            } else if trip == nil {
                ContentUnavailableView("找不到這趟行程", systemImage: "questionmark.folder")
            } else {
                ProgressView()
            }
        }
        .navigationTitle(trip?.title ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    tripActions
                } label: {
                    Label("更多", systemImage: "ellipsis.circle")
                }
            }
        }
        .alert("重新命名", isPresented: $renaming) {
            TextField("行程名稱", text: $newTitle)
            Button("取消", role: .cancel) {}
            Button("儲存") { rename() }
        }
        .alert("無法儲存", isPresented: Binding(get: { saveError != nil }, set: { if !$0 { saveError = nil } })) {
            Button("好") {}
        } message: {
            Text(saveError ?? "")
        }
        .sheet(item: $poiDetail) { poi in
            POIDetailSheet(poi: poi)
        }
        .fullScreenCover(item: $viewerStart, onDismiss: {
            if let viewerLast { selection = "photo-\(viewerLast.uuidString)" }
        }) { start in
            PhotoViewer(tripID: tripID, start: start.id, placed: derived?.placedByID ?? [:]) { viewerLast = $0 }
        }
        .task(id: [trip?.hashValue ?? 0, store.revision]) {
            guard let trip else { return }
            if !diaryLoaded {
                diary = trip.diary
                diaryLoaded = true
            }
            derived = Derived(trip: trip, store: store, mapData: mapData)
        }
        .task(id: diary) {
            try? await Task.sleep(for: .seconds(1.5))
            guard !Task.isCancelled else { return }
            saveDiary()
        }
        .onDisappear { saveDiary() }
        .onChange(of: scenePhase) { if scenePhase != .active { saveDiary() } }
    }

    private func page(_ trip: Trip, _ derived: Derived) -> some View {
        let content = derived.content
        let isEmpty = content.route.points.isEmpty && trip.photos.isEmpty
        return ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if isEmpty {
                    ContentUnavailableView(
                        "這趟還沒有紀錄",
                        systemImage: "point.topleft.down.to.point.bottomright.curvepath",
                        description: Text("沒有軌跡也沒有照片。加入照片或匯入 GPX 後，回憶就會出現在這裡。")
                    )
                    .padding(.top, 40)
                    importRow
                        .padding(.horizontal)
                } else {
                    map(derived)
                    summary(trip, derived)
                        .padding(.horizontal)
                    flyoverEntry
                        .padding(.horizontal)
                    strip(trip, derived)
                    importRow
                        .padding(.horizontal)
                }
                diaryEditor
                    .padding(.horizontal)
            }
            .padding(.bottom, 24)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private func map(_ derived: Derived) -> some View {
        TileMapView(
            route: derived.content.route.coordinates,
            trackPoints: derived.track,
            pins: derived.pins,
            selection: $selection,
            fitRouteRequest: fitRequest,
            onActivatePin: activate
        )
        .containerRelativeFrame(.vertical) { height, _ in height * 0.45 }
        .overlay(alignment: .topTrailing) {
            if derived.content.route.points.count > 1 {
                Button {
                    fitRequest += 1
                } label: {
                    Image(systemName: "arrow.up.left.and.arrow.down.right")
                        .padding(10)
                        .background(.regularMaterial, in: .circle)
                }
                .accessibilityLabel("顯示整條路線")
                .padding(10)
            }
        }
    }

    private func summary(_ trip: Trip, _ derived: Derived) -> some View {
        let route = derived.content.route
        return VStack(alignment: .leading, spacing: 12) {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 104), alignment: .topLeading)], alignment: .leading, spacing: 12) {
                stat("日期", Format.day(trip.startedAt))
                stat("起訖", "\(Format.clock(route.start ?? trip.startedAt))–\(Format.clock(route.end ?? trip.endedAt))")
                stat(derived.hasGPX ? "距離" : "約略距離", (derived.hasGPX ? "" : "約 ") + Format.distance(route.totalDistance))
                stat("最高海拔", Format.altitude(route.maxAltitude))
                stat("爬升", Format.altitude(route.ascent))
            }
            if derived.profile.count > 1 {
                profileChart(derived)
            }
        }
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.subheadline.weight(.semibold))
                .monospacedDigit()
        }
        .accessibilityElement(children: .combine)
    }

    private func profileChart(_ derived: Derived) -> some View {
        let altitudes = derived.profile.map(\.altitude)
        let low = (altitudes.min() ?? 0) - 20, high = (altitudes.max() ?? 0) + 20
        let marker = derived.content.timeline.first { $0.id == selection }.map { item in
            (km: item.fraction * derived.content.route.totalDistance / 1000,
             altitude: item.altitude ?? derived.content.route.sample(at: item.fraction)?.altitude)
        }
        return Chart {
            ForEach(derived.profile) { p in
                AreaMark(x: .value("距離", p.km), yStart: .value("海拔", low), yEnd: .value("海拔", p.altitude))
                    .foregroundStyle(Color.accentColor.opacity(0.18))
                LineMark(x: .value("距離", p.km), y: .value("海拔", p.altitude))
                    .foregroundStyle(Color.accentColor)
            }
            if let marker {
                RuleMark(x: .value("距離", marker.km))
                    .foregroundStyle(.secondary)
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                if let altitude = marker.altitude {
                    PointMark(x: .value("距離", marker.km), y: .value("海拔", altitude))
                        .foregroundStyle(Color.accentColor)
                        .symbolSize(60)
                }
            }
        }
        .chartYScale(domain: low...high)
        .chartXAxis {
            AxisMarks { value in
                AxisGridLine()
                AxisValueLabel { if let km = value.as(Double.self) { Text("\(km, specifier: "%.1f") km") } }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading) { value in
                AxisGridLine()
                AxisValueLabel { if let m = value.as(Double.self) { Text("\(Int(m))") } }
            }
        }
        .frame(height: 110)
        .dynamicTypeSize(...DynamicTypeSize.xLarge)
        .accessibilityLabel("海拔剖面")
    }

    private var flyoverEntry: some View {
        Button {
            showingFlyover = true
        } label: {
            Label("立體播放", systemImage: "play.fill")
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        .disabled((derived?.content.route.points.count ?? 0) < 2)
        .fullScreenCover(isPresented: $showingFlyover) {
            if let content = derived?.content {
                FlyoverView(content: content)
            }
        }
    }

    private var importRow: some View {
        HStack(spacing: 12) {
            AddPhotosButton(tripID: tripID)
            ImportGPXButton(tripID: tripID)
        }
        .buttonStyle(.bordered)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private var tripActions: some View {
        Button("重新命名", systemImage: "pencil") {
            newTitle = trip?.title ?? ""
            renaming = true
        }
    }

    private func strip(_ trip: Trip, _ derived: Derived) -> some View {
        let cards = derived.cards(trip)
        return VStack(alignment: .leading, spacing: 10) {
            if trip.photos.isEmpty {
                Label {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("還沒有照片")
                            .font(.headline)
                        Text("加入這趟拍的照片，會依拍攝時間排到路線上。")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                } icon: {
                    Image(systemName: "photo.badge.plus")
                        .foregroundStyle(Color.accentColor)
                }
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.fill.quaternary, in: .rect(cornerRadius: 12))
                .padding(.horizontal)
            }
            if !cards.isEmpty {
                ScrollViewReader { proxy in
                    ScrollView(.horizontal) {
                        HStack(alignment: .top, spacing: 12) {
                            ForEach(cards) { card in
                                Button {
                                    if selection == card.id { activate(card.id) } else { selection = card.id }
                                } label: {
                                    cardView(card, trip: trip)
                                }
                                .buttonStyle(.plain)
                                .id(card.id)
                            }
                        }
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal)
                        .padding(.vertical, 4)
                    }
                    .scrollIndicators(.hidden)
                    .onChange(of: selection) {
                        guard let selection else { return }
                        withAnimation { proxy.scrollTo(selection, anchor: .center) }
                    }
                }
            }
        }
    }

    private func cardView(_ card: Card, trip: Trip) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            switch card.kind {
            case .photo(let photo, let placed):
                LocalImage(url: store.thumbURL(photo, in: trip))
                    .scaledToFill()
                    .frame(width: cardWidth - 16, height: (cardWidth - 16) * 0.72)
                    .clipShape(.rect(cornerRadius: 8))
                    .overlay(alignment: .topLeading) {
                        if !placed {
                            Label("無定位", systemImage: "location.slash")
                                .font(.caption2.weight(.semibold))
                                .padding(.horizontal, 6)
                                .padding(.vertical, 3)
                                .background(.regularMaterial, in: .capsule)
                                .padding(6)
                        }
                    }
                Text("\(Format.clock(photo.takenAt)) · \(Format.altitude(card.altitude))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                if !photo.caption.isEmpty {
                    Text(photo.caption)
                        .font(.subheadline)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            case .poi(let poi):
                let kind = Format.poiKind(poi.kind)
                Image(systemName: kind.symbol)
                    .font(.title3)
                    .foregroundStyle(.white)
                    .frame(width: 40, height: 40)
                    .background(Color.teal, in: .circle)
                Text(poi.name)
                    .font(.headline)
                    .lineLimit(2)
                Text("\(kind.name) · \(Format.altitude(card.altitude))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text("來自地圖資料")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(8)
        .frame(width: cardWidth, alignment: .leading)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(.fill.quaternary, in: .rect(cornerRadius: 12))
        .overlay {
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(Color.accentColor, lineWidth: selection == card.id ? 3 : 0)
        }
        .contentShape(.rect)
    }

    private var diaryEditor: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("日記")
                .font(.title3.bold())
            TextField("寫下這趟的心情、天氣、遇到的人…", text: $diary, axis: .vertical)
                .lineLimit(5...)
                .padding(12)
                .background(.fill.quaternary, in: .rect(cornerRadius: 12))
        }
    }

    private func activate(_ id: String) {
        guard let card = trip.flatMap({ derived?.cards($0) })?.first(where: { $0.id == id }) else { return }
        switch card.kind {
        case .photo(let photo, _): viewerStart = ViewerStart(id: photo.id)
        case .poi(let poi): poiDetail = poi
        }
    }

    private func saveDiary() {
        guard diaryLoaded, var trip, trip.diary != diary else { return }
        trip.diary = diary
        do { try store.save(trip) } catch { saveError = error.localizedDescription }
    }

    private func rename() {
        let title = newTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, var trip else { return }
        trip.title = title
        do { try store.save(trip) } catch { saveError = error.localizedDescription }
    }
}

private struct ViewerStart: Identifiable {
    let id: UUID
}

private struct Card: Identifiable {
    enum Kind {
        case photo(TripPhoto, placed: Bool)
        case poi(POI)
    }

    let id: String
    let kind: Kind
    let altitude: Double?
}

private struct ProfilePoint: Identifiable {
    let id: Int
    let km: Double
    let altitude: Double
}

private struct Derived {
    let content: TripContent
    let hasGPX: Bool
    let track: [Coordinate]
    let pins: [MapPin]
    let profile: [ProfilePoint]
    let placedByID: [UUID: PlacedPhoto]

    // ponytail: derived on the main actor because TripStore and MapData are main-actor types; fine for tens of points and photos, move file reads and RouteBuilder into a @concurrent helper if long GPX imports start to hitch the push animation.
    @MainActor init(trip: Trip, store: TripStore, mapData: MapData) {
        content = store.content(for: trip, mapData: mapData)
        hasGPX = !store.gpx(for: trip).isEmpty
        track = store.track(for: trip).map(\.coordinate)
        placedByID = Dictionary(content.placed.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        pins = content.timeline.map { item in
            switch item {
            case .photo(let id, _, let c, _, _):
                MapPin(id: item.id, coordinate: c, kind: .photo(thumbnail: store.thumbURL(TripPhoto(id: id), in: trip)))
            case .poi(let poi, _, let c, _, _):
                MapPin(id: item.id, coordinate: c, kind: .poi(kind: poi.kind, name: poi.name))
            }
        }
        let route = content.route
        profile = route.points.indices.compactMap { i in
            route.points[i].altitude.map { ProfilePoint(id: i, km: route.distances[i] / 1000, altitude: $0) }
        }
    }

    func cards(_ trip: Trip) -> [Card] {
        let placed = content.timeline.compactMap { item -> Card? in
            switch item {
            case .photo(let id, _, _, _, let altitude):
                trip.photos.first { $0.id == id }.map { Card(id: item.id, kind: .photo($0, placed: true), altitude: altitude) }
            case .poi(let poi, _, _, _, let altitude):
                Card(id: item.id, kind: .poi(poi), altitude: altitude)
            }
        }
        let lost = content.placed.filter { !$0.isPlaced }.compactMap { p in
            trip.photos.first { $0.id == p.id }.map { Card(id: "photo-\($0.id.uuidString)", kind: .photo($0, placed: false), altitude: p.altitude) }
        }
        return placed + lost
    }
}

private struct POIDetailSheet: View {
    let poi: POI
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                LabeledContent("類型") {
                    Label(Format.poiKind(poi.kind).name, systemImage: Format.poiKind(poi.kind).symbol)
                }
                LabeledContent("海拔", value: Format.altitude(poi.ele))
                LabeledContent("座標", value: Format.coordinate(poi.coordinate))
                Section {
                } footer: {
                    Text("來自地圖資料")
                }
            }
            .navigationTitle(poi.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
