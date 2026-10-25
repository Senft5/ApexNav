import SwiftUI
import WebKit
import CoreLocation
import CoreMotion
import AVFoundation

// =====================================================================================
// APEX NAV — iOS THIN SHELL
//
// The entire cockpit UI (map, HUD, controls) lives in ONE shared web bundle:
//   web/index.html (+ web/vendor/maplibre-gl.js|css, web/data/*.js)
// copied into the app bundle as a folder reference. This file only:
//   1. renders that bundle full-screen in a WKWebView, and
//   2. ingests native sensors (CoreLocation, CoreMotion, CMAltimeter), aligns them into the
//      ISO 8855 vehicle frame, records 5.0 m road-feel segments, and pushes a live frame to
//      JavaScript every 0.1 s via `window.apex.live(<json>)`.
//
// JS -> native: window.webkit.messageHandlers.apex.postMessage("calibrate" | "startRecording"
//               | "stopRecording" | "toggleRecording")  (or {cmd: "..."}).
// native -> JS: window.APEX_EMBED = true (documentStart),
//               window.apex.live(frame) every 0.1 s after the page finished loading,
//               window.apex.onNative({type: "recordingSaved", file, segments}) after export.
//
// Units: everything internal is SI / ISO 8855 (+X fwd, +Y left, +Z up; m/s^2, rad, rad/s).
// Conversion to display units (G, degrees, mph) happens ONLY at serialization.
// =====================================================================================

@main
struct ApexNavApp: App {
    var body: some Scene {
        WindowGroup {
            ApexShellRootView()
                .preferredColorScheme(.dark)
        }
    }
}

// MARK: - Root View

struct ApexShellRootView: View {
    @StateObject private var shell = ApexSensorShell()

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if let indexURL = ApexWebBundle.indexURL {
                ApexCockpitWebView(shell: shell, indexURL: indexURL)
                    .ignoresSafeArea()
            } else {
                VStack(spacing: 10) {
                    Text("APEX NAV")
                        .font(.system(size: 22, weight: .black, design: .monospaced))
                        .foregroundStyle(.white)
                    Text("Cockpit bundle missing: web/index.html")
                        .font(.system(size: 13, weight: .semibold, design: .monospaced))
                        .foregroundStyle(.gray)
                }
            }
        }
        .statusBarHidden(true)
        .persistentSystemOverlays(.hidden)
        .sheet(item: $shell.shareItem) { item in
            ActivityShareSheet(items: [item.url])
        }
        .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
    }
}

enum ApexWebBundle {
    static var indexURL: URL? {
        Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "web")
    }
}

struct CSVShareItem: Identifiable {
    let id = UUID()
    let url: URL
}

struct ActivityShareSheet: UIViewControllerRepresentable {
    let items: [URL]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

// MARK: - Full-Screen Web Cockpit

struct ApexCockpitWebView: UIViewRepresentable {
    let shell: ApexSensorShell
    let indexURL: URL

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate {
        let shell: ApexSensorShell

        init(shell: ApexSensorShell) {
            self.shell = shell
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            shell.webDidStartLoading()
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            shell.webDidFinishLoading()
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            shell.webDidStartLoading()
            webView.reload()
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(shell: shell)
    }

    func makeUIView(context: Context) -> WKWebView {
        let contentController = WKUserContentController()
        let embedFlag = WKUserScript(
            source: "window.APEX_EMBED = true; window.APEX_PLATFORM = 'ios';",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        contentController.addUserScript(embedFlag)
        // WKUserContentController retains its handlers strongly; the bridge only holds the shell weakly.
        contentController.add(ApexScriptBridge(shell: shell), name: "apex")

        let config = WKWebViewConfiguration()
        config.userContentController = contentController
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        Self.enableLocalFileAccess(config)

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.alwaysBounceVertical = false
        webView.scrollView.alwaysBounceHorizontal = false
        webView.allowsLinkPreview = false
        webView.allowsBackForwardNavigationGestures = false
        webView.isInspectable = true
        webView.navigationDelegate = context.coordinator

        shell.attach(webView: webView)
        webView.loadFileURL(indexURL, allowingReadAccessTo: indexURL.deletingLastPathComponent())
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: "apex")
    }

    /// Lets bundled pages XHR/fetch sibling files (e.g. local styles/glyphs) from a file:// origin.
    /// Uses KVC on WebKit's private setters, guarded by `responds(to:)` so it can never throw.
    @MainActor
    private static func enableLocalFileAccess(_ config: WKWebViewConfiguration) {
        if config.preferences.responds(to: Selector(("_setAllowFileAccessFromFileURLs:"))) {
            config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        }
        if config.responds(to: Selector(("_setAllowUniversalAccessFromFileURLs:"))) {
            config.setValue(true, forKey: "allowUniversalAccessFromFileURLs")
        }
    }
}

/// Weak proxy so WKUserContentController -> handler does not retain the sensor shell.
@MainActor
final class ApexScriptBridge: NSObject, WKScriptMessageHandler {
    weak var shell: ApexSensorShell?

