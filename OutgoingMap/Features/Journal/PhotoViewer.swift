import SwiftUI

struct PhotoViewer: View {
    let tripID: UUID
    let placed: [UUID: PlacedPhoto]
    let onClose: (UUID) -> Void

    @Environment(TripStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var current: UUID
    @State private var captions: [UUID: String] = [:]
    @State private var saveError: String?

    init(tripID: UUID, start: UUID, placed: [UUID: PlacedPhoto], onClose: @escaping (UUID) -> Void) {
        self.tripID = tripID
        self.placed = placed
        self.onClose = onClose
        _current = State(initialValue: start)
    }

    private var trip: Trip? { store.trips.first { $0.id == tripID } }

    private var photos: [TripPhoto] {
        (trip?.photos ?? []).sorted { ($0.takenAt ?? .distantFuture) < ($1.takenAt ?? .distantFuture) }
    }

    var body: some View {
        NavigationStack {
            TabView(selection: $current) {
                ForEach(photos) { photo in
                    if let trip {
                        ZoomableImage(url: store.photoURL(photo, in: trip))
                            .tag(photo.id)
                    }
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .background(.black)
            .safeAreaInset(edge: .bottom) {
                if let photo = photos.first(where: { $0.id == current }) {
                    info(photo)
                }
            }
            .navigationTitle(photos.firstIndex { $0.id == current }.map { "\($0 + 1) / \(photos.count)" } ?? "")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("關閉", systemImage: "xmark") { close() }
                }
            }
            .alert("無法儲存", isPresented: Binding(get: { saveError != nil }, set: { if !$0 { saveError = nil } })) {
                Button("好") {}
            } message: {
                Text(saveError ?? "")
            }
        }
        .environment(\.colorScheme, .dark)
        .onChange(of: current) { saveCaptions() }
        .onDisappear { saveCaptions() }
    }

    private func info(_ photo: TripPhoto) -> some View {
        let where_ = placed[photo.id]
        return VStack(alignment: .leading, spacing: 10) {
            TextField("加上一句說明", text: Binding(
                get: { captions[photo.id] ?? photo.caption },
                set: { captions[photo.id] = $0 }
            ))
            .font(.body)
            .submitLabel(.done)
            .onSubmit { saveCaptions() }
            .padding(10)
            .background(.fill.tertiary, in: .rect(cornerRadius: 10))

            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 4) {
                GridRow {
                    Text("拍攝時間").foregroundStyle(.secondary)
                    Text(photo.takenAt.map { "\(Format.day($0)) \(Format.clock($0))" } ?? "—")
                }
                GridRow {
                    Text("海拔").foregroundStyle(.secondary)
                    Text(Format.altitude(where_?.altitude ?? photo.altitude))
                }
                GridRow {
                    Text("座標").foregroundStyle(.secondary)
                    Text((where_?.coordinate ?? photo.coordinate).map(Format.coordinate) ?? "無定位")
                }
            }
            .font(.footnote)
            .monospacedDigit()
        }
        .padding()
        .background(.ultraThinMaterial)
    }

    private func close() {
        saveCaptions()
        onClose(current)
        dismiss()
    }

    private func saveCaptions() {
        guard var trip else { return }
        var changed = false
        for (id, text) in captions {
            guard let i = trip.photos.firstIndex(where: { $0.id == id }), trip.photos[i].caption != text else { continue }
            trip.photos[i].caption = text
            changed = true
        }
        guard changed else { return }
        do { try store.save(trip) } catch { saveError = error.localizedDescription }
    }
}

// ponytail: pinch and double-tap zoom about the centre only, no panning while zoomed; switch to a UIScrollView wrapper if people need to inspect corners.
private struct ZoomableImage: View {
    let url: URL

    @State private var scale = 1.0
    @GestureState private var pinch = 1.0

    var body: some View {
        LocalImage(url: url)
            .scaledToFit()
            .scaleEffect(scale * pinch)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .gesture(
                MagnifyGesture()
                    .updating($pinch) { value, state, _ in state = value.magnification }
                    .onEnded { value in withAnimation(.spring) { scale = min(max(scale * value.magnification, 1), 4) } }
            )
            .onTapGesture(count: 2) { withAnimation(.spring) { scale = scale > 1 ? 1 : 2.5 } }
            .accessibilityLabel("照片")
    }
}
