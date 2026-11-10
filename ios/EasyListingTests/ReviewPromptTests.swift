import Testing
@testable import EasyListing

@Suite("Review prompt")
struct ReviewPromptTests {
    @Test("a live eBay post earns the ask on its own")
    func ebayPostQualifies() {
        #expect(ReviewPrompt.shouldAsk(readyItems: 0, postedToEbay: true, currentVersion: "1.0", lastAskedVersion: nil))
    }

    @Test("finished items qualify only from the threshold")
    func readyItemsThreshold() {
        let below = ReviewPrompt.readyItemsThreshold - 1
        #expect(!ReviewPrompt.shouldAsk(readyItems: below, postedToEbay: false, currentVersion: "1.0", lastAskedVersion: nil))
        #expect(ReviewPrompt.shouldAsk(readyItems: below + 1, postedToEbay: false, currentVersion: "1.0", lastAskedVersion: nil))
    }

    @Test("asks at most once per version, and again after an update")
    func oncePerVersion() {
        #expect(!ReviewPrompt.shouldAsk(readyItems: 10, postedToEbay: true, currentVersion: "1.0", lastAskedVersion: "1.0"))
        #expect(ReviewPrompt.shouldAsk(readyItems: 10, postedToEbay: true, currentVersion: "1.1", lastAskedVersion: "1.0"))
    }
}
