import SwiftUI
import MapKit
import WebKit
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

enum ColorMetricMode: String, CaseIterable {
    case feel = "FEEL & G"
    case elevation = "3D ELEV"
    case grade = "GRADE %"
    case camber = "BANK φ"
    case roughness = "ROUGH"
}

struct RoadFeelSegment: Identifiable {
    let id = UUID()
    let index: Int
    let distanceM: Double
    let lat: Double
    let lon: Double
    let elevationM: Double
    let gradePct: Double
    let speedMPH: Double
    let lonG: Double
    let latG: Double
    let camberDeg: Double
    let crestG: Double
    let roughnessRMS: Double
    let engagement: Double

    var combinedG: Double { hypot(lonG, latG) }

    func hexColor(mode: ColorMetricMode) -> String {
        switch mode {
        case .elevation:
            let norm = max(0.0, min(1.0, (elevationM - 92.5) / (215.5 - 92.5)))
            if norm > 0.75 { return "#ff2a54" }
            if norm > 0.50 { return "#ff9100" }
            if norm > 0.25 { return "#00e5ff" }
            return "#00f57a"
        case .grade:
            let g = abs(gradePct)
            if g > 6.0 { return "#ff2a54" }
            if g > 3.0 { return "#ff9100" }
            return "#00e5ff"
        case .camber:
            let c = abs(camberDeg)
            if c > 4.0 { return "#00e5ff" }
            if c > 2.0 { return "#b388ff" }
            return "#00f57a"
        case .roughness:
            if roughnessRMS > 0.12 { return "#ff2a54" }
            if roughnessRMS > 0.06 { return "#ff9100" }
            return "#00f57a"
        case .feel:
            if combinedG > 0.32 || roughnessRMS > 0.14 { return "#ff2a54" }
            if combinedG > 0.18 || abs(camberDeg) > 2.5 { return "#ff9100" }
            return "#00f57a"
        }
    }
}

@MainActor
final class NavTelemetryEngine: NSObject, ObservableObject, CLLocationManagerDelegate {
    private let locManager = CLLocationManager()
    private let motionManager = CMMotionManager()
    private let altimeter = CMAltimeter()
    private let synth = AVSpeechSynthesizer()

    @Published var userLocation: CLLocation?
    @Published var nextInstruction: String = "PEBBLE RIDGE 3D STAGE LOADED"
    @Published var distanceToNextTurn: String = "28.5 KM"
    @Published var voicePaceNotesEnabled: Bool = true
    @Published var colorMode: ColorMetricMode = .feel
    @Published var use3DTerrainWebEngine: Bool = true

    // Live vs Replay State
    @Published var isReplayingLog: Bool = false
    @Published var replayIndex: Int = 120
    @Published var replaySpeedMultiplier: Int = 2
    @Published var isRecordingFeel: Bool = false
    @Published var flyOverviewTrigger: Int = 0

    // Telemetry Readouts
    @Published var speedMPH: Double = 0.0
    @Published var elevationM: Double = 205.9
    @Published var gradePct: Double = 0.0
    @Published var lonG: Double = 0.0
    @Published var latG: Double = 0.0
    @Published var peakG: Double = 0.0
    @Published var vertBumpG: Double = 0.0
    @Published var crestG: Double = 0.0
    @Published var camberDeg: Double = 0.0
    @Published var engagementScore: Double = 0.0
    @Published var currentLat: Double = 39.258576
    @Published var currentLon: Double = -84.614591
    @Published var currentBearing: Double = -35.0

    // G-Meter Historical Comet Trail
    @Published var gTrail: [(Double, Double)] = []

    // Loaded Pebble Ridge 5m 3D Profile + Live Painted Segments
    @Published var pebbleSegments: [RoadFeelSegment] = []
    @Published var liveSegments: [RoadFeelSegment] = []
    @Published var rawJSONString: String = "[]"

    private var baseGPSAltitude: Double?
    private var relativeBaroM: Double = 0.0
    private var lastNodeLocation: CLLocation?
    private var lastNodeElevationM: Double?
    private var totalDistanceM: Double = 0.0
    private var replayTimer: Timer?
    private var csvLines: [String] = ["segment_index,distance_m,lat,lon,elevation_m,grade_pct,speed_mph,lon_g,lat_g,camber_deg,crest_vertical_g,roughness_rms,engagement_score"]
    @Published var exportedCSVURL: URL?

    // 3x3 SO(3) Mount-to-Vehicle Rotation Matrix rows (Solved from Pebble Ridge iPhone 15 Pro log by default)
    private var rX: (Double, Double, Double) = (0.1159, 0.2998, -0.9469)
    private var rY: (Double, Double, Double) = (-0.9927, 0.0029, -0.1206)
    private var rZ: (Double, Double, Double) = (-0.0334, 0.9540, 0.2980)
    private var latestGravity: (Double, Double, Double) = (0.0, -0.95, -0.30)
    private var awaitingForwardPullLock: Bool = false
    @Published var mountStatusText: String = "SO(3) LOCKED"

    override init() {
        super.init()
        loadBundledPebbleRidgeDrive()
        locManager.delegate = self
        locManager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        locManager.distanceFilter = 2.0
        locManager.requestWhenInUseAuthorization()
        locManager.startUpdatingLocation()
        locManager.startUpdatingHeading()
        startIMUPipeline()
        startReplayTimer()
    }

