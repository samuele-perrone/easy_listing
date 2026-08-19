export const metadata = { title: 'Easy Listing — Privacy Policy' };

export default function Privacy() {
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
      <h1>Privacy Policy — Easy Listing</h1>
      <p>
        <em>Last updated: 19 August 2026</em>
      </p>

      <p>
        Easy Listing is a personal application used by a single individual to prepare and publish
        listings for items they own on second-hand marketplaces. It is not offered as a service to
        other people and has no other users.
      </p>

      <h2>What the app handles</h2>
      <ul>
        <li>
          <strong>Photos and descriptions of items being sold.</strong> Photos are sent to an AI
          provider (Anthropic) to generate listing text, and are uploaded to Vercel Blob storage so
          that eBay can display them on a listing. They are not used for any other purpose.
        </li>
        <li>
          <strong>eBay account access.</strong> When you connect an eBay account, eBay issues OAuth
          tokens. These are stored in the iOS device&apos;s Keychain on the user&apos;s own phone.
          They are used solely to create and publish listings at the user&apos;s explicit request.
        </li>
      </ul>

      <h2>What is not collected</h2>
      <p>
        The app has no accounts, no analytics, no advertising, and no tracking. It does not collect
        names, email addresses, contact lists, or location data, and it does not build user profiles.
      </p>

      <h2>Retention and deletion</h2>
      <p>
        Listing history is stored locally on the user&apos;s device and is deleted when the item is
        deleted or the app is removed. eBay tokens can be revoked at any time by disconnecting the
        account in the app&apos;s Settings screen, or from eBay&apos;s own account settings.
      </p>

      <h2>Third parties</h2>
      <p>
        Data is processed by Anthropic (listing generation), Vercel (hosting and image storage), and
        eBay (listing creation). Each handles data under its own privacy policy. Nothing is sold or
        shared with anyone else.
      </p>

      <h2>Contact</h2>
      <p>Questions about this policy: samuele.perrone@gmail.com</p>
    </main>
  );
}
