import SwiftUI
import UIKit

/// Where this item is worth listing, ranked by what it should fetch.
///
/// The headline is one platform and one number range, because that's the
/// decision being made — "which of these four do I bother with". The rest stay
/// visible underneath rather than hidden behind a tap, since the comparison is
/// the whole point.
struct MarketFitView: View {
    let fit: MarketFit
    /// Tapping a row selects that platform's listing above.
    var onSelect: (Platform) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Where to sell")
                .font(.headline)

            if let best = fit.best {
                Button {
                    onSelect(best.platform)
                } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(alignment: .firstTextBaseline) {
                            Label(best.platform.displayName, systemImage: "star.fill")
                                .font(.title3.weight(.semibold))
                                .labelStyle(.titleAndIcon)
                            Spacer()
                            Text(best.priceRange)
                                .font(.title3.weight(.semibold))
                                .monospacedDigit()
                        }
                        Text(fit.summary)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.accentColor.opacity(0.12), in: RoundedRectangle(cornerRadius: 14))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14)
                            .strokeBorder(Color.accentColor.opacity(0.45), lineWidth: 1)
                    )
                }
                .buttonStyle(.plain)
                .accessibilityLabel(
                    "Best price \(best.platform.displayName), estimated \(best.priceRange). \(fit.summary)"
                )
            }

            ForEach(fit.others) { entry in
                Button {
                    onSelect(entry.platform)
                } label: {
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(entry.platform.displayName)
                                .font(.subheadline.weight(.medium))
                            Text(entry.reason)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer(minLength: 8)
                        Text(entry.priceRange)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .monospacedDigit()
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(
                    "\(entry.platform.displayName), estimated \(entry.priceRange). \(entry.reason)"
                )
            }

            // The numbers come from the photos, not from sold listings. Saying so
            // here is cheaper than a seller discovering it by mispricing.
            Text("Estimates from your photos — a guide to where to list, not sold prices.")
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .padding(.top, 2)
        }
        .padding(16)
        .background(Color(UIColor.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
    }
}
