import AppIntents
import Foundation

/// Siri and Shortcuts (IDEAS V-07): "Start a drive in Vetta", "Drive somewhere with Vetta" (Siri asks where), "Find a
/// 1 hour loop in Vetta", "Report a hazard in Vetta", "End my drive in Vetta",
/// "How far to the next stage in Vetta", "Skip this stage in Vetta",
/// "Where's the next gas station in Vetta", "Where's the next café in Vetta".
/// Each opens the app and hands it the same apexnav://open?go=… link a widget or a Shortcuts automation would, so the
/// page decides what happens (a report or an end only during a drive). Hands-free in the car: Siri, or "Hey Siri" on CarPlay.
enum ApexIntentInbox {
    static let notification = Notification.Name("ApexIntentLink")
    /// A link from an intent that ran before the app's view was listening (a cold start); the view takes it on appear.
    @MainActor static var pending: URL?
    @MainActor static func deliver(_ go: String) {
        guard let url = URL(string: "apexnav://open?go=\(go)") else { return }
        pending = url
        NotificationCenter.default.post(name: notification, object: url)
    }
    @MainActor static func take() -> URL? { defer { pending = nil }; return pending }
    /// Free words (a place said to Siri) in a link: base64url, so they pass the app's link filter (letters, digits, - and _).
    /// At most 140 bytes of UTF-8, cut at a character.
    static func linkWords(_ s: String) -> String {
        var out = ""
        for ch in s.trimmingCharacters(in: .whitespacesAndNewlines) {
            if (out + String(ch)).utf8.count > 140 { break }
            out.append(ch)
        }
        return Data(out.utf8).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}

/// "Drive somewhere with Vetta": Siri asks "Where to?" and the place said is typed into Where to? and Go is pressed: your
/// pinned places, saved routes and recents by that name first, then the map's search near you. The route's preview is on
/// the phone and, in the car, on CarPlay, with Go. Siri does the listening: the app needs no microphone.
struct DriveToIntent: AppIntent {
    static let title: LocalizedStringResource = "Drive to a place"
    static let description = IntentDescription("Plans a route to the place you name: your own places by that name first, then the map's search near you.")
    static let openAppWhenRun = true
    @Parameter(title: "Place", requestValueDialog: IntentDialog("Where to?")) var place: String
    @MainActor func perform() async throws -> some IntentResult {
        let words = ApexIntentInbox.linkWords(place)
        if !words.isEmpty { ApexIntentInbox.deliver("to&q=\(words)") }
        return .result()
    }
}

/// The loop dial's five times (web/cockpit.js LOOP_MINUTES), for "Find a 1 hour loop in Vetta".
enum LoopLength: String, AppEnum {
    case m30 = "30", m60 = "60", m90 = "90", m120 = "120", m180 = "180"
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Loop length"
    static let caseDisplayRepresentations: [LoopLength: DisplayRepresentation] = [
        .m30: "30 minute", .m60: "1 hour", .m90: "90 minute", .m120: "2 hour", .m180: "3 hour",
    ]
}

/// "Find a loop in Vetta" (an hour, unless you say "Find a 2 hour loop in Vetta"): a twisty loop from here, as the loop dial
/// or the car's Loops list builds it.
struct FindLoopIntent: AppIntent {
    static let title: LocalizedStringResource = "Find a loop"
    static let description = IntentDescription("Builds a twisty loop from where you are that brings you back in about the time you pick.")
    static let openAppWhenRun = true
    @Parameter(title: "Length", default: .m60) var length: LoopLength
    @MainActor func perform() async throws -> some IntentResult { ApexIntentInbox.deliver("loop\(length.rawValue)"); return .result() }
}

struct StartDriveIntent: AppIntent {
    static let title: LocalizedStringResource = "Start a drive"
    static let description = IntentDescription("Opens Vetta straight into a drive: pace notes on, recording.")
    static let openAppWhenRun = true
    @MainActor func perform() async throws -> some IntentResult { ApexIntentInbox.deliver("drive"); return .result() }
}

struct ReportHazardIntent: AppIntent {
    static let title: LocalizedStringResource = "Report a hazard"
    static let description = IntentDescription("During a drive, opens the hazard report so you can pick what's on the road.")
    static let openAppWhenRun = true
    @MainActor func perform() async throws -> some IntentResult { ApexIntentInbox.deliver("report"); return .result() }
}

struct EndDriveIntent: AppIntent {
    static let title: LocalizedStringResource = "End the drive"
    static let description = IntentDescription("Ends the drive and saves it to your Log.")
    static let openAppWhenRun = true
    @MainActor func perform() async throws -> some IntentResult { ApexIntentInbox.deliver("end"); return .result() }
}

struct NextStageIntent: AppIntent {
    static let title: LocalizedStringResource = "How far to the next stage"
    static let description = IntentDescription("Says how far it is to the next fun stretch on your route, or how much of this one is left.")
    static let openAppWhenRun = true
    @MainActor func perform() async throws -> some IntentResult { ApexIntentInbox.deliver("nextstage"); return .result() }
}

struct SkipStageIntent: AppIntent {
    static let title: LocalizedStringResource = "Skip this stage"
    static let description = IntentDescription("During a drive on a fun route, drops the stage you're on or the next one and reroutes.")
    static let openAppWhenRun = true
    @MainActor func perform() async throws -> some IntentResult { ApexIntentInbox.deliver("skipstage"); return .result() }
}

struct NextFuelIntent: AppIntent {
    static let title: LocalizedStringResource = "Next gas station"
    static let description = IntentDescription("Says the next gas station along your route, by its name on the map, and how far it is.")
    static let openAppWhenRun = true
    @MainActor func perform() async throws -> some IntentResult { ApexIntentInbox.deliver("nextfuel"); return .result() }
}

struct NextCafeIntent: AppIntent {
    static let title: LocalizedStringResource = "Next café"
    static let description = IntentDescription("Says the next café along your route, by its name on the map, and how far it is.")
    static let openAppWhenRun = true
    @MainActor func perform() async throws -> some IntentResult { ApexIntentInbox.deliver("nextcafe"); return .result() }
}

struct ApexShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: StartDriveIntent(), phrases: ["Start a drive in \(.applicationName)", "Start driving with \(.applicationName)"],
                    shortTitle: "Start a drive", systemImageName: "steeringwheel")
        AppShortcut(intent: DriveToIntent(), phrases: ["Drive somewhere with \(.applicationName)", "Navigate with \(.applicationName)",
                                                      "Take me somewhere in \(.applicationName)"],
                    shortTitle: "Drive to a place", systemImageName: "arrow.triangle.turn.up.right.diamond")
        AppShortcut(intent: FindLoopIntent(), phrases: ["Find a loop in \(.applicationName)", "Find a \(\.$length) loop in \(.applicationName)"],
                    shortTitle: "Find a loop", systemImageName: "arrow.triangle.2.circlepath")
        AppShortcut(intent: ReportHazardIntent(), phrases: ["Report a hazard in \(.applicationName)", "Report a pothole in \(.applicationName)"],
                    shortTitle: "Report a hazard", systemImageName: "exclamationmark.triangle")
        AppShortcut(intent: EndDriveIntent(), phrases: ["End my drive in \(.applicationName)", "Stop the drive in \(.applicationName)"],
                    shortTitle: "End the drive", systemImageName: "flag.checkered")
        AppShortcut(intent: NextStageIntent(), phrases: ["How far to the next stage in \(.applicationName)", "Next stage in \(.applicationName)"],
                    shortTitle: "Next stage", systemImageName: "road.lanes.curved.right")
        AppShortcut(intent: SkipStageIntent(), phrases: ["Skip this stage in \(.applicationName)", "Skip the stage in \(.applicationName)"],
                    shortTitle: "Skip this stage", systemImageName: "forward.end")
        AppShortcut(intent: NextFuelIntent(), phrases: ["Where's the next gas station in \(.applicationName)", "Next fuel in \(.applicationName)"],
                    shortTitle: "Next gas station", systemImageName: "fuelpump")
        AppShortcut(intent: NextCafeIntent(), phrases: ["Where's the next café in \(.applicationName)", "Next coffee in \(.applicationName)"],
                    shortTitle: "Next café", systemImageName: "cup.and.saucer")
    }
}