    private func loadBundledPebbleRidgeDrive() {
        guard let url = Bundle.main.url(forResource: "pebble_ridge_3d", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let str = String(data: data, encoding: .utf8),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [[Double]] else {
            return
        }
        self.rawJSONString = str
        var loaded: [RoadFeelSegment] = []
        loaded.reserveCapacity(arr.count)
        for (idx, r) in arr.enumerated() where r.count >= 12 {
            loaded.append(RoadFeelSegment(
                index: idx,
                distanceM: r[0],
                lat: r[1],
                lon: r[2],
                elevationM: r[3],
                gradePct: r[4],
                speedMPH: r[5],
                lonG: r[6],
                latG: r[7],
                camberDeg: r[8],
                crestG: r[9],
                roughnessRMS: r[10],
                engagement: r[11]
            ))
        }
        self.pebbleSegments = loaded
        if loaded.count > 120 {
            applySegmentToHUD(loaded[120], nextSeg: loaded[123])
        }
    }

    private func startReplayTimer() {
        replayTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self = self, self.isReplayingLog, self.pebbleSegments.count > 5 else { return }
                self.replayIndex = (self.replayIndex + self.replaySpeedMultiplier) % (self.pebbleSegments.count - 4)
                let seg = self.pebbleSegments[self.replayIndex]
                let nextSeg = self.pebbleSegments[min(self.pebbleSegments.count - 1, self.replayIndex + 3)]
                self.applySegmentToHUD(seg, nextSeg: nextSeg)
            }
        }
    }

    func scrubToFraction(_ frac: Double) {
        guard !pebbleSegments.isEmpty else { return }
        let idx = max(0, min(pebbleSegments.count - 2, Int(frac * Double(pebbleSegments.count - 2))))
        replayIndex = idx
        let seg = pebbleSegments[idx]
        let nextSeg = pebbleSegments[min(pebbleSegments.count - 1, idx + 2)]
        applySegmentToHUD(seg, nextSeg: nextSeg)
    }

    private func applySegmentToHUD(_ seg: RoadFeelSegment, nextSeg: RoadFeelSegment) {
        currentLat = seg.lat
        currentLon = seg.lon
        currentBearing = Self.bearingBetween(lat1: seg.lat, lon1: seg.lon, lat2: nextSeg.lat, lon2: nextSeg.lon)
        speedMPH = seg.speedMPH
        elevationM = seg.elevationM
        gradePct = seg.gradePct
        lonG = seg.lonG
        latG = seg.latG
        camberDeg = seg.camberDeg
        crestG = seg.crestG
        vertBumpG = seg.roughnessRMS
        engagementScore = seg.engagement
        peakG = max(peakG, seg.combinedG)
        appendGTrail(latG: seg.latG, lonG: seg.lonG)

        distanceToNextTurn = String(format: "%.1f KM", seg.distanceM / 1000.0)
        nextInstruction = String(format: "ELEV %.0fm • GRADE %+.1f%% • BANK %+.1f°", seg.elevationM, seg.gradePct, seg.camberDeg)
    }

    private func appendGTrail(latG: Double, lonG: Double) {
        gTrail.append((latG, lonG))
        if gTrail.count > 40 {
            gTrail.removeFirst(gTrail.count - 40)
        }
    }

    static func bearingBetween(lat1: Double, lon1: Double, lat2: Double, lon2: Double) -> Double {
        let dLon = (lon2 - lon1) * .pi / 180.0
        let p1 = lat1 * .pi / 180.0
        let p2 = lat2 * .pi / 180.0
        let y = sin(dLon) * cos(p2)
        let x = cos(p1) * sin(p2) - sin(p1) * cos(p2) * cos(dLon)
        let brg = atan2(y, x) * 180.0 / .pi
        return (brg + 360.0).truncatingRemainder(dividingBy: 360.0)
    }

    private func dot3(_ a: (Double, Double, Double), _ b: (Double, Double, Double)) -> Double {
        a.0 * b.0 + a.1 * b.1 + a.2 * b.2
    }

    private func cross3(_ a: (Double, Double, Double), _ b: (Double, Double, Double)) -> (Double, Double, Double) {
        (a.1 * b.2 - a.2 * b.1, a.2 * b.0 - a.0 * b.2, a.0 * b.1 - a.1 * b.0)
    }

    private func norm3(_ v: (Double, Double, Double)) -> (Double, Double, Double) {
        let mag = sqrt(max(1e-9, dot3(v, v)))
        return (v.0 / mag, v.1 / mag, v.2 / mag)
    }

    func startIMUPipeline() {
        if CMAltimeter.isRelativeAltitudeAvailable() {
            altimeter.startRelativeAltitudeUpdates(to: .main) { [weak self] data, _ in
                guard let self = self, let d = data else { return }
                self.relativeBaroM = d.relativeAltitude.doubleValue
            }
        }
        guard motionManager.isDeviceMotionAvailable else { return }
        motionManager.deviceMotionUpdateInterval = 1.0 / 60.0
        motionManager.startDeviceMotionUpdates(to: .main) { [weak self] motion, _ in
            guard let self = self, let m = motion, !self.isReplayingLog else { return }
            self.latestGravity = (m.gravity.x, m.gravity.y, m.gravity.z)
            let rawA = (-m.userAcceleration.x, -m.userAcceleration.y, -m.userAcceleration.z)
            let rawW = (m.rotationRate.x, m.rotationRate.y, m.rotationRate.z)

            if self.awaitingForwardPullLock {
                let pullMag = sqrt(self.dot3(rawA, rawA))
                let gyroMag = sqrt(self.dot3(rawW, rawW))
                if pullMag > 0.12 && gyroMag < 0.15 {
                    let dotZ = self.dot3(rawA, self.rZ)
                    let projX = (rawA.0 - dotZ * self.rZ.0, rawA.1 - dotZ * self.rZ.1, rawA.2 - dotZ * self.rZ.2)
                    self.rX = self.norm3(projX)
                    self.rY = self.norm3(self.cross3(self.rZ, self.rX))
                    self.awaitingForwardPullLock = false
                    self.mountStatusText = "SO(3) LOCKED"
                    self.speak("Forward axis locked.")
                }
            }

            let axVeh = self.dot3(self.rX, rawA)
            let ayVeh = self.dot3(self.rY, rawA)
            let azVeh = self.dot3(self.rZ, rawA)
            let yawRate = self.dot3(self.rZ, rawW)

            self.lonG = 0.82 * self.lonG + 0.18 * axVeh
            self.latG = 0.82 * self.latG + 0.18 * ayVeh
            self.crestG = 0.92 * self.crestG + 0.08 * azVeh
            self.vertBumpG = abs(azVeh - self.crestG)

            let vMps = max(0.0, self.userLocation?.speed ?? 0.0)
            let kinematicG = (vMps * yawRate) / 9.80665
            if abs(kinematicG) > 0.12 {
                let diff = max(-0.45, min(0.45, abs(kinematicG) - abs(self.latG)))
                self.camberDeg = 0.8 * self.camberDeg + 0.2 * (asin(diff) * 180.0 / .pi)
            } else {
                self.camberDeg *= 0.92
            }

            let totalG = hypot(self.latG, self.lonG)
            self.peakG = max(self.peakG, totalG)
            self.engagementScore = min(1.0, (totalG / 0.75) * 0.75 + (self.vertBumpG / 0.45) * 0.25)
            self.appendGTrail(latG: self.latG, lonG: self.lonG)
        }
    }

    func zeroMountCalibration() {
        let upVec = (-latestGravity.0, -latestGravity.1, -latestGravity.2)
        rZ = norm3(upVec)
        let seedForward = abs(rZ.1) < 0.9 ? (0.0, 1.0, 0.0) : (0.0, 0.0, -1.0)
        let dotZ = dot3(seedForward, rZ)
        rX = norm3((seedForward.0 - dotZ * rZ.0, seedForward.1 - dotZ * rZ.1, seedForward.2 - dotZ * rZ.2))
        rY = norm3(cross3(rZ, rX))
        awaitingForwardPullLock = true
        mountStatusText = "WAIT PULL..."
        peakG = 0.0
        speak("Vertical locked. Accelerate straight to lock forward axis.")
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        Task { @MainActor in
            self.userLocation = loc
            guard !self.isReplayingLog else { return }
            if self.baseGPSAltitude == nil && loc.verticalAccuracy >= 0 {
                self.baseGPSAltitude = loc.altitude
            }
            self.elevationM = (self.baseGPSAltitude ?? loc.altitude) + self.relativeBaroM
            self.speedMPH = max(0.0, loc.speed * 2.23694)
            self.currentLat = loc.coordinate.latitude
            self.currentLon = loc.coordinate.longitude
            if loc.course >= 0 {
                self.currentBearing = loc.course
            }
            if self.isRecordingFeel {
                self.recordAndPaintRoadSlice(at: loc)
            }
        }
    }

    private func recordAndPaintRoadSlice(at loc: CLLocation) {
        if let prev = lastNodeLocation {
            let dDist = loc.distance(from: prev)
            if dDist >= 5.0 {
                totalDistanceM += dDist
                if let prevElev = lastNodeElevationM {
                    gradePct = max(-35.0, min(35.0, ((elevationM - prevElev) / dDist) * 100.0))
                }
                let idx = liveSegments.count
                let seg = RoadFeelSegment(
                    index: idx,
                    distanceM: totalDistanceM,
                    lat: loc.coordinate.latitude,
                    lon: loc.coordinate.longitude,
                    elevationM: elevationM,
                    gradePct: gradePct,
                    speedMPH: speedMPH,
                    lonG: lonG,
                    latG: latG,
                    camberDeg: camberDeg,
                    crestG: crestG,
                    roughnessRMS: vertBumpG,
                    engagement: engagementScore
                )
                liveSegments.append(seg)
                csvLines.append(String(format: "%d,%.1f,%.6f,%.6f,%.1f,%.1f,%.1f,%.3f,%.3f,%.1f,%.3f,%.3f,%.2f",
                                       idx, totalDistanceM, seg.lat, seg.lon, seg.elevationM, seg.gradePct,
                                       seg.speedMPH, seg.lonG, seg.latG, seg.camberDeg, seg.crestG, seg.roughnessRMS, seg.engagement))
                lastNodeLocation = loc
                lastNodeElevationM = elevationM
            }
        } else {
            lastNodeLocation = loc
            lastNodeElevationM = elevationM
        }
    }

    func toggleRecordingAndExportIfStopped() {
        if isRecordingFeel {
            isRecordingFeel = false
            let fileName = "ApexDrive_3D_\(Int(Date().timeIntervalSince1970)).csv"
            let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent(fileName)
            try? csvLines.joined(separator: "\n").write(to: url, atomically: true, encoding: .utf8)
            exportedCSVURL = url
            speak("3D telemetry log saved.")
        } else {
            isReplayingLog = false
            lastNodeLocation = userLocation
            lastNodeElevationM = elevationM
            isRecordingFeel = true
            speak("Mapping 5 meter 3D road feel.")
        }
    }

    func speak(_ phrase: String) {
        guard voicePaceNotesEnabled else { return }
        let utterance = AVSpeechUtterance(string: phrase)
        utterance.rate = 0.53
        synth.speak(utterance)
    }
}

