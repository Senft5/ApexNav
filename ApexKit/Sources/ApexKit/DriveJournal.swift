import Foundation

/// One fix of a drive as the page's recorder takes it (web/sensors.js Recorder.add): the live frame's own field names.
public struct JournalFrame: Codable, Equatable, Sendable {
    public var seq: Int
    public var at: Double              // ms since 1970, when the shell sent it
    public var lat: Double
    public var lon: Double
    public var accuracyM: Double?
    public var speedMps: Double?
    public var courseDeg: Double?
    public var elevationM: Double?
    public var latG: Double?
    public var lonG: Double?
    public var camberDeg: Double?
    public var crestVerticalG: Double?
    public var roughnessRms: Double?
    public var vertPeakG: Double?
    public var calibration: String?
    public var hasFix: Bool

    enum CodingKeys: String, CodingKey {
        case seq, at, lat, lon, calibration
        case accuracyM = "accuracy_m", speedMps = "speed_mps", courseDeg = "course_deg", elevationM = "elevation_m"
        case latG = "lat_g", lonG = "lon_g", camberDeg = "camber_deg", crestVerticalG = "crest_vertical_g"
        case roughnessRms = "roughness_rms", vertPeakG = "vert_peak_g", hasFix = "has_fix"
    }

    public init(seq: Int, at: Double, lat: Double, lon: Double, accuracyM: Double? = nil, speedMps: Double? = nil,
                courseDeg: Double? = nil, elevationM: Double? = nil, latG: Double? = nil, lonG: Double? = nil,
                camberDeg: Double? = nil, crestVerticalG: Double? = nil, roughnessRms: Double? = nil,
                vertPeakG: Double? = nil, calibration: String? = nil) {
        self.seq = seq; self.at = at; self.lat = lat; self.lon = lon; self.accuracyM = accuracyM; self.speedMps = speedMps
        self.courseDeg = courseDeg; self.elevationM = elevationM; self.latG = latG; self.lonG = lonG; self.camberDeg = camberDeg
        self.crestVerticalG = crestVerticalG; self.roughnessRms = roughnessRms; self.vertPeakG = vertPeakG
        self.calibration = calibration; self.hasFix = true
    }
}

/// Round 3 (the owner's drive to work, 2026-10-30; web/drive_keep.js): the fixes of a drive the page has not yet kept.
/// The page checkpoints its recording to IndexedDB every few seconds and says up to which frame (`durable(through:)`);
/// every fix after that is here, appended to a file as it comes. A page suspended in the background takes them back as a
/// backlog; a page or app that was closed takes them back at the next launch. Nothing is made up: one entry per new
/// position (the frames between two fixes share one), and the largest vertical spike of the frames in between rides on
/// the next new position, as measured.
/// File: one JSON header line {"id", "durable"}, then one JSON frame per line. Pure Foundation, so it is tested on Linux.
public final class DriveJournal {
    public let id: String
    public private(set) var frames: [JournalFrame] = []
    public private(set) var durableSeq: Int = -1
    public let url: URL?
    private var lastLat: Double?
    private var lastLon: Double?
    private var pendingPeak: Double?

    private struct Header: Codable { let id: String; let durable: Int }

    /// A page-given id is a file name here: letters, digits, dash and underscore, at most 64, or nothing is journaled.
    public static func validID(_ id: String) -> Bool {
        !id.isEmpty && id.count <= 64 && id.unicodeScalars.allSatisfy { ($0.isASCII && CharacterSet.alphanumerics.contains($0)) || $0 == "-" || $0 == "_" }
    }

    /// A new journal for a drive, written under `directory` (nil: memory only).
    public init?(id: String, directory: URL?) {
        guard Self.validID(id) else { return nil }
        self.id = id
        self.url = directory?.appendingPathComponent("\(id).jsonl")
        if let directory { try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true) }
        rewrite()
    }

    private init(id: String, url: URL, frames: [JournalFrame], durable: Int) {
        self.id = id; self.url = url; self.frames = frames; self.durableSeq = durable
        if let last = frames.last { lastLat = last.lat; lastLon = last.lon }
    }

    /// A fix the shell sent the page. Kept only at a new position; a frame at the last one adds only its spike.
    public func add(_ frame: JournalFrame) {
        guard frame.lat.isFinite, frame.lon.isFinite else { return }
        if frame.lat == lastLat && frame.lon == lastLon {
            if let p = frame.vertPeakG, p.isFinite { pendingPeak = max(pendingPeak ?? p, p) }
            return
        }
        var f = frame
        if let p = pendingPeak { f.vertPeakG = max(f.vertPeakG ?? p, p) }
        pendingPeak = nil
        lastLat = f.lat; lastLon = f.lon
        frames.append(f)
        append(f)
    }

    /// The page kept every frame up to `seq`: they leave the journal.
    public func durable(through seq: Int) {
        guard seq > durableSeq else { return }
        durableSeq = seq
        frames.removeAll { $0.seq <= seq }
        rewrite()
    }

    /// The frames after `seq` (the ones the page has not taken), oldest first.
    public func after(_ seq: Int) -> [JournalFrame] { frames.filter { $0.seq > seq } }

    /// The drive was saved: the journal goes.
    public func remove() {
        if let url { try? FileManager.default.removeItem(at: url) }
        frames = []
    }

    /// Every journal left in `directory` (a drive the app was closed in), oldest file first.
    public static func all(in directory: URL) -> [DriveJournal] {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
        return names.filter { $0.hasSuffix(".jsonl") }.sorted().compactMap { load(directory.appendingPathComponent($0)) }
    }

    /// A journal read back from its file; a torn last line (the app ended mid-write) is dropped, the rest kept.
    public static func load(_ url: URL) -> DriveJournal? {
        guard let data = try? Data(contentsOf: url), let text = String(data: data, encoding: .utf8) else { return nil }
        let lines = text.split(separator: "\n", omittingEmptySubsequences: true)
        let dec = JSONDecoder()
        guard let first = lines.first, let header = try? dec.decode(Header.self, from: Data(first.utf8)), validID(header.id) else { return nil }
        let frames = lines.dropFirst().compactMap { try? dec.decode(JournalFrame.self, from: Data($0.utf8)) }.filter { $0.seq > header.durable }
        return DriveJournal(id: header.id, url: url, frames: frames, durable: header.durable)
    }

    /// The frames as the page's JSON (an array of live frames).
    public static func json(_ frames: [JournalFrame]) -> String {
        guard let data = try? JSONEncoder().encode(frames), let s = String(data: data, encoding: .utf8) else { return "[]" }
        return s
    }

    private func line<T: Encodable>(_ v: T) -> Data? {
        guard var d = try? JSONEncoder().encode(v) else { return nil }
        d.append(0x0A)
        return d
    }

    private func append(_ f: JournalFrame) {
        guard let url, let d = line(f) else { return }
        guard let h = try? FileHandle(forWritingTo: url) else { rewrite(); return }
        defer { try? h.close() }
        _ = try? h.seekToEnd()
        try? h.write(contentsOf: d)
    }

    private func rewrite() {
        guard let url, var out = line(Header(id: id, durable: durableSeq)) else { return }
        for f in frames { if let d = line(f) { out.append(d) } }
        try? out.write(to: url, options: .atomic)
    }
}
