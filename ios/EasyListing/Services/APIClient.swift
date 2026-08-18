import Foundation
import UIKit

/// Client for the Easy Listing backend (Next.js on Vercel).
struct APIClient {
    static var baseURL: URL {
        let stored = UserDefaults.standard.string(forKey: "backendURL") ?? ""
        return URL(string: stored.isEmpty ? "http://localhost:3000" : stored)!
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

    struct APIError: LocalizedError {
        var message: String
        var errorDescription: String? { message }
    }

    /// Sends the item photos (+ optional notes) and gets back per-platform listing fields.
    static func generateListings(photos: [UIImage], notes: String) async throws -> GenerateResponse {
        let images = photos.compactMap { $0.resized(maxDimension: 1200).jpegData(compressionQuality: 0.7)?.base64EncodedString() }
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
        let images = photos.compactMap { UIImage(data: $0)?.resized(maxDimension: 1600).jpegData(compressionQuality: 0.8)?.base64EncodedString() }
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
            struct ErrBody: Codable { var error: String? }
            let serverMessage = (try? JSONDecoder().decode(ErrBody.self, from: data))?.error
            throw APIError(message: serverMessage ?? "Server error (HTTP \(status)).")
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
