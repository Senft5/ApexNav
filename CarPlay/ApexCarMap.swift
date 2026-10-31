// The car's map, native (REVIEW_FEEL.md F-07, F-01): MapLibre Native drawing through Metal on its own render thread, in the
// CarPlay base view, the Dashboard and the instrument cluster. It replaces a WKWebView per car screen (each its own
// WebContent process with its own MapLibre GL JS, tiles and GL context, at WebKit's mercy while the phone is locked in a
// pocket) with one map engine in the app's own process and one tile cache on disk for every screen.
//
// It draws what web/carmap.js draws, from the same sources: the OpenFreeMap style, the AWS terrain tiles as hillshade (no
// contour lines, the car's call of 2026-10-30), the theme's palette painted over the style (web/basemap.js restyle, as a
// Swift style pass; the palettes come from web/themes.js in the page's look message), the route line, every corner's
// rating at its apex, the hazard plates, the car's arrow and its sight-line speed. The arrow is dead reckoned between fixes
// on a CADisplayLink (ApexKit CarGlide, the algorithm of web/car_glide.js). It takes no touches: Apple's templates own
// every control. ApexCarMapViewController (ApexCarPlay.swift) keeps the message set (look, route, corners, hazards,
// position, sight, mode, zoom, pan, recentre, inset) and falls back to web/carmap.html if this map fails to start.

import ApexKit
import CoreLocation
import MapLibre
import QuartzCore
import UIKit

/// The theme's map for the car (web/themes.js `map` palettes, plus the route and plate inks), from the page's look message.
struct ApexCarPalette {
    var bg, water, waterLine, land, wood, road, roadMinor, casing, label, halo, boundary, shadow, highlight, accentShade: UIColor
    var route, plate, plateInk, accent: UIColor
    var labelHex: String

    /// One of the look message's `palette.day` / `palette.night` (web/carplay.js lookMessage); nil if any colour is missing.
    init?(_ d: [String: Any]?) {
        guard let d else { return nil }
        func c(_ k: String) -> UIColor? { ApexCar.color(d[k]) }
        guard let bg = c("bg"), let water = c("water"), let waterLine = c("waterLine"), let land = c("land"), let wood = c("wood"),
              let road = c("road"), let roadMinor = c("roadMinor"), let casing = c("casing"), let label = c("label"), let halo = c("halo"),
              let boundary = c("boundary"), let shadow = c("shadow"), let highlight = c("highlight"), let accentShade = c("accentShade"),
              let route = c("route"), let plate = c("plate"), let plateInk = c("plateInk"), let accent = c("accent") else { return nil }
        self.bg = bg; self.water = water; self.waterLine = waterLine; self.land = land; self.wood = wood; self.road = road
        self.roadMinor = roadMinor; self.casing = casing; self.label = label; self.halo = halo; self.boundary = boundary
        self.shadow = shadow; self.highlight = highlight; self.accentShade = accentShade
        self.route = route; self.plate = plate; self.plateInk = plateInk; self.accent = accent
        self.labelHex = (d["label"] as? String) ?? "#A89E8C"
    }

    /// The Roadbook's (web/themes.js roadbook.map and its route and panel inks; tests/test_car_native.py keeps them equal),
    /// for the moment before the page's first look message: a car that opens the app cold.
    static let roadbook: (day: ApexCarPalette, night: ApexCarPalette) = (
        ApexCarPalette(["bg": "#F2EBDD", "water": "#CFD8D3", "waterLine": "#7F9A9A", "land": "#EFE7D8", "wood": "#E3DCC5", "road": "#FFFFFF",
                        "roadMinor": "#FFFFFF", "casing": "#1C1A17", "label": "#1C1A17", "halo": "#F2EBDD", "boundary": "#8C8373",
                        "shadow": "#A08F6E", "highlight": "#FFFFFF", "accentShade": "#B59E78",
                        "route": "#C8102E", "plate": "#EDE4D3", "plateInk": "#1C1A17", "accent": "#C8102E"])!,
        ApexCarPalette(["bg": "#1B1712", "water": "#10161A", "waterLine": "#26343A", "land": "#1D1914", "wood": "#1F1C15", "road": "#36312A",
                        "roadMinor": "#2B2721", "casing": "#A99F8C", "label": "#A89E8C", "halo": "#1B1712", "boundary": "#332F28",
                        "shadow": "#080706", "highlight": "#28231C", "accentShade": "#14120E",
                        "route": "#E65252", "plate": "#151310", "plateInk": "#EDE4D3", "accent": "#E65252"])!
    )
}

