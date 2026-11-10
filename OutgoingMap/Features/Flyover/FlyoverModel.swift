import SceneKit
import SwiftUI

@MainActor @Observable
final class FlyoverModel: NSObject {
    private enum CameraMode { case overview, follow, free }

    private struct Pose {
        var position: SIMD3<Double>
        var target: SIMD3<Double>
    }

    let content: TripContent
    let stops: [PlacedPhoto]
    var progress = 1.0
    private(set) var isPlaying = false
    private(set) var isLoading = true
    private(set) var view: SCNView?
    private(set) var missing: [String] = []
    var popup: UUID?
    var viewer: UUID?
    var poi: POI?

    @ObservationIgnored var reduceMotion = false
    @ObservationIgnored private var world: FlyoverWorld?
    @ObservationIgnored private var link: CADisplayLink?
    @ObservationIgnored private var mode = CameraMode.overview
    @ObservationIgnored private var blendFrom: Pose?
    @ObservationIgnored private var blendStart = 0.0
    @ObservationIgnored private var blendDuration = 1.0
    @ObservationIgnored private var holdUntil = 0.0
    @ObservationIgnored private var lastTime = 0.0
    @ObservationIgnored private var heading = 0.0
    @ObservationIgnored private var snapHeading = true
    @ObservationIgnored private var nextStop = 0

    init(content: TripContent) {
        self.content = content
        stops = content.placed.filter(\.isPlaced).sorted { $0.fraction < $1.fraction }
        super.init()
    }

    private var duration: Double { min(max(content.route.totalDistance / 120, 25), 60) }

