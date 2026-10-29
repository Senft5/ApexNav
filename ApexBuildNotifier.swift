// Builds you follow (docs/design/REVIEW.md 5.3): a notification per new step, without a push server. A background app
// refresh every few hours (iOS decides when) asks the Worker for /api/builds/following with the Keychain session and posts
// a local notification for each build whose count of new steps grew since the last one it announced. Permission is
// asked when you follow a build (the page sends "notifyBuilds"), never at launch. Nothing about you leaves the phone that
// the page wouldn't send anyway; the notification names the car and the owner's handle only.
import BackgroundTasks
import Foundation
import UserNotifications

enum ApexBuildNotifier {
    static let taskId = "com.senft.ApexNav.builds"                       // BGTaskSchedulerPermittedIdentifiers (project.yml)
    private static let announcedKey = "apex.buildsAnnounced"            // build id -> new-step count already announced
    private static let base = "https://apexnav.senftns.workers.dev"

    /// Before the app finishes launching (ApexNavApp.init).
    static func register() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: taskId, using: nil) { task in
            guard let refresh = task as? BGAppRefreshTask else { task.setTaskCompleted(success: false); return }
            schedule()                                                   // the next one
            let work = Task { await check(); refresh.setTaskCompleted(success: true) }
            refresh.expirationHandler = { work.cancel() }
        }
    }

    /// Asks iOS for a refresh in a few hours (it may run later, or not while the phone is low on battery).
    static func schedule() {
        let request = BGAppRefreshTaskRequest(identifier: taskId)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 3 * 3600)
        try? BGTaskScheduler.shared.submit(request)
    }

    /// The first follow: may Vetta notify? Then the refreshes start.
    static func requestPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, _ in
            if granted { schedule() }
        }
    }

    /// The notification's words for a build: "Nate's NB Miata" or "2004 Mazda Miata", and "@nate posted 2 new steps."
    static func words(for build: [String: Any], newSteps: Int) -> (title: String, body: String) {
        let nick = (build["nickname"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        let year = (build["year"] as? Int).map(String.init)
        let name = nick ?? [year, build["make"] as? String, build["model"] as? String].compactMap { $0 }.joined(separator: " ")
        let handle = (build["handle"] as? String).map { "@\($0)" } ?? "Its owner"
        return (name.isEmpty ? "A build you follow" : name, "\(handle) posted \(newSteps) new step\(newSteps == 1 ? "" : "s").")
    }

    static func check() async {
        guard let token = ApexKeychain.session(), let url = URL(string: base + "/api/builds/following") else { return }
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        guard settings.authorizationStatus == .authorized else { return }
        var request = URLRequest(url: url, timeoutInterval: 20)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
        request.setValue("1", forHTTPHeaderField: "x-apexnav")
        request.setValue("\(ApexWebBundle.scheme)://app", forHTTPHeaderField: "origin")
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let list = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] else { return }
        var announced = UserDefaults.standard.dictionary(forKey: announcedKey) as? [String: Int] ?? [:]
        var still: [String: Int] = [:]
        for build in list {
            guard let id = build["id"] as? String else { continue }
            let newSteps = build["new_posts"] as? Int ?? 0
            if newSteps > (announced[id] ?? 0) {
                let w = words(for: build, newSteps: newSteps)
                let content = UNMutableNotificationContent()
                content.title = w.title
                content.body = w.body
                content.sound = .default
                content.threadIdentifier = "build-\(id)"
                try? await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "build-\(id)-\(newSteps)", content: content, trigger: nil))
            }
            still[id] = newSteps                                         // opening the build in the app resets it to 0
        }
        announced = still
        UserDefaults.standard.set(announced, forKey: announcedKey)
    }
}
