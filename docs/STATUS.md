# Status — as of 23 September 2026

Where the project stands, what's left, and the non-obvious things already solved.

---

## Running the tests

    cd backend && npm test          # 71 tests — error translation, condition fallbacks, eBay title fitting, market-fit ranking, provider backoff and chain
    cd ios && xcodebuild test -project EasyListing.xcodeproj -scheme EasyListing \
      -destination 'platform=iOS Simulator,name=iPhone 17 Pro'   # 17 tests

`npm run deploy` (from `backend/`) runs typecheck and tests before deploying.

---

## Working end to end

- **Listing generation.** Photos + optional notes → complete field sets for eBay, Vinted, Gumtree and FB Marketplace. Verified against the live backend. Output respects each platform's own vocabulary (eBay condition enums, Vinted's "Very good" scale, FB's "Used - like new") and inserts `[CHECK: ...]` placeholders rather than inventing details it can't see.
- **iOS app.** Installed and running on a physical iPhone 17 Pro. Camera and library import, history via SwiftData, per-platform tap-to-copy cards, deep links into the other marketplaces' apps.
- **eBay OAuth.** Connects, stores tokens in the Keychain, refreshes them.
- **eBay listing, end to end.** ✅ **A real listing was published live on the production account on 27 Aug 2026** (an Apple Watch Sport Band). The full chain works: inventory item → category → category-valid condition → required item specifics → business policies → merchant location → offer → publish.
- **Editing generated fields.** Every field is editable in-app before posting; eBay's condition uses a picker of valid enums. Edits feed the eBay payload, so what's on screen is what gets listed.
- **Readable errors.** eBay's numeric failures are translated into what went wrong and what to do (`lib/ebayErrors.ts`). The raw payload is kept out of the alert and attached to an "Email support" action instead.

## Generation runs as a background job

Since 28 Sep 2026 the app doesn't wait on an HTTP request for its listings.

- `POST /api/generate/start` → `{ jobId }` immediately (202), work continues under `waitUntil`.
- `GET /api/generate/status/<jobId>` → `pending` | `ready` (with `result`) | `failed` (with `error`/`fix`).
- `POST /api/generate` is **unchanged and still live**, because builds already on phones call it. Both share `lib/generate.ts`.

Why: the old shape made the phone hold a connection open for as long as the provider took, and connections past ~60s were being cut. The seller saw *"The network connection was lost"* — and lost their photos with it, since the item was only created on success.

**The item is now saved with its photos before generation starts.** A failure leaves an item in the list marked failed, with a Retry that needs nothing from the seller. Closing the app is safe too: the job id is on the item, and `GenerationCoordinator.resumePendingWork()` picks it back up on next launch. A **local notification** fires when a job finishes while the app isn't in the foreground — local, so there's no APNs key, no device tokens on the server, and no change to what the privacy policy claims.

Job state lives in Vercel Blob under `jobs/<uuid>.json`. It's written `access: 'public'` because the attached store is public — it has to be, since eBay fetches listing photos from it by URL — and a second private store would mean a second token next to `BLOB_READ_WRITE_TOKEN`, with a real chance of clobbering the one the photo upload needs. The trade is acceptable *for this content specifically*: a job holds a draft of a listing the seller is about to publish publicly, under a random UUID, with no credentials and nothing about the seller. Put anything genuinely private in its own store instead.

**The job path and the synchronous route get different budgets, and it matters.** `generateListings` takes `budgetMs`/`perCallTimeoutMs`; the job route passes 240s/90s, the synchronous route keeps the short defaults (50s/35s). Those short numbers exist for one reason — the synchronous route holds a connection open, and connections past ~60s were being cut. A job holds nothing, so its only real ceiling is `maxDuration`.

Inheriting the short budget broke the paid fallback in a way that looked like the provider's fault: the chain correctly fell through to `claude-sonnet-5`, which then hit the 35s per-call cap and reported `TimeoutError`. That cap had been measured against Gemini Flash (14–25s); Sonnet with four images and a full four-platform response takes longer. Verified after the change: a complete result in 104s, having gone through two out-of-quota models and an overloaded third first. **Any per-call timeout here is a measurement, not a preference — re-measure it when the model or the schema changes.**

