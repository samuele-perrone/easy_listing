import SwiftUI
import SwiftData

/// Shows one platform's generated listing: tap-to-copy fields, plus either the
/// guided copy-paste flow (Vinted / Gumtree / FB Marketplace) or real API
/// posting (eBay).
struct PlatformListingView: View {
    @Bindable var listing: PlatformListing
    let item: Item

    @StateObject private var ebayAuth = EbayAuthService.shared
    @State private var copiedField: String?
    @State private var editingField: ListingField?
    @State private var showingPublishWarning = false
    @State private var isPosting = false
    @State private var postError: String?
    @State private var postedURL: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            statusBanner

            ForEach(listing.fields) { field in
                FieldCard(
                    field: field,
                    isCopied: copiedField == field.label,
                    onCopy: {
                        UIPasteboard.general.string = field.value
                        withAnimation { copiedField = field.label }
                        if listing.status == .notPosted && !listing.platform.supportsAutoPost {
                            listing.status = .copiedOver
                        }
                    },
                    onEdit: { editingField = field }
                )
            }

            if listing.platform.supportsAutoPost {
                ebaySection
            } else {
                copyPasteFooter
            }
        }
        .sheet(item: $editingField) { field in
            EditFieldSheet(
                field: field,
                options: choices(for: field)
            ) { newValue in
                listing.updateField(label: field.label, to: newValue)
            }
        }
        .alert("Post to eBay?", isPresented: $showingPublishWarning) {
            Button("Cancel", role: .cancel) {}
            Button("Publish now") {
                Task {
                    if listing.status == .drafted { await publishDraft() }
                    else { await post(publish: true) }
                }
            }
        } message: {
            Text("This will publish the listing LIVE on eBay under your connected account, visible to buyers immediately. This can't be undone from the app — you'd need to end the listing on eBay.")
        }
        .alert("eBay error", isPresented: .init(get: { postError != nil }, set: { if !$0 { postError = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(postError ?? "")
        }
    }

    @ViewBuilder
    private var statusBanner: some View {
        switch listing.status {
        case .posted:
            Label {
                VStack(alignment: .leading) {
                    Text("Posted \(listing.postedAt.map { $0.formatted(.dateTime.day().month().hour().minute()) } ?? "")")
                    if let urlString = listing.postedURL, let url = URL(string: urlString) {
                        Link("View listing", destination: url).font(.caption)
                    }
                }
            } icon: {
                Image(systemName: "checkmark.circle.fill")
            }
            .font(.subheadline)
            .foregroundStyle(.green)
        case .copiedOver:
            Label("You've started copying this one over", systemImage: "doc.on.doc")
                .font(.subheadline)
                .foregroundStyle(.orange)
        case .drafted:
            Label("Saved as draft on eBay — not visible to buyers yet", systemImage: "tray.full")
                .font(.subheadline)
                .foregroundStyle(.blue)
        case .notPosted:
            EmptyView()
        }
    }

    private var copyPasteFooter: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("\(listing.platform.displayName) has no public posting API, so tap each field above to copy it, then paste it into their listing form. Your photos are in this app's history and your camera roll.")
                .font(.caption)
                .foregroundStyle(.secondary)
            Button {
                openPlatform()
                listing.status = .copiedOver
            } label: {
                Label("Open \(listing.platform.displayName)", systemImage: "arrow.up.forward.app")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
        }
        .padding(.top, 4)
    }

    @ViewBuilder
    private var ebaySection: some View {
        VStack(spacing: 8) {
            if !ebayAuth.isConnected {
                Text("Connect your eBay account in Settings to post directly from the app.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            if isPosting {
                ProgressView("Talking to eBay…")
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 4)
            } else if listing.status == .drafted {
                Button {
                    showingPublishWarning = true
                } label: {
                    Label("Publish draft", systemImage: "paperplane.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(!ebayAuth.isConnected)
            } else if listing.status != .posted {
                Button {
                    Task { await post(publish: false) }
                } label: {
                    Label("Save as draft on eBay", systemImage: "tray.and.arrow.down")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(!ebayAuth.isConnected || listing.ebayDraft == nil)
                Button {
                    showingPublishWarning = true
                } label: {
                    Label("Post to eBay", systemImage: "paperplane.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(!ebayAuth.isConnected || listing.ebayDraft == nil)
            }
        }
        .padding(.top, 4)
    }

    /// Fields with a fixed set of valid values get a picker instead of free text —
    /// eBay rejects a condition that isn't one of its enums.
    private func choices(for field: ListingField) -> [String]? {
        guard listing.platform == .ebay,
              field.label.lowercased().contains("condition") else { return nil }
        return [
            "NEW",
            "NEW_OTHER",
            "LIKE_NEW",
            "USED_EXCELLENT",
            "USED_VERY_GOOD",
            "USED_GOOD",
            "USED_ACCEPTABLE",
            "FOR_PARTS_OR_NOT_WORKING",
        ]
    }

    private func openPlatform() {
        let platform = listing.platform
        if let appURL = platform.appURL, UIApplication.shared.canOpenURL(appURL) {
            UIApplication.shared.open(appURL)
        } else {
            UIApplication.shared.open(platform.webURL)
        }
    }

    private func post(publish: Bool) async {
        guard let draft = listing.editedEbayDraft else { return }
        isPosting = true
        defer { isPosting = false }
        do {
            let token = try await ebayAuth.validAccessToken()
            let response = try await APIClient.postToEbay(
                draft: draft,
                photos: item.photosData,
                accessToken: token,
                publish: publish
            )
            listing.ebayOfferId = response.offerId
            if publish {
                listing.status = .posted
                listing.postedAt = .now
                listing.postedURL = response.viewURL
            } else {
                listing.status = .drafted
            }
        } catch {
            postError = error.localizedDescription
        }
    }

    private func publishDraft() async {
        guard let offerId = listing.ebayOfferId else { return }
        isPosting = true
        defer { isPosting = false }
        do {
            let token = try await ebayAuth.validAccessToken()
            let response = try await APIClient.publishEbayOffer(offerId: offerId, accessToken: token)
            listing.status = .posted
            listing.postedAt = .now
            listing.postedURL = response.viewURL
        } catch {
            postError = error.localizedDescription
        }
    }
}

private struct FieldCard: View {
    let field: ListingField
    let isCopied: Bool
    let onCopy: () -> Void
    let onEdit: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 14) {
                Text(field.label.uppercased())
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                Button(action: onEdit) {
                    Label("Edit", systemImage: "pencil")
                        .font(.caption2)
                }
                Button(action: onCopy) {
                    Label(isCopied ? "Copied" : "Copy", systemImage: isCopied ? "checkmark" : "doc.on.doc")
                        .font(.caption2)
                        .foregroundStyle(isCopied ? .green : .accentColor)
                }
            }
            .buttonStyle(.plain)

            Text(field.value)
                .font(.callout)
                .foregroundStyle(.primary)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
                .onTapGesture(perform: onCopy)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
    }
}

/// Edits one generated field. Fields with a fixed value set get a picker so an
/// invalid value can't be typed.
private struct EditFieldSheet: View {
    let field: ListingField
    let options: [String]?
    let onSave: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var value: String

    init(field: ListingField, options: [String]?, onSave: @escaping (String) -> Void) {
        self.field = field
        self.options = options
        self.onSave = onSave
        _value = State(initialValue: field.value)
    }

    var body: some View {
        NavigationStack {
            Form {
                if let options {
                    Picker(field.label, selection: $value) {
                        ForEach(options, id: \.self) { Text($0).tag($0) }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                } else {
                    TextEditor(text: $value)
                        .frame(minHeight: 200)
                        .font(.callout)
                }
            }
            .navigationTitle(field.label)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        onSave(value.trimmingCharacters(in: .whitespacesAndNewlines))
                        dismiss()
                    }
                    .disabled(value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }
}
