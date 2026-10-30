// CarPlay (IDEAS C-01, C-02; docs/CARPLAY.md; mockups in docs/design/carplay): the navigation flow on the car's screen.
//
// The cockpit page stays the single brain (ApexEngine, ApexNavApp.swift: it runs whether or not the phone's window was ever
// opened). It plans routes, places the maneuvers, calls notes and hazards and speaks; CarPlay shows what it decides and
// sends back what the driver picks. Page -> car: `{cmd:'car', kind:...}` messages (route, clear, start, guide, sight, end, hazard, ask,
// places, corners, hazards, look), handled by ApexCar.receive. Car -> page: `onNative({type:'carplay', action})` with go,
// pick, start, end, loop, report, still, voice, places, hello.
//
// What Apple leaves to the app, we draw: the base view is our own map in the phone's theme (web/carmap.html, the same
// OpenFreeMap style and palettes as the phone) with the route, every corner's rating at its apex and the hazard plates; the
// maneuver symbols are the road book's tulips; the guidance card takes the theme's dark. Everything you touch is Apple's
// templates. Nothing in the car shows scores, social features or settings, and nothing asks the driver to use the phone
// (CarPlay Developer Guide, "Guidelines for all CarPlay apps").

import CarPlay
import MapKit
import UIKit
import WebKit

// MARK: - The hub between the page and the car's screens

@MainActor
final class ApexCar {
    static let shared = ApexCar()

    /// Sends a message to the page (set by the shell once the page is ready). What the car sent before that waits here:
    /// a car that opened the app cold asks for a route while the cockpit page is still loading.
    var toPage: (([String: Any]) -> Void)? {
        didSet { if let toPage { let q = waiting; waiting = []; q.forEach(toPage) } }
    }
    private var waiting: [[String: Any]] = []
    /// The connected car screen, if any.
    weak var scene: ApexCarPlaySceneDelegate?
    /// Every car map showing now: the main screen, the Dashboard, the instrument cluster.
    private var maps: [WeakMap] = []
    private struct WeakMap { weak var map: ApexCarMapViewController? }

    struct Option { let summary: String; let detail: String; let timeS: Double?; let distM: Double? }
    struct Route { let name: String; let coords: [CLLocationCoordinate2D]; let dest: CLLocationCoordinate2D; let options: [Option]; let picked: Int }
    /// The card's maneuver. `distM` is nil only for a free drive's record card (`recording`), which has no maneuver to count down to.
    struct Guide { let key: String; let instruction: String; let street: String; let type: Int; let distM: Double?; let timeS: Double?; let remainM: Double?; let remainS: Double?; let symbol: UIImage?; var recording = false }
    /// U-59: a free drive's card until the page's first guide message (web/carplay.js recordingMessage) says how far it has gone.
    static let recordingGuide = Guide(key: "rec:", instruction: "Recording · the road ahead", street: "Recording", type: 8, distM: nil, timeS: nil,
                                      remainM: nil, remainS: nil, symbol: nil, recording: true)
    struct Look { var theme = "roadbook"; var card = UIColor(white: 0.08, alpha: 1); var cardInk = UIColor(white: 0.93, alpha: 1); var accent = UIColor.systemRed; var voice = true; var metric = false }

    private(set) var route: Route?
    private(set) var guide: Guide?
    private(set) var driving = false
    private(set) var places: [(name: String, coord: CLLocationCoordinate2D)] = []
    private(set) var look = Look()
    /// The car's map data as JSON for web/carmap.js: the route line, the corners and the hazards, kept to repaint a map that connects later.
    private(set) var routeJSON = "[]"
    private(set) var cornersJSON = "[]"
    private(set) var hazardsJSON = "[]"
    /// The sight-line speed under the car's arrow (web/carplay.js sightMessage), null when unknown or not driving.
    private(set) var sightJSON = "null"
    private(set) var position: (lat: Double, lon: Double, course: Double)?
    private var positionSentAt = Date.distantPast

    func send(_ action: String, _ fields: [String: Any] = [:]) {
        let msg: [String: Any] = ["type": "carplay", "action": action].merging(fields) { a, _ in a }
        if let toPage { toPage(msg) } else { waiting.append(msg); if waiting.count > 8 { waiting.removeFirst() } }
    }

    func register(_ map: ApexCarMapViewController) {
        maps.removeAll { $0.map == nil || $0.map === map }
        maps.append(WeakMap(map: map))
    }
    private func eachMap(_ f: (ApexCarMapViewController) -> Void) { maps.compactMap(\.map).forEach(f) }

