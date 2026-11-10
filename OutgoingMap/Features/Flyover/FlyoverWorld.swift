import SceneKit
import UIKit

struct FlyoverTerrain {
    static let exaggeration = 1.3

    let origin: Coordinate
    let width: Double
    let depth: Double
    let cols: Int
    let rows: Int
    let heights: [Float]

    func local(_ c: Coordinate) -> SIMD2<Double> {
        let m = Geo.metresPerDegreeLat
        return SIMD2((c.lon - origin.lon) * m * cos(origin.lat * .pi / 180), (origin.lat - c.lat) * m)
    }

    func height(at p: SIMD2<Double>) -> Double {
        let fx = min(max((p.x / width + 0.5) * Double(cols - 1), 0), Double(cols - 1) - 1e-9)
        let fz = min(max((p.y / depth + 0.5) * Double(rows - 1), 0), Double(rows - 1) - 1e-9)
        let c = Int(fx), r = Int(fz)
        let u = fx - Double(c), v = fz - Double(r)
        let a = Double(heights[r * cols + c]), b = Double(heights[r * cols + c + 1])
        let d = Double(heights[(r + 1) * cols + c]), e = Double(heights[(r + 1) * cols + c + 1])
        return v >= u ? a + u * (e - d) + v * (d - a) : a + u * (b - a) + v * (e - b)
    }
}

final class FlyoverWorld {
    static let sky = UIColor(red: 0.80, green: 0.88, blue: 0.95, alpha: 1)

    let scene: SCNScene
    let terrain: FlyoverTerrain
    let camera: SCNNode
    let line: SCNMaterial
    let head: SCNNode
    let path: [SIMD3<Double>]
    let fractions: [Double]
    let routeMin: SIMD3<Double>
    let routeMax: SIMD3<Double>
    let photoPins: [(node: SCNNode, fraction: Double)]
    let screenSized: [SCNNode]
    let missing: [String]

    init(scene: SCNScene, terrain: FlyoverTerrain, camera: SCNNode, line: SCNMaterial, head: SCNNode,
         path: [SIMD3<Double>], fractions: [Double], photoPins: [(node: SCNNode, fraction: Double)],
         screenSized: [SCNNode], missing: [String]) {
        self.scene = scene
        self.terrain = terrain
        self.camera = camera
        self.line = line
        self.head = head
        self.path = path
        self.fractions = fractions
        routeMin = path.reduce(path[0]) { pointwiseMin($0, $1) }
        routeMax = path.reduce(path[0]) { pointwiseMax($0, $1) }
        self.photoPins = photoPins
        self.screenSized = screenSized
        self.missing = missing
    }

    func point(at f: Double) -> SIMD3<Double> {
        let last = path.count - 1
        if last == 0 || f <= fractions[0] { return path[0] }
        if f >= fractions[last] { return path[last] }
        var lo = 0, hi = last
        while hi - lo > 1 {
            let mid = (lo + hi) / 2
            if fractions[mid] <= f { lo = mid } else { hi = mid }
        }
        let span = fractions[hi] - fractions[lo]
        return path[lo] + (path[hi] - path[lo]) * (span > 0 ? (f - fractions[lo]) / span : 0)
    }

    func show(progress: Double) {
        line.setValue(NSNumber(value: Float(progress)), forKey: "progress")
        head.simdPosition = SIMD3<Float>(point(at: progress))
        for pin in photoPins {
            let opacity: CGFloat = pin.fraction <= progress + 1e-6 ? 1 : 0.4
            if pin.node.opacity != opacity { pin.node.opacity = opacity }
        }
    }

    func keepScreenSize(in view: SCNView) {
        guard let eye = view.pointOfView, view.bounds.height > 0 else { return }
        let fov = eye.camera?.fieldOfView ?? 50
        let focal = Float(view.bounds.height / 2 / tan(fov * .pi / 360))
        let position = eye.simdWorldPosition
        for node in screenSized {
            node.simdScale = SIMD3(repeating: simd_distance(position, node.simdWorldPosition) / focal)
        }
    }
}

