import SwiftUI
import SwiftData

struct HistoryView: View {
    @Query(sort: \Item.createdAt, order: .reverse) private var items: [Item]
    @Environment(\.modelContext) private var modelContext
    @State private var showingNewItem = false
    @State private var showingSettings = false

    var body: some View {
        NavigationStack {
            Group {
                if items.isEmpty {
                    ContentUnavailableView(
                        "No items yet",
                        systemImage: "camera.viewfinder",
                        description: Text("Snap a few photos of something you want to sell and Easy Listing will write the listings for you.")
                    )
                } else {
                    List {
                        ForEach(items) { item in
                            NavigationLink(value: item) {
                                ItemRow(item: item)
                            }
                        }
                        .onDelete { indexSet in
                            for index in indexSet { modelContext.delete(items[index]) }
                        }
                    }
                }
            }
            .navigationTitle("Easy Listing")
            .navigationDestination(for: Item.self) { ItemDetailView(item: $0) }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { showingSettings = true } label: { Image(systemName: "gearshape") }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showingNewItem = true } label: { Image(systemName: "plus.circle.fill") }
                }
            }
            .sheet(isPresented: $showingNewItem) { NewItemView() }
            .sheet(isPresented: $showingSettings) { SettingsView() }
        }
    }
}

private struct ItemRow: View {
    let item: Item

    var body: some View {
        HStack(spacing: 12) {
            if let data = item.photosData.first, let image = UIImage(data: data) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .frame(width: 56, height: 56)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
            } else {
                RoundedRectangle(cornerRadius: 10)
                    .fill(.quaternary)
                    .frame(width: 56, height: 56)
                    .overlay(Image(systemName: "photo"))
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(item.title).font(.headline).lineLimit(1)
                Text(item.createdAt, format: .dateTime.day().month().year())
                    .font(.caption)
                    .foregroundStyle(.secondary)
                HStack(spacing: 4) {
                    ForEach(item.listings.sorted { $0.platformRaw < $1.platformRaw }, id: \.platformRaw) { listing in
                        StatusChip(listing: listing)
                    }
                }
            }
        }
    }
}

struct StatusChip: View {
    let listing: PlatformListing

    var body: some View {
        Text(listing.platform.displayName)
            .font(.caption2.weight(.medium))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.15), in: Capsule())
            .foregroundStyle(color)
    }

    private var color: Color {
        switch listing.status {
        case .notPosted: return .gray
        case .copiedOver: return .orange
        case .drafted: return .blue
        case .posted: return .green
        }
    }
}
