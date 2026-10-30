import SwiftUI
import WebKit
import CoreLocation
import CoreMotion
import AVFoundation
import UniformTypeIdentifiers
import AuthenticationServices
import MapKit
import CryptoKit
import ActivityKit
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
//               window.apex.onNative({type: "recordingSaved", file, segments}) after export,
//               window.apex.onNative({type: "link", params}) when an apexnav://open link arrives while the page runs.
//
// Units: everything internal is SI / ISO 8855 (+X fwd, +Y left, +Z up; m/s^2, rad, rad/s).
// Conversion to display units (G, degrees, mph) happens ONLY at serialization.
// =====================================================================================

@main
struct ApexNavApp: App {
    // the builds-you-follow refresh (ApexBuildNotifier.swift) must be registered before launch finishes
    init() { ApexBuildNotifier.register() }

    var body: some Scene {
        WindowGroup {
            ApexShellRootView()
                .preferredColorScheme(.dark)
        }
    }
}

// MARK: - Root View

struct ApexShellRootView: View {
    @ObservedObject private var shell = ApexEngine.shared.shell
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            Color(uiColor: .launchPanel).ignoresSafeArea()
            if ApexWebBundle.indexURL != nil {
                ApexCockpitWebView()
                    .ignoresSafeArea()
            } else {
                VStack(spacing: 10) {
                    Text("VETTA")
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
            if phase == .background { ApexBuildNotifier.schedule() }      // new steps on builds you follow, while away
        }
        .onOpenURL { shell.openLink($0) }
        // Siri and Shortcuts (ApexIntents.swift, IDEAS V-07): the intent's link, now or from before the view listened
        .onReceive(NotificationCenter.default.publisher(for: ApexIntentInbox.notification)) { note in
            if let url = note.object as? URL { _ = ApexIntentInbox.take(); shell.openLink(url) }
        }
        .task { if let url = ApexIntentInbox.take() { shell.openLink(url) } }
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

    /// "Open in the app" links from the web (apexnav://open?invite=…): the page's own link parameters, and only those, carried
    /// over to the cockpit page, which handles them exactly as it does on the web. Anything else opens the app as usual.
    static let linkKeys: Set<String> = ["invite", "crew", "add", "convoy", "go"]   // go=drive: start a drive (IDEAS C-05)
    private static let linkValue = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-")
    /// The link's parameters the page understands, or nil when the link isn't one of ours or carries none.
    static func linkItems(_ url: URL) -> [URLQueryItem]? {
        guard url.scheme == scheme, url.host() == "open",
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else { return nil }
        let kept = items.filter { item in
            guard linkKeys.contains(item.name), let v = item.value, (1...200).contains(v.count) else { return false }
            return v.unicodeScalars.allSatisfy { linkValue.contains($0) }
        }
        return kept.isEmpty ? nil : kept
    }
    /// The cockpit page opened with those parameters (when the app starts from a link).
    static func linkEntryURL(_ items: [URLQueryItem]) -> URL? {
        guard var comps = URLComponents(url: entryURL, resolvingAgainstBaseURL: false) else { return nil }
        comps.queryItems = items
        return comps.url
    }
}

/// Serves files from the bundled web/ folder for the apexnav:// scheme.
final class ApexBundleSchemeHandler: NSObject, WKURLSchemeHandler {
    private let root: URL
    init(root: URL) { self.root = root.standardizedFileURL }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        let rel = url.path.hasPrefix("/") ? String(url.path.dropFirst()) : url.path
        let file = root.appendingPathComponent(rel.isEmpty ? "index.html" : rel).standardizedFileURL
        guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file) else {
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

// MARK: - The engine: one cockpit page and one sensor shell per app process
// The phone's window and the car's screen (CarPlay/ApexCarPlay.swift) both need the cockpit page: it plans, guides, calls the
// notes and speaks. The phone's window used to make it, so CarPlay opened with the phone app closed had no route engine
// (the CarPlay cold launch). Now whichever scene comes first makes it; the phone's window shows the same page when it opens,
// and a drive started from the car keeps running when the phone's window comes and goes.

@MainActor
final class ApexEngine {
    static let shared = ApexEngine()
    let shell = ApexSensorShell()
    private var webView: WKWebView?
    private var coordinator: ApexCockpitWebView.PageDelegate?

    /// The cockpit page, made and loaded the first time a scene needs it.
    func cockpit() -> WKWebView? {
        if let webView { return webView }
        guard let indexURL = ApexWebBundle.indexURL else { return nil }
        let c = ApexCockpitWebView.PageDelegate(shell: shell)
        let wv = ApexCockpitWebView.makeWebView(shell: shell, indexURL: indexURL, coordinator: c)
        coordinator = c
        webView = wv
        return wv
    }
}

// MARK: - Full-Screen Web Cockpit

/// The phone's window onto the engine's cockpit page (ApexEngine): the page outlives the window, so this never tears it down.
struct ApexCockpitWebView: UIViewRepresentable {

    @MainActor
    final class PageDelegate: NSObject, WKNavigationDelegate, WKUIDelegate {   // held by ApexEngine, not SwiftUI
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

        // The app's own pages (apexnav://) stay in the web view. Any other page in the main frame would get the native
        // bridge (sign-in, sensors, share) and strand the driver with no back button, so http(s) links open in Safari.
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url, let scheme = url.scheme?.lowercased() else { return decisionHandler(.cancel) }
            if scheme == ApexWebBundle.scheme || scheme == "about" || scheme == "blob" || scheme == "data" { return decisionHandler(.allow) }
            if navigationAction.targetFrame?.isMainFrame == false { return decisionHandler(.allow) }   // an embedded frame never gets the bridge
            if scheme == "http" || scheme == "https" || scheme == "mailto" || scheme == "tel" || scheme == "maps" {
                UIApplication.shared.open(url)
            }
            decisionHandler(.cancel)
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            shell.webDidStartLoading()
            webView.reload()
        }

        // WKWebView shows nothing for alert(), confirm() or prompt() unless its UI delegate does: confirm() answers
        // false and prompt() null, so Unfriend, Leave crew and Delete account silently did nothing in the app.
        private func present(_ alert: UIAlertController, from webView: WKWebView) -> Bool {
            guard var top = webView.window?.rootViewController else { return false }
            while let next = top.presentedViewController, !next.isBeingDismissed { top = next }
            // Mid-transition (the share sheet closing) present() does nothing and the handler would never be called.
            if top.isBeingDismissed || top.isBeingPresented { return false }
            top.present(alert, animated: true)
            return true
        }

        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                     initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
            if !present(alert, from: webView) { completionHandler() }
        }

        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                     initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
            if !present(alert, from: webView) { completionHandler(false) }
        }