extension FlyoverWorld {
    @concurrent
    static func build(content: TripContent, tiles: MBTiles?, elevation: ElevationSource?,
                      thumbs: [UUID: URL], accent: UIColor) async -> FlyoverWorld? {
        let route = content.route
        let coords = route.coordinates
        guard coords.count > 1, var box = Geo.boundingBox(of: coords, padding: 700) else { return nil }

        let mLat = Geo.metresPerDegreeLat
        let mLon = mLat * cos((box.minLat + box.maxLat) / 2 * .pi / 180)
        let minSpan = 2500.0
        let w0 = (box.maxLon - box.minLon) * mLon, d0 = (box.maxLat - box.minLat) * mLat
        if w0 < minSpan { box.minLon -= (minSpan - w0) / 2 / mLon; box.maxLon += (minSpan - w0) / 2 / mLon }
        if d0 < minSpan { box.minLat -= (minSpan - d0) / 2 / mLat; box.maxLat += (minSpan - d0) / 2 / mLat }
        let width = (box.maxLon - box.minLon) * mLon, depth = (box.maxLat - box.minLat) * mLat
        let span = max(width, depth)

        let n = min(200, Int(span / 30) + 1)
        let cols = width >= depth ? n : max(2, Int((Double(n - 1) * width / depth).rounded()) + 1)
        let rows = depth > width ? n : max(2, Int((Double(n - 1) * depth / width).rounded()) + 1)

        let raw = elevation?.grid(bbox: box, columns: cols, rows: rows) ?? []
        let hasElevation = raw.contains { $0 != 0 }
        let base = raw.min() ?? 0
        let heights = hasElevation
            ? raw.map { ($0 - base) * Float(FlyoverTerrain.exaggeration) }
            : Array(repeating: Float(0), count: cols * rows)
        let terrain = FlyoverTerrain(
            origin: Coordinate(lat: (box.minLat + box.maxLat) / 2, lon: (box.minLon + box.maxLon) / 2),
            width: width, depth: depth, cols: cols, rows: rows, heights: heights
        )

        let texture = tiles.flatMap { stitch($0, box) }
        var missing: [String] = []
        if !hasElevation { missing.append("缺少地形高度資料，地形以平面顯示") }
        if texture == nil { missing.append("缺少離線地圖，改以高度色階顯示") }

        let scene = SCNScene()
        scene.background.contents = sky
        scene.fogColor = sky
        scene.fogStartDistance = span * 0.9
        scene.fogEndDistance = span * 4

        scene.rootNode.addChildNode(terrainNode(terrain, box: box, texture: texture))

        let (path, fractions) = routePath(route, terrain)
        let line = lineMaterial(accent)
        if path.count > 1 {
            let node = SCNNode(geometry: ribbon(path, fractions))
            node.geometry?.firstMaterial = line
            node.renderingOrder = 10
            scene.rootNode.addChildNode(node)
        }

        var screenSized: [SCNNode] = []
        var photoPins: [(node: SCNNode, fraction: Double)] = []
        for placed in content.placed {
            guard let c = placed.coordinate else { continue }
            let thumb = thumbs[placed.id].flatMap { UIImage(contentsOfFile: $0.path) }
            let p = terrain.local(c)
            let node = pin(photoImage(thumb, accent: accent), stem: 30,
                           at: SIMD3(p.x, terrain.height(at: p), p.y), name: "photo:\(placed.id.uuidString)")
            photoPins.append((node, placed.fraction))
            screenSized.append(node)
            scene.rootNode.addChildNode(node)
        }
        for (i, hit) in content.nearbyPOIs.enumerated() where hit.poi.kind != "other_hiking" {
            let p = terrain.local(hit.poi.coordinate)
            let node = pin(poiImage(hit.poi), stem: 10, at: SIMD3(p.x, terrain.height(at: p), p.y), name: "poi:\(i)")
            screenSized.append(node)
            scene.rootNode.addChildNode(node)
        }

        let head = SCNNode()
        let marker = billboard(headImage(accent))
        marker.renderingOrder = 300
        head.addChildNode(marker)
        screenSized.append(head)
        scene.rootNode.addChildNode(head)

        let camera = SCNNode()
        camera.camera = SCNCamera()
        camera.camera?.fieldOfView = 50
        camera.camera?.automaticallyAdjustsZRange = false
        camera.camera?.zNear = 5
        camera.camera?.zFar = span * 8
        scene.rootNode.addChildNode(camera)

        return FlyoverWorld(scene: scene, terrain: terrain, camera: camera, line: line, head: head,
                            path: path, fractions: fractions, photoPins: photoPins,
                            screenSized: screenSized, missing: missing)
    }

