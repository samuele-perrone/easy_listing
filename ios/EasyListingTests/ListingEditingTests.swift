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
