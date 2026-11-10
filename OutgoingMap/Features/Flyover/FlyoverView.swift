import Charts
import SceneKit
import SwiftUI

struct FlyoverView: View {
    let content: TripContent

    @Environment(TripStore.self) private var store
    @Environment(MapData.self) private var mapData
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var model: FlyoverModel

    init(content: TripContent) {
        self.content = content
        _model = State(initialValue: FlyoverModel(content: content))
    }

    var body: some View {
        ZStack {
            Color(uiColor: FlyoverWorld.sky).ignoresSafeArea()

            if let view = model.view {
                SceneHost(view: view).ignoresSafeArea()
            } else if model.isLoading {
                ProgressView("正在建立 3D 地形…")
                    .padding(20)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
            } else {
                ContentUnavailableView("無法播放飛覽", systemImage: "mountain.2",
                                       description: Text("這趟行程的軌跡點不足。"))
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
                    .padding(40)
            }

            VStack(spacing: 8) {
                HStack(alignment: .top, spacing: 8) {
                    if model.view != nil {
                        FlyoverHUD(model: model)
                    } else {
                        Spacer()
                    }
                    Button("關閉", systemImage: "xmark") {
                        model.stop()
                        dismiss()
                    }
                    .labelStyle(.iconOnly)
                    .font(.headline)
                    .frame(width: 44, height: 44)
                    .background(.regularMaterial, in: Circle())
                    .foregroundStyle(.primary)
                }
                ForEach(model.missing, id: \.self) { text in
                    Label(text, systemImage: "exclamationmark.triangle")
                        .font(.footnote)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(.regularMaterial, in: Capsule())
                }
                Spacer()
                if let poi = model.poi {
                    POICard(poi: poi) { model.poi = nil }
                }
                if model.view != nil {
                    FlyoverControls(model: model)
                }
            }
            .padding(.horizontal)
            .padding(.bottom, 8)

            if let id = model.popup, let photo = content.photo(id) {
                PhotoPopup(photo: photo, url: store.photoURL(photo, in: content.trip))
            }

            if model.viewer != nil {
                PhotoViewer(content: content, store: store, selection: $model.viewer)
            }
        }
        .animation(reduceMotion ? nil : .easeOut(duration: 0.25), value: model.popup)
        .task {
            model.reduceMotion = reduceMotion
            await model.load(store: store, mapData: mapData)
        }
        .onChange(of: reduceMotion) { _, value in
            model.reduceMotion = value
            if value { model.pause() }
        }
        .onDisappear { model.stop() }
    }
}

private struct SceneHost: UIViewRepresentable {
    let view: SCNView

    func makeUIView(context: Context) -> SCNView { view }
    func updateUIView(_ uiView: SCNView, context: Context) {}
}

private struct FlyoverHUD: View {
    let model: FlyoverModel

    var body: some View {
        let route = model.content.route
        let p = model.progress
        let sample = route.sample(at: p)
        let walked = route.points.indices.filter { route.distances[$0] <= p * route.totalDistance }
        let ascent = Geo.ascent(of: walked.compactMap { route.points[$0].altitude } + [sample?.altitude].compactMap { $0 })
        let elapsed = if let start = route.start, let time = sample?.time { Format.duration(time.timeIntervalSince(start)) } else { "—" }

        VStack(spacing: 6) {
            HStack {
                stat("距離", Format.distance(route.totalDistance * p))
                stat("時間", elapsed)
                stat("爬升", Format.altitude(ascent))
            }
            ZStack {
                profile(Color.secondary.opacity(0.35))
                profile(Color.accentColor)
                    .mask(alignment: .leading) {
                        GeometryReader { geo in Rectangle().frame(width: geo.size.width * p) }
                    }
            }
            .frame(height: 40)
            .overlay {
                GeometryReader { geo in
                    ForEach(model.stops) { stop in
                        Capsule()
                            .fill(stop.fraction <= p + 1e-6 ? Color.accentColor : Color.secondary)
                            .overlay(Capsule().stroke(.background, lineWidth: 1))
                            .frame(width: 4, height: 14)
                            .frame(width: 28, height: 40)
                            .contentShape(Rectangle())
                            .position(x: geo.size.width * stop.fraction, y: geo.size.height - 7)
                            .onTapGesture { model.openPhoto(stop.id) }
                            .accessibilityLabel("照片 \(Format.clock(stop.time))")
                            .accessibilityAddTraits(.isButton)
                    }
                }
            }
        }
        .padding(10)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
    }

    private func stat(_ title: String, _ value: String) -> some View {
        VStack(spacing: 1) {
            Text(title).font(.caption2).foregroundStyle(.secondary)
            Text(value).font(.subheadline.weight(.semibold).monospacedDigit())
        }
        .frame(maxWidth: .infinity)
    }

