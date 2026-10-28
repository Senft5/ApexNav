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
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text(context.state.note).font(.headline).lineLimit(2)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(context.state.distance).font(.title3).bold().monospacedDigit()
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text(context.state.eta.isEmpty ? context.attributes.title : context.state.eta).font(.caption).foregroundStyle(.secondary)
                }
            } compactLeading: {
                Text(context.state.distance).font(.caption2).bold().monospacedDigit()
            } compactTrailing: {
                Text(String(context.state.note.prefix(10))).font(.caption2).lineLimit(1)
            } minimal: {
                Text(context.state.distance).font(.caption2).monospacedDigit()
            }
        }
    }
}
