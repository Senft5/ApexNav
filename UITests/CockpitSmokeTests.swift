import XCTest

/// Launches the real app on a simulator and proves the shared web cockpit loads inside the
/// native shell (bundle resources, WKWebView, JS boot), then attaches a screenshot.
final class CockpitSmokeTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
        addUIInterruptionMonitor(withDescription: "Location / motion permission") { alert in
            for label in ["Allow While Using App", "Allow Once", "OK", "Allow"] where alert.buttons[label].exists {
                alert.buttons[label].tap()
                return true
            }
            return false
        }
    }

    func testCockpitLoadsInsideTheApp() {
        let app = XCUIApplication()
        app.launch()
        app.tap()   // lets the interruption monitor handle the permission alert

        let web = app.webViews.firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: 30), "WKWebView never appeared")
        // The idle cockpit is the map, the red Start drive button and the five tabs (web/index.html).
        // (Text inside the MapLibre region is not exposed to accessibility, so assert on these.)
        XCTAssertTrue(web.buttons["Start drive"].waitForExistence(timeout: 45), "cockpit JS did not boot")
        for tab in ["Map", "Plan", "Log", "Stages", "Crew"] {
            XCTAssertTrue(web.buttons[tab].exists, "tab \(tab) missing")
        }

        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "cockpit"
        shot.lifetime = .keepAlways
        add(shot)
    }
}
