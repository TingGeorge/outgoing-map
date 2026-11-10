import SwiftUI
import PhotosUI
import ImageIO
import UniformTypeIdentifiers

struct ImportSummary {
    var added = 0
    var noLocation = 0
    var duplicates = 0
    var skipped = 0
    var saveError: String?

    var line: String {
        if let saveError { return "儲存失敗：\(saveError)" }
        var text = added == 0 ? "沒有加入任何照片" : "已加入 \(added) 張"
        if added > 0, noLocation > 0 { text += "，其中 \(noLocation) 張沒有定位" }
        var extras: [String] = []
        if duplicates > 0 { extras.append("\(duplicates) 張已在旅程中") }
        if skipped > 0 { extras.append("\(skipped) 張無法讀取而略過") }
        if !extras.isEmpty { text += "（" + extras.joined(separator: "、") + "）" }
        return text
    }
}

@Observable @MainActor final class PhotoImporter {
    private(set) var done = 0
    private(set) var total = 0

    func run(_ items: [PhotosPickerItem], into trip: Trip, store: TripStore, mapData: MapData) async -> ImportSummary {
        await run(count: items.count, into: trip, store: store, mapData: mapData) { i in
            guard items[i].supportedContentTypes.contains(where: { $0.conforms(to: .image) }) else { return nil }
            return try? await items[i].loadTransferable(type: Data.self)
        }
    }

    func run(count: Int, into trip: Trip, store: TripStore, mapData: MapData, load: (Int) async -> Data?) async -> ImportSummary {
        var trip = trip
        var summary = ImportSummary()
        done = 0
        total = count

        for i in 0..<count {
            defer { done += 1 }

            guard let data = await load(i), let meta = await Self.metadata(of: data)
            else { summary.skipped += 1; continue }

            let hasIdentity = meta.takenAt != nil || meta.lat != nil
            if hasIdentity, trip.photos.contains(where: { $0.takenAt == meta.takenAt && $0.lat == meta.lat && $0.lon == meta.lon }) {
                summary.duplicates += 1
                continue
            }

            let photo = TripPhoto(takenAt: meta.takenAt, lat: meta.lat, lon: meta.lon, altitude: meta.altitude)
            guard await Self.writeImages(data, display: store.photoURL(photo, in: trip), thumb: store.thumbURL(photo, in: trip)) else {
                summary.skipped += 1
                continue
            }
            trip.photos.append(photo)
            summary.added += 1
            if meta.lat == nil { summary.noLocation += 1 }
        }

        guard summary.added > 0 else { return summary }

        if trip.intervalMinutes == 0 {
            let times = trip.photos.compactMap(\.takenAt)
            if let first = times.min(), let last = times.max() {
                trip.startedAt = first
                trip.endedAt = last
            }
        }

        if trip.title.hasPrefix("健行 ") {
            // ponytail: content(for:) runs on the main actor; a photo-only route is tiny, but a long GPX would need this moved off-main.
            let peaks = store.content(for: trip, mapData: mapData).nearbyPOIs.map(\.poi).filter { $0.kind == "peak" }
            trip.title = peaks.max { ($0.ele ?? 0) < ($1.ele ?? 0) }?.name
                ?? "健行 " + trip.startedAt.formatted(.dateTime.month().day().locale(Format.locale))
        }

        do {
            try store.save(trip)
        } catch {
            summary.saveError = error.localizedDescription
        }
        return summary
    }

    @concurrent private static func metadata(of data: Data) async -> PhotoMetadata? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil), CGImageSourceGetCount(source) > 0,
              let type = CGImageSourceGetType(source), UTType(type as String)?.conforms(to: .image) == true
        else { return nil }
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any] ?? [:]
        return ExifParser.parse(properties)
    }

    @concurrent private static func writeImages(_ data: Data, display: URL, thumb: URL) async -> Bool {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int,
              let height = properties[kCGImagePropertyPixelHeight] as? Int,
              (try? FileManager.default.createDirectory(at: display.deletingLastPathComponent(), withIntermediateDirectories: true)) != nil
        else { return false }
        let longest = max(width, height)
        return encode(source, maxSide: min(2048, longest), quality: 0.85, to: display)
            && encode(source, maxSide: min(400, longest), quality: 0.8, to: thumb)
    }

    private nonisolated static func encode(_ source: CGImageSource, maxSide: Int, quality: Double, to url: URL) -> Bool {
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxSide,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary),
              let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.jpeg.identifier as CFString, 1, nil)
        else { return false }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        return CGImageDestinationFinalize(destination)
    }
}
