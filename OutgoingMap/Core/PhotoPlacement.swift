import Foundation

public struct PlacedPhoto: Codable, Sendable, Hashable, Identifiable {
    public var id: UUID
    public var coordinate: Coordinate?
    public var fraction: Double
    public var altitude: Double?
    public var time: Date?

    public init(id: UUID, coordinate: Coordinate?, fraction: Double, altitude: Double?, time: Date?) {
        self.id = id
        self.coordinate = coordinate
        self.fraction = fraction
        self.altitude = altitude
        self.time = time
    }

    public var isPlaced: Bool { coordinate != nil }
}

public enum PhotoPlacement {
    public static let timeTolerance: TimeInterval = 30 * 60

    public static func place(photos: [TripPhoto], on route: Route) -> [PlacedPhoto] {
        let line = route.coordinates
        return photos.map { photo in
            if let c = photo.coordinate {
                let fraction = Geo.nearest(to: c, on: line)?.fraction ?? 0
                return PlacedPhoto(id: photo.id, coordinate: c, fraction: fraction, altitude: photo.altitude, time: photo.takenAt)
            }
            if let time = photo.takenAt, let hit = locate(time, on: route) {
                return PlacedPhoto(id: photo.id, coordinate: hit.coordinate, fraction: hit.fraction, altitude: photo.altitude ?? hit.altitude, time: time)
            }
            return PlacedPhoto(id: photo.id, coordinate: nil, fraction: 0, altitude: photo.altitude, time: photo.takenAt)
        }
    }

    static func locate(_ time: Date, on route: Route) -> (coordinate: Coordinate, fraction: Double, altitude: Double?)? {
        let timed = route.points.indices.filter { route.points[$0].time != nil }
        guard let firstIndex = timed.first, let lastIndex = timed.last,
              let start = route.points[firstIndex].time, let end = route.points[lastIndex].time,
              time >= start - timeTolerance, time <= end + timeTolerance
        else { return nil }

        let t = min(max(time, start), end)
        let total = route.totalDistance
        let fractionOf = { (i: Int) in total > 0 ? route.distances[i] / total : 0 }

        guard let upper = timed.first(where: { route.points[$0].time! >= t }), upper != firstIndex else {
            let p = route.points[firstIndex]
            return (p.coordinate, fractionOf(firstIndex), p.altitude)
        }
        let lower = timed[timed.firstIndex(of: upper)! - 1]
        let a = route.points[lower], b = route.points[upper]
        let span = b.time!.timeIntervalSince(a.time!)
        let k = span > 0 ? t.timeIntervalSince(a.time!) / span : 0

        var altitude = a.altitude ?? b.altitude
        if let x = a.altitude, let y = b.altitude { altitude = x + (y - x) * k }
        let fraction = fractionOf(lower) + (fractionOf(upper) - fractionOf(lower)) * k
        return (Geo.interpolate(a.coordinate, b.coordinate, k), fraction, altitude)
    }
}
