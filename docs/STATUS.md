# Status — as of 27 August 2026

Where the project stands, what's left, and the non-obvious things already solved.

---

## Working end to end

- **Listing generation.** Photos + optional notes → complete field sets for eBay, Vinted, Gumtree and FB Marketplace. Verified against the live backend. Output respects each platform's own vocabulary (eBay condition enums, Vinted's "Very good" scale, FB's "Used - like new") and inserts `[CHECK: ...]` placeholders rather than inventing details it can't see.
- **iOS app.** Installed and running on a physical iPhone 17 Pro. Camera and library import, history via SwiftData, per-platform tap-to-copy cards, deep links into the other marketplaces' apps.
- **eBay OAuth.** Connects, stores tokens in the Keychain, refreshes them.
- **eBay listing, end to end.** ✅ **A real listing was published live on the production account on 27 Aug 2026** (an Apple Watch Sport Band). The full chain works: inventory item → category → category-valid condition → required item specifics → business policies → merchant location → offer → publish.
- **Editing generated fields.** Every field is editable in-app before posting; eBay's condition uses a picker of valid enums. Edits feed the eBay payload, so what's on screen is what gets listed.

## Not finished

- **`Post to eBay` publishes immediately.** There's no way to correct a live listing from the app — you'd end it in Seller Hub. Drafts are the safe path.
- **Item specifics are model-chosen.** Required aspects are filled by an AI call at listing time and aren't shown for review before posting. Surfacing them in the app for confirmation would be a sensible next step.
- **No tests.** Everything so far has been verified by hand against live services.

---

## Decisions worth remembering

**Only eBay gets API posting.** Vinted, Gumtree and FB Marketplace have no public seller API, and automating them violates their terms and risks account bans. The deliberate design is: generate every field, then a guided copy-paste flow. This was chosen explicitly, not by omission.

**Model provider is resolved at runtime** in `backend/app/api/generate/route.ts`, in this order: `ANTHROPIC_API_KEY` → `GOOGLE_GENERATIVE_AI_API_KEY` → Vercel AI Gateway. The gateway was the original design but its free tier blocks *every* model, including ones tagged free — hence the direct-provider fallbacks.

**eBay tokens live only on the device**, in the iOS Keychain. The server never persists them; the app sends the access token with each request. This is also what the privacy policy claims, so keep it true.

**Photos are budgeted before upload.** Vercel rejects request bodies over 4.5 MB (measured: 4 MB passes, 4.5 MB returns 413). `APIClient.encodedImages` steps resolution and quality down until the encoded set fits in 3 MB.

---

## eBay gotchas already solved

Each of these cost a debugging round trip. They are all fixed, but the reasoning is worth keeping.

