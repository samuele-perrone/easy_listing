import SwiftUI
import UIKit

/// Presents a failure as something readable — what happened, what to do about it,
/// and a way to send the technical detail to support rather than showing it.
struct ErrorAlert: ViewModifier {
    @Binding var error: APIClient.APIError?
    var title: String

    private var isPresented: Binding<Bool> {
        Binding(get: { error != nil }, set: { if !$0 { error = nil } })
    }

    func body(content: Content) -> some View {
        content.alert(title, isPresented: isPresented, presenting: error) { failure in
            Button("OK", role: .cancel) {}
            if failure.detail != nil {
                Button("Email support") { sendSupportEmail(for: failure) }
                Button("Copy details") { UIPasteboard.general.string = failure.supportBody }
            }
        } message: { failure in
            Text([failure.message, failure.fix].compactMap { $0 }.joined(separator: "\n\n"))
        }
    }

    private func sendSupportEmail(for failure: APIClient.APIError) {
        var components = URLComponents(string: "mailto:samuele.perrone@gmail.com")
        components?.queryItems = [
            URLQueryItem(name: "subject", value: "Easy Listing — \(title)"),
            URLQueryItem(name: "body", value: failure.supportBody),
        ]
        if let url = components?.url {
            UIApplication.shared.open(url)
        }
    }
}

extension View {
    func errorAlert(_ error: Binding<APIClient.APIError?>, title: String) -> some View {
        modifier(ErrorAlert(error: error, title: title))
    }
}
