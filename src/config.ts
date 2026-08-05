/**
 * Build-time feature flags (Vite env vars, prefix VITE_).
 *
 * WATER_METRO_ENABLED — whether the Water Metro is a live, enterable experience.
 *   Default (unset / anything but "true") = OFF: the landing page shows a
 *   "Coming soon" card and #/water redirects to the landing page.
 *   Enable it by setting VITE_WATER_METRO=true — locally in `.env.local`, or as
 *   an env var on the `water` branch's Vercel deployment. Production (`main`)
 *   leaves it unset, so the live site stays metro-only until we ship it.
 */
export const WATER_METRO_ENABLED = import.meta.env.VITE_WATER_METRO === 'true'
