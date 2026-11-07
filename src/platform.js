// The one place that knows where the app is running. The desktop app's preload script
// (electron/preload.cjs) exposes termeedorHost, and the browser build has none.

/** What the desktop app offers the page, or null in the browser build. */
export const host = globalThis.termeedorHost ?? null;

export const isDesktop = !!host;

export const isMac = (globalThis.navigator?.platform ?? "").startsWith("Mac");
