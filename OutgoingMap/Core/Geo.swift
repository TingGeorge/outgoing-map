import Foundation

public enum Geo {
    public static let earthRadius = 6_371_008.8
    public static let metresPerDegreeLat = 111_320.0

    public static func distance(_ a: Coordinate, _ b: Coordinate) -> Double {
        let dLat = (b.lat - a.lat) * .pi / 180
        let dLon = (b.lon - a.lon) * .pi / 180
        let h = sin(dLat / 2) * sin(dLat / 2)
            + cos(a.lat * .pi / 180) * cos(b.lat * .pi / 180) * sin(dLon / 2) * sin(dLon / 2)
        return 2 * earthRadius * asin(min(1, sqrt(h)))
    }

    public static func cumulativeDistances(_ line: [Coordinate]) -> [Double] {
        var result: [Double] = []
        result.reserveCapacity(line.count)
        var total = 0.0
        for i in line.indices {
            if i > 0 { total += distance(line[i - 1], line[i]) }
            result.append(total)
        }
        return result
    }

    public static func length(of line: [Coordinate]) -> Double {
        cumulativeDistances(line).last ?? 0
    }

    public static func point(at fraction: Double, on line: [Coordinate]) -> Coordinate? {
        guard let first = line.first else { return nil }
        let cumulative = cumulativeDistances(line)
        let total = cumulative.last ?? 0
        guard total > 0 else { return first }

        let target = min(max(fraction, 0), 1) * total
        let i = max(1, cumulative.firstIndex { $0 >= target } ?? line.count - 1)
        let segment = cumulative[i] - cumulative[i - 1]
        let t = segment > 0 ? (target - cumulative[i - 1]) / segment : 0
        return interpolate(line[i - 1], line[i], t)
    }

    public static func nearest(to p: Coordinate, on line: [Coordinate]) -> (fraction: Double, distance: Double)? {
        guard let first = line.first else { return nil }
        guard line.count > 1 else { return (0, distance(p, first)) }

        let cumulative = cumulativeDistances(line)
        let total = cumulative.last ?? 0
        var best = (fraction: 0.0, distance: Double.infinity)

        for i in 1..<line.count {
            let a = line[i - 1], b = line[i]
            let k = cos(a.lat * .pi / 180)
            let bx = (b.lon - a.lon) * k, by = b.lat - a.lat
            let px = (p.lon - a.lon) * k, py = p.lat - a.lat
            let len2 = bx * bx + by * by
            let t = len2 > 0 ? min(max((px * bx + py * by) / len2, 0), 1) : 0
            let d = distance(p, interpolate(a, b, t))
            if d < best.distance {
                let along = cumulative[i - 1] + t * (cumulative[i] - cumulative[i - 1])
                best = (total > 0 ? along / total : 0, d)
            }
        }
        return best
    }

    public static func ascent(of altitudes: [Double], threshold: Double = 5) -> Double {
        guard var reference = altitudes.first else { return 0 }
        var gain = 0.0
        for altitude in altitudes.dropFirst() {
            if altitude - reference >= threshold {
                gain += altitude - reference
                reference = altitude
            } else if reference - altitude >= threshold {
                reference = altitude
            }
        }
        return gain
    }

    public static func boundingBox(of line: [Coordinate], padding metres: Double = 0) -> BoundingBox? {
        guard let first = line.first else { return nil }
        var box = BoundingBox(minLat: first.lat, minLon: first.lon, maxLat: first.lat, maxLon: first.lon)
        for c in line {
            box.minLat = min(box.minLat, c.lat)
            box.maxLat = max(box.maxLat, c.lat)
            box.minLon = min(box.minLon, c.lon)
            box.maxLon = max(box.maxLon, c.lon)
        }
        let dLat = metres / metresPerDegreeLat
        let midLat = (box.minLat + box.maxLat) / 2 * .pi / 180
        let dLon = metres / (metresPerDegreeLat * max(cos(midLat), 0.01))
        box.minLat -= dLat
        box.maxLat += dLat
        box.minLon -= dLon
        box.maxLon += dLon
        return box
    }

    static func interpolate(_ a: Coordinate, _ b: Coordinate, _ t: Double) -> Coordinate {
        Coordinate(lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t)
    }
}
