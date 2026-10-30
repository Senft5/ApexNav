import XCTest
@testable import ApexKit

/// Round 3 (the owner's drive to work, 2026-10-30): the fixes the page has not kept survive the page and the app.
final class DriveJournalTests: XCTestCase {
    private var dir: URL!

    override func setUp() {
        super.setUp()
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("journal-\(UUID().uuidString)")
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: dir)
        super.tearDown()
    }

    private func fix(_ seq: Int, lat: Double, peak: Double? = nil) -> JournalFrame {
        JournalFrame(seq: seq, at: 1_000_000 + Double(seq) * 100, lat: lat, lon: -83.9, accuracyM: 5, speedMps: 15, vertPeakG: peak, calibration: "locked")
    }

    func testOneEntryPerPositionWithTheSpikesBetween() throws {
        let j = try XCTUnwrap(DriveJournal(id: "drive_abc", directory: dir))
        j.add(fix(1, lat: 35.5))
        j.add(fix(2, lat: 35.5, peak: 0.4))      // same position: only its spike is kept
        j.add(fix(3, lat: 35.5, peak: 0.2))
        j.add(fix(4, lat: 35.5001, peak: 0.1))
        XCTAssertEqual(j.frames.map(\.seq), [1, 4])
        XCTAssertEqual(j.frames[1].vertPeakG, 0.4, "the largest spike since the last position, as measured")
        j.add(fix(5, lat: 35.5002))
        XCTAssertNil(j.frames[2].vertPeakG, "no spike carried twice")
    }

    func testDurableFramesLeaveAndTheRestSurviveTheApp() throws {
        let j = try XCTUnwrap(DriveJournal(id: "drive_abc", directory: dir))
        for i in 1...10 { j.add(fix(i, lat: 35.5 + Double(i) * 1e-4)) }
        j.durable(through: 6)
        XCTAssertEqual(j.after(-1).map(\.seq), [7, 8, 9, 10])
        j.add(fix(11, lat: 35.6))
        // the app ends here; the next launch reads the file back
        let back = try XCTUnwrap(DriveJournal.load(try XCTUnwrap(j.url)))
        XCTAssertEqual(back.id, "drive_abc")
        XCTAssertEqual(back.durableSeq, 6)
        XCTAssertEqual(back.frames.map(\.seq), [7, 8, 9, 10, 11])
        XCTAssertEqual(back.frames.last, j.frames.last)
        XCTAssertEqual(DriveJournal.all(in: dir).map(\.id), ["drive_abc"])
        back.remove()
        XCTAssertTrue(DriveJournal.all(in: dir).isEmpty)
    }

    func testTheFramesReadAsThePageFields() throws {
        let json = DriveJournal.json([fix(3, lat: 35.5, peak: 0.25)])
        let obj = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [[String: Any]])
        XCTAssertEqual(obj.count, 1)
        XCTAssertEqual(obj[0]["has_fix"] as? Bool, true)
        XCTAssertEqual(obj[0]["vert_peak_g"] as? Double, 0.25)
        XCTAssertEqual(obj[0]["speed_mps"] as? Double, 15)
        XCTAssertEqual(obj[0]["calibration"] as? String, "locked")
        XCTAssertNil(obj[0]["camber_deg"], "unknown stays unknown: no key, never a zero")
    }

    func testATornLastLineIsDroppedAndBadIdsRefused() throws {
        let j = try XCTUnwrap(DriveJournal(id: "drive_x", directory: dir))
        j.add(fix(1, lat: 35.5)); j.add(fix(2, lat: 35.51))
        let url = try XCTUnwrap(j.url)
        let h = try FileHandle(forWritingTo: url)
        _ = try h.seekToEnd()
        try h.write(contentsOf: Data("{\"seq\":3,\"at\":1,\"la".utf8))
        try h.close()
        XCTAssertEqual(DriveJournal.load(url)?.frames.map(\.seq), [1, 2])
        XCTAssertNil(DriveJournal(id: "../escape", directory: dir))
        XCTAssertNil(DriveJournal(id: "", directory: dir))
    }
}