        func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                     initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
            let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
            alert.addTextField { field in
                field.text = defaultText
                // An empty prompt asks for a typed word (Delete account wants DELETE); a filled one is a link to copy.
                field.autocapitalizationType = (defaultText ?? "").isEmpty ? .allCharacters : .none
                field.autocorrectionType = .no
            }
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
            alert.addAction(UIAlertAction(title: "OK", style: .default) { [weak alert] _ in
                completionHandler(alert?.textFields?.first?.text ?? "")
            })
            if !present(alert, from: webView) { completionHandler(nil) }
        }
    }

    func makeUIView(context: Context) -> WKWebView {
        ApexEngine.shared.cockpit() ?? WKWebView()
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    /// Review recordings only (debug builds, APEX_REVIEW=1): the page logs every line it says (web say()).
    private static var reviewFlag: String {
        #if DEBUG
        return ProcessInfo.processInfo.environment["APEX_REVIEW"] == "1" ? " window.APEX_REVIEW = true;" : ""
        #else
        return ""
        #endif
    }

    @MainActor
    static func makeWebView(shell: ApexSensorShell, indexURL: URL, coordinator: PageDelegate) -> WKWebView {
        let contentController = WKUserContentController()
        let embedFlag = WKUserScript(
            source: "window.APEX_EMBED = true; window.APEX_PLATFORM = 'ios';" + reviewFlag,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        contentController.addUserScript(embedFlag)
        // WKUserContentController retains its handlers strongly; the bridge only holds the shell weakly.
        contentController.add(ApexScriptBridge(shell: shell), name: "apex")
        // The Worker, on the page's behalf, with the session from the Keychain (IDEAS Z-10): the page never holds the token.
        contentController.addScriptMessageHandler(ApexApiBridge(), contentWorld: .page, name: "apexApi")

        let config = WKWebViewConfiguration()
        config.userContentController = contentController
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        // The page reads the app's version from its user agent for feedback diagnostics (IDEAS L-05, web/feedback.js).
        let info = Bundle.main.infoDictionary
        config.applicationNameForUserAgent = "ApexNav/\(info?["CFBundleShortVersionString"] as? String ?? "?") (\(info?["CFBundleVersion"] as? String ?? "?"))"
        config.setURLSchemeHandler(ApexBundleSchemeHandler(root: indexURL.deletingLastPathComponent()),
                                   forURLScheme: ApexWebBundle.scheme)
        Self.enableLocalFileAccess(config)

        // A phone-sized frame until a window sizes it: a page started by the car's screen lays out as it would on the phone.
        let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 390, height: 844), configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = .launchPanel        // the launch screen's colour until the page's cover paints
        webView.scrollView.backgroundColor = .launchPanel
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
        #if DEBUG
        // Safari's Web Inspector reads page storage (the session token is in the Keychain, IDEAS Z-10): debug builds only.
        webView.isInspectable = true
        #endif
        webView.navigationDelegate = coordinator
        webView.uiDelegate = coordinator
        webView.hideKeyboardAccessoryBar()

        shell.attach(webView: webView)
        webView.load(URLRequest(url: shell.takePendingLink() ?? ApexWebBundle.entryURL))
        return webView
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
        // Only the app's own top-level page may drive the shell, never an embedded or navigated-to web page.
        guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.protocol == ApexWebBundle.scheme else { return }
        let body = message.body
        var command: String?
        var speechText: String?
        var interruptSpeech = false
        var speechStyle = "codriver"
        var speechDuck = true                                   // IDEAS V-08: the page says when a line may play over the music
        if let text = body as? String {
            command = text
        } else if let dict = body as? [String: Any] {
            command = (dict["cmd"] as? String) ?? (dict["command"] as? String) ?? (dict["type"] as? String)
            speechText = dict["text"] as? String
            interruptSpeech = (dict["force"] as? Bool) ?? false
            speechStyle = (dict["style"] as? String) ?? "codriver"
            speechDuck = (dict["duck"] as? Bool) ?? true
        }
        guard let cmd = command else { return }
        #if DEBUG
        if cmd == "said", let line = speechText {                    // review recordings: the transcript (web say())
            NSLog("APEX-SAID %@", line)
            return
        }
        #endif
        if cmd == "speak", let phrase = speechText {
            shell?.speakCoDriver(phrase, interrupt: interruptSpeech, style: speechStyle, duck: speechDuck)
            return
        }
        if cmd == "voiceBegin" {
            shell?.webVoiceBegin(duck: speechDuck)
            return
        }
        // A pace note or direction from the voice bank (web/voice.js nativePlay): the shell plays the clip files itself.
        if cmd == "clips", let dict = body as? [String: Any], let id = (dict["id"] as? NSNumber)?.intValue, let files = dict["files"] as? [String] {
            let gaps = ((dict["gaps"] as? [Any]) ?? []).map { ($0 as? NSNumber)?.doubleValue ?? 0 }
            shell?.playClips(id: id, files: files, gaps: gaps)
            return
        }
        // Following a build (web/builds.js): may Vetta notify about new steps? Asked at that moment, not at launch.
        if cmd == "notifyBuilds" {
            ApexBuildNotifier.requestPermission()
            return
        }
        // CarPlay (CarPlay/ApexCarPlay.swift): the route, the next maneuver and hazards for the car's screen.
        if cmd == "car", let dict = body as? [String: Any] {
            ApexCar.shared.receive(dict)
            return
        }
        // The drive's Live Activity (IDEAS U-11): the page starts, updates and ends it.
        if cmd == "activity", let dict = body as? [String: Any] {
            shell?.handleActivity(dict)
            return
        }
        // A tap with a call (IDEAS U-09): light for a pace note, a warning pattern for a hazard.
        // A file the page made (GPX, Download my data, a drive video): the share sheet, since a download link does nothing in
        // a web view. The name is cleaned to letters, digits, dot, dash and underscore; the file goes in the app's temp folder.
        if cmd == "shareFile", let dict = body as? [String: Any], let b64 = dict["data"] as? String, let data = Data(base64Encoded: b64) {
            shell?.shareFile(name: (dict["name"] as? String) ?? "ApexNav", data: data)
            return
        }
        if cmd == "haptic" {
            if (body as? [String: Any])?["kind"] as? String == "hazard" {
                UINotificationFeedbackGenerator().notificationOccurred(.warning)
            } else {
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
            }
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
            if cmd == "trafficProbe", let chunks = dict["chunks"] as? [[String: Any]] {
                // One entry per chunk, nil for a malformed one, so answers stay aligned with the page's chunks.
                let pairs: [(CLLocationCoordinate2D, CLLocationCoordinate2D)?] = chunks.map { c in
                    guard let a = c["a"] as? [String: Any], let b = c["b"] as? [String: Any],
                          let aLat = (a["lat"] as? NSNumber)?.doubleValue, let aLon = (a["lon"] as? NSNumber)?.doubleValue,
                          let bLat = (b["lat"] as? NSNumber)?.doubleValue, let bLon = (b["lon"] as? NSNumber)?.doubleValue else { return nil }
                    return (CLLocationCoordinate2D(latitude: aLat, longitude: aLon), CLLocationCoordinate2D(latitude: bLat, longitude: bLon))
                }
                shell?.trafficProbe(chunks: pairs, id: id)
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
    private var nodeVertPeakMps2: Double?   // largest >8 Hz vertical spike since the last 5 m node, nil when unmeasured
    private var fusion = ElevationFusion(baroAvailable: CMAltimeter.isRelativeAltitudeAvailable())
    private var odometer = Odometer5m()
    private var latestGravityG = Vec3(x: 0.0, y: -0.95, z: -0.30)   // CoreMotion gravity, phone frame, in g (points DOWN)
    private var thermal = ThermalGuard()   // IDEAS P-07: a critically hot phone pauses CoreMotion, IMU values go unknown

    // Recording
    private var isRecording = false
    #if DEBUG
    fileprivate var replay: ApexReplay?
    var replaying: Bool { replay != nil }
    #else
    let replaying = false
    #endif
    private var recordedSegments: Int = 0
    /// Largest acceleration magnitude (m/s^2, any mount, gravity removed) since the last live frame: the web's crash
    /// check (web/incident.js, IDEAS D-17) needs a hard impact, which no 5 m road value shows.
    private var frameImpactMps2: Double = 0
    private static let csvHeader = "segment_index,distance_m,lat,lon,elevation_m,speed_mph,lon_g,lat_g,camber_deg,crest_vertical_g,roughness_rms,engagement_score,grade_pct,vert_peak_g"
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
        configureVoiceSession()
        synth.delegate = self
        #if DEBUG
        replay = ApexReplay.start(shell: self)                // review recordings: a real drive instead of the sensors
        Self.reviewSignIn()                                   // U-66: before the page loads, so its first /api/me is the member's
        #endif
        if !replaying {
            locManager.startUpdatingLocation()
            startMotionPipeline()
        }
        NotificationCenter.default.addObserver(forName: ProcessInfo.thermalStateDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self else { return }
            MainActor.assumeIsolated { self.thermalChanged() }
        }
        thermalChanged()
        NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self else { return }
            MainActor.assumeIsolated { self.carRouteChanged() }
        }
        carRouteChanged()
        startPushTimer()
        // a drive never survives the process, so neither does its Live Activity: end any a killed launch left on the lock screen
        Self.endAllActivities()
        NotificationCenter.default.addObserver(forName: UIApplication.willTerminateNotification, object: nil, queue: .main) { _ in
            ApexSensorShell.endAllActivities(wait: true)
        }
    }

    // MARK: Web bridge

    func attach(webView: WKWebView) {
        self.webView = webView
        webReady = false
        observeKeyboard(webView)
        UIDevice.current.isBatteryMonitoringEnabled = true   // the battery level in each frame (IDEAS P-01): what an hour of driving costs
    }

    // MARK: The on-screen keyboard (review 2026-10-28)
    // WKWebView lays the keyboard over the page and pans its scroll view to show the focused field, even with scrolling off,
    // which pushed the plan sheet's own search field off the top. The pan is undone, and the page is told how much of it the
    // keyboard covers (web/keyboard.js), so it hides the tab bar and fits itself above the keyboard.
    private var keyboardObservers: [NSObjectProtocol] = []
    private var offsetObservation: NSKeyValueObservation?

    private func observeKeyboard(_ wv: WKWebView) {
        keyboardObservers.forEach { NotificationCenter.default.removeObserver($0) }
        let nc = NotificationCenter.default
        keyboardObservers = [
            nc.addObserver(forName: UIResponder.keyboardWillChangeFrameNotification, object: nil, queue: .main) { [weak self] note in
                let end = (note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue ?? .zero
                MainActor.assumeIsolated { self?.keyboardMoved(to: end) }
            },
            nc.addObserver(forName: UIResponder.keyboardWillHideNotification, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.keyboardMoved(to: .zero) }
            },
        ]
        offsetObservation = wv.scrollView.observe(\.contentOffset, options: [.new]) { sv, _ in
            guard sv.contentOffset != .zero else { return }
            DispatchQueue.main.async { sv.setContentOffset(.zero, animated: false) }
        }
    }

    private func keyboardMoved(to frame: CGRect) {
        guard let wv = webView else { return }
        var covered: CGFloat = 0
        if let window = wv.window, !frame.isEmpty {
            let mine = wv.convert(wv.bounds, to: nil), kb = window.convert(frame, from: nil)   // both in window coordinates
            covered = max(0, mine.maxY - kb.minY)
        }
        wv.scrollView.setContentOffset(.zero, animated: false)
        wv.evaluateJavaScript("window.ApexKeyboard && window.ApexKeyboard.native && window.ApexKeyboard.native(\(Int(covered.rounded()))); void 0;", completionHandler: nil)
    }

    /// A link that arrived before the web view existed (the app was launched by it) waits here for the first load.
    private var pendingLink: URL?
    func takePendingLink() -> URL? { defer { pendingLink = nil }; return pendingLink }

    func openLink(_ url: URL) {
        if url.isFileURL { openFile(url); return }
        guard let items = ApexWebBundle.linkItems(url) else { return }
        guard let entry = ApexWebBundle.linkEntryURL(items) else { return }
        guard let wv = webView else { pendingLink = entry; return }
        // The cockpit page takes the link in place (window.apex.onNative({type:'link'})): never reload it mid-drive. Any other
        // page (Log, Stages) has no window.apex, answers false, and the cockpit is loaded with the link instead.
        var params: [String: String] = [:]
        for item in items where params[item.name] == nil { params[item.name] = item.value }
        let payload: [String: Any] = ["type": "link", "params": params]
        guard webReady, let data = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: data, encoding: .utf8) else {
            webDidStartLoading()
            wv.load(URLRequest(url: entry))
            return
        }
        wv.evaluateJavaScript("(window.apex && window.apex.onNative) ? (window.apex.onNative(\(json)), true) : false") { [weak self, weak wv] result, _ in
            guard (result as? Bool) != true, let wv else { return }
            self?.webDidStartLoading()
            wv.load(URLRequest(url: entry))
        }
    }

    /// A GPX file from Files, Mail or AirDrop ("Open in ApexNav", IDEAS R-26): its text goes to the cockpit, which builds
    /// the route (web/route_import.js). Up to 5 MB; anything else is ignored.
    private var pendingGpx: [String: Any]?
    private func openFile(_ url: URL) {
        guard url.pathExtension.lowercased() == "gpx" else { return }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url), data.count <= 5_000_000, let text = String(data: data, encoding: .utf8) else { return }
        deliverGpx(["type": "gpx", "name": url.lastPathComponent, "text": text])
    }
    private func deliverGpx(_ payload: [String: Any]) {
        guard webReady, let wv = webView, let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { pendingGpx = payload; return }
        wv.evaluateJavaScript("window.apex && window.apex.onNative && window.apex.onNative(\(json)); void 0;", completionHandler: nil)
    }

    func webDidStartLoading() {
        webReady = false
    }

    func webDidFinishLoading() {
        webReady = true
        // what the driver picks on the car's screen goes to the page (CarPlay/ApexCarPlay.swift)
        ApexCar.shared.toPage = { [weak self] obj in self?.sendToPage(obj) }
        pushLiveFrame()
        offerDriveIfReady()
        if let g = pendingGpx { pendingGpx = nil; deliverGpx(g) }
        #if DEBUG
        reviewSetup()
        #endif
    }

    #if DEBUG
    /// Review recordings only (.github/workflows/app-review.yml, debug builds): APEX_REVIEW_SESSION signs in as the
    /// review account; APEX_REVIEW_ROUTE=1 hands the page the replayed road as a GPX (the real import path), so a guided
    /// drive follows the road the replay drives.
    /// U-66: the session used to be stored and announced in one script at the first didFinish, and the page stayed signed
    /// out for the whole flow. Now the Keychain holds it from launch (reviewSignIn, before the web view exists), so the
    /// page's own first /api/me is the member's, as for a member who signed in yesterday; and the page's "signed in"
    /// message is repeated until window.apex answers it (announceReviewSession), not fired once into a page that may not
    /// be listening yet.
    private static var reviewDone = false, reviewSessionAnnounced = false
    private static func reviewSignIn() {
        let review = (ProcessInfo.processInfo.environment["APEX_REVIEW_SESSION"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !review.isEmpty else { return }
        // A simulator whose Keychain refuses a test-launched app (errSecMissingEntitlement) still signs in: the bridge
        // reads the token from memory instead (ApexKeychain.reviewToken, debug builds only).
        if !ApexKeychain.setSession(review) { NSLog("APEX-REVIEW the Keychain refused the review session; kept in memory") }
        ApexKeychain.reviewToken = review
    }
    private func announceReviewSession(tries: Int = 40) {
        guard !Self.reviewSessionAnnounced, ApexKeychain.session() != nil, tries > 0 else { return }
        guard webReady, let wv = webView else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in self?.announceReviewSession(tries: tries - 1) }
            return
        }
        wv.evaluateJavaScript("(window.apex && window.apex.onNative) ? (window.apex.onNative({type:'session',signedIn:true}), true) : false") { [weak self] result, _ in
            guard let self else { return }
            if (result as? Bool) == true { Self.reviewSessionAnnounced = true; NSLog("APEX-REVIEW signed in as the review account"); return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in self?.announceReviewSession(tries: tries - 1) }
        }
    }
    private func reviewSetup() {
        announceReviewSession()                              // on every load until the page has taken it
        guard !Self.reviewDone else { return }
        Self.reviewDone = true
        let env = ProcessInfo.processInfo.environment
        if env["APEX_REVIEW_ROUTE"] == "1", let gpx = replay?.gpx() {
            DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in self?.deliverGpx(["type": "gpx", "name": "Dry Ridge Rd.gpx", "text": gpx]) }
        }
    }
    #endif

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
        case "signInApple":
            startAppleSignIn()
            return
        case "voiceBegin":                                    // the web cockpit is about to play a voice clip
            webVoiceBegin(duck: true)
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
    // apexnav://auth?code=... (single use, 2 min); the shell trades code + verifier for a session token and keeps it in
    // the Keychain; the page's /api calls go through ApexApiBridge, which adds it (IDEAS Z-10). No secrets in the bundle.
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
            guard ApexKeychain.setSession(token) else { signInFailed("error"); return }
            evaluate("window.apex && window.apex.onNative && window.apex.onNative({type:'session',signedIn:true}); void 0;")
        } catch {
            signInFailed("offline")
        }
    }

    // MARK: Live Activity (IDEAS U-11): next note, distance and time left on the lock screen and in the Dynamic Island.
    // It never outlives the drive (the owner, 2026-10-29: "live activities stay stuck on even after ending a route and
    // closing the app"): End ends every one of ours, not only the one this launch started (a page reload or a relaunch
    // forgets that one); launch and quit end any left over; and each update says it is stale two minutes on, so if the
    // app is killed mid-drive the lock screen shows it as out of date instead of a live-looking note.
    private var liveActivity: Activity<ApexDriveAttributes>?
    private static let activityStaleAfter: TimeInterval = 120

    private static func content(_ state: ApexDriveAttributes.ContentState) -> ActivityContent<ApexDriveAttributes.ContentState> {
        ActivityContent(state: state, staleDate: Date().addingTimeInterval(activityStaleAfter))
    }

    /// Ends every drive activity this app has on screen, now. `wait` blocks up to a second for it (app quitting).
    nonisolated static func endAllActivities(wait: Bool = false) {
        let all = Activity<ApexDriveAttributes>.activities
        guard !all.isEmpty else { return }
        let done = DispatchSemaphore(value: 0)
        Task.detached {
            for a in all { await a.end(nil, dismissalPolicy: .immediate) }
            done.signal()
        }
        if wait { _ = done.wait(timeout: .now() + 1) }
    }

    func handleActivity(_ dict: [String: Any]) {
        let state = ApexDriveAttributes.ContentState(note: (dict["note"] as? String) ?? "", distance: (dict["distance"] as? String) ?? "",
                                                     eta: (dict["eta"] as? String) ?? "", short: dict["short"] as? String,
                                                     hazard: dict["hazard"] as? Bool, etaShort: dict["etaShort"] as? String)
        #if DEBUG
        if let replay, let a = dict["action"] as? String { if a == "start" { replay.driving = true } else if a == "end" { replay.driving = false } }
        #endif
        switch dict["action"] as? String {
        case "start":
            guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
            if liveActivity == nil { liveActivity = Activity<ApexDriveAttributes>.activities.first }   // the page reloaded mid-drive
            if let activity = liveActivity { Task { await activity.update(Self.content(state)) }; return }
            liveActivity = try? Activity.request(attributes: ApexDriveAttributes(title: (dict["title"] as? String) ?? "Drive"),
                                                 content: Self.content(state), pushType: nil)
        case "update":
            if liveActivity == nil { liveActivity = Activity<ApexDriveAttributes>.activities.first }
            guard let activity = liveActivity else { return }
            Task { await activity.update(Self.content(state)) }
        case "end":
            liveActivity = nil
            Self.endAllActivities()
        default:
            break
        }
    }

    // MARK: Sign in with Apple (IDEAS O-05, App Review 4.8): the native sheet with the sha256 of a one-time nonce; the
    // Worker verifies the identity token's signature against Apple's keys, checks the nonce and returns a session token.
    private var appleSignIn: ApexAppleSignIn?

    private func startAppleSignIn() {
        guard appleSignIn == nil else { return }
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { signInFailed("error"); return }
        let nonce = Self.b64url(Data(bytes))
        let nonceHash = SHA256.hash(data: Data(nonce.utf8)).map { String(format: "%02x", $0) }.joined()
        let helper = ApexAppleSignIn(nonceHash: nonceHash) { [weak self] outcome in
            guard let self else { return }
            self.appleSignIn = nil
            switch outcome {
            case .token(let token, let name): Task { await self.appleExchange(idToken: token, nonce: nonce, name: name) }
            case .cancelled: self.signInFailed("cancelled")
            case .failed: self.signInFailed("error")
            }
        }
        appleSignIn = helper
        helper.start()
    }

    private func appleExchange(idToken: String, nonce: String, name: String?) async {
        var req = URLRequest(url: Self.apiBase.appendingPathComponent("api/auth/apple"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.setValue("1", forHTTPHeaderField: "x-apexnav")
        req.setValue("\(ApexWebBundle.scheme)://app", forHTTPHeaderField: "origin")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["id_token": idToken, "nonce": nonce, "name": name ?? ""])
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            guard (resp as? HTTPURLResponse)?.statusCode == 200,
                  let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let token = obj["token"] as? String,
                  token.range(of: "^[A-Za-z0-9_-]{20,200}$", options: .regularExpression) != nil else { signInFailed("error"); return }
            guard ApexKeychain.setSession(token) else { signInFailed("error"); return }
            evaluate("window.apex && window.apex.onNative && window.apex.onNative({type:'session',signedIn:true}); void 0;")
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

    // MARK: Traffic on the route ahead (MapKit, free, no key; web/traffic.js decides what it means)

    private var trafficProbeRunning = false

    /// For each chunk A->B of the route ahead, Apple's route leaving now (traffic-aware) and leaving at 3 am (Apple's quiet-road
    /// time), with both paths so the page can check Apple drove our road. One request at a time; MapKit throttling stops the
    /// round and says so, so the page backs off. Answered with window.apex.onNative({type:'trafficProbe'}).
    func trafficProbe(chunks: [(CLLocationCoordinate2D, CLLocationCoordinate2D)?], id: Int) {
        guard !trafficProbeRunning else { sendTrafficProbe(id: id, results: [], throttled: false, busy: true); return }
        trafficProbeRunning = true
        let night = Self.nextQuietDeparture()
        Task { @MainActor in
            var results: [[String: Any]] = []
            var throttled = false
            for chunk in chunks.prefix(6) {
                var entry: [String: Any] = [:]
                guard let pair = chunk else { results.append(entry); continue }
                let (a, b) = pair
                for (key, when) in [("now", Date()), ("night", night)] {
                    do {
                        if let leg = try await Self.appleRoute(from: a, to: b, leaving: when) { entry[key] = leg }
                    } catch let error as MKError where error.code == .loadingThrottled {
                        throttled = true
                    } catch { /* no answer for this leg: unknown stays unknown */ }
                    if throttled { break }
                }
                results.append(entry)
                if throttled { break }
            }
            trafficProbeRunning = false
            sendTrafficProbe(id: id, results: results, throttled: throttled, busy: false)
        }
    }

    /// The next 3 am local time at least 2 h away: Apple's expected time with light traffic.
    private static func nextQuietDeparture() -> Date {
        let cal = Calendar.current
        let soon = Date().addingTimeInterval(2 * 3600)
        return cal.nextDate(after: soon, matching: DateComponents(hour: 3, minute: 0), matchingPolicy: .nextTime) ?? soon.addingTimeInterval(86_400)
    }

    private static func appleRoute(from a: CLLocationCoordinate2D, to b: CLLocationCoordinate2D, leaving: Date) async throws -> [String: Any]? {
        let req = MKDirections.Request()
        req.source = MKMapItem(placemark: MKPlacemark(coordinate: a))
        req.destination = MKMapItem(placemark: MKPlacemark(coordinate: b))
        req.transportType = .automobile
        req.requestsAlternateRoutes = false
        req.departureDate = leaving
        let response = try await MKDirections(request: req).calculate()
        guard let route = response.routes.first else { return nil }
        let n = route.polyline.pointCount
        var coords = [CLLocationCoordinate2D](repeating: kCLLocationCoordinate2DInvalid, count: n)
        route.polyline.getCoordinates(&coords, range: NSRange(location: 0, length: n))
        let stride = max(1, n / 200)                     // enough to check the path follows ours, small over the bridge
        var lat: [Double] = [], lon: [Double] = []
        for i in Swift.stride(from: 0, to: n, by: stride) { lat.append(coords[i].latitude); lon.append(coords[i].longitude) }
        if n > 0, (n - 1) % stride != 0 { lat.append(coords[n - 1].latitude); lon.append(coords[n - 1].longitude) }
        return ["s": route.expectedTravelTime, "lat": lat, "lon": lon]
    }

    private func sendTrafficProbe(id: Int, results: [[String: Any]], throttled: Bool, busy: Bool) {
        let payload: [String: Any] = ["type": "trafficProbe", "id": id, "results": results, "throttled": throttled, "busy": busy]
        guard let data = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: data, encoding: .utf8) else { return }
        evaluate("window.apex && window.apex.onNative && window.apex.onNative(\(json)); void 0;")
    }

    /// A message to the page's onNative, as JSON.
    func sendToPage(_ obj: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: obj), let json = String(data: data, encoding: .utf8) else { return }
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
        let vertPeak = pipeline.takeVertPeak()   // this frame's spike window; the web Recorder places it on the road
        let impact = frameImpactMps2; frameImpactMps2 = 0
        if hasFix { ApexCar.shared.position(lat: latDeg, lon: lonDeg, course: courseDeg ?? -1) }   // the car's maps (CarPlay), even before the page is ready
        guard webReady, webView != nil else { return }
        let live = imuLive   // false while the thermal guard has motion paused: g, camber, crest and roughness are unknown
        func imu(_ v: Double) -> Double? { live ? v : nil }
        let json = "{"
            + "\"lat\":\(Self.num(hasFix ? latDeg : nil, 7)),"
            + "\"lon\":\(Self.num(hasFix ? lonDeg : nil, 7)),"
            + "\"accuracy_m\":\(Self.num(hasFix ? accuracyM : nil, 1)),"
            + "\"speed_mps\":\(Self.num(speedMps, 2)),"
            + "\"course_deg\":\(Self.num(courseDeg, 1)),"
            + "\"elevation_m\":\(Self.num(fusion.elevationM, 2)),"
            + "\"grade_pct\":\(Self.num(odometer.gradePct, 2)),"
            + "\"lat_g\":\(Self.num(imu(pipeline.latAccMps2 / Self.gStd), 3)),"
            + "\"lon_g\":\(Self.num(imu(pipeline.lonAccMps2 / Self.gStd), 3)),"
            + "\"camber_deg\":\(Self.num(imu(pipeline.camberRad * 180.0 / Double.pi), 2)),"
            + "\"crest_vertical_g\":\(Self.num(imu(pipeline.crestAccMps2 / Self.gStd), 3)),"
            + "\"roughness_rms\":\(Self.num(imu(pipeline.roughRMSMps2 / Self.gStd), 4)),"
            + "\"vert_peak_g\":\(Self.num(imu(vertPeak / Self.gStd), 3)),"
            + "\"impact_g\":\(Self.num(imu(impact / Self.gStd), 2)),"
            + "\"recording\":\(isRecording ? "true" : "false"),"
            + "\"calibration\":\"\(live ? pipeline.mount.state.rawValue : "paused")\","
            + "\"thermal\":\(thermal.level),"
            + "\"low_power_mode\":\(ProcessInfo.processInfo.isLowPowerModeEnabled ? "true" : "false"),"
            + "\"battery\":\(Self.num(UIDevice.current.batteryLevel >= 0 ? Double(UIDevice.current.batteryLevel) : nil, 2)),"
            + "\"charging\":\(UIDevice.current.batteryState == .charging || UIDevice.current.batteryState == .full ? "true" : "false"),"
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
            if !self.replaying { self.locManager.startUpdatingLocation() }
        }
    }

    fileprivate func ingest(fix: GPSFix) {
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
        // A 1 Hz fix can close several nodes; in this CSV they share the spike, like roughness (the web Recorder places it per frame).
        for node in nodes { record(node, vertPeakMps2: nodeVertPeakMps2) }
        if !nodes.isEmpty { nodeVertPeakMps2 = nil }
    }

    private func record(_ node: RoadNode, vertPeakMps2: Double?) {
        guard isRecording else { return }
        let idx = recordedSegments
        // Blank, never 0, for what is not measured: chassis-frame values need a solved mount (an unsolved one would put
        // braking into lateral g and skew the score), elevation needs a fix with altitude.
        let locked = imuLive && pipeline.mount.state == .locked
        let vertical = imuLive && pipeline.mount.state != .default   // roughness needs only the road vertical
        func cell(_ v: Double?, _ digits: Int) -> String {
            guard let v = v, v.isFinite else { return "" }
            return String(format: "%.\(digits)f", v)
        }
        let cells: [String] = [
            String(idx),
            cell(Double(idx) * ApexKit.segmentLengthM, 1),
            cell(node.lat, 7),
            cell(node.lon, 7),
            cell(node.elevationM, 2),
            cell(speedMps * 2.2369362921, 2),
            cell(locked ? pipeline.lonAccMps2 / Self.gStd : nil, 4),
            cell(locked ? pipeline.latAccMps2 / Self.gStd : nil, 4),
            cell(locked ? pipeline.camberRad * 180.0 / Double.pi : nil, 2),
            cell(locked ? pipeline.crestAccMps2 / Self.gStd : nil, 4),
            cell(vertical ? node.roughRMSMps2 / Self.gStd : nil, 4),
            cell(locked ? pipeline.engagement : nil, 3),
            cell(node.elevationM == nil ? nil : node.gradePct, 2),
            cell(vertPeakMps2.map { $0 / Self.gStd }, 3),
        ]
        csvLines.append(cells.joined(separator: ","))
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
        startDeviceMotion()
    }

    private func startDeviceMotion() {
        guard motionManager.isDeviceMotionAvailable, !motionManager.isDeviceMotionActive else { return }
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

    /// Thermal guard (ApexKit.ThermalGuard): critical stops the 100 Hz pipeline, fair or cooler restarts it. GPS, map,
    /// recording and pace notes carry on; motion values are sent and recorded as unknown while paused and settling.
    private func thermalChanged() {
        let level = ProcessInfo.processInfo.thermalState.rawValue
        guard thermal.update(level: level, t: ProcessInfo.processInfo.systemUptime) else { return }
        if thermal.paused {
            motionManager.stopDeviceMotionUpdates()
            nodeVertPeakMps2 = nil
        } else {
            startDeviceMotion()
        }
    }

    private var imuLive: Bool { thermal.imuLive(t: ProcessInfo.processInfo.systemUptime) }

    fileprivate func ingestMotion(gravityG: Vec3, accelMps2 a: Vec3, gyroRadS w: Vec3, timestamp: Double) {
        latestGravityG = gravityG
        frameImpactMps2 = max(frameImpactMps2, (a.x * a.x + a.y * a.y + a.z * a.z).squareRoot())
        // Calibration is automatic and continuous (ApexKit.MountCalibrator): gravity gives the vertical, GPS speed and
        // turns give forward, a moved phone drops back to unknown. Silent; the frame's "calibration" field shows the state.
        let wasLocked = pipeline.mount.state == .locked
        pipeline.step(accel: a, gyro: w, timestamp: timestamp, speedMps: speedMps, gravityG: gravityG)
        if !wasLocked && pipeline.mount.state == .locked { persistMount() }
        // Pothole evidence only in a solved chassis frame and while rolling (a door slam at a stop is not road).
        if imuLive && pipeline.mount.state == .locked && speedMps >= 1.0 {   // not while settling after a thermal pause
            nodeVertPeakMps2 = max(nodeVertPeakMps2 ?? 0.0, abs(pipeline.hpVert))
        }
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

    func shareFile(name: String, data: Data) {
        var clean = ""
        for c in name.unicodeScalars where CharacterSet.alphanumerics.contains(c) || ".-_".unicodeScalars.contains(c) {
            if clean.unicodeScalars.count >= 80 { break }
            clean.unicodeScalars.append(c)
        }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(clean.isEmpty || clean.hasPrefix(".") ? "ApexNav-file" : clean)
        do {
            try data.write(to: url, options: .atomic)
            shareItem = CSVShareItem(url: url)
        } catch {
            evaluate("window.apex && window.apex.onNative && window.apex.onNative({type:'shareFailed'}); void 0;")
        }
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

    func speakCoDriver(_ phrase: String, interrupt: Bool = false, style: String = "codriver", duck: Bool = true) {
        speak(phrase, interrupt: interrupt, style: style, duck: duck)
    }

    /// A web voice clip is about to play. The page waits for the answer (`promptStyle`) and skips the clip unless it's
    /// "normal": CarPlay asks navigation apps to stay silent during a call or Siri, or to play only a tone.
    func webVoiceBegin(duck: Bool) {
        let style = currentPromptStyle(duck: duck)
        switch style {
        case AVAudioSession.PromptStyle.none:
            break
        case AVAudioSession.PromptStyle.short:
            playPromptTone()
        default:
            webVoiceActive = true
            beginVoice(duck: duck)
        }
        let name = style == AVAudioSession.PromptStyle.none ? "none" : style == AVAudioSession.PromptStyle.short ? "short" : "normal"
        evaluate("window.apex && window.apex.onNative && window.apex.onNative({type:'promptStyle',style:'\(name)'}); void 0;")
    }

    /// The voice bank's clips, played here rather than by the page's WebAudio, which WebKit stops while the phone is locked.
    /// Only files under the bundle's web/voices/ are played; the page hears back through ApexVoice.nativeDone(id, ok).
    private let clipPlayer = ApexClipPlayer()
    func playClips(id: Int, files: [String], gaps: [Double]) {
        guard let root = ApexWebBundle.indexURL?.deletingLastPathComponent().standardizedFileURL else { return clipsDone(id, false) }
        let voices = root.appendingPathComponent("voices").path + "/"
        let urls = files.compactMap { f -> URL? in
            let u = root.appendingPathComponent(f).standardizedFileURL
            return u.path.hasPrefix(voices) ? u : nil
        }
        guard urls.count == files.count, !urls.isEmpty else { return clipsDone(id, false) }
        clipPlayer.play(urls, gaps: gaps) { [weak self] ok in self?.clipsDone(id, ok) }
    }
    private func clipsDone(_ id: Int, _ ok: Bool) {
        evaluate("window.ApexVoice && window.ApexVoice.nativeDone && window.ApexVoice.nativeDone(\(id), \(ok)); void 0;")
    }

    private static let robotVoiceNames = ["Zarvox", "Trinoids", "Fred", "Ralph", "Cellos"]

    /// Co-driver: the highest-quality English voice installed (Premium > Enhanced > default),
    /// British first; never a novelty robot voice.
    private static func voice(for style: String) -> AVSpeechSynthesisVoice? {
        let all = AVSpeechSynthesisVoice.speechVoices()
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

    // MARK: Car connection (IDEAS C-05)
    // Joining CarPlay (an audio route to .carAudio) offers Start drive in the cockpit, once per connection. It never starts
    // recording by itself. A plain Bluetooth stream can't be told apart from headphones, so only CarPlay counts. For a fully
    // automatic start, a Shortcuts automation ("When CarPlay connects") can open apexnav://open?go=drive.
    private var inCar = false
    private var carOfferPending = false

    private func carRouteChanged() {
        let now = AVAudioSession.sharedInstance().currentRoute.outputs.contains { $0.portType == .carAudio }
        guard now != inCar else { return }
        inCar = now
        carOfferPending = now
        offerDriveIfReady()
    }

    /// Only the cockpit page has window.apex: on the Log or Stages page the offer stays pending until the cockpit loads again.
    private func offerDriveIfReady() {
        guard carOfferPending, webReady, let wv = webView else { return }
        carOfferPending = false
        wv.evaluateJavaScript("(window.apex && window.apex.onNative) ? (window.apex.onNative({type:'car',via:'carplay'}), true) : false") { [weak self] result, _ in
            guard let self, (result as? Bool) != true else { return }
            self.carOfferPending = self.inCar
        }
    }

    // MARK: Voice audio: car stereo, CarPlay audio, Bluetooth
    // A navigation app's prompts: .playback + .voicePrompt, ducking music and pausing podcasts only while a prompt plays.
    // The session is active only while speaking: an always-active session kept the car's music ducked, and many head units
    // switch to the phone's Bluetooth stream (or raise CarPlay audio) only when the app starts audio. The web cockpit's
    // voice clips (WebAudio) share this session and bracket themselves with voiceBegin / voiceEnd.
    private var webVoiceActive = false

    // IDEAS V-08: a low-priority line in cruise (a route or traffic phrase) plays over the music at its own level instead of
    // ducking it; pace notes, hazards, directions and anything spirited duck. The page decides (ApexSpeechQueue.ducks).
    private func configureVoiceSession(duck: Bool = true) {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .voicePrompt,
                                                         options: duck ? [.duckOthers, .interruptSpokenAudioAndMixWithOthers] : [.mixWithOthers])
    }

    private func beginVoice(duck: Bool = true) {
        configureVoiceSession(duck: duck)                      // WebKit may have changed the category for its own media
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    // CarPlay Developer Guide, Voice prompts: check the session's promptStyle just before each prompt. None (a phone call,
    // Siri listening): say nothing. Short: a tone instead of words. Normal: the full prompt. It is read with the session set
    // up for prompts, which is when the system fills it in.
    private func currentPromptStyle(duck: Bool) -> AVAudioSession.PromptStyle {
        configureVoiceSession(duck: duck)
        return AVAudioSession.sharedInstance().promptStyle
    }

    private var tonePlayer: AVAudioPlayer?
    private static let promptTone: Data = {
        // 0.15 s at 880 Hz, 16-bit mono PCM with a soft start and end, as a WAV made in memory (no bundled sound file)
        let rate = 22050, n = rate * 15 / 100
        var pcm = Data(capacity: n * 2)
        for i in 0..<n {
            let env = min(1.0, Double(i) / 300.0, Double(n - i) / 600.0)
            let v = Int16(sin(2.0 * Double.pi * 880.0 * Double(i) / Double(rate)) * env * 12000.0)
            withUnsafeBytes(of: v.littleEndian) { pcm.append(contentsOf: $0) }
        }
        var wav = Data()
        func u32(_ x: Int) { withUnsafeBytes(of: UInt32(x).littleEndian) { wav.append(contentsOf: $0) } }
        func u16(_ x: Int) { withUnsafeBytes(of: UInt16(x).littleEndian) { wav.append(contentsOf: $0) } }
        wav.append(contentsOf: Array("RIFF".utf8)); u32(36 + pcm.count); wav.append(contentsOf: Array("WAVE".utf8))
        wav.append(contentsOf: Array("fmt ".utf8)); u32(16); u16(1); u16(1); u32(rate); u32(rate * 2); u16(2); u16(16)
        wav.append(contentsOf: Array("data".utf8)); u32(pcm.count); wav.append(pcm)
        return wav
    }()

    private func playPromptTone() {
        beginVoice(duck: true)
        tonePlayer = try? AVAudioPlayer(data: Self.promptTone)
        tonePlayer?.play()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
            self?.tonePlayer = nil
            self?.endVoiceIfIdle()
        }
    }

    fileprivate func endVoiceIfIdle() {
        guard !synth.isSpeaking, !webVoiceActive else { return }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func speak(_ phrase: String, interrupt: Bool = false, style: String = "codriver", duck: Bool = true) {
        // AVSpeechSynthesizer queues utterances itself; only a forced call cuts in.
        // (The web cockpit decides which notes are still worth calling.)
        if interrupt && synth.isSpeaking {
            synth.stopSpeaking(at: .word)
        }
        switch currentPromptStyle(duck: duck) {
        case AVAudioSession.PromptStyle.none:
            endVoiceIfIdle()
            return
        case AVAudioSession.PromptStyle.short:
            playPromptTone()
            return
        default:
            break
        }
        beginVoice(duck: duck)
        let utterance = AVSpeechUtterance(string: phrase)
        utterance.voice = Self.voice(for: style)
        utterance.rate = 0.54
        utterance.pitchMultiplier = 1.0
        synth.speak(utterance)
    }
}

extension UIColor {
    /// The night panel colour (#151310): the launch screen (Assets LaunchBackground), the shell behind the web view and the
    /// page's opening cover all match, so opening the app never flashes another colour.
    static let launchPanel = UIColor(red: 0x15 / 255.0, green: 0x13 / 255.0, blue: 0x10 / 255.0, alpha: 1)
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

/// Plays a voice-bank call (one to a few clips) back to back with the page's gaps between them, in the voice session the
/// page opened with voiceBegin. A new call stops the one playing (the page sends one call at a time; a hazard can cut in).
@MainActor
final class ApexClipPlayer: NSObject, AVAudioPlayerDelegate {
    private var queue: [(player: AVAudioPlayer, gap: Double)] = []
    private var current: AVAudioPlayer?
    private var done: ((Bool) -> Void)?

    func play(_ files: [URL], gaps: [Double], done: @escaping (Bool) -> Void) {
        finish(false)
        var players: [(player: AVAudioPlayer, gap: Double)] = []
        for (i, url) in files.enumerated() {
            guard let p = try? AVAudioPlayer(contentsOf: url) else { done(false); return }
            p.prepareToPlay()
            players.append((p, i > 0 && i < gaps.count ? max(0, gaps[i]) : 0))
        }
        queue = players
        self.done = done
        next()
    }

    private func next() {
        guard !queue.isEmpty else { finish(true); return }
        let (p, gap) = queue.removeFirst()
        p.delegate = self
        current = p
        let started = gap > 0 ? p.play(atTime: p.deviceCurrentTime + gap) : p.play()
        if !started { finish(false) }
    }

    private func finish(_ ok: Bool) {
        current?.stop()
        current = nil
        queue = []
        let d = done
        done = nil
        d?(ok)
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in
            guard player === self.current else { return }
            if flag { self.next() } else { self.finish(false) }
        }
    }

    nonisolated func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        Task { @MainActor in if player === self.current { self.finish(false) } }
    }
}

/// Runs Apple's sign-in sheet once and reports the identity token (and the name, which Apple gives only the first time).
@MainActor
final class ApexAppleSignIn: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    enum Outcome { case token(String, String?), cancelled, failed }
    private let nonceHash: String
    private let done: (Outcome) -> Void
    private var controller: ASAuthorizationController?

    init(nonceHash: String, done: @escaping (Outcome) -> Void) {
        self.nonceHash = nonceHash
        self.done = done
    }

    func start() {
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.fullName, .email]
        request.nonce = nonceHash
        let c = ASAuthorizationController(authorizationRequests: [request])
        c.delegate = self
        c.presentationContextProvider = self
        controller = c
        c.performRequests()
    }

    nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        let credential = authorization.credential as? ASAuthorizationAppleIDCredential
        let token = credential?.identityToken.flatMap { String(data: $0, encoding: .utf8) }
        let name = credential?.fullName.map { PersonNameComponentsFormatter().string(from: $0) }.flatMap { $0.isEmpty ? nil : $0 }
        MainActor.assumeIsolated {
            self.controller = nil
            if let token { done(.token(token, name)) } else { done(.failed) }
        }
    }

    nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        let cancelled = (error as? ASAuthorizationError)?.code == .canceled
        MainActor.assumeIsolated {
            self.controller = nil
            done(cancelled ? .cancelled : .failed)
        }
    }

    nonisolated func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first ?? ASPresentationAnchor()
        }
    }
}

