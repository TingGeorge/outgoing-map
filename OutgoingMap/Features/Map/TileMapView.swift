import MapKit
import SwiftUI

struct MapPin: Identifiable, Equatable {
    enum Kind: Equatable {
        case photo(thumbnail: URL)
        case poi(kind: String, name: String)
    }

    let id: String
    let coordinate: Coordinate
    let kind: Kind
}

struct TileMapView: View {
    var route: [Coordinate] = []
    var trackPoints: [Coordinate] = []
    var pins: [MapPin] = []
    var selection: Binding<String?> = .constant(nil)
    var showsUserLocation = false
    var fitRouteRequest = 0
    var onActivatePin: (String) -> Void = { _ in }

    @Environment(MapData.self) private var mapData

    var body: some View {
        OfflineMapRepresentable(map: self, tiles: mapData.tiles)
            .overlay(alignment: .bottomTrailing) {
                if mapData.tiles != nil {
                    Text("© 魯地圖 · OpenStreetMap")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(.ultraThinMaterial, in: .capsule)
                        .padding(6)
                        .allowsHitTesting(false)
                }
            }
            .overlay(alignment: .top) {
                if mapData.tiles == nil {
                    Label("尚未安裝離線地圖", systemImage: "map")
                        .font(.footnote)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(.regularMaterial, in: .capsule)
                        .padding(8)
                }
            }
    }
}

private final class PinAnnotation: NSObject, MKAnnotation {
    let pin: MapPin
    let coordinate: CLLocationCoordinate2D

    init(_ pin: MapPin) {
        self.pin = pin
        coordinate = CLLocationCoordinate2D(latitude: pin.coordinate.lat, longitude: pin.coordinate.lon)
    }

    var title: String? {
        if case .poi(_, let name) = pin.kind { name } else { nil }
    }
}

private final class RouteCasing: MKPolyline {}
private final class TrackDots: MKPolyline {}

private struct OfflineMapRepresentable: UIViewRepresentable {
    let map: TileMapView
    let tiles: MBTiles?

    static let taiwan = BoundingBox(minLat: 21.85, minLon: 119.3, maxLat: 25.35, maxLon: 122.05)

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> MKMapView {
        let view = MKMapView()
        view.delegate = context.coordinator
        view.pointOfInterestFilter = .excludingAll
        view.showsCompass = true
        view.showsScale = true
        view.isPitchEnabled = false
        view.isRotateEnabled = false
        view.backgroundColor = UIColor(red: 0xB3 / 255, green: 0xDD / 255, blue: 0xFF / 255, alpha: 1)
        view.register(PhotoPinView.self, forAnnotationViewWithReuseIdentifier: PhotoPinView.reuseID)
        view.register(MKMarkerAnnotationView.self, forAnnotationViewWithReuseIdentifier: "poi")
        view.addOverlay(OfflineTileOverlay(tiles: tiles), level: .aboveLabels)

        let bounds = mapRect(tiles?.bounds ?? Self.taiwan)
        view.setCameraBoundary(MKMapView.CameraBoundary(mapRect: bounds.insetBy(dx: -bounds.width * 0.3, dy: -bounds.height * 0.3)), animated: false)
        context.coordinator.tiles = tiles
        return view
    }

    func updateUIView(_ view: MKMapView, context: Context) {
        let c = context.coordinator
        c.map = map

        if view.showsUserLocation != map.showsUserLocation {
            view.showsUserLocation = map.showsUserLocation
        }

        if map.route != c.route || map.trackPoints != c.trackPoints {
            c.route = map.route
            c.trackPoints = map.trackPoints
            view.removeOverlays(view.overlays.filter { $0 is MKPolyline })
            if map.route.count > 1 {
                var points = map.route.map(\.location)
                view.addOverlay(RouteCasing(coordinates: &points, count: points.count), level: .aboveLabels)
                view.addOverlay(MKPolyline(coordinates: &points, count: points.count), level: .aboveLabels)
            }
            if !map.trackPoints.isEmpty {
                var points = map.trackPoints.map(\.location)
                view.addOverlay(TrackDots(coordinates: &points, count: points.count), level: .aboveLabels)
            }
        }

        if map.pins != c.pins {
            c.pins = map.pins
            view.removeAnnotations(view.annotations.filter { $0 is PinAnnotation })
            view.addAnnotations(map.pins.map(PinAnnotation.init))
            c.selection = nil
        }

        if !c.didSetInitialCamera {
            c.didSetInitialCamera = true
            c.fitRouteRequest = map.fitRouteRequest
            if map.showsUserLocation {
                view.setUserTrackingMode(.follow, animated: false)
            } else if !c.fit(view, animated: false) {
                view.setVisibleMapRect(mapRect(Self.taiwan), animated: false)
            }
        } else if map.fitRouteRequest != c.fitRouteRequest {
            c.fitRouteRequest = map.fitRouteRequest
            c.fit(view, animated: true)
        }

        let wanted = map.selection.wrappedValue
        if wanted != c.selection {
            c.selection = wanted
            let target = view.annotations.first { ($0 as? PinAnnotation)?.pin.id == wanted }
            if target == nil {
                for selected in view.selectedAnnotations {
                    view.deselectAnnotation(selected, animated: true)
                }
            }
            if let target {
                view.selectAnnotation(target, animated: true)
                let camera = view.camera.copy() as! MKMapCamera
                camera.centerCoordinate = target.coordinate
                UIView.animate(withDuration: 0.35) { view.camera = camera }
            }
        }
    }

