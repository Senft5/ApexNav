import Foundation
import MetricKit

// Native crashes and hangs (the shell, CarPlay, the sensor pipeline), which web/errors.js can't see: iOS hands them to
// MetricKit and delivers them on a later launch. Each one goes to our own Worker (POST /api/errors, anonymous, no cookie, no
// token, the same endpoint as the page's errors), counted per day in D1 error_counts as source "ios". No third-party SDK.
// What is sent: the exception type, signal and termination reason, the app build, and the crashed thread's frames as
// binary name + offset (MetricKit's own unsymbolicated form). Never a location, a name, an account or a drive.
final class ApexCrashReports: NSObject, MXMetricManagerSubscriber {
    static let shared = ApexCrashReports()
    private static let endpoint = URL(string: "https://apexnav.senftns.workers.dev/api/errors")!
    private static let maxPerLaunch = 5

    static func start() { MXMetricManager.shared.add(shared) }

    func didReceive(_ payloads: [MXDiagnosticPayload]) {
        var sent = 0
        for p in payloads {
            for c in p.crashDiagnostics ?? [] where sent < Self.maxPerLaunch {
                let what = [c.exceptionType.map { "exception \($0)" }, c.signal.map { "signal \($0)" }, c.terminationReason]
                    .compactMap { $0 }.joined(separator: ", ")
                Self.send(kind: "crash", message: "crash: \(what.isEmpty ? "unknown" : what)",
                          stack: Self.frames(c.callStackTree.jsonRepresentation()), build: c.metaData.applicationBuildVersion)
                sent += 1
            }
            for h in p.hangDiagnostics ?? [] where sent < Self.maxPerLaunch {
                let secs = h.hangDuration.converted(to: .seconds).value
                Self.send(kind: "hang", message: String(format: "hang: %.1f s", secs),
                          stack: Self.frames(h.callStackTree.jsonRepresentation()), build: h.metaData.applicationBuildVersion)
                sent += 1
            }
        }
    }

    /// The attributed (crashed or hung) thread's frames as "binary+offset", innermost first, at most 30.
    static func frames(_ json: Data) -> String {
        guard let root = try? JSONSerialization.jsonObject(with: json) as? [String: Any],
              let stacks = root["callStacks"] as? [[String: Any]] else { return "" }
        let stack = stacks.first { ($0["threadAttributed"] as? Bool) == true } ?? stacks.first
        var out: [String] = []
        var level = stack?["callStackRootFrames"] as? [[String: Any]] ?? []
        while let f = level.first, out.count < 30 {
            let name = f["binaryName"] as? String ?? "?", off = f["offsetIntoBinaryTextSegment"] as? Int ?? 0
            out.append("\(name)+0x\(String(off, radix: 16))")
            level = f["subFrames"] as? [[String: Any]] ?? []
        }
        return out.joined(separator: "\n")
    }

    private static func send(kind: String, message: String, stack: String, build: String) {
        var req = URLRequest(url: endpoint)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.setValue("1", forHTTPHeaderField: "x-apexnav")
        req.setValue("apexnav://app", forHTTPHeaderField: "origin")
        req.httpShouldHandleCookies = false
        req.httpBody = try? JSONSerialization.data(withJSONObject: [
            "kind": kind, "app": "ios", "message": String(message.prefix(300)), "stack": String(stack.prefix(2000)),
            "page": String("native \(build)".prefix(80)),
        ])
        URLSession.shared.dataTask(with: req).resume()
    }
}
