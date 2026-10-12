import Foundation
import AuthenticationServices

/// Sign in with Apple and Google, and what's left of this month's allowance.
///
/// The app holds a session minted by the backend after it verified the
/// provider's identity token. Anyone who signs in can use the app; what's
/// rationed is how many listings a month, and the numbers here are the
/// backend's answer, not a decision made locally — the real check happens
/// server-side on every generation.
@MainActor
final class AuthService: NSObject, ObservableObject {
    static let shared = AuthService()

    @Published var email: String? = Keychain.get("authEmail")
    @Published var listingsUsed: Int = Int(Keychain.get("authUsed") ?? "") ?? 0
    /// Nil means no monthly cap on this account.
    @Published var listingsLimit: Int? = Keychain.get("authLimit").flatMap(Int.init)

    /// What the seller has left this month, or nil when uncapped.
    var listingsLeft: Int? {
        guard let listingsLimit else { return nil }
        return max(0, listingsLimit - listingsUsed)
    }

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
            store(session: response.sessionToken, email: response.email,
                  used: response.listingsUsed, limit: response.listingsLimit)
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
        // An empty `limit` means the account is uncapped.
        let limit = (params["limit"]?.isEmpty == false) ? Int(params["limit"] ?? "") : nil
        store(session: session, email: email, used: Int(params["used"] ?? "") ?? 0, limit: limit)
    }

    // MARK: - State

    private func store(session: String, email: String, used: Int, limit: Int?) {
        Keychain.set(session, for: "authSession")
        Keychain.set(email, for: "authEmail")
        Keychain.set(String(used), for: "authUsed")
        if let limit { Keychain.set(String(limit), for: "authLimit") }
        else { Keychain.delete("authLimit") }
        self.email = email
        self.listingsUsed = used
        self.listingsLimit = limit
    }

    /// Re-asks the backend how much of the allowance is left, so the number the
    /// seller sees is current rather than whatever it was at sign-in.
    func refreshEntitlement() async {
        guard let token = sessionToken else { return }
        do {
            let result = try await APIClient.checkSession(sessionToken: token)
            store(session: token, email: result.email,
                  used: result.listingsUsed, limit: result.listingsLimit)
        } catch let error as APIClient.APIError where error.httpStatus == 401 {
            // The session expired or the signing secret was rotated. Clear it so
            // the UI offers sign-in again rather than a button that can't work.
            signOut()
        } catch {
            // Offline, or the backend is briefly unavailable: keep what we have.
        }
    }

    func signOut() {
        for key in ["authSession", "authEmail", "authUsed", "authLimit"] { Keychain.delete(key) }
        email = nil
        listingsUsed = 0
        listingsLimit = nil
    }
}

extension AuthService: ASWebAuthenticationPresentationContextProviding {
    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated { ASPresentationAnchor() }
    }
}
