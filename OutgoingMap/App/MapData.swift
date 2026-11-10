import Foundation
import Observation

@Observable @MainActor final class MapData {
    private(set) var tiles: MBTiles?
    private(set) var pois: POIDatabase?
    private(set) var elevation: ElevationSource?

    var isInstalled: Bool { tiles != nil }

    static var documentsDirectory: URL { URL.documentsDirectory.appending(path: "MapData") }

    init() {
        reload()
    }

    func reload() {
        tiles = Self.locate("taiwan.mbtiles").flatMap { try? MBTiles(url: $0) }
        pois = Self.locate("poi.sqlite").flatMap { try? POIDatabase(url: $0) }
        elevation = Self.locate("dem").map { ElevationSource(directory: $0) }
    }

    private static func locate(_ name: String) -> URL? {
        let candidates = [
            documentsDirectory.appending(path: name),
            Bundle.main.resourceURL?.appending(path: "MapData").appending(path: name),
        ]
        return candidates.compactMap { $0 }.first { FileManager.default.fileExists(atPath: $0.path) }
    }
}
