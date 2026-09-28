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
    @State private var generateError: APIClient.APIError?

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
            .errorAlert($generateError, title: "Couldn't generate listings")
            .interactiveDismissDisabled(isGenerating)
        }
    }

    private func generate() async {
        // `.disabled(isGenerating)` only takes effect on the next render, so two
        // taps in the same frame both get here and each saves its own item.
        // Checking and setting on the main actor with no await between closes it.
        guard !isGenerating else { return }
        isGenerating = true
        defer { isGenerating = false }

        // Save the item with its photos *first*. Generation can fail — the free
        // tier runs out, the provider gets busy — and losing the photos to that
        // means re-shooting the item. Now a failure is a Retry in the list.
        let photosData = photos.compactMap { $0.resized(maxDimension: 1600).jpegData(compressionQuality: 0.8) }
        let item = Item(
            title: Item.placeholderTitle(notes: notes),
            summary: "",
            photosData: photosData,
            notes: notes,
            state: .pending
        )
        modelContext.insert(item)
        try? modelContext.save()

        await GenerationCoordinator.shared.requestNotificationPermissionIfNeeded()

        // Hand off and close: the work carries on whether or not this screen,
        // or the app, is still open.
        let captured = photos
        let context = modelContext
        Task { await GenerationCoordinator.shared.start(item: item, photos: captured, context: context) }

        dismiss()
    }
}
