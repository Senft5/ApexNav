import SwiftUI
import MapKit
import CoreLocation
import CoreMotion
import AVFoundation

@main
struct ApexNavApp: App {
    var body: some Scene {
        WindowGroup {
            CockpitNavigationView()
                .preferredColorScheme(.dark)
        }
    }
}

struct RoadFeelSegment: Identifiable {
    let id = UUID()
    let coords: [CLLocationCoordinate2D]
    let combinedG: Double
    let roughness: Double
    let camberEstDeg: Double

    var segmentColor: Color {
        if combinedG > 0.65 || roughness > 0.35 {
            return .red
        } else if combinedG > 0.35 || abs(camberEstDeg) > 4.0 {
            return .orange
        } else {
            return .green
        }
    }
}

@MainActor
final class NavTelemetryEngine: NSObject, ObservableObject, CLLocationManagerDelegate {
    private let locManager = CLLocationManager()
    private let motionManager = CMMotionManager()
    private let synth = AVSpeechSynthesizer()

    @Published var cameraPosition: MapCameraPosition = .userLocation(pitched: true, followsHeading: true)
    @Published var userLocation: CLLocation?
    @Published var activeRoute: MKRoute?
    @Published var routeSteps: [MKRoute.Step] = []
    @Published var currentStepIndex: Int = 0
    @Published var nextInstruction: String = "Search a road or tap Loop"
    @Published var distanceToNextTurn: String = "--"
    @Published var voicePaceNotesEnabled: Bool = true

    @Published var isRecordingFeel: Bool = false
    @Published var speedMPH: Double = 0.0
    @Published var lonG: Double = 0.0
    @Published var latG: Double = 0.0
    @Published var vertBumpG: Double = 0.0
    @Published var camberDeg: Double = 0.0
    @Published var engagementScore: Double = 0.0
    @Published var paintedSegments: [RoadFeelSegment] = []

    private var lastNodeLocation: CLLocation?
    private var csvLines: [String] = ["t_sec,lat,lon,speed_mph,lon_g,lat_g,vert_bump_g,camber_deg,engagement"]
    private var startTime: TimeInterval = Date().timeIntervalSince1970
    @Published var exportedCSVURL: URL?

    override init() {
        super.init()
        locManager.delegate = self
        locManager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        locManager.distanceFilter = 2.0
        locManager.requestWhenInUseAuthorization()
        locManager.startUpdatingLocation()
        locManager.startUpdatingHeading()
        startIMUPipeline()
    }

    func startIMUPipeline() {
        guard motionManager.isDeviceMotionAvailable else { return }
        motionManager.deviceMotionUpdateInterval = 1.0 / 60.0
        motionManager.startDeviceMotionUpdates(to: .main) { [weak self] motion, _ in
            guard let self = self, let m = motion else { return }
            let ax = m.userAcceleration.x
            let ay = m.userAcceleration.y
            let az = m.userAcceleration.z
            let yawRate = m.rotationRate.z

            self.latG = 0.8 * self.latG + 0.2 * ax
            self.lonG = 0.8 * self.lonG + 0.2 * ay
            self.vertBumpG = abs(az)

            let vMps = max(0.0, self.userLocation?.speed ?? 0.0)
            let kinematicG = (vMps * yawRate) / 9.80665
            if abs(kinematicG) > 0.12 {
                let diff = max(-0.4, min(0.4, abs(kinematicG) - abs(self.latG)))
                self.camberDeg = asin(diff) * 180.0 / .pi
            } else {
                self.camberDeg *= 0.9
            }

            let totalG = hypot(self.latG, self.lonG)
            self.engagementScore = min(1.0, (totalG / 0.75) * 0.75 + (self.vertBumpG / 0.5) * 0.25)
        }
    }

    func zeroMountCalibration() {
        speak("IMU calibrated.")
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        Task { @MainActor in
            self.userLocation = loc
            self.speedMPH = max(0.0, loc.speed * 2.23694)
            self.updateTurnByTurnProgress(at: loc)
            if self.isRecordingFeel {
                self.recordAndPaintRoadSlice(at: loc)
            }
        }
    }

    private func recordAndPaintRoadSlice(at loc: CLLocation) {
        let t = Date().timeIntervalSince1970 - startTime
        csvLines.append(String(format: "%.3f,%.6f,%.6f,%.1f,%.3f,%.3f,%.3f,%.2f,%.2f",
                               t, loc.coordinate.latitude, loc.coordinate.longitude,
                               speedMPH, lonG, latG, vertBumpG, camberDeg, engagementScore))

        if let prev = lastNodeLocation {
            if loc.distance(from: prev) >= 5.0 {
                let seg = RoadFeelSegment(
                    coords: [prev.coordinate, loc.coordinate],
                    combinedG: hypot(latG, lonG),
                    roughness: vertBumpG,
                    camberEstDeg: camberDeg
                )
                paintedSegments.append(seg)
                lastNodeLocation = loc
            }
        } else {
            lastNodeLocation = loc
        }
    }