// MARK: Session in the Keychain (IDEAS Z-10)

/// The app's session token: this device only, readable after the first unlock (a drive can start from the lock screen).
enum ApexKeychain {
    private static let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                               kSecAttrService as String: "com.senft.ApexNav.session",
                                               kSecAttrAccount as String: "session"]

    #if DEBUG
    /// Review recordings only (ApexSensorShell.reviewSignIn): the review account's session, for a simulator whose Keychain
    /// will not hold it. Any sign-in or sign-out (setSession) forgets it.
    nonisolated(unsafe) static var reviewToken: String?
    #endif

    static func session() -> String? {
        #if DEBUG
        if let t = reviewToken { return t }
        #endif
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    @discardableResult
    static func setSession(_ token: String?) -> Bool {
        #if DEBUG
        reviewToken = nil
        #endif
        SecItemDelete(query as CFDictionary)
        guard let token else { return true }
        guard token.range(of: "^[A-Za-z0-9_-]{20,200}$", options: .regularExpression) != nil else { return false }
        var q = query
        q[kSecValueData as String] = Data(token.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(q as CFDictionary, nil) == errSecSuccess
    }
}

/// /api/* for the page (web/sync.js apiFetch): the request goes out from here with the Keychain's bearer token and the
/// answer comes back as { status, type, body }. Also takes the session over from older builds' page storage (`adopt`),
/// forgets it (`signOut`) and says whether there is one (`hasSession`). Only the app's own top-level page is answered.
@MainActor
final class ApexApiBridge: NSObject, WKScriptMessageHandlerWithReply {
    private static let base = "https://apexnav.senftns.workers.dev"
    private static let userAgent: String = {
        let info = Bundle.main.infoDictionary
        return "ApexNav/\(info?["CFBundleShortVersionString"] as? String ?? "?") (\(info?["CFBundleVersion"] as? String ?? "?"))"
    }()

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.protocol == ApexWebBundle.scheme,
              let dict = message.body as? [String: Any] else { replyHandler(nil, "refused"); return }
        switch dict["cmd"] as? String {
        case "adopt":
            replyHandler(ApexKeychain.setSession(dict["token"] as? String), nil)
        case "signOut":
            replyHandler(ApexKeychain.setSession(nil), nil)
        case "hasSession":
            replyHandler(ApexKeychain.session() != nil, nil)
        case "fetch":
            guard let path = dict["path"] as? String, path.hasPrefix("/api/"), !path.contains(".."), !path.contains("//"),
                  let url = URL(string: Self.base + path) else { replyHandler(nil, "bad_path"); return }
            var req = URLRequest(url: url, timeoutInterval: 30)
            req.httpMethod = ((dict["method"] as? String) ?? "GET").uppercased()
            for (k, v) in (dict["headers"] as? [String: String]) ?? [:] where ["content-type", "x-apexnav"].contains(k.lowercased()) {
                req.setValue(v, forHTTPHeaderField: k)
            }
            req.setValue("1", forHTTPHeaderField: "x-apexnav")
            req.setValue("\(ApexWebBundle.scheme)://app", forHTTPHeaderField: "origin")
            req.setValue(Self.userAgent, forHTTPHeaderField: "user-agent")
            if let token = ApexKeychain.session() { req.setValue("Bearer \(token)", forHTTPHeaderField: "authorization") }
            if let body = dict["body"] as? String { req.httpBody = Data(body.utf8) }
            // a photo (backend/src/photos.ts) crosses the bridge as base64, both ways; text stays text
            if let b64 = dict["bodyBase64"] as? String, let data = Data(base64Encoded: b64) { req.httpBody = data }
            Task {
                do {
                    let (data, resp) = try await URLSession.shared.data(for: req)
                    let http = resp as? HTTPURLResponse
                    let type = http?.value(forHTTPHeaderField: "content-type") ?? ""
                    if type.hasPrefix("image/") {
                        replyHandler(["status": http?.statusCode ?? 0, "type": type, "bodyBase64": data.base64EncodedString()], nil)
                    } else {
                        replyHandler(["status": http?.statusCode ?? 0, "type": type, "body": String(data: data, encoding: .utf8) ?? ""], nil)
                    }
                } catch {
                    replyHandler(nil, "offline")
                }
            }
        default:
            replyHandler(nil, "unknown")
        }
    }
}

