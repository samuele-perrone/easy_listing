import Foundation
import AuthenticationServices

/// Sign in with Apple and Google, and whether this account may post to eBay.
///
/// The app holds a session minted by the backend after it verified the
/// provider's identity token. `canPostToEbay` is the backend's answer about the
/// allow-list, not a decision made here — the button it hides is a courtesy,
/// and the real check happens server-side on every eBay write.
@MainActor
final class AuthService: NSObject, ObservableObject {
    static let shared = AuthService()

    @Published var email: String? = Keychain.get("authEmail")
    @Published var canPostToEbay: Bool = Keychain.get("authCanPost") == "true"

    var isSignedIn: Bool { Keychain.get("authSession") != nil }

    private var webSession: ASWebAuthenticationSession?

    var sessionToken: String? { Keychain.get("authSession") }

    // MARK: - Apple

    /// Finishes a native Sign in with Apple started by `SignInWithAppleButton`.
    ///
    /// Only the identity token leaves the device: it's a JWT signed by Apple,
    /// so the backend verifies the email itself rather than trusting whatever
    /// the app claims.
    func completeAppleSignIn(_ result: Result<ASAuthorization, Error>) async throws {
        switch result {
        case .failure(let error):
            if (error as? ASAuthorizationError)?.code == .canceled {
                throw APIClient.APIError(message: "Sign-in was cancelled.")
            }
            throw error

        case .success(let authorization):
            guard
                let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                let tokenData = credential.identityToken,
                let identityToken = String(data: tokenData, encoding: .utf8)
            else {
                throw APIClient.APIError(message: "Apple did not return an identity token.")
            }
            let response = try await APIClient.exchangeIdentityToken(provider: "apple", idToken: identityToken)
            store(session: response.sessionToken, email: response.email, canPost: response.canPostToEbay)
        }
    }

    // MARK: - Google

    /// Google through the backend's web flow, so there's no Google SDK in the
    /// app and the client secret stays on the server.
    func signInWithGoogle() async throws {
        let authURL = APIClient.baseURL.appending(path: "/api/auth/google/login")
        let callbackURL: URL = try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(url: authURL, callbackURLScheme: "easylisting") { url, error in
                if let url {
                    continuation.resume(returning: url)
                } else {
                    continuation.resume(throwing: error ?? APIClient.APIError(message: "Sign-in was cancelled."))
                }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.webSession = session
            session.start()
        }
        try handleGoogleCallback(callbackURL)
    }

    private func handleGoogleCallback(_ url: URL) throws {
        // The session arrives in the fragment so it never reaches request logs.
        guard let fragment = url.fragment else {
            throw APIClient.APIError(message: "Google sign-in did not return a session.")
        }
        var params: [String: String] = [:]
        for pair in fragment.split(separator: "&") {
            let parts = pair.split(separator: "=", maxSplits: 1).map(String.init)
            if parts.count == 2 {
                params[parts[0]] = parts[1].removingPercentEncoding ?? parts[1]
            }
        }
        if let message = params["error"] {
            throw APIClient.APIError(message: message)
        }
        guard let session = params["session"], let email = params["email"] else {
            throw APIClient.APIError(message: "Google sign-in did not return a session.")
        }
        store(session: session, email: email, canPost: params["can_post"] == "true")
    }

    // MARK: - State

    private func store(session: String, email: String, canPost: Bool) {
        Keychain.set(session, for: "authSession")
        Keychain.set(email, for: "authEmail")
        Keychain.set(canPost ? "true" : "false", for: "authCanPost")
        self.email = email
        self.canPostToEbay = canPost
    }

    /// Re-asks the backend about this session. Being added to the allow-list
    /// happens server-side, so without this the seller would have to sign out
    /// and back in to see the button appear.
    func refreshEntitlement() async {
        guard let token = sessionToken else { return }
        do {
            let result = try await APIClient.checkSession(sessionToken: token)
            Keychain.set(result.canPostToEbay ? "true" : "false", for: "authCanPost")
            Keychain.set(result.email, for: "authEmail")
            email = result.email
            canPostToEbay = result.canPostToEbay
        } catch let error as APIClient.APIError where error.httpStatus == 401 {
            // The session expired or the signing secret was rotated. Clear it so
            // the UI offers sign-in again rather than a button that can't work.
            signOut()
        } catch {
            // Offline, or the backend is briefly unavailable: keep what we have.
        }
    }

    func signOut() {
        Keychain.delete("authSession")
        Keychain.delete("authEmail")
        Keychain.delete("authCanPost")
        email = nil
        canPostToEbay = false
    }
}

extension AuthService: ASWebAuthenticationPresentationContextProviding {
    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated { ASPresentationAnchor() }
    }
}
