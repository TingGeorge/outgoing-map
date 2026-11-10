import CoreLocation
import CoreMotion
import Observation
import UIKit

@Observable @MainActor final class LocationRecorder: NSObject {
    // ponytail: idle accuracy is unverified on real hardware in the mountains (no cell/Wi-Fi); if the device test shows gaps between samples, raise it to kCLLocationAccuracyHundredMeters.
    static let idleAccuracy = kCLLocationAccuracyThreeKilometers
    static let sampleAccuracy = kCLLocationAccuracyBest
    static let goodAccuracy: CLLocationAccuracy = 20
    static let maxFixAge: TimeInterval = 10
    static let sampleTimeout: TimeInterval = 45
    static let tickInterval: TimeInterval = 15

    private(set) var trip: Trip?
    private(set) var pointCount = 0
    private(set) var lastPoint: TrackPoint?
    private(set) var location: CLLocation?
    private(set) var authorization: CLAuthorizationStatus
    private(set) var isPrecise: Bool
    private(set) var isSampling = false
    private(set) var lastError: String?

    var isRecording: Bool { trip != nil }

    @ObservationIgnored private let store: TripStore
    @ObservationIgnored private let manager: CLLocationManager
    @ObservationIgnored private let altimeter = CMAltimeter()
    @ObservationIgnored private let pedometer = CMPedometer()
    @ObservationIgnored private var session: CLBackgroundActivitySession?
    @ObservationIgnored private var timer: Timer?
    @ObservationIgnored private var lastSampleAt: Date?
    @ObservationIgnored private var sampleStartedAt = Date.distantPast
    @ObservationIgnored private var bestFix: CLLocation?
    @ObservationIgnored private var pressureKPa: Double?
    @ObservationIgnored private var relativeAltitude: Double?
    @ObservationIgnored private var pendingInterval: Int?
    @ObservationIgnored private var sampleWaiters: [CheckedContinuation<Void, Never>] = []

    init(store: TripStore) {
        let manager = CLLocationManager()
        self.store = store
        self.manager = manager
        authorization = manager.authorizationStatus
        isPrecise = manager.accuracyAuthorization == .fullAccuracy
        super.init()

        manager.delegate = self
        manager.activityType = .fitness
        manager.pausesLocationUpdatesAutomatically = false
        manager.desiredAccuracy = Self.idleAccuracy

        if let active = store.activeRecording {
            let track = store.track(for: active)
            pointCount = track.count
            lastPoint = track.last
            lastSampleAt = track.last?.time
            begin(active)
        }
    }

    private var interval: TimeInterval {
        #if DEBUG
        let debugSeconds = UserDefaults.standard.double(forKey: "recordIntervalSeconds")
        if debugSeconds > 0 { return debugSeconds }
        #endif
        let minutes = UserDefaults.standard.integer(forKey: "intervalMinutes")
        return TimeInterval(minutes > 0 ? minutes : trip?.intervalMinutes ?? 10) * 60
    }

    func start(intervalMinutes: Int) {
        guard trip == nil else { return }

        switch manager.authorizationStatus {
        case .notDetermined:
            pendingInterval = intervalMinutes
            manager.requestWhenInUseAuthorization()
        case .denied, .restricted:
            lastError = "沒有定位權限，無法記錄軌跡。"
        default:
            do {
                let trip = try store.createRecordingTrip(intervalMinutes: intervalMinutes)
                pointCount = 0
                lastPoint = nil
                lastSampleAt = nil
                begin(trip)
            } catch {
                lastError = "無法建立記錄：\(error.localizedDescription)"
            }
        }
    }

    func recordNow() {
        if trip != nil, !isSampling { beginSample() }
    }

    func stop() async -> Trip? {
        guard let trip else { return nil }

        if manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways {
            if !isSampling { beginSample() }
            await withCheckedContinuation { sampleWaiters.append($0) }
        }

        timer?.invalidate()
        timer = nil
        manager.stopUpdatingLocation()
        manager.allowsBackgroundLocationUpdates = false
        altimeter.stopRelativeAltitudeUpdates()
        session?.invalidate()
        session = nil
        self.trip = nil

        do {
            try store.finish(trip)
            return store.trips.first { $0.id == trip.id }
        } catch {
            lastError = "無法儲存行程：\(error.localizedDescription)"
            return nil
        }
    }

