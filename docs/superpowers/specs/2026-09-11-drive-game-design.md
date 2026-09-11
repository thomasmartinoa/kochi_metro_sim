# Drive mode as a game — design

Date: 2026-09-11 · Status: draft for review · Branch: `metro`

## 1 · Goal

Drive mode today is a speedometer, a notch bar and two camera angles. It
should be a train simulator game: a real cab to drive from, a full set of
camera views, consequences for driving badly — a train taken into a curve too
fast **derails, physically**, with damage, a crash panel and a replay — and
scoring that rewards a smooth, punctual, accurate run. It must play with a
keyboard on a desktop and with touch on a phone.

Decided with the user: derailment is **physics-based** (rigid-body cars that
leave the rails and tumble), not a scripted animation.

## 2 · Non-goals

- Collisions with scheduled trains. While driving, same-direction service is
  hidden and opposing trains run on the other rail; they never interact.
- Signalling, speed restrictions other than curves and the terminal buffer,
  weather, passenger boarding simulation, multiplayer.
- Any change to Tracker or Explore. The timetable engine is untouched.

## 3 · Architecture

```
src/sim/drive.ts          pure physics-of-driving + rules + scoring (tested)
src/sim/driveCameras.ts   pure camera maths per view (tested)
src/sim/replayBuffer.ts   pure ring buffer of train transforms (tested)
src/state/useDriveStore   session: DriveState, camera view, replay, crash
src/scene/drive/
  DriveTrain.tsx          the player's cars: kinematic on rails, dynamic on derail
  DriveCamera.tsx         the one owner of the camera in drive mode
  DrivePhysics.tsx        lazy-loaded Rapier world + track colliders
  CrashFX.tsx             sparks, smoke, fire, shake, slow-motion
  Cockpit.tsx             the modelled cab, live screens, clickable controls
  ReplayTrain.tsx         ghost trainset that plays the buffer back
src/ui/drive/
  DrivePanel.tsx          desk HUD (existing, reworked), camera strip
  CrashPanel.tsx          cause, numbers, replay / restart / exit
  ReplayBar.tsx           scrub, speed, camera preset
  TouchControls.tsx       phone lever + buttons
```

