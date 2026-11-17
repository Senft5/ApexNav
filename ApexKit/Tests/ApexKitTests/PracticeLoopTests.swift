import XCTest
@testable import ApexKit

final class PracticeLoopTests: XCTestCase {
    func testPoolHasEveryAskedItem() {
        let ids = Set(PracticeTheory.items.map(\.id))
        XCTAssertEqual(PracticeTheory.items.count, ids.count, "ids are unique")
        XCTAssertEqual(PracticeTheory.items(for: "modes").map(\.name), ["Ionian", "Dorian", "Phrygian", "Lydian", "Mixolydian", "Aeolian", "Locrian"])
        XCTAssertEqual(PracticeTheory.items(for: "arpeggios").count, 8)
        XCTAssertEqual(PracticeTheory.items(for: "scales").count, 16, "7 modes and 9 other scales")
        XCTAssertEqual(PracticeTheory.items.count, 24)
        for it in PracticeTheory.items {
            XCTAssertEqual(it.intervals.first, 0, it.id)
            XCTAssertEqual(it.intervals, it.intervals.sorted(), it.id)
            XCTAssertTrue(it.intervals.allSatisfy { (0..<12).contains($0) }, it.id)
        }
        // the modes are rotations of the major scale
        let major = [0, 2, 4, 5, 7, 9, 11]
        for (i, m) in PracticeTheory.items(for: "modes").enumerated() {
            let rot = (0..<7).map { (major[($0 + i) % 7] - major[i] + 12) % 12 }
            XCTAssertEqual(m.intervals, rot, m.name)
        }
    }

    func testRepGoesUpThenDownOnWholeBars() {
        let ionian = PracticeTheory.items.first { $0.id == "ionian" }!
        XCTAssertEqual(PracticeTheory.rep(ionian), [0, 2, 4, 5, 7, 9, 11, 12, 11, 9, 7, 5, 4, 2, 0])
        XCTAssertEqual(PracticeTheory.barsPerRep(ionian), 2)
        let maj = PracticeTheory.items.first { $0.id == "arp_maj" }!
        XCTAssertEqual(PracticeTheory.rep(maj), [0, 4, 7, 12, 7, 4, 0])
        XCTAssertEqual(PracticeTheory.barsPerRep(maj), 1)
        let dim = PracticeTheory.items.first { $0.id == "dim_wh" }!
        XCTAssertEqual(PracticeTheory.rep(dim).count, 17)
        XCTAssertEqual(PracticeTheory.barsPerRep(dim), 3)
    }

    func testDefaultTemposAreStandardMarkings() {
        let b = PracticeSettings().bpms
        XCTAssertEqual(b.first, 60); XCTAssertEqual(b.last, 120)
        for x in [60, 66, 72, 80, 88, 92, 96, 104, 112, 120] { XCTAssertTrue(b.contains(x), "\(x)") }
        for (a, c) in zip(b, b.dropFirst()) { XCTAssertTrue((4...8).contains(c - a), "\(a)->\(c)") }
        var s = PracticeSettings(); s.bpmMin = 61; s.bpmMax = 62
        XCTAssertEqual(s.bpms.count, 1, "a range with no marking in it still has a tempo")
        s.bpmMin = 150; s.bpmMax = 90
        XCTAssertEqual(s.clamped.bpmMin, 90, "a reversed range is turned round")
    }

    func testPickerFollowsTheSettings() {
        var rng = PracticeRandom(seed: 7)
        var s = PracticeSettings()
        s.lockRoot = 2; s.focus = "arpeggios"; s.bpmMin = 80; s.bpmMax = 100; s.repsMin = 6; s.repsMax = 7
        var last: PracticePick?
        for _ in 0..<300 {
            let p = PracticePicker.next(s, after: last, using: &rng)
            XCTAssertEqual(p.root, 2)
            XCTAssertEqual(p.item.kind, .arpeggio)
            XCTAssertTrue((80...100).contains(p.bpm))
            XCTAssertTrue((6...7).contains(p.reps))
            if let l = last { XCTAssertFalse(l.item == p.item, "not the same block twice in a row") }
            last = p
        }
        var all = Set<Int>(), reps = Set<Int>()
        for _ in 0..<500 { let p = PracticePicker.next(PracticeSettings(), after: nil, using: &rng); all.insert(p.root); reps.insert(p.reps) }
        XCTAssertEqual(all.count, 12, "every root comes up")
        XCTAssertEqual(reps, Set(5...10), "reps 5 to 10 by default")
    }

    func testCalloutWords() {
        let dorian = PracticeTheory.items.first { $0.id == "dorian" }!
        let p = PracticePick(root: 2, item: dorian, bpm: 92, reps: 5)
        XCTAssertEqual(p.callout, "D Dorian, 92 BPM")
        XCTAssertEqual(p.title, "D Dorian · 92")
        let p2 = PracticePick(root: 10, item: PracticeTheory.items.first { $0.id == "arp_m7b5" }!, bpm: 60, reps: 5)
        XCTAssertEqual(p2.callout, "B flat minor seven flat five arpeggio, 60 BPM")
    }

