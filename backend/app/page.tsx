import type { Metadata } from 'next';
import { APP_STORE_URL } from '@/lib/appStore';

export const metadata: Metadata = {
  title: 'Easy Listing — photos to marketplace listings',
  description:
    'Photograph something you want to sell and get finished listings for eBay, Vinted, Gumtree and Facebook Marketplace. Post straight to eBay. Free on iPhone.',
  openGraph: {
    title: 'Easy Listing — photos to marketplace listings',
    description:
      'Snap a photo, get a finished listing for every marketplace you sell on. Free on iPhone.',
    images: ['/screens/01-where-to-sell.jpg'],
  },
};

const css = `
  .el { --bg:#fbfaf7; --fg:#1c1b19; --muted:#5f5c56; --card:#fff; --line:#e6e2da; --accent:#1f6f4a;
        background:var(--bg); color:var(--fg); min-height:100vh;
        font-family: system-ui, -apple-system, sans-serif; line-height:1.55; }
  @media (prefers-color-scheme: dark) {
    .el { --bg:#141412; --fg:#f1efe9; --muted:#a7a39a; --card:#1d1c1a; --line:#2e2c29; --accent:#5cc28f; }
  }
  .el a { color: inherit; }
  .wrap { max-width: 1040px; margin: 0 auto; padding: 0 20px; }
  .hero { display:grid; gap:40px; align-items:center; padding:56px 0 40px; grid-template-columns: 1.1fr 0.9fr; }
  .brand { display:flex; align-items:center; gap:12px; font-weight:600; }
  .brand img { width:44px; height:44px; border-radius:10px; }
  h1 { font-size: clamp(34px, 5vw, 52px); line-height:1.08; letter-spacing:-0.02em; margin:24px 0 16px; }
  .lede { font-size:19px; color:var(--muted); max-width:34em; margin:0 0 28px; }
  .cta { display:inline-flex; align-items:center; gap:10px; background:var(--fg); color:var(--bg) !important;
         text-decoration:none; padding:13px 22px; border-radius:12px; font-weight:600; font-size:17px; }
  .note { font-size:14px; color:var(--muted); margin-top:12px; }
  .phone { width:100%; max-width:300px; justify-self:center; border-radius:28px; border:1px solid var(--line);
           box-shadow: 0 20px 50px rgba(0,0,0,.12); }
  .steps { display:grid; grid-template-columns: repeat(3, 1fr); gap:16px; padding:24px 0 48px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:22px; }
  .card b { display:block; font-size:17px; margin-bottom:6px; }
  .card p { margin:0; color:var(--muted); }
  .num { color:var(--accent); font-weight:700; font-size:14px; letter-spacing:.06em; }
  h2 { font-size:26px; letter-spacing:-0.01em; margin:0 0 18px; }
  .shots { display:grid; grid-template-columns: repeat(3, 1fr); gap:20px; padding-bottom:56px; }
  .shots img { width:100%; border-radius:22px; border:1px solid var(--line); }
  .points { display:grid; grid-template-columns: repeat(2, 1fr); gap:16px; padding-bottom:56px; }
  footer { border-top:1px solid var(--line); padding:24px 0 40px; color:var(--muted); font-size:14px;
           display:flex; gap:20px; flex-wrap:wrap; }
  @media (max-width: 760px) {
    .hero { grid-template-columns: minmax(0, 1fr); padding-top:32px; }
    .phone { max-width:240px; }
    .steps, .points { grid-template-columns: minmax(0, 1fr); }
    .shots { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .shots img:last-child { display:none; }
  }
`;

export default function Home() {
  return (
    <div className="el">
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <main className="wrap">
        <section className="hero">
          <div>
            <div className="brand">
              <img src="/icon.jpg" alt="" />
              Easy Listing
            </div>
            <h1>Snap it. List it. Sell it.</h1>
            <p className="lede">
              Photograph something you want to sell. Easy Listing writes the title, description,
              condition and a suggested price for eBay, Vinted, Gumtree and Facebook Marketplace,
              each in the style that site expects.
            </p>
            <a className="cta" href={APP_STORE_URL}>
              Download on the App Store
            </a>
            <p className="note">Free on iPhone, UK only. 10 free listings a month.</p>
          </div>
          <img
            className="phone"
            src="/screens/01-where-to-sell.jpg"
            alt="Easy Listing ranking which marketplace an item will sell best on"
          />
        </section>

        <section className="steps">
          <div className="card">
            <span className="num">01</span>
            <b>Take a few photos</b>
            <p>That&apos;s all it needs. Add a note if there&apos;s something the photos can&apos;t show.</p>
          </div>
          <div className="card">
            <span className="num">02</span>
            <b>Get every listing written</b>
            <p>A finished listing for each marketplace, and which one your item is likely to sell best on.</p>
          </div>
          <div className="card">
            <span className="num">03</span>
            <b>Post it</b>
            <p>Straight to eBay from the app. For the others, every field is one tap to copy.</p>
          </div>
        </section>

        <h2>Made for people who sell their own stuff</h2>
        <section className="points">
          <div className="card">
            <b>Honest by default</b>
            <p>
              It describes what&apos;s in your photos, scuffs included. Details it can&apos;t see,
              like a size label, are flagged for you to fill in rather than made up.
            </p>
          </div>
          <div className="card">
            <b>Nothing goes live without you</b>
            <p>Every field is editable, and nothing is posted until you confirm it. Save to eBay as a draft if you want another look first.</p>
          </div>
          <div className="card">
            <b>Keeps track</b>
            <p>Your items stay in the app with their photos, so you can see what you&apos;ve listed and what&apos;s still waiting.</p>
          </div>
          <div className="card">
            <b>No tracking</b>
            <p>Sign in with Apple or Google. No password is stored, and your eBay connection stays on your phone.</p>
          </div>
        </section>

        <section className="shots">
          <img src="/screens/02-new-item.jpg" alt="Adding photos of a new item" />
          <img src="/screens/01-where-to-sell.jpg" alt="Where to sell ranking" />
          <img src="/screens/03-history.jpg" alt="History of listed items" />
        </section>

        <footer>
          <span>© 2026 Samuele Perrone</span>
          <a href="/support">Support</a>
          <a href="/privacy">Privacy</a>
          <a href={APP_STORE_URL}>App Store</a>
        </footer>
      </main>
    </div>
  );
}
