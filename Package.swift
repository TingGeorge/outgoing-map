// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "OutgoingMapCore",
    platforms: [.iOS(.v18), .macOS(.v15)],
    products: [
        .library(name: "OutgoingMapCore", targets: ["OutgoingMapCore"]),
    ],
    targets: [
        .target(name: "OutgoingMapCore", path: "OutgoingMap/Core"),
        .testTarget(name: "CoreTests", dependencies: ["OutgoingMapCore"], path: "Tests/CoreTests"),
    ]
)
