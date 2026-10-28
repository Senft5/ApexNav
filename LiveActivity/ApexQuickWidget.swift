import AppIntents
import SwiftUI
import WidgetKit

/// One tap to start a drive (IDEAS U-10): a home screen and lock screen widget, and on iOS 18 a Control Center button,
/// all opening apexnav://open?go=drive, the link the app already takes from CarPlay and Shortcuts. No data is shared
/// with the widget, so it needs no App Group.
private let driveURL = URL(string: "apexnav://open?go=drive")!

struct ApexQuickEntry: TimelineEntry { let date: Date }

struct ApexQuickProvider: TimelineProvider {
    func placeholder(in context: Context) -> ApexQuickEntry { ApexQuickEntry(date: .now) }
    func getSnapshot(in context: Context, completion: @escaping (ApexQuickEntry) -> Void) { completion(ApexQuickEntry(date: .now)) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<ApexQuickEntry>) -> Void) {
        completion(Timeline(entries: [ApexQuickEntry(date: .now)], policy: .never))   // nothing changes: no refreshes
    }
}

struct ApexQuickView: View {
    @Environment(\.widgetFamily) private var family
    var body: some View {
        switch family {
        case .accessoryCircular:
            ZStack { AccessoryWidgetBackground(); Image(systemName: "steeringwheel").font(.title2) }
                .accessibilityLabel("Start a drive")
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 2) {
                Label("Start a drive", systemImage: "steeringwheel").font(.headline)
                Text("Vetta").font(.caption).foregroundStyle(.secondary)
            }
        case .accessoryInline:
            Label("Start a drive", systemImage: "steeringwheel")
        default:
            VStack(alignment: .leading, spacing: 6) {
                Image(systemName: "steeringwheel").font(.system(size: 34, weight: .semibold))
                Spacer(minLength: 0)
                Text("Start a drive").font(.headline)
                Text("Notes on, recording").font(.caption).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
    }
}

struct ApexQuickWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ApexQuickDrive", provider: ApexQuickProvider()) { _ in
            ApexQuickView()
                .widgetURL(driveURL)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Start a drive")
        .description("Opens Vetta straight into a drive.")
        .supportedFamilies([.systemSmall, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

@available(iOS 18.0, *)
struct ApexDriveControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "ApexDriveControl") {
            ControlWidgetButton(action: OpenURLIntent(driveURL)) {
                Label("Start a drive", systemImage: "steeringwheel")
            }
        }
        .displayName("Start a drive")
        .description("Opens Vetta straight into a drive.")
    }
}
