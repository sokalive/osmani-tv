export const BASE_URL = 'https://osmani-admin-api.onrender.com';

export async function getChannels() {
  const res = await fetch(`${BASE_URL}/api/channels`);
  let body;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const extra =
      body && typeof body === 'object' && body.error != null
        ? ` — ${String(body.error)}`
        : '';
    throw new Error(`Could not load channels (${res.status})${extra}`);
  }
  if (!Array.isArray(body)) {
    throw new Error('Could not load channels (invalid response)');
  }
  return body;
}