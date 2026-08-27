import Foundation
import UIKit

/// Client for the Easy Listing backend (Next.js on Vercel).
struct APIClient {
    /// The deployed backend. Overridable in Settings for local development.
    static let defaultBaseURL = "https://easy-listing-chi.vercel.app"

    static var baseURL: URL {
        let stored = UserDefaults.standard.string(forKey: "backendURL") ?? ""
        return URL(string: stored.isEmpty ? defaultBaseURL : stored) ?? URL(string: defaultBaseURL)!
    }

    struct GenerateResponse: Codable {
        struct GeneratedListing: Codable {
            var platform: String
            var fields: [ListingField]
        }
        var title: String
        var summary: String
        var listings: [GeneratedListing]
        var ebayDraft: EbayDraft
    }

    /// A failure worth showing to a person: what went wrong, what to do about it,
    /// and the raw payload kept aside for a support email.
    struct APIError: LocalizedError, Identifiable {
        var id = UUID()
        var message: String
        var fix: String?
        var detail: String?
        var code: Int?

        var errorDescription: String? { message }

        init(message: String, fix: String? = nil, detail: String? = nil, code: Int? = nil) {
            self.message = message
            self.fix = fix
            self.detail = detail
            self.code = code
        }

        /// Body for a support email — the technical detail a person shouldn't have to read.
        var supportBody: String {
            var lines = ["", "---", "Please keep the details below, they help us diagnose it.", ""]
            lines.append("What failed: \(message)")
            if let code { lines.append("eBay error code: \(code)") }
            if let detail { lines.append("Details: \(detail)") }
            lines.append("App version: \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?")")
            lines.append("iOS: \(UIDevice.current.systemVersion)")
            return lines.joined(separator: "\n")
        }
    }

    /// Encodes photos as base64 JPEGs small enough for the server to accept, stepping
    /// down resolution and quality until they fit. Vercel rejects bodies over 4.5 MB,
    /// so the budget leaves headroom for the surrounding JSON.
    private static func encodedImages(from photos: [UIImage], maxDimension: CGFloat, quality: CGFloat) -> [String] {
        let budget = 3_000_000
        var dimension = maxDimension
        var quality = quality

        for _ in 0..<4 {
            let encoded = photos.compactMap {
                $0.resized(maxDimension: dimension).jpegData(compressionQuality: quality)?.base64EncodedString()
            }
            if encoded.reduce(0, { $0 + $1.count }) <= budget { return encoded }
            dimension *= 0.75
            quality = max(0.4, quality - 0.1)
        }

        return photos.prefix(4).compactMap {
            $0.resized(maxDimension: dimension).jpegData(compressionQuality: quality)?.base64EncodedString()
        }
    }

    /// Sends the item photos (+ optional notes) and gets back per-platform listing fields.
    static func generateListings(photos: [UIImage], notes: String) async throws -> GenerateResponse {
        let images = encodedImages(from: photos, maxDimension: 1100, quality: 0.6)
        guard !images.isEmpty else { throw APIError(message: "No usable photos.") }

        var request = URLRequest(url: baseURL.appending(path: "/api/generate"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 120
        request.httpBody = try JSONEncoder().encode(["images": images, "notes": [notes]])

        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.checkOK(data: data, response: response)
        return try JSONDecoder().decode(GenerateResponse.self, from: data)
    }

    struct EbayPostResponse: Codable {
        var listingId: String?
        var offerId: String
        var viewURL: String?
    }

    /// Publishes (or stages) a listing on eBay through the backend.
    static func postToEbay(draft: EbayDraft, photos: [Data], accessToken: String, publish: Bool) async throws -> EbayPostResponse {
        struct Body: Codable {
            var accessToken: String
            var publish: Bool
            var draft: EbayDraft
            var images: [String]
        }
        var request = URLRequest(url: baseURL.appending(path: "/api/ebay/post"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 180
        let images = encodedImages(from: photos.compactMap { UIImage(data: $0) }, maxDimension: 1400, quality: 0.7)
        request.httpBody = try JSONEncoder().encode(Body(accessToken: accessToken, publish: publish, draft: draft, images: images))

        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.checkOK(data: data, response: response)
        return try JSONDecoder().decode(EbayPostResponse.self, from: data)
    }

    /// Publishes a previously saved eBay draft offer.
    static func publishEbayOffer(offerId: String, accessToken: String) async throws -> EbayPostResponse {
        var request = URLRequest(url: baseURL.appending(path: "/api/ebay/publish"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 120
        request.httpBody = try JSONEncoder().encode(["accessToken": accessToken, "offerId": offerId])
        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.checkOK(data: data, response: response)
        struct Resp: Codable { var listingId: String?; var viewURL: String? }
        let resp = try JSONDecoder().decode(Resp.self, from: data)
        return EbayPostResponse(listingId: resp.listingId, offerId: offerId, viewURL: resp.viewURL)
    }

    static func refreshEbayToken(refreshToken: String) async throws -> (accessToken: String, expiresIn: Int) {
        var request = URLRequest(url: baseURL.appending(path: "/api/ebay/refresh"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["refreshToken": refreshToken])
        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.checkOK(data: data, response: response)
        struct Resp: Codable { var accessToken: String; var expiresIn: Int }
        let resp = try JSONDecoder().decode(Resp.self, from: data)
        return (resp.accessToken, resp.expiresIn)
    }

    private static func checkOK(data: Data, response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            struct ErrBody: Codable {
                var error: String?
                var fix: String?
                var detail: String?
                var code: Int?
            }
            if let body = try? JSONDecoder().decode(ErrBody.self, from: data), let message = body.error {
                throw APIError(message: message, fix: body.fix, detail: body.detail, code: body.code)
            }
            if status == 413 {
                throw APIError(
                    message: "Those photos are too large to upload.",
                    fix: "Try again with fewer photos."
                )
            }
            throw APIError(
                message: "Couldn't reach the server.",
                fix: "Check your connection and try again.",
                detail: "HTTP \(status)"
            )
        }
    }
}

extension UIImage {
    func resized(maxDimension: CGFloat) -> UIImage {
        let largest = max(size.width, size.height)
        guard largest > maxDimension else { return self }
        let scale = maxDimension / largest
        let newSize = CGSize(width: size.width * scale, height: size.height * scale)
        let renderer = UIGraphicsImageRenderer(size: newSize)
        return renderer.image { _ in draw(in: CGRect(origin: .zero, size: newSize)) }
    }
}