// MARK: - True 3D Terrain DEM & Extruded Telemetry Ribbon Engine (MapLibre WebGL)
struct Terrain3DWebMapView: UIViewRepresentable {
    @ObservedObject var engine: NavTelemetryEngine

    final class Coordinator: NSObject, WKNavigationDelegate {
        var isLoaded = false
        var lastReplayIdx: Int = -1
        var lastLat: Double = 0
        var lastLon: Double = 0
        var lastColorMode: ColorMetricMode = .feel
        var lastFlyTrigger: Int = 0
        var lastLiveCount: Int = 0
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.03, green: 0.04, blue: 0.06, alpha: 1.0)
        webView.scrollView.isScrollEnabled = false
        webView.navigationDelegate = context.coordinator

        let html = Self.build3DTerrainHTML(pebbleJSON: engine.rawJSONString)
        webView.loadHTMLString(html, baseURL: URL(string: "https://unpkg.com"))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        guard context.coordinator.isLoaded else { return }

        if context.coordinator.lastColorMode != engine.colorMode {
            context.coordinator.lastColorMode = engine.colorMode
            let modeStr: String
            switch engine.colorMode {
            case .feel: modeStr = "feel"
            case .elevation: modeStr = "elevation"
            case .grade: modeStr = "grade"
            case .camber: modeStr = "camber"
            case .roughness: modeStr = "roughness"
            }
            webView.evaluateJavaScript("window.setApexColorMode && window.setApexColorMode('\(modeStr)');", completionHandler: nil)
        }