/// A corner's rating or a hazard on the car's map (web/carplay.js cornersMessage, hazardsMessage).
struct ApexCarPlateData: Equatable {
    let lat: Double, lon: Double, text: String, tight: Bool, hazard: Bool
    var key: String { "\(hazard ? "h" : "c")|\(text)|\(tight ? 1 : 0)|\(lat),\(lon)" }
}

/// The sight-line speed under the car's arrow (web/carplay.js sightMessage).
struct ApexCarSight: Equatable { let text: String, unit: String, short: Bool }

@MainActor
final class ApexNativeCarMap: UIView {
    static let styleURL = URL(string: "https://tiles.openfreemap.org/styles/liberty")!
    static let demURL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"

    /// The map could not start (its style never loaded): the controller puts the web map in its place.
    var onFail: (() -> Void)?

    private let map: MLNMapView
    private let overlay = UIView()
    private let puck = ApexCarPuckView()
    private let sightTag = ApexCarSightView()
    private let credit = ApexCarPlateLabel()
    private let delegateProxy = MapDelegateProxy()
    nonisolated(unsafe) private var link: CADisplayLink?     // invalidated in deinit, which is not on the main actor
    private var style: MLNStyle?
    private var styled = false

    // what the page said, and how to draw it
    private var palette = ApexCarPalette.roadbook.night
    private var route: [CLLocationCoordinate2D] = []
    private var corners: [ApexCarPlateData] = []
    private var hazards: [ApexCarPlateData] = []
    private var sight: ApexCarSight?
    private var hasPosition = false
    private var mode = "idle"
    private var follow = true
    private var inset: CGFloat = 0
    private var glide = CarGlide()
    private var shown: CarGlide.Pose?

    // the camera this map sets each frame while following the car, and the ease into it after a mode, inset or zoom change
    private struct Cam { var center: CLLocationCoordinate2D; var zoom: Double; var bearing: Double; var pitch: Double; var pad: UIEdgeInsets }
    private var cam: Cam?
    private var blend: (from: Cam, t0: CFTimeInterval, dur: CFTimeInterval)?
    private var followZoom = 15.0
    private var previewUntil: CFTimeInterval = 0

