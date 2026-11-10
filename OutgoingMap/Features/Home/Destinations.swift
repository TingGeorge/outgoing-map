import SwiftUI

enum Destinations {
    @ViewBuilder static func journal(tripID: UUID) -> some View {
        JournalView(tripID: tripID)
    }

    @ViewBuilder static func recording(onFinished: @escaping (Trip) -> Void) -> some View {
        RecordingView(onFinished: onFinished)
    }
}