    init(shell: ApexSensorShell) {
        self.shell = shell
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        let body = message.body
        var command: String?
        var speechText: String?
        var interruptSpeech = false
        if let text = body as? String {
            command = text
        } else if let dict = body as? [String: Any] {
            command = (dict["cmd"] as? String) ?? (dict["command"] as? String) ?? (dict["type"] as? String)
            speechText = dict["text"] as? String
            interruptSpeech = (dict["force"] as? Bool) ?? false
        }
        guard let cmd = command else { return }
        if cmd == "speak", let phrase = speechText {
            shell?.speakCoDriver(phrase, interrupt: interruptSpeech)
            return
        }
        shell?.handleCommand(cmd)
    }
}

// MARK: - Small SI Math Helpers

struct Vec3 {
    var x: Double
    var y: Double
    var z: Double

    static let zero = Vec3(x: 0.0, y: 0.0, z: 0.0)

    func dot(_ o: Vec3) -> Double { x * o.x + y * o.y + z * o.z }

    func cross(_ o: Vec3) -> Vec3 {
        Vec3(x: y * o.z - z * o.y, y: z * o.x - x * o.z, z: x * o.y - y * o.x)
    }

    var magnitude: Double { sqrt(max(0.0, dot(self))) }

    func scaled(_ s: Double) -> Vec3 { Vec3(x: x * s, y: y * s, z: z * s) }

    func plus(_ o: Vec3) -> Vec3 { Vec3(x: x + o.x, y: y + o.y, z: z + o.z) }

    func minus(_ o: Vec3) -> Vec3 { Vec3(x: x - o.x, y: y - o.y, z: z - o.z) }

    func normalized() -> Vec3 {
        let mag = sqrt(max(1e-12, dot(self)))
        return Vec3(x: x / mag, y: y / mag, z: z / mag)
    }

    /// Removes the component along unit vector `axis`.
    func rejecting(_ axis: Vec3) -> Vec3 { minus(axis.scaled(dot(axis))) }
}

/// Sendable snapshot of a CLLocation so delegate callbacks never ship non-Sendable objects across actors.
struct GPSFix: Sendable {
    let lat: Double
    let lon: Double
    let altitudeM: Double
    let horizontalAccuracyM: Double
    let verticalAccuracyM: Double
    let speedMps: Double
    let courseDeg: Double
}

enum MountCalibrationState: String {
    case locked
    case awaitingPull
    case `default`
}

// MARK: - Native Sensor Shell (CoreLocation + CoreMotion + CMAltimeter)

@MainActor
final class ApexSensorShell: NSObject, ObservableObject, CLLocationManagerDelegate {
    static let gStd: Double = 9.80665
    static let segmentLengthM: Double = 5.0
    private static let mountDefaultsKey = "apex.mountRotationRows.v1"

    @Published var shareItem: CSVShareItem?

    private let locManager = CLLocationManager()
    private let motionManager = CMMotionManager()
    private let altimeter = CMAltimeter()
    private let synth = AVSpeechSynthesizer()

