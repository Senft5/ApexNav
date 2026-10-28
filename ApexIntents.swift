import AppIntents
import Foundation

/// Siri and Shortcuts (IDEAS V-07): "Start a drive in ApexNav", "Report a hazard in ApexNav", "End my drive in ApexNav".
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
}

struct StartDriveIntent: AppIntent {
    static let title: LocalizedStringResource = "Start a drive"
    static let description = IntentDescription("Opens ApexNav straight into a drive: pace notes on, recording.")
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

struct ApexShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: StartDriveIntent(), phrases: ["Start a drive in \(.applicationName)", "Start driving with \(.applicationName)"],
                    shortTitle: "Start a drive", systemImageName: "steeringwheel")
        AppShortcut(intent: ReportHazardIntent(), phrases: ["Report a hazard in \(.applicationName)", "Report a pothole in \(.applicationName)"],
                    shortTitle: "Report a hazard", systemImageName: "exclamationmark.triangle")
        AppShortcut(intent: EndDriveIntent(), phrases: ["End my drive in \(.applicationName)", "Stop the drive in \(.applicationName)"],
                    shortTitle: "End the drive", systemImageName: "flag.checkered")
    }
}
