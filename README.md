# Easy Listing

Photograph an item once, get ready-to-post listings for **eBay, Vinted, Gumtree and FB Marketplace** — with one-tap real posting on eBay and a guided copy-paste flow everywhere else. Every item you list is kept in a local history.

## Layout

- `ios/` — native SwiftUI app (iOS 17+, SwiftData for history). Project is generated with [XcodeGen](https://github.com/yonaskolb/XcodeGen): `cd ios && xcodegen generate`, then open `EasyListing.xcodeproj`.
- `backend/` — Next.js API on Vercel:
  - `POST /api/generate` — photos in, per-platform listing fields out (Claude vision via Vercel AI Gateway).
  - `GET /api/ebay/login` → `GET /api/ebay/callback` — eBay OAuth; tokens are handed to the app via `easylisting://` and stored in the iOS Keychain (never on the server).
  - `POST /api/ebay/refresh` — access-token refresh.
  - `POST /api/ebay/post` — uploads photos to Vercel Blob, then creates + optionally publishes an eBay listing (Inventory API).

## Why only eBay auto-posts

eBay is the only one of the four with a public seller API. Vinted, Gumtree and FB Marketplace don't offer one (and automating them violates their ToS), so for those the app generates every form field and you tap-to-copy each into the platform's own app. The app warns you before anything is published, and eBay publishing always shows an explicit "this goes live" confirmation.

## Deployment

The backend is deployed on Vercel as project **easy-listing** (root directory `backend/`):
**https://easy-listing-chi.vercel.app** — pushes to `main` auto-deploy to production via the Vercel GitHub integration. A public Blob store (`easy-listing-photos`) is attached for eBay listing photos, and the AI Gateway authenticates automatically on Vercel.

Still needed as env vars (`vercel env add <NAME> production`): `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_RU_NAME`, and `EBAY_ENV=production` when moving off sandbox.

## Setup

1. **Backend**: `cd backend && npm install && cp .env.example .env.local`, fill in the env vars (see comments in the file), `npm run dev`.
2. **eBay developer app**: create one at https://developer.ebay.com/my/keys (start with sandbox keys). On the "User Tokens" page create a RuName whose *auth accepted URL* points at `https://<your-backend>/api/ebay/callback`, and put the RuName in `EBAY_RU_NAME`.
3. **Deploy**: `vercel deploy` from `backend/`; attach a Blob store to the project; add the env vars with `vercel env add`.
4. **iOS app**: build in Xcode, run on your iPhone, set the backend URL in Settings, and connect eBay.