        if context.coordinator.lastFlyTrigger != engine.flyOverviewTrigger {
            context.coordinator.lastFlyTrigger = engine.flyOverviewTrigger
            webView.evaluateJavaScript("window.flyApexOverview && window.flyApexOverview();", completionHandler: nil)
            return
        }

        if engine.liveSegments.count != context.coordinator.lastLiveCount, let latest = engine.liveSegments.last {
            context.coordinator.lastLiveCount = engine.liveSegments.count
            let prev = engine.liveSegments.count > 1 ? engine.liveSegments[engine.liveSegments.count - 2] : latest
            let col = latest.hexColor(mode: engine.colorMode)
            let h = max(4.0, (latest.elevationM - 88.0) * 0.85 + latest.combinedG * 45.0)
            webView.evaluateJavaScript("window.appendLiveSegment && window.appendLiveSegment(\(prev.lon),\(prev.lat),\(latest.lon),\(latest.lat),'\(col)',\(h));", completionHandler: nil)
        }

        let dLat = abs(engine.currentLat - context.coordinator.lastLat)
        let dLon = abs(engine.currentLon - context.coordinator.lastLon)
        if dLat > 1e-7 || dLon > 1e-7 || context.coordinator.lastReplayIdx != engine.replayIndex {
            context.coordinator.lastLat = engine.currentLat
            context.coordinator.lastLon = engine.currentLon
            context.coordinator.lastReplayIdx = engine.replayIndex
            webView.evaluateJavaScript(
                "window.updateApexCamera && window.updateApexCamera(\(engine.currentLon), \(engine.currentLat), \(engine.currentBearing));",
                completionHandler: nil
            )
        }
    }

    static func build3DTerrainHTML(pebbleJSON: String) -> String {
        return """
        <!DOCTYPE html>
        <html>
        <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet" />
        <script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
        <style>
          html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #06080c; overflow: hidden; }
          .maplibregl-ctrl-attrib { display: none !important; }
        </style>
        </head>
        <body>
        <div id="map"></div>
        <script>
        const RAW = \(pebbleJSON);
        const MIN_ELEV = 92.5, MAX_ELEV = 215.5;
        let colorMode = 'feel';

        const startLon = RAW.length > 120 ? RAW[120][2] : -84.61459;
        const startLat = RAW.length > 120 ? RAW[120][1] : 39.25858;

        const map = new maplibregl.Map({
          container: 'map',
          style: {
            version: 8,
            sources: {
              'carto-dark': {
                type: 'raster',
                tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'],
                tileSize: 256
              },
              'terrain-dem': {
                type: 'raster-dem',
                tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
                tileSize: 256,
                encoding: 'terrarium',
                maxzoom: 15
              },
              'hillshade-dem': {
                type: 'raster-dem',
                tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
                tileSize: 256,
                encoding: 'terrarium',
                maxzoom: 15
              }
            },
            layers: [
              { id: 'dark-base', type: 'raster', source: 'carto-dark', paint: { 'raster-opacity': 0.92, 'raster-contrast': 0.25 } },
              {
                id: 'hills',
                type: 'hillshade',
                source: 'hillshade-dem',
                paint: {
                  'hillshade-exaggeration': 0.82,
                  'hillshade-shadow-color': '#000000',
                  'hillshade-highlight-color': '#00e5ff',
                  'hillshade-accent-color': '#00f57a'
                }
              }
            ],
            terrain: { source: 'terrain-dem', exaggeration: 2.3 }
          },
          center: [startLon, startLat],
          zoom: 16.2,
          pitch: 68,
          bearing: -35,
          antialias: true,
          maxPitch: 82
        });

        const puck = document.createElement('div');
        puck.style.cssText = 'width:20px;height:20px;border-radius:50%;background:#00e5ff;border:3px solid #fff;box-shadow:0 0 20px #00e5ff;';
        const marker = new maplibregl.Marker({ element: puck }).setLngLat([startLon, startLat]).addTo(map);

        function colorForRow(r, mode) {
          const elev = r[3], grade = r[4], lonG = r[6], latG = r[7], camber = r[8], rough = r[10];
          if (mode === 'elevation') {
            const n = Math.max(0, Math.min(1, (elev - MIN_ELEV) / (MAX_ELEV - MIN_ELEV)));
            return n > 0.75 ? '#ff2a54' : (n > 0.5 ? '#ff9100' : (n > 0.25 ? '#00e5ff' : '#00f57a'));
          }
          if (mode === 'grade') {
            const g = Math.abs(grade);
            return g > 6.0 ? '#ff2a54' : (g > 3.0 ? '#ff9100' : '#00e5ff');
          }
          if (mode === 'camber') {
            const c = Math.abs(camber);
            return c > 4.0 ? '#00e5ff' : (c > 2.0 ? '#b388ff' : '#00f57a');
          }
          if (mode === 'roughness') {
            return rough > 0.12 ? '#ff2a54' : (rough > 0.06 ? '#ff9100' : '#00f57a');
          }
          const combG = Math.hypot(lonG, latG);
          return (combG > 0.32 || rough > 0.14) ? '#ff2a54' : ((combG > 0.18 || Math.abs(camber) > 2.5) ? '#ff9100' : '#00f57a');
        }

        function buildGeo(mode) {
          const walls = [], lines = [];
          const hw = 0.000045;
          for (let i = 0; i < RAW.length - 1; i++) {
            const r0 = RAW[i], r1 = RAW[i + 1];
            const lon0 = r0[2], lat0 = r0[1], lon1 = r1[2], lat1 = r1[1];
            const dLon = lon1 - lon0, dLat = lat1 - lat0;
            const len = Math.hypot(dLon, dLat);
            if (len < 1e-7 || len > 0.005) continue;
            const col = colorForRow(r0, mode);
            lines.push({
              type: 'Feature',
              properties: { color: col },
              geometry: { type: 'LineString', coordinates: [[lon0, lat0], [lon1, lat1]] }
            });
            const nx = (-dLat / len) * hw, ny = (dLon / len) * hw;
            const h = Math.max(4, (r0[3] - 88.0) * 0.85 + Math.hypot(r0[6], r0[7]) * 45.0);
            walls.push({
              type: 'Feature',
              properties: { color: col, height: h },
              geometry: {
                type: 'Polygon',
                coordinates: [[[lon0-nx, lat0-ny],[lon1-nx, lat1-ny],[lon1+nx, lat1+ny],[lon0+nx, lat0+ny],[lon0-nx, lat0-ny]]]
              }
            });
          }
          return {
            walls: { type: 'FeatureCollection', features: walls },
            lines: { type: 'FeatureCollection', features: lines }
          };
        }

        let liveGeo = { walls: [], lines: [] };

        map.on('load', () => {
          const geo = buildGeo(colorMode);
          map.addSource('walls', { type: 'geojson', data: geo.walls });
          map.addLayer({
            id: 'walls-3d',
            type: 'fill-extrusion',
            source: 'walls',
            paint: {
              'fill-extrusion-color': ['get', 'color'],
              'fill-extrusion-height': ['get', 'height'],
              'fill-extrusion-base': 0,
              'fill-extrusion-opacity': 0.82
            }
          });
          map.addSource('lines', { type: 'geojson', data: geo.lines });
          map.addLayer({
            id: 'lines-center',
            type: 'line',
            source: 'lines',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': ['get', 'color'], 'line-width': 4, 'line-opacity': 0.95 }
          });
        });

        window.updateApexCamera = function(lon, lat, brg) {
          marker.setLngLat([lon, lat]);
          map.easeTo({ center: [lon, lat], bearing: brg, pitch: 68, duration: 95 });
        };

        window.setApexColorMode = function(mode) {
          colorMode = mode;
          const geo = buildGeo(mode);
          const sw = map.getSource('walls'), sl = map.getSource('lines');
          if (sw) sw.setData(geo.walls);
          if (sl) sl.setData(geo.lines);
        };

        window.flyApexOverview = function() {
          if (!RAW.length) return;
          let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
          for (let i = 0; i < RAW.length; i++) {
            const lat = RAW[i][1], lon = RAW[i][2];
            if (lon < minLon) minLon = lon;
            if (lon > maxLon) maxLon = lon;
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
          }
          map.fitBounds([[minLon, minLat], [maxLon, maxLat]], { padding: 60, pitch: 58, bearing: -25, duration: 1000 });
        };
        </script>
        </body>
        </html>
        """
    }
}

