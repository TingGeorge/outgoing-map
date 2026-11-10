import Foundation
import SQLite3

public final class MBTiles: Sendable {
    public let url: URL
    public let minZoom: Int
    public let maxZoom: Int
    public let format: String
    public let bounds: BoundingBox?
    private let reader: SQLiteReader

    public init(url: URL) throws {
        self.url = url
        reader = try SQLiteReader(url: url)

        let pairs = reader.query("SELECT name, value FROM metadata") { stmt in
            SQLiteReader.text(stmt, 0).map { ($0, SQLiteReader.text(stmt, 1) ?? "") }
        }
        let metadata = Dictionary(pairs, uniquingKeysWith: { a, _ in a })
        let range = reader.query("SELECT MIN(zoom_level), MAX(zoom_level) FROM tiles") { stmt in
            (Int(sqlite3_column_int(stmt, 0)), Int(sqlite3_column_int(stmt, 1)))
        }.first ?? (0, 0)

        minZoom = metadata["minzoom"].flatMap { Int($0) } ?? range.0
        maxZoom = metadata["maxzoom"].flatMap { Int($0) } ?? range.1
        format = metadata["format"] ?? "png"

        let b = (metadata["bounds"] ?? "").split(separator: ",").compactMap {
            Double($0.trimmingCharacters(in: .whitespaces))
        }
        bounds = b.count == 4 ? BoundingBox(minLat: b[1], minLon: b[0], maxLat: b[3], maxLon: b[2]) : nil
    }

    public func tile(z: Int, x: Int, y: Int) -> Data? {
        guard z >= 0, z < 31 else { return nil }
        let row = (1 << z) - 1 - y
        return reader.query(
            "SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?",
            [Double(z), Double(x), Double(row)]
        ) { SQLiteReader.blob($0, 0) }.first
    }

    public func ancestor(z: Int, x: Int, y: Int) -> (data: Data, levels: Int)? {
        var dz = max(0, z - maxZoom)
        while z - dz >= minZoom {
            if let data = tile(z: z - dz, x: x >> dz, y: y >> dz) { return (data, dz) }
            dz += 1
        }
        return nil
    }
}
