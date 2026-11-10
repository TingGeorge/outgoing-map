import Foundation
import Testing
@testable import OutgoingMapCore

@Test func catmullRomPassesThroughPointsWithSaneLength() {
    let zigzag: [SIMD2<Double>] = [[0, 0], [100, 300], [0, 600], [120, 650], [120, 650], [400, 700], [380, 1000]]
    let smooth = PathSmoothing.catmullRom(zigzag, spacing: 8)

    #expect(smooth.anchors.count == zigzag.count)
    for (i, anchor) in smooth.anchors.enumerated() {
        #expect(PathSmoothing.length(smooth.points[anchor] - zigzag[i]) < 1e-9)
    }
    #expect(smooth.points.allSatisfy { $0.x.isFinite && $0.y.isFinite })

    func length(_ line: [SIMD2<Double>]) -> Double {
        zip(line, line.dropFirst()).reduce(0) { $0 + PathSmoothing.length($1.1 - $1.0) }
    }
    let ratio = length(smooth.points) / length(zigzag)
    #expect(ratio >= 1 && ratio < 1.3)
}

@Test func webMercatorTileCoordinates() {
    #expect(WebMercator.tileX(lon: 0, zoom: 1) == 1)
    #expect(abs(WebMercator.tileY(lat: 0, zoom: 4) - 8) < 1e-9)
    #expect(abs(WebMercator.tileY(lat: 85.0511287798, zoom: 3)) < 1e-6)
    #expect(Int(WebMercator.tileX(lon: 121.2817, zoom: 16)) == 54846)
    #expect(Int(WebMercator.tileY(lat: 24.1813, zoom: 16)) == (1 << 16) - 1 - 37306)
}