    func load(store: TripStore, mapData: MapData) async {
        guard isLoading else { return }
        var thumbs: [UUID: URL] = [:]
        for photo in content.trip.photos { thumbs[photo.id] = store.thumbURL(photo, in: content.trip) }
        let accent = UIColor(named: "AccentColor") ?? .systemOrange

        let world = await FlyoverWorld.build(content: content, tiles: mapData.tiles, elevation: mapData.elevation,
                                             thumbs: thumbs, accent: accent)
        isLoading = false
        guard let world, !Task.isCancelled else { return }

        let view = SCNView(frame: .zero)
        view.scene = world.scene
        view.pointOfView = world.camera
        view.backgroundColor = FlyoverWorld.sky
        view.antialiasingMode = .multisampling4X
        view.rendersContinuously = true
        view.allowsCameraControl = true
        view.defaultCameraController.interactionMode = .orbitTurntable
        view.defaultCameraController.inertiaEnabled = true
        view.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tap)))

        self.world = world
        self.view = view
        missing = world.missing
        mode = .overview

        let link = CADisplayLink(target: self, selector: #selector(tick))
        link.preferredFrameRateRange = CAFrameRateRange(minimum: 30, maximum: 60, preferred: 60)
        link.add(to: .main, forMode: .common)
        self.link = link
    }

    func stop() {
        link?.invalidate()
        link = nil
        view?.scene = nil
        view = nil
        world = nil
        isPlaying = false
    }

    func play() {
        guard !reduceMotion, !isPlaying, let view, let world else { return }
        if progress >= 1 {
            progress = 0
            nextStop = 0
        }
        poi = nil
        viewer = nil
        isPlaying = true
        snapHeading = true
        startBlend(to: .follow, duration: 1.6)
        view.allowsCameraControl = false
        view.pointOfView = world.camera
        holdUntil = CACurrentMediaTime() + 1.6
    }

    func pause() {
        guard isPlaying else { return }
        isPlaying = false
        popup = nil
        holdUntil = 0
        blendFrom = nil
        mode = .free
        view?.allowsCameraControl = true
        if let world { view?.defaultCameraController.target = SCNVector3(SIMD3<Float>(world.point(at: progress))) }
    }

    func scrub(to fraction: Double) {
        pause()
        popup = nil
        progress = min(max(fraction, 0), 1)
        nextStop = stops.firstIndex { $0.fraction > progress } ?? stops.count
        snapHeading = true
        blendFrom = nil
        mode = .follow
    }

    func overview() {
        pause()
        if reduceMotion {
            blendFrom = nil
            mode = .overview
        } else {
            startBlend(to: .overview, duration: 1.4)
        }
    }

    func openPhoto(_ id: UUID) {
        pause()
        popup = nil
        poi = nil
        viewer = id
    }

    private func finish() {
        progress = 1
        isPlaying = false
        view?.allowsCameraControl = true
        startBlend(to: .overview, duration: 2)
    }

    private func startBlend(to mode: CameraMode, duration: Double) {
        if let eye = view?.pointOfView {
            let position = SIMD3<Double>(eye.simdWorldPosition)
            blendFrom = Pose(position: position, target: position + SIMD3<Double>(eye.simdWorldFront) * 500)
        }
        blendStart = CACurrentMediaTime()
        blendDuration = duration
        self.mode = mode
    }

    @objc private func tick(_ link: CADisplayLink) {
        guard let world, let view else { return }
        let now = link.timestamp
        let dt = lastTime > 0 ? min(now - lastTime, 0.1) : 0
        lastTime = now

        if isPlaying, now >= holdUntil {
            if popup != nil { popup = nil }
            advance(dt)
        }
        world.show(progress: progress)
        updateCamera(world, view, now: now, dt: dt)
        world.keepScreenSize(in: view)
    }

    private func advance(_ dt: Double) {
        let next = min(progress + dt / duration, 1)
        if nextStop < stops.count, stops[nextStop].fraction <= next {
            progress = max(progress, stops[nextStop].fraction)
            popup = stops[nextStop].id
            nextStop += 1
            holdUntil = CACurrentMediaTime() + 2.5
        } else {
            progress = next
            if next >= 1 { finish() }
        }
    }

    private func updateCamera(_ world: FlyoverWorld, _ view: SCNView, now: Double, dt: Double) {
        guard mode != .free, let eye = view.pointOfView else { return }
        var pose = mode == .follow ? followPose(world, dt: dt) : overviewPose(world, view)
        if let from = blendFrom {
            let t = min((now - blendStart) / blendDuration, 1)
            let e = t * t * (3 - 2 * t)
            pose = Pose(position: from.position + (pose.position - from.position) * e,
                        target: from.target + (pose.target - from.target) * e)
            if t >= 1 { blendFrom = nil }
        }
        eye.camera?.fieldOfView = 50
        eye.simdWorldPosition = SIMD3<Float>(pose.position)
        eye.simdLook(at: SIMD3<Float>(pose.target), up: [0, 1, 0], localFront: [0, 0, -1])

        if !isPlaying, blendFrom == nil {
            view.defaultCameraController.target = SCNVector3(SIMD3<Float>(pose.target))
            mode = .free
        }
    }

    private func followPose(_ world: FlyoverWorld, dt: Double) -> Pose {
        let head = world.point(at: progress)
        let ahead = world.point(at: min(progress + 300 / max(content.route.totalDistance, 1), 1))
        let direction = SIMD2(ahead.x - head.x, ahead.z - head.z)
        if PathSmoothing.length(direction) > 1 {
            let target = atan2(direction.x, direction.y)
            heading = snapHeading ? target : heading + remainder(target - heading, 2 * .pi) * (1 - exp(-dt * 1.6))
            snapHeading = false
        }

        let forward = SIMD2(sin(heading), cos(heading))
        var position = SIMD3(head.x - forward.x * 720, head.y + 800, head.z - forward.y * 720)
        position.y = max(position.y, world.terrain.height(at: SIMD2(position.x, position.z)) + 150)
        return Pose(position: position, target: SIMD3(head.x + forward.x * 200, head.y, head.z + forward.y * 200))
    }

    private func overviewPose(_ world: FlyoverWorld, _ view: SCNView) -> Pose {
        let center = (world.routeMin + world.routeMax) / 2
        let extent = world.routeMax - world.routeMin
        let aspect = view.bounds.height > 0 ? view.bounds.width / view.bounds.height : 0.46
        let half = tan(25 * Double.pi / 180), pitch = 55 * Double.pi / 180
        let distance = max(extent.x / 2 / (half * aspect), extent.z / 2 * sin(pitch) / half) * 1.9 + 400
        let target = center - SIMD3(0, 0, extent.z * 0.08)
        return Pose(position: target + SIMD3(0, sin(pitch), cos(pitch)) * distance, target: target)
    }

    @objc private func tap(_ gesture: UITapGestureRecognizer) {
        guard let view else { return }
        let hits = view.hitTest(gesture.location(in: view), options: [.searchMode: SCNHitTestSearchMode.all.rawValue])
        for hit in hits {
            var node: SCNNode? = hit.node
            while let current = node, current.name == nil { node = current.parent }
            guard let name = node?.name else { continue }
            if name.hasPrefix("photo:"), let id = UUID(uuidString: String(name.dropFirst(6))) {
                openPhoto(id)
                return
            }
            if name.hasPrefix("poi:"), let i = Int(name.dropFirst(4)), content.nearbyPOIs.indices.contains(i) {
                poi = content.nearbyPOIs[i].poi
                return
            }
        }
    }
}
