/**
 * Lightweight connectivity probe.
 * Returns true if the device can reach the internet, false otherwise.
 * Uses Google's generate_204 endpoint — a minimal HEAD request that returns
 * 204 No Content when reachable. No DNS or TLS negotiation required.
 */
export const checkConnectivity = async (): Promise<boolean> => {
  try {
    const response = await fetch('https://clients3.google.com/generate_204', {
      method: 'HEAD',
      cache: 'no-store',
    });
    return response.status === 204;
  } catch {
    return false;
  }
};
