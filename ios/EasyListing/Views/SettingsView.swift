import SwiftUI
import AuthenticationServices

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var ebayAuth = EbayAuthService.shared
    @StateObject private var auth = AuthService.shared
    @AppStorage("backendURL") private var backendURL = ""
    @State private var connectError: APIClient.APIError?
    @State private var isConnecting = false
    @State private var isSigningIn = false
    @State private var signInError: APIClient.APIError?

    var body: some View {
        NavigationStack {
            Form {
                signInSection

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
            .errorAlert($signInError, title: "Couldn't sign in")
            .task {
                // The allow-list lives on the server, so someone can be added
                // without touching the app. Re-ask on each visit here.
                await auth.refreshEntitlement()
            }
        }
    }

    @ViewBuilder
    private var signInSection: some View {
        Section {
            if auth.isSignedIn {
                LabeledContent("Signed in", value: auth.email ?? "—")
                if auth.canPostToEbay {
                    Label("Can post to eBay", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                } else {
                    Label("Not enabled for eBay posting", systemImage: "lock")
                        .foregroundStyle(.secondary)
                }
                Button("Sign out", role: .destructive) { auth.signOut() }
            } else if isSigningIn {
                HStack { ProgressView(); Text("Signing in…") }
            } else {
                // Apple's own button, as its guidelines require — and offering
                // Sign in with Apple is mandatory once Google is offered too.
                SignInWithAppleButton(.signIn) { request in
                    request.requestedScopes = [.email]
                } onCompletion: { result in
                    signIn { try await auth.completeAppleSignIn(result) }
                }
                .signInWithAppleButtonStyle(.black)
                .frame(height: 44)
                .listRowInsets(EdgeInsets())

                Button {
                    signIn { try await auth.signInWithGoogle() }
                } label: {
                    Label("Sign in with Google", systemImage: "globe")
                }
            }
        } header: {
            Text("Account")
        } footer: {
            Text("Posting to eBay is limited to approved accounts. Everything else — generating listings and the copy-paste flow — works without signing in.")
        }
    }

    private func signIn(_ work: @escaping () async throws -> Void) {
        Task {
            isSigningIn = true
            defer { isSigningIn = false }
            do { try await work() }
            catch let error as APIClient.APIError {
                // A cancelled sheet isn't a failure worth an alert.
                if error.message != "Sign-in was cancelled." { signInError = error }
            }
            catch { signInError = APIClient.APIError(message: error.localizedDescription) }
        }
    }
}
