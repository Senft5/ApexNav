// Practice Loop (the owner, 2026-11-17): an endless ear-training and time player, for the owner only. A metronome click
// in 4/4 (beat 1 accented) at a random standard tempo, with a random scale, mode or arpeggio played over it in 8th notes
// (up, then down) over a quiet drone on the root, and a callout before each block ("D Dorian, 92 BPM"). Each block repeats
// 5 to 10 times, then a new one is picked.
//
// This file is the pure part, free of AVFoundation so it is tested on Linux and macOS (Tests/ApexKitTests/PracticeLoopTests):
// the content pool, the random picker, and the sample renderer. The app (PracticeLoop.swift beside ApexNavApp.swift) feeds
// the renderer to an AVAudioSourceNode, so every click and note is placed by counting samples on the audio thread: no timer,
// nothing that can drift or stall with the screen locked. Each event's first sample is computed from the block's start
// (`PracticeRenderer.eighthStart`), never by adding lengths up, so an hour of clicks lands where the first one said.
import Foundation

public enum PracticeKind: String, Codable, CaseIterable, Sendable { case mode, scale, arpeggio }

/// One thing to practise: its intervals in semitones above the root, ascending, without the octave.
public struct PracticeItem: Equatable, Sendable {
    public let id: String
    public let name: String          // as shown: "Dorian", "harmonic minor", "maj7 arpeggio"
    public let spoken: String        // as said: "Dorian", "major seven arpeggio"
    public let kind: PracticeKind
    public let intervals: [Int]
}

public enum PracticeTheory {
    public static let items: [PracticeItem] = [
        // modes of major
        .init(id: "ionian", name: "Ionian", spoken: "Ionian", kind: .mode, intervals: [0, 2, 4, 5, 7, 9, 11]),
        .init(id: "dorian", name: "Dorian", spoken: "Dorian", kind: .mode, intervals: [0, 2, 3, 5, 7, 9, 10]),
        .init(id: "phrygian", name: "Phrygian", spoken: "Phrygian", kind: .mode, intervals: [0, 1, 3, 5, 7, 8, 10]),
        .init(id: "lydian", name: "Lydian", spoken: "Lydian", kind: .mode, intervals: [0, 2, 4, 6, 7, 9, 11]),
        .init(id: "mixolydian", name: "Mixolydian", spoken: "Mixolydian", kind: .mode, intervals: [0, 2, 4, 5, 7, 9, 10]),
        .init(id: "aeolian", name: "Aeolian", spoken: "Aeolian", kind: .mode, intervals: [0, 2, 3, 5, 7, 8, 10]),
        .init(id: "locrian", name: "Locrian", spoken: "Locrian", kind: .mode, intervals: [0, 1, 3, 5, 6, 8, 10]),
        // scales
        .init(id: "natural_minor", name: "natural minor", spoken: "natural minor", kind: .scale, intervals: [0, 2, 3, 5, 7, 8, 10]),
        .init(id: "harmonic_minor", name: "harmonic minor", spoken: "harmonic minor", kind: .scale, intervals: [0, 2, 3, 5, 7, 8, 11]),
        // jazz melodic minor: the same notes down as up
        .init(id: "melodic_minor", name: "melodic minor", spoken: "melodic minor", kind: .scale, intervals: [0, 2, 3, 5, 7, 9, 11]),
        .init(id: "major_pentatonic", name: "major pentatonic", spoken: "major pentatonic", kind: .scale, intervals: [0, 2, 4, 7, 9]),
        .init(id: "minor_pentatonic", name: "minor pentatonic", spoken: "minor pentatonic", kind: .scale, intervals: [0, 3, 5, 7, 10]),
        .init(id: "blues", name: "blues", spoken: "blues scale", kind: .scale, intervals: [0, 3, 5, 6, 7, 10]),
        .init(id: "whole_tone", name: "whole tone", spoken: "whole tone", kind: .scale, intervals: [0, 2, 4, 6, 8, 10]),
        .init(id: "dim_wh", name: "diminished W-H", spoken: "diminished, whole half", kind: .scale, intervals: [0, 2, 3, 5, 6, 8, 9, 11]),
        .init(id: "dim_hw", name: "diminished H-W", spoken: "diminished, half whole", kind: .scale, intervals: [0, 1, 3, 4, 6, 7, 9, 10]),
        // arpeggios
        .init(id: "arp_maj", name: "major arpeggio", spoken: "major arpeggio", kind: .arpeggio, intervals: [0, 4, 7]),
        .init(id: "arp_min", name: "minor arpeggio", spoken: "minor arpeggio", kind: .arpeggio, intervals: [0, 3, 7]),
        .init(id: "arp_dom7", name: "7 arpeggio", spoken: "dominant seven arpeggio", kind: .arpeggio, intervals: [0, 4, 7, 10]),
        .init(id: "arp_maj7", name: "maj7 arpeggio", spoken: "major seven arpeggio", kind: .arpeggio, intervals: [0, 4, 7, 11]),
        .init(id: "arp_min7", name: "m7 arpeggio", spoken: "minor seven arpeggio", kind: .arpeggio, intervals: [0, 3, 7, 10]),
        .init(id: "arp_m7b5", name: "m7♭5 arpeggio", spoken: "minor seven flat five arpeggio", kind: .arpeggio, intervals: [0, 3, 6, 10]),
        .init(id: "arp_dim7", name: "dim7 arpeggio", spoken: "diminished seven arpeggio", kind: .arpeggio, intervals: [0, 3, 6, 9]),
        .init(id: "arp_aug", name: "aug arpeggio", spoken: "augmented arpeggio", kind: .arpeggio, intervals: [0, 4, 8]),
    ]

