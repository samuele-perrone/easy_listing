import SwiftUI
import UIKit

/// Camera for item photos: shoot as many as you need, then tap Done.
///
/// The system camera controls confirm every single shot ("Use Photo" / "Retake")
/// and hand back one image, which for an item that needs a label, a sole and two
/// angles means leaving and re-entering the camera four times. Selling something
/// is a burst of photos of one object, so the controls are replaced with a
/// shutter that keeps shooting and a Done button that closes up.
///
/// Shots are also copied to the camera roll, because the other three
/// marketplaces are a copy-paste flow — the photos have to be uploadable from
/// the phone's own library later.
struct CameraPicker: UIViewControllerRepresentable {
    var onCapture: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.delegate = context.coordinator

        guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
            // No camera (simulator, or a device that won't give us one): fall
            // back to the stock library picker rather than a blank screen.
            picker.sourceType = .photoLibrary
            return picker
        }

        picker.sourceType = .camera
        // Our own controls, so a capture doesn't interrupt with a confirm step.
        picker.showsCameraControls = false

        let overlay = CameraOverlayView()
        overlay.onShutter = { [weak picker] in picker?.takePicture() }
        overlay.onDone = { context.coordinator.finish() }
        overlay.onCancel = { context.coordinator.finish() }
        context.coordinator.overlay = overlay

        picker.cameraOverlayView = overlay
        overlay.frame = picker.view.bounds
        overlay.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        weak var overlay: CameraOverlayView?
        private var taken = 0

        init(_ parent: CameraPicker) { self.parent = parent }

        func finish() { parent.dismiss() }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            guard let image = info[.originalImage] as? UIImage else {
                parent.dismiss()
                return
            }

            parent.onCapture(image)

            // Only camera shots need saving — anything picked from the library
            // is already there, and re-saving would duplicate it.
            if picker.sourceType == .camera {
                UIImageWriteToSavedPhotosAlbum(image, nil, nil, nil)
                taken += 1
                overlay?.setCount(taken)
                // Deliberately no dismiss: staying put is what makes the next
                // shot one tap instead of five.
                return
            }

            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.dismiss()
        }
    }
}

/// Shutter, Done and a running count, over the live camera.
final class CameraOverlayView: UIView {
    var onShutter: () -> Void = {}
    var onDone: () -> Void = {}
    var onCancel: () -> Void = {}

    private let countLabel = UILabel()
    private let doneButton = UIButton(type: .system)
    private var taken = 0

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        build()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    /// The overlay covers the live preview, so only the controls should catch
    /// taps — anywhere else must fall through to the camera.
    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
        subviews.contains { !$0.isHidden && $0.frame.contains(point) }
    }

    func setCount(_ count: Int) {
        taken = count
        countLabel.text = count == 1 ? "1 photo" : "\(count) photos"
        countLabel.isHidden = count == 0
        doneButton.configuration?.title = count == 0 ? "Cancel" : "Done"
    }

    private func build() {
        let shutter = UIButton(type: .custom)
        shutter.backgroundColor = .white
        shutter.layer.cornerRadius = 36
        shutter.layer.borderWidth = 4
        shutter.layer.borderColor = UIColor.white.withAlphaComponent(0.55).cgColor
        shutter.accessibilityLabel = "Take photo"
        shutter.addAction(UIAction { [weak self] _ in self?.onShutter() }, for: .touchUpInside)

        var config = UIButton.Configuration.filled()
        config.title = "Cancel"
        config.baseBackgroundColor = UIColor.black.withAlphaComponent(0.45)
        config.baseForegroundColor = .white
        config.cornerStyle = .capsule
        config.contentInsets = NSDirectionalEdgeInsets(top: 8, leading: 18, bottom: 8, trailing: 18)
        doneButton.configuration = config
        doneButton.addAction(UIAction { [weak self] _ in
            guard let self else { return }
            // Nothing is ever discarded — every shot was handed over as it was
            // taken — so both words mean "close the camera".
            self.taken > 0 ? self.onDone() : self.onCancel()
        }, for: .touchUpInside)

        countLabel.textColor = .white
        countLabel.font = .systemFont(ofSize: 15, weight: .medium)
        countLabel.textAlignment = .center
        countLabel.isHidden = true
        countLabel.layer.shadowColor = UIColor.black.cgColor
        countLabel.layer.shadowOpacity = 0.6
        countLabel.layer.shadowRadius = 3
        countLabel.layer.shadowOffset = .zero

        for view in [shutter, doneButton, countLabel] {
            view.translatesAutoresizingMaskIntoConstraints = false
            addSubview(view)
        }

        NSLayoutConstraint.activate([
            shutter.centerXAnchor.constraint(equalTo: centerXAnchor),
            shutter.bottomAnchor.constraint(equalTo: safeAreaLayoutGuide.bottomAnchor, constant: -28),
            shutter.widthAnchor.constraint(equalToConstant: 72),
            shutter.heightAnchor.constraint(equalToConstant: 72),

            doneButton.centerYAnchor.constraint(equalTo: shutter.centerYAnchor),
            doneButton.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -24),

            countLabel.centerXAnchor.constraint(equalTo: centerXAnchor),
            countLabel.bottomAnchor.constraint(equalTo: shutter.topAnchor, constant: -14),
        ])
    }
}
