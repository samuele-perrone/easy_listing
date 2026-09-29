# Publishing to the App Store

Draft metadata and the work that has to happen first. **Nothing here is submitted yet** — TestFlight internal testing needs none of it.

---

## Blockers to resolve before submitting

**0. ~~The endpoint is open~~ — metered since 29 Sep 2026.** Daily ceilings now sit in front of both generate routes: 30 per install, 200 across everything, checked before any work starts. The global ceiling is the one that bounds the bill, since the install id is not a secret. Details in `STATUS.md`. What's left of this blocker is a policy decision rather than an exposure: 200/day is a cost ceiling, not a business model, and a real release still needs to decide who pays. **Also set a spend limit on the Anthropic key** — code can be wrong.

The original framing, kept because it's why the ceilings exist:

**The endpoint was open, and it had started spending real money.** This moved from "theoretical" to "urgent" on 28 Sep, when `ANTHROPIC_API_KEY` was added. `/api/generate` and `/api/generate/start` have no auth, no rate limit and no per-user metering, and `APIClient.swift` hardcodes the backend URL into every shipped binary — a single `strings` on the app reveals it. Before the paid key the worst case was someone exhausting 60 free generations a day. Now the worst case is an unbounded bill on the developer's card, from anyone who finds the URL.

A public App Store release publishes that binary to everyone. **Ship per-install limits before release, not after.** The shape that fits what's already built: a per-install identifier sent by the app, counted server-side, with a hard monthly ceiling — and the paid fallback only reachable within that ceiling.

**1. Generation capacity — measured, and it's tiny.** Production runs on Gemini's free tier, capped at 20 generations per model per day. Three free models are chained, so **60 a day, shared across every install** — not per user. That is fine for one seller and nowhere near a public release; it's roughly a handful of testers' worth of one afternoon. The free tier also had sustained stretches with no capacity at all (0 of 5 requests succeeded on 23 Sep 2026), which the chain routes around only while some model still has capacity.

Compounding it, `/api/generate` has no auth, no rate limit and no per-user metering, and `APIClient.swift` hardcodes the backend URL into every shipped binary — so the 20/day pool is exhaustible by anyone who finds the endpoint, not just by real users. Pick one before launch:

- **Subscription via in-app purchase.** Apple takes 15–30% and requires StoreKit; a server-side receipt check would gate `/api/generate`.
- **Bring your own key.** Users paste their own Anthropic or Gemini key in Settings. Zero cost and zero shared quota, but a poor experience for non-technical sellers — and the audience for this app is non-technical sellers.
- **Free tier with hard limits.** e.g. 10 items/month per install, tracked server-side. Simplest to build, caps the damage, still costs something — and needs a paid provider key underneath it, because 20/day across all users is not a tier anyone can ship on.

On the provider side the **fallback chain** is built (`lib/provider.ts`) and currently filled with free models only; adding `ANTHROPIC_API_KEY` extends it to a paid safety net, which is deliberately not set. That fixes reliability, not economics: with it, users stop seeing failures; without per-user metering, the bill it creates is still unbounded. Both pieces are needed before a public release. See `STATUS.md`.

**2. eBay's API terms.** The current setup uses one eBay app credential with each user OAuthing their own account, which is the intended pattern — but eBay's API License Agreement has separate terms for distributed applications, and production keysets can be subject to compliance review at higher call volumes. Worth confirming with eBay before launch rather than after.

**3. App Review risks.** None fatal, all worth preparing for:

- **2.1 Completeness** — a reviewer without an eBay account must still see the app work. Generation works without connecting eBay, so this should pass; note it in review notes.
- **5.1.1 Privacy** — photos go to a third party (Google). Must be declared in the App Privacy questionnaire and covered by the privacy policy (`/privacy` already says so). Note the free tier lets Google use submitted content to improve its services; a paid tier would remove that clause, and the questionnaire answer should match whichever is live at submission.
- **5.2.1 Third-party trademarks** — the app names eBay, Vinted, Gumtree and Facebook Marketplace. Nominative use is generally fine, but leading with those names in the App Store *title or subtitle* invites rejection. Keep them in the description body, describing what the app does.
- **3.1.1 In-app purchase** — if you charge, it must go through Apple's IAP, not an external payment link.

**4. Support obligation.** A public listing needs a working support URL and someone answering it. That's an ongoing commitment, not a launch task.

---

## Apple's checklist

