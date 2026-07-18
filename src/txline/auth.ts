interface TokenResponse {
  token: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isTokenResponse(value: unknown): value is TokenResponse {
  return isRecord(value) && typeof value.token === 'string';
}

export async function fetchGuestJwt(origin: string): Promise<string> {
  const response = await fetch(`${origin}/auth/guest/start`, { method: 'POST' });
  if (!response.ok) {
    throw new Error(`guest jwt request failed: ${response.status}`);
  }
  const body: unknown = await response.json();
  if (!isTokenResponse(body)) {
    throw new Error('guest jwt response missing token field');
  }
  return body.token;
}
