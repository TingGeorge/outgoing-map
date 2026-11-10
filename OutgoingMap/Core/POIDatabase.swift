import Foundation
import SQLite3

public final class POIDatabase: Sendable {
    public static let duplicateRadius = 200.0

    public let url: URL
    private let reader: SQLiteReader

    public init(url: URL) throws {
        self.url = url
        reader = try SQLiteReader(url: url)
    }

    public func pois(in bbox: BoundingBox) -> [POI] {
        reader.query(
            "SELECT id, name, kind, lat, lon, ele FROM poi WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?",
            [bbox.minLat, bbox.maxLat, bbox.minLon, bbox.maxLon]
        ) { stmt in
            POI(
                id: sqlite3_column_int64(stmt, 0),
                name: SQLiteReader.text(stmt, 1) ?? "",
                kind: SQLiteReader.text(stmt, 2) ?? "other_hiking",
                lat: sqlite3_column_double(stmt, 3),
                lon: sqlite3_column_double(stmt, 4),
                ele: SQLiteReader.double(stmt, 5)
            )
        }
    }

    // ponytail: brute-force nearest-segment scan per candidate, O(POIs x route points); add a segment grid index if long GPX routes get slow.
    public func pois(near route: Route, within metres: Double) -> [(poi: POI, fraction: Double)] {
        let line = route.coordinates
        guard let box = Geo.boundingBox(of: line, padding: metres) else { return [] }

        let hits = pois(in: box).compactMap { poi -> (poi: POI, fraction: Double)? in
            guard let hit = Geo.nearest(to: poi.coordinate, on: line), hit.distance <= metres else { return nil }
            return (poi, hit.fraction)
        }.sorted { $0.fraction < $1.fraction }

        var kept: [(poi: POI, fraction: Double)] = []
        for hit in hits where !kept.contains(where: {
            $0.poi.name == hit.poi.name && Geo.distance($0.poi.coordinate, hit.poi.coordinate) <= Self.duplicateRadius
        }) {
            kept.append(hit)
        }
        return kept
    }
}