    /// Root names, pitch class 0 = C. Shown with ♭/♯, said with "flat"/"sharp".
    public static let rootNames = ["C", "D♭", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"]
    public static let rootSpoken = ["C", "D flat", "D", "E flat", "E", "F", "F sharp", "G", "A flat", "A", "B flat", "B"]

    /// Standard metronome markings. 60 to 120 (the default range) steps by 4 to 6; the rest lets the range be widened.
    public static let bpmPool = [40, 44, 48, 52, 56, 60, 66, 72, 76, 80, 84, 88, 92, 96, 100, 104, 108, 112, 116, 120,
                                 126, 132, 138, 144, 152, 160, 168, 176, 184, 192, 200, 208]

    /// One repetition as semitones above the root: up to the octave, then back down to the root.
    public static func rep(_ item: PracticeItem) -> [Int] {
        let up = item.intervals + [12]
        return up + up.dropLast().reversed()
    }

    /// Whole 4/4 bars (8 eighths each) a repetition takes; the eighths after its last note rest.
    public static func barsPerRep(_ item: PracticeItem) -> Int { (rep(item).count + 7) / 8 }

    public static func items(for focus: String) -> [PracticeItem] {
        switch focus {
        case "modes": return items.filter { $0.kind == .mode }
        case "scales": return items.filter { $0.kind != .arpeggio }
        case "arpeggios": return items.filter { $0.kind == .arpeggio }
        default: return items
        }
    }

    public static func title(root: Int, item: PracticeItem, bpm: Int) -> String { "\(rootNames[root]) \(item.name) · \(bpm)" }
    public static func callout(root: Int, item: PracticeItem, bpm: Int) -> String { "\(rootSpoken[root]) \(item.spoken), \(bpm) BPM" }
}

/// The owner's choices (Practice Loop's sheet). Anything out of range is pulled back in by `clamped`.
public struct PracticeSettings: Codable, Equatable, Sendable {
    public var lockRoot: Int? = nil          // nil: any of the 12
    public var focus: String = "all"         // all | modes | scales | arpeggios
    public var bpmMin: Int = 60
    public var bpmMax: Int = 120
    public var repsMin: Int = 5
    public var repsMax: Int = 10
    public var drone: Bool = true
    public var volume: Double = 0.8          // master, 0...1
    public var sleepMin: Int = 0             // 0: never stops by itself

    public init() {}

