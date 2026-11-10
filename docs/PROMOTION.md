# Promotion

Launch plan for Easy Listing, written 10 Nov 2026 after 1.0 went live. Keep it
current the same way as `STATUS.md`: what's been posted where, and what happened.

- App Store: https://apps.apple.com/gb/app/easy-listing/id6805925066
- Landing page: https://easy-listing-chi.vercel.app (Smart App Banner on iPhone)

---

## Constraints that shape everything

- **UK only.** The app is distributed in the UK alone (non-trader status, see
  `APP_STORE.md`). Global audiences — Product Hunt, Hacker News, US subreddits
  like r/Flipping — mostly can't download it. Spend effort on UK reseller spaces.
- **Every user costs money.** ~40p per active user per month at Anthropic rates.
  Before any push: the Anthropic spend limit ($15/month as of 29 Sep) must be
  raised to match expected traffic, or generation stops for everyone mid-launch.
  `DAILY_LIMIT_TOTAL` is 200 (raised to 1000 and reverted on 10 Nov — too
  early to predict traffic). Watch for it firing once posts go out.
- **No ratings yet** (0 on 10 Nov). 1.0.1 adds an in-app rating prompt; it is
  `WAITING_FOR_REVIEW`. Promotion lands better once it's live.

## Rules for posting (non-negotiable)

1. **Nothing is posted without the developer approving the exact text first.**
   Posts go out under their name and can't really be taken back.
2. **Always disclose**: "I made this". Never pose as a happy user.
3. **Read each community's self-promotion rules first**; ask admins/mods before
   posting where rules are unclear. Many Facebook groups require admin approval.
4. **No fake reviews, sock-puppet accounts, or cross-posting the same text
   everywhere at once.** Apple and Reddit ban for it, and UK reseller groups are
   small enough that it gets noticed.
5. Ask for feedback rather than advertising. Reply to every comment.

## Channels, in priority order

| # | Channel | Status | Notes |
|---|---|---|---|
| 1 | TikTok / Instagram Reels | not started | 15–20s screen recording: photo → four listings → posted on eBay. Use real items. Daily for 2–3 weeks. |
| 2 | UK reseller Facebook groups (Vinted / eBay UK sellers) | not started | Message admins first. Offer to answer questions. |
| 3 | r/vinted, r/eBayUK | not started | Check rules; feedback-framed post below. |
| 4 | r/SideProject, r/iOSApps | not started | Builder audience; fine for launch story, few UK sellers. |
| 5 | Small UK reseller creators (5k–50k) | not started | Offer unlimited listings via `UNLIMITED_ACCOUNTS` env var. |
| 6 | Apple Search Ads (UK, exact match) | not started | ~£5/day test. Bid on terms like "vinted listing", "resell". |

**Reddit can't be read by Claude.** The Chrome extension refuses reddit.com
("not allowed due to safety restrictions") and Claude Code's web fetcher is
blocked from it too (checked 10 Nov 2026). Rule checks and posting on Reddit are
manual: open `reddit.com/r/<sub>/about/rules` yourself, or paste the rules into
the session.

## Draft posts — edit before use, check each community's rules first

### r/vinted / r/eBayUK

**Title:** I built an app that writes them from photos — looking for honest feedback

> [YOUR OWN REASON — e.g. how much you sell and what annoyed you; keep it true]
> The slowest part of selling is always writing the listing. So I built an iPhone app that does it: take a few photos and it
> writes the title, description, condition and a suggested price for Vinted,
> eBay, Gumtree and FB Marketplace — each in the style that site expects, and it
> tells you which one your item is likely to sell best on.
>
> It can post straight to eBay. Vinted has no API, so for that it's one tap to
> copy each field.
>
> It's free (10 listings a month), UK only, and I made it — so I'd genuinely like
> to hear what's wrong with it. Does the pricing look right for things you sell?
>
> https://apps.apple.com/gb/app/easy-listing/id6805925066

### r/SideProject / r/iOSApps

**Title:** Launched an iOS app: photos in, marketplace listings out (SwiftUI + Next.js on Vercel)

> Easy Listing turns photos of something you want to sell into finished listings
> for eBay, Vinted, Gumtree and Facebook Marketplace, and posts directly to eBay
> through its API.
>
> A few things that were harder than expected:
> - eBay's condition field exists as a human label and an API enum — posting the
>   label broke every publish for six weeks.
> - Keeping API keys out of the binary meant a backend, which meant per-account
>   quotas so a free app can't run up an unbounded AI bill.
> - The other marketplaces have no seller API, so it's copy-paste by design —
>   automating them would break their terms.
>
> UK only for now. Happy to answer anything about the build.

### Facebook group (send to admin first)

> Hi — I'm a member here and I've built a free iPhone app that writes Vinted /
> eBay / Gumtree / FB listings from your photos. Would you be OK with me posting
> about it once? Happy to follow whatever rules you have, and to answer questions
> in the comments.

## Log

Record each post: date, where, link, and what happened (upvotes, comments,
installs if visible in App Store Connect → Analytics).

| Date | Where | Link | Result |
|---|---|---|---|