#if DEBUG
/// Review recordings only (.github/workflows/app-review.yml; never in a release build): APEX_REPLAY=dry_ridge plays the
/// bundled demo drive, a real one (iPhone 15 Pro, 24 Oct 2026, 57 km of 5 m segments), through the shell's own GPS and
/// motion handlers, because the simulator has no motion sensors and simctl's GPS only runs straight lines. The phone's
/// 100 Hz motion is rebuilt from what the drive measured: its forces and yaw turned back into the phone frame by its
/// mount, gravity tilted by the measured camber and grade, vertical vibration at the measured roughness. The pipeline
/// must find the mount, the banking and the roughness again, as in a car. Parked at the start until a drive starts (the
/// page's Live Activity start), then at the recorded speeds; parked again when it ends. A review account keeps Share
/// road feel off, so none of this is ever sent as measured road data (CLAUDE.md rule 3).
/// APEX_REPLAY_FROM=<km> (REVIEW4 §6.1) parks it that far along the drive instead of at its start: the drive spends its
/// first 21 km on Colerain Avenue and I-275, and a seven-minute flow never reached the corners. 19.8 is a mile before the
/// first of them (the exit ramp at 21.4 km; Dry Ridge Rd's corners run to 34.1 km). The GPX (gpx()) starts there too.
@MainActor final class ApexReplay {
    private struct Row { let lat, lon, ele, grade, mps, lonG, latG, camberDeg, crestG, rough: Double }
    private weak var shell: ApexSensorShell?
    private let rows: [Row]
    private let mount: [[Double]]
    private let fromRow: Int                                   // APEX_REPLAY_FROM, as a row of the drive
    private var distM = 0.0, lastFix = 0.0, timer: Timer?
    var driving = false

