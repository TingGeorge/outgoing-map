import SwiftUI

enum Destinations {
    @ViewBuilder static func journal(tripID: UUID) -> some View {
        PlaceholderScreen(title: "旅程", symbol: "book.pages", detail: "旅程畫面建置中。", tripID: tripID)
    }

    @ViewBuilder static func recording(onFinished: @escaping (Trip) -> Void) -> some View {
        RecordingView(onFinished: onFinished)
    }
}

private struct PlaceholderScreen: View {
    let title: String
    let symbol: String
    let detail: String
    let tripID: UUID?
    var closes = false

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ContentUnavailableView(title, systemImage: symbol, description: Text(detail))
            .overlay(alignment: .bottom) {
                if closes {
                    Button("關閉") { dismiss() }
                        .buttonStyle(.borderedProminent)
                        .padding()
                }
            }
    }
}
