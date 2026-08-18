import { refreshAccessToken } from '@/lib/ebay';

export async function POST(request: Request) {
  try {
    const { refreshToken } = (await request.json()) as { refreshToken?: string };
    if (!refreshToken) {
      return Response.json({ error: 'Missing refresh token.' }, { status: 400 });
    }
    const tokens = await refreshAccessToken(refreshToken);
    return Response.json({ accessToken: tokens.access_token, expiresIn: tokens.expires_in });
  } catch (error) {
    console.error('ebay refresh failed', error);
    return Response.json({ error: 'eBay session expired. Reconnect your account in Settings.' }, { status: 500 });
  }
}