    private func profile(_ color: Color) -> some View {
        let route = model.content.route
        let altitudes = route.points.compactMap(\.altitude)
        let low = (altitudes.min() ?? 0) - 40, high = (altitudes.max() ?? 1) + 20
        return Chart(route.points.indices, id: \.self) { i in
            AreaMark(x: .value("距離", route.distances[i]),
                     yStart: .value("基準", low),
                     yEnd: .value("海拔", route.points[i].altitude ?? low))
                .foregroundStyle(color)
                .interpolationMethod(.monotone)
        }
        .chartXScale(domain: 0...max(route.totalDistance, 1))
        .chartYScale(domain: low...high)
        .chartXAxis(.hidden)
        .chartYAxis(.hidden)
        .accessibilityHidden(true)
    }
}

private struct FlyoverControls: View {
    let model: FlyoverModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: 10) {
            Slider(value: Binding(get: { model.progress }, set: { model.scrub(to: $0) }), in: 0...1) {
                Text("播放進度")
            }
            HStack {
                if !reduceMotion {
                    Button(model.isPlaying ? "暫停" : "播放", systemImage: model.isPlaying ? "pause.fill" : "play.fill") {
                        model.isPlaying ? model.pause() : model.play()
                    }
                    .buttonStyle(.borderedProminent)
                }
                Spacer()
                Button("看全程", systemImage: "arrow.up.left.and.arrow.down.right") { model.overview() }
                    .buttonStyle(.bordered)
            }
        }
        .padding(12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20))
    }
}

private struct POICard: View {
    let poi: POI
    let close: () -> Void

    var body: some View {
        let kind = Format.poiKind(poi.kind)
        HStack(spacing: 12) {
            Image(systemName: kind.symbol)
                .font(.title2)
                .foregroundStyle(.tint)
                .frame(width: 32)
            VStack(alignment: .leading, spacing: 2) {
                Text(poi.name).font(.headline)
                Text("\(kind.name)・海拔 \(Format.altitude(poi.ele))")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button("關閉", systemImage: "xmark.circle.fill", action: close)
                .labelStyle(.iconOnly)
                .font(.title2)
                .foregroundStyle(.secondary)
        }
        .padding(14)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
    }
}

private struct PhotoPopup: View {
    let photo: TripPhoto
    let url: URL

    var body: some View {
        ZStack {
            Color.black.opacity(0.5).ignoresSafeArea()
            VStack(spacing: 12) {
                LocalImage(url: url)
                    .aspectRatio(contentMode: .fit)
                    .clipShape(RoundedRectangle(cornerRadius: 18))
                    .shadow(radius: 20)
                Text(Format.clock(photo.takenAt))
                    .font(.headline.monospacedDigit())
                if !photo.caption.isEmpty {
                    Text(photo.caption)
                        .font(.title3.weight(.semibold))
                        .multilineTextAlignment(.center)
                }
            }
            .foregroundStyle(.white)
            .padding(24)
        }
        .transition(.opacity.combined(with: .scale(scale: 0.94)))
        .allowsHitTesting(false)
    }
}

private struct PhotoViewer: View {
    let content: TripContent
    let store: TripStore
    @Binding var selection: UUID?

    var body: some View {
        let photos = content.trip.photos.sorted { ($0.takenAt ?? .distantPast) < ($1.takenAt ?? .distantPast) }
        if let i = photos.firstIndex(where: { $0.id == selection }) {
            let photo = photos[i]
            let placed = content.placed.first { $0.id == photo.id }
            VStack(spacing: 14) {
                HStack {
                    Text("\(i + 1) / \(photos.count)")
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button("關閉", systemImage: "xmark") { selection = nil }
                        .labelStyle(.iconOnly)
                        .buttonStyle(.bordered)
                        .buttonBorderShape(.circle)
                }
                LocalImage(url: store.photoURL(photo, in: content.trip))
                    .aspectRatio(contentMode: .fit)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                    .frame(maxHeight: .infinity)
                if !photo.caption.isEmpty {
                    Text(photo.caption)
                        .font(.title3.weight(.semibold))
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 6) {
                    row("拍攝時間", photo.takenAt.map { "\(Format.day($0)) \(Format.clock($0))" } ?? "—")
                    row("海拔", Format.altitude(placed?.altitude ?? photo.altitude))
                    row("座標", (placed?.coordinate ?? photo.coordinate).map(Format.coordinate) ?? "—")
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                HStack {
                    Button("上一張", systemImage: "chevron.left") { selection = photos[i - 1].id }
                        .disabled(i == 0)
                    Spacer()
                    Button("下一張", systemImage: "chevron.right") { selection = photos[i + 1].id }
                        .disabled(i == photos.count - 1)
                }
                .buttonStyle(.bordered)
            }
            .padding()
            .background(Color(.systemBackground).ignoresSafeArea())
        }
    }

    private func row(_ title: String, _ value: String) -> some View {
        GridRow {
            Text(title).foregroundStyle(.secondary)
            Text(value).monospacedDigit()
        }
        .font(.subheadline)
    }
}
