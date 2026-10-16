import Testing
import Foundation
@testable import EasyListing

/// The edits a seller makes on screen have to reach the eBay payload — otherwise
/// the listing that goes live differs from the one they approved.
@Suite("Editing a listing")
struct ListingEditingTests {
    private func listing(
        fields: [ListingField],
        draft: EbayDraft? = EbayDraft(
            title: "Original title",
            description: "Original description",
            condition: "USED_VERY_GOOD",
            price: 9.99,
            currency: "GBP",
            categoryQuery: "original category"
        )
    ) -> PlatformListing {
        PlatformListing(platform: .ebay, fields: fields, ebayDraft: draft)
    }

    @Test("an edited field replaces its value and leaves the others alone")
    func updatesOneField() {
        let subject = listing(fields: [
            ListingField(label: "Title", value: "Before"),
            ListingField(label: "Price", value: "9.99"),
        ])

        subject.updateField(label: "Title", to: "After")

        #expect(subject.fields.first { $0.label == "Title" }?.value == "After")
        #expect(subject.fields.first { $0.label == "Price" }?.value == "9.99")
    }

    @Test("editing an unknown field changes nothing")
    func ignoresUnknownField() {
        let subject = listing(fields: [ListingField(label: "Title", value: "Before")])

        subject.updateField(label: "Nonexistent", to: "Whatever")

        #expect(subject.fields.count == 1)
        #expect(subject.fields[0].value == "Before")
    }

    @Test("edits flow into the eBay payload")
    func editsReachTheDraft() {
        let subject = listing(fields: [
            ListingField(label: "Title", value: "Edited title"),
            ListingField(label: "Description", value: "Edited description"),
            ListingField(label: "Condition", value: "USED_EXCELLENT"),
            ListingField(label: "Price", value: "24.50"),
            ListingField(label: "Category", value: "edited category"),
        ])

        let draft = subject.editedEbayDraft

        #expect(draft?.title == "Edited title")
        #expect(draft?.description == "Edited description")
        #expect(draft?.condition == "USED_EXCELLENT")
        #expect(draft?.price == 24.50)
        #expect(draft?.categoryQuery == "edited category")
    }

    @Test("a price keeps its number when it carries a currency symbol", arguments: [
        ("£24.50", 24.50), ("24.50", 24.50), ("  19.99  ", 19.99), ("$5", 5.0),
    ])
    func parsesPrice(written: String, expected: Double) {
        let subject = listing(fields: [ListingField(label: "Price", value: written)])
        #expect(subject.editedEbayDraft?.price == expected)
    }

    @Test("an unparseable price keeps the original rather than becoming zero")
    func keepsPriceWhenUnparseable() {
        let subject = listing(fields: [ListingField(label: "Price", value: "ask me")])
        #expect(subject.editedEbayDraft?.price == 9.99)
    }

    @Test("Currency and Category aren't confused for each other")
    func distinguishesSimilarLabels() {
        let subject = listing(fields: [
            ListingField(label: "Currency", value: "USD"),
            ListingField(label: "Category suggestion", value: "watch straps"),
        ])

        let draft = subject.editedEbayDraft

        #expect(draft?.currency == "USD")
        #expect(draft?.categoryQuery == "watch straps")
    }

    @Test("a listing with no eBay payload has nothing to edit into")
    func noDraftMeansNoEditedDraft() {
        let subject = listing(fields: [ListingField(label: "Title", value: "x")], draft: nil)
        #expect(subject.editedEbayDraft == nil)
    }

    // The visible Condition field carries eBay's human wording, not its API
    // enum. Letting it overwrite the enum sent "Used" to eBay, which answers
    // 2004 "Could not serialize field [condition]" and fails the listing.
    @Test("the displayed condition label doesn't overwrite the API enum", arguments: [
        "Used", "Very good", "Used - like new", "Good", "",
    ])
    func keepsEnumWhenFieldHoldsALabel(displayed: String) {
        let subject = listing(fields: [ListingField(label: "Condition", value: displayed)])
        #expect(subject.editedEbayDraft?.condition == "USED_VERY_GOOD")
    }

    @Test("a condition picked from the picker still reaches the payload", arguments: [
        "USED_EXCELLENT", "NEW", "FOR_PARTS_OR_NOT_WORKING", "LIKE_NEW",
    ])
    func pickedConditionReachesTheDraft(picked: String) {
        let subject = listing(fields: [ListingField(label: "Condition", value: picked)])
        #expect(subject.editedEbayDraft?.condition == picked)
    }

    @Test("every picker option is one the payload accepts")
    func pickerOptionsAllResolve() {
        for option in EbayDraft.conditionEnums {
            #expect(EbayDraft.resolvedCondition(option) == option)
        }
    }
}

/// Posting runs on the server, so the listing has to carry enough state for the
/// app to be closed and reopened mid-post.
@Suite("Background eBay posting")
struct EbayPostingStateTests {
    private func listing() -> PlatformListing {
        PlatformListing(
            platform: .ebay,
            fields: [ListingField(label: "Title", value: "A thing")],
            ebayDraft: EbayDraft(
                title: "A thing", description: "d", condition: "USED_EXCELLENT",
                price: 9.99, currency: "GBP", categoryQuery: "thing"
            )
        )
    }

    // `isPosting` reads main-actor state, so these two run there.
    @Test("a fresh listing is not mid-post")
    @MainActor
    func startsIdle() {
        let subject = listing()
        #expect(subject.ebayJobId == nil)
        #expect(EbayPostCoordinator.shared.isPosting(subject) == false)
    }

    @Test("a job id marks it as posting, and survives being read back")
    @MainActor
    func jobIdMarksPosting() {
        let subject = listing()
        subject.ebayJobId = "job-1"
        #expect(EbayPostCoordinator.shared.isPosting(subject))
    }

    @Test("a failure that arrived while the app was shut is kept, not lost")
    func failureSurvivesClosing() {
        // The alert can't fire if nobody is looking, so the reason lives on the
        // listing until the seller next opens it.
        let subject = listing()
        subject.postError = "eBay wouldn't accept this listing as written."
        subject.postFix = "Edit the Title and try again."

        #expect(subject.postError != nil)
        #expect(subject.postFix?.contains("Title") == true)
    }

    @Test("status still distinguishes a draft from a live listing")
    func draftVersusPosted() {
        let draft = listing()
        draft.status = .drafted
        #expect(draft.status == .drafted)

        let posted = listing()
        posted.status = .posted
        posted.postedURL = "https://www.ebay.co.uk/itm/1"
        #expect(posted.status == .posted)
        #expect(posted.postedURL != nil)
    }
}
