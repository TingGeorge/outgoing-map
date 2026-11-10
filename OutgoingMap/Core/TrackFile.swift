import Foundation

public struct TrackFile: Sendable {
    public let url: URL

    public init(url: URL) {
        self.url = url
    }

    public func append(_ point: TrackPoint) throws {
        var line = try JSONCoding.encoder().encode(point)
        line.append(0x0A)

        if !FileManager.default.fileExists(atPath: url.path) {
            FileManager.default.createFile(atPath: url.path, contents: nil)
        }
        let handle = try FileHandle(forUpdating: url)
        defer { try? handle.close() }

        let end = try handle.seekToEnd()
        if end > 0 {
            try handle.seek(toOffset: end - 1)
            if try handle.read(upToCount: 1) != Data([0x0A]) {
                line.insert(0x0A, at: 0)
            }
        }
        try handle.write(contentsOf: line)
        try handle.synchronize()
    }

    public func write(_ points: [TrackPoint]) throws {
        let encoder = JSONCoding.encoder()
        var data = Data()
        for point in points {
            data.append(try encoder.encode(point))
            data.append(0x0A)
        }
        try data.write(to: url, options: .atomic)
    }

    public func readAll() throws -> [TrackPoint] {
        guard FileManager.default.fileExists(atPath: url.path) else { return [] }
        let data = try Data(contentsOf: url)
        let decoder = JSONCoding.decoder()
        return data.split(separator: 0x0A).compactMap { try? decoder.decode(TrackPoint.self, from: Data($0)) }
    }
}