    // Web bridge
    private weak var webView: WKWebView?
    private var webReady = false
    private var pushTimer: Timer?

    // GPS state
    private var hasFix = false
    private var latDeg: Double = 0.0
    private var lonDeg: Double = 0.0
    private var speedMps: Double = 0.0
    private var courseDeg: Double?

    // Elevation fusion: elevation = relativeBaroM + baroOffsetM (offset slowly trimmed toward GPS MSL altitude)
    private let baroAvailable = CMAltimeter.isRelativeAltitudeAvailable()
    private var relativeBaroM: Double = 0.0
    private var baroOffsetM: Double?
    private var gpsOnlyAltitudeM: Double?

    // 5.0 m arc-length odometer (always running so live grade is available; recording just persists nodes)
    private var odoPrevLat: Double?
    private var odoPrevLon: Double?
    private var odoPrevElev: Double?
    private var odoSinceNodeM: Double = 0.0
    private var lastNodeElevationM: Double?
    private var gradePct: Double = 0.0

    // 3x3 SO(3) mount-to-vehicle rotation rows (default solved from Pebble Ridge iPhone 15 Pro log)
    private var rX = Vec3(x: 0.1159, y: 0.2998, z: -0.9469)
    private var rY = Vec3(x: -0.9927, y: 0.0029, z: -0.1206)
    private var rZ = Vec3(x: -0.0334, y: 0.9540, z: 0.2980)
    private var latestGravityG = Vec3(x: 0.0, y: -0.95, z: -0.30)   // CoreMotion gravity, phone frame, in g (points DOWN)
    private var calibration: MountCalibrationState = .default
    private var pullAccum = Vec3.zero
    private var pullSamples: Int = 0

    // Vehicle-frame IMU state (SI)
    private var lastMotionTimestamp: Double?
    private var lonAccMps2: Double = 0.0      // +X forward
    private var latAccMps2: Double = 0.0      // +Y left
    private var yawRateRadS: Double = 0.0     // about +Z up (left turn positive)
    private var crestAccMps2: Double = 0.0    // < 1 Hz vertical (dynamic, gravity removed)
    private var hpVert: Double = 0.0          // > 8 Hz vertical
    private var lastAzVeh: Double = 0.0
    private var roughMeanSq: Double = 0.0     // live EMA of hpVert^2 (m/s^2)^2
    private var segRoughSumSq: Double = 0.0
    private var segRoughCount: Int = 0
    private var camberRad: Double = 0.0
    private var engagement: Double = 0.0

    // Recording
    private var isRecording = false
    private var recordedSegments: Int = 0
    private static let csvHeader = "segment_index,distance_m,lat,lon,elevation_m,speed_mph,lon_g,lat_g,camber_deg,crest_vertical_g,roughness_rms,engagement_score,grade_pct"
    private var csvLines: [String] = [ApexSensorShell.csvHeader]

