import ActivityKit
import SwiftUI
import WidgetKit

@main
struct ApexLiveBundle: WidgetBundle {
    var body: some Widget {
        ApexDriveLiveActivity()
        ApexQuickWidget()
        if #available(iOS 18.0, *) { ApexDriveControl() }
    }
}

/// The drive on the lock screen and in the Dynamic Island: the next note and how far it is, and time left on a route.
/// Large type, nothing to tap: it is read at a glance (the cockpit is the app itself).
struct ApexDriveLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ApexDriveAttributes.self) { context in
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(context.state.note).font(.title3).bold().lineLimit(2)
                    Text(context.attributes.title).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 2) {
                    Text(context.state.distance).font(.title2).bold().monospacedDigit()
                    if !context.state.eta.isEmpty { Text(context.state.eta).font(.caption).foregroundStyle(.secondary) }
                }
            }
            .padding(16)
            .activityBackgroundTint(Color(white: 0.09))
            .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            // Around the cut-out (Human Interface Guidelines, Live Activities; docs/design/REVIEW2.md 1): the leading and
            // trailing regions sit beside the camera, so each carries one short value with a 10 pt margin and drops below the
            // camera when too wide; the note, the longest text, gets the full-width bottom row on up to two lines. Compact views
            // show a few characters each side of the sensor, the minimal view a glyph. A hazard turns the keyline and glyph signal
            // orange (the hazard plate's colour in every theme); otherwise the keyline is white, never the record red.
            let hazard = context.state.hazard ?? false
            let orange = Color(red: 1, green: 0.478, blue: 0.102)
            let short = (context.state.short?.isEmpty == false ? context.state.short! : String(context.state.note.prefix(6))).uppercased()
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text(context.state.distance.isEmpty ? "--" : context.state.distance)
                        .font(.title3).bold().monospacedDigit().lineLimit(1)
                        .padding(.leading, 10)
                        .dynamicIsland(verticalPlacement: .belowIfTooWide)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(context.state.etaShort ?? "")
                        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        .padding(.trailing, 10)
                        .dynamicIsland(verticalPlacement: .belowIfTooWide)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            if hazard { Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(orange) }
                            Text(context.state.note).font(.headline).lineLimit(2)
                        }
                        Text(context.attributes.title).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 10)
                }
            } compactLeading: {
                Text(context.state.distance.isEmpty ? "--" : context.state.distance.replacingOccurrences(of: " ft", with: ""))
                    .font(.caption2).bold().monospacedDigit().lineLimit(1)
            } compactTrailing: {
                HStack(spacing: 3) {
                    if hazard { Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(orange) }
                    Text(short).font(.caption2).bold().lineLimit(1)
                }
            } minimal: {
                Image(systemName: hazard ? "exclamationmark.triangle.fill" : "arrow.turn.up.right")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(hazard ? orange : .white)
            }
            .keylineTint(hazard ? orange : .white)
        }
    }
}
