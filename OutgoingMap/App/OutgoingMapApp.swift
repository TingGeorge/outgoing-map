import SwiftUI

@main
struct OutgoingMapApp: App {
    @State private var store: TripStore
    @State private var mapData = MapData()
    @State private var recorder: LocationRecorder

    init() {
        let store = TripStore()
        _store = State(initialValue: store)
        _recorder = State(initialValue: LocationRecorder(store: store))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .environment(mapData)
                .environment(recorder)
                #if DEBUG
                .task { DebugSeed.runIfRequested(store) }
                #endif
        }
    }
}
