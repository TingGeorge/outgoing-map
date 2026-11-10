import SwiftUI

struct RootView: View {
    @Environment(TripStore.self) private var store
    @State private var path: [UUID] = []
    @State private var recording = false
    @State private var launched = false

    var body: some View {
        NavigationStack(path: $path) {
            TripListView(path: $path, recording: $recording)
                .navigationDestination(for: UUID.self) { Destinations.journal(tripID: $0) }
        }
        .fullScreenCover(isPresented: $recording) {
            Destinations.recording { trip in
                recording = false
                path.append(trip.id)
            }
        }
        .task {
            guard !launched else { return }
            launched = true
            if store.activeRecording != nil { recording = true }
        }
    }
}