    private struct Texture {
        let image: CGImage
        let zoom: Int
        let x0: Int
        let y0: Int
        let nx: Int
        let ny: Int
    }

    private static func stitch(_ tiles: MBTiles, _ box: BoundingBox) -> Texture? {
        let size = 512, limit = 4096
        for z in stride(from: tiles.maxZoom, through: tiles.minZoom, by: -1) {
            let x0 = Int(WebMercator.tileX(lon: box.minLon, zoom: z)), x1 = Int(WebMercator.tileX(lon: box.maxLon, zoom: z))
            let y0 = Int(WebMercator.tileY(lat: box.maxLat, zoom: z)), y1 = Int(WebMercator.tileY(lat: box.minLat, zoom: z))
            let nx = x1 - x0 + 1, ny = y1 - y0 + 1
            guard max(nx, ny) * size <= limit,
                  let space = CGColorSpace(name: CGColorSpace.sRGB),
                  let ctx = CGContext(data: nil, width: nx * size, height: ny * size, bitsPerComponent: 8, bytesPerRow: 0,
                                      space: space, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
            else { continue }

            ctx.setFillColor(red: 0xB3 / 255.0, green: 0xDD / 255.0, blue: 1, alpha: 1)
            ctx.fill(CGRect(x: 0, y: 0, width: nx * size, height: ny * size))
            var found = false
            for x in x0...x1 {
                for y in y0...y1 {
                    guard let data = tiles.tile(z: z, x: x, y: y), let image = UIImage(data: data)?.cgImage else { continue }
                    ctx.draw(image, in: CGRect(x: (x - x0) * size, y: (y1 - y) * size, width: size, height: size))
                    found = true
                }
            }
            if found, let image = ctx.makeImage() {
                return Texture(image: image, zoom: z, x0: x0, y0: y0, nx: nx, ny: ny)
            }
        }
        return nil
    }

    private static func terrainNode(_ t: FlyoverTerrain, box: BoundingBox, texture: Texture?) -> SCNNode {
        let maxHeight = max(t.heights.max() ?? 0, 1)
        var vertices: [SCNVector3] = []
        var uvs: [CGPoint] = []
        var colors: [Float] = []

        for r in 0..<t.rows {
            for c in 0..<t.cols {
                let fx = Double(c) / Double(t.cols - 1), fz = Double(r) / Double(t.rows - 1)
                let h = t.heights[r * t.cols + c]
                vertices.append(SCNVector3(Float((fx - 0.5) * t.width), h, Float((fz - 0.5) * t.depth)))

                if let texture {
                    let lat = box.maxLat - fz * (box.maxLat - box.minLat)
                    let lon = box.minLon + fx * (box.maxLon - box.minLon)
                    uvs.append(CGPoint(
                        x: (WebMercator.tileX(lon: lon, zoom: texture.zoom) - Double(texture.x0)) / Double(texture.nx),
                        y: (WebMercator.tileY(lat: lat, zoom: texture.zoom) - Double(texture.y0)) / Double(texture.ny)
                    ))
                } else {
                    let cellX = Float(t.width) / Float(t.cols - 1), cellZ = Float(t.depth) / Float(t.rows - 1)
                    let dx = (t.heights[r * t.cols + min(c + 1, t.cols - 1)] - t.heights[r * t.cols + max(c - 1, 0)]) / (2 * cellX)
                    let dz = (t.heights[min(r + 1, t.rows - 1) * t.cols + c] - t.heights[max(r - 1, 0) * t.cols + c]) / (2 * cellZ)
                    let normal = simd_normalize(SIMD3<Float>(-dx, 1, -dz))
                    let shade = 0.45 + 0.55 * max(simd_dot(normal, simd_normalize(SIMD3<Float>(-1, 1.5, -1))), 0)
                    let k = h / maxHeight
                    let low = SIMD3<Float>(0.56, 0.68, 0.47), mid = SIMD3<Float>(0.82, 0.76, 0.60), high = SIMD3<Float>(0.95, 0.94, 0.92)
                    let tint = k < 0.5 ? low + (mid - low) * (k * 2) : mid + (high - mid) * (k * 2 - 1)
                    colors += [tint.x * shade, tint.y * shade, tint.z * shade]
                }
            }
        }

        var indices: [UInt32] = []
        indices.reserveCapacity((t.rows - 1) * (t.cols - 1) * 6)
        for r in 0..<t.rows - 1 {
            for c in 0..<t.cols - 1 {
                let a = UInt32(r * t.cols + c), b = a + 1, d = a + UInt32(t.cols), e = d + 1
                indices += [a, d, e, a, e, b]
            }
        }

        let surface = texture != nil
            ? SCNGeometrySource(textureCoordinates: uvs)
            : SCNGeometrySource(data: colors.withUnsafeBytes { Data($0) }, semantic: .color, vectorCount: vertices.count,
                                usesFloatComponents: true, componentsPerVector: 3, bytesPerComponent: 4,
                                dataOffset: 0, dataStride: 12)
        let geometry = SCNGeometry(sources: [SCNGeometrySource(vertices: vertices), surface],
                                   elements: [SCNGeometryElement(indices: indices, primitiveType: .triangles)])
        let material = SCNMaterial()
        material.lightingModel = .constant
        material.isDoubleSided = true
        material.diffuse.contents = texture?.image ?? UIColor.white
        material.diffuse.mipFilter = .linear
        material.diffuse.maxAnisotropy = 8
        geometry.firstMaterial = material
        return SCNNode(geometry: geometry)
    }

    // ponytail: the smoothed line is a visual approximation of the walked path between sparse fixes; an imported GPX track removes the need.
    private static func routePath(_ route: Route, _ terrain: FlyoverTerrain) -> ([SIMD3<Double>], [Double]) {
        let total = route.totalDistance
        var points: [SIMD2<Double>] = []
        var anchorFractions: [Double] = []
        for (i, c) in route.coordinates.enumerated() {
            let p = terrain.local(c)
            if let last = points.last, PathSmoothing.length(p - last) < 0.5 { continue }
            points.append(p)
            anchorFractions.append(total > 0 ? route.distances[i] / total : 0)
        }

        let smooth = PathSmoothing.catmullRom(points, spacing: 8)
        var arc = [0.0]
        for i in smooth.points.indices.dropFirst() {
            arc.append(arc[i - 1] + PathSmoothing.length(smooth.points[i] - smooth.points[i - 1]))
        }

        var fractions = Array(repeating: anchorFractions.last ?? 0, count: smooth.points.count)
        for k in 0..<max(smooth.anchors.count - 1, 0) {
            let from = smooth.anchors[k], to = smooth.anchors[k + 1]
            let length = arc[to] - arc[from]
            for j in from..<to {
                let t = length > 0 ? (arc[j] - arc[from]) / length : 0
                fractions[j] = anchorFractions[k] + (anchorFractions[k + 1] - anchorFractions[k]) * t
            }
        }

        let path = smooth.points.map { SIMD3($0.x, terrain.height(at: $0) + 4, $0.y) }
        return (path, fractions)
    }

    private static func ribbon(_ path: [SIMD3<Double>], _ fractions: [Double]) -> SCNGeometry {
        var vertices: [SCNVector3] = [], normals: [SCNVector3] = [], uvs: [CGPoint] = [], indices: [UInt32] = []
        for j in path.indices {
            let a = path[max(j - 1, 0)], b = path[min(j + 1, path.count - 1)]
            var tangent = SIMD2(b.x - a.x, b.z - a.z)
            let length = PathSmoothing.length(tangent)
            tangent = length > 0 ? tangent / length : SIMD2(1, 0)
            for side in [1.0, -1.0] {
                vertices.append(SCNVector3(Float(path[j].x), Float(path[j].y), Float(path[j].z)))
                normals.append(SCNVector3(Float(-tangent.y * side), 0, Float(tangent.x * side)))
                uvs.append(CGPoint(x: side > 0 ? 0 : 1, y: fractions[j]))
            }
            if j > 0 {
                let k = UInt32(2 * j)
                indices += [k - 2, k - 1, k, k - 1, k + 1, k]
            }
        }
        return SCNGeometry(
            sources: [SCNGeometrySource(vertices: vertices), SCNGeometrySource(normals: normals), SCNGeometrySource(textureCoordinates: uvs)],
            elements: [SCNGeometryElement(indices: indices, primitiveType: .triangles)]
        )
    }

    private static func lineMaterial(_ accent: UIColor) -> SCNMaterial {
        let stripe = UIGraphicsImageRenderer(size: CGSize(width: 64, height: 4)).image { ctx in
            UIColor.white.setFill()
            ctx.fill(CGRect(x: 0, y: 0, width: 64, height: 4))
            accent.setFill()
            ctx.fill(CGRect(x: 15, y: 0, width: 34, height: 4))
        }
        let material = SCNMaterial()
        material.lightingModel = .constant
        material.isDoubleSided = true
        material.diffuse.contents = stripe
        material.diffuse.wrapT = .clamp
        material.shaderModifiers = [
            .geometry: """
            float4 flyoverEye = scn_node.modelViewTransform * _geometry.position;
            float flyoverScale = max(-flyoverEye.z, 1.0) / scn_frame.projectionTransform[1][1];
            _geometry.position.xyz += _geometry.normal * (flyoverScale * 0.0075);
            _geometry.position.y += flyoverScale * 0.0086;
            """,
            .surface: """
            #pragma arguments
            float progress;
            #pragma body
            if (_surface.diffuseTexcoord.y > progress + 0.00001) { discard_fragment(); }
            """,
        ]
        material.setValue(NSNumber(value: Float(1)), forKey: "progress")
        return material
    }

    private static func billboard(_ image: UIImage) -> SCNNode {
        let plane = SCNPlane(width: image.size.width, height: image.size.height)
        let material = SCNMaterial()
        material.lightingModel = .constant
        material.diffuse.contents = image
        material.readsFromDepthBuffer = false
        material.writesToDepthBuffer = false
        plane.firstMaterial = material
        let node = SCNNode(geometry: plane)
        node.renderingOrder = 100
        let constraint = SCNBillboardConstraint()
        constraint.freeAxes = .all
        node.constraints = [constraint]
        return node
    }

    private static func pin(_ image: UIImage, stem: CGFloat, at position: SIMD3<Double>, name: String) -> SCNNode {
        let node = SCNNode()
        node.name = name
        node.simdPosition = SIMD3<Float>(position)

        let cylinder = SCNCylinder(radius: 1, height: stem)
        cylinder.firstMaterial?.lightingModel = .constant
        cylinder.firstMaterial?.diffuse.contents = UIColor.white
        cylinder.firstMaterial?.readsFromDepthBuffer = false
        let stemNode = SCNNode(geometry: cylinder)
        stemNode.position.y = Float(stem / 2)
        stemNode.renderingOrder = 90
        node.addChildNode(stemNode)

        let head = billboard(image)
        head.position.y = Float(stem + image.size.height / 2)
        node.addChildNode(head)
        return node
    }

    private static func render(_ size: CGSize, _ draw: (CGContext) -> Void) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 3
        return UIGraphicsImageRenderer(size: size, format: format).image { draw($0.cgContext) }
    }

