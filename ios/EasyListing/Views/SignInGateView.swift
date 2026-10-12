import SwiftUI
import AuthenticationServices

/// Stands in front of the app until someone is signed in with an approved
/// account.
///
/// This is a courtesy, not the control: the backend refuses to generate or to
/// post for a caller it can't verify, so bypassing this screen would get you an
/// app that can't do anything. It exists so the refusal arrives as a sign-in
/// prompt rather than as an error on the first photo.
struct SignInGateView: View {
    @StateObject private var auth = AuthService.shared
    @State private var isSigningIn = false
    @State private var signInError: APIClient.APIError?

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            Image(systemName: "tag.fill")
                .font(.system(size: 56))
                .foregroundStyle(.tint)

            VStack(spacing: 8) {
                Text("Easy Listing")
                    .font(.largeTitle.bold())
                Text("Photograph something once, and get a listing written for eBay, Vinted, Gumtree and Facebook.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            Spacer()

            if isSigningIn {
                ProgressView("Signing in…")
            } else if auth.isSignedIn && !auth.canPostToEbay {
                // Signed in, but this account isn't approved. Say whose account
                // it is — otherwise the only way out looks like reinstalling.
                VStack(spacing: 12) {
                    Label("This account isn't approved yet", systemImage: "lock")
                        .font(.headline)
                    Text("Signed in as \(auth.email ?? "an unknown account"). Ask Sam to add it to the approved list, then reopen the app.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                    Button("Try a different account") { auth.signOut() }
                        .buttonStyle(.bordered)
                }
            } else {
                VStack(spacing: 12) {
                    SignInWithAppleButton(.signIn) { request in
                        request.requestedScopes = [.email]
                    } onCompletion: { result in
                        signIn { try await auth.completeAppleSignIn(result) }
                    }
                    .signInWithAppleButtonStyle(.black)
                    .frame(height: 48)

                    Button {
                        signIn { try await auth.signInWithGoogle() }
                    } label: {
                        Label("Sign in with Google", systemImage: "globe")
                            .frame(maxWidth: .infinity)
                            .frame(height: 48)
                    }
                    .buttonStyle(.bordered)

                    // Apple hands over a @privaterelay address if you pick "Hide
                    // My Email", and that can never match the approved list — so
                    // warn before the choice, not after it fails.
                    Text("Choose “Share My Email” when signing in with Apple — a hidden address can't be matched against the approved list.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
            }

            Spacer()
        }
        .padding(28)
        .errorAlert($signInError, title: "Couldn't sign in")
        .task {
            // An approved account added server-side should let them in on the
            // next launch without signing in again.
            await auth.refreshEntitlement()
        }
    }

    private func signIn(_ work: @escaping () async throws -> Void) {
        Task {
            isSigningIn = true
            defer { isSigningIn = false }
            do { try await work() }
            catch let error as APIClient.APIError {
                if error.message != "Sign-in was cancelled." { signInError = error }
            }
            catch { signInError = APIClient.APIError(message: error.localizedDescription) }
        }
    }
}
