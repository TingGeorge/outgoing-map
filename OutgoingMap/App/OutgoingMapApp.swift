import SwiftUI

@main
struct OutgoingMapApp: App {
    @State private var store = TripStore()
    @State private var mapData = MapData()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .environment(mapData)
                #if DEBUG
                .task { DebugSeed.runIfRequested(store) }
                #endif
        }
    }
}