    private static func num(_ v: Any?) -> Double? { (v as? NSNumber)?.doubleValue }
    private static func coord(_ v: Any?) -> CLLocationCoordinate2D? {
        guard let p = v as? [Any], p.count == 2, let lat = num(p[0]), let lon = num(p[1]),
              abs(lat) <= 90, abs(lon) <= 180 else { return nil }
        return CLLocationCoordinate2D(latitude: lat, longitude: lon)
    }
    private static func json(_ v: Any) -> String {
        guard JSONSerialization.isValidJSONObject(v), let d = try? JSONSerialization.data(withJSONObject: v),
              let s = String(data: d, encoding: .utf8) else { return "[]" }
        return s
    }
    static func color(_ v: Any?) -> UIColor? {
        guard var hex = v as? String, hex.hasPrefix("#") else { return nil }
        hex.removeFirst()
        guard hex.count == 6, let n = UInt32(hex, radix: 16) else { return nil }
        return UIColor(red: CGFloat((n >> 16) & 0xFF) / 255, green: CGFloat((n >> 8) & 0xFF) / 255, blue: CGFloat(n & 0xFF) / 255, alpha: 1)
    }

    /// A message from the page. Malformed fields are dropped, never guessed.
    func receive(_ dict: [String: Any]) {
        switch dict["kind"] as? String {
        case "route":
            let coords = ((dict["coords"] as? [Any]) ?? []).compactMap(Self.coord)
            guard coords.count >= 2 else { return }
            let options = ((dict["options"] as? [[String: Any]]) ?? []).prefix(3).map {
                Option(summary: ($0["summary"] as? String) ?? "Route", detail: ($0["detail"] as? String) ?? "",
                       timeS: Self.num($0["timeS"]), distM: Self.num($0["distM"]))
            }
            route = Route(name: (dict["name"] as? String) ?? "Route", coords: coords, dest: Self.coord(dict["dest"]) ?? coords[coords.count - 1],
                          options: options.isEmpty ? [Option(summary: "Route", detail: "", timeS: nil, distM: nil)] : options,
                          picked: max(0, min(options.count - 1, Int(Self.num(dict["picked"]) ?? 0))))
            routeJSON = Self.json(coords.map { [$0.latitude, $0.longitude] })
            eachMap { $0.showRoute(); $0.setMode() }
            scene?.routeChanged()
        case "clear":
            route = nil
            routeJSON = "[]"
            eachMap { $0.showRoute(); $0.setMode() }
            scene?.routeChanged()
        case "corners":
            cornersJSON = Self.json((dict["list"] as? [Any]) ?? [])
            eachMap { $0.showCorners() }
        case "hazards":
            hazardsJSON = Self.json((dict["list"] as? [Any]) ?? [])
            eachMap { $0.showHazards() }
        case "sight":
            if let text = dict["text"] as? String {
                sightJSON = Self.json(["text": String(text.prefix(6)), "unit": String(((dict["unit"] as? String) ?? "").prefix(5)), "short": (dict["short"] as? Bool) ?? false] as [String: Any])
            } else {
                sightJSON = "null"
            }
            eachMap { $0.showSight() }
        case "look":
            var l = Look()
            if let t = dict["theme"] as? String, t.range(of: "^[a-z]{1,20}$", options: .regularExpression) != nil { l.theme = t }
            l.card = Self.color(dict["card"]) ?? l.card
            l.cardInk = Self.color(dict["cardInk"]) ?? l.cardInk
            l.accent = Self.color(dict["accent"]) ?? l.accent
            l.voice = (dict["voice"] as? Bool) ?? true
            l.metric = (dict["units"] as? String) == "metric"
            look = l
            eachMap { $0.showLook() }
            scene?.lookChanged()
        case "guide":
            // a maneuver always has a distance to it; only a free drive's record card (recording) goes without one
            let recording = (dict["recording"] as? Bool) ?? false, d = Self.num(dict["distM"])
            guard let key = dict["key"] as? String, let text = dict["instruction"] as? String, recording || d != nil else { return }
            let symbol = (dict["symbol"] as? String).flatMap { Data(base64Encoded: $0) }.flatMap { UIImage(data: $0, scale: 3) }
            guide = Guide(key: key, instruction: text, street: (dict["street"] as? String) ?? "", type: Int(Self.num(dict["type"]) ?? 0),
                          distM: d.map { max(0, $0) }, timeS: Self.num(dict["timeS"]), remainM: Self.num(dict["remainM"]), remainS: Self.num(dict["remainS"]),
                          symbol: symbol, recording: recording)
            if !driving { driving = true; eachMap { $0.setMode() }; scene?.driveStarted() }
            scene?.guideChanged()
        case "start":
            // U-59: the page entered a drive, with a route or none (a free drive sends no maneuver until it has driven a little, and
            // used to never reach the car at all): the navigation session, End and the drive's map buttons, and the record card
            // when there is no route to guide along.
            if !driving {
                driving = true
                if route == nil && guide == nil { guide = Self.recordingGuide }
                eachMap { $0.setMode() }
                scene?.driveStarted()
                scene?.guideChanged()
            }
        case "end":
            driving = false
            guide = nil
            sightJSON = "null"
            eachMap { $0.showSight() }
            eachMap { $0.setMode() }
            scene?.driveEnded()
        case "hazard":
            guard let title = dict["title"] as? String else { return }
            scene?.showHazard(title: title, detail: (dict["detail"] as? String) ?? "")
        case "ask":
            guard let title = dict["title"] as? String else { return }
            scene?.askStill(title: title)
        case "places":
            places = ((dict["list"] as? [[String: Any]]) ?? []).prefix(12).compactMap { p in
                guard let name = p["name"] as? String, let c = Self.coord(p["at"]) else { return nil }
                return (name: name, coord: c)
            }
        default:
            break
        }
    }