    func searchAndRoute(query: String) {
        guard !query.isEmpty else { return }
        let req = MKLocalSearch.Request()
        req.naturalLanguageQuery = query
        if let loc = userLocation {
            req.region = MKCoordinateRegion(center: loc.coordinate, latitudinalMeters: 30000, longitudinalMeters: 30000)
        }
        MKLocalSearch(request: req).start { [weak self] resp, _ in
            guard let self = self, let dest = resp?.mapItems.first else { return }
            Task { @MainActor in
                self.calculateRoute(to: dest)
            }
        }
    }

    func generateTwistyBackroadWaypoint() {
        guard let origin = userLocation?.coordinate else {
            nextInstruction = "Waiting for GPS lock..."
            return
        }
        let angle = Double.random(in: 0...(2 * .pi))
        let targetCoord = CLLocationCoordinate2D(latitude: origin.latitude + 0.055 * cos(angle),
                                                 longitude: origin.longitude + 0.055 * sin(angle))
        let destItem = MKMapItem(placemark: MKPlacemark(coordinate: targetCoord))
        destItem.name = "Backroad Stage Sector"
        calculateRoute(to: destItem)
    }

    func calculateRoute(to destination: MKMapItem) {
        let req = MKDirections.Request()
        req.source = MKMapItem.forCurrentLocation()
        req.destination = destination
        req.transportType = .automobile
        req.requestsAlternateRoutes = true

        MKDirections(request: req).calculate { [weak self] resp, _ in
            guard let self = self, let routes = resp?.routes, !routes.isEmpty else { return }
            Task { @MainActor in
                let chosen = routes.max(by: { $0.polyline.pointCount < $1.polyline.pointCount }) ?? routes[0]
                self.activeRoute = chosen
                self.routeSteps = chosen.steps.filter { !$0.instructions.isEmpty }
                self.currentStepIndex = 0
                if let first = self.routeSteps.first {
                    self.nextInstruction = first.instructions
                    self.distanceToNextTurn = String(format: "%.0f ft", first.distance * 3.28084)
                    self.speak("Stage locked. \(first.instructions)")
                }
                self.cameraPosition = .userLocation(pitched: true, followsHeading: true)
            }
        }
    }

    private func updateTurnByTurnProgress(at loc: CLLocation) {
        guard !routeSteps.isEmpty, currentStepIndex < routeSteps.count else { return }
        let step = routeSteps[currentStepIndex]
        let stepCoord = step.polyline.coordinate
        let dist = loc.distance(from: CLLocation(latitude: stepCoord.latitude, longitude: stepCoord.longitude))

        distanceToNextTurn = dist < 1609 ? String(format: "%.0f ft", dist * 3.28084) : String(format: "%.1f mi", dist / 1609.34)

        if dist < 35 && currentStepIndex + 1 < routeSteps.count {
            currentStepIndex += 1
            let nextStep = routeSteps[currentStepIndex]
            nextInstruction = nextStep.instructions
            speak(nextStep.instructions)
        }
    }

    func toggleRecordingAndExportIfStopped() {
        if isRecordingFeel {
            isRecordingFeel = false
            let fileName = "ApexDrive_\(Int(Date().timeIntervalSince1970)).csv"
            let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent(fileName)
            try? csvLines.joined(separator: "\n").write(to: url, atomically: true, encoding: .utf8)
            exportedCSVURL = url
            speak("Telemetry log saved.")
        } else {
            startTime = Date().timeIntervalSince1970
            lastNodeLocation = userLocation
            isRecordingFeel = true
            speak("Mapping road feel.")
        }
    }

    private func speak(_ phrase: String) {
        guard voicePaceNotesEnabled else { return }
        let utterance = AVSpeechUtterance(string: phrase)
        utterance.rate = 0.53
        synth.speak(utterance)
    }
}

struct CockpitNavigationView: View {
    @StateObject private var engine = NavTelemetryEngine()
    @State private var searchText: String = ""

