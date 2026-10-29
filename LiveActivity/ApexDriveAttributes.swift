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
        /// The note in a few characters for the island's compact view ("R1+", "CREST"); nil from an older page.
        var short: String? = nil
        /// The next call is a hazard: the island's keyline and glyph turn signal orange (REVIEW.md 4.3.1).
        var hazard: Bool? = nil
        /// Time left only ("48 min"), for the expanded view's trailing slot.
        var etaShort: String? = nil
    }
    /// The drive or route name.
    var title: String
}