    /// The car's position from the shell's GPS (ApexNavApp.swift, every live frame), a few times a second to the car maps.
    func position(lat: Double, lon: Double, course: Double) {
        guard abs(lat) <= 90, abs(lon) <= 180, Date().timeIntervalSince(positionSentAt) > 0.3 else { return }
        positionSentAt = Date()
        position = (lat, lon, course)
        eachMap { $0.showPosition() }
    }

    /// A distance the way the driver reads them (the car prints a Measurement in the unit it is given, so metres showed as
    /// "15,630 meter" on the owner's car): feet in 50s under a tenth of a mile, then miles to a tenth; or metres in 10s
    /// under a kilometre, then km to a tenth.
    func distance(_ m: Double) -> Measurement<UnitLength> {
        let m = max(0, m)
        if look.metric {
            return m < 1000 ? Measurement(value: (m / 10).rounded() * 10, unit: .meters) : Measurement(value: (m / 100).rounded() / 10, unit: .kilometers)
        }
        let mi = m / 1609.344
        return mi < 0.1 ? Measurement(value: (m / 0.3048 / 50).rounded() * 50, unit: .feet) : Measurement(value: (mi * 10).rounded() / 10, unit: .miles)
    }

    /// SF Symbol for a Valhalla maneuver type (web/directions.js VERB), until the page's tulip for it arrives.
    static func symbol(_ type: Int) -> UIImage? {
        let name: String
        switch type {
        case 9, 23, 37: name = "arrow.up.right"
        case 10: name = "arrow.turn.up.right"
        case 11: name = "arrow.turn.down.right"
        case 12, 13: name = "arrow.uturn.down"
        case 14: name = "arrow.turn.down.left"
        case 15: name = "arrow.turn.up.left"
        case 16, 24, 38: name = "arrow.up.left"
        case 17, 25: name = "arrow.up"
        case 18, 20: name = "arrow.up.right"
        case 19, 21: name = "arrow.up.left"
        case 26, 27: name = "arrow.triangle.turn.up.right.circle"
        case 4, 5, 6: name = "mappin.circle"
        default: name = "arrow.up"
        }
        let config = UIImage.SymbolConfiguration(pointSize: 40, weight: .semibold)
        return UIImage(systemName: name, withConfiguration: config)?.withRenderingMode(.alwaysTemplate)
    }

    /// The hazard plate (REVIEW.md 4.3: black, an orange edge and triangle) as the alert's image.
    static let hazardPlate: UIImage = {
        UIGraphicsImageRenderer(size: CGSize(width: 64, height: 64)).image { ctx in
            UIColor(white: 0.067, alpha: 1).setFill()
            ctx.fill(CGRect(x: 0, y: 0, width: 64, height: 64))
            let orange = UIColor(red: 1, green: 0x7A / 255, blue: 0x1A / 255, alpha: 1)
            orange.setStroke()
            let edge = UIBezierPath(rect: CGRect(x: 2, y: 2, width: 60, height: 60))
            edge.lineWidth = 4
            edge.stroke()
            orange.setFill()
            let tri = UIBezierPath()
            tri.move(to: CGPoint(x: 32, y: 14))
            tri.addLine(to: CGPoint(x: 52, y: 50))
            tri.addLine(to: CGPoint(x: 12, y: 50))
            tri.close()
            tri.fill()
        }
    }()
}

// MARK: - The CarPlay scene

