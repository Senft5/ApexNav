import Foundation

/// Builds you follow (docs/design/REVIEW.md 5.3): which builds get a notification and what it says. The shell
/// (ApexBuildNotifier.swift) fetches /api/builds/following on a background refresh and posts what this returns. Pure, so
/// it is tested on Linux.
public enum BuildAlerts {
    public struct Alert: Equatable, Sendable {
        public let id: String
        public let newSteps: Int
        public let title: String
        public let body: String
    }

    /// The notification's words: "Nate's NB Miata" or "2004 Mazda Miata", and "@nate posted 2 new steps."
    public static func words(for build: [String: Any], newSteps: Int) -> (title: String, body: String) {
        let nick = (build["nickname"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        let year = (build["year"] as? Int).map(String.init)
        let name = nick ?? [year, build["make"] as? String, build["model"] as? String].compactMap { $0 }.joined(separator: " ")
        let handle = (build["handle"] as? String).map { "@\($0)" } ?? "Its owner"
        return (name.isEmpty ? "A build you follow" : name, "\(handle) posted \(newSteps) new step\(newSteps == 1 ? "" : "s").")
    }

    /// One alert per build whose count of new steps grew past what was already announced, and the counts to remember
    /// next time. Opening a build in the app resets its count to 0, so a later step is announced again; builds you no
    /// longer follow drop out.
    public static func due(_ list: [[String: Any]], announced: [String: Int]) -> (alerts: [Alert], announced: [String: Int]) {
        var alerts: [Alert] = []
        var still: [String: Int] = [:]
        for build in list {
            guard let id = build["id"] as? String else { continue }
            let newSteps = build["new_posts"] as? Int ?? 0
            if newSteps > (announced[id] ?? 0) {
                let w = words(for: build, newSteps: newSteps)
                alerts.append(Alert(id: id, newSteps: newSteps, title: w.title, body: w.body))
            }
            still[id] = newSteps
        }
        return (alerts, still)
    }
}