    override init() {
        super.init()
        restorePersistedMount()
        locManager.delegate = self
        locManager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        locManager.distanceFilter = kCLDistanceFilterNone
        locManager.activityType = .automotiveNavigation
        locManager.pausesLocationUpdatesAutomatically = false
        locManager.allowsBackgroundLocationUpdates = true   // UIBackgroundModes: location is declared in project.yml
        locManager.showsBackgroundLocationIndicator = true
        locManager.requestWhenInUseAuthorization()
        locManager.startUpdatingLocation()
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .voicePrompt, options: [.mixWithOthers, .duckOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
        startMotionPipeline()
        startPushTimer()
    }

    // MARK: Web bridge

    func attach(webView: WKWebView) {
        self.webView = webView
        webReady = false
    }

    func webDidStartLoading() {
        webReady = false
    }

    func webDidFinishLoading() {
        webReady = true
        pushLiveFrame()
    }

    func handleCommand(_ command: String) {
        switch command {
        case "calibrate":
            zeroMountCalibration()
        case "startRecording":
            startRecording()
        case "stopRecording":
            stopRecordingAndExport()
        case "toggleRecording":
            if isRecording { stopRecordingAndExport() } else { startRecording() }
        default:
            break
        }
        pushLiveFrame()
    }

    private func startPushTimer() {
        let timer = Timer(timeInterval: 0.1, repeats: true) { [weak self] _ in
            guard let self else { return }
            MainActor.assumeIsolated {
                self.pushLiveFrame()
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        pushTimer = timer
    }

    private func evaluate(_ js: String) {
        guard webReady, let wv = webView else { return }
        wv.evaluateJavaScript(js, completionHandler: nil)
    }

    /// Serializes the live frame. Display conversions happen here only:
    /// lat_g / lon_g in G (= m/s^2 / 9.80665), camber in degrees, roughness_rms in G RMS (>8 Hz vertical),
    /// speed in m/s, course in degrees true, elevation in m, grade in %.
    private func pushLiveFrame() {
        guard webReady, webView != nil else { return }
        let elevation = currentElevationM()
        let json = "{"
            + "\"lat\":\(Self.num(hasFix ? latDeg : nil, 7)),"
            + "\"lon\":\(Self.num(hasFix ? lonDeg : nil, 7)),"
            + "\"speed_mps\":\(Self.num(speedMps, 2)),"
            + "\"course_deg\":\(Self.num(courseDeg, 1)),"
            + "\"elevation_m\":\(Self.num(elevation, 2)),"
            + "\"grade_pct\":\(Self.num(gradePct, 2)),"
            + "\"lat_g\":\(Self.num(latAccMps2 / Self.gStd, 3)),"
            + "\"lon_g\":\(Self.num(lonAccMps2 / Self.gStd, 3)),"
            + "\"camber_deg\":\(Self.num(camberRad * 180.0 / Double.pi, 2)),"
            + "\"roughness_rms\":\(Self.num(sqrt(max(0.0, roughMeanSq)) / Self.gStd, 4)),"
            + "\"recording\":\(isRecording ? "true" : "false"),"
            + "\"calibration\":\"\(calibration.rawValue)\","
            + "\"has_fix\":\(hasFix ? "true" : "false"),"
            + "\"segments\":\(recordedSegments)"
            + "}"
        evaluate("window.apex && window.apex.live && window.apex.live(\(json)); void 0;")
    }

    private static func num(_ value: Double?, _ digits: Int) -> String {
        guard let v = value, v.isFinite else { return "null" }
        return String(format: "%.\(digits)f", v)
    }

    // MARK: CoreLocation

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        let fix = GPSFix(
            lat: loc.coordinate.latitude,
            lon: loc.coordinate.longitude,
            altitudeM: loc.altitude,
            horizontalAccuracyM: loc.horizontalAccuracy,
            verticalAccuracyM: loc.verticalAccuracy,
            speedMps: loc.speed,
            courseDeg: loc.course
        )
        Task { @MainActor in
            self.ingest(fix: fix)
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            self.locManager.startUpdatingLocation()
        }
    }

    private func ingest(fix: GPSFix) {
        guard fix.horizontalAccuracyM >= 0 else { return }
        hasFix = true
        latDeg = fix.lat
        lonDeg = fix.lon
        if fix.speedMps >= 0 { speedMps = fix.speedMps }
        if fix.courseDeg >= 0 { courseDeg = fix.courseDeg }

        // Baro + GPS elevation fusion (barometer = smooth relative shape, GPS = absolute MSL anchor)
        if fix.verticalAccuracyM > 0 {
            let gpsAnchor = fix.altitudeM - relativeBaroM
            if let offset = baroOffsetM {
                let k = 0.02 * min(1.0, 8.0 / max(fix.verticalAccuracyM, 1.0))
                baroOffsetM = offset + k * (gpsAnchor - offset)
            } else {
                baroOffsetM = gpsAnchor
            }
            if let prev = gpsOnlyAltitudeM {
                gpsOnlyAltitudeM = prev + 0.2 * (fix.altitudeM - prev)
            } else {
                gpsOnlyAltitudeM = fix.altitudeM
            }
        }

        advanceOdometer(fix: fix)
    }

    private func currentElevationM() -> Double? {
        if baroAvailable, let offset = baroOffsetM {
            return relativeBaroM + offset
        }
        return gpsOnlyAltitudeM
    }

    /// Walks the polyline between consecutive fixes and emits a node every 5.0 m of arc length
    /// (interpolating position/elevation), so fast driving at 1 Hz GPS still yields true 5 m bins.
    private func advanceOdometer(fix: GPSFix) {
        let elev = currentElevationM()
        guard fix.horizontalAccuracyM <= 30.0 else { return }
        guard let pLat = odoPrevLat, let pLon = odoPrevLon else {
            resetOdometer(lat: fix.lat, lon: fix.lon, elev: elev)
            return
        }
        let legM = CLLocation(latitude: pLat, longitude: pLon)
            .distance(from: CLLocation(latitude: fix.lat, longitude: fix.lon))
        if legM > 250.0 {
            // GPS jump / resume after gap: restart the odometer instead of painting a fake straight line
            resetOdometer(lat: fix.lat, lon: fix.lon, elev: elev)
            return
        }
        if fix.speedMps >= 0 && fix.speedMps < 0.8 {
            // Stationary jitter: don't accumulate fake distance
            odoPrevLat = fix.lat
            odoPrevLon = fix.lon
            odoPrevElev = elev
            return
        }

        let step = Self.segmentLengthM
        let legRoughRMS = segRoughCount > 0 ? sqrt(segRoughSumSq / Double(segRoughCount)) : sqrt(max(0.0, roughMeanSq))
        var s = step - odoSinceNodeM
        var emitted = false
        while s <= legM && legM > 0 {
            let t = s / legM
            let nLat = pLat + (fix.lat - pLat) * t
            let nLon = pLon + (fix.lon - pLon) * t
            var nElev: Double?
            if let e0 = odoPrevElev, let e1 = elev {
                nElev = e0 + (e1 - e0) * t
            } else {
                nElev = elev
            }
            emitNode(lat: nLat, lon: nLon, elevationM: nElev, roughRMSMps2: legRoughRMS)
            emitted = true
            s += step
        }
        odoSinceNodeM = legM - (s - step)
        if emitted {
            segRoughSumSq = 0.0
            segRoughCount = 0
        }
        odoPrevLat = fix.lat
        odoPrevLon = fix.lon
        odoPrevElev = elev
    }

    private func resetOdometer(lat: Double, lon: Double, elev: Double?) {
        odoPrevLat = lat
        odoPrevLon = lon
        odoPrevElev = elev
        odoSinceNodeM = 0.0
        lastNodeElevationM = elev
    }

    private func emitNode(lat: Double, lon: Double, elevationM: Double?, roughRMSMps2: Double) {
        if let e = elevationM, let prev = lastNodeElevationM {
            let rawGrade = max(-35.0, min(35.0, ((e - prev) / Self.segmentLengthM) * 100.0))
            gradePct = 0.6 * gradePct + 0.4 * rawGrade
        }
        lastNodeElevationM = elevationM

        guard isRecording else { return }
        let idx = recordedSegments
        let row = String(
            format: "%d,%.1f,%.7f,%.7f,%.2f,%.2f,%.4f,%.4f,%.2f,%.4f,%.4f,%.3f,%.2f",
            idx,
            Double(idx) * Self.segmentLengthM,
            lat,
            lon,
            elevationM ?? 0.0,
            speedMps * 2.2369362921,
            lonAccMps2 / Self.gStd,
            latAccMps2 / Self.gStd,
            camberRad * 180.0 / Double.pi,
            crestAccMps2 / Self.gStd,
            roughRMSMps2 / Self.gStd,
            engagement,
            gradePct
        )
        csvLines.append(row)
        recordedSegments += 1
    }

    // MARK: CoreMotion (100 Hz) + CMAltimeter

    private func startMotionPipeline() {
        if baroAvailable {
            altimeter.startRelativeAltitudeUpdates(to: .main) { [weak self] data, _ in
                guard let self, let d = data else { return }
                let rel = d.relativeAltitude.doubleValue
                MainActor.assumeIsolated {
                    self.relativeBaroM = rel
                }
            }
        }
        guard motionManager.isDeviceMotionAvailable else { return }
        motionManager.deviceMotionUpdateInterval = 1.0 / 100.0
        motionManager.startDeviceMotionUpdates(to: .main) { [weak self] motion, _ in
            guard let self, let m = motion else { return }
            let gravity = Vec3(x: m.gravity.x, y: m.gravity.y, z: m.gravity.z)
            // CoreMotion userAcceleration is reported with the opposite sign of proper (specific-force)
            // acceleration, so negate it and convert g -> m/s^2.
            let accel = Vec3(x: -m.userAcceleration.x, y: -m.userAcceleration.y, z: -m.userAcceleration.z)
                .scaled(ApexSensorShell.gStd)
            let gyro = Vec3(x: m.rotationRate.x, y: m.rotationRate.y, z: m.rotationRate.z)
            let timestamp = m.timestamp
            MainActor.assumeIsolated {
                self.ingestMotion(gravityG: gravity, accelMps2: accel, gyroRadS: gyro, timestamp: timestamp)
            }
        }
    }

    private static func alpha(dt: Double, tau: Double) -> Double {
        1.0 - exp(-dt / tau)
    }

    private func ingestMotion(gravityG: Vec3, accelMps2 a: Vec3, gyroRadS w: Vec3, timestamp: Double) {
        latestGravityG = gravityG
        var dt = 0.01
        if let last = lastMotionTimestamp {
            dt = max(0.001, min(0.1, timestamp - last))
        }
        lastMotionTimestamp = timestamp

        if calibration == .awaitingPull {
            updateForwardPullLock(accel: a, gyro: w)
        }

        // Phone frame -> ISO 8855 vehicle frame: v_veh = R * v_phone
        let axVeh = rX.dot(a)
        let ayVeh = rY.dot(a)
        let azVeh = rZ.dot(a)
        let yaw = rZ.dot(w)

        let aHoriz = Self.alpha(dt: dt, tau: 0.15)
        lonAccMps2 += aHoriz * (axVeh - lonAccMps2)
        latAccMps2 += aHoriz * (ayVeh - latAccMps2)
        yawRateRadS += aHoriz * (yaw - yawRateRadS)

        // < 1.0 Hz crest / compression band
        crestAccMps2 += Self.alpha(dt: dt, tau: 1.0 / (2.0 * Double.pi * 1.0)) * (azVeh - crestAccMps2)

        // > 8.0 Hz pavement roughness band (first-order high-pass)
        let rc = 1.0 / (2.0 * Double.pi * 8.0)
        let beta = rc / (rc + dt)
        hpVert = beta * (hpVert + azVeh - lastAzVeh)
        lastAzVeh = azVeh
        let sq = hpVert * hpVert
        roughMeanSq += Self.alpha(dt: dt, tau: 0.5) * (sq - roughMeanSq)
        segRoughSumSq += sq
        segRoughCount += 1

        // True camber phi from a_y = v*w_z*cos(phi) - g*sin(phi) (same gating/clip as core/kinematics.py)
        let aKin = speedMps * yawRateRadS
        if abs(aKin) > 1.5 {
            let sinPhi = max(-0.5, min(0.5, (abs(aKin) - abs(latAccMps2)) / Self.gStd))
            camberRad += Self.alpha(dt: dt, tau: 0.3) * (asin(sinPhi) - camberRad)
        } else {
            camberRad -= Self.alpha(dt: dt, tau: 0.6) * camberRad
        }

        let combinedG = hypot(latAccMps2, lonAccMps2) / Self.gStd
        let roughG = sqrt(max(0.0, roughMeanSq)) / Self.gStd
        engagement = min(1.0, (combinedG / 0.75) * 0.75 + (roughG / 0.45) * 0.25)
    }

    // MARK: SO(3) mount calibration

    /// Vertical lock: +Z_veh = -gravity (CoreMotion gravity points down). Forward axis is seeded and then
    /// refined by the next sustained straight-line pull (forward-pull X-lock).
    func zeroMountCalibration() {
        rZ = latestGravityG.scaled(-1.0).normalized()
        let seed = abs(rZ.y) < 0.9 ? Vec3(x: 0.0, y: 1.0, z: 0.0) : Vec3(x: 0.0, y: 0.0, z: -1.0)
        rX = seed.rejecting(rZ).normalized()
        rY = rZ.cross(rX).normalized()
        pullAccum = .zero
        pullSamples = 0
        calibration = .awaitingPull
        speak("Vertical locked. Accelerate straight to lock forward axis.")
    }

    private func updateForwardPullLock(accel a: Vec3, gyro w: Vec3) {
        let horizontal = a.rejecting(rZ)
        let pullMag = horizontal.magnitude
        let gyroMag = w.magnitude
        let consistent = pullSamples == 0 || horizontal.dot(pullAccum) > 0
        if pullMag > 1.2 && gyroMag < 0.15 && consistent {
            pullAccum = pullAccum.plus(horizontal)
            pullSamples += 1
            if pullSamples >= 30 {
                rX = pullAccum.rejecting(rZ).normalized()
                rY = rZ.cross(rX).normalized()
                calibration = .locked
                pullAccum = .zero
                pullSamples = 0
                persistMount()
                speak("Forward axis locked.")
            }
        } else if pullMag < 0.5 {
            pullAccum = .zero
            pullSamples = 0
        }
    }

    private func persistMount() {
        let rows = [rX.x, rX.y, rX.z, rY.x, rY.y, rY.z, rZ.x, rZ.y, rZ.z]
        UserDefaults.standard.set(rows, forKey: Self.mountDefaultsKey)
    }

    private func restorePersistedMount() {
        guard let rows = UserDefaults.standard.array(forKey: Self.mountDefaultsKey) as? [Double],
              rows.count == 9,
              rows.allSatisfy({ $0.isFinite }) else { return }
        rX = Vec3(x: rows[0], y: rows[1], z: rows[2])
        rY = Vec3(x: rows[3], y: rows[4], z: rows[5])
        rZ = Vec3(x: rows[6], y: rows[7], z: rows[8])
        calibration = .locked
    }

    // MARK: Recording / export

    func startRecording() {
        guard !isRecording else { return }
        csvLines = [Self.csvHeader]
        recordedSegments = 0
        isRecording = true
        speak("Mapping 5 meter road feel.")
    }

    func stopRecordingAndExport() {
        guard isRecording else { return }
        isRecording = false
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd_HHmmss"
        let fileName = "ApexDrive_\(formatter.string(from: Date())).csv"
        guard let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
        let url = docs.appendingPathComponent(fileName)
        do {
            try (csvLines.joined(separator: "\n") + "\n").write(to: url, atomically: true, encoding: .utf8)
            shareItem = CSVShareItem(url: url)
            evaluate("window.apex && window.apex.onNative && window.apex.onNative({type:'recordingSaved',file:'\(fileName)',segments:\(recordedSegments)}); void 0;")
            speak("Road feel log saved.")
        } catch {
            evaluate("window.apex && window.apex.onNative && window.apex.onNative({type:'recordingFailed'}); void 0;")
        }
    }

    func speakCoDriver(_ phrase: String, interrupt: Bool = false) {
        speak(phrase, interrupt: interrupt)
    }

    private func speak(_ phrase: String, interrupt: Bool = false) {
        // AVSpeechSynthesizer queues utterances itself; only a forced call cuts in.
        // (The web cockpit decides which notes are still worth calling.)
        if interrupt && synth.isSpeaking {
            synth.stopSpeaking(at: .word)
        }
        let utterance = AVSpeechUtterance(string: phrase)
        utterance.voice = AVSpeechSynthesisVoice(language: "en-GB") ?? AVSpeechSynthesisVoice(language: "en-US")
        utterance.rate = 0.51
        utterance.pitchMultiplier = 0.98
        synth.speak(utterance)
    }
}