final class ApexCarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
    private var interfaceController: CPInterfaceController?
    private var carWindow: CPWindow?
    private var mapController: ApexCarMapViewController?
    private var mapTemplate: CPMapTemplate?
    private var session: CPNavigationSession?
    private var trip: CPTrip?
    private var maneuver: CPManeuver?
    private var maneuverKey = ""
    private var maneuverHasTulip = false
    private var search: MKLocalSearch?
    private let mapDelegate = MapDelegate()
    private let searchDelegate = SearchDelegate()

    func templateApplicationScene(_ templateApplicationScene: CPTemplateApplicationScene,
                                  didConnect interfaceController: CPInterfaceController, to window: CPWindow) {
        MainActor.assumeIsolated {
            // the route engine runs whether or not the phone's window was ever opened (ApexEngine, the cold launch)
            _ = ApexEngine.shared.cockpit()
            self.interfaceController = interfaceController
            carWindow = window
            let mc = ApexCarMapViewController(role: .main)
            mapController = mc
            window.rootViewController = mc
            let map = CPMapTemplate()
            map.mapDelegate = mapDelegate
            mapDelegate.owner = self
            searchDelegate.owner = self
            map.automaticallyHidesNavigationBar = false
            map.tripEstimateStyle = .dark
            mapTemplate = map
            idleBars()
            lookChanged()
            interfaceController.setRootTemplate(map, animated: false, completion: nil)
            ApexCar.shared.scene = self
            routeChanged()
            if ApexCar.shared.driving { driveStarted(); guideChanged() }
            ApexCar.shared.send("hello")                       // the page sends the route, the corners, the look and the places again
        }
    }

    func templateApplicationScene(_ templateApplicationScene: CPTemplateApplicationScene,
                                  didDisconnect interfaceController: CPInterfaceController, from window: CPWindow) {
        MainActor.assumeIsolated {
            if ApexCar.shared.scene === self { ApexCar.shared.scene = nil }
            session = nil; trip = nil; maneuver = nil; maneuverKey = ""
            self.interfaceController = nil
            carWindow = nil
            mapTemplate = nil
            mapController = nil
        }
    }

    private func mapButton(_ symbol: String, _ action: @escaping () -> Void) -> CPMapButton {
        let b = CPMapButton { _ in action() }
        b.image = UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 22, weight: .semibold))
        return b
    }

    // MARK: Bars and buttons

    /// Not driving: Where to? and Loops on the left, Places and Drive on the right; pan, zoom and the voice as map buttons.
    /// U-79: Drive starts a free drive from the car (the page records "the road ahead"), so a driver with no destination never
    /// has to pick up the phone. CPMapTemplate shows at most two buttons on each side (CPBarButtonProviding), so this is full.
    /// While a trip preview is up its own Drive starts that route, and the bar's would be a second key saying the same thing.
    @MainActor private func idleBars() {
        guard let map = mapTemplate else { return }
        map.leadingNavigationBarButtons = [CPBarButton(title: "Where to?") { [weak self] _ in self?.openSearch() },
                                           CPBarButton(title: "Loops") { [weak self] _ in self?.openLoops() }]
        let places = CPBarButton(title: "Places") { [weak self] _ in self?.openPlaces() }
        map.trailingNavigationBarButtons = ApexCar.shared.route == nil ? [CPBarButton(title: "Drive") { _ in ApexCar.shared.send("start", ["free": true]) }, places] : [places]
        mapButtons()
    }

    @MainActor private func mapButtons() {
        guard let map = mapTemplate else { return }
        let voice = mapButton(ApexCar.shared.look.voice ? "speaker.wave.2.fill" : "speaker.slash.fill") { ApexCar.shared.send("voice") }
        let zoomIn = mapButton("plus.magnifyingglass") { [weak self] in self?.mapController?.zoom(1) }
        let zoomOut = mapButton("minus.magnifyingglass") { [weak self] in self?.mapController?.zoom(-1) }
        if ApexCar.shared.driving {
            map.mapButtons = [mapButton("exclamationmark.triangle.fill") { [weak self] in self?.openReport() }, voice, zoomIn, zoomOut]
        } else {
            map.mapButtons = [mapButton("arrow.up.and.down.and.arrow.left.and.right") { [weak self] in self?.mapTemplate?.showPanningInterface(animated: true) },
                              zoomIn, zoomOut, voice]
        }
    }

    /// The theme came in (or changed): the guidance card in the theme's dark, the voice button's state.
    @MainActor func lookChanged() {
        guard let map = mapTemplate else { return }
        map.guidanceBackgroundColor = ApexCar.shared.look.card
        mapButtons()
    }

    // MARK: Where to?, Loops, Places, Report

    @MainActor private func openSearch() {
        let t = CPSearchTemplate()
        t.delegate = searchDelegate
        interfaceController?.pushTemplate(t, animated: true, completion: nil)
    }

    @MainActor private func openLoops() {
        let loops: [(String, Int)] = [("30 minutes", 30), ("1 hour", 60), ("2 hours", 120)]
        let items: [CPListItem] = loops.map { label, minutes in
            let item = CPListItem(text: label, detailText: "A twisty loop from here, back where you started")
            item.handler = { [weak self] _, done in
                ApexCar.shared.send("loop", ["minutes": minutes])
                self?.interfaceController?.popToRootTemplate(animated: true, completion: nil)
                done()
            }
            return item
        }
        interfaceController?.pushTemplate(CPListTemplate(title: "Loops from here", sections: [CPListSection(items: items)]), animated: true, completion: nil)
    }

    @MainActor private func openPlaces() {
        let items: [CPListItem] = ApexCar.shared.places.map { p in
            let item = CPListItem(text: p.name, detailText: nil)
            item.handler = { [weak self] _, done in self?.go(to: p.coord, name: p.name); done() }
            return item
        }
        let empty = CPListItem(text: "No recent places yet", detailText: "Where to? finds one")
        let t = CPListTemplate(title: "Places", sections: [CPListSection(items: items.isEmpty ? [empty] : items)])
        interfaceController?.pushTemplate(t, animated: true, completion: nil)
    }

    /// Report a hazard (the phone's report sheet's kinds): one tap on a grid, then back to the map.
    @MainActor private func openReport() {
        let kinds: [(String, String, String)] = [("pothole", "Pothole", "circle.bottomhalf.filled"), ("gravel", "Gravel", "circle.grid.3x3.fill"),
                                                 ("debris", "Debris", "shippingbox.fill"), ("animal", "Animal", "pawprint.fill"),
                                                 ("police", "Police", "light.beacon.max.fill"), ("closure", "Road closed", "nosign")]
        let buttons: [CPGridButton] = kinds.map { kind, title, symbol in
            CPGridButton(titleVariants: [title], image: UIImage(systemName: symbol) ?? UIImage()) { [weak self] _ in
                ApexCar.shared.send("report", ["kind": kind])
                self?.interfaceController?.popToRootTemplate(animated: true, completion: nil)
            }
        }
        interfaceController?.pushTemplate(CPGridTemplate(title: "Report a hazard", gridButtons: buttons), animated: true, completion: nil)
    }

    @MainActor fileprivate func searchUpdated(_ text: String, done: @escaping ([CPListItem]) -> Void) {
        search?.cancel()
        let q = text.trimmingCharacters(in: .whitespaces)
        guard q.count >= 2 else { done([]); return }
        let req = MKLocalSearch.Request()
        req.naturalLanguageQuery = q
        req.resultTypes = [.address, .pointOfInterest]
        if let p = ApexCar.shared.position {
            req.region = MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: p.lat, longitude: p.lon), latitudinalMeters: 150_000, longitudinalMeters: 150_000)
        }
        let s = MKLocalSearch(request: req)
        search = s
        s.start { resp, _ in
            MainActor.assumeIsolated {
                let items: [CPListItem] = (resp?.mapItems ?? []).prefix(12).map { m in
                    let item = CPListItem(text: m.name ?? "Place", detailText: m.placemark.title)
                    item.userInfo = m
                    return item
                }
                done(items)
            }
        }
    }

    @MainActor fileprivate func searchPicked(_ item: CPListItem) {
        guard let m = item.userInfo as? MKMapItem else { return }
        go(to: m.placemark.coordinate, name: m.name ?? "Destination")
    }

    /// Asks the page to plan a route there; the page answers with a `route` message, which shows the trip preview.
    @MainActor private func go(to c: CLLocationCoordinate2D, name: String) {
        interfaceController?.popToRootTemplate(animated: true, completion: nil)
        ApexCar.shared.send("go", ["lat": c.latitude, "lon": c.longitude, "name": name])   // waits for the page if it is still loading
    }

    // MARK: Route preview

    @MainActor func routeChanged() {
        guard let map = mapTemplate else { return }
        let car = ApexCar.shared
        guard let r = car.route, !car.driving else {
            if car.route == nil { map.hideTripPreviews(); trip = nil }
            if !car.driving { idleBars() }                        // Drive comes back on the bar once no preview offers one (U-79)
            return
        }
        idleBars()
        let choices = r.options.map { o -> CPRouteChoice in
            CPRouteChoice(summaryVariants: [o.summary], additionalInformationVariants: [o.detail].filter { !$0.isEmpty }, selectionSummaryVariants: [o.summary])
        }
        let dest = MKMapItem(placemark: MKPlacemark(coordinate: r.dest))
        dest.name = r.name
        let t = CPTrip(origin: MKMapItem.forCurrentLocation(), destination: dest, routeChoices: choices)
        trip = t
        let text = CPTripPreviewTextConfiguration(startButtonTitle: "Drive", additionalRoutesButtonTitle: "Options", overviewButtonTitle: "Overview")
        map.showTripPreviews([t], selectedTrip: t, textConfiguration: text)
        if r.picked < r.options.count, let est = estimates(r.options[r.picked]) { map.updateEstimates(est, for: t) }
    }

    @MainActor private func estimates(_ o: ApexCar.Option) -> CPTravelEstimates? {
        guard let m = o.distM else { return nil }
        return CPTravelEstimates(distanceRemaining: ApexCar.shared.distance(m), timeRemaining: o.timeS ?? -1)
    }

    @MainActor fileprivate func previewSelected(_ choice: CPRouteChoice) {
        guard let r = ApexCar.shared.route, let i = trip?.routeChoices.firstIndex(of: choice), i != r.picked else { return }
        ApexCar.shared.send("pick", ["i": i])
    }

    @MainActor fileprivate func started(_ t: CPTrip, _ choice: CPRouteChoice) {
        mapTemplate?.hideTripPreviews()
        ApexCar.shared.send("start")
    }

    // MARK: Guidance

    @MainActor func driveStarted() {
        guard let map = mapTemplate else { return }
        map.hideTripPreviews()
        // A free drive (U-59) is a trip from here with no choices and no destination of its own: CPMapTemplate guides only
        // through a navigation session, and the session is what puts End on the bar, the drive in the Dashboard and the
        // cluster, and stops ours when the car's own navigation starts. Its card is the record card, never a made-up turn.
        let t = trip ?? CPTrip(origin: MKMapItem.forCurrentLocation(), destination: MKMapItem.forCurrentLocation(), routeChoices: [])
        trip = t
        session = map.startNavigationSession(for: t)
        maneuverKey = ""
        map.leadingNavigationBarButtons = []
        map.trailingNavigationBarButtons = [CPBarButton(title: "End") { _ in ApexCar.shared.send("end") }]
        mapButtons()
    }

    @MainActor func guideChanged() {
        guard let g = ApexCar.shared.guide, let session else { return }
        // time to the turn only when the page knows it (the router's times); 0 shows distance alone. The record card has no
        // distance to count down (the distance driven is in its words), so it carries no estimates at all.
        let est = g.distM.map { CPTravelEstimates(distanceRemaining: ApexCar.shared.distance($0), timeRemaining: max(0, g.timeS ?? 0)) }
        if g.key != maneuverKey || (g.symbol != nil && !maneuverHasTulip) {
            let m = CPManeuver()
            m.instructionVariants = [g.instruction, g.street].filter { !$0.isEmpty }
            if let tulip = g.symbol {
                m.symbolImage = tulip.withRenderingMode(.alwaysOriginal)    // the road book's tulip, in the card's ink
            } else if g.recording {
                m.symbolImage = UIImage(systemName: "record.circle", withConfiguration: UIImage.SymbolConfiguration(pointSize: 40, weight: .semibold))?.withRenderingMode(.alwaysTemplate)
            } else {
                m.symbolImage = ApexCar.symbol(g.type)
            }
            m.initialTravelEstimates = est
            maneuver = m
            maneuverKey = g.key
            maneuverHasTulip = g.symbol != nil
            session.upcomingManeuvers = [m]
        } else if let m = maneuver, let est {
            session.updateEstimates(est, for: m)
        }
        // the distance left whenever the route has one; a negative time is CarPlay's own "--" (CPTravelEstimates.h), so a
        // route with no router time (a GPX track) shows its miles left and no made-up time (the 2026-10-30 car run sat on
        // "0 min · -- mi" for the whole drive)
        if let t = trip, let rm = g.remainM {
            mapTemplate?.updateEstimates(CPTravelEstimates(distanceRemaining: ApexCar.shared.distance(rm), timeRemaining: g.remainS ?? -1), for: t)
        } else if let t = trip, g.recording {
            // U-95: a free drive has no destination, so nothing to arrive at: the trip strip read "7:04 arrival · 0 min · -- mi"
            // (unset estimates are an arrival of now). Negative time and distance are CarPlay's "--" for unknown, so the strip
            // says it does not know rather than that the drive is over; the distance driven is in the record card's words.
            let unit: UnitLength = ApexCar.shared.look.metric ? .kilometers : .miles
            mapTemplate?.updateEstimates(CPTravelEstimates(distanceRemaining: Measurement(value: -1, unit: unit), timeRemaining: -1), for: t)
        }
    }

    /// U-62: after End the car goes idle (Where to?, Loops, Places, Drive), never a trip preview of the route just finished: the
    /// page clears the route too, and a route planned afterwards comes in as a new `route` message.
    @MainActor func driveEnded() {
        session?.finishTrip()
        session = nil; maneuver = nil; maneuverKey = ""; trip = nil
        mapTemplate?.hideTripPreviews()
        idleBars()
    }

    @MainActor func showHazard(title: String, detail: String) {
        guard let map = mapTemplate, ApexCar.shared.driving else { return }
        let alert = CPNavigationAlert(titleVariants: [title], subtitleVariants: [detail].filter { !$0.isEmpty }, image: ApexCar.hazardPlate,
                                      primaryAction: CPAlertAction(title: "OK", style: .default) { _ in }, secondaryAction: nil, duration: 8)
        map.present(navigationAlert: alert, animated: true)
    }

    /// Passed a reported hazard: is it still there? One tap on the car's screen answers the phone's question.
    @MainActor func askStill(title: String) {
        guard let map = mapTemplate else { return }
        let alert = CPNavigationAlert(titleVariants: [title], subtitleVariants: [], image: ApexCar.hazardPlate,
                                      primaryAction: CPAlertAction(title: "Still there", style: .default) { _ in ApexCar.shared.send("still", ["still": true]) },
                                      secondaryAction: CPAlertAction(title: "Gone", style: .default) { _ in ApexCar.shared.send("still", ["still": false]) },
                                      duration: 12)
        map.present(navigationAlert: alert, animated: true)
    }

    @MainActor fileprivate func pan(_ d: CPMapTemplate.PanDirection) { mapController?.pan(d) }
    @MainActor fileprivate func panEnded() { mapController?.recentre() }

    // Template delegates are separate small objects so the scene delegate stays a plain UIResponder.
    private final class MapDelegate: NSObject, CPMapTemplateDelegate {
        weak var owner: ApexCarPlaySceneDelegate?
        func mapTemplate(_ mapTemplate: CPMapTemplate, selectedPreviewFor trip: CPTrip, using routeChoice: CPRouteChoice) {
            MainActor.assumeIsolated { owner?.previewSelected(routeChoice) }
        }
        func mapTemplate(_ mapTemplate: CPMapTemplate, startedTrip trip: CPTrip, using routeChoice: CPRouteChoice) {
            MainActor.assumeIsolated { owner?.started(trip, routeChoice) }
        }
        func mapTemplate(_ mapTemplate: CPMapTemplate, panWith direction: CPMapTemplate.PanDirection) {
            MainActor.assumeIsolated { owner?.pan(direction) }
        }
        func mapTemplateDidDismissPanningInterface(_ mapTemplate: CPMapTemplate) {
            MainActor.assumeIsolated { owner?.panEnded() }
        }
        /// The car's own navigation started: stop guidance at once (CarPlay Developer Guide, navigation apps).
        func mapTemplateDidCancelNavigation(_ mapTemplate: CPMapTemplate) {
            MainActor.assumeIsolated { ApexCar.shared.send("end") }
        }
        func mapTemplate(_ mapTemplate: CPMapTemplate, displayStyleFor maneuver: CPManeuver) -> CPManeuverDisplayStyle { .leadingSymbol }
    }

    private final class SearchDelegate: NSObject, CPSearchTemplateDelegate {
        weak var owner: ApexCarPlaySceneDelegate?
        func searchTemplate(_ searchTemplate: CPSearchTemplate, updatedSearchText searchText: String, completionHandler: @escaping ([CPListItem]) -> Void) {
            MainActor.assumeIsolated { owner?.searchUpdated(searchText, done: completionHandler) ?? completionHandler([]) }
        }
        func searchTemplate(_ searchTemplate: CPSearchTemplate, selectedResult item: CPListItem, completionHandler: @escaping () -> Void) {
            MainActor.assumeIsolated { owner?.searchPicked(item) }
            completionHandler()
        }
    }
}

