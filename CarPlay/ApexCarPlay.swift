// CarPlay (IDEAS C-01, C-02; docs/CARPLAY.md): the navigation flow on the car's screen with Apple's navigation templates.
//
// The web cockpit stays the single brain. It plans routes, places the maneuvers, calls hazards and speaks; CarPlay shows
// what it decides and sends back what the driver picks on the car's screen. Page -> car: `{cmd:'car', kind:...}` messages
// (route, clear, guide, end, hazard, places), handled by ApexCar.receive. Car -> page: `onNative({type:'carplay', action})`
// with go (a place to route to), pick (a route option), start, end.
//
// The car's screen has no scores, social features, settings or text entry beyond the system search keyboard, and nothing
// in it asks the driver to use the phone (CarPlay Developer Guide, "Guidelines for all CarPlay apps"). Our own map is drawn
// in the base view: the route line and the car's position, with zoom, recentre and panning.

import CarPlay
import MapKit
import UIKit

// MARK: - The hub between the page and the car's screen

@MainActor
final class ApexCar {
    static let shared = ApexCar()

    /// Sends a message to the page (set by the shell once the page is ready).
    var toPage: (([String: Any]) -> Void)?
    /// The connected car screen, if any.
    weak var scene: ApexCarPlaySceneDelegate?

    struct Option { let summary: String; let detail: String; let timeS: Double?; let distM: Double? }
    struct Route { let name: String; let coords: [CLLocationCoordinate2D]; let dest: CLLocationCoordinate2D; let options: [Option]; let picked: Int }
    struct Guide { let key: String; let instruction: String; let street: String; let type: Int; let distM: Double; let timeS: Double?; let remainM: Double?; let remainS: Double? }

    private(set) var route: Route?
    private(set) var guide: Guide?
    private(set) var driving = false
    private(set) var places: [(name: String, coord: CLLocationCoordinate2D)] = []

    func send(_ action: String, _ fields: [String: Any] = [:]) {
        toPage?(["type": "carplay", "action": action].merging(fields) { a, _ in a })
    }

    private static func num(_ v: Any?) -> Double? { (v as? NSNumber)?.doubleValue }
    private static func coord(_ v: Any?) -> CLLocationCoordinate2D? {
        guard let p = v as? [Any], p.count == 2, let lat = num(p[0]), let lon = num(p[1]),
              abs(lat) <= 90, abs(lon) <= 180 else { return nil }
        return CLLocationCoordinate2D(latitude: lat, longitude: lon)
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
            scene?.routeChanged()
        case "clear":
            route = nil
            scene?.routeChanged()
        case "guide":
            guard let key = dict["key"] as? String, let text = dict["instruction"] as? String, let d = Self.num(dict["distM"]) else { return }
            guide = Guide(key: key, instruction: text, street: (dict["street"] as? String) ?? "", type: Int(Self.num(dict["type"]) ?? 0),
                          distM: max(0, d), timeS: Self.num(dict["timeS"]), remainM: Self.num(dict["remainM"]), remainS: Self.num(dict["remainS"]))
            if !driving { driving = true; scene?.driveStarted() }
            scene?.guideChanged()
        case "end":
            driving = false
            guide = nil
            scene?.driveEnded()
        case "hazard":
            guard let title = dict["title"] as? String else { return }
            scene?.showHazard(title: title, detail: (dict["detail"] as? String) ?? "")
        case "places":
            places = ((dict["list"] as? [[String: Any]]) ?? []).prefix(12).compactMap { p in
                guard let name = p["name"] as? String, let c = Self.coord(p["at"]) else { return nil }
                return (name: name, coord: c)
            }
        default:
            break
        }
    }

    /// SF Symbol for a Valhalla maneuver type (web/directions.js VERB), drawn as a template so CarPlay tints it for the
    /// light and dark map.
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
}

// MARK: - The CarPlay scene

