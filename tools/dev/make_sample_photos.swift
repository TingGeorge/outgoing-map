import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let out = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "build/sample_photos")
try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)

let shots: [(time: String, lat: Double, lon: Double, alt: Double, gps: Bool, top: [CGFloat], bottom: [CGFloat])] = [
    ("07:20:10", 24.1712, 121.2846, 3180, true,  [0.50, 0.65, 0.80], [0.96, 0.76, 0.48]),
    ("08:05:42", 24.1741, 121.2839, 3255, true,  [0.83, 0.90, 0.85], [0.35, 0.55, 0.38]),
    ("08:50:03", 24.1773, 121.2829, 3330, true,  [0.36, 0.55, 0.76], [0.83, 0.90, 0.95]),
    ("09:12:30", 24.1798, 121.2821, 3395, true,  [0.13, 0.25, 0.45], [0.95, 0.64, 0.36]),
    ("09:26:00", 24.1814, 121.2816, 3422, true,  [0.30, 0.50, 0.75], [0.95, 0.95, 0.98]),
    ("10:15:20", 0, 0, 0, false,                 [0.71, 0.76, 0.77], [0.91, 0.93, 0.92]),
    ("11:10:45", 24.1722, 121.2843, 3205, true,  [0.93, 0.69, 0.40], [0.98, 0.88, 0.71]),
]

let w = 1600, h = 1200
let space = CGColorSpaceCreateDeviceRGB()

for (i, s) in shots.enumerated() {
    let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: space,
                        bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
    let grad = CGGradient(colorSpace: space, colorComponents: s.bottom + [1] + s.top + [1], locations: [0, 1], count: 2)!
    ctx.drawLinearGradient(grad, start: .zero, end: CGPoint(x: 0, y: h), options: [])

    for layer in 0..<3 {
        let base = CGFloat(h) * (0.42 - CGFloat(layer) * 0.12)
        let shade = 0.38 - CGFloat(layer) * 0.10
        ctx.setFillColor(red: shade, green: shade + 0.10, blue: shade + 0.04, alpha: 1)
        ctx.move(to: CGPoint(x: 0, y: 0))
        for x in stride(from: 0, through: w, by: 20) {
            let t = Double(x) / Double(w) * 6.28
            let y = base + CGFloat(sin(t * (1.3 + Double(layer)) + Double(i)) * 70 + sin(t * 3.1 + Double(i * 2 + layer)) * 30)
            ctx.addLine(to: CGPoint(x: CGFloat(x), y: y))
        }
        ctx.addLine(to: CGPoint(x: w, y: 0))
        ctx.closePath()
        ctx.fillPath()
    }

    var props: [CFString: Any] = [
        kCGImagePropertyExifDictionary: [
            kCGImagePropertyExifDateTimeOriginal: "2026:11:07 \(s.time)",
            kCGImagePropertyExifOffsetTimeOriginal: "+08:00",
        ],
        kCGImageDestinationLossyCompressionQuality: 0.85,
    ]
    if s.gps {
        props[kCGImagePropertyGPSDictionary] = [
            kCGImagePropertyGPSLatitude: s.lat, kCGImagePropertyGPSLatitudeRef: "N",
            kCGImagePropertyGPSLongitude: s.lon, kCGImagePropertyGPSLongitudeRef: "E",
            kCGImagePropertyGPSAltitude: s.alt, kCGImagePropertyGPSAltitudeRef: 0,
        ]
    }

    let url = out.appendingPathComponent(String(format: "hehuan_%02d.jpg", i + 1))
    let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.jpeg.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, ctx.makeImage()!, props as CFDictionary)
    precondition(CGImageDestinationFinalize(dest), "write failed: \(url.path)")

    let back = CGImageSourceCopyPropertiesAtIndex(CGImageSourceCreateWithURL(url as CFURL, nil)!, 0, nil) as! [CFString: Any]
    precondition((back[kCGImagePropertyGPSDictionary] != nil) == s.gps, "GPS metadata mismatch: \(url.lastPathComponent)")
    print(url.path)
}
