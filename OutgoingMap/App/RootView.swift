import SwiftUI

struct RootView: View {
    var body: some View {
        NavigationStack {
            ContentUnavailableView(
                "建置中",
                systemImage: "mountain.2",
                description: Text("登山回憶正在施工，功能即將上線。")
            )
            .navigationTitle("登山回憶")
        }
    }
}

#Preview {
    RootView()
}
