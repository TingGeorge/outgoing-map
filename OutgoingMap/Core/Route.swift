import Foundation

public struct RoutePoint: Codable, Sendable, Hashable {
    public var lat: Double
    public var lon: Double
    public var altitude: Double?
    public var time: Date?

    public init(lat: Double, lon: Double, altitude: Double? = nil, time: Date? = nil) {
        self.lat = lat
        self.lon = lon
        self.altitude = altitude
        self.time = time
    }

    public var coordinate: Coordinate { Coordinate(lat: lat, lon: lon) }
}

public struct Route: Codable, Sendable, Hashable {
    public var points: [RoutePoint]
    public var distances: [Double]
    public var totalDistance: Double
    public var ascent: Double
    public var maxAltitude: Double?
    public var start: Date?
    public var end: Date?

    public init(points: [RoutePoint]) {
        self.points = points
        distances = Geo.cumulativeDistances(points.map(\.coordinate))
        totalDistance = distances.last ?? 0
        let altitudes = points.compactMap(\.altitude)
        ascent = Geo.ascent(of: altitudes)
        maxAltitude = altitudes.max()
        let times = points.compactMap(\.time)
        start = times.min()
        end = times.max()
    }

    public var coordinates: [Coordinate] { points.map(\.coordinate) }

    public func sample(at fraction: Double) -> (coordinate: Coordinate, altitude: Double?, time: Date?)? {
        guard let first = points.first else { return nil }
        guard totalDistance > 0 else { return (first.coordinate, first.altitude, first.time) }

        let target = min(max(fraction, 0), 1) * totalDistance
        let i = max(1, distances.firstIndex { $0 >= target } ?? points.count - 1)
        let a = points[i - 1], b = points[i]
        let segment = distances[i] - distances[i - 1]
        let t = segment > 0 ? (target - distances[i - 1]) / segment : 0

        var altitude = a.altitude ?? b.altitude
        if let x = a.altitude, let y = b.altitude { altitude = x + (y - x) * t }
        var time = a.time ?? b.time
        if let x = a.time, let y = b.time { time = x + y.timeIntervalSince(x) * t }
        return (Geo.interpolate(a.coordinate, b.coordinate, t), altitude, time)
    }
}

public enum RouteBuilder {
    public static let maxAccuracy = 100.0

    public static func build(track: [TrackPoint], gpx: [TrackPoint], photos: [TripPhoto]) -> Route {
        if !gpx.isEmpty {
            return Route(points: gpx.map(routePoint))
        }

        var recorded = track
        if recorded.contains(where: { ($0.horizontalAccuracy ?? 0) <= maxAccuracy }) {
            recorded.removeAll { ($0.horizontalAccuracy ?? 0) > maxAccuracy }
        }

        var points = recorded.map(routePoint)
        for photo in photos {
            guard let c = photo.coordinate, let time = photo.takenAt else { continue }
            points.append(RoutePoint(lat: c.lat, lon: c.lon, altitude: photo.altitude, time: time))
        }
        points.sort { ($0.time ?? .distantPast) < ($1.time ?? .distantPast) }
        return Route(points: points)
    }

    static func routePoint(_ p: TrackPoint) -> RoutePoint {
        RoutePoint(lat: p.lat, lon: p.lon, altitude: p.altitude, time: p.hasTime ? p.time : nil)
    }
}