    init(frame: CGRect, nightNow: Bool) {
        map = MLNMapView(frame: CGRect(origin: .zero, size: frame.size), styleURL: Self.styleURL)
        super.init(frame: frame)
        backgroundColor = UIColor(red: 0x1A / 255, green: 0x18 / 255, blue: 0x14 / 255, alpha: 1)
        palette = nightNow ? ApexCarPalette.roadbook.night : ApexCarPalette.roadbook.day
        map.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        map.isUserInteractionEnabled = false               // the base view takes no touches: Apple's templates own every control
        map.automaticallyAdjustsContentInset = false
        map.contentInset = .zero
        map.showsLogoView = false; map.showsAttributionButton = false; map.showsCompassView = false; map.showsScale = false
        map.showsUserLocation = false
        map.alpha = 0                                      // shown once the theme is painted over the style (no flash of its own colours)
        delegateProxy.owner = self
        map.delegate = delegateProxy
        addSubview(map)
        overlay.frame = bounds
        overlay.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        overlay.isUserInteractionEnabled = false
        addSubview(overlay)
        overlay.addSubview(sightTag)
        overlay.addSubview(puck)
        sightTag.isHidden = true
        puck.isHidden = true
        credit.text = "© OpenStreetMap · OpenFreeMap"
        credit.font = .systemFont(ofSize: 10, weight: .medium)
        credit.inset = UIEdgeInsets(top: 3, left: 7, bottom: 4, right: 6)
        addSubview(credit)
        let proxy = LinkProxy(); proxy.owner = self
        let l = CADisplayLink(target: proxy, selector: #selector(LinkProxy.tick(_:)))
        l.isPaused = true
        l.add(to: .main, forMode: .common)
        link = l
        paintPlatesAndCredit()
    }
    required init?(coder: NSCoder) { fatalError("not from a storyboard") }

    /// Called by the controller as the car screen goes away (and on deinit): the display link holds its target.
    func stop() { link?.invalidate(); link = nil }
    deinit { link?.invalidate() }

    override func layoutSubviews() {
        super.layoutSubviews()
        credit.sizeToFit()
        credit.frame.origin = CGPoint(x: bounds.width - credit.frame.width, y: bounds.height - credit.frame.height)
        if mode == "preview" { fitRoute(animated: false) } else { applyCamera(CACurrentMediaTime()) }
        placeOverlays()
        declutter()
    }

    // MARK: Style (web/carmap.js addLayers, web/basemap.js restyle)

    fileprivate func styleLoaded(_ s: MLNStyle) {
        style = s
        let firstSymbol = s.layers.first { $0 is MLNSymbolStyleLayer }
        let dem = MLNRasterDEMSource(identifier: "apex-dem", tileURLTemplates: [Self.demURL],
                                     options: [.tileSize: 256, .maximumZoomLevel: 13, .demEncoding: MLNDEMEncoding.terrarium.rawValue])
        s.addSource(dem)
        let hill = MLNHillshadeStyleLayer(identifier: "apex-hillshade", source: dem)
        if let firstSymbol { s.insertLayer(hill, below: firstSymbol) } else { s.addLayer(hill) }
        let src = MLNShapeSource(identifier: "car-route-src", shape: nil, options: nil)
        s.addSource(src)
        let width = { (a: Double, b: Double) in NSExpression(mglJSONObject: ["interpolate", ["linear"], ["zoom"], 10, a, 16, b] as [Any]) }
        for (id, w) in [("car-route-casing", width(6, 14)), ("car-route", width(4, 9))] {
            let l = MLNLineStyleLayer(identifier: id, source: src)
            l.lineCap = NSExpression(forConstantValue: "round")
            l.lineJoin = NSExpression(forConstantValue: "round")
            l.lineWidth = w
            s.addLayer(l)
        }
        styled = true
        restyle()
        showRouteLine()
        if mode == "preview" { fitRoute(animated: false) } else { applyCamera(CACurrentMediaTime()) }
        UIView.animate(withDuration: 0.2) { self.map.alpha = 1 }
    }

    fileprivate func styleFailed() {
        guard !styled else { return }                      // a style that loaded once keeps drawing from the tile cache
        onFail?()
    }

    private static func matches(_ s: String, _ pattern: String) -> Bool { s.range(of: pattern, options: .regularExpression) != nil }

    /// web/basemap.js restyle: the style's own layers repainted in the palette; buildings, POIs and house numbers hidden.
    private func restyle() {
        guard styled, let s = style else { return }
        let P = palette
        let k = { (c: UIColor) in NSExpression(forConstantValue: c) }
        for layer in s.layers {
            let id = layer.identifier.lowercased()
            if id.hasPrefix("apex-") || id.hasPrefix("car-") { continue }
            if Self.matches(id, "building|poi|housenumber|aeroway|ferry") { layer.isVisible = false; continue }
            switch layer {
            case let l as MLNBackgroundStyleLayer:
                l.backgroundColor = k(P.bg)
            case let l as MLNFillStyleLayer:
                if id.contains("water") { l.fillColor = k(P.water) }
                else if Self.matches(id, "wood|forest|park|grass|scrub|wetland") { l.fillColor = k(P.wood); l.fillOpacity = NSExpression(forConstantValue: 0.7) }
                else { l.fillColor = k(P.land); l.fillOpacity = NSExpression(forConstantValue: 0.5) }
                l.fillOutlineColor = k(.clear)
            case let l as MLNLineStyleLayer:
                if id.contains("water") { l.lineColor = k(P.waterLine) }
                else if id.contains("boundary") { l.lineColor = k(P.boundary) }
                else if Self.matches(id, "road|transportation|highway|bridge|tunnel|street|path") {
                    let minor = Self.matches(id, "minor|service|track|path|street|residential")
                    l.lineColor = k(id.contains("casing") ? P.casing : (minor ? P.roadMinor : P.road))
                } else if id.contains("rail") { l.lineColor = k(P.boundary) }
            case let l as MLNSymbolStyleLayer:
                l.textColor = k(P.label); l.textHaloColor = k(P.halo); l.textHaloWidth = NSExpression(forConstantValue: 1.4)
                l.iconOpacity = NSExpression(forConstantValue: 0)
            default:
                break
            }
        }
        if let h = s.layer(withIdentifier: "apex-hillshade") as? MLNHillshadeStyleLayer {
            // MapLibre Native 6.x takes the shadow and highlight as arrays of colours (one per light direction, multidirectional
            // hillshade): a bare UIColor here threw doesNotRecognizeSelector and crashed the app on every style load (2026-10-31)
            h.hillshadeShadowColor = NSExpression(forConstantValue: [P.shadow])
            h.hillshadeHighlightColor = NSExpression(forConstantValue: [P.highlight])
            h.hillshadeAccentColor = k(P.accentShade)
            h.hillshadeExaggeration = NSExpression(forConstantValue: 0.36)
        }
        (s.layer(withIdentifier: "car-route-casing") as? MLNLineStyleLayer)?.lineColor = k(P.casing)
        (s.layer(withIdentifier: "car-route") as? MLNLineStyleLayer)?.lineColor = k(P.route)
    }

    // MARK: The messages (ApexCarMapViewController)

    func setPalette(_ p: ApexCarPalette) {
        palette = p
        restyle()
        paintPlatesAndCredit()
    }

    func setRoute(_ coords: [CLLocationCoordinate2D]) {
        route = coords
        glide.setRoute(coords.map { (lat: $0.latitude, lon: $0.longitude) }, now: CACurrentMediaTime())
        showRouteLine()
        wake()
        placePlates()
        if mode == "preview" { fitRoute(animated: true) }
    }

    private func showRouteLine() {
        guard styled, let src = style?.source(withIdentifier: "car-route-src") as? MLNShapeSource else { return }
        if route.count >= 2 {
            var c = route
            src.shape = MLNPolyline(coordinates: &c, count: UInt(c.count))
        } else {
            src.shape = nil
        }
    }

    func setCorners(_ list: [ApexCarPlateData]) { corners = Array(list.prefix(600)); placePlates() }
    func setHazards(_ list: [ApexCarPlateData]) { hazards = Array(list.prefix(40)); placePlates() }

    func setSight(_ s: ApexCarSight?) {
        guard s != sight else { return }
        sight = s
        drawSight()
    }

    /// A new fix: speed in m/s (nil unknown), `at` when it was taken.
    func position(lat: Double, lon: Double, course: Double?, speed: Double?, at: Date) {
        let now = CACurrentMediaTime(), age = min(1.5, max(0, Date().timeIntervalSince(at)))
        let first = !hasPosition
        hasPosition = true
        glide.push(lat: lat, lon: lon, course: course, mps: speed, t: now - age, now: now)
        if first { drawSight() }
        if let p = glide.pose(at: now), placedAt.map({ CarGlide.metres($0.lat, $0.lon, p.lat, p.lon) > 800 }) ?? true {
            placedAt = (p.lat, p.lon); placePlates()              // plates follow the car, a few times a mile
        }
        wake()
    }
    private var placedAt: (lat: Double, lon: Double)?

    /// Following the car while guiding (heading up, pitched, the car low on the screen) or idle (north up); the whole route
    /// in a trip preview. A repeat does nothing.
    func setMode(_ m: String, inset px: CGFloat) {
        let now = CACurrentMediaTime()
        if px != inset { inset = px; if mode == "preview" { fitRoute(animated: false) } else { startBlend(now, dur: 0) } }
        guard m != mode else { return }
        mode = m
        follow = true
        if m == "guide" { followZoom = max(followZoom, 15) }
        if m == "preview" { fitRoute(animated: true) } else { startBlend(now, dur: 0.45) }
        placePlates()
        wake()
    }

    func zoom(_ dir: Int) {
        let step = dir > 0 ? 1.0 : -1.0
        if follow && mode != "preview" {
            followZoom = max(3, min(19, followZoom + step))
            startBlend(CACurrentMediaTime(), dur: 0.3)
            wake()
        } else {
            map.setZoomLevel(map.zoomLevel + step, animated: true)
        }
    }

    func pan(dx: Int, dy: Int) {
        follow = false
        blend = nil
        let mid = CGPoint(x: map.bounds.midX + CGFloat(dx) * map.bounds.width / 3, y: map.bounds.midY + CGFloat(dy) * map.bounds.height / 3)
        map.setCenter(map.convert(mid, toCoordinateFrom: map), animated: true)
        cam = nil
    }

    func recentre() {
        follow = true
        if mode == "preview" { mode = "idle" }
        startBlend(CACurrentMediaTime(), dur: 0.45)
        wake()
    }

    // MARK: The camera

    /// Where the camera follows the car to: heading up and pitched while guiding, north up otherwise (web/carmap.js followView).
    private func followCam(_ p: CarGlide.Pose) -> Cam {
        let guiding = mode == "guide"
        let pad = UIEdgeInsets(top: guiding ? bounds.height * 0.35 : 0, left: inset, bottom: 0, right: 0)
        return Cam(center: CLLocationCoordinate2D(latitude: p.lat, longitude: p.lon), zoom: guiding ? followZoom : min(followZoom, 16),
                   bearing: guiding ? (p.course ?? cam?.bearing ?? 0) : 0, pitch: guiding ? 45 : 0, pad: pad)
    }

    /// From the camera as it is now into the followed one over `dur` seconds (a mode, inset or zoom change).
    private func startBlend(_ now: CFTimeInterval, dur: CFTimeInterval) {
        let current = cam ?? Cam(center: map.centerCoordinate, zoom: map.zoomLevel, bearing: map.direction, pitch: Double(map.camera.pitch), pad: .zero)
        if dur > 0 { blend = (from: current, t0: now, dur: dur) } else { blend = nil; applyCamera(now) }
    }

    private func applyCamera(_ now: CFTimeInterval) {
        guard follow, mode != "preview", now >= previewUntil, let p = shown ?? glide.pose(at: now), bounds.width > 0 else { return }
        var c = followCam(p)
        if let b = blend {
            let k = min(1, (now - b.t0) / b.dur), e = k * k * (3 - 2 * k)
            let turn = CarGlide.turn(b.from.bearing, c.bearing)
            c = Cam(center: CLLocationCoordinate2D(latitude: b.from.center.latitude + (c.center.latitude - b.from.center.latitude) * e,
                                                   longitude: b.from.center.longitude + (c.center.longitude - b.from.center.longitude) * e),
                    zoom: b.from.zoom + (c.zoom - b.from.zoom) * e, bearing: b.from.bearing + turn * e, pitch: b.from.pitch + (c.pitch - b.from.pitch) * e,
                    pad: UIEdgeInsets(top: b.from.pad.top + (c.pad.top - b.from.pad.top) * e, left: b.from.pad.left + (c.pad.left - b.from.pad.left) * e,
                                      bottom: 0, right: 0))
            if k >= 1 { blend = nil }
        }
        cam = c
        let altitude = MLNAltitudeForZoomLevel(c.zoom, CGFloat(c.pitch), c.center.latitude, map.frame.size)
        let camera = MLNMapCamera(lookingAtCenter: c.center, altitude: altitude, pitch: CGFloat(c.pitch), heading: c.bearing)
        map.setCamera(camera, withDuration: 0, animationTimingFunction: nil, edgePadding: c.pad, completionHandler: nil)
    }

    /// The whole route, north up and flat, clear of Apple's card on the left (web/carmap.js camera, preview).
    private func fitRoute(animated: Bool) {
        guard route.count >= 2, bounds.width > 0 else { return }
        func merc(_ c: CLLocationCoordinate2D) -> (x: Double, y: Double) {
            let s = sin(c.latitude * .pi / 180)
            return ((c.longitude + 180) / 360, 0.5 - log((1 + s) / (1 - s)) / (4 * .pi))
        }
        var x0 = 1.0, x1 = 0.0, y0 = 1.0, y1 = 0.0
        for c in route { let m = merc(c); x0 = min(x0, m.x); x1 = max(x1, m.x); y0 = min(y0, m.y); y1 = max(y1, m.y) }
        let pad = UIEdgeInsets(top: 40, left: 40 + inset, bottom: 40, right: 80)
        let w = max(1, Double(bounds.width - pad.left - pad.right)), h = max(1, Double(bounds.height - pad.top - pad.bottom))
        // MapLibre's world is 512 points wide at zoom 0
        let zoom = min(15, log2(min(w / max(1e-9, (x1 - x0) * 512), h / max(1e-9, (y1 - y0) * 512))))
        let my = (y0 + y1) / 2, lat = atan(sinh(.pi * (1 - 2 * my))) * 180 / .pi, lon = (x0 + x1) / 2 * 360 - 180
        let center = CLLocationCoordinate2D(latitude: lat, longitude: lon)
        let camera = MLNMapCamera(lookingAtCenter: center, altitude: MLNAltitudeForZoomLevel(zoom, 0, lat, map.frame.size), pitch: 0, heading: 0)
        let dur = animated ? 0.6 : 0
        previewUntil = CACurrentMediaTime() + dur
        blend = nil
        cam = nil
        map.setCamera(camera, withDuration: dur, animationTimingFunction: CAMediaTimingFunction(name: .easeInEaseOut), edgePadding: pad,
                      completionHandler: { [weak self] in self?.placePlates() })
    }

    // MARK: The frame (CADisplayLink)

    private func wake() { link?.isPaused = false }

    fileprivate func step(_ link: CADisplayLink) {
        let now = link.targetTimestamp
        if let p = glide.pose(at: now) { shown = p }
        applyCamera(now)
        placeOverlays()
        if now - declutterAt > 0.25 { declutter() }
        let animating = glide.moving(at: now) || blend != nil || now < previewUntil
        if !animating { link.isPaused = true; declutter() }
    }

    /// The arrow, its sight plate and the plates where the map draws their points now.
    private func placeOverlays() {
        guard let p = shown else { puck.isHidden = true; sightTag.isHidden = true; return }
        let pt = map.convert(CLLocationCoordinate2D(latitude: p.lat, longitude: p.lon), toPointTo: overlay)
        guard pt.x.isFinite, pt.y.isFinite else { return }
        puck.isHidden = false
        puck.center = pt
        // the arrow lies on the map (MapLibre's pitchAlignment map on the web): turned by the course less the map's bearing,
        // flattened by the pitch
        let rot = CGFloat(((p.course ?? 0) - map.direction) * .pi / 180)
        let pitch = cam?.pitch ?? Double(map.camera.pitch)
        puck.transform = CGAffineTransform(scaleX: 1, y: CGFloat(cos(pitch * .pi / 180))).rotated(by: rot)
        sightTag.center = CGPoint(x: pt.x, y: pt.y + 21 + sightTag.bounds.height / 2)
        sightTag.isHidden = sight == nil
        for v in plates where v.on {
            let q = map.convert(CLLocationCoordinate2D(latitude: v.data.lat, longitude: v.data.lon), toPointTo: overlay)
            v.view.center = CGPoint(x: q.x + v.off.x, y: q.y + v.off.y - v.view.bounds.height / 2)
        }
    }

    // MARK: Plates (web/carmap.js placePlates, declutter)

    private final class Plate {
        let data: ApexCarPlateData
        let view: ApexCarPlateLabel
        let dy: CGFloat
        var on = false
        var off = CGPoint.zero
        init(_ d: ApexCarPlateData, view: ApexCarPlateLabel) { data = d; self.view = view; dy = d.hazard ? 6 : 8 }
    }
    private var plates: [Plate] = []
    private var declutterAt: CFTimeInterval = 0
    private static let nearM = 6000.0, clearPx: CGFloat = 28, cardGap: CGFloat = 16, edgePx: CGFloat = 6

    private func makePlate(_ d: ApexCarPlateData) -> Plate {
        let v = ApexCarPlateLabel()
        let p = Plate(d, view: v)
        paint(p)
        v.isHidden = true
        overlay.insertSubview(v, belowSubview: sightTag)          // the car and its sight speed above every plate
        return p
    }
    private func paint(_ p: Plate) {
        let v = p.view, P = palette
        if p.data.hazard {
            // the hazard plate in its fixed tokens (REVIEW.md 4.3): black, an orange edge and triangle
            let orange = UIColor(red: 1, green: 0x7A / 255, blue: 0x1A / 255, alpha: 1)
            let t = NSMutableAttributedString(string: "▲ ", attributes: [.foregroundColor: orange, .font: UIFont.systemFont(ofSize: 13, weight: .bold)])
            t.append(NSAttributedString(string: p.data.text, attributes: [.foregroundColor: UIColor.white, .font: UIFont.systemFont(ofSize: 15, weight: .bold)]))
            v.attributedText = t
            v.backgroundColor = UIColor(white: 0.067, alpha: 1)
            v.layer.borderColor = orange.cgColor; v.layer.borderWidth = 2.5
            v.inset = UIEdgeInsets(top: 5, left: 9, bottom: 5, right: 9)
        } else {
            v.text = p.data.text
            v.font = .systemFont(ofSize: 17, weight: .bold, width: .condensed)
            v.textColor = p.data.tight ? P.plate : P.plateInk
            v.backgroundColor = p.data.tight ? P.plateInk : P.plate
            v.layer.borderColor = P.plateInk.cgColor; v.layer.borderWidth = 2
            v.inset = UIEdgeInsets(top: 3, left: 7, bottom: 2, right: 7)
        }
        v.sizeToFit()
    }
    private func paintPlatesAndCredit() {
        plates.forEach(paint)
        puck.paint(panel: palette.plate, ink: palette.plateInk, accent: palette.accent)
        sightTag.palette = (palette.plate, palette.plateInk)
        drawSight()
        credit.backgroundColor = palette.bg
        credit.textColor = palette.label.withAlphaComponent(0.65)
        setNeedsLayout()
    }

    private func drawSight() {
        sightTag.set(hasPosition ? sight : nil)
        sightTag.isHidden = sight == nil || shown == nil
        declutterAt = 0
    }

    /// Only the plates near the car (or all, in a trip preview) are kept; a plate still wanted keeps its view.
    private func placePlates() {
        let here = shown ?? glide.pose(at: CACurrentMediaTime()), all = mode == "preview" || here == nil
        func dist(_ d: ApexCarPlateData) -> Double { here.map { CarGlide.metres($0.lat, $0.lon, d.lat, d.lon) } ?? 0 }
        let near = { (d: ApexCarPlateData) in all || dist(d) < Self.nearM }
        // which plate wins a crowded spot: hazards, then the corners nearest the car (or the tight ones, with no car)
        var cs = corners.filter(near)
        if all { cs.sort { $0.tight && !$1.tight } } else { cs.sort { dist($0) < dist($1) } }
        let wanted = hazards.filter(near) + cs.prefix(all ? 160 : 40)
        var old: [String: Plate] = [:]
        for p in plates { old[p.data.key] = p }
        plates = wanted.map { (d) -> Plate in
            if let p = old.removeValue(forKey: d.key) { return p }
            return makePlate(d)
        }
        for p in old.values { p.view.removeFromSuperview() }
        declutter()
    }

    /// In priority order, a plate that would overlap one already shown, the car, its sight plate, Apple's card or the credit,
    /// or be cut by the screen's edge, is hidden until the map moves enough to make room (U-77, U-74, U-89).
    private func declutter() {
        declutterAt = CACurrentMediaTime()
        guard !plates.isEmpty else { return }
        let W = bounds.width, H = bounds.height
        var shownBoxes: [CGRect] = []
        if let p = shown {
            let pt = map.convert(CLLocationCoordinate2D(latitude: p.lat, longitude: p.lon), toPointTo: overlay)
            if pt.x.isFinite && pt.y.isFinite {
                shownBoxes.append(CGRect(x: pt.x - 17, y: pt.y - 17, width: 34, height: 34).insetBy(dx: -Self.clearPx, dy: -Self.clearPx))
                if sight != nil {
                    let s = sightTag.bounds.size
                    shownBoxes.append(CGRect(x: pt.x - s.width / 2, y: pt.y + 21, width: s.width, height: s.height).insetBy(dx: -Self.clearPx, dy: -Self.clearPx))
                }
            }
        }
        if inset > 0 { shownBoxes.append(CGRect(x: -1e4, y: -1e4, width: 1e4 + inset + Self.cardGap, height: H + 2e4)) }
        shownBoxes.append(credit.frame.insetBy(dx: -3, dy: -3))
        let reach = max(17, sight != nil ? sightTag.bounds.width / 2 : 0) + Self.clearPx + 6
        for p in plates {
            let q = map.convert(CLLocationCoordinate2D(latitude: p.data.lat, longitude: p.data.lon), toPointTo: overlay)
            let w = p.view.bounds.width, h = p.view.bounds.height
            var spots = [CGPoint(x: 0, y: -p.dy)]
            if p.data.hazard { let side = reach + w / 2; spots += [CGPoint(x: side, y: h / 2), CGPoint(x: -side, y: h / 2), CGPoint(x: 0, y: h + p.dy + 17 + Self.clearPx)] }
            var at: CGPoint?
            if q.x.isFinite && q.y.isFinite {
                for o in spots {
                    let box = CGRect(x: q.x + o.x - w / 2 - 3, y: q.y + o.y - h - 3, width: w + 6, height: h + 6)
                    let inside = box.minX >= Self.edgePx && box.minY >= Self.edgePx && box.maxX <= W - Self.edgePx && box.maxY <= H - Self.edgePx
                    if inside && !shownBoxes.contains(where: { $0.intersects(box) }) { at = o; shownBoxes.append(box); break }
                }
            }
            p.on = at != nil
            p.off = at ?? .zero
            p.view.isHidden = !p.on
            if p.on { p.view.center = CGPoint(x: q.x + p.off.x, y: q.y + p.off.y - h / 2) }
        }
    }

    // MARK: Delegates (MapLibre and the display link call on the main thread)

    private final class MapDelegateProxy: NSObject, MLNMapViewDelegate {
        weak var owner: ApexNativeCarMap?
        func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) {
            MainActor.assumeIsolated { owner?.styleLoaded(style) }
        }
        func mapViewDidFailLoadingMap(_ mapView: MLNMapView, withError error: Error) {
            MainActor.assumeIsolated { owner?.styleFailed() }
        }
        func mapView(_ mapView: MLNMapView, regionDidChangeAnimated animated: Bool) {
            MainActor.assumeIsolated { if let o = owner, o.mode == "preview" || !o.follow { o.placeOverlays(); o.declutter() } }
        }
    }

