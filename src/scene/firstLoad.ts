/**
 * First-load coordination between the Loader (HTML) and the CameraRig (r3f).
 *
 * On the very first paint the landing camera is held STATIC at the opening
 * framing so the streaming map tiles resolve for exactly that view; the branded
 * loader stays up until they have. Only once `ready` flips does the landing
 * cinematic drift begin and the loader fade — so the first thing the user sees
 * is already sharp, with no tile pop-in.
 *
 * A plain mutable (not zustand) so useFrame can read it every frame with zero
 * React churn, matching the `groundDim` pattern.
 */
export const firstLoad = { ready: false }
