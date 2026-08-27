import SwiftUI

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var ebayAuth = EbayAuthService.shared
    @AppStorage("backendURL") private var backendURL = ""
    @State private var connectError: APIClient.APIError?
    @State private var isConnecting = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("https://easy-listing-chi.vercel.app", text: $backendURL)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } header: {
                    Text("Backend URL")
                } footer: {
                    Text("Your deployed Easy Listing backend. Defaults to http://localhost:3000 for development.")
                }

                Section {
                    if ebayAuth.isConnected {
                        Label("eBay connected", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                        Button("Disconnect eBay", role: .destructive) {
                            ebayAuth.disconnect()
                        }
                    } else {
                        Button {
                            Task {
                                isConnecting = true
                                defer { isConnecting = false }
                                do { try await ebayAuth.connect() }
                                catch { connectError = error as? APIClient.APIError ?? APIClient.APIError(message: error.localizedDescription) }
                            }
                        } label: {
                            if isConnecting {
                                HStack { ProgressView(); Text("Connecting…") }
                            } else {
                                Label("Connect eBay account", systemImage: "person.crop.circle.badge.plus")
                            }
                        }
                        .disabled(isConnecting)
                    }
                } header: {
                    Text("Connected accounts")
                } footer: {
                    Text("eBay is the only marketplace with a public seller API. Vinted, Gumtree and FB Marketplace listings use the guided copy-paste flow instead.")
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .errorAlert($connectError, title: "Couldn't connect eBay")
        }
    }
}
