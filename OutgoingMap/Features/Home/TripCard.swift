import SwiftUI
import ImageIO

struct CardStats {
    var distance: Double
    var maxAltitude: Double?
    var shape: [Coordinate]
    var cover: UIImage?
}

@MainActor private enum CardCache {
    static var items: [UUID: (token: String, stats: CardStats)] = [:]
}

struct TripCard: View {
    let trip: Trip

    @Environment(TripStore.self) private var store
    @Environment(MapData.self) private var mapData
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var loaded: CardStats?

    private var stats: CardStats? { loaded ?? CardCache.items[trip.id]?.stats }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            cover
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(trip.title).font(.title3.bold())
                    Text(Format.day(trip.startedAt)).font(.subheadline).foregroundStyle(.secondary)
                }
                let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8)) : AnyLayout(HStackLayout(alignment: .top))
                layout {
                    stat("約略距離", stats.map { Format.distance($0.distance) } ?? "—")
                    stat("最高海拔", Format.altitude(stats?.maxAltitude))
                    stat("照片數", "\(trip.photos.count) 張")
                }
            }
            .padding(16)
        }
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .accessibilityElement(children: .combine)
        .task(id: trip) { await refresh() }
    }

    private var cover: some View {
        Color.clear
            .aspectRatio(16 / 10, contentMode: .fit)
            .background {
                if let image = stats?.cover {
                    Image(uiImage: image).resizable().scaledToFill()
                } else if let photo = trip.photos.first, let thumb = LocalImage.load(store.thumbURL(photo, in: trip)) {
                    Image(uiImage: thumb).resizable().scaledToFill()
                } else {
                    LinearGradient(colors: [Color.accentColor.opacity(0.18), Color.accentColor.opacity(0.06)], startPoint: .top, endPoint: .bottom)
                        .overlay { Image(systemName: "mountain.2.fill").font(.system(size: 44)).foregroundStyle(Color.accentColor.opacity(0.4)) }
                }
            }
            .clipped()
            .overlay(alignment: .topLeading) {
                if trip.state == .recording {
                    Label("記錄中", systemImage: "circle.fill")
                        .font(.caption.bold())
                        .foregroundStyle(Color.accentColor)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(.regularMaterial, in: Capsule())
                        .padding(12)
                }
            }
            .overlay(alignment: .bottomTrailing) {
                if let shape = stats?.shape, shape.count > 1 {
                    RouteShape(coordinates: shape)
                        .frame(width: 72, height: 72)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .padding(12)
                        .accessibilityHidden(true)
                }
            }
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.headline.monospacedDigit()).lineLimit(1).minimumScaleFactor(0.7)
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func refresh() async {
        let folder = store.folder(for: trip)
        let track = folder.appending(path: "track.jsonl"), gpx = folder.appending(path: "gpx.jsonl")
        let dem = mapData.elevation
        let token = [
            "\(trip.photos.count)", "\(trip.state)", "\(trip.endedAt?.timeIntervalSince1970 ?? 0)", "\(dem != nil)",
            "\(trip.photos.first?.id.uuidString ?? "")", Self.modified(track), Self.modified(gpx),
        ].joined(separator: "|")

        if let hit = CardCache.items[trip.id], hit.token == token {
            loaded = hit.stats
            return
        }
        let coverURL = trip.photos.first.map { store.photoURL($0, in: trip) }
        let result = await Self.compute(photos: trip.photos, track: track, gpx: gpx, dem: dem, coverURL: coverURL)
        guard !Task.isCancelled else { return }
        CardCache.items[trip.id] = (token, result)
        loaded = result
    }

    private static func modified(_ url: URL) -> String {
        let date = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
        return "\(date?.timeIntervalSince1970 ?? 0)"
    }

    @concurrent private static func compute(photos: [TripPhoto], track: URL, gpx: URL, dem: ElevationSource?, coverURL: URL?) async -> CardStats {
        let route = RouteBuilder.build(
            track: (try? TrackFile(url: track).readAll()) ?? [],
            gpx: (try? TrackFile(url: gpx).readAll()) ?? [],
            photos: photos
        )
        let altitudes = route.points.compactMap { $0.altitude ?? dem?.elevation(lat: $0.lat, lon: $0.lon) }

        let coordinates = route.coordinates
        let step = max(1, coordinates.count / 120)
        var shape = coordinates.enumerated().filter { $0.offset % step == 0 }.map(\.element)
        if let last = coordinates.last, shape.last != last { shape.append(last) }

        var cover: UIImage?
        if let coverURL, let source = CGImageSourceCreateWithURL(coverURL as CFURL, nil) {
            let options: [CFString: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceShouldCacheImmediately: true,
                kCGImageSourceThumbnailMaxPixelSize: 1000,
            ]
            cover = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary).map { UIImage(cgImage: $0) }
        }
        return CardStats(distance: route.totalDistance, maxAltitude: altitudes.max(), shape: shape, cover: cover)
    }
}

struct RouteShape: View {
    let coordinates: [Coordinate]

    var body: some View {
        Canvas { context, size in
            let lats = coordinates.map(\.lat), lons = coordinates.map(\.lon)
            guard let minLat = lats.min(), let maxLat = lats.max(), let minLon = lons.min(), let maxLon = lons.max() else { return }

            let k = cos((minLat + maxLat) / 2 * .pi / 180)
            let width = (maxLon - minLon) * k, height = maxLat - minLat
            let inset = 10.0
            let scale = min((size.width - 2 * inset) / max(width, 1e-9), (size.height - 2 * inset) / max(height, 1e-9))
            let originX = (size.width - width * scale) / 2, originY = (size.height - height * scale) / 2

            var path = Path()
            for (i, c) in coordinates.enumerated() {
                let point = CGPoint(x: originX + (c.lon - minLon) * k * scale, y: originY + (maxLat - c.lat) * scale)
                if i == 0 { path.move(to: point) } else { path.addLine(to: point) }
            }
            context.stroke(path, with: .color(.accentColor), style: StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round))
        }
    }
}