final class ApexCarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
    private var interfaceController: CPInterfaceController?
    private var carWindow: CPWindow?
    private let mapController = ApexCarMapViewController()
    private var mapTemplate: CPMapTemplate?
    private var session: CPNavigationSession?
    private var trip: CPTrip?
    private var maneuver: CPManeuver?
    private var maneuverKey = ""
    private var searchItems: [CPListItem] = []
    private var search: MKLocalSearch?
    private let mapDelegate = MapDelegate()
    private let searchDelegate = SearchDelegate()

    func templateApplicationScene(_ templateApplicationScene: CPTemplateApplicationScene,
                                  didConnect interfaceController: CPInterfaceController, to window: CPWindow) {
        MainActor.assumeIsolated {
            self.interfaceController = interfaceController
            carWindow = window
            window.rootViewController = mapController
            let map = CPMapTemplate()
            map.mapDelegate = mapDelegate
            mapDelegate.owner = self
            searchDelegate.owner = self
            map.automaticallyHidesNavigationBar = false
            map.leadingNavigationBarButtons = [CPBarButton(title: "Search") { [weak self] _ in self?.openSearch() },
                                               CPBarButton(title: "Places") { [weak self] _ in self?.openPlaces() }]
            map.mapButtons = [mapButton("plus.magnifyingglass") { [weak self] in self?.mapController.zoom(by: 0.5) },
                              mapButton("minus.magnifyingglass") { [weak self] in self?.mapController.zoom(by: 2) },
                              mapButton("location.fill") { [weak self] in self?.mapController.recentre() },
                              mapButton("arrow.up.and.down.and.arrow.left.and.right") { [weak self] in self?.mapTemplate?.showPanningInterface(animated: true) }]
            mapTemplate = map
            interfaceController.setRootTemplate(map, animated: false, completion: nil)
            ApexCar.shared.scene = self
            routeChanged()
            if ApexCar.shared.driving { driveStarted(); guideChanged() }
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
        }
    }

    private func mapButton(_ symbol: String, _ action: @escaping () -> Void) -> CPMapButton {
        let b = CPMapButton { _ in action() }
        b.image = UIImage(systemName: symbol)
        return b
    }

    // MARK: Search and places

    @MainActor private func openSearch() {
        let t = CPSearchTemplate()
        t.delegate = searchDelegate
        interfaceController?.pushTemplate(t, animated: true, completion: nil)
    }

    @MainActor private func openPlaces() {
        let items: [CPListItem] = ApexCar.shared.places.map { p in
            let item = CPListItem(text: p.name, detailText: nil)
            item.handler = { [weak self] _, done in self?.go(to: p.coord, name: p.name); done() }
            return item
        }
        let empty = CPListItem(text: "No recent places yet", detailText: "Search for a place, or plan one on the phone while parked")
        let t = CPListTemplate(title: "Places", sections: [CPListSection(items: items.isEmpty ? [empty] : items)])
        interfaceController?.pushTemplate(t, animated: true, completion: nil)
    }

    @MainActor fileprivate func searchUpdated(_ text: String, done: @escaping ([CPListItem]) -> Void) {
        search?.cancel()
        let q = text.trimmingCharacters(in: .whitespaces)
        guard q.count >= 2 else { done([]); return }
        let req = MKLocalSearch.Request()
        req.naturalLanguageQuery = q
        req.resultTypes = [.address, .pointOfInterest]
        if let here = mapController.here { req.region = MKCoordinateRegion(center: here, latitudinalMeters: 150_000, longitudinalMeters: 150_000) }
        let s = MKLocalSearch(request: req)
        search = s
        s.start { [weak self] resp, _ in
            MainActor.assumeIsolated {
                let items: [CPListItem] = (resp?.mapItems ?? []).prefix(12).map { m in
                    let item = CPListItem(text: m.name ?? "Place", detailText: m.placemark.title)
                    item.userInfo = m
                    return item
                }
                self?.searchItems = items
                done(items)
            }
        }
    }

    @MainActor fileprivate func searchPicked(_ item: CPListItem) {
        guard let m = item.userInfo as? MKMapItem else { return }
        interfaceController?.popToRootTemplate(animated: true, completion: nil)
        go(to: m.placemark.coordinate, name: m.name ?? "Destination")
    }

    /// Asks the page to plan a route there; the page answers with a `route` message, which shows the trip preview.
    @MainActor private func go(to c: CLLocationCoordinate2D, name: String) {
        interfaceController?.popToRootTemplate(animated: true, completion: nil)
        guard ApexCar.shared.toPage != nil else {
            // the route engine (the cockpit page) isn't running yet: say what happened, never "use your iPhone"
            let alert = CPAlertTemplate(titleVariants: ["Couldn't plan the route yet. Try again in a moment."],
                                        actions: [CPAlertAction(title: "OK", style: .cancel) { [weak self] _ in self?.interfaceController?.dismissTemplate(animated: true, completion: nil) }])
            interfaceController?.presentTemplate(alert, animated: true, completion: nil)
            return
        }
        ApexCar.shared.send("go", ["lat": c.latitude, "lon": c.longitude, "name": name])
    }

    // MARK: Route preview

    @MainActor func routeChanged() {
        guard let map = mapTemplate else { return }
        let car = ApexCar.shared
        mapController.show(route: car.route?.coords ?? [])
        guard let r = car.route, !car.driving else {
            if car.route == nil { map.hideTripPreviews(); trip = nil }
            return
        }
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

    private func estimates(_ o: ApexCar.Option) -> CPTravelEstimates? {
        guard let s = o.timeS, let m = o.distM else { return nil }
        return CPTravelEstimates(distanceRemaining: Measurement(value: m, unit: UnitLength.meters), timeRemaining: s)
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
        let t = trip ?? CPTrip(origin: MKMapItem.forCurrentLocation(), destination: MKMapItem.forCurrentLocation(), routeChoices: [])
        trip = t
        session = map.startNavigationSession(for: t)
        maneuverKey = ""
        map.trailingNavigationBarButtons = [CPBarButton(title: "End") { _ in ApexCar.shared.send("end") }]
        mapController.guiding = true
    }

    @MainActor func guideChanged() {
        guard let g = ApexCar.shared.guide, let session else { return }
        // time to the turn only when the page knows it (the router's times); 0 shows distance alone
        let est = CPTravelEstimates(distanceRemaining: Measurement(value: g.distM, unit: UnitLength.meters), timeRemaining: max(0, g.timeS ?? 0))
        if g.key != maneuverKey {
            let m = CPManeuver()
            m.instructionVariants = [g.instruction, g.street].filter { !$0.isEmpty }
            m.symbolImage = ApexCar.symbol(g.type)
            m.initialTravelEstimates = est
            maneuver = m
            maneuverKey = g.key
            session.upcomingManeuvers = [m]
        } else if let m = maneuver {
            session.updateEstimates(est, for: m)
        }
        if let t = trip, let rm = g.remainM, let rs = g.remainS {
            mapTemplate?.updateEstimates(CPTravelEstimates(distanceRemaining: Measurement(value: rm, unit: UnitLength.meters), timeRemaining: rs), for: t)
        }
    }

    @MainActor func driveEnded() {
        session?.finishTrip()
        session = nil; maneuver = nil; maneuverKey = ""
        mapTemplate?.trailingNavigationBarButtons = []
        mapController.guiding = false
        routeChanged()
    }

    @MainActor func showHazard(title: String, detail: String) {
        guard let map = mapTemplate, ApexCar.shared.driving else { return }
        let alert = CPNavigationAlert(titleVariants: [title], subtitleVariants: [detail].filter { !$0.isEmpty }, image: UIImage(systemName: "exclamationmark.triangle.fill"),
                                      primaryAction: CPAlertAction(title: "OK", style: .default) { _ in }, secondaryAction: nil, duration: 8)
        map.present(navigationAlert: alert, animated: true)
    }

    @MainActor fileprivate func pan(_ d: CPMapTemplate.PanDirection) { mapController.pan(d) }
    @MainActor fileprivate func panEnded() { mapTemplate?.dismissPanningInterface(animated: true) }

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
        func mapTemplateDidDismissPanningInterface(_ mapTemplate: CPMapTemplate) {}
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

// MARK: - The base view: our map

final class ApexCarMapViewController: UIViewController, MKMapViewDelegate {
    private let map = MKMapView()
    private var line: MKPolyline?
    var here: CLLocationCoordinate2D? { map.userLocation.location?.coordinate }
    var guiding = false { didSet { recentre() } }

    override func viewDidLoad() {
        super.viewDidLoad()
        map.frame = view.bounds
        map.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        map.delegate = self
        map.showsUserLocation = true
        map.pointOfInterestFilter = .excludingAll
        map.showsCompass = false
        view.addSubview(map)
        map.setUserTrackingMode(.follow, animated: false)
    }

    func show(route coords: [CLLocationCoordinate2D]) {
        if let line { map.removeOverlay(line) }
        line = nil
        guard coords.count >= 2 else { recentre(); return }
        let l = MKPolyline(coordinates: coords, count: coords.count)
        line = l
        map.addOverlay(l, level: .aboveRoads)
        if !guiding { map.setVisibleMapRect(l.boundingMapRect, edgePadding: UIEdgeInsets(top: 60, left: 60, bottom: 60, right: 60), animated: true) }
    }

    func recentre() { map.setUserTrackingMode(guiding ? .followWithHeading : .follow, animated: true) }

    func zoom(by f: Double) {
        var r = map.region
        r.span.latitudeDelta = min(90, max(0.002, r.span.latitudeDelta * f))
        r.span.longitudeDelta = min(180, max(0.002, r.span.longitudeDelta * f))
        map.setRegion(r, animated: true)
    }

    func pan(_ d: CPMapTemplate.PanDirection) {
        var c = map.centerCoordinate
        let dLat = map.region.span.latitudeDelta / 3, dLon = map.region.span.longitudeDelta / 3
        if d.contains(.up) { c.latitude += dLat }
        if d.contains(.down) { c.latitude -= dLat }
        if d.contains(.left) { c.longitude -= dLon }
        if d.contains(.right) { c.longitude += dLon }
        map.setCenter(c, animated: true)
    }

    func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
        guard let l = overlay as? MKPolyline else { return MKOverlayRenderer(overlay: overlay) }
        let r = MKPolylineRenderer(polyline: l)
        r.strokeColor = UIColor(red: 0xC8 / 255, green: 0x10 / 255, blue: 0x2E / 255, alpha: 1)   // brand accent (BRAND.md)
        r.lineWidth = 7
        r.lineCap = .round
        r.lineJoin = .round
        return r
    }
}
