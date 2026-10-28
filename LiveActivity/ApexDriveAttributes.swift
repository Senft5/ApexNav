import ActivityKit

/// What the drive's Live Activity shows (IDEAS U-11): shared by the app, which starts and updates it, and the
/// ApexNavLive widget extension, which draws it on the lock screen and in the Dynamic Island.
struct ApexDriveAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// The next note as the cockpit shows it ("Left 3 tightens", "Bump"), or the drive's state ("Recording").
        var note: String
        /// Distance to it, already in the driver's units ("350 ft", "0.4 mi"); empty when there is none.
        var distance: String
        /// Time left and arrival on a planned route ("48 min left · 5:12 PM"); empty when unknown.
        var eta: String
    }
    /// The drive or route name.
    var title: String
}
