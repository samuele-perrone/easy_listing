import Foundation
import AuthenticationServices

/// Handles the eBay OAuth flow via the backend and keeps tokens in the Keychain.
@MainActor
final class EbayAuthService: NSObject, ObservableObject {
    static let shared = EbayAuthService()

    @Published var isConnected: Bool = Keychain.get("ebayRefreshToken") != nil

    private var session: ASWebAuthenticationSession?

    /// Opens the eBay consent page (served by the backend's /api/ebay/login redirect).
    /// The backend's callback redirects to easylisting://ebay-auth#access_token=...
    func connect() async throws {
        let authURL = APIClient.baseURL.appending(path: "/api/ebay/login")
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
            self.session = session
            session.start()
        }
        try handleCallback(callbackURL)
    }

    private func handleCallback(_ url: URL) throws {
        // Tokens arrive in the URL fragment so they never hit request logs.
        guard let fragment = url.fragment else {
            throw APIClient.APIError(message: "eBay sign-in did not return tokens.")
        }
        var params: [String: String] = [:]
        for pair in fragment.split(separator: "&") {
            let parts = pair.split(separator: "=", maxSplits: 1).map(String.init)
            if parts.count == 2 {
                params[parts[0]] = parts[1].removingPercentEncoding ?? parts[1]
            }
        }
        guard let access = params["access_token"], let refresh = params["refresh_token"] else {
            throw APIClient.APIError(message: "eBay sign-in did not return tokens.")
        }
        Keychain.set(access, for: "ebayAccessToken")
        Keychain.set(refresh, for: "ebayRefreshToken")
        let expiresIn = Int(params["expires_in"] ?? "7200") ?? 7200
        Keychain.set(String(Date.now.addingTimeInterval(TimeInterval(expiresIn - 300)).timeIntervalSince1970), for: "ebayAccessExpiry")
        isConnected = true
    }

    /// Returns a valid access token, refreshing through the backend when expired.
    func validAccessToken() async throws -> String {
        guard let refresh = Keychain.get("ebayRefreshToken") else {
            throw APIClient.APIError(message: "eBay account not connected. Connect it in Settings.")
        }
        if let access = Keychain.get("ebayAccessToken"),
           let expiryRaw = Keychain.get("ebayAccessExpiry"),
           let expiry = Double(expiryRaw),
           Date.now.timeIntervalSince1970 < expiry {
            return access
        }
        let refreshed = try await APIClient.refreshEbayToken(refreshToken: refresh)
        Keychain.set(refreshed.accessToken, for: "ebayAccessToken")
        Keychain.set(String(Date.now.addingTimeInterval(TimeInterval(refreshed.expiresIn - 300)).timeIntervalSince1970), for: "ebayAccessExpiry")
        return refreshed.accessToken
    }

    func disconnect() {
        Keychain.delete("ebayAccessToken")
        Keychain.delete("ebayRefreshToken")
        Keychain.delete("ebayAccessExpiry")
        isConnected = false
    }
}

extension EbayAuthService: ASWebAuthenticationPresentationContextProviding {
    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated { ASPresentationAnchor() }
    }
}