    private static func photoImage(_ thumb: UIImage?, accent: UIColor) -> UIImage {
        render(CGSize(width: 46, height: 46)) { _ in
            let outer = CGRect(x: 1, y: 1, width: 44, height: 44)
            UIColor.white.setFill()
            UIBezierPath(roundedRect: outer, cornerRadius: 10).fill()

            let inner = outer.insetBy(dx: 3, dy: 3)
            if let thumb {
                UIBezierPath(roundedRect: inner, cornerRadius: 7).addClip()
                let scale = max(inner.width / thumb.size.width, inner.height / thumb.size.height)
                let size = CGSize(width: thumb.size.width * scale, height: thumb.size.height * scale)
                thumb.draw(in: CGRect(x: inner.midX - size.width / 2, y: inner.midY - size.height / 2, width: size.width, height: size.height))
            } else {
                accent.setFill()
                UIBezierPath(roundedRect: inner, cornerRadius: 7).fill()
                symbol("camera.fill", size: 18, color: .white, in: inner)
            }
        }
        .withBadge(accent)
    }

    private static func poiImage(_ poi: POI) -> UIImage {
        let kind = Format.poiKind(poi.kind)
        let font = UIFont.systemFont(ofSize: 12, weight: .semibold)
        let text = poi.name as NSString
        let textSize = text.size(withAttributes: [.font: font])
        let width = max(24, ceil(textSize.width) + 8)
        let height = ceil(textSize.height) + 2 + 24
        return render(CGSize(width: width, height: height)) { ctx in
            let origin = CGPoint(x: (width - textSize.width) / 2, y: 0)
            ctx.setLineJoin(.round)
            text.draw(at: origin, withAttributes: [.font: font, .strokeColor: UIColor.white, .strokeWidth: 6])
            text.draw(at: origin, withAttributes: [.font: font, .foregroundColor: UIColor(white: 0.12, alpha: 1)])

            let circle = CGRect(x: (width - 22) / 2, y: height - 23, width: 22, height: 22)
            UIColor.white.setFill()
            UIBezierPath(ovalIn: circle).fill()
            UIColor(red: 0.18, green: 0.42, blue: 0.30, alpha: 1).setFill()
            UIBezierPath(ovalIn: circle.insetBy(dx: 2, dy: 2)).fill()
            symbol(kind.symbol, size: 10, color: .white, in: circle)
        }
    }

