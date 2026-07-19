function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`missing env ${name}`);
  }
  return value;
}

export async function txlineGet(path: string): Promise<unknown> {
  const origin = requireEnv('TXLINE_API_ORIGIN');
  const jwt = requireEnv('TXLINE_JWT');
  const apiToken = requireEnv('TXLINE_API_TOKEN');

  const response = await fetch(`${origin}${path}`, {
    headers: { Authorization: `Bearer ${jwt}`, 'X-Api-Token': apiToken },
  });
  if (!response.ok) {
    throw new Error(`txline GET ${path} failed: ${response.status}`);
  }
  return response.json();
}
