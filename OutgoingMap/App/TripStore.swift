import Foundation
import Observation

@Observable @MainActor final class TripStore {
    private(set) var trips: [Trip] = []

    let documents: URL
    var tripsDirectory: URL { documents.appending(path: "Trips") }
    var trashDirectory: URL { documents.appending(path: "Trash") }

    init(documents: URL = .documentsDirectory) {
        self.documents = documents
        load()
    }

    var activeRecording: Trip? {
        trips.first { $0.state == .recording }
    }

    func load() {
        let folders = (try? FileManager.default.contentsOfDirectory(at: tripsDirectory, includingPropertiesForKeys: nil)) ?? []
        let decoder = JSONCoding.decoder()
        trips = folders
            .compactMap { try? Data(contentsOf: $0.appending(path: "trip.json")) }
            .compactMap { try? decoder.decode(Trip.self, from: $0) }
            .sorted { $0.startedAt > $1.startedAt }
    }

    @discardableResult
    func createRecordingTrip(intervalMinutes: Int) throws -> Trip {
        let now = Date.now
        let title = "健行 " + now.formatted(.dateTime.year().month().day().locale(Locale(identifier: "zh_Hant_TW")))
        let trip = Trip(title: title, startedAt: now, intervalMinutes: intervalMinutes, state: .recording)
        try save(trip)
        return trip
    }

    func appendPoint(_ point: TrackPoint, to trip: Trip) throws {
        try FileManager.default.createDirectory(at: folder(for: trip), withIntermediateDirectories: true)
        try TrackFile(url: folder(for: trip).appending(path: "track.jsonl")).append(point)
    }

    func finish(_ trip: Trip) throws {
        var trip = trip
        trip.state = .finished
        trip.endedAt = track(for: trip).last?.time ?? .now
        try save(trip)
    }

    func save(_ trip: Trip) throws {
        let folder = folder(for: trip)
        try FileManager.default.createDirectory(at: folder.appending(path: "photos"), withIntermediateDirectories: true)
        try JSONCoding.encoder().encode(trip).write(to: folder.appending(path: "trip.json"), options: .atomic)

        if let i = trips.firstIndex(where: { $0.id == trip.id }) {
            trips[i] = trip
        } else {
            trips.append(trip)
        }
        trips.sort { $0.startedAt > $1.startedAt }
    }

    func delete(_ trip: Trip) throws {
        try FileManager.default.createDirectory(at: trashDirectory, withIntermediateDirectories: true)
        let stamp = Int(Date.now.timeIntervalSince1970)
        let source = folder(for: trip)
        if FileManager.default.fileExists(atPath: source.path) {
            try FileManager.default.moveItem(at: source, to: trashDirectory.appending(path: "\(trip.id.uuidString)-\(stamp)"))
        }
        trips.removeAll { $0.id == trip.id }
    }

    func track(for trip: Trip) -> [TrackPoint] {
        (try? TrackFile(url: folder(for: trip).appending(path: "track.jsonl")).readAll()) ?? []
    }

    func gpx(for trip: Trip) -> [TrackPoint] {
        (try? TrackFile(url: folder(for: trip).appending(path: "gpx.jsonl")).readAll()) ?? []
    }

    func setGPX(_ points: [TrackPoint], for trip: Trip) throws {
        try FileManager.default.createDirectory(at: folder(for: trip), withIntermediateDirectories: true)
        try TrackFile(url: folder(for: trip).appending(path: "gpx.jsonl")).write(points)
    }

    func photoURL(_ photo: TripPhoto, in trip: Trip) -> URL {
        folder(for: trip).appending(path: "photos/\(photo.id.uuidString).jpg")
    }

    func thumbURL(_ photo: TripPhoto, in trip: Trip) -> URL {
        folder(for: trip).appending(path: "photos/\(photo.id.uuidString)_thumb.jpg")
    }

    func folder(for trip: Trip) -> URL {
        tripsDirectory.appending(path: trip.id.uuidString)
    }
}