**Job state is read over the CDN, never through the Blob SDK.** This cost a real outage on 28 Sep: `readJob` used `get(..., { useCache: false })` so a finished job could never be served as stale "pending", but that made every poll a Blob *API* call, and the API rate-limits. With the app polling every three seconds the reads began returning `403 Forbidden`; the app treats a failed poll as "not finished yet" and kept waiting, so it sat on a spinner **while a completed listing was already sitting in the store**. Freshness now comes from `cacheControlMaxAge: 0` on the write instead, and reads are a plain `fetch` of the public URL at `BLOB_PUBLIC_HOST`.

The CDN rate-limits too, just far later — hammered back to back, about a third of reads 403'd, while the app's own three-second cadence never did. `readJob` retries three times over ~750ms, which took a 30-poll burst from 19/30 succeeding to 30/30. If the Blob store is ever replaced, `BLOB_PUBLIC_HOST` must be updated or every poll 404s.

Known housekeeping: job blobs are never deleted. They're small JSON, but they accumulate.

Verified live end to end on 28 Sep: start → 202 with a job id, four `pending` polls, then a terminal state carrying the seller-facing `error`/`fix`. The terminal state was a *failure*, because the free tier was exhausted — so the plumbing is proven and a successful payload through the job path still hasn't been seen.

## Camera

Photos are taken with a **custom overlay** on `UIImagePickerController` (`showsCameraControls = false`), not the system controls. The stock camera confirms every shot with "Use Photo" / "Retake" and returns a single image, so photographing one item from four angles meant entering and leaving the camera four times. The overlay is a shutter that keeps shooting, a running count, and a Done button.

Two details the next reader shouldn't undo:

- **The delegate deliberately does not dismiss** after a camera capture. Staying put is the whole feature. It still dismisses for the library fallback, which returns one image.
- **`point(inside:)` is overridden** so the overlay only catches taps on its own controls; everything else must fall through to the live preview, or focus and zoom stop working.

Camera shots are copied to the camera roll with `UIImageWriteToSavedPhotosAlbum`, which needs `NSPhotoLibraryAddUsageDescription` — without that key the app crashes on the first save rather than showing a prompt. Library picks aren't re-saved; they're already there. The point is the copy-paste flow: Vinted, Gumtree and Facebook have no API, so the photos must be uploadable from the phone's own library later.

## Verified live

**The whole chain worked end to end on 28 Sep 2026**, through the background job, with the recommendation: `start` → job id → polls → `ready`, carrying a full four-platform listing and a `marketFit` ranking. For a pair of kids' barefoot shoes it put **Vinted first at £7–10** ("parents actively hunt for budget-friendly barefoot and school shoes with low postage costs"), eBay second at £8–12 noting fees and postage eat a low-value item, then Facebook and Gumtree at £5–8. The ranking reads like someone who has actually sold things, and eBay being ranked *below* a lower headline price is the fees-and-postage reasoning working rather than a bug.

Notably it succeeded on `gemini-3.5-flash-lite`'s **third retry** after two "high demand" refusals — the backoff in `lib/backoff.ts` earning its place, on a request that would have failed outright before it existed.

## Superseded notes

- **Marketplace recommendation (`marketFit`).** Ranks all four platforms by what the item should fetch, with a GBP range and a one-line reason each, plus a `bestPlatform` and a summary. Backend: `marketFitSchema` in `lib/schema.ts`, tidied by `normaliseMarketFit()` (`lib/marketFit.ts`, 10 tests). iOS: `MarketFitView` card above the platform picker, a ★ on the recommended tab, and the detail screen now opens on the recommended platform instead of always eBay. Built and compiling (simulator build green), but **no live generation has returned a `marketFit` payload yet** — every attempt on 28 Sep hit the free tier being out of quota on two models and overloaded on the third. The shape is covered by unit tests; the model's actual output is not yet eyeballed.

  The estimates are the model's read of the photos, not sold-price data, and the UI says so. Making them real means the eBay sold-listings work in "Ideas not yet built" below.

## Not finished