    static func start(shell: ApexSensorShell) -> ApexReplay? {
        guard let name = ProcessInfo.processInfo.environment["APEX_REPLAY"], name.range(of: "^[a-z_]{1,40}$", options: .regularExpression) != nil,
              let index = ApexWebBundle.indexURL,
              let text = try? String(contentsOf: index.deletingLastPathComponent().appendingPathComponent("data/\(name).js"), encoding: .utf8),
              let open = text.range(of: "push("), let close = text.range(of: ")", options: .backwards),
              let data = String(text[open.upperBound..<close.lowerBound]).data(using: .utf8),
              let drive = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let fields = drive["fields"] as? [String], let raw = drive["rows"] as? [[Any]],
              let mount = drive["mount_R"] as? [[Double]], mount.count == 3 else { return nil }
        func col(_ f: String) -> Int? { fields.firstIndex(of: f) }
        guard let iLat = col("lat"), let iLon = col("lon"), let iSpeed = col("speed_mph") else { return nil }
        let num = { (r: [Any], i: Int?) -> Double in (i.flatMap { $0 < r.count ? r[$0] as? Double : nil }) ?? 0 }
        let rows = raw.map { r in Row(lat: num(r, iLat), lon: num(r, iLon), ele: num(r, col("elevation_m")), grade: num(r, col("grade_pct")),
                                      mps: num(r, iSpeed) / 2.23694, lonG: num(r, col("lon_g")), latG: num(r, col("lat_g")),
                                      camberDeg: num(r, col("camber_deg")), crestG: num(r, col("crest_vertical_g")), rough: num(r, col("roughness_rms"))) }
        guard rows.count > 2 else { return nil }
        let fromKm = Double(ProcessInfo.processInfo.environment["APEX_REPLAY_FROM"] ?? "") ?? 0
        let fromRow = min(rows.count - 3, max(0, Int((fromKm.isFinite ? fromKm : 0) * 1000 / 5)))
        let r = ApexReplay(shell: shell, rows: rows, mount: mount, fromRow: fromRow)
        r.timer = Timer.scheduledTimer(withTimeInterval: 0.01, repeats: true) { [weak r] _ in MainActor.assumeIsolated { r?.tick() } }
        return r
    }