// MARK: - The Dashboard and the instrument cluster: our map again, with the system's maneuver from the navigation session

final class ApexCarDashboardSceneDelegate: UIResponder, CPTemplateApplicationDashboardSceneDelegate {
    private var mapController: ApexCarMapViewController?

    func templateApplicationDashboardScene(_ templateApplicationDashboardScene: CPTemplateApplicationDashboardScene,
                                           didConnect dashboardController: CPDashboardController, to window: UIWindow) {
        MainActor.assumeIsolated {
            _ = ApexEngine.shared.cockpit()
            let m = ApexCarMapViewController(role: .dashboard)
            mapController = m
            window.rootViewController = m
        }
    }

    func templateApplicationDashboardScene(_ templateApplicationDashboardScene: CPTemplateApplicationDashboardScene,
                                           didDisconnect dashboardController: CPDashboardController, from window: UIWindow) {
        MainActor.assumeIsolated { mapController = nil }
    }
}

final class ApexCarClusterSceneDelegate: UIResponder, CPTemplateApplicationInstrumentClusterSceneDelegate, CPInstrumentClusterControllerDelegate {
    private var mapController: ApexCarMapViewController?

    func templateApplicationInstrumentClusterScene(_ templateApplicationInstrumentClusterScene: CPTemplateApplicationInstrumentClusterScene,
                                                   didConnect instrumentClusterController: CPInstrumentClusterController) {
        MainActor.assumeIsolated {
            _ = ApexEngine.shared.cockpit()
            instrumentClusterController.delegate = self
        }
    }