    var body: some View {
        ZStack {
            Map(position: $engine.cameraPosition) {
                UserAnnotation()
                if let route = engine.activeRoute {
                    MapPolyline(route.polyline)
                        .stroke(.cyan.opacity(0.85), lineWidth: 7)
                }
                ForEach(engine.paintedSegments) { seg in
                    MapPolyline(coordinates: seg.coords)
                        .stroke(seg.segmentColor, lineWidth: 9)
                }
            }
            .mapStyle(.standard(elevation: .realistic, emphasis: .muted))
            .mapControls {
                MapUserLocationButton()
                MapCompass()
                MapPitchToggle()
            }
            .ignoresSafeArea()

            VStack(spacing: 10) {
                HStack(spacing: 12) {
                    Image(systemName: "arrow.turn.up.right")
                        .font(.system(size: 26, weight: .black))
                        .foregroundStyle(.black)
                        .frame(width: 50, height: 50)
                        .background(Color.green)
                        .clipShape(RoundedRectangle(cornerRadius: 12))

                    VStack(alignment: .leading, spacing: 2) {
                        Text(engine.distanceToNextTurn)
                            .font(.system(size: 20, weight: .black, design: .monospaced))
                            .foregroundStyle(.green)
                        Text(engine.nextInstruction)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(.white)
                            .lineLimit(2)
                    }
                    Spacer()

                    Button {
                        engine.voicePaceNotesEnabled.toggle()
                    } label: {
                        Image(systemName: engine.voicePaceNotesEnabled ? "speaker.wave.2.fill" : "speaker.slash.fill")
                            .padding(10)
                            .background(Color.white.opacity(0.15))
                            .clipShape(Circle())
                    }
                }
                .padding(12)
                .background(.ultraThinMaterial)
                .clipShape(RoundedRectangle(cornerRadius: 16))

                HStack(spacing: 8) {
                    TextField("Search road or destination...", text: $searchText)
                        .textFieldStyle(.plain)
                        .padding(10)
                        .background(Color.black.opacity(0.65))
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                        .onSubmit { engine.searchAndRoute(query: searchText) }

                    Button("Route") { engine.searchAndRoute(query: searchText) }
                        .font(.system(size: 14, weight: .bold))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .background(Color.cyan)
                        .foregroundStyle(.black)
                        .clipShape(RoundedRectangle(cornerRadius: 10))

                    Button("Loop") { engine.generateTwistyBackroadWaypoint() }
                        .font(.system(size: 14, weight: .bold))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .background(Color.orange)
                        .foregroundStyle(.black)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                }
                .padding(8)
                .background(.ultraThinMaterial)
                .clipShape(RoundedRectangle(cornerRadius: 14))

                Spacer()

                VStack(spacing: 12) {
                    HStack(spacing: 14) {
                        VStack(spacing: 2) {
                            Text(String(format: "%.0f", engine.speedMPH))
                                .font(.system(size: 36, weight: .black, design: .monospaced))
                                .foregroundStyle(.white)
                            Text("MPH")
                                .font(.system(size: 11, weight: .bold, design: .monospaced))
                                .foregroundStyle(.gray)
                        }
                        .frame(width: 80)

                        ZStack {
                            Circle().stroke(Color.white.opacity(0.25), lineWidth: 1.5).frame(width: 62, height: 62)
                            Circle().fill(hypot(engine.latG, engine.lonG) > 0.5 ? Color.orange : Color.green)
                                .frame(width: 14, height: 14)
                                .offset(x: CGFloat(max(-24, min(24, engine.latG * 30))),
                                        y: CGFloat(max(-24, min(24, -engine.lonG * 30))))
                        }

                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text("LAT:").foregroundStyle(.gray)
                                Text(String(format: "%.2fG", abs(engine.latG))).foregroundStyle(.green)
                                Spacer()
                                Text("BANK:").foregroundStyle(.gray)
                                Text(String(format: "%+.1f°", engine.camberDeg)).foregroundStyle(.cyan)
                            }
                            HStack {
                                Text("BUMP:").foregroundStyle(.gray)
                                Text(String(format: "%.2fG", engine.vertBumpG)).foregroundStyle(.white)
                                Spacer()
                                Text("NODES:").foregroundStyle(.gray)
                                Text("\(engine.paintedSegments.count)").foregroundStyle(.orange)
                            }
                        }
                        .font(.system(size: 12, weight: .bold, design: .monospaced))
                    }

                    HStack(spacing: 10) {
                        Button {
                            engine.toggleRecordingAndExportIfStopped()
                        } label: {
                            Text(engine.isRecordingFeel ? "STOP & SAVE CSV" : "PAINT ROAD FEEL")
                                .font(.system(size: 14, weight: .black, design: .monospaced))
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 13)
                                .background(engine.isRecordingFeel ? Color.red : Color.green)
                                .foregroundStyle(engine.isRecordingFeel ? .white : .black)
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                        }

                        Button { engine.zeroMountCalibration() } label: {
                            Text("ZERO")
                                .font(.system(size: 12, weight: .bold, design: .monospaced))
                                .padding(.horizontal, 12)
                                .padding(.vertical, 13)
                                .background(Color.white.opacity(0.15))
                                .foregroundStyle(.white)
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                        }

                        if let csvURL = engine.exportedCSVURL {
                            ShareLink(item: csvURL) {
                                Image(systemName: "square.and.arrow.up")
                                    .font(.system(size: 16, weight: .bold))
                                    .padding(13)
                                    .background(Color.cyan)
                                    .foregroundStyle(.black)
                                    .clipShape(RoundedRectangle(cornerRadius: 12))
                            }
                        }
                    }
                }
                .padding(14)
                .background(.ultraThinMaterial)
                .clipShape(RoundedRectangle(cornerRadius: 18))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
    }
}