    public var clamped: PracticeSettings {
        var s = self
        if let r = s.lockRoot, !(0..<12).contains(r) { s.lockRoot = nil }
        if !["all", "modes", "scales", "arpeggios"].contains(s.focus) { s.focus = "all" }
        s.bpmMin = min(max(s.bpmMin, 30), 240); s.bpmMax = min(max(s.bpmMax, 30), 240)
        if s.bpmMin > s.bpmMax { swap(&s.bpmMin, &s.bpmMax) }
        s.repsMin = min(max(s.repsMin, 1), 50); s.repsMax = min(max(s.repsMax, 1), 50)
        if s.repsMin > s.repsMax { swap(&s.repsMin, &s.repsMax) }
        s.volume = min(max(s.volume.isFinite ? s.volume : 0.8, 0), 1)
        s.sleepMin = min(max(s.sleepMin, 0), 24 * 60)
        return s
    }

    /// The tempos the range allows: the standard markings inside it, or the nearest marking when none falls inside.
    public var bpms: [Int] {
        let s = clamped
        let inside = PracticeTheory.bpmPool.filter { $0 >= s.bpmMin && $0 <= s.bpmMax }
        if !inside.isEmpty { return inside }
        let mid = Double(s.bpmMin + s.bpmMax) / 2
        return [PracticeTheory.bpmPool.min { abs(Double($0) - mid) < abs(Double($1) - mid) }!]
    }
}

/// What one block plays.
public struct PracticePick: Equatable, Sendable {
    public let root: Int
    public let item: PracticeItem
    public let bpm: Int
    public let reps: Int
    public var title: String { PracticeTheory.title(root: root, item: item, bpm: bpm) }
    public var callout: String { PracticeTheory.callout(root: root, item: item, bpm: bpm) }
}

/// A seedable generator for the picker (SplitMix64), so tests replay the same blocks.
public struct PracticeRandom: RandomNumberGenerator, Sendable {
    private var state: UInt64
    public init(seed: UInt64) { state = seed }
    public mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}

public enum PracticePicker {
    /// The next block: never the same root and item twice in a row when the settings leave another choice.
    public static func next<G: RandomNumberGenerator>(_ settings: PracticeSettings, after last: PracticePick?, using rng: inout G) -> PracticePick {
        let s = settings.clamped
        let pool = PracticeTheory.items(for: s.focus)
        var pick: PracticePick
        var tries = 0
        repeat {
            let root = s.lockRoot ?? Int.random(in: 0..<12, using: &rng)
            let item = pool.randomElement(using: &rng)!
            let bpm = s.bpms.randomElement(using: &rng)!
            let reps = Int.random(in: s.repsMin...s.repsMax, using: &rng)
            pick = PracticePick(root: root, item: item, bpm: bpm, reps: reps)
            tries += 1
        } while tries < 8 && last.map { $0.root == pick.root && $0.item == pick.item } == true
        return pick
    }
}

/// A block ready for the audio thread: the pick and its callout as samples at the renderer's rate (empty: none was made).
public struct PracticeBlock: Sendable {
    public let id: Int
    public let pick: PracticePick
    public let callout: [Float]
    public init(id: Int, pick: PracticePick, callout: [Float]) { self.id = id; self.pick = pick; self.callout = callout }
}

/// Makes the sound, sample by sample, on the audio thread. A block is: the callout over the drone (at least `minLead` s,
/// and `calloutGap` s after the voice ends), one bar of count-in clicks at the block's tempo, then `reps` repetitions.
/// Everything after the lead sits on the 8th-note grid of `eighthStart`.
public final class PracticeRenderer: @unchecked Sendable {
    public let sampleRate: Double
    public static let minLead = 1.0
    public static let calloutGap = 0.4

    // read on the audio thread each buffer; written by the app
    public var volume: Float = 0.8
    public var droneOn = true

    private let lock = NSLock()
    private var pending: PracticeBlock?          // the next block, offered by the app (under lock)
    private var retired: [PracticeBlock] = []    // blocks finished on the audio thread, freed by the app (under lock)
    private var skipAsked = false                // under lock
    private var stopAtFrame: Int64 = .max        // under lock

