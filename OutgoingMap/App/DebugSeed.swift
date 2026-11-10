#if DEBUG
import UIKit

enum DebugSeed {
    static let ascent: [(lat: Double, lon: Double, alt: Double)] = [
        (24.16740, 121.28879, 2995), (24.16897, 121.28804, 3040), (24.17171, 121.28793, 3110),
        (24.17367, 121.28750, 3170), (24.17543, 121.28654, 3230), (24.17719, 121.28600, 3290),
        (24.17915, 121.28514, 3340), (24.18071, 121.28342, 3390), (24.18160, 121.28257, 3415),
        (24.18130, 121.28170, 3422),
    ]

    static let photos: [(clock: String, fraction: Double?, caption: String, top: UIColor, bottom: UIColor)] = [
        ("07:20", 0.24, "箭竹草坡的晨光", #colorLiteral(red: 0.5, green: 0.65, blue: 0.8, alpha: 1), #colorLiteral(red: 0.96, green: 0.76, blue: 0.48, alpha: 1)),
        ("08:05", 0.52, "玉山杜鵑灌叢，剛過雨", #colorLiteral(red: 0.83, green: 0.9, blue: 0.85, alpha: 1), #colorLiteral(red: 0.35, green: 0.55, blue: 0.38, alpha: 1)),
        ("08:50", 0.79, "回頭看到奇萊稜線", #colorLiteral(red: 0.36, green: 0.55, blue: 0.76, alpha: 1), #colorLiteral(red: 0.83, green: 0.9, blue: 0.95, alpha: 1)),
        ("09:12", 0.92, "雲海滿到谷底", #colorLiteral(red: 0.13, green: 0.25, blue: 0.45, alpha: 1), #colorLiteral(red: 0.95, green: 0.64, blue: 0.36, alpha: 1)),
        ("09:26", 1.0, "北峰三角點", #colorLiteral(red: 0.3, green: 0.5, blue: 0.75, alpha: 1), #colorLiteral(red: 0.95, green: 0.95, blue: 0.98, alpha: 1)),
        ("10:15", nil, "下山起霧，能見度剩幾十公尺", #colorLiteral(red: 0.71, green: 0.76, blue: 0.77, alpha: 1), #colorLiteral(red: 0.91, green: 0.93, blue: 0.92, alpha: 1)),
        ("11:10", 0.2, "午後的草坡變成金黃色", #colorLiteral(red: 0.93, green: 0.69, blue: 0.4, alpha: 1), #colorLiteral(red: 0.98, green: 0.88, blue: 0.71, alpha: 1)),
    ]

    @MainActor static func runIfRequested(_ store: TripStore) {
        guard UserDefaults.standard.bool(forKey: "seedSampleTrip"), store.trips.isEmpty else { return }

        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Taipei")!
        func at(_ clock: String) -> Date {
            let parts = clock.split(separator: ":").map { Int($0)! }
            return calendar.date(from: DateComponents(year: 2026, month: 11, day: 7, hour: parts[0], minute: parts[1]))!
        }
        func position(_ f: Double) -> (lat: Double, lon: Double, alt: Double) {
            let x = min(max(f, 0), 1) * Double(ascent.count - 1)
            let i = min(Int(x), ascent.count - 2), t = x - Double(i)
            let a = ascent[i], b = ascent[i + 1]
            return (a.lat + (b.lat - a.lat) * t, a.lon + (b.lon - a.lon) * t, a.alt + (b.alt - a.alt) * t)
        }

        let start = at("06:40"), summit = at("09:25"), leave = at("09:40"), end = at("11:40")
        var trip = Trip(title: "合歡山北峰", startedAt: start, endedAt: end, intervalMinutes: 10, state: .finished)
        trip.diary = "天還沒亮就從北峰登山口出發，箭竹草坡被晨光染成金色，風一點都不客氣。爬上北峰的時候剛好雲海漲滿整片谷地，我在三角點旁邊坐了快二十分鐘不想走。下山起霧了，還好手機一路都在記軌跡。"

        do {
            try store.save(trip)

            var time = start, steps = 0
            while time <= end {
                let f: Double = time <= summit
                    ? time.timeIntervalSince(start) / summit.timeIntervalSince(start)
                    : time <= leave ? 1 : 1 - time.timeIntervalSince(leave) / end.timeIntervalSince(leave)
                let p = position(f)
                let wobble = sin(time.timeIntervalSince(start) / 700) * 0.00018
                try store.appendPoint(TrackPoint(
                    time: time, lat: p.lat, lon: p.lon + wobble, altitude: p.alt + 4,
                    horizontalAccuracy: 8, verticalAccuracy: 6, course: time <= summit ? 345 : 165, speed: 0.6,
                    pressureKPa: 70.1 - (p.alt - 2995) * 0.009, relativeAltitude: p.alt - 2995, steps: steps, battery: 0.92 - f * 0.1
                ), to: trip)
                time += 600
                steps += 780
            }

            for (i, spec) in photos.enumerated() {
                let p = spec.fraction.map(position)
                let photo = TripPhoto(takenAt: at(spec.clock), lat: p?.lat, lon: p?.lon, altitude: p?.alt, caption: spec.caption)
                let image = scene(top: spec.top, bottom: spec.bottom, seed: Double(i))
                try image.jpegData(compressionQuality: 0.85)!.write(to: store.photoURL(photo, in: trip))
                try image.preparingThumbnail(of: CGSize(width: 400, height: 300))!.jpegData(compressionQuality: 0.8)!
                    .write(to: store.thumbURL(photo, in: trip))
                trip.photos.append(photo)
            }
            try store.save(trip)
        } catch {
            assertionFailure("seed failed: \(error)")
        }
    }

    static func scene(top: UIColor, bottom: UIColor, seed: Double) -> UIImage {
        let size = CGSize(width: 1600, height: 1200)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { context in
            let cg = context.cgContext
            let gradient = CGGradient(colorsSpace: nil, colors: [top.cgColor, bottom.cgColor] as CFArray, locations: [0, 1])!
            cg.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: 0, y: size.height), options: [])

            for layer in 0..<3 {
                let base = size.height * (0.58 + CGFloat(layer) * 0.12)
                let shade = 0.38 - CGFloat(layer) * 0.1
                cg.setFillColor(UIColor(red: shade, green: shade + 0.1, blue: shade + 0.04, alpha: 1).cgColor)
                cg.move(to: CGPoint(x: 0, y: size.height))
                for x in stride(from: 0, through: size.width, by: 20) {
                    let t = Double(x / size.width) * 6.28
                    let y = base - CGFloat(sin(t * (1.3 + Double(layer)) + seed) * 70 + sin(t * 3.1 + seed * 2 + Double(layer)) * 30)
                    cg.addLine(to: CGPoint(x: x, y: y))
                }
                cg.addLine(to: CGPoint(x: size.width, y: size.height))
                cg.closePath()
                cg.fillPath()
            }
        }
    }
}
#endif
