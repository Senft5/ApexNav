import XCTest
@testable import ApexKit

final class BuildAlertsTests: XCTestCase {
    /// The list as the Worker sends it, parsed the way the shell parses it.
    private func following(_ json: String) -> [[String: Any]] {
        (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [[String: Any]] ?? []
    }

    func testNamesTheCarAndTheOwner() {
        let list = following(#"""
            [{"id":"b1","nickname":"Nate's NB","year":2004,"make":"Mazda","model":"Miata","handle":"nate","new_posts":2},
             {"id":"b2","nickname":"","year":2004,"make":"Mazda","model":"Miata","handle":"kit","new_posts":1},
             {"id":"b3","new_posts":1}]
            """#)
        let alerts = BuildAlerts.due(list, announced: [:]).alerts
        XCTAssertEqual(alerts.map(\.title), ["Nate's NB", "2004 Mazda Miata", "A build you follow"])
        XCTAssertEqual(alerts.map(\.body), ["@nate posted 2 new steps.", "@kit posted 1 new step.", "Its owner posted 1 new step."])
    }

    func testAnnouncesEachNewStepOnce() {
        var announced: [String: Int] = [:]
        var r = BuildAlerts.due(following(#"[{"id":"b1","new_posts":1}]"#), announced: announced)
        XCTAssertEqual(r.alerts.count, 1)
        announced = r.announced
        r = BuildAlerts.due(following(#"[{"id":"b1","new_posts":1}]"#), announced: announced)
        XCTAssertTrue(r.alerts.isEmpty, "the same step is not announced twice")
        r = BuildAlerts.due(following(#"[{"id":"b1","new_posts":3}]"#), announced: r.announced)
        XCTAssertEqual(r.alerts.map(\.newSteps), [3])
    }

    func testOpeningTheBuildResetsIt() {
        var r = BuildAlerts.due(following(#"[{"id":"b1","new_posts":0}]"#), announced: ["b1": 2])
        XCTAssertTrue(r.alerts.isEmpty)
        XCTAssertEqual(r.announced, ["b1": 0])
        r = BuildAlerts.due(following(#"[{"id":"b1","new_posts":1}]"#), announced: r.announced)
        XCTAssertEqual(r.alerts.count, 1, "a step after you looked is new again")
    }

    func testUnfollowedBuildsDropOutAndNothingNewIsQuiet() {
        let r = BuildAlerts.due(following(#"[{"id":"b2","new_posts":0}]"#), announced: ["b1": 4])
        XCTAssertTrue(r.alerts.isEmpty)
        XCTAssertEqual(r.announced, ["b2": 0])
    }
}
