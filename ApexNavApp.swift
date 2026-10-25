import SwiftUI
import WebKit
import CoreLocation
import CoreMotion
import AVFoundation
import ApexKit

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
        var speechStyle = "codriver"
        if let text = body as? String {
            command = text
        } else if let dict = body as? [String: Any] {
            command = (dict["cmd"] as? String) ?? (dict["command"] as? String) ?? (dict["type"] as? String)
            speechText = dict["text"] as? String
            interruptSpeech = (dict["force"] as? Bool) ?? false
            speechStyle = (dict["style"] as? String) ?? "codriver"
        }
        guard let cmd = command else { return }
        if cmd == "speak", let phrase = speechText {
            shell?.speakCoDriver(phrase, interrupt: interruptSpeech, style: speechStyle)
            return
        }
        shell?.handleCommand(cmd)
    }
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

// MARK: - Native Sensor Shell (CoreLocation + CoreMotion + CMAltimeter)
//
// Hardware ingestion only. All live math (mount calibration, IMU filters, camber,
// elevation fusion, the 5 m odometer) lives in ApexKit and is held numerically to
// core/live_pipeline.py by ApexKit's tests.

@MainActor
final class ApexSensorShell: NSObject, ObservableObject, CLLocationManagerDelegate {
    static let gStd = ApexKit.gStd
    private static let mountDefaultsKey = "apex.mountRotationRows.v1"
    // Default mount solved from the Pebble Ridge iPhone 15 Pro log; replaced by the first calibration.
    private static let defaultMountRows = [0.1159, 0.2998, -0.9469, -0.9927, 0.0029, -0.1206, -0.0334, 0.9540, 0.2980]

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

    // Live math (ApexKit)
    private var pipeline = IMUPipeline()
    private var fusion = ElevationFusion(baroAvailable: CMAltimeter.isRelativeAltitudeAvailable())
    private var odometer = Odometer5m()
    private var latestGravityG = Vec3(x: 0.0, y: -0.95, z: -0.30)   // CoreMotion gravity, phone frame, in g (points DOWN)

    // Recording
    private var isRecording = false
    private var recordedSegments: Int = 0
    private static let csvHeader = "segment_index,distance_m,lat,lon,elevation_m,speed_mph,lon_g,lat_g,camber_deg,crest_vertical_g,roughness_rms,engagement_score,grade_pct"
    private var csvLines: [String] = [ApexSensorShell.csvHeader]

    override init() {
        super.init()
        pipeline.mount = MountCalibrator(rows: Self.defaultMountRows)
        pipeline.mount.state = .default
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
        let json = "{"
            + "\"lat\":\(Self.num(hasFix ? latDeg : nil, 7)),"
            + "\"lon\":\(Self.num(hasFix ? lonDeg : nil, 7)),"
            + "\"speed_mps\":\(Self.num(speedMps, 2)),"
            + "\"course_deg\":\(Self.num(courseDeg, 1)),"
            + "\"elevation_m\":\(Self.num(fusion.elevationM, 2)),"
            + "\"grade_pct\":\(Self.num(odometer.gradePct, 2)),"
            + "\"lat_g\":\(Self.num(pipeline.latAccMps2 / Self.gStd, 3)),"
            + "\"lon_g\":\(Self.num(pipeline.lonAccMps2 / Self.gStd, 3)),"
            + "\"camber_deg\":\(Self.num(pipeline.camberRad * 180.0 / Double.pi, 2)),"
            + "\"roughness_rms\":\(Self.num(pipeline.roughRMSMps2 / Self.gStd, 4)),"
            + "\"recording\":\(isRecording ? "true" : "false"),"
            + "\"calibration\":\"\(pipeline.mount.state.rawValue)\","
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
        fusion.ingestGPS(altitudeM: fix.altitudeM, verticalAccuracyM: fix.verticalAccuracyM)

        let nodes = odometer.feed(lat: fix.lat, lon: fix.lon, elevationM: fusion.elevationM, speedMps: fix.speedMps,
                                  horizontalAccuracyM: fix.horizontalAccuracyM, roughRMSMps2: pipeline.segmentRoughRMS)
        if !nodes.isEmpty { pipeline.resetSegmentRough() }
        for node in nodes { record(node) }
    }

    private func record(_ node: RoadNode) {
        guard isRecording else { return }
        let idx = recordedSegments
        let row = String(
            format: "%d,%.1f,%.7f,%.7f,%.2f,%.2f,%.4f,%.4f,%.2f,%.4f,%.4f,%.3f,%.2f",
            idx,
            Double(idx) * ApexKit.segmentLengthM,
            node.lat,
            node.lon,
            node.elevationM ?? 0.0,
            speedMps * 2.2369362921,
            pipeline.lonAccMps2 / Self.gStd,
            pipeline.latAccMps2 / Self.gStd,
            pipeline.camberRad * 180.0 / Double.pi,
            pipeline.crestAccMps2 / Self.gStd,
            node.roughRMSMps2 / Self.gStd,
            pipeline.engagement,
            node.gradePct
        )
        csvLines.append(row)
        recordedSegments += 1
    }