The rule that holds everything together: **the pure sim decides, the scene
shows.** `drive.ts` decides when a train derails and stays deterministic and
unit-tested; Rapier only takes over the *presentation* of the wreck. Nothing
in `src/sim` imports react or three components (alignment already imports
three's maths, which is allowed).

### 3.1 · Physics: on rails vs. off them

`@react-three/rapier` (Rapier WASM), loaded with `React.lazy` the first time
Drive mode is entered — it is ~700 KB gzipped and Tracker/Explore never need
it.

- **On rails** the three cars are *kinematic* bodies whose transforms are
  written every frame from the alignment (`carPoseAt` / `trackOffsetBy`,
  exactly as now). Physics never moves a train that is on its rails, so
  ordinary driving stays deterministic and identical to today.
- **On derail** each car flips to *dynamic* with its current linear velocity,
  a lateral kick proportional to the lateral acceleration that caused it, and
  a roll impulse toward the outside of the curve. Cars keep their couplings as
  spherical joints with limits, so the set jack-knifes and drags rather than
  scattering. Colliders: a cuboid per car (18.5 × 3.9 × 2.9 m, ~40 t), the
  ground plane, and a strip of deck boxes generated along the alignment for
  ±250 m around the derail point at rail level (9 m wide, with parapet walls
  0.9 m high) so cars can hit the parapet, ride it, or go over the edge and
  fall to the ground. Nothing else in the world is a collider.
- The dynamic phase is time-limited (8 s, or when every car is at rest).
  After that the wreck is frozen in place until restart.

### 3.2 · The derail rule (in `drive.ts`)

Lateral acceleration on a curve is `a = v² · |κ|`, with `κ` the signed
curvature from `alignment.curvatureAtG` at the leading car.

| constant | value | meaning |
|---|---|---|
| `A_LAT_WARN` | 1.6 m/s² | HUD warning band, cockpit alarm |
| `A_LAT_DERAIL` | 2.6 m/s² | above this the train is derailing |
| `DERAIL_HOLD_S` | 0.6 s | must stay above the limit this long — a blip at a curve entry is survivable with the brake |
| `BUFFER_KMH` | 15 | hitting the terminal buffer stop faster than this derails too |

`curveLimitKmh(κ) = 3.6 · sqrt(A_LAT_DERAIL / |κ|)`. At the sharpest revenue
curves (≈100 m radius) that is 58 km/h; on a 300 m curve it is above the
80 km/h line limit, so only genuinely tight bends bite — which is realistic.
The HUD shows the limit of the tightest curve in the next 400 m and its
distance, so a driver who looks ahead can brake for it.

`DriveState` gains `phase: 'derailed'` and a `derail` record: chainage,
speed, the limit it broke, the curve radius, the last station passed, and
which cause (curve / buffer). Score for a derailed run is the run so far
minus 1000, and the grade is `X — Derailed`.

### 3.3 · Crash presentation

On the derail frame:
- time scale eases to 0.35 for 1.8 s, then back (slow-motion on the moment)
- sparks at each bogie for 1 s, smoke from the leading car, fire from 1.5 s
  on the car that hit hardest; camera shake scaled by impact
- the wreck is left as-is; the crash panel appears after 2.5 s

`CrashPanel`: "Derailed at 71 km/h · Kaloor curve · limit 58" (or the buffer
stop), score, and three actions: **Watch replay**, **Restart from
`<station>`** (the last station stopped at, doors open, timetable rebased),
**Exit**.

### 3.4 · Replay

`replayBuffer` records, at up to 30 Hz, the last 15 s of (time, three car
transforms, speed, notch, doors). On derail it keeps recording the dynamic
phase for 8 s more. Replay plays the buffer back onto a ghost trainset
(kinematic, same models); no physics re-simulation, so it is deterministic
and cheap. `ReplayBar`: scrub, 0.25× / 0.5× / 1×, and camera presets:
trackside (a static camera beside the track ahead of the derail point),
chase, orbit (free mouse orbit around the train), drone. Leaving replay
restores the frozen wreck.

### 3.5 · Camera rig

`DriveCamera` becomes the single owner of the camera in drive mode (today
`DriveTrain` writes it). Views are data in `driveCameras.ts`, each a pure
function of (leading-car pose, heading, speed, dt) → (eye, target), with its
own damping:

| view | where | notes |
|---|---|---|
| cockpit | driver's eye in the modelled cab | mouse-look, limited yaw/pitch; default view |
| cab | just ahead of the nose | today's cab view |
| chase | 85 m back, 32 m up | today's chase; mouse orbit around the train |
| chase-far | 220 m back, 90 m up | the whole set in the city |
| left / right | trackside dolly pacing the train, 22 m out, 3 m up | the "GoPro on a car alongside" shot |
| nose / roof | on the body | GoPro mounts, wide FOV |
| trackside | a static camera 70 m ahead beside the track; when the train passes 40 m beyond, it jumps to the next spot ahead | the classic rail-sim cinematic |
| drone | 150 m above, slowly circling | |

Keys: **C** cycles, **1–9** direct. A camera strip in the drive HUD (icons)
does the same for touch. Cockpit becomes the default view when a run starts
once phase 6e lands; until then the default is cab.

### 3.6 · Cockpit

The cab the user has modelled in Blender (two displays, gauges, master
controller lever, E-stop, button clusters, seat) is exported to
`metro-cockpit.glb` and mounted as a child of the leading car, drawn only in
cockpit view. Blocked on reading the scene through Blender MCP: the lever's
object name and hinge origin, and the names of the E-stop, door and horn
buttons and the two screens. The export script's collection selection
(`mesh_objs('cockpit')`) is fixed against the real scene at the same time.

- **Screens** are `CanvasTexture`s redrawn at 10 Hz: left — speedometer,
  notch, next stop and distance, doors; right — curve-limit lookahead,
  timetable (early/late), score. Both dim at night with the cab.
- **Lever** rotates about its hinge with the notch; drag it with the mouse
  (vertical drag → notch) or click above/below the grip.
- **Buttons** are raycast targets: E-stop (emergency brake), doors, horn,
  headlights. Pressed state = a small translate + emissive.
- Everything the cockpit does, the keyboard and the touch panel also do —
  the cab is a way to play, not the only way.

### 3.7 · Controls and scoring

New inputs: **H** horn, **O** doors open/close, **L** headlights (auto-on
after dusk; the beam is a spotlight on the leading car), **Space** emergency
(existing). Doors gate departure: power is refused with doors open, and
closing them at a station starts the dwell timer (today the dwell is a fixed
10 s).

Score per run:
- stop accuracy (existing): PERFECT / GREAT / GOOD / OFF MARK / MISSED
- **comfort**: jerk penalty per notch step at speed (a notch change while
  moving costs points scaled by the change), and a lateral-acceleration
  penalty for taking a curve in the warning band
- **punctuality**: a schedule for the run is derived from the real timetable
  (the next real trip's stop times, rebased to the moment power is first
  applied); each stop shows early/late seconds and scores ±
- **derail**: −1000 and the run ends

Grade combines them; the results panel shows each stop's line and the three
totals. The existing `grade()` bands stay.

### 3.8 · Touch and phones

`TouchControls` shows when the pointer is coarse or the viewport is narrow: a
vertical lever slider (drag = notch, snaps to detents, springs to the current
notch), and doors / horn / camera / E-stop buttons along the bottom. The desk
HUD collapses to speed, notch and next stop. Landscape is recommended with a
one-time hint, not enforced.

## 4 · Data flow

```
keyboard / touch / cockpit click
        │
        ▼
useDriveStore (intents: notch, doors, horn, view, restart, replay)
        │  tick(dt) — wall-clock, idempotent per frame
        ▼
src/sim/drive.ts  stepDrive(state, dt, curvatureAtG) → DriveState
        │  phase run/dwell/derailed/done, derail record, score, doors
        ├──► DriveTrain    kinematic car transforms (carPoseAt)  | dynamic on derail
        ├──► DriveCamera   view maths → camera
        ├──► DrivePanel / Cockpit screens
        ├──► replayBuffer.push(transforms)
        └──► CrashFX / CrashPanel on phase === 'derailed'
```

## 5 · Phases (each its own commit, each verified in the browser)

| # | phase | depends on |
|---|---|---|
| 6a | derail rule in `drive.ts` (tests), Rapier world, kinematic→dynamic switch, deck colliders, crash FX, crash panel, restart from station | — |
| 6b | camera rig: `driveCameras.ts` (tests), `DriveCamera`, all views, keys + strip | — |
| 6c | replay buffer (tests), ghost trainset, replay bar and cameras | 6a |
| 6d | doors / horn / lights, comfort + punctuality scoring, results panel | — |
| 6e | cockpit: export, mount, screens, lever, buttons | Blender MCP |
| 6f | touch controls, phone HUD, landscape hint | 6b, 6d |

6a and 6b are independent and come first; 6e waits for the cockpit export.

## 6 · Testing

- `drive.test.ts`: curve limit maths at known radii; a train under the limit
  never derails; over it for < hold time survives; over it for > hold time
  derails with the right record; buffer-stop derail; doors gate power; dwell
  starts on door close; comfort and punctuality scoring on scripted runs.
- `driveCameras.test.ts`: each view returns a finite eye/target; trackside
  jumps ahead when passed; chase keeps its distance on a curve.
- `replayBuffer.test.ts`: ring semantics, 15 s window, dynamic-phase extension.
- Scene: Playwright screenshots of every camera view, the derail sequence
  (frames at 0 / 1 / 3 / 8 s), the crash panel, replay from each preset, and
  the phone layout — per CLAUDE.md, visual changes are verified in the browser.

## 7 · Open points

- Rapier determinism across devices is not required (replay plays recorded
  transforms, never re-simulates).
- The cockpit lever's hinge axis and the screen mesh UVs are read from Blender
  once MCP is up; if a screen's UVs are unusable, the MFD is drawn on a quad
  placed over it instead.
- Fire is a shader-noise billboard, not a particle system, to stay cheap on
  phones.
