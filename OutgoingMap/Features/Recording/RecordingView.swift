import CoreLocation
import SwiftUI

struct RecordingView: View {
    let onFinished: (Trip) -> Void

    @Environment(LocationRecorder.self) private var recorder
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @AppStorage("intervalMinutes") private var intervalMinutes = 10
    @State private var confirmingStop = false
    @State private var isStopping = false

    var body: some View {
        NavigationStack {
            Group {
                if let trip = recorder.trip {
                    recording(trip)
                } else {
                    setup
                }
            }
            .navigationTitle(recorder.isRecording ? "記錄中" : "記錄軌跡")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if recorder.isRecording {
                        Button("收起", systemImage: "chevron.down") { dismiss() }
                    } else {
                        Button("關閉", systemImage: "xmark") { dismiss() }
                    }
                }
            }
        }
    }

    private var setup: some View {
        Form {
            permissionSection

            Section {
                Label("開始後就可以把手機收進口袋，App 會在背景定時記下你的位置。", systemImage: "iphone.gen3")
                Label("拍照請直接用內建的「相機」App，之後再把照片加進這趟行程。", systemImage: "camera")
                Label("地圖存在手機裡，山上沒有訊號也能看。", systemImage: "wifi.slash")
            }

            intervalSection

            if let error = recorder.lastError {
                Section { Text(error).foregroundStyle(.red) }
            }
        }
        .safeAreaInset(edge: .bottom) {
            Button {
                recorder.start(intervalMinutes: intervalMinutes)
            } label: {
                Label("開始記錄", systemImage: "record.circle")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(isLocationBlocked)
            .padding()
            .background(.bar)
        }
    }

    private func recording(_ trip: Trip) -> some View {
        VStack(spacing: 0) {
            mapArea

            Form {
                permissionSection

                Section {
                    LabeledContent("經過時間") {
                        Text(trip.startedAt, style: .timer).monospacedDigit()
                    }
                    LabeledContent("已記錄點數") {
                        Text("\(recorder.pointCount)").monospacedDigit()
                    }
                    LabeledContent("最後一點", value: Format.clock(recorder.lastPoint?.time))
                    LabeledContent("目前海拔", value: Format.altitude(currentAltitude))
                } footer: {
                    if let error = recorder.lastError {
                        Text(error).foregroundStyle(.red)
                    }
                }

                intervalSection

                Section {
                    Button {
                        recorder.recordNow()
                    } label: {
                        if recorder.isSampling {
                            HStack {
                                ProgressView()
                                Text("正在定位…")
                            }
                        } else {
                            Label("立即記錄一點", systemImage: "mappin.and.ellipse")
                        }
                    }
                    .disabled(recorder.isSampling || isStopping)
                }

                Section {
                    Button("結束記錄", role: .destructive) { confirmingStop = true }
                        .disabled(isStopping)
                }
            }
        }
        .confirmationDialog("要結束這次記錄嗎？", isPresented: $confirmingStop, titleVisibility: .visible) {
            Button("結束記錄", role: .destructive) {
                isStopping = true
                Task {
                    let finished = await recorder.stop()
                    isStopping = false
                    if let finished { onFinished(finished) }
                }
            }
        } message: {
            Text("會再記錄最後一點，然後儲存這趟行程。")
        }
    }

    private var mapArea: some View {
        TileMapView(showsUserLocation: true)
            .frame(height: 260)
    }

    private var intervalSection: some View {
        Section {
            Picker("記錄間隔", selection: $intervalMinutes) {
                ForEach([5, 10, 15], id: \.self) { Text("\($0) 分鐘") }
            }
            .pickerStyle(.segmented)
        } header: {
            Text("記錄間隔")
        } footer: {
            Text(recorder.isRecording ? "更改後從下一點開始生效。間隔越長越省電。" : "間隔越長越省電，10 分鐘適合大多數行程。")
        }
    }

    @ViewBuilder private var permissionSection: some View {
        if isLocationBlocked {
            Section {
                Label {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("無法取得定位").font(.headline)
                        Text(recorder.authorization == .restricted
                             ? "這台裝置限制了定位服務，請確認螢幕使用時間或裝置管理設定。"
                             : "需要定位權限才能記錄健行軌跡。請在設定中把「位置」改為「使用 App 期間」。")
                    }
                } icon: {
                    Image(systemName: "location.slash.fill").foregroundStyle(.red)
                }
                if recorder.authorization == .denied {
                    Button("打開設定", action: openSettings)
                }
            }
        } else if isAuthorized && !recorder.isPrecise {
            Section {
                Label {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("請開啟精確位置").font(.headline)
                        Text("目前只能取得大概位置，誤差可能有好幾公里，軌跡會畫不出來。請在設定的「位置」中開啟「精確位置」。")
                    }
                } icon: {
                    Image(systemName: "location.circle").foregroundStyle(.orange)
                }
                Button("打開設定", action: openSettings)
            }
        }
    }

    private var isLocationBlocked: Bool {
        recorder.authorization == .denied || recorder.authorization == .restricted
    }

    private var isAuthorized: Bool {
        recorder.authorization == .authorizedWhenInUse || recorder.authorization == .authorizedAlways
    }

    private var currentAltitude: Double? {
        if let location = recorder.location, location.verticalAccuracy > 0 { return location.altitude }
        return recorder.lastPoint?.altitude
    }

    private func openSettings() {
        if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
    }
}