    private final class LinkProxy: NSObject {
        weak var owner: ApexNativeCarMap?
        @objc func tick(_ link: CADisplayLink) {
            MainActor.assumeIsolated {
                if let owner { owner.step(link) } else { link.invalidate() }
            }
        }
    }
}

/// A plate's label with its padding, an ink border and the plate's ground.
final class ApexCarPlateLabel: UILabel {
    var inset = UIEdgeInsets(top: 3, left: 7, bottom: 2, right: 7) { didSet { invalidateIntrinsicContentSize() } }
    override func drawText(in rect: CGRect) { super.drawText(in: rect.inset(by: inset)) }
    override func sizeThatFits(_ size: CGSize) -> CGSize {
        let s = super.sizeThatFits(size)
        return CGSize(width: ceil(s.width + inset.left + inset.right), height: ceil(s.height + inset.top + inset.bottom))
    }
    override var intrinsicContentSize: CGSize { sizeThatFits(CGSize(width: CGFloat.greatestFiniteMagnitude, height: .greatestFiniteMagnitude)) }
}

/// The car's arrow (web/carmap.js drawPuck): a disc in the plate's colours, the arrow in the accent.
final class ApexCarPuckView: UIView {
    private let disc = CAShapeLayer(), arrow = CAShapeLayer()
    override init(frame: CGRect) {
        super.init(frame: CGRect(x: 0, y: 0, width: 34, height: 34))
        disc.path = UIBezierPath(ovalIn: CGRect(x: 3, y: 3, width: 28, height: 28)).cgPath
        disc.lineWidth = 2.5
        let a = UIBezierPath()
        a.move(to: CGPoint(x: 17, y: 7)); a.addLine(to: CGPoint(x: 25, y: 24)); a.addLine(to: CGPoint(x: 17, y: 19.8)); a.addLine(to: CGPoint(x: 9, y: 24)); a.close()
        arrow.path = a.cgPath
        layer.addSublayer(disc); layer.addSublayer(arrow)
        isUserInteractionEnabled = false
    }
    required init?(coder: NSCoder) { fatalError("not from a storyboard") }
    func paint(panel: UIColor, ink: UIColor, accent: UIColor) {
        disc.fillColor = panel.cgColor; disc.strokeColor = ink.cgColor; arrow.fillColor = accent.cgColor
    }
}