    func templateApplicationInstrumentClusterScene(_ templateApplicationInstrumentClusterScene: CPTemplateApplicationInstrumentClusterScene,
                                                   didDisconnectInstrumentClusterController instrumentClusterController: CPInstrumentClusterController) {}

    func instrumentClusterControllerDidConnect(_ instrumentClusterWindow: UIWindow) {
        MainActor.assumeIsolated {
            let m = ApexCarMapViewController(role: .cluster)
            mapController = m
            instrumentClusterWindow.rootViewController = m
        }
    }

    func instrumentClusterControllerDidDisconnectWindow(_ instrumentClusterWindow: UIWindow) {
        MainActor.assumeIsolated { mapController = nil }
    }

    func instrumentClusterControllerDidZoom(in instrumentClusterController: CPInstrumentClusterController) {
        MainActor.assumeIsolated { mapController?.zoom(1) }
    }

    func instrumentClusterControllerDidZoomOut(_ instrumentClusterController: CPInstrumentClusterController) {
        MainActor.assumeIsolated { mapController?.zoom(-1) }
    }

    func instrumentClusterController(_ instrumentClusterController: CPInstrumentClusterController, didChangeCompassSetting compassSetting: CPInstrumentClusterSetting) {}
    func instrumentClusterController(_ instrumentClusterController: CPInstrumentClusterController, didChangeSpeedLimitSetting speedLimitSetting: CPInstrumentClusterSetting) {}
}