extension Terrain3DWebMapView.Coordinator {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        isLoaded = true
    }
}

// MARK: - Stripped Offline 72°-Pitched 3D Chase Map (Zero Apple Maps POI Clutter)
struct PitchedOffline3DMapView: UIViewRepresentable {
    @ObservedObject var engine: NavTelemetryEngine

    func makeUIView(context: Context) -> MKMapView {
        let mapView = MKMapView(frame: .zero)
        mapView.overrideUserInterfaceStyle = .dark
        let config = MKStandardMapConfiguration(elevationStyle: .realistic, emphasisStyle: .muted)
        config.pointOfInterestFilter = .excludingAll
        config.showsTraffic = false
        mapView.preferredConfiguration = config
        mapView.isPitchEnabled = true
        mapView.isRotateEnabled = true
        mapView.showsCompass = false
        return mapView
    }

    func updateUIView(_ mapView: MKMapView, context: Context) {
        let center = CLLocationCoordinate2D(latitude: engine.currentLat, longitude: engine.currentLon)
        let cam = MKMapCamera(lookingAtCenter: center, fromDistance: 260, pitch: 72, heading: engine.currentBearing)
        mapView.setCamera(cam, animated: true)
    }
}

// MARK: - Bespoke Motorsport Instrument Cluster & 3D Cockpit View
struct CockpitNavigationView: View {
    @StateObject private var engine = NavTelemetryEngine()

