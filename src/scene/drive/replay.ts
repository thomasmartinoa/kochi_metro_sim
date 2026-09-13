/**
 * The replay's live state — the buffer, and playback position/speed while
 * a replay is being watched. Plain mutable like rig/wreck; the store holds
 * only the mode flag so the HUD re-renders on enter/leave.
 */
import { ReplayBuffer } from '../../sim/replayBuffer'

export const replay = {
  buffer: new ReplayBuffer(30, 30),
  /** seconds of drive time recorded so far; the buffer's clock */
  clock: 0,
  /** playback head, in buffer time */
  head: 0,
  /** 0.25 / 0.5 / 1 */
  rate: 1,
  playing: true,
  /** true after the derail's dynamic phase has been recorded */
  sealed: false,
}
