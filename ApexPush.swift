// Push notifications (backend/src/push.ts, docs/SOCIAL.md 2.12): a friend request, a new friend, kudos, a comment on your
// drive, a duel, a crew drive, told to the phone the moment it happens.
// Permission is asked only when the driver turns "Friends' activity" on (Garage > Notifications, the page sends
// {cmd:"push", op:"allow"}), never at launch. The device token goes to the page ({type:"pushToken"}), which hands it to the
// Worker with its own session, so sign-in stays in one place. A tap opens the screen the push is about: its `url` is an
// apexnav://open link, opened as any other (ApexSensorShell.openLink). In the foreground the page is already open, so a
// push goes to the list only, with no banner or sound; nothing is pushed during a drive at all (the page sets quiet).
import SwiftUI
import UserNotifications

final class ApexAppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        Task { @MainActor in await ApexPush.refresh() }
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task { @MainActor in ApexPush.got(hex) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NSLog("APEX-PUSH no device token: \(error.localizedDescription)")
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.list]
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard let s = response.notification.request.content.userInfo["url"] as? String else { return }
        await MainActor.run { if let url = URL(string: s) { ApexEngine.shared.shell.openLink(url) } }
    }
}

@MainActor
enum ApexPush {
    /// This phone's APNs token, once iOS has given it (each launch, while notifications are allowed).
    private static var token: String?
    /// A build run from Xcode gets sandbox tokens; TestFlight and the App Store get production ones.
    #if DEBUG
    static let sandbox = true
    #else
    static let sandbox = false
    #endif

    /// At launch: when notifications are already allowed, ask iOS for the token again (it can change).
    static func refresh() async {
        let status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
        if status == .authorized { UIApplication.shared.registerForRemoteNotifications() }
    }

    static func handle(_ dict: [String: Any], shell: ApexSensorShell?) {
        switch dict["op"] as? String {
        case "allow":
            Task { @MainActor [weak shell] in
                let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])) ?? false
                if granted { UIApplication.shared.registerForRemoteNotifications() }
                shell?.sendToPage(["type": "push", "granted": granted])
            }
        case "token":                                                   // the page loaded signed in, with the switch on
            if token != nil { send(shell) } else { Task { await refresh() } }
        default:
            break
        }
    }

    static func got(_ hex: String) {
        token = hex
        send(ApexEngine.shared.shell)
    }

    private static func send(_ shell: ApexSensorShell?) {
        guard let token else { return }
        shell?.sendToPage(["type": "pushToken", "token": token, "sandbox": sandbox])
    }
}
