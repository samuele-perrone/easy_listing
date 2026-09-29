import XCTest

/// Captures the App Store screenshots.
///
/// Run against whichever simulator matches the size Apple wants:
///
///     xcodebuild test -project EasyListing.xcodeproj -scheme Screenshots \
///       -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max' \
///       -resultBundlePath ./build/screenshots.xcresult
///
/// then pull the PNGs out of the result bundle with `xcrun xcresulttool`.
///
/// The app is launched with `-seedScreenshotData`, which fills an empty store
/// with sample items. Driving the real generate flow instead would need a
/// network call, a paid model and a slice of the daily allowance, for pictures
/// that would look the same.
final class ScreenshotTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testCaptureAppStoreScreenshots() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-seedScreenshotData"]
        app.launch()

        // 1. The history list — the app with a few items already in it.
        XCTAssertTrue(app.staticTexts["Easy Listing"].waitForExistence(timeout: 10))
        capture(app, named: "01-history")

        // 2. An item, which opens on the recommended platform and shows the
        //    ranking card. This is the screenshot that has to earn the install.
        let bike = app.staticTexts["Verve Summer 12\" Girls Bike - Pink"]
        XCTAssertTrue(bike.waitForExistence(timeout: 5))
        bike.tap()
        XCTAssertTrue(app.staticTexts["Where to sell"].waitForExistence(timeout: 5))
        capture(app, named: "02-where-to-sell")

        // 3. The listing itself, scrolled to the written fields.
        app.swipeUp()
        capture(app, named: "03-listing-fields")

        // 4. A second item, to show the ranking reaching a different answer —
        //    small and postable goes to Vinted, where the bike went local.
        app.navigationBars.buttons.firstMatch.tap()
        let slippers = app.staticTexts["De Fonseca rainbow slippers, size 28"]
        XCTAssertTrue(slippers.waitForExistence(timeout: 5))
        slippers.tap()
        XCTAssertTrue(app.staticTexts["Where to sell"].waitForExistence(timeout: 5))
        capture(app, named: "04-different-item")

        // 5. The input side: how little the app asks for.
        app.navigationBars.buttons.firstMatch.tap()
        app.buttons["Add"].firstMatch.tap()
        _ = app.staticTexts["Photos"].waitForExistence(timeout: 5)
        capture(app, named: "05-new-item")
    }

    /// Full-screen grab, attached to the result bundle so it survives the run.
    private func capture(_ app: XCUIApplication, named name: String) {
        let screenshot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
