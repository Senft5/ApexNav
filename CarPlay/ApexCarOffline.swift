import Foundation
import CoreLocation
import MapLibre

/// The car map's own offline maps (IDEAS F-02 / F-03 on the car's screen). A map area or a route's map saved on the phone
/// lives in the page's IndexedDB (web/offline_tiles.js), which MapLibre Native can't read, so with no signal the car's map
/// (ApexCarMap.swift) went blank where the phone still had the map. The page sends the list of saved areas each time it
/// changes and at launch (offline_tiles.js packOf: a box, or a route's corridor as z13 squares), and this keeps one MapLibre
/// offline pack per area to match: added when new or updated (its `at` changed), resumed when unfinished, removed when the
/// area is deleted. MapLibre serves a pack's tiles with no signal from the same style URL the car's map draws.
///
/// Only on a phone that has been connected to a car: the packs fetch the same tiles a second time, so a phone that never
/// meets CarPlay never pays for them. The list waits in UserDefaults until then, and the first connection catches up.
@MainActor
final class ApexCarOffline {
    static let shared = ApexCarOffline()

    struct Want: Codable, Equatable {
        let id: String
        let at: String
        let bounds: [Double]            // [south, west, north, east]
        let squares: [[Double]]?        // a route's corridor, each [south, west, north, east]
        var key: String { "\(id)|\(at)" }
    }

    private let wantKey = "apex.carOfflineWant", seenKey = "apex.carSeen", tag = "vetta-car"
    private var tries = 0
    private var observing = false, reportedAt = Date.distantPast, reportedBytes: UInt64? = nil
    /// Sends to the page (set by the shell): the bytes the car's packs hold, for Garage → Your data (IDEAS F-06).
    var toPage: (([String: Any]) -> Void)? {
        didSet { reportedBytes = nil; report(throttled: false) }       // a page (re)loaded: tell it again
    }
    static let minZoom = 8.0, maxZoom = 14.0, maxSquares = 2000

    /// The page's list (cmd "offlinePacks", web/offline_tiles.js tellShell). Kept; acted on once a car has been connected.
    func receive(_ dict: [String: Any]) {
        guard let list = dict["packs"] as? [Any] else { return }
        let wants = list.compactMap { ($0 as? [String: Any]).flatMap(Self.want) }
        if let data = try? JSONEncoder().encode(wants) { UserDefaults.standard.set(data, forKey: wantKey) }
        reconcile()
    }

    /// A car connected (CarPlay/ApexCarPlay.swift): from now on this phone keeps the car's offline maps.
    func carConnected() {
        UserDefaults.standard.set(true, forKey: seenKey)
        reconcile()
    }

    static func want(_ d: [String: Any]) -> Want? {
        guard let id = d["id"] as? String, !id.isEmpty, id.count <= 120 else { return nil }
        let at = (d["at"] as? String) ?? ""
        let b = numbers(d["bounds"])
        guard valid(b) else { return nil }
        let sq = ((d["squares"] as? [Any]) ?? []).map(numbers).filter(valid)
        return Want(id: id, at: at, bounds: b, squares: sq.isEmpty ? nil : Array(sq.prefix(maxSquares)))
    }
    private static func numbers(_ v: Any?) -> [Double] { ((v as? [Any]) ?? []).compactMap { ($0 as? NSNumber)?.doubleValue } }
    static func valid(_ b: [Double]) -> Bool {
        b.count == 4 && b.allSatisfy { $0.isFinite } && b[0] >= -85 && b[2] <= 85 && b[0] < b[2] && b[1] >= -180 && b[3] <= 180 && b[1] < b[3]
    }

    private func wants() -> [Want] {
        guard let data = UserDefaults.standard.data(forKey: wantKey) else { return [] }
        return (try? JSONDecoder().decode([Want].self, from: data)) ?? []
    }