| Requirement | Status |
|---|---|
| App icon (1024×1024, no alpha) | ✅ done |
| Privacy policy URL | ✅ `https://easy-listing-chi.vercel.app/privacy` — entered in App Store Connect 29 Sep 2026 |
| Name, subtitle, promo text, description, keywords | ✅ entered and saved 29 Sep 2026 |
| Copyright | ✅ `2026 Samuele Perrone` |
| Support URL | ✅ `https://easy-listing-chi.vercel.app/support` — contact address plus the failures a user is most likely to hit |
| Screenshots — 6.9" and 6.5" iPhone | ❌ needed, 3–10 each |
| App Privacy questionnaire | ⚠️ **answered but not published** — Photos or Videos → App Functionality → not linked to identity → not used for tracking. Deliberately left unpublished: it's a legal declaration and needs the developer's own read before it goes live |
| Age rating questionnaire | ❌ needed — expect 4+. App Store Connect's App Information page rendered blank on 29 Sep and this couldn't be completed |
| Build attached to the version | ❌ needed — build 6 is uploaded and VALID, but not yet selected for the 1.0 version |
| Pricing (free) | ❌ needed |
| Category | Shopping (primary), Productivity (secondary) |
| Export compliance | ✅ declared in Info.plist |

---

## Draft metadata

### Name (30 characters max)

    Easy Listing

### Subtitle (30 characters max)

    Photos to marketplace listings

Alternatives: `Sell your stuff, faster` · `List once, sell anywhere` · `Snap it. List it. Sell it.`

### Promotional text (170 characters, editable without review)

    Photograph anything you want to sell and get a complete listing — title, description, condition, price — written for each marketplace you sell on.

### Description (4000 characters max)

    Selling something second-hand takes minutes of typing before it takes any money. Easy Listing does that part for you.

    Photograph the item. That's the whole input. You get back a finished listing for every marketplace you sell on — title, description, condition, category and a suggested price — each written the way that particular site expects.

    WRITTEN FOR EACH MARKETPLACE, NOT COPY-PASTED
    A listing that works on one site reads wrong on another. Easy Listing writes each one properly: keyword-dense titles where search depends on them, a relaxed tone with hashtags where that's the norm, and the right condition wording for each site's own scale.

    HONEST BY DEFAULT
    It describes what's actually in your photos. Visible scuffs and wear get mentioned, because surprised buyers leave bad feedback and open returns. When something matters but isn't visible — a size label, a model number — it flags it for you to fill in rather than inventing it.

    POST TO EBAY WITHOUT LEAVING THE APP
    Connect your eBay account and publish directly, or save a draft to review in Seller Hub first. Nothing is ever posted without you confirming it. For Vinted, Gumtree and Facebook Marketplace, every field is one tap to copy and the app opens the right screen for you.

    EVERYTHING IS EDITABLE
    Every field can be edited before it goes anywhere. Change the price, rewrite the description, correct the condition. What you see is exactly what gets listed.

    KEEPS TRACK
    Your items stay in the app with their photos and status, so you know what you've listed, where, and what's still waiting.

    Easy Listing has no account and no tracking. Your eBay connection is stored on your device, never on a server.

### Keywords (100 characters, comma-separated, no spaces)

Safer version — avoids third-party trademarks, which Apple sometimes rejects:

    resell,resale,secondhand,preloved,declutter,marketplace,seller,listing,thrift,flip,wardrobe

Riskier but higher-intent version — third-party names in keywords can trigger a trademark rejection:

    ebay,vinted,resell,secondhand,preloved,declutter,marketplace,listing,seller,thrift

**Recommendation:** submit with the safe version. Keywords can be changed in a later release; a trademark rejection delays the whole review.

### What's New (first release)

    First release. Photograph an item, get finished listings for eBay, Vinted, Gumtree and Facebook Marketplace, and post straight to eBay.

### App Review notes

    Sign-in is not required to try the app. Tap +, add photos of any object, and tap
    Generate listings to see the full flow.

    Connecting an eBay account is optional and only needed for posting directly to eBay.
    All other marketplaces use a copy-to-clipboard flow because they have no public
    seller API.

    Photos are sent to Google's Gemini API to generate the listing text. This is described
    in the privacy policy. No account is created and no personal data is collected.

### Screenshots to capture

1. History screen with a few listed items — shows it's a real tool with state
2. New item screen with photos added — the input, and how little it is
3. Generated eBay listing — the payoff, ideally showing a good title and description
4. Platform picker showing all four tabs — the differentiator
5. The editing sheet — control over what gets posted