/// The sight-line speed under the arrow (web/carmap.js drawSight): an eye, the number and its unit; signal red when the car
/// is going faster than it; hidden when unknown.
final class ApexCarSightView: UIView {
    private let label = ApexCarPlateLabel()
    var palette: (plate: UIColor, ink: UIColor) = (.white, .black)
    private var value: ApexCarSight?
    override init(frame: CGRect) {
        super.init(frame: frame)
        label.inset = UIEdgeInsets(top: 2, left: 7, bottom: 1, right: 7)
        label.layer.borderWidth = 2
        addSubview(label)
        isUserInteractionEnabled = false
    }
    required init?(coder: NSCoder) { fatalError("not from a storyboard") }
    func set(_ s: ApexCarSight?) {
        value = s
        guard let s else { return }
        let red = UIColor(red: 0xC8 / 255, green: 0x10 / 255, blue: 0x2E / 255, alpha: 1)
        let ink = s.short ? UIColor.white : palette.ink
        label.backgroundColor = s.short ? red : palette.plate
        label.layer.borderColor = ink.cgColor
        let t = NSMutableAttributedString()
        if let eye = UIImage(systemName: "eye", withConfiguration: UIImage.SymbolConfiguration(pointSize: 13, weight: .bold))?.withTintColor(ink, renderingMode: .alwaysOriginal) {
            t.append(NSAttributedString(attachment: NSTextAttachment(image: eye)))
            t.append(NSAttributedString(string: " "))
        }
        t.append(NSAttributedString(string: s.text, attributes: [.foregroundColor: ink, .font: UIFont.systemFont(ofSize: 19, weight: .bold, width: .condensed)]))
        if !s.unit.isEmpty { t.append(NSAttributedString(string: s.unit, attributes: [.foregroundColor: ink, .font: UIFont.systemFont(ofSize: 11, weight: .bold, width: .condensed), .kern: 0.4])) }
        label.attributedText = t
        label.sizeToFit()
        bounds = CGRect(origin: .zero, size: label.bounds.size)
        label.frame = bounds
    }
}