    /// The key a pack of ours was made for, or nil for a pack that isn't ours.
    private func keyOf(_ pack: MLNOfflinePack) -> String? {
        guard let obj = try? JSONSerialization.jsonObject(with: pack.context) as? [String: Any], obj["tag"] as? String == tag else { return nil }
        return obj["key"] as? String
    }

    func reconcile() {
        guard UserDefaults.standard.bool(forKey: seenKey) else { return }
        let storage = MLNOfflineStorage.shared
        guard let packs = storage.packs else {
            // the packs are read from disk after launch: look again shortly
            tries += 1
            if tries <= 30 { DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in self?.reconcile() } }
            return
        }
        tries = 0
        if !observing {
            observing = true
            NotificationCenter.default.addObserver(forName: .MLNOfflinePackProgressChanged, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.report(throttled: true) }
            }
        }
        let want = wants(), wanted = Set(want.map(\.key))
        var have = Set<String>()
        for pack in packs {
            guard let key = keyOf(pack) else { continue }                 // not ours: left alone
            if wanted.contains(key) && !have.contains(key) {
                have.insert(key)
                if pack.state != .complete { pack.resume() }                // unfinished (no signal then): carry on
                else { pack.requestProgress() }                             // its size, for Your data
            } else {
                storage.removePack(pack, withCompletionHandler: nil)        // deleted, updated (a new `at`), or a duplicate
            }
        }
        for w in want where !have.contains(w.key) { add(w) }
        report(throttled: false)
    }

    /// What the car's packs hold on the phone, to the page: at most every 5 s while they download, and when it changes.
    private func report(throttled: Bool) {
        guard let toPage, let packs = MLNOfflineStorage.shared.packs else { return }
        if throttled && Date().timeIntervalSince(reportedAt) < 5 { return }
        let ours = packs.filter { keyOf($0) != nil }
        let bytes = ours.reduce(UInt64(0)) { $0 + $1.progress.countOfBytesCompleted }
        guard bytes != reportedBytes else { return }
        reportedAt = Date(); reportedBytes = bytes
        toPage(["type": "carOffline", "bytes": NSNumber(value: bytes), "packs": ours.count, "done": ours.allSatisfy { $0.state == .complete }])
    }

    private func add(_ w: Want) {
        guard let context = try? JSONSerialization.data(withJSONObject: ["tag": tag, "key": w.key, "id": w.id]) else { return }
        let style = ApexNativeCarMap.styleURL
        let region: MLNOfflineRegion
        if let squares = w.squares {
            let polygons = squares.map { b -> MLNPolygon in
                let ring = [CLLocationCoordinate2D(latitude: b[0], longitude: b[1]), CLLocationCoordinate2D(latitude: b[0], longitude: b[3]),
                            CLLocationCoordinate2D(latitude: b[2], longitude: b[3]), CLLocationCoordinate2D(latitude: b[2], longitude: b[1]),
                            CLLocationCoordinate2D(latitude: b[0], longitude: b[1])]
                return MLNPolygon(coordinates: ring, count: UInt(ring.count))
            }
            region = MLNShapeOfflineRegion(styleURL: style, shape: MLNMultiPolygon(polygons: polygons), fromZoomLevel: Self.minZoom, toZoomLevel: Self.maxZoom)
        } else {
            let b = w.bounds
            let bounds = MLNCoordinateBounds(sw: CLLocationCoordinate2D(latitude: b[0], longitude: b[1]), ne: CLLocationCoordinate2D(latitude: b[2], longitude: b[3]))
            region = MLNTilePyramidOfflineRegion(styleURL: style, bounds: bounds, fromZoomLevel: Self.minZoom, toZoomLevel: Self.maxZoom)
        }
        MLNOfflineStorage.shared.addPack(for: region, withContext: context) { pack, error in
            if let pack { pack.resume() } else if let error { NSLog("car offline pack %@: %@", w.id, error.localizedDescription) }
        }
    }
}