    // audio-thread state
    private var block: PracticeBlock?
    private var reps = 0                         // the current block's reps (grows by one when no next block is ready yet)
    private var notes: [Int] = []
    private var repEighths = 8
    private var blockStart: Int64 = 0            // frame the block's lead began
    private var lead: Int64 = 0
    private var eighth: Double = 0               // frames per 8th note
    private var k = -1                           // the 8th-note index sounding now (-1: in the lead)
    private var kStart: Int64 = 0, kNext: Int64 = 0
    private var fade: Float = 1                  // the skip's fade-out
    private var fading = false
    private var stopped = false
    public private(set) var frame: Int64 = 0     // frames rendered since start
    /// Tests only: when set, the frame and accent of every click, and the frame each block began, are written here.
    public var clickLog: [(frame: Int64, accent: Bool)]? = nil
    public var blockLog: [(frame: Int64, id: Int)]? = nil
    private var shownId = -1                     // under lock: the block sounding now, for the app
    private var finishedFlag = false             // under lock

    public init(sampleRate: Double) { self.sampleRate = sampleRate }

    // MARK: the app's side

    /// True when no next block waits: the app should make one and `offer` it.
    public var needsBlock: Bool { lock.lock(); defer { lock.unlock() }; return pending == nil }
    /// Queues the next block (replacing a queued one). The first one offered starts at once.
    public func offer(_ b: PracticeBlock) { lock.lock(); pending = b; lock.unlock() }
    /// Drops the queued block, so the next one is made with new settings.
    public func clearPending() { lock.lock(); pending = nil; lock.unlock() }
    /// Moves on to the queued block now (with a short fade), or as soon as one is offered.
    public func skip() { lock.lock(); skipAsked = true; lock.unlock() }
    /// Fades out and goes silent `seconds` from now (the sleep timer); nil cancels it.
    public func stop(after seconds: Double?) {
        lock.lock()
        stopAtFrame = seconds.map { frame + Int64(($0 * sampleRate).rounded()) } ?? .max
        lock.unlock()
    }
    /// The block sounding now (its id), and whether the sleep timer has run out.
    public var status: (blockId: Int, finished: Bool) { lock.lock(); defer { lock.unlock() }; return (shownId, finishedFlag) }
    /// Blocks the audio thread is done with, handed back so their memory is freed off the audio thread.
    public func collect() { lock.lock(); let r = retired; retired = []; lock.unlock(); _ = r }

    // MARK: timing (pure)

    /// The first frame of 8th note `k` (0 = the count-in's first click) of a block whose lead is `lead` frames long.
    public static func eighthStart(_ k: Int, lead: Int64, framesPerEighth: Double) -> Int64 {
        lead + Int64((Double(k) * framesPerEighth).rounded())
    }
    public static func leadFrames(calloutCount: Int, sampleRate: Double) -> Int64 {
        Int64(max(minLead * sampleRate, Double(calloutCount) + calloutGap * sampleRate).rounded())
    }
    public static func framesPerEighth(bpm: Int, sampleRate: Double) -> Double { sampleRate * 30.0 / Double(bpm) }

    // MARK: the audio thread

    /// Fills `out` with `count` mono samples. Never blocks: the lock is only tried.
    public func render(_ out: UnsafeMutablePointer<Float>, count: Int) {
        if lock.try() {
            if frame >= stopAtFrame && !stopped { stopped = true; fading = true }
            if block == nil, let p = pending { pending = nil; begin(p) }
            if skipAsked && block != nil && pending != nil && !fading { fading = true }
            if stopped && fade <= 0 { finishedFlag = true }
            lock.unlock()
        }
        let vol = max(0, min(1, volume))
        let drone = droneOn
        let down = 1.0 / Float(0.03 * sampleRate), up = 1.0 / Float(0.01 * sampleRate)
        for i in 0..<count {
            var s: Float = 0
            if block != nil {
                if frame - blockStart >= blockLen && !nextBlock() { extend() }
                if fading {
                    fade = max(0, fade - down)
                    if fade == 0 && !stopped && nextBlock() { fading = false }   // the skip: the queued block, from silence
                } else if fade < 1 {
                    fade = min(1, fade + up)
                }
                if fade > 0, let b = block { s = sample(b, drone: drone) * fade }
            }
            out[i] = max(-1, min(1, s * vol))
            frame += 1
        }
    }

