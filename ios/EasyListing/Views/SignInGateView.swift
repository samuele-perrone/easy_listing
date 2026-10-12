import SwiftUI
import AuthenticationServices

/// Stands in front of the app until someone is signed in.
///
/// This is a courtesy, not the control: the backend refuses to generate or to
/// post for a caller it can't verify, so bypassing this screen would get you an
/// app that can't do anything. It exists so the refusal arrives as a sign-in
/// prompt rather than as an error on the first photo.
///
/// Deliberately has no "your account isn't approved" state: anyone who signs in
/// can use the app. A screen that tells someone to go and ask a stranger for
/// access is a dead end, and that is what it looked like to anyone who wasn't
/// the author.
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

                    Text("Your free listings each month come with the account you sign in with. Hiding your email is fine — nothing depends on the address.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
            }

            Spacer()
        }
        .padding(28)
        .errorAlert($signInError, title: "Couldn't sign in")
        .task { await auth.refreshEntitlement() }
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