    private static func headImage(_ accent: UIColor) -> UIImage {
        render(CGSize(width: 22, height: 22)) { _ in
            UIColor.white.setFill()
            UIBezierPath(ovalIn: CGRect(x: 1, y: 1, width: 20, height: 20)).fill()
            accent.setFill()
            UIBezierPath(ovalIn: CGRect(x: 5, y: 5, width: 12, height: 12)).fill()
        }
    }

    fileprivate static func symbol(_ name: String, size: CGFloat, color: UIColor, in rect: CGRect) {
        let config = UIImage.SymbolConfiguration(pointSize: size, weight: .semibold)
        guard let image = UIImage(systemName: name, withConfiguration: config)?.withTintColor(color, renderingMode: .alwaysOriginal) else { return }
        image.draw(at: CGPoint(x: rect.midX - image.size.width / 2, y: rect.midY - image.size.height / 2))
    }
}

private extension UIImage {
    func withBadge(_ accent: UIColor) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 3
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in
            draw(at: .zero)
            let badge = CGRect(x: size.width - 18, y: size.height - 18, width: 17, height: 17)
            UIColor.white.setFill()
            UIBezierPath(ovalIn: badge).fill()
            accent.setFill()
            UIBezierPath(ovalIn: badge.insetBy(dx: 1.5, dy: 1.5)).fill()
            FlyoverWorld.symbol("camera.fill", size: 7, color: .white, in: badge)
        }
    }
}