    /// Plays `seconds` of endless blocks (a new one offered whenever the renderer asks) in buffers of varying size.
    private func run(seconds: Double, rate: Double = 8000, seed: UInt64 = 1, callout: Int = 4000,
                     buffers: [Int] = [512, 1, 4096, 333, 1024], settings: PracticeSettings = PracticeSettings()) -> (PracticeRenderer, [Float], [PracticeBlock]) {
        let r = PracticeRenderer(sampleRate: rate)
        r.clickLog = []; r.blockLog = []
        var rng = PracticeRandom(seed: seed)
        var blocks: [PracticeBlock] = []
        var last: PracticePick?
        func feed() {
            guard r.needsBlock else { return }
            let p = PracticePicker.next(settings, after: last, using: &rng); last = p
            let b = PracticeBlock(id: blocks.count, pick: p, callout: [Float](repeating: 0.1, count: callout))
            blocks.append(b); r.offer(b)
        }
        let total = Int(seconds * rate)
        var out = [Float](repeating: 0, count: total)
        var at = 0, bi = 0
        feed()
        while at < total {
            let n = min(buffers[bi % buffers.count], total - at); bi += 1
            out.withUnsafeMutableBufferPointer { p in r.render(p.baseAddress! + at, count: n) }
            at += n
            feed()
        }
        return (r, out, blocks)
    }

    func testThirtyMinutesWithoutAGapOrDrift() {
        let rate = 8000.0
        let (r, out, blocks) = run(seconds: 1800, rate: rate)
        let starts = r.blockLog!
        XCTAssertGreaterThan(starts.count, 20)
        XCTAssertEqual(starts.first?.frame, 0)
        // every block starts on the frame the one before it ended: no gap between blocks
        for (a, b) in zip(starts, starts.dropFirst()) {
            let blk = blocks[a.id]
            let lead = PracticeRenderer.leadFrames(calloutCount: blk.callout.count, sampleRate: rate)
            let e = PracticeRenderer.framesPerEighth(bpm: blk.pick.bpm, sampleRate: rate)
            let len = PracticeRenderer.eighthStart(8 + blk.pick.reps * PracticeTheory.barsPerRep(blk.pick.item) * 8, lead: lead, framesPerEighth: e)
            XCTAssertEqual(b.frame - a.frame, len, "block \(a.id) ends where the next begins")
        }
        // every click is on its block's own grid: quarter m at lead + round(2m × eighth), beat 1 accented
        let clicks = r.clickLog!
        var ci = 0
        for (n, s) in starts.enumerated() {
            let end = n + 1 < starts.count ? starts[n + 1].frame : Int64(out.count)
            let blk = blocks[s.id]
            let lead = PracticeRenderer.leadFrames(calloutCount: blk.callout.count, sampleRate: rate)
            let e = PracticeRenderer.framesPerEighth(bpm: blk.pick.bpm, sampleRate: rate)
            var m = 0
            while ci < clicks.count && clicks[ci].frame < end {
                XCTAssertEqual(clicks[ci].frame, s.frame + PracticeRenderer.eighthStart(2 * m, lead: lead, framesPerEighth: e), "block \(s.id) click \(m)")
                XCTAssertEqual(clicks[ci].accent, m % 4 == 0)
                m += 1; ci += 1
            }
            if n + 1 < starts.count {
                XCTAssertEqual(m, 4 + blk.pick.reps * PracticeTheory.barsPerRep(blk.pick.item) * 4, "block \(s.id): count-in bar and every rep clicked")
            }
        }
        XCTAssertEqual(ci, clicks.count)
        XCTAssertTrue(out.allSatisfy { $0.isFinite && abs($0) <= 1 })
        XCTAssertGreaterThan(out.map { abs($0) }.max()!, 0.2, "it makes sound")
    }

    func testBufferSizeDoesNotChangeTheSound() {
        let a = run(seconds: 60, buffers: [4096]).1
        let b = run(seconds: 60, buffers: [1, 7, 333, 4096, 64]).1
        XCTAssertEqual(a, b)
    }

    func testNoNextBlockReadyKeepsTheClickGoing() {
        let rate = 8000.0
        let r = PracticeRenderer(sampleRate: rate)
        r.clickLog = []
        let dorian = PracticeTheory.items.first { $0.id == "dorian" }!
        r.offer(PracticeBlock(id: 0, pick: PracticePick(root: 2, item: dorian, bpm: 120, reps: 1), callout: []))
        var out = [Float](repeating: 0, count: Int(rate * 30))   // 1 s lead, 1 bar count-in, then 1-rep (2 bar) blocks: ~14 extra reps
        out.withUnsafeMutableBufferPointer { r.render($0.baseAddress!, count: $0.count) }
        let c = r.clickLog!.map(\.frame)
        XCTAssertGreaterThan(c.count, 50)
        for (a, b) in zip(c, c.dropFirst()) { XCTAssertEqual(b - a, 4000, accuracy: 1, "quarter notes at 120 BPM, no gap") }
        XCTAssertEqual(r.status.blockId, 0)
    }

    func testSkipAndSleep() {
        let rate = 8000.0
        let r = PracticeRenderer(sampleRate: rate)
        r.blockLog = []
        let maj = PracticeTheory.items.first { $0.id == "arp_maj" }!
        r.offer(PracticeBlock(id: 0, pick: PracticePick(root: 0, item: maj, bpm: 60, reps: 10), callout: []))
        var buf = [Float](repeating: 0, count: 8000)
        buf.withUnsafeMutableBufferPointer { r.render($0.baseAddress!, count: $0.count) }
        r.offer(PracticeBlock(id: 1, pick: PracticePick(root: 5, item: maj, bpm: 60, reps: 10), callout: []))
        r.skip()
        buf.withUnsafeMutableBufferPointer { r.render($0.baseAddress!, count: $0.count) }
        XCTAssertEqual(r.status.blockId, 1, "Next moves on within a second")
        XCTAssertLessThan(r.blockLog![1].frame - 8000, 400, "after a short fade")
        r.stop(after: 0.5)
        for _ in 0..<3 { buf.withUnsafeMutableBufferPointer { r.render($0.baseAddress!, count: $0.count) } }
        XCTAssertTrue(r.status.finished)
        XCTAssertTrue(buf.allSatisfy { $0 == 0 }, "silent after the sleep timer")
    }
}
