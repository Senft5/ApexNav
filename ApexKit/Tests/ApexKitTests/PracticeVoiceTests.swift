import XCTest
@testable import ApexKit

/// Practice Loop's voice range: the pitch of made-up voices, the held notes of a sung test, and blocks that fit the range.
final class PracticeVoiceTests: XCTestCase {
    private let sr = 16000.0

    /// A voice-like tone: a fundamental with falling overtones (a sung vowel's second harmonic is often the loudest),
    /// a slow vibrato, and a little noise.
    private func voice(midi: Double, seconds: Double, vibrato: Double = 0.3, amp: Float = 0.3, seed: UInt64 = 1) -> [Float] {
        var rng = PracticeRandom(seed: seed)
        let n = Int(seconds * sr)
        var phase = 0.0
        return (0..<n).map { i in
            let t = Double(i) / sr
            let m = midi + vibrato * sin(2 * .pi * 5.5 * t)
            phase += 2 * .pi * 440 * pow(2, (m - 69) / 12) / sr
            let s = 0.6 * sin(phase) + 0.9 * sin(2 * phase) + 0.4 * sin(3 * phase) + 0.2 * sin(4 * phase)
            let noise = Double(Int64(bitPattern: rng.next() >> 1) % 2001 - 1000) / 1000 * 0.03
            return Float(s / 2.1 + noise) * amp
        }
    }

    func testPitchOfVoicesAcrossTheSungRange() {
        // E2 (a bass's low note) to C6 (a soprano's high C), never an octave off
        for m in [40, 45, 52, 57, 60, 64, 69, 76, 81, 84] {
            let x = voice(midi: Double(m), seconds: 0.12, vibrato: 0)
            let p = PracticePitch.detect(Array(x.prefix(Int(sr / 60) * 2 + 64)), sampleRate: sr)
            XCTAssertNotNil(p, "\(m)")
            XCTAssertEqual(PracticePitch.midi(hz: p!.hz), Double(m), accuracy: 0.15, "\(m)")
        }
        XCTAssertNil(PracticePitch.detect([Float](repeating: 0, count: 600), sampleRate: sr), "silence")
        var rng = PracticeRandom(seed: 9)
        let noise = (0..<600).map { _ in Float(Int64(bitPattern: rng.next() >> 1) % 2001 - 1000) / 1000 * 0.3 }
        XCTAssertNil(PracticePitch.detect(noise, sampleRate: sr), "breath noise has no pitch")
    }

    func testNoteNames() {
        XCTAssertEqual(PracticePitch.name(midi: 60), "C4")
        XCTAssertEqual(PracticePitch.name(midi: 40), "E2")
        XCTAssertEqual(PracticePitch.name(midi: 66), "F♯4")
        XCTAssertEqual(PracticePitch.name(midi: 59), "B3")
    }

    func testTheTestKeepsHeldNotesNotSlides() {
        let t = PracticeRangeTracker(sampleRate: sr)
        // a quick slide up through A2...E3 (each 0.1 s, too short to count), then G2 held, then silence
        var x: [Float] = []
        for m in 45...52 { x += voice(midi: Double(m), seconds: 0.1, seed: UInt64(m)) }
        x += voice(midi: 43, seconds: 0.8)
        x += [Float](repeating: 0, count: Int(sr * 0.3))
        // feed it in the microphone's chunks
        var i = 0
        while i < x.count { t.feed(Array(x[i..<min(x.count, i + 1024)])); i += 1024 }
        XCTAssertEqual(t.lowest, 43, "G2 held")
        XCTAssertEqual(t.highest, 43, "the slide doesn't count")
        XCTAssertNil(t.now, "silence at the end")
        // then the high step: C5 held, a short squeak at E5 doesn't count
        t.reset()
        t.feed(voice(midi: 72, seconds: 0.7))
        t.feed(voice(midi: 76, seconds: 0.15))
        XCTAssertEqual(t.highest, 72)
        XCTAssertEqual(t.now, 76)
    }

    func testBlocksFitTheSungRange() {
        var rng = PracticeRandom(seed: 3)
        let range = 43...67                                         // G2 to G4: a baritone
        var s = PracticeSettings()
        var last: PracticePick?
        var roots = Set<Int>()
        for _ in 0..<300 {
            let p = PracticePicker.next(s, after: last, range: range, using: &rng)
            last = p
            roots.insert(p.root)
            XCTAssertEqual(((p.base % 12) + 12) % 12, p.root)
            for n in PracticeTheory.rep(p.item) { XCTAssertTrue(range.contains(p.base + n), "\(p.title) at \(p.base)") }
            XCTAssertGreaterThanOrEqual(p.droneMidi, 28)
        }
        XCTAssertEqual(roots.count, 12, "every key still comes up")
        // a locked key goes where it fits
        s.lockRoot = 2
        for _ in 0..<40 {
            let p = PracticePicker.next(s, after: nil, range: range, using: &rng)
            XCTAssertEqual(p.base, 50, "D3 is the only D whose octave fits G2...G4")
        }
        // with no range, middle C's octave as before
        XCTAssertEqual(PracticePicker.next(PracticeSettings(), after: nil, using: &rng).base / 12, 5)
        // under an octave isn't usable; the locked key that can't fit sticks out least
        XCTAssertFalse(PracticeRange.usable(48, 59))
        XCTAssertTrue(PracticeRange.usable(48, 60))
        XCTAssertEqual(PracticeRange.bases(48...62, root: 5), [53], "F3 to F4 sticks out 3 over D4; F2 would be 7 under")
    }
}
