const DEFAULT_TARGET = '/dashboard';

/** Accept same-origin path targets only; reject URL-parser backslash normalization. */
export function safeRedirectTarget(value: FormDataEntryValue | string | null | undefined): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return DEFAULT_TARGET;
  }
  if (value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) return DEFAULT_TARGET;

  try {
    const target = new URL(value, 'https://internal.invalid');
    if (target.origin !== 'https://internal.invalid') return DEFAULT_TARGET;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return DEFAULT_TARGET;
  }
}
