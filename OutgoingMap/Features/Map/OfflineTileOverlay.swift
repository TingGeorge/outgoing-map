import MapKit
import ImageIO
import UniformTypeIdentifiers

final class OfflineTileOverlay: MKTileOverlay {
    static let overzoomLevels = 1

    let tiles: MBTiles?

    init(tiles: MBTiles?) {
        self.tiles = tiles
        super.init(urlTemplate: nil)
        canReplaceMapContent = true
        tileSize = CGSize(width: 256, height: 256)
    }

    override func loadTile(at path: MKTileOverlayPath, result: @escaping (Data?, Error?) -> Void) {
        let tiles = tiles
        DispatchQueue.global(qos: .userInitiated).async {
            result(Self.tileData(tiles, z: path.z, x: path.x, y: path.y), nil)
        }
    }

    static func tileData(_ tiles: MBTiles?, z: Int, x: Int, y: Int) -> Data {
        guard let tiles else { return blank }
        guard let hit = tiles.ancestor(z: z, x: x, y: y) else { return sea }
        if hit.levels == 0 { return hit.data }

        let n = 1 << hit.levels
        guard let source = CGImageSourceCreateWithData(hit.data as CFData, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
        else { return sea }

        let side = CGFloat(image.width) / CGFloat(n)
        let crop = CGRect(x: (CGFloat(x % n) * side).rounded(.down), y: (CGFloat(y % n) * side).rounded(.down),
                          width: max(1, side.rounded()), height: max(1, side.rounded()))
        guard let part = image.cropping(to: crop) else { return sea }
        return encode(size: 512) { context in
            context.interpolationQuality = .high
            context.draw(part, in: CGRect(x: 0, y: 0, width: 512, height: 512))
        }
    }

    static let sea = solid(red: 0xB3, green: 0xDD, blue: 0xFF)
    static let blank = solid(red: 0xE4, green: 0xE4, blue: 0xE1)

    private static func solid(red: CGFloat, green: CGFloat, blue: CGFloat) -> Data {
        encode(size: 64) { context in
            context.setFillColor(red: red / 255, green: green / 255, blue: blue / 255, alpha: 1)
            context.fill(CGRect(x: 0, y: 0, width: 64, height: 64))
        }
    }

    private static func encode(size: Int, draw: (CGContext) -> Void) -> Data {
        let data = NSMutableData()
        guard let context = CGContext(
                data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue),
              let destination = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil)
        else { return Data() }
        draw(context)
        guard let image = context.makeImage() else { return Data() }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.9] as CFDictionary)
        CGImageDestinationFinalize(destination)
        return data as Data
    }
}
