// Drive cam (big bet 5, docs/notes/2026-11-13-big-bets.md): with "Film the drive" on, the phone's back camera films the
// road from the mount while a drive runs, so its video is lined up with the drive by itself. Each stretch of filming is
// one file, Documents/DriveCam/<start ms>.mov, named for the moment its first frame was recorded (the drive's own clock,
// web/recording.js t0 and t_s, is the same Unix ms). iOS stops the camera while the app is not on screen (the phone
// locked, another app, the car's screen alone); filming starts again in a new file when the app is back, so a drive can
// have several. No sound is recorded (no microphone permission). The files stay on the phone, in the app's Files folder,
// and the oldest go first once they pass `capBytes`. The page lists them at apexnav://…/drivecam/index.json and plays
// them at apexnav://…/drivecam/<name> (ApexBundleSchemeHandler).
import AVFoundation
import Foundation
import UIKit

final class ApexDriveCam: NSObject, AVCaptureFileOutputRecordingDelegate {
    static let shared = ApexDriveCam()
    static let capBytes: Int64 = 6_000_000_000                        // ~2 hours at 720p HEVC; the oldest files go first
    static var directory: URL? {
        guard let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return nil }
        return docs.appendingPathComponent("DriveCam", isDirectory: true)
    }
    /// A file name this folder can hold: "<digits>.mov" only, so a path from the page can never leave it.
    static func validName(_ name: String) -> Bool {
        guard name.hasSuffix(".mov") else { return false }
        let stem = name.dropLast(4)
        return (10...16).contains(stem.count) && stem.allSatisfy { $0.isASCII && $0.isNumber }
    }

    private let session = AVCaptureSession()
    private let output = AVCaptureMovieFileOutput()
    private let queue = DispatchQueue(label: "Vetta drive cam")
    private var configured = false
    private var wanted = false                                         // the page asked for filming (a drive with the switch on)
    private var startedAt: [URL: Double] = [:]                         // a file being written -> its first frame's Unix ms
    /// What the page is told: { type: "driveCam", state: "on" | "off" | "denied" | "unavailable" }.
    var onState: (@MainActor ([String: Any]) -> Void)?   // set and called on the main thread only

    private override init() {
        super.init()
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(resume), name: .AVCaptureSessionInterruptionEnded, object: session)
        nc.addObserver(self, selector: #selector(resume), name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    /// The page's switch for this drive: on when a drive starts with "Film the drive" set, off when it ends.
    func set(on: Bool) {
        queue.async { [self] in
            wanted = on
            if !on { stopFilming(); return }
            switch AVCaptureDevice.authorizationStatus(for: .video) {
            case .authorized:
                startFilming()
            case .notDetermined:
                AVCaptureDevice.requestAccess(for: .video) { [weak self] ok in
                    guard let self else { return }
                    self.queue.async { if ok { self.startFilming() } else { self.tell("denied") } }
                }
            default:
                tell("denied")
            }
        }
    }

    /// Back on screen (or the camera given back after a call): the drive is still on, so filming carries on in a new file.
    @objc private func resume() { queue.async { [self] in if wanted { startFilming() } } }

    private func configure() -> Bool {
        if configured { return true }
        guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
              let input = try? AVCaptureDeviceInput(device: camera) else { return false }
        session.beginConfiguration()
        session.sessionPreset = session.canSetSessionPreset(.hd1280x720) ? .hd1280x720 : .high
        guard session.canAddInput(input), session.canAddOutput(output) else { session.commitConfiguration(); return false }
        session.addInput(input)
        session.addOutput(output)
        output.movieFragmentInterval = CMTime(seconds: 5, preferredTimescale: 600)   // a file cut off by iOS keeps all but its last few seconds
        if let c = output.connection(with: .video) {
            if output.availableVideoCodecTypes.contains(.hevc) { output.setOutputSettings([AVVideoCodecKey: AVVideoCodecType.hevc], for: c) }
            if c.isVideoStabilizationSupported { c.preferredVideoStabilizationMode = .standard }
        }
        session.commitConfiguration()
        configured = true
        return true
    }

    private func startFilming() {
        guard wanted, !output.isRecording, let dir = Self.directory else { return }
        guard configure() else { tell("unavailable"); return }
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        prune(dir)
        if !session.isRunning { session.startRunning() }
        guard session.isRunning else { return }                          // not on screen: tried again when the app is back
        // landscape mount or portrait, the file is recorded the way up the phone is held when filming starts
        if let c = output.connection(with: .video) { orient(c) }
        let tmp = dir.appendingPathComponent("filming-\(UUID().uuidString).mov")
        output.startRecording(to: tmp, recordingDelegate: self)
    }

    private func orient(_ c: AVCaptureConnection) {
        // the phone's screen as it is turned (a window scene's interface orientation; the device's own reads unknown here)
        let o: UIInterfaceOrientation = DispatchQueue.main.sync {
            MainActor.assumeIsolated {
                UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first?.interfaceOrientation ?? .portrait
            }
        }
        let angle: CGFloat
        switch o {
        case .landscapeRight: angle = 0                                  // (the interface's right is the device's left)
        case .landscapeLeft: angle = 180
        case .portraitUpsideDown: angle = 270
        default: angle = 90
        }
        if #available(iOS 17.0, *), c.isVideoRotationAngleSupported(angle) { c.videoRotationAngle = angle }
    }

    private func stopFilming() {
        if output.isRecording { output.stopRecording() }
        if session.isRunning { session.stopRunning() }
        tell("off")
    }

    private func tell(_ state: String) {
        let msg: [String: Any] = ["type": "driveCam", "state": state]
        DispatchQueue.main.async { [weak self] in MainActor.assumeIsolated { self?.onState?(msg) } }
    }

    // MARK: AVCaptureFileOutputRecordingDelegate

    func fileOutput(_ output: AVCaptureFileOutput, didStartRecordingTo fileURL: URL, from connections: [AVCaptureConnection]) {
        let at = (Date().timeIntervalSince1970 * 1000).rounded()
        queue.async { [self] in startedAt[fileURL] = at; tell("on") }
    }

    func fileOutput(_ output: AVCaptureFileOutput, didFinishRecordingTo outputFileURL: URL, from connections: [AVCaptureConnection], error: Error?) {
        queue.async { [self] in
            let at = startedAt.removeValue(forKey: outputFileURL)
            // an interrupted file is still a good file up to where it stopped (AVErrorRecordingSuccessfullyFinishedKey)
            let ok = error == nil || ((error as NSError?)?.userInfo[AVErrorRecordingSuccessfullyFinishedKey] as? Bool ?? false)
            guard ok, let at, let dir = Self.directory else { try? FileManager.default.removeItem(at: outputFileURL); return }
            try? FileManager.default.moveItem(at: outputFileURL, to: dir.appendingPathComponent("\(Int64(at)).mov"))
        }
    }

    // MARK: The files

    /// The finished files, oldest first: [{ name, start_ms, dur_s }]. dur_s is null until the file can be read.
    static func list() -> [[String: Any]] {
        guard let dir = directory,
              let names = try? FileManager.default.contentsOfDirectory(atPath: dir.path) else { return [] }
        return names.filter(validName).sorted().compactMap { name in
            guard let ms = Double(name.dropLast(4)) else { return nil }
            let asset = AVURLAsset(url: dir.appendingPathComponent(name))
            let d = CMTimeGetSeconds(asset.duration)
            var dur: Any = NSNull()
            if d.isFinite && d > 0 { dur = d }
            return ["name": name, "start_ms": ms, "dur_s": dur]
        }
    }

    /// The oldest finished files go once the folder holds more than capBytes.
    private func prune(_ dir: URL) {
        let fm = FileManager.default
        guard let names = try? fm.contentsOfDirectory(atPath: dir.path) else { return }
        var files = names.filter(Self.validName).sorted().map { dir.appendingPathComponent($0) }
        func size(_ u: URL) -> Int64 { Int64((try? u.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0) }   // (not a timestamp API)
        var total = files.reduce(Int64(0)) { $0 + size($1) }
        while total > Self.capBytes, let first = files.first {
            total -= size(first)
            try? fm.removeItem(at: first)
            files.removeFirst()
        }
        // a file left half-written by a crash has no start time and cannot be lined up
        for n in names where n.hasPrefix("filming-") && startedAt.keys.allSatisfy({ $0.lastPathComponent != n }) {
            try? fm.removeItem(at: dir.appendingPathComponent(n))
        }
    }
}