- **`Post to eBay` publishes immediately.** There's no way to correct a live listing from the app — you'd end it in Seller Hub. Drafts are the safe path.
- **Item specifics are model-chosen.** Required aspects are filled by an AI call at listing time and aren't shown for review before posting. Surfacing them in the app for confirmation would be a sensible next step.
- **Xcode Cloud is set up but unverified.** The workflow exists and `ci_scripts/ci_post_clone.sh` is in place; no build has been confirmed green yet. Note the `.xcodeproj` is now **committed** — Xcode Cloud validates the workflow's project reference before running the post-clone script, so generating it there was too late for the build to start at all. `project.yml` remains the source of truth; run `xcodegen generate` and commit the result after changing it.
- **Provider ceiling.** 60 free generations a day (three models × 20), shared across every install. Fine for one seller; not enough for testers, and nowhere near a public release. `lib/backoff.ts` absorbs capacity blips and the chain routes around a model that's out, but nothing raises the ceiling except a paid key.
- ~~**Long requests sometimes lose the connection.**~~ **Explained 25 Sep 2026.** The drops (measured at 60.41s, 60.37s, 60.37s, and twice at ~120s) were the client giving up while the function sat in a provider call that never returned — see the 300s timeout row in the gotchas table. With a per-call timeout in place, requests now complete in 15–18s and none have dropped. The budget is also capped under a minute now, because requests that ran past ~60s mostly didn't survive to answer.
- **Test coverage is partial.** 88 tests cover the pure logic — field editing, price parsing, condition fallbacks, error translation. Anything touching eBay or the model is still verified by hand, since it needs live credentials.

---

## Decisions worth remembering

**Only eBay gets API posting.** Vinted, Gumtree and FB Marketplace have no public seller API, and automating them violates their terms and risks account bans. The deliberate design is: generate every field, then a guided copy-paste flow. This was chosen explicitly, not by omission.

**Providers are a fallback chain, cheapest first** — `resolveModelChain()` in `backend/lib/model.ts`, walked by `runWithProviders()` in `lib/provider.ts`. Gemini (free) serves the request; Anthropic (paid) picks up only what the free tier refused — no capacity, or past its 20/day cap. With one key configured the chain has one entry and behaves like the old single-provider path. The Vercel AI Gateway is used only when neither direct key is set; its free tier blocks *every* model, including ones tagged free.

**This reverses the original precedence**, which put Anthropic first for quality. The free tier's limits (below) made "best model first" mean "pay for everything", and the useful arrangement is the opposite: free by default, paid for the overflow. Cost tracks the free tier's failures rather than traffic.

Three details worth keeping:

- **Every provider call needs a hard timeout.** The budget alone can't stop a call that has already started. Anything calling a model directly must pass `abortSignal` or it can run to `maxDuration`.

- **The budget is shared across the chain**, each provider taking an equal slice of what remains and the last taking the rest. A quota rejection costs ~1s and hands almost the whole budget to the fallback; a slow overload can't eat the budget and leave the fallback no room.
- **Only failures the *provider* returned fall through.** A `TypeError` from our own prompt building stops there — the paid key would fail the same way and bill for it.

**Production runs on Gemini's free tier only** since 23 Sep 2026, across three free models since 25 Sep. Verified working end to end — a real request through the live endpoint returned schema-valid fields for all four platforms, with a flaw from the seller notes carried into the condition text. But it is **not reliable enough for anyone but you**: see the provider gotchas below for the 20-per-day cap and the sustained capacity failures. Both keys were configured, so the precedence above meant every generation silently billed to Anthropic; `ANTHROPIC_API_KEY` was removed from the production environment and `gemini-2.5-flash` took over. The code is unchanged — setting the key again reverts it. Two consequences worth remembering: the free tier's quota is **per project, shared by every install**, not per user; and free-tier terms let Google use submitted content to improve its services, which is why `/privacy` names Google and says so. `GENERATION_MODEL` is still `anthropic/claude-sonnet-5` but is only read in the unreachable AI Gateway branch.

---

## Model provider gotchas

