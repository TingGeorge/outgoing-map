import Foundation
import SQLite3
import Testing
@testable import OutgoingMapCore

private let t0 = Date(timeIntervalSince1970: 1_700_000_000)

private func tempDir() throws -> URL {
    let url = FileManager.default.temporaryDirectory.appending(path: "CoreTests-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
}

private func makeDB(_ sql: String) throws -> URL {
    let url = try tempDir().appending(path: "test.sqlite")
    var db: OpaquePointer?
    try #require(sqlite3_open(url.path, &db) == SQLITE_OK)
    defer { sqlite3_close(db) }
    try #require(sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK)
    return url
}

private func straightRoute() -> Route {
    Route(points: [
        RoutePoint(lat: 24, lon: 121.00, altitude: 1000, time: t0),
        RoutePoint(lat: 24, lon: 121.01, altitude: 1100, time: t0 + 1800),
        RoutePoint(lat: 24, lon: 121.02, altitude: 1200, time: t0 + 3600),
    ])
}

@Test func trackFileSurvivesTruncatedLastLine() throws {
    let file = TrackFile(url: try tempDir().appending(path: "track.jsonl"))
    for i in 0..<3 {
        try file.append(TrackPoint(time: t0 + Double(i) * 60.5, lat: 24, lon: 121, altitude: 1000, steps: i))
    }
    let handle = try FileHandle(forWritingTo: file.url)
    try handle.seekToEnd()
    try handle.write(contentsOf: Data(#"{"time":"2023-11-14T2"#.utf8))
    try handle.close()

    let read = try file.readAll()
    #expect(read.count == 3)
    #expect(read[1].time == t0 + 60.5)
    #expect(read[2].steps == 2)

    try file.append(TrackPoint(time: t0 + 999, lat: 24.1, lon: 121.1))
    let after = try file.readAll()
    #expect(after.count == 4)
    #expect(after.last?.lat == 24.1)
}

@Test func geoDistances() {
    let taipei101 = Coordinate(lat: 25.0340, lon: 121.5645)
    let mainStation = Coordinate(lat: 25.0478, lon: 121.5170)
    let d = Geo.distance(taipei101, mainStation)
    #expect(abs(d - 5000) / 5000 < 0.03)

    let line = straightRoute().coordinates
    let length = Geo.length(of: line)
    #expect(abs(length - 2034) < 20)

    let mid = Geo.point(at: 0.5, on: line)!
    #expect(abs(mid.lon - 121.01) < 1e-6)

    let near = Geo.nearest(to: Coordinate(lat: 24.001, lon: 121.005), on: line)!
    #expect(abs(near.fraction - 0.25) < 0.001)
    #expect(abs(near.distance - 111) < 2)

    let box = Geo.boundingBox(of: line, padding: 1000)!
    #expect(box.contains(Coordinate(lat: 24.008, lon: 121.025)))
    #expect(!box.contains(Coordinate(lat: 24.01, lon: 121.01)))
}

@Test func ascentHysteresis() {
    #expect(Geo.ascent(of: [100, 103, 101, 104, 102]) == 0)
    #expect(Geo.ascent(of: stride(from: 100.0, through: 200, by: 1).map { $0 }) == 100)
    #expect(Geo.ascent(of: [100, 110, 100, 110]) == 20)
}

@Test func routeBuilderMergesPhotosAndPrefersGPX() {
    let track = [
        TrackPoint(time: t0, lat: 24, lon: 121.00, horizontalAccuracy: 10),
        TrackPoint(time: t0 + 1200, lat: 24.5, lon: 121.5, horizontalAccuracy: 500),
        TrackPoint(time: t0 + 2400, lat: 24, lon: 121.02, horizontalAccuracy: 8),
    ]
    let photos = [
        TripPhoto(takenAt: t0 + 600, lat: 24, lon: 121.01, altitude: 1234),
        TripPhoto(lat: 24.2, lon: 121.2),
        TripPhoto(takenAt: t0 + 900),
    ]

    let merged = RouteBuilder.build(track: track, gpx: [], photos: photos)
    #expect(merged.points.map(\.lon) == [121.00, 121.01, 121.02])
    #expect(merged.points[1].altitude == 1234)
    #expect(merged.start == t0 && merged.end == t0 + 2400)
    #expect(merged.distances.count == 3 && merged.totalDistance > 2000)

    let allBad = track.map { var p = $0; p.horizontalAccuracy = 500; return p }
    #expect(RouteBuilder.build(track: allBad, gpx: [], photos: []).points.count == 3)

    let gpx = (0..<5).map { TrackPoint(time: t0 + Double($0), lat: 23, lon: 120 + Double($0) * 0.001, altitude: 10 * Double($0)) }
    let fine = RouteBuilder.build(track: track, gpx: gpx, photos: photos)
    #expect(fine.points.count == 5)
    #expect(fine.points.allSatisfy { $0.lat == 23 })
    #expect(fine.maxAltitude == 40)
}

@Test func photoPlacementCases() {
    let route = straightRoute()
    let gps = TripPhoto(takenAt: t0 + 100, lat: 24.001, lon: 121.01)
    let timed = TripPhoto(takenAt: t0 + 900)
    let lost = TripPhoto()
    let late = TripPhoto(takenAt: t0 + 3600 + 45 * 60)
    let slightlyLate = TripPhoto(takenAt: t0 + 3600 + 20 * 60)

    let placed = PhotoPlacement.place(photos: [gps, timed, lost, late, slightlyLate], on: route)

    #expect(placed[0].coordinate == Coordinate(lat: 24.001, lon: 121.01))
    #expect(abs(placed[0].fraction - 0.5) < 0.001)

    #expect(abs(placed[1].coordinate!.lon - 121.005) < 1e-6)
    #expect(abs(placed[1].fraction - 0.25) < 0.001)
    #expect(abs(placed[1].altitude! - 1050) < 1e-6)

    #expect(placed[2].coordinate == nil)
    #expect(placed[3].coordinate == nil)
    #expect(placed[4].fraction == 1)
}

@Test func gpxParse() {
    let xml = """
    <?xml version="1.0" encoding="UTF-8"?>
    <gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
      <wpt lat="24.1" lon="121.1"><name>ignored</name></wpt>
      <trk><name>雪山</name><trkseg>
        <trkpt lat="24.3833" lon="121.2311"><ele>2140.5</ele><time>2024-10-01T22:00:00Z</time></trkpt>
        <trkpt lat="24.3840" lon="121.2320"><ele>2150</ele><time>2024-10-01T22:01:00.500Z</time></trkpt>
        <trkpt lat="24.3850" lon="121.2330"></trkpt>
      </trkseg></trk>
    </gpx>
    """
    let points = GPXParser.parse(data: Data(xml.utf8))
    #expect(points.count == 3)
    #expect(points[0].altitude == 2140.5)
    #expect(points[1].time == Date(timeIntervalSince1970: 1_727_820_060.5))
    #expect(!points[2].hasTime)

    let routeOnly = #"<gpx><rte><rtept lat="24" lon="121"/><rtept lat="24.1" lon="121.1"/></rte></gpx>"#
    #expect(GPXParser.parse(data: Data(routeOnly.utf8)).count == 2)
    #expect(GPXParser.parse(data: Data("not xml <<".utf8)).isEmpty)
    #expect(GPXParser.parse(data: Data()).isEmpty)
}

@Test func mbtilesRoundTrip() throws {
    let url = try makeDB("""
    CREATE TABLE metadata (name TEXT, value TEXT);
    CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB);
    INSERT INTO metadata VALUES ('format', 'jpg'), ('minzoom', '1'), ('maxzoom', '2'), ('bounds', '120.0,21.8,122.1,25.4');
    INSERT INTO tiles VALUES (1, 0, 1, X'89504E47');
    INSERT INTO tiles VALUES (2, 3, 0, X'0102');
    """)
    let mbtiles = try MBTiles(url: url)
    #expect(mbtiles.format == "jpg")
    #expect(mbtiles.minZoom == 1 && mbtiles.maxZoom == 2)
    #expect(mbtiles.bounds == BoundingBox(minLat: 21.8, minLon: 120.0, maxLat: 25.4, maxLon: 122.1))
    #expect(mbtiles.tile(z: 1, x: 0, y: 0) == Data([0x89, 0x50, 0x4E, 0x47]))
    #expect(mbtiles.tile(z: 1, x: 0, y: 1) == nil)

    let results = UnsafeMutableBufferPointer<Bool>.allocate(capacity: 200)
    results.initialize(repeating: false)
    defer { results.deallocate() }
    nonisolated(unsafe) let out = results
    DispatchQueue.concurrentPerform(iterations: results.count) { i in
        out[i] = mbtiles.tile(z: 2, x: 3, y: 3) == Data([1, 2])
    }
    #expect(results.allSatisfy { $0 })

    #expect(mbtiles.ancestor(z: 2, x: 3, y: 3)?.levels == 0)
    #expect(mbtiles.ancestor(z: 2, x: 1, y: 1)?.levels == 1)
    #expect(mbtiles.ancestor(z: 3, x: 1, y: 2)?.levels == 2)
    #expect(mbtiles.ancestor(z: 3, x: 1, y: 2)?.data == Data([0x89, 0x50, 0x4E, 0x47]))
    #expect(mbtiles.ancestor(z: 5, x: 31, y: 31)?.data == Data([1, 2]))
    #expect(mbtiles.ancestor(z: 2, x: 0, y: 3) == nil)

    #expect(throws: SQLiteError.self) { try MBTiles(url: url.deletingLastPathComponent().appending(path: "missing.mbtiles")) }
}

@Test func elevationFromSynthetic1201Tile() throws {
    let dir = try tempDir()
    var data = Data(capacity: 1201 * 1201 * 2)
    for row in 0..<1201 {
        let value = row == 0 ? ElevationSource.void : Int16(row)
        let bytes = withUnsafeBytes(of: value.bigEndian) { Data($0) }
        for _ in 0..<1201 { data.append(bytes) }
    }
    try data.write(to: dir.appending(path: ElevationSource.fileName(lat: 24, lon: 121)))
    #expect(ElevationSource.fileName(lat: 24, lon: 121) == "N24E121.hgt")

    let source = ElevationSource(directory: dir)
    #expect(source.elevation(lat: 24.5, lon: 121.5) == 600)
    #expect(abs(source.elevation(lat: 25 - 600.5 / 1200, lon: 121.3)! - 600.5) < 1e-6)
    #expect(source.elevation(lat: 25 - 0.25 / 1200, lon: 121.5) == 1)
    #expect(source.elevation(lat: 23.5, lon: 121.5) == nil)

    let grid = source.grid(bbox: BoundingBox(minLat: 24.25, minLon: 121.2, maxLat: 24.75, maxLon: 121.8), columns: 2, rows: 2)
    #expect(grid == [300, 300, 900, 900])
}

@Test func poisNearRoute() throws {
    let url = try makeDB("""
    CREATE TABLE poi (id INTEGER PRIMARY KEY, name TEXT, kind TEXT, lat REAL, lon REAL, ele REAL);
    INSERT INTO poi VALUES (1, '觀景台', 'viewpoint', 24.0004, 121.015, 1180);
    INSERT INTO poi VALUES (2, '山屋', 'hut', 24.0003, 121.005, NULL);
    INSERT INTO poi VALUES (3, '山屋', 'shelter', 24.0005, 121.0055, NULL);
    INSERT INTO poi VALUES (4, '遠峰', 'peak', 24.0025, 121.01, 1500);
    INSERT INTO poi VALUES (5, '登山口', 'trailhead', 23.9999, 121.0001, 990);
    INSERT INTO poi VALUES (6, '他山', 'peak', 25.5, 122.0, 3000);
    """)
    let db = try POIDatabase(url: url)
    #expect(db.pois(in: BoundingBox(minLat: 23, minLon: 120, maxLat: 25, maxLon: 122)).count == 5)

    let near = db.pois(near: straightRoute(), within: 200)
    #expect(near.map(\.poi.name) == ["登山口", "山屋", "觀景台"])
    #expect(near.map(\.poi.id) == [5, 2, 1])
    #expect(abs(near[2].fraction - 0.75) < 0.001)
}

@Test func timelineOrder() {
    let route = straightRoute()
    let photoID = UUID()
    let placed = [
        PlacedPhoto(id: photoID, coordinate: Coordinate(lat: 24, lon: 121.01), fraction: 0.5, altitude: nil, time: t0 + 1800),
        PlacedPhoto(id: UUID(), coordinate: nil, fraction: 0, altitude: nil, time: nil),
    ]
    let a = POI(id: 1, name: "A", kind: "peak", lat: 24, lon: 121.004)
    let b = POI(id: 2, name: "B", kind: "hut", lat: 24, lon: 121.018, ele: 1500)

    let items = Timeline.build(route: route, placed: placed, pois: [(b, 0.9), (a, 0.2)])
    #expect(items.map(\.id) == ["poi-1", "photo-\(photoID.uuidString)", "poi-2"])
    #expect(abs(items[0].time!.timeIntervalSince(t0) - 720) < 1)
    #expect(abs(items[0].altitude! - 1040) < 1e-6)
    #expect(items[2].altitude == 1500)
}
