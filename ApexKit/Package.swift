// swift-tools-version:5.9
// ApexKit: the phone's live sensor math, free of UIKit/CoreMotion so it compiles and is
// tested on Linux and macOS. Specification: core/live_pipeline.py (see Tests/Fixtures).
import PackageDescription

let package = Package(
    name: "ApexKit",
    platforms: [.iOS(.v17), .macOS(.v13)],
    products: [.library(name: "ApexKit", targets: ["ApexKit"])],
    targets: [
        .target(name: "ApexKit"),
        .testTarget(name: "ApexKitTests", dependencies: ["ApexKit"])
    ]
)