    final class Coordinator: NSObject, MKMapViewDelegate, UIGestureRecognizerDelegate {
        var map: TileMapView?
        var tiles: MBTiles?
        var route: [Coordinate] = []
        var trackPoints: [Coordinate] = []
        var pins: [MapPin] = []
        var selection: String?
        var selectedAt = Date.distantPast
        var fitRouteRequest = 0
        var didSetInitialCamera = false
        var didSetZoomRange = false

        @discardableResult
        func fit(_ view: MKMapView, animated: Bool) -> Bool {
            let rects = (route.count > 1 ? route : route + trackPoints).map { MKMapRect(origin: MKMapPoint($0.location), size: MKMapSize(width: 0, height: 0)) }
            guard let first = rects.first else { return false }
            var rect = rects.dropFirst().reduce(first) { $0.union($1) }
            let minSide = MKMapPointsPerMeterAtLatitude(MKMapPoint(x: rect.midX, y: rect.midY).coordinate.latitude) * 600
            rect = rect.insetBy(dx: min(0, (rect.width - minSide) / 2), dy: min(0, (rect.height - minSide) / 2))
            UIView.animate(withDuration: animated ? 0.35 : 0) {
                view.setVisibleMapRect(rect, edgePadding: UIEdgeInsets(top: 64, left: 32, bottom: 40, right: 32), animated: false)
            }
            return true
        }

        func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
            switch overlay {
            case let tiles as MKTileOverlay:
                return MKTileOverlayRenderer(tileOverlay: tiles)
            case let dots as TrackDots:
                return TrackDotsRenderer(overlay: dots)
            case let casing as RouteCasing:
                let renderer = MKPolylineRenderer(polyline: casing)
                renderer.strokeColor = UIColor.white.withAlphaComponent(0.9)
                renderer.lineWidth = 8
                renderer.lineJoin = .round
                renderer.lineCap = .round
                return renderer
            case let line as MKPolyline:
                let renderer = MKPolylineRenderer(polyline: line)
                renderer.strokeColor = UIColor(named: "AccentColor")
                renderer.lineWidth = 4
                renderer.lineJoin = .round
                renderer.lineCap = .round
                return renderer
            default:
                return MKOverlayRenderer(overlay: overlay)
            }
        }

        func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
            guard let annotation = annotation as? PinAnnotation else { return nil }
            let view: MKAnnotationView
            switch annotation.pin.kind {
            case .photo(let thumbnail):
                let photo = mapView.dequeueReusableAnnotationView(withIdentifier: PhotoPinView.reuseID, for: annotation) as! PhotoPinView
                photo.imageView.image = LocalImage.load(thumbnail)
                photo.zPriority = MKAnnotationViewZPriority(rawValue: 600)
                view = photo
            case .poi(let kind, _):
                let marker = mapView.dequeueReusableAnnotationView(withIdentifier: "poi", for: annotation) as! MKMarkerAnnotationView
                marker.glyphImage = UIImage(systemName: Format.poiKind(kind).symbol)
                marker.markerTintColor = .systemTeal
                marker.titleVisibility = .adaptive
                marker.subtitleVisibility = .hidden
                marker.displayPriority = .required
                marker.zPriority = MKAnnotationViewZPriority(rawValue: 400)
                view = marker
            }
            view.canShowCallout = false
            view.selectedZPriority = .max
            if !(view.gestureRecognizers ?? []).contains(where: { $0.name == "activate" }) {
                let tap = UITapGestureRecognizer(target: self, action: #selector(tapped(_:)))
                tap.name = "activate"
                tap.cancelsTouchesInView = false
                tap.delegate = self
                view.addGestureRecognizer(tap)
            }
            return view
        }

        @objc func tapped(_ recognizer: UITapGestureRecognizer) {
            guard let pin = (recognizer.view as? MKAnnotationView)?.annotation as? PinAnnotation,
                  pin.pin.id == selection, Date.now.timeIntervalSince(selectedAt) > 0.4
            else { return }
            map?.onActivatePin(pin.pin.id)
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
            true
        }

        func mapView(_ mapView: MKMapView, didSelect annotation: MKAnnotation) {
            guard let pin = annotation as? PinAnnotation else { return }
            if selection != pin.pin.id {
                selection = pin.pin.id
                selectedAt = .now
            }
            if map?.selection.wrappedValue != pin.pin.id {
                map?.selection.wrappedValue = pin.pin.id
            }
        }

        func mapView(_ mapView: MKMapView, didDeselect annotation: MKAnnotation) {
            guard let pin = annotation as? PinAnnotation, selection == pin.pin.id else { return }
            selection = nil
            map?.selection.wrappedValue = nil
        }

