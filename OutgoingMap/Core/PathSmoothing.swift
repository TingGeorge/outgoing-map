import Foundation

public enum PathSmoothing {
    public static func catmullRom(_ points: [SIMD2<Double>], spacing: Double) -> (points: [SIMD2<Double>], anchors: [Int]) {
        guard points.count > 1, let last = points.last else { return (points, Array(points.indices)) }

        var output: [SIMD2<Double>] = []
        var anchors: [Int] = []
        for i in 0..<points.count - 1 {
            let p1 = points[i], p2 = points[i + 1]
            let p0 = i > 0 ? points[i - 1] : 2 * p1 - p2
            let p3 = i + 2 < points.count ? points[i + 2] : 2 * p2 - p1

            anchors.append(output.count)
            let steps = max(1, Int((length(p2 - p1) / spacing).rounded(.up)))
            for k in 0..<steps {
                output.append(point(p0, p1, p2, p3, Double(k) / Double(steps)))
            }
        }
        anchors.append(output.count)
        output.append(last)
        return (output, anchors)
    }

    static func point(_ p0: SIMD2<Double>, _ p1: SIMD2<Double>, _ p2: SIMD2<Double>, _ p3: SIMD2<Double>, _ u: Double) -> SIMD2<Double> {
        let d12 = length(p2 - p1).squareRoot()
        guard d12 > 0 else { return p1 }
        let d01 = max(length(p1 - p0).squareRoot(), 1e-6 * d12)
        let d23 = max(length(p3 - p2).squareRoot(), 1e-6 * d12)

        let t0 = 0.0, t1 = d01, t2 = t1 + d12, t3 = t2 + d23
        let t = t1 + u * d12
        let a1 = (t1 - t) / (t1 - t0) * p0 + (t - t0) / (t1 - t0) * p1
        let a2 = (t2 - t) / (t2 - t1) * p1 + (t - t1) / (t2 - t1) * p2
        let a3 = (t3 - t) / (t3 - t2) * p2 + (t - t2) / (t3 - t2) * p3
        let b1 = (t2 - t) / (t2 - t0) * a1 + (t - t0) / (t2 - t0) * a2
        let b2 = (t3 - t) / (t3 - t1) * a2 + (t - t1) / (t3 - t1) * a3
        return (t2 - t) / (t2 - t1) * b1 + (t - t1) / (t2 - t1) * b2
    }

    static func length(_ v: SIMD2<Double>) -> Double {
        (v * v).sum().squareRoot()
    }
}

public enum WebMercator {
    public static func tileX(lon: Double, zoom: Int) -> Double {
        (lon + 180) / 360 * Double(1 << zoom)
    }

    public static func tileY(lat: Double, zoom: Int) -> Double {
        let r = lat * .pi / 180
        return (1 - log(tan(r) + 1 / cos(r)) / .pi) / 2 * Double(1 << zoom)
    }
}