    private init(shell: ApexSensorShell, rows: [Row], mount: [[Double]], fromRow: Int) {
        self.shell = shell; self.rows = rows; self.mount = mount; self.fromRow = fromRow
        distM = Double(fromRow) * 5
    }

    /// The replayed road as a GPX track (a point every 20 m), for a guided drive along it: from where the replay starts
    /// (APEX_REPLAY_FROM) to the end, so the route begins under the car, as a route planned from here would.
    func gpx() -> String {
        var pts = ""
        for (k, r) in rows.enumerated() where k >= fromRow && ((k - fromRow) % 4 == 0 || k == rows.count - 1) {
            pts += String(format: "<trkpt lat=\"%.6f\" lon=\"%.6f\"><ele>%.1f</ele></trkpt>", r.lat, r.lon, r.ele)
        }
        return "<?xml version=\"1.0\"?><gpx version=\"1.1\" creator=\"Vetta review\"><trk><name>Dry Ridge Rd</name><trkseg>\(pts)</trkseg></trk></gpx>"
    }

    private func rotate(_ v: [Double]) -> Vec3 {
        Vec3(x: mount[0][0] * v[0] + mount[0][1] * v[1] + mount[0][2] * v[2],
             y: mount[1][0] * v[0] + mount[1][1] * v[1] + mount[1][2] * v[2],
             z: mount[2][0] * v[0] + mount[2][1] * v[1] + mount[2][2] * v[2])
    }
    private func gauss() -> Double { (-2 * log(Double.random(in: 1e-9..<1))).squareRoot() * cos(2 * .pi * Double.random(in: 0..<1)) }