    private func sample(_ b: PracticeBlock, drone: Bool) -> Float {
        var s: Float = 0
        let f = frame - blockStart
        // the callout, at the start of the lead
        if f < Int64(b.callout.count) { s += b.callout[Int(f)] * 0.9 }
        // the drone: the root two octaves under the scale, with its octave, faded in and out over half a second
        if drone {
            let t = Double(f) / sampleRate
            let total = Double(blockLen) / sampleRate
            let env = Float(min(1, t / 0.5, max(0, total - t) / 0.5))
            let hz = Self.hz(midi: 36 + b.pick.root)
            let p = 2 * Double.pi * hz * t
            s += env * 0.075 * Float(sin(p) + 0.5 * sin(2 * p) + 0.18 * sin(3 * p))
        }
        guard f >= lead else { return s }
        // which 8th note is sounding (each start from the block's own grid, never summed)
        if k < 0 || f >= kNext {
            if k < 0 { k = 0 }
            while f >= Self.eighthStart(k + 1, lead: lead, framesPerEighth: eighth) { k += 1 }
            kStart = Self.eighthStart(k, lead: lead, framesPerEighth: eighth)
            kNext = Self.eighthStart(k + 1, lead: lead, framesPerEighth: eighth)
            if k % 2 == 0, clickLog != nil, f == kStart { clickLog?.append((frame, k % 8 == 0)) }
        }
        let dt = Double(f - kStart) / sampleRate
        // the click on every quarter, beat 1 accented
        if k % 2 == 0 && dt < 0.04 {
            let accent = k % 8 == 0
            let hz = accent ? 2000.0 : 1300.0
            let env = exp(-dt / 0.006) * min(1, dt / 0.0005)
            s += Float(env * (accent ? 0.55 : 0.36) * sin(2 * Double.pi * hz * dt))
        }
        // the note: a soft tone with two overtones and a short envelope, under the click
        let n = k - 8
        if n >= 0 {
            let j = n % repEighths
            if j < notes.count {
                let len = Double(kNext - kStart) / sampleRate * 0.9
                if dt < len {
                    let hz = Self.hz(midi: 60 + b.pick.root + notes[j])
                    let env = min(1, dt / 0.005) * (0.55 + 0.45 * exp(-dt / 0.08)) * min(1, (len - dt) / 0.02)
                    let p = 2 * Double.pi * hz * dt
                    s += Float(env * 0.16 * (sin(p) + 0.3 * sin(2 * p) + 0.12 * sin(3 * p)))
                }
            }
        }
        return s
    }

    private var blockLen: Int64 = 0

    private func setLength() { blockLen = lead + Int64((Double(8 + reps * repEighths) * eighth).rounded()) }

    private func begin(_ b: PracticeBlock) {
        block = b
        reps = max(1, b.pick.reps)
        notes = PracticeTheory.rep(b.pick.item)
        repEighths = PracticeTheory.barsPerRep(b.pick.item) * 8
        eighth = Self.framesPerEighth(bpm: b.pick.bpm, sampleRate: sampleRate)
        lead = Self.leadFrames(calloutCount: b.callout.count, sampleRate: sampleRate)
        blockStart = frame
        k = -1
        setLength()
        shownId = b.id
        blockLog?.append((frame, b.id))
        skipAsked = false                        // any move to a new block answers a skip
    }

    /// Starts the queued block now; false when none is ready (or the lock is busy this sample).
    private func nextBlock() -> Bool {
        guard lock.try() else { return false }
        defer { lock.unlock() }
        guard let p = pending else { return false }
        pending = nil
        if let old = block { retired.append(old) }
        begin(p)
        return true
    }

    /// No next block yet: one more repetition of this one, on the same grid.
    private func extend() { reps += 1; setLength() }

    public static func hz(midi: Int) -> Double { 440 * pow(2, Double(midi - 69) / 12) }
}
