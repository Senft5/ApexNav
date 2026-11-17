// Practice Loop's voice range (Nate 2026-11-17): "a range test where you sing as high as possible and low as possible and
// it will only include tones in that range for that session". The app listens to the microphone while the test runs
// (PracticeLoop.swift) and hands the samples to `PracticeRangeTracker`, which finds the pitch of each stretch with YIN
// (de Cheveigné & Kawahara 2002) and keeps the lowest and highest note held long enough to count. The picker then places
// each block's root so its whole repetition, root to octave, sits inside the range (`PracticePicker.next(range:)`).
// Pure, so it is tested on Linux with made-up voices (Tests/ApexKitTests/PracticeVoiceTests).
import Foundation

public enum PracticePitch {
    /// The fundamental of `x` (a window of at least `2 * sampleRate / minHz` samples) by YIN: the first lag whose
    /// cumulative-mean-normalised difference dips under `threshold`, refined by a parabola. nil for silence, noise, or a
    /// pitch outside minHz...maxHz. `clarity` is 1 - the dip (1: a pure tone).
    public static func detect(_ x: [Float], sampleRate: Double, minHz: Double = 60, maxHz: Double = 1400,
                              threshold: Float = 0.15) -> (hz: Double, clarity: Double)? {
        let maxTau = Int(sampleRate / minHz), minTau = max(2, Int(sampleRate / maxHz))
        let w = x.count - maxTau - 1
        guard w >= maxTau / 2, maxTau > minTau + 2 else { return nil }
        var energy: Float = 0
        for i in 0..<w { energy += x[i] * x[i] }
        guard energy / Float(w) > 1e-6 else { return nil }           // about -60 dBFS: nothing sung
        var d = [Float](repeating: 0, count: maxTau + 2)
        x.withUnsafeBufferPointer { p in
            for tau in 1...(maxTau + 1) {
                var s: Float = 0
                for i in 0..<w { let e = p[i] - p[i + tau]; s += e * e }
                d[tau] = s
            }
        }
        var cmnd = [Float](repeating: 1, count: maxTau + 2)
        var run: Float = 0
        for tau in 1...(maxTau + 1) {
            run += d[tau]
            cmnd[tau] = run > 0 ? d[tau] * Float(tau) / run : 1
        }
        var tau = minTau
        var found = -1
        while tau <= maxTau {
            if cmnd[tau] < threshold {
                while tau + 1 <= maxTau && cmnd[tau + 1] < cmnd[tau] { tau += 1 }
                found = tau
                break
            }
            tau += 1
        }
        guard found > 0 else { return nil }
        let a = cmnd[found - 1], b = cmnd[found], c = cmnd[found + 1]
        let den = a - 2 * b + c
        let shift = den != 0 ? Double((a - c) / (2 * den)) : 0
        let period = Double(found) + max(-1, min(1, shift))
        let hz = sampleRate / period
        guard hz >= minHz * 0.97, hz <= maxHz * 1.03 else { return nil }
        return (hz, Double(1 - b))
    }

    public static func midi(hz: Double) -> Double { 69 + 12 * log2(hz / 440) }

    /// "E2", "F♯4": the root names with the octave (middle C, MIDI 60, is C4).
    public static func name(midi: Int) -> String { "\(PracticeTheory.rootNames[((midi % 12) + 12) % 12])\(Int(floor(Double(midi) / 12)) - 1)" }
}

/// Listens through one step of the range test: feed it the microphone's samples as they come; it analyses a window every
/// `hop` samples and keeps every note held for `holdS` (the same semitone, within a quarter tone either way, frame after frame).
public final class PracticeRangeTracker {
    public let sampleRate: Double
    public let window: Int
    public let hop: Int
    public static let holdS = 0.35

    private var buf: [Float] = []
    private var run: [Double] = []               // the MIDI pitches of the stretch being held now
    public private(set) var now: Int?            // the semitone heard in the last window
    public private(set) var lowest: Int?         // the lowest and highest held notes so far
    public private(set) var highest: Int?

    public init(sampleRate: Double) {
        self.sampleRate = sampleRate
        window = Int((sampleRate / 60).rounded(.up)) * 2 + 64
        hop = Int(sampleRate * 0.025)
    }

    public func feed(_ samples: [Float]) {
        buf.append(contentsOf: samples)
        while buf.count >= window {
            analyse(Array(buf[0..<window]))
            buf.removeFirst(min(hop, buf.count))
        }
    }

    public func reset() { buf = []; run = []; now = nil; lowest = nil; highest = nil }

    private func analyse(_ x: [Float]) {
        guard let p = PracticePitch.detect(x, sampleRate: sampleRate) else { endRun(); now = nil; return }
        let m = PracticePitch.midi(hz: p.hz)
        now = Int(m.rounded())
        if let first = run.first, abs(m - first) > 0.5 || Int(m.rounded()) != Int(first.rounded()) { endRun() }
        run.append(m)
        held()
    }

    private var framesToHold: Int { Int((Self.holdS * sampleRate / Double(hop)).rounded(.up)) }

    /// A stretch long enough counts at once (so the page can show it while it is still being sung).
    private func held() {
        guard run.count >= framesToHold else { return }
        let sorted = run.sorted()
        let note = Int(sorted[sorted.count / 2].rounded())
        lowest = min(lowest ?? note, note)
        highest = max(highest ?? note, note)
    }

    private func endRun() { run = [] }
}

/// The session's range, lowest and highest MIDI note, and where a block's root may sit in it.
public enum PracticeRange {
    /// A range must hold a whole repetition (root to octave) to be used.
    public static func usable(_ lo: Int, _ hi: Int) -> Bool { hi - lo >= 12 }

    /// The MIDI notes a block's root may start on so that root...root+12 is inside lo...hi, for `root` (pitch class) or any.
    /// When the locked key has no place that fits, the place that sticks out least.
    public static func bases(_ range: ClosedRange<Int>, root: Int?) -> [Int] {
        let lo = range.lowerBound, hi = range.upperBound
        let fit = hi - 12 >= lo ? Array(lo...(hi - 12)) : []
        if let r = root {
            let mine = fit.filter { ((($0 % 12) + 12) % 12) == r }
            if !mine.isEmpty { return mine }
            let all = stride(from: lo - 12, through: hi, by: 1).filter { ((($0 % 12) + 12) % 12) == r }
            let over = { (b: Int) in max(0, lo - b) + max(0, b + 12 - hi) }
            let least = all.map(over).min() ?? 0
            return all.filter { over($0) == least }
        }
        if !fit.isEmpty { return fit }
        return [lo + (hi - lo - 12) / 2]                             // under an octave: centred, as close as it gets
    }
}