    // MARK: CoreMotion (100 Hz) + CMAltimeter

    private func startMotionPipeline() {
        if CMAltimeter.isRelativeAltitudeAvailable() {
            altimeter.startRelativeAltitudeUpdates(to: .main) { [weak self] data, _ in
                guard let self, let d = data else { return }
                let rel = d.relativeAltitude.doubleValue
                MainActor.assumeIsolated {
                    self.fusion.relativeBaroM = rel
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
                .scaled(ApexKit.gStd)
            let gyro = Vec3(x: m.rotationRate.x, y: m.rotationRate.y, z: m.rotationRate.z)
            let timestamp = m.timestamp
            MainActor.assumeIsolated {
                self.ingestMotion(gravityG: gravity, accelMps2: accel, gyroRadS: gyro, timestamp: timestamp)
            }
        }
    }

    private func ingestMotion(gravityG: Vec3, accelMps2 a: Vec3, gyroRadS w: Vec3, timestamp: Double) {
        latestGravityG = gravityG
        let wasAwaitingPull = pipeline.mount.state == .awaitingPull
        pipeline.step(accel: a, gyro: w, timestamp: timestamp, speedMps: speedMps)
        if wasAwaitingPull && pipeline.mount.state == .locked {
            persistMount()
            speak("Forward axis locked.")
        }
    }

    // MARK: SO(3) mount calibration

    /// Vertical lock: +Z_veh = -gravity. Forward axis is seeded and then refined by the next
    /// sustained straight-line pull (forward-pull X-lock), inside ApexKit.
    func zeroMountCalibration() {
        pipeline.mount.lockVertical(gravityG: latestGravityG)
        speak("Vertical locked. Accelerate straight to lock forward axis.")
    }

    private func persistMount() {
        UserDefaults.standard.set(pipeline.mount.rows, forKey: Self.mountDefaultsKey)
    }

    private func restorePersistedMount() {
        guard let rows = UserDefaults.standard.array(forKey: Self.mountDefaultsKey) as? [Double],
              rows.count == 9,
              rows.allSatisfy({ $0.isFinite }) else { return }
        pipeline.mount = MountCalibrator(rows: rows)
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

    func speakCoDriver(_ phrase: String, interrupt: Bool = false, style: String = "codriver") {
        speak(phrase, interrupt: interrupt, style: style)
    }

    private static let robotVoiceNames = ["Zarvox", "Trinoids", "Fred", "Ralph", "Cellos"]

    /// Co-driver: the highest-quality English voice installed (Premium > Enhanced > default),
    /// British first. Jarvis: a novelty robot voice when the device has one.
    private static func voice(for style: String) -> AVSpeechSynthesisVoice? {
        let all = AVSpeechSynthesisVoice.speechVoices()
        if style == "jarvis", let robot = all.first(where: { robotVoiceNames.contains($0.name) }) {
            return robot
        }
        func rank(_ v: AVSpeechSynthesisVoice) -> Int {
            let quality: Int
            switch v.quality {
            case .premium: quality = 30
            case .enhanced: quality = 20
            default: quality = 0
            }
            let accent = v.language.hasPrefix("en-GB") ? 4 : (v.language.hasPrefix("en") ? 2 : -100)
            return quality + accent
        }
        return all.filter { $0.language.hasPrefix("en") && !robotVoiceNames.contains($0.name) }.max { rank($0) < rank($1) }
            ?? AVSpeechSynthesisVoice(language: "en-GB")
    }

    private func speak(_ phrase: String, interrupt: Bool = false, style: String = "codriver") {
        // AVSpeechSynthesizer queues utterances itself; only a forced call cuts in.
        // (The web cockpit decides which notes are still worth calling.)
        if interrupt && synth.isSpeaking {
            synth.stopSpeaking(at: .word)
        }
        let utterance = AVSpeechUtterance(string: phrase)
        let voice = Self.voice(for: style)
        utterance.voice = voice
        if style == "jarvis" {
            let isRobot = voice.map { Self.robotVoiceNames.contains($0.name) } ?? false
            utterance.rate = isRobot ? 0.48 : 0.44
            utterance.pitchMultiplier = isRobot ? 1.0 : 0.55
        } else {
            utterance.rate = 0.54
            utterance.pitchMultiplier = 1.0
        }
        synth.speak(utterance)
    }
}