    private func begin(_ trip: Trip) {
        self.trip = trip
        lastError = nil
        UIDevice.current.isBatteryMonitoringEnabled = true

        manager.allowsBackgroundLocationUpdates = true
        manager.showsBackgroundLocationIndicator = true
        manager.desiredAccuracy = Self.idleAccuracy
        session = CLBackgroundActivitySession()
        manager.startUpdatingLocation()

        if CMAltimeter.isRelativeAltitudeAvailable(), [.authorized, .notDetermined].contains(CMAltimeter.authorizationStatus()) {
            altimeter.startRelativeAltitudeUpdates(to: .main) { [weak self] data, _ in
                guard let data else { return }
                let pressure = data.pressure.doubleValue, altitude = data.relativeAltitude.doubleValue
                MainActor.assumeIsolated {
                    self?.pressureKPa = pressure
                    self?.relativeAltitude = altitude
                }
            }
        }

        timer = Timer.scheduledTimer(withTimeInterval: Self.tickInterval, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
        tick()
    }

    private func tick() {
        guard trip != nil else { return }

        if isSampling {
            if Date.now.timeIntervalSince(sampleStartedAt) >= Self.sampleTimeout { finishSample() }
        } else if Date.now >= (lastSampleAt ?? .distantPast).addingTimeInterval(interval) {
            beginSample()
        }
    }

    private func beginSample() {
        isSampling = true
        sampleStartedAt = .now
        lastSampleAt = .now
        bestFix = nil
        manager.desiredAccuracy = Self.sampleAccuracy
    }

    private func received(_ locations: [CLLocation]) {
        location = locations.last

        if isSampling {
            for fix in locations where fix.horizontalAccuracy >= 0
                && -fix.timestamp.timeIntervalSinceNow <= Self.maxFixAge
                && fix.horizontalAccuracy < bestFix?.horizontalAccuracy ?? .infinity {
                bestFix = fix
            }
            if let bestFix, bestFix.horizontalAccuracy <= Self.goodAccuracy {
                finishSample()
                return
            }
        }
        tick()
    }

    private func finishSample() {
        isSampling = false
        manager.desiredAccuracy = Self.idleAccuracy

        guard let trip, let fix = bestFix else {
            lastError = "這次沒有取得定位，下一次會再試。"
            resumeWaiters()
            return
        }

        let battery = UIDevice.current.batteryLevel
        var point = TrackPoint(
            time: fix.timestamp,
            lat: fix.coordinate.latitude,
            lon: fix.coordinate.longitude,
            altitude: fix.verticalAccuracy > 0 ? fix.altitude : nil,
            horizontalAccuracy: fix.horizontalAccuracy,
            verticalAccuracy: fix.verticalAccuracy > 0 ? fix.verticalAccuracy : nil,
            course: fix.course >= 0 ? fix.course : nil,
            speed: fix.speed >= 0 ? fix.speed : nil,
            pressureKPa: pressureKPa,
            relativeAltitude: relativeAltitude,
            battery: battery >= 0 ? Double(battery) : nil
        )

        Task {
            point.steps = await steps(since: trip.startedAt)
            do {
                try store.appendPoint(point, to: trip)
                pointCount += 1
                lastPoint = point
                lastError = nil
            } catch {
                lastError = "無法寫入軌跡：\(error.localizedDescription)"
            }
            resumeWaiters()
        }
    }

    private func resumeWaiters() {
        let waiters = sampleWaiters
        sampleWaiters = []
        waiters.forEach { $0.resume() }
    }

    private func steps(since start: Date) async -> Int? {
        guard CMPedometer.isStepCountingAvailable() else { return nil }
        return await withCheckedContinuation { continuation in
            pedometer.queryPedometerData(from: start, to: .now) { @Sendable data, _ in
                continuation.resume(returning: data?.numberOfSteps.intValue)
            }
        }
    }
}

extension LocationRecorder: @preconcurrency CLLocationManagerDelegate {
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        authorization = manager.authorizationStatus
        isPrecise = manager.accuracyAuthorization == .fullAccuracy

        guard let interval = pendingInterval, authorization != .notDetermined else { return }
        pendingInterval = nil
        start(intervalMinutes: interval)
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        received(locations)
    }
}