    private func tick() {
        guard let shell else { timer?.invalidate(); return }
        let t = ProcessInfo.processInfo.systemUptime, dt = 0.01, g = ApexKit.gStd
        let i = min(rows.count - 2, Int(distM / 5)), f = min(1, max(0, distM / 5 - Double(i)))
        let a = rows[i], b = rows[i + 1]
        let mix = { (x: Double, y: Double) in x + (y - x) * f }
        let mps = driving ? max(1, mix(a.mps, b.mps)) : 0
        if driving { distM += mps * dt; if Int(distM / 5) >= rows.count - 2 { driving = false } }
        // the vehicle frame (ISO 8855: x forward, y left, z up): measured forces, and gravity tilted by camber and grade
        let roll = mix(a.camberDeg, b.camberDeg) * .pi / 180, pitch = atan(mix(a.grade, b.grade) / 100)
        let moving = mps > 0.5
        let force = [moving ? mix(a.lonG, b.lonG) * g : 0, moving ? mix(a.latG, b.latG) * g : 0,
                     (moving ? mix(a.crestG, b.crestG) + mix(a.rough, b.rough) * gauss() : 0.002 * gauss()) * g]
        let gravity = [-sin(pitch), sin(roll), -cos(roll) * cos(pitch)]
        let yaw = moving ? mix(a.latG, b.latG) * g / max(mps, 1) : 0
        shell.ingestMotion(gravityG: rotate(gravity), accelMps2: rotate(force), gyroRadS: rotate([0, 0, yaw]), timestamp: t)
        guard t - lastFix >= 1 else { return }
        lastFix = t
        let course = (atan2((b.lon - a.lon) * cos(a.lat * .pi / 180), b.lat - a.lat) * 180 / .pi + 360).truncatingRemainder(dividingBy: 360)
        shell.ingest(fix: GPSFix(lat: mix(a.lat, b.lat), lon: mix(a.lon, b.lon), altitudeM: mix(a.ele, b.ele), horizontalAccuracyM: 5,
                                 verticalAccuracyM: 8, speedMps: mps, courseDeg: moving ? course : -1))
    }
}
#endif
