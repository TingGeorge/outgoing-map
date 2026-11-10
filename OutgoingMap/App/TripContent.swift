import SwiftUI

struct TripContent {
    let trip: Trip
    let route: Route
    let placed: [PlacedPhoto]
    let nearbyPOIs: [(poi: POI, fraction: Double)]
    let timeline: [TimelineItem]

    func photo(_ id: UUID) -> TripPhoto? {
        trip.photos.first { $0.id == id }
    }
}

extension TripStore {
    static let poiRadius = 150.0

    func content(for trip: Trip, mapData: MapData) -> TripContent {
        var route = RouteBuilder.build(track: track(for: trip), gpx: gpx(for: trip), photos: trip.photos)

        if let dem = mapData.elevation, route.points.contains(where: { $0.altitude == nil }) {
            route = Route(points: route.points.map { p in
                var p = p
                p.altitude = p.altitude ?? dem.elevation(lat: p.lat, lon: p.lon)
                return p
            })
        }

        let placed = PhotoPlacement.place(photos: trip.photos, on: route)
        let pois = mapData.pois?.pois(near: route, within: Self.poiRadius) ?? []

        return TripContent(
            trip: trip, route: route, placed: placed, nearbyPOIs: pois,
            timeline: Timeline.build(route: route, placed: placed, pois: pois)
        )
    }
}

enum Format {
    static let locale = Locale(identifier: "zh_Hant_TW")

    static func distance(_ metres: Double) -> String {
        metres < 1000 ? "\(Int(metres.rounded())) m" : String(format: "%.1f km", metres / 1000)
    }

    static func altitude(_ metres: Double?) -> String {
        guard let metres else { return "—" }
        return "\(Int(metres.rounded()).formatted(.number.locale(locale))) m"
    }

    static func clock(_ date: Date?) -> String {
        guard let date else { return "—" }
        return date.formatted(.dateTime.hour(.twoDigits(amPM: .omitted)).minute(.twoDigits).locale(locale))
    }

    static func day(_ date: Date) -> String {
        date.formatted(.dateTime.year().month().day().weekday(.abbreviated).locale(locale))
    }

    static func duration(_ seconds: TimeInterval) -> String {
        let minutes = Int(seconds / 60)
        return "\(minutes / 60):" + String(format: "%02d", minutes % 60)
    }

    static func coordinate(_ c: Coordinate) -> String {
        String(format: "%.4f°%@ %.4f°%@", abs(c.lat), c.lat >= 0 ? "N" : "S", abs(c.lon), c.lon >= 0 ? "E" : "W")
    }

    static func poiKind(_ kind: String) -> (name: String, symbol: String) {
        switch kind {
        case "peak": ("山頭", "mountain.2.fill")
        case "hut": ("山屋", "house.fill")
        case "shelter": ("避難小屋", "house.lodge.fill")
        case "trailhead": ("登山口", "signpost.right.fill")
        case "waterfall": ("瀑布", "drop.fill")
        case "viewpoint": ("觀景點", "binoculars.fill")
        case "water": ("水源", "waterbottle.fill")
        case "campsite": ("營地", "tent.fill")
        case "saddle": ("鞍部", "arrow.left.and.right")
        case "lake": ("湖泊", "water.waves")
        case "hotspring": ("溫泉", "flame.fill")
        default: ("地點", "mappin")
        }
    }
}

struct LocalImage: View {
    let url: URL

    private static let cache = NSCache<NSURL, UIImage>()

    var body: some View {
        if let image = Self.load(url) {
            Image(uiImage: image).resizable()
        } else {
            Rectangle().fill(.quaternary)
        }
    }

    static func load(_ url: URL) -> UIImage? {
        if let hit = cache.object(forKey: url as NSURL) { return hit }
        guard let image = UIImage(contentsOfFile: url.path) else { return nil }
        cache.setObject(image, forKey: url as NSURL)
        return image
    }
}
