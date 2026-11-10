import Foundation

public final class ElevationSource: @unchecked Sendable {
    public static let void: Int16 = -32768

    public let directory: URL
    private let lock = NSLock()
    private var cache: [String: Tile?] = [:]

    private struct Tile {
        let data: Data
        let size: Int

        func sample(row: Int, col: Int) -> Int16 {
            let offset = (row * size + col) * 2
            let raw = data.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: offset, as: UInt16.self) }
            return Int16(bitPattern: UInt16(bigEndian: raw))
        }
    }

    public init(directory: URL) {
        self.directory = directory
    }

    public func elevation(lat: Double, lon: Double) -> Double? {
        let baseLat = floor(lat), baseLon = floor(lon)
        guard let tile = tile(lat: Int(baseLat), lon: Int(baseLon)) else { return nil }

        let n = Double(tile.size - 1)
        let row = (baseLat + 1 - lat) * n
        let col = (lon - baseLon) * n
        let r0 = min(Int(row), tile.size - 1), c0 = min(Int(col), tile.size - 1)
        let r1 = min(r0 + 1, tile.size - 1), c1 = min(c0 + 1, tile.size - 1)
        let fr = row - Double(r0), fc = col - Double(c0)

        var sum = 0.0, weight = 0.0
        for (r, c, w) in [(r0, c0, (1 - fr) * (1 - fc)), (r0, c1, (1 - fr) * fc),
                          (r1, c0, fr * (1 - fc)), (r1, c1, fr * fc)] {
            let v = tile.sample(row: r, col: c)
            guard v != Self.void else { continue }
            sum += Double(v) * w
            weight += w
        }
        if weight > 1e-9 { return sum / weight }
        let v = tile.sample(row: Int(row.rounded()), col: Int(col.rounded()))
        return v == Self.void ? nil : Double(v)
    }

    public func grid(bbox: BoundingBox, columns: Int, rows: Int) -> [Float] {
        var result: [Float] = []
        result.reserveCapacity(columns * rows)
        for r in 0..<rows {
            let lat = rows > 1 ? bbox.maxLat - (bbox.maxLat - bbox.minLat) * Double(r) / Double(rows - 1) : bbox.maxLat
            for c in 0..<columns {
                let lon = columns > 1 ? bbox.minLon + (bbox.maxLon - bbox.minLon) * Double(c) / Double(columns - 1) : bbox.minLon
                result.append(Float(elevation(lat: lat, lon: lon) ?? 0))
            }
        }
        return result
    }

    public static func fileName(lat: Int, lon: Int) -> String {
        String(format: "%@%02d%@%03d.hgt", lat >= 0 ? "N" : "S", abs(lat), lon >= 0 ? "E" : "W", abs(lon))
    }

    private func tile(lat: Int, lon: Int) -> Tile? {
        let name = Self.fileName(lat: lat, lon: lon)
        lock.lock()
        defer { lock.unlock() }
        if let cached = cache[name] { return cached }

        var tile: Tile?
        if let data = try? Data(contentsOf: directory.appending(path: name), options: .alwaysMapped) {
            switch data.count {
            case 3601 * 3601 * 2: tile = Tile(data: data, size: 3601)
            case 1201 * 1201 * 2: tile = Tile(data: data, size: 1201)
            default: tile = nil
            }
        }
        cache[name] = tile
        return tile
    }
}
