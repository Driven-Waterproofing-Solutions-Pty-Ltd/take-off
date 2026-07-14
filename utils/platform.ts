// Single source of truth for runtime platform detection. Inside a Tauri WebView
// `navigator` always exists; the guard keeps this safe in any non-DOM context.
export const isMobilePlatform = (): boolean =>
  typeof navigator !== 'undefined' && /android|iphone|ipad|ipod/i.test(navigator.userAgent);
