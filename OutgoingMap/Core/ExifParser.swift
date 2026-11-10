import Foundation

public struct PhotoMetadata: Sendable, Equatable {
    public var takenAt: Date?
    public var lat: Double?
    public var lon: Double?
    public var altitude: Double?

    public init(takenAt: Date? = nil, lat: Double? = nil, lon: Double? = nil, altitude: Double? = nil) {
        self.takenAt = takenAt
        self.lat = lat
        self.lon = lon
        self.altitude = altitude
    }
}

public enum ExifParser {
    public static let defaultZone = TimeZone(identifier: "Asia/Taipei")!

    public static func parse(_ properties: [String: Any]) -> PhotoMetadata {
        let gps = properties["{GPS}"] as? [String: Any] ?? [:]
        let exif = properties["{Exif}"] as? [String: Any] ?? [:]
        let tiff = properties["{TIFF}"] as? [String: Any] ?? [:]

        var result = PhotoMetadata()

        if var lat = number(gps["Latitude"]), var lon = number(gps["Longitude"]),
           (-90...90).contains(lat), (-180...180).contains(lon), !(lat == 0 && lon == 0) {
            if (gps["LatitudeRef"] as? String)?.uppercased() == "S" { lat = -abs(lat) }
            if (gps["LongitudeRef"] as? String)?.uppercased() == "W" { lon = -abs(lon) }
            result.lat = lat
            result.lon = lon
            if let altitude = number(gps["Altitude"]) {
                result.altitude = number(gps["AltitudeRef"]) == 1 ? -abs(altitude) : altitude
            }
        }

        let local = (exif["DateTimeOriginal"] as? String) ?? (tiff["DateTime"] as? String)
        if let local {
            if let offset = exif["OffsetTimeOriginal"] as? String, let zone = zone(offset: offset) {
                result.takenAt = date(local, zone: zone)
            } else if let day = gps["DateStamp"] as? String, let clock = gps["TimeStamp"] as? String,
                      let utc = date(day + " " + String(clock.split(separator: ".")[0]), zone: .gmt) {
                result.takenAt = utc
            } else {
                result.takenAt = date(local, zone: defaultZone)
            }
        }
        return result
    }

    private static func number(_ value: Any?) -> Double? {
        (value as? NSNumber)?.doubleValue
    }

    private static func zone(offset: String) -> TimeZone? {
        guard offset.hasPrefix("+") || offset.hasPrefix("-") else { return nil }
        let parts = offset.dropFirst().split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2 else { return nil }
        let sign = offset.hasPrefix("-") ? -1 : 1
        return TimeZone(secondsFromGMT: sign * (parts[0] * 3600 + parts[1] * 60))
    }

    private static func date(_ text: String, zone: TimeZone) -> Date? {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = zone
        formatter.dateFormat = "yyyy:MM:dd HH:mm:ss"
        return formatter.date(from: text)
    }
}
