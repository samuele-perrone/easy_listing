export const metadata = { title: 'Easy Listing — Support' };

export default function Support() {
  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        maxWidth: 680,
        margin: '0 auto',
        padding: '48px 24px',
        lineHeight: 1.6,
      }}
    >
      <h1>Support — Easy Listing</h1>

      <p>
        Easy Listing turns photos of something you want to sell into finished listings for eBay,
        Vinted, Gumtree and Facebook Marketplace.
      </p>

      <h2>Getting help</h2>
      <p>
        Email <a href="mailto:samuele.perrone@gmail.com">samuele.perrone@gmail.com</a>. Please say
        which iPhone and iOS version you&apos;re on, and what you were doing when it went wrong.
      </p>

      <h2>Common problems</h2>

      <h3>&ldquo;Today&apos;s listing generations have run out&rdquo;</h3>
      <p>
        There&apos;s a daily limit on how many listings can be generated. It resets each day — try
        again tomorrow.
      </p>

      <h3>Listing generation failed</h3>
      <p>
        Usually the AI service being briefly busy. Tapping <em>Generate listings</em> again is
        normally enough. If it keeps failing, the error alert has an{' '}
        <em>Email support</em> button that attaches the technical detail.
      </p>

      <h3>eBay won&apos;t connect, or posting fails</h3>
      <p>
        Posting to eBay needs a business-policy-enabled seller account with a postage, payment and
        returns policy each set up, and a full postcode on your address. eBay&apos;s own error is
        shown in the app where possible. You can also disconnect and reconnect the account from
        Settings.
      </p>

      <h3>The other marketplaces don&apos;t post automatically</h3>
      <p>
        Only eBay has a public API for sellers. Vinted, Gumtree and Facebook Marketplace don&apos;t,
        so the app writes every field and gives you one-tap copy buttons instead. That&apos;s
        deliberate — automating those sites would breach their terms.
      </p>

      <h3>Something in the listing is wrong</h3>
      <p>
        Every field is editable before anything is posted, and a field written as{' '}
        <code>[CHECK: …]</code> is the app telling you it couldn&apos;t see that detail in your
        photos and needs you to fill it in. Nothing is listed without you confirming it.
      </p>

      <h2>Your data</h2>
      <p>
        See the <a href="/privacy">privacy policy</a>. In short: no account, no tracking, your eBay
        connection is stored on your device, and photos are sent to the AI provider only to write
        the listing.
      </p>
    </main>
  );
}
