# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Read `docs/STATUS.md` before starting work. It records what's finished, what's mid-flight, and the eBay API traps already diagnosed — most of which cost a debugging round trip and are not obvious from the code alone.

## Keep the docs current

`docs/STATUS.md` is the memory of this project across sessions — treat updating it as part of the change, not as follow-up work:

- Finished something on the "Not finished" list, or hit a new blocker → move it.
- Diagnosed a non-obvious external-API failure → add it to the gotchas table with the *cause*, not just the fix. That table is the highest-value part of the file.
- Made a design decision a future reader would otherwise second-guess → record why.
- Changed setup, env vars, endpoints, or commands → update `README.md`, `backend/.env.example`, and this file to match.

Update the docs in the same commit as the code that made them stale.

## Commands

```sh
# Backend (from backend/)
npm run dev
npm run typecheck          # tsc --noEmit — run before every deploy
npm run build

# Deploy — run this from backend/ like the rest of this block. The script
# typechecks, tests, then cds to the repo root itself before calling vercel.
# Running it from the repo root fails: there is no package.json there.
# Running bare `vercel deploy` from backend/ creates a stray project (done 3x already).
npm run deploy

# iOS (from ios/)
xcodegen generate          # regenerates the gitignored .xcodeproj after editing project.yml
xcodebuild -project EasyListing.xcodeproj -scheme EasyListing \
  -destination 'generic/platform=iOS' -derivedDataPath ./build \
  -allowProvisioningUpdates build
xcrun devicectl list devices
xcrun devicectl device install app --device <UUID> ./build/Build/Products/Debug-iphoneos/EasyListing.app
```

There are no tests. Verification so far has been by hand against live services.

## Architecture

A SwiftUI iOS app plus a Next.js backend on Vercel. The split exists because API credentials must not live in an app binary: the backend holds the eBay app credentials and the AI provider key, while the *seller's* OAuth tokens live only in the iOS Keychain and are sent with each request.

**Generation path.** `NewItemView` → `APIClient.generateListings` → `POST /api/generate` → `generateText` with `Output.object` against `generateResultSchema` (`backend/lib/schema.ts`). That zod schema is the contract: it defines every per-platform field, and the system prompt in the route tells the model each platform's own vocabulary. Changing the fields the app displays means changing the schema, not the views.

**Provider resolution** happens at runtime in `backend/app/api/generate/route.ts`: `ANTHROPIC_API_KEY` → `GOOGLE_GENERATIVE_AI_API_KEY` → Vercel AI Gateway. The gateway is last because its free tier rejects every model.

**eBay path.** Everything non-trivial is in `backend/lib/ebay.ts`. `createListing()` orchestrates a strict sequence, each step of which has its own eBay-side prerequisite: create inventory item → resolve category (needs an *application* token, not the seller's) → ensure Business Policies enrolment → ensure a merchant location → create offer → optionally publish. Call `ebayFetch`/`ebayHeaders` rather than bare `fetch`; the headers are load-bearing (see below).

**Photo flow.** Photos travel as base64 JSON, so `APIClient.encodedImages` measures and downscales them to fit Vercel's 4.5 MB body limit. For eBay they're re-uploaded to Vercel Blob, because eBay's Inventory API takes image *URLs*, not bytes.

## Constraints that will bite

- **Posting to eBay is allow-listed, and the check is server-side.** `authoriseEbayPost()` (`backend/lib/auth.ts`) gates `/api/ebay/post` and `/api/ebay/publish` on a verified Apple/Google session whose email is in `EBAY_POST_ALLOWED_EMAILS`. Hiding the button in the app is a courtesy, not the control — never move the check there. An unset allow-list permits nobody on purpose.
- **Only eBay gets API posting.** Vinted, Gumtree and FB Marketplace have no public seller API; automating them breaks their terms. The copy-paste flow for those is a deliberate design decision, not an unfinished feature.
- **Node's `fetch` sends `accept-language: *`**, which eBay rejects with error 25709. Any new eBay call must go through `ebayHeaders()`.
- **The eBay condition exists twice, and only one form is postable.** The visible "Condition" field holds eBay's human label ("Used"); `ebayDraft.condition` holds the enum its API requires (`USED_EXCELLENT`). `editedEbayDraft` (iOS) must override the enum *only* when the field text resolves to one, and `supportedCondition()` runs everything through `normaliseCondition()` first. Posting a label gets eBay 2004 "Could not serialize field [condition]", which broke every publish for six weeks. A condition fallback must also never cross from a used grade to `NEW`.
- **Vercel's root directory is already `backend`.** Running `vercel deploy` from inside `backend/` creates a stray project instead of deploying this one.
- **Env changes need a redeploy created after the change**, or the deployment silently uses the old value.
- **`vercel env pull` returns `[SENSITIVE]` placeholders**, so it can't be used to test with real credentials locally.
- **Publishing is irreversible.** Keep the confirmation dialog before "Post to eBay" and "Publish draft"; "Save as draft" is the unpublished path and intentionally has no warning.
- **iOS installs fail while the phone is locked**, and the free signing certificate expires after 7 days.
