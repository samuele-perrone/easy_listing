import { createHash } from 'crypto';

// eBay Marketplace Account Deletion / Closure Notification endpoint.
// Required before eBay will enable a production keyset.
//
// GET  — eBay sends ?challenge_code=... and expects back
//        { challengeResponse: sha256(challengeCode + verificationToken + endpointURL) }
// POST — eBay sends an account-deletion notification; acknowledge with 200.

function endpointURL() {
  return (
    process.env.EBAY_DELETION_ENDPOINT ??
    'https://easy-listing-chi.vercel.app/api/ebay/deletion'
  );
}

export function GET(request: Request) {
  const challengeCode = new URL(request.url).searchParams.get('challenge_code');
  const verificationToken = process.env.EBAY_VERIFICATION_TOKEN;

  if (!challengeCode) {
    return Response.json({ error: 'Missing challenge_code.' }, { status: 400 });
  }
  if (!verificationToken) {
    return Response.json({ error: 'EBAY_VERIFICATION_TOKEN not configured.' }, { status: 500 });
  }

  // Order is significant: challenge code, then token, then the endpoint URL.
  const challengeResponse = createHash('sha256')
    .update(challengeCode)
    .update(verificationToken)
    .update(endpointURL())
    .digest('hex');

  return Response.json({ challengeResponse }, { status: 200 });
}

export async function POST(request: Request) {
  // Easy Listing keeps no eBay user data server-side — OAuth tokens live in the
  // iOS Keychain on the seller's own device, and listing photos are the seller's
  // own. There is nothing to erase, so acknowledge and record the notification.
  try {
    const body = await request.json();
    console.log('eBay account deletion notification', JSON.stringify(body));
  } catch {
    console.log('eBay account deletion notification (unparsable body)');
  }
  return new Response(null, { status: 200 });
}
