import Foundation

public enum TimelineItem: Sendable, Hashable, Identifiable {
    case photo(id: UUID, fraction: Double, coordinate: Coordinate, time: Date?, altitude: Double?)
    case poi(POI, fraction: Double, coordinate: Coordinate, time: Date?, altitude: Double?)

    public var id: String {
        switch self {
        case .photo(let id, _, _, _, _): "photo-\(id.uuidString)"
        case .poi(let poi, _, _, _, _): "poi-\(poi.id)"
        }
    }

    public var fraction: Double {
        switch self {
        case .photo(_, let f, _, _, _), .poi(_, let f, _, _, _): f
        }
    }

    public var coordinate: Coordinate {
        switch self {
        case .photo(_, _, let c, _, _), .poi(_, _, let c, _, _): c
        }
    }

    public var time: Date? {
        switch self {
        case .photo(_, _, _, let t, _), .poi(_, _, _, let t, _): t
        }
    }

    public var altitude: Double? {
        switch self {
        case .photo(_, _, _, _, let a), .poi(_, _, _, _, let a): a
        }
    }
}

public enum Timeline {
    public static func build(route: Route, placed: [PlacedPhoto], pois: [(poi: POI, fraction: Double)]) -> [TimelineItem] {
        let photos = placed.compactMap { p -> TimelineItem? in
            guard let c = p.coordinate else { return nil }
            return .photo(id: p.id, fraction: p.fraction, coordinate: c, time: p.time, altitude: p.altitude)
        }
        let places = pois.map { hit -> TimelineItem in
            let sample = route.sample(at: hit.fraction)
            return .poi(hit.poi, fraction: hit.fraction, coordinate: hit.poi.coordinate,
                        time: sample?.time, altitude: hit.poi.ele ?? sample?.altitude)
        }
        return (photos + places).sorted {
            $0.fraction != $1.fraction ? $0.fraction < $1.fraction : ($0.time ?? .distantPast) < ($1.time ?? .distantPast)
        }
    }
}
