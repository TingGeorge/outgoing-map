import Foundation

public struct Coordinate: Codable, Sendable, Hashable {
    public var lat: Double
    public var lon: Double

    public init(lat: Double, lon: Double) {
        self.lat = lat
        self.lon = lon
    }
}

public struct TrackPoint: Codable, Sendable, Hashable {
    public static let noTime = Date.distantPast

    public var time: Date
    public var lat: Double
    public var lon: Double
    public var altitude: Double?
    public var horizontalAccuracy: Double?
    public var verticalAccuracy: Double?
    public var course: Double?
    public var speed: Double?
    public var pressureKPa: Double?
    public var relativeAltitude: Double?
    public var steps: Int?
    public var battery: Double?

    public init(
        time: Date, lat: Double, lon: Double, altitude: Double? = nil,
        horizontalAccuracy: Double? = nil, verticalAccuracy: Double? = nil,
        course: Double? = nil, speed: Double? = nil,
        pressureKPa: Double? = nil, relativeAltitude: Double? = nil,
        steps: Int? = nil, battery: Double? = nil
    ) {
        self.time = time
        self.lat = lat
        self.lon = lon
        self.altitude = altitude
        self.horizontalAccuracy = horizontalAccuracy
        self.verticalAccuracy = verticalAccuracy
        self.course = course
        self.speed = speed
        self.pressureKPa = pressureKPa
        self.relativeAltitude = relativeAltitude
        self.steps = steps
        self.battery = battery
    }

    public var coordinate: Coordinate { Coordinate(lat: lat, lon: lon) }
    public var hasTime: Bool { time != Self.noTime }
}

public struct TripPhoto: Codable, Sendable, Hashable, Identifiable {
    public var id: UUID
    public var takenAt: Date?
    public var lat: Double?
    public var lon: Double?
    public var altitude: Double?
    public var caption: String
    public var fileName: String

    public init(
        id: UUID = UUID(), takenAt: Date? = nil, lat: Double? = nil, lon: Double? = nil,
        altitude: Double? = nil, caption: String = "", fileName: String = ""
    ) {
        self.id = id
        self.takenAt = takenAt
        self.lat = lat
        self.lon = lon
        self.altitude = altitude
        self.caption = caption
        self.fileName = fileName.isEmpty ? "\(id.uuidString).jpg" : fileName
    }

    public var coordinate: Coordinate? {
        guard let lat, let lon else { return nil }
        return Coordinate(lat: lat, lon: lon)
    }
}

public enum TripState: String, Codable, Sendable {
    case recording, finished
}

public struct Trip: Codable, Sendable, Hashable, Identifiable {
    public var id: UUID
    public var title: String
    public var startedAt: Date
    public var endedAt: Date?
    public var intervalMinutes: Int
    public var state: TripState
    public var diary: String
    public var photos: [TripPhoto]

    public init(
        id: UUID = UUID(), title: String, startedAt: Date, endedAt: Date? = nil,
        intervalMinutes: Int, state: TripState, diary: String = "", photos: [TripPhoto] = []
    ) {
        self.id = id
        self.title = title
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.intervalMinutes = intervalMinutes
        self.state = state
        self.diary = diary
        self.photos = photos
    }
}

public struct POI: Codable, Sendable, Hashable, Identifiable {
    public var id: Int64
    public var name: String
    public var kind: String
    public var lat: Double
    public var lon: Double
    public var ele: Double?

    public init(id: Int64, name: String, kind: String, lat: Double, lon: Double, ele: Double? = nil) {
        self.id = id
        self.name = name
        self.kind = kind
        self.lat = lat
        self.lon = lon
        self.ele = ele
    }

    public var coordinate: Coordinate { Coordinate(lat: lat, lon: lon) }
}

public struct BoundingBox: Codable, Sendable, Hashable {
    public var minLat: Double
    public var minLon: Double
    public var maxLat: Double
    public var maxLon: Double

    public init(minLat: Double, minLon: Double, maxLat: Double, maxLon: Double) {
        self.minLat = minLat
        self.minLon = minLon
        self.maxLat = maxLat
        self.maxLon = maxLon
    }

    public func contains(_ c: Coordinate) -> Bool {
        (minLat...maxLat).contains(c.lat) && (minLon...maxLon).contains(c.lon)
    }
}

public enum JSONCoding {
    private static let iso = Date.ISO8601FormatStyle(includingFractionalSeconds: true)

    public static func encoder() -> JSONEncoder {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .custom { date, encoder in
            var c = encoder.singleValueContainer()
            try c.encode(date.formatted(iso))
        }
        return e
    }

    public static func decoder() -> JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .custom { decoder in
            let s = try decoder.singleValueContainer().decode(String.self)
            if let date = parseDate(s) { return date }
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Bad date \(s)"))
        }
        return d
    }

    public static func parseDate(_ s: String) -> Date? {
        (try? iso.parse(s)) ?? (try? Date.ISO8601FormatStyle().parse(s))
    }
}