| Symptom | Cause | Fix |
|---|---|---|
| `/api/generate` returns 500, log shows `404 NOT_FOUND … no longer available to new users` | Google retires Gemini model ids and 404s them for callers who hadn't used them before. `gemini-2.5-flash` was pinned as the default; Google's own error names the replacement. | Default is now `gemini-3.6-flash` in `lib/model.ts`; `GOOGLE_MODEL` overrides it. Don't pin an old id — read the 404's message, it tells you what to use. |
| `AI_RetryError: Failed after 3 attempts … This model is currently experiencing high demand` | Free-tier Gemini has no capacity guarantee. The AI SDK's own 3 retries happen within seconds, which is too short a window to ride out an overload. | `lib/backoff.ts` — model calls pass `maxRetries: 0` and retry through `withBackoff()` instead, waiting 2s → 6s → 15s → 30s (jittered) inside a budget |
| Every generation 500s after ~90s, log says `high demand` | Not a spike. Free-tier capacity for `gemini-3.6-flash` was unavailable for a sustained run — 0 of 5 requests succeeded, each having exhausted the full retry budget first | Nothing to fix in our code: backoff can't manufacture capacity. This is the argument for the fallback chain below |
| 429 `You exceeded your current quota` after ~20 generations | The free tier allows **20 generations per model, per project, per day** (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`, quotaValue `20`). Per *project*, so every install shares the pool — but per *model*, which is the way out | `GOOGLE_MODELS` lists several free models, each carrying its own 20/day. The route also detects exhaustion and answers in ~1s with "Today's listing generations have run out" instead of retrying for 90s |
| `AI_NoObjectGeneratedError: response did not match schema`, 500 to the app | `generateResultSchema` had `ebayDraft.title: z.string().max(80)`. A title **two characters** over ("…Size EU 26 UK 8.5", 82 chars) failed validation and the entire generation was discarded — a complete, accurate four-platform listing thrown away, with `finishReason: 'stop'` proving the model had finished cleanly | The limit is real but belongs in code, not a validator: `fitEbayTitle()` (`lib/ebayTitle.ts`) trims to 80 at a word boundary, applied in `/api/generate` and in `lib/ebay.ts` where a seller-edited title also passes. The schema no longer rejects on length |
| A schema miss failed the request outright — no retry, no fallthrough | `isProviderFailure()` only recognised `APICallError` and `RetryError`, so `NoObjectGeneratedError` skipped the chain entirely | Included now. A schema miss is sampling luck as much as anything, another model is a fair bet, and on the free chain it costs nothing |
| `Vercel Runtime Timeout Error: Task timed out after 300 seconds`, despite a 45s budget | **The budget was advisory.** `withBackoff` gates whether to *start* another attempt and cannot interrupt one in flight, and `generateText` has no timeout of its own — so a `gemini-3.5-flash` call that never came back held the request until `maxDuration` killed it | `PER_CALL_TIMEOUT_MS` (25s) with a fresh `AbortSignal.timeout()` per attempt, passed into every `generateText` as `abortSignal`. An abort counts as a provider failure, so the next model gets the remaining time |
| `TimeoutError: The operation was aborted due to timeout` on healthy calls, right after a schema change | The per-call timeout is sized from how long generation *actually* takes, and that moves when the response gets bigger. Adding `marketFit` (a ranking, a price range and a reason per platform) pushed generation past the 25s cap that had been comfortable | Raised to 35s, chain budget 45s → 50s. **Re-measure after any schema change that makes the model write appreciably more** — the symptom looks like a provider fault but is self-inflicted |
| A guessed Gemini id 404s: `not found for API version v1beta, or is not supported for generateContent` | Model ids can't be guessed from the version number | A bad id costs nothing — it 404s before generating and the chain falls through — so probing is the cheap way to find valid ids. **Don't re-probe these:** `gemini-3.6-flash-lite`, `gemini-3.6-pro`, `gemini-3.5-pro`, `gemini-3.6-flash-latest`, `gemini-3.5-flash-latest` don't exist, and `gemini-2.5-flash-lite` is retired for new callers. The working set is exactly `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-lite` — **60 generations/day, and there is no more free capacity to find.** Keep dead ids out of `GOOGLE_MODELS`: each one costs a wasted round trip on every request |
| A spent daily quota was being retried for the full budget | Google returns the daily cap as a **429 with `isRetryable: true` and a `retryDelay: 32s`**, indistinguishable from a per-minute rate limit by status or message. The quota id that tells them apart is in the *response body*, not the message. | `isExhaustedForTheDay()` looks for `PerDay` in the response body and treats it as terminal; per-minute limits stay retryable |

**The free tier cannot carry this app, and backoff doesn't change that.** Measured over ~15 live requests on 23 Sep 2026: one success, a sustained stretch where 0 of 5 succeeded despite full retry budgets, then the 20/day quota wall. `lib/backoff.ts` is in and does its job — it rides out genuine blips, it fails fast on config errors and on the daily cap, and 17 tests cover it — but no retry policy invents capacity or quota.

So the choice is now clear rather than open:

- **Personal use only, free.** 20 generations/day is plenty for one seller. This is where the project stands today.
- **Anything with testers or users needs a paid key.** 20/day is a *project* pool; five testers listing a few items each exhaust it before lunch.

**The chain now ends in a paid key** (28 Sep 2026). Free models are still tried first, in order, and Anthropic only sees what all three refused:

    gemini-3.6-flash  →  gemini-3.5-flash  →  gemini-3.5-flash-lite  →  claude-sonnet-5 (paid)

Verified live the day it was added, with all three free models unavailable: two out of quota (rejected in about a second each), the third busy through two retries, then `falling back to anthropic:claude-sonnet-5 (paid)` and a complete result — 77-character eBay title, `USED_GOOD`, a sensible ranking. About 50s end to end, which the app no longer feels since it polls a job rather than holding a connection.

Cost tracks *failures of the free tier*, not traffic. Two consequences worth remembering: on a day when the free quota is already spent, every request goes to the paid model, so the day you notice the bill is the day the free tier gave up early; and the log line says `(paid)` explicitly, so `vercel logs` will tell you which requests cost money. Actual spend is in the Anthropic console.

To go back to free-only, remove `ANTHROPIC_API_KEY` and redeploy — `resolveModelChain()` simply stops appending the paid candidate.

**The free part of the chain** (still first in line):

    GOOGLE_MODELS=gemini-3.6-flash,gemini-3.5-flash,gemini-3.5-flash-lite

Because the daily cap is per *model*, that is **60 free generations a day** rather than 20, and a model with no capacity falls through to the next one instead of failing the request. That 60 is the ceiling — six other model ids were probed and none exist, see the gotchas table. Ordered best-first, so quality degrades only once the better models are spent — `gemini-3.5-flash-lite` was checked by hand and produces all four platforms, a valid eBay condition enum, and keeps a flaw mentioned in the seller notes.

The env var reads `Sensitive` in Vercel (that's just `vercel env add`'s default), so its value can't be read back — it's recorded above for that reason.

`GENERATION_MODEL` in the production env still reads `anthropic/claude-sonnet-5`. It's inert — only the no-direct-key gateway branch reads it, and that branch is now unreachable twice over.

**Retry budgets are bounded by the iOS client, not `maxDuration`.** `APIClient.generateListings` gives up after 120s and the eBay call after 180s, so the budgets are 100s and 40s. Raising them means editing `APIClient.swift` and shipping a new TestFlight build first — the server going quiet for longer than the phone will wait just turns a clear error into a timeout.

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

- **`npm run deploy` is run from `backend/`**, and the script cds to the repo root itself before calling `vercel`. Running it from the repo root fails with `ENOENT: no such file or directory, open '.../package.json'` — there is no package.json there. The earlier note here said "deploy from the repo root", which is true of the `vercel` invocation and wrong as an instruction.
- **Never call bare `vercel deploy` from inside `backend/`.** Vercel's configured root directory is already `backend`, so that creates a stray project named `backend`. This happened twice; both were deleted. This is what the script's `cd ..` is for.
- **Vercel returns `[SENSITIVE]` placeholders** for sensitive env vars, so `vercel env pull` can't be used to test with real credentials locally.
- **Env changes need a redeploy**, and the deploy must be created *after* the change. One redeploy raced an env update and silently used the old value.
- **`vercel project rm` is interactive** and ignores `--yes`. Piping `yes |` into it loops forever — use the REST API to delete a project.

## iOS build notes

- **Signing:** team `7RYYQ8M5X5`, set as `DEVELOPMENT_TEAM` in `ios/project.yml`.
- **Installs fail while the phone is locked** (`kAMDMobileImageMounterDeviceLocked`). Unlock first; disabling auto-lock helps.
- **First launch needs the certificate trusted** at Settings → General → VPN & Device Management.
- **Free personal signing expires after 7 days.** When the app stops opening, rebuild and reinstall — history survives, since SwiftData is on-device.
- **The app icon is generated from `ios/icon.svg`**, so it can be edited as text rather than redrawn. To rebuild it:

      qlmanage -t -s 1024 -o . icon.svg && mv icon.svg.png icon.png
      sips -s format jpeg -s formatOptions best icon.png --out icon.jpg
      sips -s format png icon.jpg --out EasyListing/Assets.xcassets/AppIcon.appiconset/icon-1024.png

  The JPEG hop is not pointless: the App Store rejects an icon with an alpha channel, `qlmanage` always writes one, and `sips` has no flag to drop it — a JPEG round trip is what actually clears it. Check with `sips -g hasAlpha`; it must read `no`.
- `EasyListing.xcodeproj` is **committed**, not gitignored — Xcode Cloud validates the project reference before it runs the post-clone script, so generating it there is too late. `project.yml` is still the source of truth: run `xcodegen generate` after editing it and commit the result. (This line said "gitignored" until 25 Sep 2026, contradicting the note under "Not finished".)

---

## Ideas not yet built

- Bulk mode: several items in one session.
- Price research: check eBay sold listings for a realistic figure rather than the model's estimate. This is now also what would put real numbers behind `marketFit`'s ranking — at present every range on that card is inferred from the photos. eBay's sold data needs the Marketplace Insights API, which requires separate approval; the other three platforms have no equivalent, so their ranges would stay estimates either way.
- Marking an item as sold, and tracking which platform sold it.
- Tests around `lib/ebay.ts` — the error paths are intricate and all hand-verified so far.

---

## TestFlight distribution

✅ **Working, verified installed.** Enrolled in the Apple Developer Program, app created in App Store Connect (`com.samperrone.easylisting`), API key generated, and the app installed on the iPhone from TestFlight. Replaces the 7-day free-signing expiry with **90-day** over-the-air builds.

**Build 6 uploaded 28 Sep 2026** (delivery UUID `c1bf23ed-2ffd-4300-b8cc-0961fc31c9ec`) — burst camera capture, camera-roll saving, and a guard against one tap creating two items. **Build 5** (`ba9a5ac9-8831-4a0e-a72c-c4c8ddcdf468`) — fixes build 4's placeholder title, which doubled as a progress message and so stuck at "Writing listings…" on any item whose job failed. **Build 4** (`fd50b368-4a7d-4b74-8c43-a125459abd9d`) — background generation, save-before-generate with Retry, and local notifications. **Build 3** (`cf365bc6-666a-4f8c-9387-af1f6408508d`) — the coral icon and the "Where to sell" ranking card. **Build 2** (25 Sep, `e5cae045-19c9-454f-b850-992cf73b0b03`) was byte-identical to build 1: no iOS file changed between them, so it shipped nothing. Check `git diff <last-build>..HEAD -- ios/` before uploading; backend changes reach existing installs on deploy and need no build at all.

Note for testing build 3: the recommendation card only appears on items generated **after** the `marketFit` backend change, because the ranking is stored per item at generation time. Existing history shows the old behaviour.

Two steps that are easy to miss, both of which cost time here: a tester has to be **added to an internal group** (creating the group isn't enough — the group's Invites column reads `–` until someone is in it), and a newly-added tester takes **a few minutes to appear** in the TestFlight app. Use an **Internal** group; external ones need Beta App Review first.

To ship a new build: bump `CURRENT_PROJECT_VERSION` in `ios/project.yml`, then `cd ios && ./release.sh` (needs `ASC_KEY_ID` and `ASC_ISSUER_ID` exported; the `.p8` lives in `~/.appstoreconnect/private_keys/`).

There are **two** keys in that directory. `5LGP386KP6` is the one that works — `WTZ5R5WGCQ` is stale or for something else. The issuer ID is a UUID that appears nowhere on disk, so it has to come from App Store Connect → Users and Access → Integrations, or from wherever you've stored it. Neither belongs in the repo.

`release.sh` takes about 2 minutes end to end (archive ~1m40s, export ~2s, upload ~5s), then 5–15 minutes of processing before the build appears in TestFlight.

`ios/refresh.sh` — the free-signing rebuild/reinstall script — is now redundant, but kept in case the membership lapses.

Ignore App Store Connect's **Distribution** tab entirely: screenshots, App Privacy, and "Add for Review" are for a public release. Internal TestFlight testing needs none of them and skips Beta App Review.

Bump `CURRENT_PROJECT_VERSION` in `ios/project.yml` before each upload — App Store Connect rejects a duplicate build number.

**A public App Store release is a different project**, not a packaging step. Draft metadata, the review checklist, and the blockers are in [APP_STORE.md](APP_STORE.md). The blocking one is that `/api/generate` has no auth, rate limit or metering, and the backend URL is hardcoded in the shipped binary (`APIClient.swift`). On Gemini's free tier that no longer means an unbounded bill, but the shared per-project quota is still exhaustible by anyone who finds the endpoint.
