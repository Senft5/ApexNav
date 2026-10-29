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
            .activityBackgroundTint(Color.black.opacity(0.85))
            .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            // Around the cut-out (Human Interface Guidelines, Live Activities): the leading and trailing regions sit beside the
            // camera and their outer corners follow the island's curve, so they carry one short value each and drop below the
            // camera when too wide; the note, the longest text, gets the full-width bottom row. Compact and minimal views have a
            // fixed width and shrink their text rather than clip it against the island.
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text(context.state.distance.isEmpty ? "--" : context.state.distance)
                        .font(.title3).bold().monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
                        .padding(.leading, 4)
                        .dynamicIsland(verticalPlacement: .belowIfTooWide)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(context.state.eta.isEmpty ? " " : String(context.state.eta.split(separator: "·").first ?? "").trimmingCharacters(in: .whitespaces))
                        .font(.caption).foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.7)
                        .padding(.trailing, 4)
                        .dynamicIsland(verticalPlacement: .belowIfTooWide)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(context.state.note).font(.headline).lineLimit(1).minimumScaleFactor(0.7)
                        Text(context.attributes.title).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 8)
                }
            } compactLeading: {
                Text(context.state.distance.isEmpty ? "--" : context.state.distance)
                    .font(.caption2).bold().monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
                    .frame(maxWidth: 52)
            } compactTrailing: {
                Text(context.state.note)
                    .font(.caption2).lineLimit(1).minimumScaleFactor(0.6)
                    .frame(maxWidth: 52)
            } minimal: {
                Text(context.state.distance.isEmpty ? "--" : context.state.distance)
                    .font(.caption2).monospacedDigit().lineLimit(1).minimumScaleFactor(0.5)
            }
            .keylineTint(.red)
        }
    }
}
