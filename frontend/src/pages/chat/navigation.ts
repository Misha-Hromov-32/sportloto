/** Only return to a page within this app; direct chat links fall back to the catalogue. */
export function assistantReturnTo(state: unknown): string {
  const value =
    state && typeof state === 'object' ? (state as Record<string, unknown>).assistantReturnTo : undefined;
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    Array.from(value).some((char) => char.charCodeAt(0) < 32)
  ) {
    return '/events';
  }
  const url = new URL(value, 'https://assistant.invalid');
  if (url.origin !== 'https://assistant.invalid' || /^\/assistant(?:\/|$)/.test(url.pathname))
    return '/events';
  return `${url.pathname}${url.search}${url.hash}`;
}
