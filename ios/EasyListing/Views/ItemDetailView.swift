import SwiftUI
import SwiftData

struct ItemDetailView: View {
    let item: Item
    @State private var selectedPlatform: Platform = .ebay

    private var sortedListings: [PlatformListing] {
        item.listings.sorted { $0.platformRaw < $1.platformRaw }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(Array(item.photosData.enumerated()), id: \.offset) { _, data in
                            if let image = UIImage(data: data) {
                                Image(uiImage: image)
                                    .resizable()
                                    .scaledToFill()
                                    .frame(width: 110, height: 110)
                                    .clipShape(RoundedRectangle(cornerRadius: 12))
                            }
                        }
                    }
                    .padding(.horizontal)
                }

                Text(item.summary)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal)

                Picker("Platform", selection: $selectedPlatform) {
                    ForEach(sortedListings, id: \.platformRaw) { listing in
                        Text(listing.platform.displayName).tag(listing.platform)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)

                if let listing = sortedListings.first(where: { $0.platform == selectedPlatform }) {
                    PlatformListingView(listing: listing, item: item)
                        .padding(.horizontal)
                }
            }
            .padding(.vertical)
        }
        .navigationTitle(item.title)
        .navigationBarTitleDisplayMode(.inline)
    }
}
