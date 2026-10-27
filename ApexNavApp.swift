import SwiftUI
import WebKit
import CoreLocation
import CoreMotion
import AVFoundation
import UniformTypeIdentifiers
import AuthenticationServices
import MapKit
import CryptoKit
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
    @Environment(\.scenePhase) private var scenePhase

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
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { shell.reloadIfWebContentDied() }
        }
    }
}

enum ApexWebBundle {
    static var indexURL: URL? {
        Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "web")
    }
    /// The cockpit is served as apexnav://app/... instead of file://: WebKit's fetch() refuses
    /// file URLs, which silently broke the voice banks (every voice fell back to the device TTS).
    static let scheme = "apexnav"
    static let entryURL = URL(string: "\(scheme)://app/index.html")!
}

/// Serves files from the bundled web/ folder for the apexnav:// scheme.
final class ApexBundleSchemeHandler: NSObject, WKURLSchemeHandler {
    private let root: URL
    init(root: URL) { self.root = root.standardizedFileURL }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        let rel = url.path.hasPrefix("/") ? String(url.path.dropFirst()) : url.path
        let file = root.appendingPathComponent(rel.isEmpty ? "index.html" : rel).standardizedFileURL
        guard file.path.hasPrefix(root.path), let data = try? Data(contentsOf: file) else {
            task.didFailWithError(URLError(.fileDoesNotExist))
            return
        }
        let mime = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": mime, "Content-Length": "\(data.count)",
                                                      "Access-Control-Allow-Origin": "*"])!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
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
        config.setURLSchemeHandler(ApexBundleSchemeHandler(root: indexURL.deletingLastPathComponent()),
                                   forURLScheme: ApexWebBundle.scheme)
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
        // Never zoom the app itself: the pages scroll in their own containers and the map pinch-zooms inside MapLibre.
        webView.scrollView.minimumZoomScale = 1
        webView.scrollView.maximumZoomScale = 1
        webView.scrollView.pinchGestureRecognizer?.isEnabled = false
        webView.allowsLinkPreview = false
        webView.allowsBackForwardNavigationGestures = false
        webView.isInspectable = true
        webView.navigationDelegate = context.coordinator
        webView.hideKeyboardAccessoryBar()

        shell.attach(webView: webView)
        webView.load(URLRequest(url: ApexWebBundle.entryURL))
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
        if let dict = body as? [String: Any], let id = (dict["id"] as? NSNumber)?.intValue {
            if cmd == "placeComplete", let q = dict["q"] as? String {
                shell?.placeComplete(query: q, lat: (dict["lat"] as? NSNumber)?.doubleValue, lon: (dict["lon"] as? NSNumber)?.doubleValue, id: id)
                return
            }
            if cmd == "placeResolve", let index = (dict["index"] as? NSNumber)?.intValue {
                shell?.placeResolve(index: index, id: id)
                return
            }
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
final class ApexSensorShell: NSObject, ObservableObject, CLLocationManagerDelegate, ASWebAuthenticationPresentationContextProviding {
    static let gStd = ApexKit.gStd
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
    private var accuracyM: Double? = nil   // horizontal, metres; the web's off-route test widens with it
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
        pipeline.mount = MountCalibrator()   // unknown until gravity settles; a mount saved from an earlier drive is reused only if gravity agrees
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
        configureVoiceSession()
        synth.delegate = self
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

    /// iOS can kill the web content process while the app is in the background without calling
    /// webViewWebContentProcessDidTerminate, which leaves a black screen on return. Back in the
    /// foreground, ask the page for a trivial value and reload if nothing answers.
    func reloadIfWebContentDied() {
        guard let wv = webView else { return }
        wv.evaluateJavaScript("document.readyState") { [weak self, weak wv] result, error in
            guard error != nil || result == nil, let wv else { return }
            self?.webDidStartLoading()
            if wv.url == nil { wv.load(URLRequest(url: ApexWebBundle.entryURL)) } else { wv.reload() }
        }
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
        case "signIn":
            startSignIn()
            return
        case "voiceBegin":                                    // the web cockpit is about to play a voice clip
            webVoiceActive = true
            beginVoice()
            return
        case "voiceEnd":
            webVoiceActive = false
            endVoiceIfIdle()
            return
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

    // MARK: Sign-in (Google refuses OAuth inside an embedded web view)
    // The system sheet runs the Worker's Google flow with a PKCE challenge; the Worker's callback redirects to
    // apexnav://auth?code=... (single use, 2 min); the shell trades code + verifier for a session token and hands it to
    // the page, which sends it as a bearer token. No secrets in the bundle.
    private static let apiBase = URL(string: "https://apexnav.senftns.workers.dev")!
    private var authSession: ASWebAuthenticationSession?

    private static func b64url(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private func startSignIn() {
        guard authSession == nil else { return }
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { signInFailed("error"); return }
        let verifier = Self.b64url(Data(bytes))
        let challenge = Self.b64url(Data(SHA256.hash(data: Data(verifier.utf8))))
        var comps = URLComponents(url: Self.apiBase.appendingPathComponent("api/auth/google/start"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "app_challenge", value: challenge)]
        let session = ASWebAuthenticationSession(url: comps.url!, callbackURLScheme: ApexWebBundle.scheme) { [weak self] url, error in
            Task { @MainActor in
                guard let self else { return }
                self.authSession = nil
                if let err = error as? ASWebAuthenticationSessionError, err.code == .canceledLogin { self.signInFailed("cancelled"); return }
                guard let url, let code = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?
                        .first(where: { $0.name == "code" })?.value else { self.signInFailed("error"); return }
                await self.exchange(code: code, verifier: verifier)
            }
        }
        session.presentationContextProvider = self
        authSession = session
        if !session.start() { authSession = nil; signInFailed("error") }
    }

    private func exchange(code: String, verifier: String) async {
        var req = URLRequest(url: Self.apiBase.appendingPathComponent("api/auth/app/exchange"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.setValue("1", forHTTPHeaderField: "x-apexnav")
        req.setValue("\(ApexWebBundle.scheme)://app", forHTTPHeaderField: "origin")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["code": code, "verifier": verifier])
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            guard (resp as? HTTPURLResponse)?.statusCode == 200,
                  let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let token = obj["token"] as? String,
                  token.range(of: "^[A-Za-z0-9_-]{20,200}$", options: .regularExpression) != nil else { signInFailed("error"); return }
            evaluate("window.apex && window.apex.onNative && window.apex.onNative({type:'session',token:'\(token)'}); void 0;")
        } catch {
            signInFailed("offline")
        }
    }

    private func signInFailed(_ reason: String) {
        evaluate("window.apex && window.apex.onNative && window.apex.onNative({type:'signInFailed',reason:'\(reason)'}); void 0;")
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first ?? ASPresentationAnchor()
        }
    }

    // MARK: Apple place search (MapKit, free, no key): suggestions while typing, coordinates only for the one tapped

    private let placeCompleter = MKLocalSearchCompleter()
    private var placeQueryId = 0
    private var placeResults: [MKLocalSearchCompletion] = []

    /// Where to? typing: Apple suggestions around the phone (about 150 km), answered with window.apex.onNative({type:'placeSuggestions'}).
    func placeComplete(query: String, lat: Double?, lon: Double?, id: Int) {
        placeQueryId = id
        if placeCompleter.delegate == nil {
            placeCompleter.delegate = self
            placeCompleter.resultTypes = [.address, .pointOfInterest]
        }
        if let lat, let lon, lat.isFinite, lon.isFinite {
            placeCompleter.region = MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: lat, longitude: lon),
                                                       latitudinalMeters: 150_000, longitudinalMeters: 150_000)
        }
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if q.isEmpty { placeResults = []; sendPlaceSuggestions([], failed: false); return }
        placeCompleter.queryFragment = q
    }

    fileprivate func placeResultsUpdated(failed: Bool) {
        placeResults = failed ? [] : Array(placeCompleter.results.prefix(6))
        sendPlaceSuggestions(placeResults.map { ($0.title, $0.subtitle) }, failed: failed)
    }

    private func sendPlaceSuggestions(_ items: [(String, String)], failed: Bool) {
        let payload: [String: Any] = ["type": "placeSuggestions", "id": placeQueryId, "failed": failed,
                                      "items": items.map { ["title": $0.0, "subtitle": $0.1] }]
        guard let data = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: data, encoding: .utf8) else { return }
        evaluate("window.apex && window.apex.onNative && window.apex.onNative(\(json)); void 0;")
    }

    /// The suggestion the driver tapped: one MKLocalSearch for its coordinates, answered with {type:'placeResolved'}.
    func placeResolve(index: Int, id: Int) {
        guard index >= 0, index < placeResults.count else { sendPlaceResolved(id: id, lat: nil, lon: nil, name: nil); return }
        MKLocalSearch(request: MKLocalSearch.Request(completion: placeResults[index])).start { [weak self] response, _ in
            guard let self else { return }
            let item = response?.mapItems.first
            let lat = item?.placemark.coordinate.latitude, lon = item?.placemark.coordinate.longitude, name = item?.name
            Task { @MainActor in self.sendPlaceResolved(id: id, lat: lat, lon: lon, name: name) }
        }
    }

    private func sendPlaceResolved(id: Int, lat: Double?, lon: Double?, name: String?) {
        var payload: [String: Any] = ["type": "placeResolved", "id": id]
        if let lat, let lon, lat.isFinite, lon.isFinite { payload["lat"] = lat; payload["lon"] = lon }
        if let name { payload["name"] = name }
        guard let data = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: data, encoding: .utf8) else { return }
        evaluate("window.apex && window.apex.onNative && window.apex.onNative(\(json)); void 0;")
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
            + "\"accuracy_m\":\(Self.num(hasFix ? accuracyM : nil, 1)),"
            + "\"speed_mps\":\(Self.num(speedMps, 2)),"
            + "\"course_deg\":\(Self.num(courseDeg, 1)),"
            + "\"elevation_m\":\(Self.num(fusion.elevationM, 2)),"
            + "\"grade_pct\":\(Self.num(odometer.gradePct, 2)),"
            + "\"lat_g\":\(Self.num(pipeline.latAccMps2 / Self.gStd, 3)),"
            + "\"lon_g\":\(Self.num(pipeline.lonAccMps2 / Self.gStd, 3)),"
            + "\"camber_deg\":\(Self.num(pipeline.camberRad * 180.0 / Double.pi, 2)),"
            + "\"crest_vertical_g\":\(Self.num(pipeline.crestAccMps2 / Self.gStd, 3)),"
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
        accuracyM = fix.horizontalAccuracyM
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
        // Calibration is automatic and continuous (ApexKit.MountCalibrator): gravity gives the vertical, GPS speed and
        // turns give forward, a moved phone drops back to unknown. Silent; the frame's "calibration" field shows the state.
        let wasLocked = pipeline.mount.state == .locked
        pipeline.step(accel: a, gyro: w, timestamp: timestamp, speedMps: speedMps, gravityG: gravityG)
        if !wasLocked && pipeline.mount.state == .locked { persistMount() }
    }

    // MARK: SO(3) mount calibration

    /// Manual vertical lock (the "calibrate" message): +Z_veh = -gravity now. Not needed in normal use, the
    /// calibration is automatic; forward follows from driving, inside ApexKit.
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
        pipeline.mount.restore(rows: rows)
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

    // MARK: Voice audio: car stereo, CarPlay audio, Bluetooth
    // A navigation app's prompts: .playback + .voicePrompt, ducking music and pausing podcasts only while a prompt plays.
    // The session is active only while speaking: an always-active session kept the car's music ducked, and many head units
    // switch to the phone's Bluetooth stream (or raise CarPlay audio) only when the app starts audio. The web cockpit's
    // voice clips (WebAudio) share this session and bracket themselves with voiceBegin / voiceEnd.
    private var webVoiceActive = false

    private func configureVoiceSession() {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .voicePrompt,
                                                         options: [.duckOthers, .interruptSpokenAudioAndMixWithOthers])
    }

    private func beginVoice() {
        configureVoiceSession()                                // WebKit may have changed the category for its own media
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    fileprivate func endVoiceIfIdle() {
        guard !synth.isSpeaking, !webVoiceActive else { return }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func speak(_ phrase: String, interrupt: Bool = false, style: String = "codriver") {
        // AVSpeechSynthesizer queues utterances itself; only a forced call cuts in.
        // (The web cockpit decides which notes are still worth calling.)
        if interrupt && synth.isSpeaking {
            synth.stopSpeaking(at: .word)
        }
        beginVoice()
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

extension WKWebView {
    /// The keyboard's ‹ › Done bar is web-view furniture that makes the app feel like a web page. WKWebView has no switch for
    /// it, so its content view gets a subclass whose inputAccessoryView is nil (made once, at runtime).
    func hideKeyboardAccessoryBar() {
        guard let content = scrollView.subviews.first(where: { String(describing: type(of: $0)).hasPrefix("WKContent") }) else { return }
        let base: AnyClass = type(of: content)
        let name = "\(NSStringFromClass(base))_ApexNoAccessory"
        var noBar: AnyClass? = NSClassFromString(name)
        if noBar == nil, let made = objc_allocateClassPair(base, name, 0) {
            let selector = #selector(getter: UIResponder.inputAccessoryView)
            let none: @convention(block) (AnyObject) -> AnyObject? = { _ in nil }
            if let method = class_getInstanceMethod(UIResponder.self, selector) {
                class_addMethod(made, selector, imp_implementationWithBlock(none), method_getTypeEncoding(method))
            }
            objc_registerClassPair(made)
            noBar = made
        }
        if let noBar { object_setClass(content, noBar) }
    }
}

extension ApexSensorShell: MKLocalSearchCompleterDelegate {
    nonisolated func completerDidUpdateResults(_ completer: MKLocalSearchCompleter) {
        Task { @MainActor in self.placeResultsUpdated(failed: false) }
    }

    nonisolated func completer(_ completer: MKLocalSearchCompleter, didFailWithError error: Error) {
        Task { @MainActor in self.placeResultsUpdated(failed: true) }
    }
}

extension ApexSensorShell: AVSpeechSynthesizerDelegate {
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in self.endVoiceIfIdle() }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in self.endVoiceIfIdle() }
    }
}