// MARK: - The base view: our map (web/carmap.html), in the phone's theme and the car screen's day or night

final class ApexCarMapViewController: UIViewController, WKNavigationDelegate {
    enum Role { case main, dashboard, cluster }
    let role: Role
    private var web: WKWebView?
    private var loaded = false

    init(role: Role) {
        self.role = role
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("not from a storyboard") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0x1A / 255, green: 0x18 / 255, blue: 0x14 / 255, alpha: 1)
        guard let index = ApexWebBundle.indexURL else { return }
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(ApexBundleSchemeHandler(root: index.deletingLastPathComponent()), forURLScheme: ApexWebBundle.scheme)
        let w = WKWebView(frame: view.bounds, configuration: config)
        w.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        w.isOpaque = false
        w.backgroundColor = view.backgroundColor
        w.scrollView.isScrollEnabled = false
        // The map runs under Apple's buttons and cards, edge to edge: no safe-area inset (the owner's photos, 2026-10-30:
        // the map stopped short at the map buttons, an empty strip under them).
        w.scrollView.contentInsetAdjustmentBehavior = .never
        w.isUserInteractionEnabled = false                  // the base view takes no touches: Apple's templates own every control
        w.navigationDelegate = self
        view.addSubview(w)
        web = w
        w.load(URLRequest(url: URL(string: "\(ApexWebBundle.scheme)://app/carmap.html")!))
        MainActor.assumeIsolated { ApexCar.shared.register(self) }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loaded = true
        MainActor.assumeIsolated {
            fitViewport(); showLook(); showRoute(); showCorners(); showHazards(); setMode(); showPosition(); showSight()
        }
    }

    override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
        super.traitCollectionDidChange(previousTraitCollection)
        MainActor.assumeIsolated { showLook() }            // the car's screen went from day to night, or back
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        MainActor.assumeIsolated { fitViewport(); setMode() }   // Apple's cards cover a share of the left that depends on the width
    }

    /// Lays the page out at the car screen's own width, one CSS pixel to a point. "device-width" in a web view is the
    /// iPhone's width, so the car map was laid out about 390 wide and scaled up: giant, soft plates and labels (2026-10-30).
    private var fittedWidth = 0
    private func fitViewport() {
        guard loaded, let web else { return }
        let w = Int(web.bounds.width.rounded())
        guard w > 0, w != fittedWidth else { return }
        fittedWidth = w
        web.evaluateJavaScript("(function () { var m = document.querySelector('meta[name=viewport]'); if (m) m.content = 'width=\(w), initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover'; if (window.car && window.car.map) window.car.map.resize(); })(); void 0;", completionHandler: nil)
    }

    private func js(_ code: String) {
        guard loaded, let web else { return }
        web.evaluateJavaScript("window.car && (\(code)); void 0;", completionHandler: nil)
    }

    @MainActor func showLook() {
        let night = traitCollection.userInterfaceStyle == .dark
        js("car.look('\(ApexCar.shared.look.theme)', \(night))")
    }
    @MainActor func showRoute() { js("car.route(\(ApexCar.shared.routeJSON))") }
    @MainActor func showCorners() { js("car.corners(\(ApexCar.shared.cornersJSON))") }
    @MainActor func showHazards() { js("car.hazards(\(ApexCar.shared.hazardsJSON))") }
    @MainActor func showSight() { js("car.sight(\(ApexCar.shared.sightJSON))") }
    @MainActor func showPosition() {
        guard let p = ApexCar.shared.position else { return }
        js("car.position(\(p.lat), \(p.lon), \(p.course))")
    }
    /// Following the car while driving, the whole route in a trip preview (main screen only), the car otherwise.
    @MainActor func setMode() {
        let car = ApexCar.shared
        let mode = car.driving ? "guide" : (role == .main && car.route != nil ? "preview" : "idle")
        let inset = role == .main && (car.driving || car.route != nil) ? Int(view.bounds.width * 0.36) : 0
        js("car.inset(\(inset)), car.mode('\(mode)')")
    }
    @MainActor func zoom(_ dir: Int) { js("car.zoom(\(dir))") }
    @MainActor func recentre() { js("car.recentre()") }
    @MainActor func pan(_ d: CPMapTemplate.PanDirection) {
        let dx = d.contains(.left) ? -1 : d.contains(.right) ? 1 : 0
        let dy = d.contains(.up) ? -1 : d.contains(.down) ? 1 : 0
        js("car.pan(\(dx), \(dy))")
    }
}