| Symptom | Cause | Fix |
|---|---|---|
| Keyset disabled, no RuName anywhere | eBay disables production keysets until you implement their account-deletion webhook | `app/api/ebay/deletion/route.ts` — GET returns `sha256(challengeCode + verificationToken + endpointURL)` |
| `25709 Invalid value for header Accept-Language` | Node's `fetch` sends `accept-language: *` by default, which eBay rejects. We never set the header. | `ebayHeaders()` sets it explicitly from the marketplace |
| `25001 Core Inventory Service internal error` | Transient eBay fault | Retry once after 1.5s |
| `1100 Insufficient permissions` on taxonomy | The Taxonomy API needs eBay's **base** scope, which the seller token doesn't carry | Mint a client-credentials application token instead of re-prompting the seller |
| `20403 User is not eligible for Business Policy` | Account not enrolled in the Business Policies programme | `ensureBusinessPoliciesOptIn()` enrols via the Account API |
| `No <Item.Country>` when publishing | The offer has no merchant location | `ensureInventoryLocation()`, attached as `merchantLocationKey` |
| `25802 Input error` creating a location | The address had only `country`; eBay needs a postcode for UK locations | Set `EBAY_LOCATION_POSTCODE` |
| `25012 Invalid inventory location. Enter a full UK postcode` | A **partial** postcode (outward code only) is rejected at publish time, and `ensureInventoryLocation` reused the bad location instead of correcting it | Use the full postcode; the function now reconciles an existing location's postcode via `update_location_details` |
| `25021 The provided condition id is invalid for the selected primary category id` | The granular used grades (`USED_VERY_GOOD` = 4000, `USED_GOOD`, `USED_ACCEPTABLE`) are **media-only**; most categories accept only `USED_EXCELLENT` ("Used"). The model picked one freely, and the condition was set on the inventory item *before* the category was known. | `createListing` now resolves the category first, then `supportedCondition()` checks `get_item_condition_policies` and degrades to the nearest accepted grade |
| The same 25021 **after** that fix shipped | eBay's filter syntax `categoryIds:{123}` needs the braces **percent-encoded**; unencoded, the lookup 4xx'd and the code silently returned the original condition | Encode as `%7B…%7D`; log lookup failures instead of swallowing them, and degrade media-only grades to `USED_EXCELLENT` when the policy can't be read |
| `25002 The item specific Type is missing` | Categories require their own item specifics (aspects), which vary per category and so can't be generated up front — the category isn't known until listing time | `requiredAspects()` fetches them, `chooseAspectValues()` (in `lib/aspects.ts`) has the model fill them from the listing text, constrained to eBay's allowed values |

Two eBay-side setup steps that are done and shouldn't need repeating: the seller account is **enrolled in Business Policies**, and **one policy of each type** (postage, payment, returns) exists.

---

## Environment traps

- **Deploy from the repo root**, never from `backend/`. Vercel's configured root directory is already `backend`, so deploying from inside it creates a stray project named `backend`. This happened twice; both were deleted.
- **Vercel returns `[SENSITIVE]` placeholders** for sensitive env vars, so `vercel env pull` can't be used to test with real credentials locally.
- **Env changes need a redeploy**, and the deploy must be created *after* the change. One redeploy raced an env update and silently used the old value.
- **`vercel project rm` is interactive** and ignores `--yes`. Piping `yes |` into it loops forever — use the REST API to delete a project.

## iOS build notes

- **Signing:** team `7RYYQ8M5X5`, set as `DEVELOPMENT_TEAM` in `ios/project.yml`.
- **Installs fail while the phone is locked** (`kAMDMobileImageMounterDeviceLocked`). Unlock first; disabling auto-lock helps.
- **First launch needs the certificate trusted** at Settings → General → VPN & Device Management.
- **Free personal signing expires after 7 days.** When the app stops opening, rebuild and reinstall — history survives, since SwiftData is on-device.
- `EasyListing.xcodeproj` is gitignored; run `xcodegen generate` after cloning.

---

## Ideas not yet built

- Bulk mode: several items in one session.
- Price research: check eBay sold listings for a realistic figure rather than the model's estimate.
- Marking an item as sold, and tracking which platform sold it.
- Tests around `lib/ebay.ts` — the error paths are intricate and all hand-verified so far.

---

## TestFlight distribution

Set up on 27 Aug 2026 to escape the 7-day free-signing expiry. Archive verified building with icon, version, and encryption declaration.

**Blocked on:** Apple Developer Program enrolment (£79/yr) — nothing else is missing.

Once enrolled: create the app in App Store Connect with bundle ID `com.samperrone.easylisting`, generate an App Store Connect API key, then `cd ios && ./release.sh`. The script archives, exports, and uploads; TestFlight builds last **90 days**.

Bump `CURRENT_PROJECT_VERSION` in `ios/project.yml` before each upload — App Store Connect rejects a duplicate build number.

**A public App Store release is a different project**, not a packaging step: the backend uses a single Anthropic key, so every user's generation would bill to the developer. That needs per-user billing (or per-user keys) first, and eBay may require review before a distributed app uses their API.
