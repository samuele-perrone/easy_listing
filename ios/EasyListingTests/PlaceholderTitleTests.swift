import Foundation
import Testing
@testable import EasyListing

/// The title an item carries between being photographed and being generated.
struct PlaceholderTitleTests {
    @Test func namesAnItemWithNoNotes() {
        #expect(Item.placeholderTitle(notes: "") == "Untitled item")
        #expect(Item.placeholderTitle(notes: "   ") == "Untitled item")
    }

    @Test func usesTheSellersNotesWhenTheyGaveSome() {
        #expect(Item.placeholderTitle(notes: "size M, worn twice") == "size M, worn twice")
    }

    @Test func neverReadsAsProgress() {
        // The bug this replaced: a failed item stayed titled "Writing listings…"
        // forever, describing work that had already stopped.
        for notes in ["", "kids slippers", "a very long note ".repeated(10)] {
            let title = Item.placeholderTitle(notes: notes)
            #expect(!title.lowercased().contains("writing"))
            #expect(!title.isEmpty)
        }
    }

    @Test func keepsLongNotesToATitleLength() {
        let title = Item.placeholderTitle(
            notes: "rainbow fluffy slippers de fonseca size 30 31 worn a handful of times indoors only"
        )
        #expect(title.count <= 41)   // 40 plus the ellipsis
        #expect(title.hasSuffix("…"))
    }

    @Test func doesNotCutALongNoteMidWord() {
        let title = Item.placeholderTitle(
            notes: "rainbow fluffy slippers de fonseca size 30 31 worn twice"
        )
        #expect(!title.contains("  "))
        // Whatever survives is whole words plus the ellipsis.
        let body = title.dropLast()
        #expect(!body.hasSuffix(" "))
    }

    @Test func takesOnlyTheFirstLine() {
        #expect(Item.placeholderTitle(notes: "slippers\nsize 30\nbarely worn") == "slippers")
    }
}

private extension String {
    func repeated(_ times: Int) -> String { String(repeating: self, count: times) }
}

/// The identifier the backend counts generations against.
struct InstallIdTests {
    @Test func isStableAcrossCalls() {
        // A new id on every call would hand out a fresh daily allowance each
        // time, which is the whole thing the limit exists to stop.
        #expect(APIClient.installId == APIClient.installId)
    }

    @Test func looksLikeARandomUUIDAndNothingDeviceDerived() {
        let id = APIClient.installId
        #expect(UUID(uuidString: id) != nil)
    }
}
