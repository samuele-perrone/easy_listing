import SwiftUI
import SwiftData
import PhotosUI

struct NewItemView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext

    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var photos: [UIImage] = []
    @State private var notes = ""
    @State private var showingCamera = false
    @State private var isGenerating = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Photos") {
                    if !photos.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(Array(photos.enumerated()), id: \.offset) { index, photo in
                                    Image(uiImage: photo)
                                        .resizable()
                                        .scaledToFill()
                                        .frame(width: 84, height: 84)
                                        .clipShape(RoundedRectangle(cornerRadius: 10))
                                        .overlay(alignment: .topTrailing) {
                                            Button {
                                                photos.remove(at: index)
                                            } label: {
                                                Image(systemName: "xmark.circle.fill")
                                                    .foregroundStyle(.white, .black.opacity(0.6))
                                            }
                                            .padding(2)
                                        }
                                }
                            }
                        }
                        .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
                    }
                    PhotosPicker(selection: $pickerItems, maxSelectionCount: 12, matching: .images) {
                        Label("Choose from library", systemImage: "photo.on.rectangle")
                    }
                    Button { showingCamera = true } label: {
                        Label("Take photo", systemImage: "camera")
                    }
                }

                Section("Anything the photos don't show?") {
                    TextField("e.g. size M, worn twice, small mark on sleeve, asking around £20", text: $notes, axis: .vertical)
                        .lineLimit(3...6)
                }

                Section {
                    Button {
                        Task { await generate() }
                    } label: {
                        if isGenerating {
                            HStack {
                                ProgressView()
                                Text("Writing your listings…")
                            }
                        } else {
                            Label("Generate listings", systemImage: "sparkles")
                        }
                    }
                    .disabled(photos.isEmpty || isGenerating)
                } footer: {
                    Text("Listings are generated for eBay, Vinted, Gumtree and FB Marketplace. Nothing is posted anywhere until you choose to.")
                }
            }
            .navigationTitle("New item")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(isGenerating)
                }
            }
            .onChange(of: pickerItems) {
                Task {
                    for pickerItem in pickerItems {
                        if let data = try? await pickerItem.loadTransferable(type: Data.self),
                           let image = UIImage(data: data) {
                            photos.append(image)
                        }
                    }
                    pickerItems = []
                }
            }
            .fullScreenCover(isPresented: $showingCamera) {
                CameraPicker { image in photos.append(image) }
                    .ignoresSafeArea()
            }
            .alert("Couldn't generate listings", isPresented: .init(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(errorMessage ?? "")
            }
            .interactiveDismissDisabled(isGenerating)
        }
    }

    private func generate() async {
        isGenerating = true
        defer { isGenerating = false }
        do {
            let response = try await APIClient.generateListings(photos: photos, notes: notes)
            let photosData = photos.compactMap { $0.resized(maxDimension: 1600).jpegData(compressionQuality: 0.8) }
            let item = Item(title: response.title, summary: response.summary, photosData: photosData)
            modelContext.insert(item)
            for generated in response.listings {
                guard let platform = Platform(rawValue: generated.platform) else { continue }
                let listing = PlatformListing(
                    platform: platform,
                    fields: generated.fields,
                    ebayDraft: platform == .ebay ? response.ebayDraft : nil
                )
                listing.item = item
                item.listings.append(listing)
            }
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