    var body: some View {
        ZStack {
            // 1. Full-Bleed 3D Terrain & Extruded Road-Feel Viewport
            if engine.use3DTerrainWebEngine {
                Terrain3DWebMapView(engine: engine)
                    .ignoresSafeArea()
            } else {
                PitchedOffline3DMapView(engine: engine)
                    .ignoresSafeArea()
            }

            // 2. Top & Bottom Motorsport Vignette Gradients (keeps center windshield unobstructed)
            VStack {
                LinearGradient(colors: [Color.black.opacity(0.85), Color.clear], startPoint: .top, endPoint: .bottom)
                    .frame(height: 110)
                Spacer()
                LinearGradient(colors: [Color.clear, Color.black.opacity(0.92)], startPoint: .top, endPoint: .bottom)
                    .frame(height: 270)
            }
            .ignoresSafeArea()
            .allowsHitTesting(false)

            // 3. Sleek Carbon-Glass Motorsport HUD
            VStack(spacing: 8) {
                // TOP TELEMETRY RIBBON
                HStack(spacing: 10) {
                    // Dynamic Corner / Stage Badge
                    ZStack {
                        RoundedRectangle(cornerRadius: 10)
                            .fill(Color(red: 0.0, green: 0.96, blue: 0.48))
                            .frame(width: 42, height: 42)
                        Text("3D")
                            .font(.system(size: 16, weight: .black, design: .monospaced))
                            .foregroundStyle(.black)
                    }

                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text(engine.distanceToNextTurn)
                                .font(.system(size: 16, weight: .black, design: .monospaced))
                                .foregroundStyle(Color(red: 0.0, green: 0.96, blue: 0.48))
                            Text(engine.mountStatusText)
                                .font(.system(size: 9, weight: .heavy, design: .monospaced))
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.cyan.opacity(0.2))
                                .foregroundStyle(.cyan)
                                .clipShape(RoundedRectangle(cornerRadius: 4))
                        }
                        Text(engine.nextInstruction)
                            .font(.system(size: 11, weight: .bold, design: .monospaced))
                            .foregroundStyle(.white.opacity(0.9))
                            .lineLimit(1)
                    }

                    Spacer()

                    // Color Metric Cycle Button
                    Button {
                        let all = ColorMetricMode.allCases
                        if let idx = all.firstIndex(of: engine.colorMode) {
                            engine.colorMode = all[(idx + 1) % all.count]
                        }
                    } label: {
                        Text(engine.colorMode.rawValue)
                            .font(.system(size: 10, weight: .black, design: .monospaced))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 8)
                            .background(Color.cyan.opacity(0.18))
                            .foregroundStyle(.cyan)
                            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.cyan.opacity(0.45), lineWidth: 1))
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    }

                    // 3D Overview Button
                    Button {
                        engine.isReplayingLog = false
                        engine.flyOverviewTrigger += 1
                    } label: {
                        Image(systemName: "cube.transparent.fill")
                            .font(.system(size: 14, weight: .bold))
                            .padding(8)
                            .background(Color.purple.opacity(0.25))
                            .foregroundStyle(.purple)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    }

                    // Audio Pace Notes Toggle
                    Button {
                        engine.voicePaceNotesEnabled.toggle()
                    } label: {
                        Image(systemName: engine.voicePaceNotesEnabled ? "waveform" : "speaker.slash.fill")
                            .font(.system(size: 14, weight: .bold))
                            .padding(8)
                            .background(Color.white.opacity(0.12))
                            .foregroundStyle(engine.voicePaceNotesEnabled ? .green : .gray)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color(red: 0.05, green: 0.07, blue: 0.10).opacity(0.88))
                .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.white.opacity(0.14), lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 14))

                Spacer()

                // BOTTOM MOTORSPORT INSTRUMENT CLUSTER
                VStack(spacing: 8) {
                    // Row 1: Speed + Artificial Banking Horizon | Multi-Ring G-Scope | 6-Cell Telemetry Matrix
                    HStack(spacing: 12) {
                        // Left: Speedometer + Live Artificial Roll/Pitch Horizon
                        VStack(spacing: 4) {
                            Text(String(format: "%.0f", engine.speedMPH))
                                .font(.system(size: 34, weight: .black, design: .monospaced))
                                .foregroundStyle(.white)
                            Text("MPH")
                                .font(.system(size: 9, weight: .heavy, design: .monospaced))
                                .foregroundStyle(.gray)

                            // Artificial Banking & Grade Horizon Canvas
                            Canvas { ctx, size in
                                let midX = size.width / 2
                                let midY = size.height / 2 + CGFloat(engine.gradePct * 0.8)
                                let rad = CGFloat(engine.camberDeg * .pi / 180.0)
                                let dx = cos(rad) * (size.width * 0.44)
                                let dy = sin(rad) * (size.width * 0.44)

                                var horizon = Path()
                                horizon.move(to: CGPoint(x: midX - dx, y: midY - dy))
                                horizon.addLine(to: CGPoint(x: midX + dx, y: midY + dy))
                                ctx.stroke(horizon, with: .color(.cyan), lineWidth: 2.2)

                                var centerTick = Path()
                                centerTick.move(to: CGPoint(x: midX - 6, y: size.height / 2))
                                centerTick.addLine(to: CGPoint(x: midX + 6, y: size.height / 2))
                                ctx.stroke(centerTick, with: .color(.white.opacity(0.4)), lineWidth: 1)
                            }
                            .frame(width: 68, height: 22)
                            .background(Color.black.opacity(0.5))
                            .clipShape(RoundedRectangle(cornerRadius: 5))
                        }
                        .frame(width: 74)

                        // Center: Multi-Ring Friction Circle Scope with Historical G-Trail
                        ZStack {
                            Canvas { ctx, size in
                                let c = CGPoint(x: size.width / 2, y: size.height / 2)
                                let maxR = min(size.width, size.height) * 0.46

                                // Crosshairs
                                var ch = Path()
                                ch.move(to: CGPoint(x: 4, y: c.y))
                                ch.addLine(to: CGPoint(x: size.width - 4, y: c.y))
                                ch.move(to: CGPoint(x: c.x, y: 4))
                                ch.addLine(to: CGPoint(x: c.x, y: size.height - 4))
                                ctx.stroke(ch, with: .color(.white.opacity(0.12)), lineWidth: 1)

                                // 0.33G, 0.66G, 1.0G concentric rings
                                for frac in [0.35, 0.7, 1.0] {
                                    let r = maxR * CGFloat(frac)
                                    let rect = CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)
                                    ctx.stroke(Path(ellipseIn: rect), with: .color(.white.opacity(frac == 1.0 ? 0.28 : 0.14)), lineWidth: 1)
                                }

                                // Historical G-Vector Comet Trail
                                if engine.gTrail.count > 1 {
                                    var trail = Path()
                                    for (i, pt) in engine.gTrail.enumerated() {
                                        let px = c.x + CGFloat(max(-0.95, min(0.95, pt.0 / 0.85))) * maxR
                                        let py = c.y - CGFloat(max(-0.95, min(0.95, pt.1 / 0.85))) * maxR
                                        if i == 0 { trail.move(to: CGPoint(x: px, y: py)) }
                                        else { trail.addLine(to: CGPoint(x: px, y: py)) }
                                    }
                                    ctx.stroke(trail, with: .color(.cyan.opacity(0.65)), lineWidth: 2.0)
                                }

                                // Active G Vector Dot
                                let gx = c.x + CGFloat(max(-0.95, min(0.95, engine.latG / 0.85))) * maxR
                                let gy = c.y - CGFloat(max(-0.95, min(0.95, engine.lonG / 0.85))) * maxR
                                let mag = hypot(engine.latG, engine.lonG)
                                let dotColor: Color = mag > 0.35 ? .red : (mag > 0.20 ? .orange : .green)
                                let dotRect = CGRect(x: gx - 5.5, y: gy - 5.5, width: 11, height: 11)
                                ctx.fill(Path(ellipseIn: dotRect), with: .color(dotColor))
                            }
                        }
                        .frame(width: 78, height: 78)

                        // Right: 6-Cell Motorsport Telemetry Matrix
                        VStack(alignment: .leading, spacing: 5) {
                            HStack {
                                Text("LAT").foregroundStyle(.gray)
                                Text(String(format: "%+.2fG", engine.latG)).foregroundStyle(.green)
                                Spacer()
                                Text("BANK φ").foregroundStyle(.gray)
                                Text(String(format: "%+.1f°", engine.camberDeg)).foregroundStyle(.cyan)
                            }
                            HStack {
                                Text("ELEV").foregroundStyle(.gray)
                                Text(String(format: "%.1fm", engine.elevationM)).foregroundStyle(.purple)
                                Spacer()
                                Text("GRADE").foregroundStyle(.gray)
                                Text(String(format: "%+.1f%%", engine.gradePct)).foregroundStyle(.orange)
                            }
                            HStack {
                                Text("CREST").foregroundStyle(.gray)
                                Text(String(format: "%+.2fG", engine.crestG)).foregroundStyle(.white)
                                Spacer()
                                Text("PEAK").foregroundStyle(.gray)
                                Text(String(format: "%.2fG", engine.peakG)).foregroundStyle(.red)
                            }
                        }
                        .font(.system(size: 11, weight: .bold, design: .monospaced))
                    }

                    // Row 2: Interactive 3D Elevation & Terrain Scrubber Canvas (92.8m – 215.3m MSL)
                    GeometryReader { geo in
                        ZStack(alignment: .topLeading) {
                            Canvas { ctx, size in
                                let segs = engine.pebbleSegments
                                guard segs.count > 2 else { return }
                                let minE = 92.5, maxE = 215.5
                                let step = max(1, segs.count / 180)

                                var fillPath = Path()
                                fillPath.move(to: CGPoint(x: 0, y: size.height))
                                var strokePath = Path()

                                var first = true
                                for i in stride(from: 0, to: segs.count, by: step) {
                                    let x = (CGFloat(i) / CGFloat(segs.count - 1)) * size.width
                                    let norm = CGFloat((segs[i].elevationM - minE) / (maxE - minE))
                                    let y = size.height - 4 - norm * (size.height - 16)
                                    fillPath.addLine(to: CGPoint(x: x, y: y))
                                    if first {
                                        strokePath.move(to: CGPoint(x: x, y: y))
                                        first = false
                                    } else {
                                        strokePath.addLine(to: CGPoint(x: x, y: y))
                                    }
                                }
                                fillPath.addLine(to: CGPoint(x: size.width, y: size.height))
                                fillPath.closeSubpath()

                                ctx.fill(fillPath, with: .linearGradient(
                                    Gradient(colors: [Color.cyan.opacity(0.45), Color.green.opacity(0.05)]),
                                    startPoint: .zero,
                                    endPoint: CGPoint(x: 0, y: size.height)
                                ))
                                ctx.stroke(strokePath, with: .color(.cyan), lineWidth: 1.8)

                                // Active Scrubber Playhead
                                let playX = (CGFloat(engine.replayIndex) / CGFloat(max(1, segs.count - 1))) * size.width
                                var cursor = Path()
                                cursor.move(to: CGPoint(x: playX, y: 0))
                                cursor.addLine(to: CGPoint(x: playX, y: size.height))
                                ctx.stroke(cursor, with: .color(.orange), lineWidth: 2.0)
                            }
                            .background(Color.black.opacity(0.55))
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.white.opacity(0.12), lineWidth: 1))
                            .gesture(
                                DragGesture(minimumDistance: 0)
                                    .onChanged { val in
                                        let frac = max(0.0, min(1.0, Double(val.location.x / max(1.0, geo.size.width))))
                                        engine.scrubToFraction(frac)
                                    }
                            )

                            HStack {
                                Text("3D ELEVATION PROFILE (93m–215m • DRAG TO SCRUB)")
                                Spacer()
                                Text("NODE #\(engine.replayIndex)/\(engine.pebbleSegments.count)")
                            }
                            .font(.system(size: 8.5, weight: .heavy, design: .monospaced))
                            .foregroundStyle(.white.opacity(0.72))
                            .padding(.horizontal, 6)
                            .padding(.top, 3)
                            .allowsHitTesting(false)
                        }
                    }
                    .frame(height: 50)

                    // Row 3: Compact Motorsport Action Bar
                    HStack(spacing: 8) {
                        Button {
                            engine.isReplayingLog.toggle()
                        } label: {
                            Text(engine.isReplayingLog ? "⏸ PAUSE 3D LOG" : "▶ REPLAY PEBBLE RIDGE")
                                .font(.system(size: 11, weight: .black, design: .monospaced))
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 10)
                                .background(engine.isReplayingLog ? Color.orange : Color(red: 0.0, green: 0.96, blue: 0.48))
                                .foregroundStyle(.black)
                                .clipShape(RoundedRectangle(cornerRadius: 9))
                        }

                        Button {
                            let mults = [1, 2, 5, 10]
                            if let idx = mults.firstIndex(of: engine.replaySpeedMultiplier) {
                                engine.replaySpeedMultiplier = mults[(idx + 1) % mults.count]
                            }
                        } label: {
                            Text("\(engine.replaySpeedMultiplier)x")
                                .font(.system(size: 11, weight: .black, design: .monospaced))
                                .padding(.horizontal, 10)
                                .padding(.vertical, 10)
                                .background(Color.white.opacity(0.12))
                                .foregroundStyle(.cyan)
                                .clipShape(RoundedRectangle(cornerRadius: 9))
                        }

                        Button {
                            engine.toggleRecordingAndExportIfStopped()
                        } label: {
                            Text(engine.isRecordingFeel ? "■ SAVE" : "● LIVE REC")
                                .font(.system(size: 11, weight: .black, design: .monospaced))
                                .padding(.horizontal, 11)
                                .padding(.vertical, 10)
                                .background(engine.isRecordingFeel ? Color.red : Color.white.opacity(0.14))
                                .foregroundStyle(.white)
                                .clipShape(RoundedRectangle(cornerRadius: 9))
                        }

                        Button {
                            engine.zeroMountCalibration()
                        } label: {
                            Text("ZERO")
                                .font(.system(size: 11, weight: .black, design: .monospaced))
                                .padding(.horizontal, 10)
                                .padding(.vertical, 10)
                                .background(Color.white.opacity(0.12))
                                .foregroundStyle(.white)
                                .clipShape(RoundedRectangle(cornerRadius: 9))
                        }

                        if let csvURL = engine.exportedCSVURL {
                            ShareLink(item: csvURL) {
                                Image(systemName: "square.and.arrow.up")
                                    .font(.system(size: 13, weight: .bold))
                                    .padding(10)
                                    .background(Color.cyan)
                                    .foregroundStyle(.black)
                                    .clipShape(RoundedRectangle(cornerRadius: 9))
                            }
                        }
                    }
                }
                .padding(12)
                .background(Color(red: 0.05, green: 0.07, blue: 0.10).opacity(0.90))
                .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.white.opacity(0.15), lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 16))
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
        }
        .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
    }
}
