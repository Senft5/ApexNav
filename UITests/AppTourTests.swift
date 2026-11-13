import XCTest

/// A slow walk through the real app for the recorded review tour (.github/workflows/app-tour.yml records the simulator's
/// screen while this runs and simctl plays a GPS drive). Skipped in normal test runs: it only runs with APEX_TOUR=1.
final class AppTourTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = true
        addUIInterruptionMonitor(withDescription: "Permissions") { alert in
            for label in ["Allow While Using App", "Allow Once", "Allow", "OK", "Continue"] where alert.buttons[label].exists {
                alert.buttons[label].tap()
                return true
            }
            return false
        }
    }

    private func pause(_ s: Double) { RunLoop.current.run(until: Date().addingTimeInterval(s)) }

    private func scroll(_ app: XCUIApplication, times: Int) {
        for _ in 0..<times { app.swipeUp(velocity: .slow); pause(1.2) }
        for _ in 0..<times { app.swipeDown(velocity: .fast) }
        pause(1)
    }

    /// Launches the app and walks the first-run onboarding if it shows.
    private func launch(_ app: XCUIApplication = XCUIApplication()) -> (XCUIApplication, XCUIElement) {
        app.launch()
        app.tap()
        let web = app.webViews.firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: 45))
        pause(4)
        for _ in 0..<5 {
            // the welcome's one key is "Start" (it runs in the app since U-65); Next/Get started were the old three screens
            let next = web.buttons["Next"], start = web.buttons["Get started"], welcome = web.buttons["Start"]
            if welcome.exists { pause(2); welcome.tap(); break }
            if start.exists { pause(2); start.tap(); break }
            if next.exists { pause(2.5); next.tap() } else { break }
        }
        // the location sheet follows the welcome's Start (U-65)
        let sheet = XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.firstMatch
        if sheet.waitForExistence(timeout: 6) {
            for label in ["Allow While Using App", "Allow Once", "Allow"] where sheet.buttons[label].exists { sheet.buttons[label].tap(); break }
        }
        pause(3)
        return (app, web)
    }

    private func shot(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = name; a.lifetime = .keepAlways; add(a)
    }

    /// A tab by its label: buttons on the map page, links on the Log and Stages page. On the Log the map page's own tab bar
    /// is still in the tree under it ("People" not hittable, hit point -1,-1: the audit run of 2026-11-13), so this is the
    /// first match that can be tapped, waited for up to `wait` seconds; a match that never can be is returned as is.
    private func tab(_ web: XCUIElement, _ name: String, wait: Double = 10) -> XCUIElement {
        let all = web.descendants(matching: .any).matching(NSPredicate(format: "label == %@ AND (elementType == %d OR elementType == %d)",
            name, XCUIElement.ElementType.button.rawValue, XCUIElement.ElementType.link.rawValue))
        let end = Date().addingTimeInterval(wait)
        repeat {
            for i in 0..<min(all.count, 8) {
                let e = all.element(boundBy: i)
                if e.exists && e.isHittable { return e }
            }
            pause(0.5)
        } while Date() < end
        return all.firstMatch
    }

    /// Every text field on every tab with the real keyboard up (review 2026-10-28): a screenshot of each, the field fully on
    /// screen above the keyboard, and no tab bar while typing. The workflow turns the simulator's hardware keyboard off so the
    /// on-screen one shows.
    func testKeyboard() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["APEX_TOUR"] == "1", "recorded tour only")
        let (app, web) = launch()
        let types = [XCUIElement.ElementType.textField, .searchField, .textView, .secureTextField].map { NSNumber(value: $0.rawValue) }
        for name in ["Map", "Log", "People", "Garage"] {
            let b = tab(web, name)
            guard b.waitForExistence(timeout: 10) else { XCTFail("no \(name) tab"); continue }
            b.tap(); pause(2.5)
            let fields = web.descendants(matching: .any).matching(NSPredicate(format: "elementType IN %@", types))
            var done = Set<String>()
            // twice: a field can appear once another opens its sheet (Where to? opens the plan with From)
            for i in Array(0..<min(fields.count, 16)) + Array(0..<min(fields.count, 16)) {
                let f = fields.element(boundBy: i)
                guard f.exists, !f.frame.isEmpty else { continue }   // a field in a hidden view has no frame
                // only fields on this page: one below the fold is scrolled to; one in a hidden sheet never comes on screen
                // (asking it isHittable then fails the test instead of answering no)
                let onScreen = { f.frame.width > 4 && f.frame.height > 4 && app.frame.contains(CGPoint(x: f.frame.midX, y: f.frame.midY)) }
                var tries = 0
                while !onScreen() && f.frame.minY > app.frame.maxY && tries < 6 { web.swipeUp(velocity: .slow); pause(0.6); tries += 1 }
                guard onScreen(), f.isHittable else { continue }
                let label = [f.label, f.placeholderValue ?? ""].first { !$0.isEmpty } ?? "field \(i)"
                guard !done.contains(label) else { continue }
                done.insert(label)
                f.tap(); pause(1.5)
                let kb = app.keyboards.firstMatch
                if kb.exists {
                    let screen = app.frame
                    XCTAssertGreaterThanOrEqual(f.frame.minY, screen.minY - 1, "\(name) · \(label): the field went off the top")
                    XCTAssertLessThanOrEqual(f.frame.maxY, kb.frame.minY + 1, "\(name) · \(label): the field is under the keyboard")
                    let bar = tab(web, name)
                    XCTAssertFalse(bar.exists && bar.isHittable && bar.frame.maxY <= kb.frame.minY, "\(name) · \(label): the tab bar shows while typing")
                } else {
                    XCTFail("\(name) · \(label): no keyboard")
                }
                shot(app, "\(name) · \(label)")
            }
            // put the keyboard away without submitting: Cancel on the plan sheet, else a tap on the page's title
            if app.keyboards.firstMatch.exists {
                let cancel = web.buttons["Cancel"]
                if cancel.exists && cancel.isHittable { cancel.tap() }
                else if web.staticTexts[name].firstMatch.exists && web.staticTexts[name].firstMatch.isHittable { web.staticTexts[name].firstMatch.tap() }
                else { app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.08)).tap() }
                pause(1)
                XCTAssertFalse(app.keyboards.firstMatch.exists, "\(name): the keyboard wouldn't go away")
            }
            for _ in 0..<6 { web.swipeDown(velocity: .fast) }
        }
    }

    func testTour() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["APEX_TOUR"] == "1", "recorded tour only")
        let (app, web) = launch()
        for name in ["Log", "People", "Garage"] {
            let b = tab(web, name)
            if b.waitForExistence(timeout: 10) { b.tap(); pause(2.5); scroll(app, times: 5) }
        }
        let map = tab(web, "Map")
        if map.waitForExistence(timeout: 10) { map.tap(); pause(2) }
        // plan a route by search (the simulator's location is the start)
        let search = web.searchFields.firstMatch
        if search.waitForExistence(timeout: 10) {
            search.tap(); pause(1.5)
            search.typeText("Robbinsville"); pause(6)
            let place = web.staticTexts["Robbinsville"].firstMatch
            if place.exists { place.tap(); pause(25) }
            let drive = web.buttons["Start"], start = web.buttons["Start drive"]   // the plan flow: the card's key is Start
            if drive.exists { drive.tap() } else if start.exists { start.tap() }
            pause(3)
            if web.buttons["Allow and start"].exists { web.buttons["Allow and start"].tap(); app.tap() }
            pause(90)   // simctl drives the route meanwhile: directions, notes, the Live Activity
            if web.buttons["End drive"].exists { web.buttons["End drive"].tap(); pause(8) }   // I-3: End is undoable for 5 s
        }
        shot(app, "end of tour")
    }

    /// Apple's own accessibility audit (Xcode 15, iOS 17: the checks Accessibility Inspector runs) on every tab, at the
    /// default text size and at the largest accessibility size (LAUNCH.md section 3, IDEAS U-15). Each issue is one line
    /// in the log ("A11Y-AUDIT tab · size · type · element: what") and in the `accessibility-audit` attachment, so a run of
    /// the app tour workflow lists them all; the test fails while any is open. The cockpit's own sizes are the theme
    /// contract's (REVIEW5 7.7), so text that doesn't grow on the map tab is listed, not hidden.
    private func auditName(_ t: XCUIAccessibilityAuditType) -> String {
        let names: [(XCUIAccessibilityAuditType, String)] = [(.contrast, "contrast"), (.elementDetection, "element detection"),
            (.hitRegion, "hit region"), (.sufficientElementDescription, "description"), (.dynamicType, "dynamic type"),
            (.textClipped, "text clipped"), (.trait, "trait")]
        return names.filter { t.contains($0.0) }.map(\.1).joined(separator: "+").ifEmpty("type \(t.rawValue)")
    }

    func testAccessibilityAudit() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["APEX_TOUR"] == "1", "recorded tour only")
        var lines: [String] = []
        for (size, args) in [("default", [String]()), ("AX-XXXL", ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])] {
            let app = XCUIApplication()
            app.launchArguments = args
            let web = launch(app).1
            for name in ["Map", "Log", "People", "Garage"] {
                let b = tab(web, name)
                guard b.exists && b.isHittable else { lines.append("\(name) · \(size) · no tab to tap"); print("A11Y-AUDIT \(lines.last!)"); continue }
                b.tap(); pause(3)
                shot(app, "audit \(name) \(size)")
                do {
                    try app.performAccessibilityAudit(for: .all) { issue in
                        let el = issue.element.map { e in [e.label, e.identifier, "\(e.elementType.rawValue)"].first { !$0.isEmpty } ?? "?" } ?? "-"
                        lines.append("\(name) · \(size) · \(self.auditName(issue.auditType)) · \(el): \(issue.compactDescription)")
                        print("A11Y-AUDIT \(lines.last!)")
                        return true   // recorded here, failed once below with the whole list
                    }
                } catch {
                    lines.append("\(name) · \(size) · audit error: \(error)")
                }
            }
            app.terminate()
        }
        let a = XCTAttachment(string: lines.joined(separator: "\n")); a.name = "accessibility-audit"; a.lifetime = .keepAlways; add(a)
        XCTAssertTrue(lines.isEmpty, "\(lines.count) accessibility issues (A11Y-AUDIT lines in the log)")
    }
}

private extension String { func ifEmpty(_ other: String) -> String { isEmpty ? other : self } }