        func mapView(_ mapView: MKMapView, regionDidChangeAnimated animated: Bool) {
            let zoom = zoomLevel(mapView)
            guard !didSetZoomRange, let tiles, zoom.isFinite else { return }
            didSetZoomRange = true
            let distance = mapView.camera.centerCoordinateDistance
            func distanceAt(_ z: Double) -> Double { distance * pow(2, zoom - z) }
            mapView.setCameraZoomRange(
                MKMapView.CameraZoomRange(
                    minCenterCoordinateDistance: distanceAt(Double(tiles.maxZoom + OfflineTileOverlay.overzoomLevels) + 0.5),
                    maxCenterCoordinateDistance: distanceAt(Double(tiles.minZoom))
                ),
                animated: false
            )
        }

        private func zoomLevel(_ mapView: MKMapView) -> Double {
            20 - log2(mapView.visibleMapRect.width / Double(mapView.bounds.width))
        }

        func mapViewDidFinishRenderingMap(_ mapView: MKMapView, fullyRendered: Bool) {
            hideAppleLegal(in: mapView)
        }

        private func hideAppleLegal(in view: UIView) {
            for sub in view.subviews {
                let name = String(describing: type(of: sub))
                if name.contains("Attribution") || name.contains("AppleLogo") || name.contains("Legal") {
                    sub.isHidden = true
                } else {
                    hideAppleLegal(in: sub)
                }
            }
        }
    }
}

private func mapRect(_ box: BoundingBox) -> MKMapRect {
    let a = MKMapPoint(CLLocationCoordinate2D(latitude: box.maxLat, longitude: box.minLon))
    let b = MKMapPoint(CLLocationCoordinate2D(latitude: box.minLat, longitude: box.maxLon))
    return MKMapRect(x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y)
}

private extension Coordinate {
    var location: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: lat, longitude: lon) }
}

private final class TrackDotsRenderer: MKOverlayRenderer {
    override func draw(_ mapRect: MKMapRect, zoomScale: MKZoomScale, in context: CGContext) {
        guard let line = overlay as? MKPolyline else { return }
        let radius = 3 / zoomScale
        let ring = 1.5 / zoomScale
        let fill = (UIColor(named: "AccentColor") ?? .systemOrange).cgColor
        let points = line.points()
        for i in 0..<line.pointCount {
            let p = point(for: points[i])
            context.setFillColor(UIColor.white.cgColor)
            context.fillEllipse(in: CGRect(x: p.x - radius - ring, y: p.y - radius - ring, width: 2 * (radius + ring), height: 2 * (radius + ring)))
            context.setFillColor(fill)
            context.fillEllipse(in: CGRect(x: p.x - radius, y: p.y - radius, width: 2 * radius, height: 2 * radius))
        }
    }
}

private final class PhotoPinView: MKAnnotationView {
    static let reuseID = "photo"
    static let side: CGFloat = 40
    static let pointer: CGFloat = 7

    let imageView = UIImageView()

    override init(annotation: MKAnnotation?, reuseIdentifier: String?) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
        let side = Self.side, height = side + Self.pointer
        frame = CGRect(x: 0, y: 0, width: side, height: height)
        centerOffset = CGPoint(x: 0, y: -height / 2)

        let card = UIView(frame: CGRect(x: 0, y: 0, width: side, height: side))
        card.backgroundColor = .white
        card.layer.cornerRadius = 9
        card.layer.shadowColor = UIColor.black.cgColor
        card.layer.shadowOpacity = 0.3
        card.layer.shadowRadius = 3
        card.layer.shadowOffset = CGSize(width: 0, height: 1)

        let triangle = CAShapeLayer()
        let path = UIBezierPath()
        path.move(to: CGPoint(x: side / 2 - 6, y: side - 1))
        path.addLine(to: CGPoint(x: side / 2 + 6, y: side - 1))
        path.addLine(to: CGPoint(x: side / 2, y: height))
        path.close()
        triangle.path = path.cgPath
        triangle.fillColor = UIColor.white.cgColor

        imageView.frame = card.bounds.insetBy(dx: 2.5, dy: 2.5)
        imageView.contentMode = .scaleAspectFill
        imageView.clipsToBounds = true
        imageView.layer.cornerRadius = 7
        imageView.backgroundColor = .secondarySystemBackground

        layer.addSublayer(triangle)
        addSubview(card)
        card.addSubview(imageView)
        accessibilityLabel = "照片"
        isAccessibilityElement = true
    }

    required init?(coder: NSCoder) { fatalError() }

    override func setSelected(_ selected: Bool, animated: Bool) {
        super.setSelected(selected, animated: animated)
        let scale: CGFloat = selected ? 1.6 : 1
        let transform = CGAffineTransform(translationX: 0, y: -(scale - 1) * bounds.height / 2).scaledBy(x: scale, y: scale)
        UIView.animate(withDuration: animated ? 0.2 : 0) { self.transform = transform }
    }

    override func prepareForReuse() {
        super.prepareForReuse()
        imageView.image = nil
        transform = .identity
    }
}
