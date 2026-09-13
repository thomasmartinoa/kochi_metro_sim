/**
 * The derailed trainset as rigid bodies.
 *
 * Mounted (lazily — Rapier is ~850 KB gzipped and Tracker never needs it)
 * for as long as Drive mode is open, so the physics world already exists
 * when a crash comes: creating it on the derail frame was a visible hitch.
 * Nothing is in the world until the sim derails. Then three dynamic cuboids
 * spawn in the cars' last on-rail poses, carrying the set's velocity plus a
 * lateral kick, a roll and a lift toward the outside of the curve, joined at
 * the couplers so the set jack-knifes rather than scatters; under them a
 * strip of deck and parapet colliders along the line, and the ground.
 * Stepped by hand so the first moments run in slow motion.
 */
import { useFrame } from '@react-three/fiber'
import {
  CuboidCollider,
  interactionGroups,
  Physics,
  RigidBody,
  useRapier,
  useSphericalJoint,
  type RapierRigidBody,
} from '@react-three/rapier'
import { createRef, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import * as THREE from 'three'
import { MODEL_CAR_PITCH_M, TRAINSET } from '../../data/trainset'
import { A_LAT_DERAIL } from '../../sim/drive'
import { centerAtG, gAt, leftOf } from '../../sim/alignment'
import { useDriveStore } from '../../state/useDriveStore'
import { CarModel, useCarParts } from '../MetroTrain'
import { CrashFX } from './CrashFX'
import { wreck } from './wreck'

/** deck colliders this far either side of the derail point */
const DECK_REACH_M = 250
const DECK_STEP_M = 10
const DECK_W = 9
const DECK_T = 0.6
const PARAPET_H = 0.9
const PARAPET_T = 0.3
/** slow motion on the moment: time scale, and how much physics time it covers */
const SLOW_SCALE = 0.35
const SLOW_S = 0.7
/** the wreck stops simulating after this much physics time and stays put */
const SETTLE_S = 8
/**
 * How hard the set is thrown, per m/s² of lateral acceleration beyond the
 * derail limit. Tuned to look like a derailment, not to a textbook: a box the
 * size of a car needs about 2.2 rad/s of roll to tip over its own edge, and
 * the parapet it lands against is what it then rolls over.
 */
const KICK_PER_EXCESS = 3.0
const ROLL_PER_EXCESS = 2.4
/** the climbing wheel lifts the car; most on the lead car, least on the rear */
const LIFT_PER_EXCESS = 1.0
const LIFT_BY_CAR = [1.0, 0.6, 0.3]
const CAR_MASS_KG = 40000
const CAR_FRICTION = 0.5
/**
 * A car's collider is a little shorter than the pitch: the cars are joined at
 * the couplers, and if their boxes also touched end to end every contact
 * would fight the joint and the set would jitter in place instead of moving.
 */
const CAR_BOX_LEN = MODEL_CAR_PITCH_M * 0.92
/** spawn a hair above the deck so nothing starts the sim already penetrating */
const SPAWN_LIFT_M = 0.05
/**
 * Collision groups: our cars collide with the structure and with the train
 * we hit, never with each other (the joints hold them; contacts between
 * coupled bodies only add noise). The struck train likewise.
 */
const GROUP_CAR = 0
const GROUP_STRUCTURE = 1
const GROUP_OTHER = 2
const CARS = interactionGroups([GROUP_CAR], [GROUP_STRUCTURE, GROUP_OTHER])
// the struck train's cars do collide with each other: its rear car is shoved
// into the standing car ahead of it and has to crumple or fold sideways, not
// pass through it
const OTHER = interactionGroups([GROUP_OTHER], [GROUP_STRUCTURE, GROUP_CAR, GROUP_OTHER])
const STRUCTURE = interactionGroups([GROUP_STRUCTURE], [GROUP_CAR, GROUP_OTHER])
/**
 * A collision is not a derailment: the set keeps its momentum and the
 * contact with the train ahead does the damage. A small sideways nudge on
 * the leading car seeds the jackknife, and the seam lifts a little as the
 * couplers ride up.
 */
/** the struck train has its brakes on: it is shoved, not sent rolling */
const STRUCK_BRAKE_DAMPING = 1.6
const STRUCK_FRICTION = 0.9
const COLLISION_SIDE_MS = 1.4
const COLLISION_LIFT_MS = 0.9
const COLLISION_YAW = 0.35

function Deck({ gM }: { gM: number }) {
  const slabs = useMemo(() => {
    const out: { pos: THREE.Vector3; rotY: number }[] = []
    for (let g = gM - DECK_REACH_M; g <= gM + DECK_REACH_M; g += DECK_STEP_M) {
      const { pos, tan } = centerAtG(g)
      out.push({ pos: pos.clone().setY(pos.y - DECK_T / 2), rotY: Math.atan2(tan.x, tan.z) })
    }
    return out
  }, [gM])
  const mid = slabs[Math.floor(slabs.length / 2)].pos
  return (
    <>
      {slabs.map((s, i) => (
        <RigidBody key={i} type="fixed" position={s.pos} rotation={[0, s.rotY, 0]}>
          <CuboidCollider args={[DECK_W / 2, DECK_T / 2, DECK_STEP_M / 2]} collisionGroups={STRUCTURE} />
          <CuboidCollider
            args={[PARAPET_T / 2, PARAPET_H / 2, DECK_STEP_M / 2]}
            position={[DECK_W / 2, DECK_T / 2 + PARAPET_H / 2, 0]}
            collisionGroups={STRUCTURE}
          />
          <CuboidCollider
            args={[PARAPET_T / 2, PARAPET_H / 2, DECK_STEP_M / 2]}
            position={[-DECK_W / 2, DECK_T / 2 + PARAPET_H / 2, 0]}
            collisionGroups={STRUCTURE}
          />
        </RigidBody>
      ))}
      {/* the ground, wide enough for anything that leaves the deck */}
      <RigidBody type="fixed" position={[mid.x, -0.5, mid.z]}>
        <CuboidCollider args={[600, 0.5, 600]} collisionGroups={STRUCTURE} />
      </RigidBody>
    </>
  )
}

function Coupler({ a, b }: { a: RefObject<RapierRigidBody | null>; b: RefObject<RapierRigidBody | null> }) {
  // spherical joint at the shared coupler: half a car pitch behind a, ahead of b
  // (the hook wants non-null refs; they are populated before it attaches)
  useSphericalJoint(a as RefObject<RapierRigidBody>, b as RefObject<RapierRigidBody>, [
    [0, 1.2, -MODEL_CAR_PITCH_M / 2],
    [0, 1.2, MODEL_CAR_PITCH_M / 2],
  ])
  return null
}

/** Steps the world by hand (slow motion first), publishes the lead car for the camera. */
function LeadTracker({
  body,
  bodies,
  struck,
}: {
  body: RefObject<RapierRigidBody | null>
  bodies: RefObject<RapierRigidBody | null>[]
  struck: RefObject<RapierRigidBody | null>[] | null
}) {
  const { step } = useRapier()
  const acc = useRef(0)
  const proxies = useMemo(() => bodies.map(() => new THREE.Object3D()), [bodies])
  const struckProxies = useMemo(() => (struck ?? []).map(() => new THREE.Object3D()), [struck])
  useEffect(() => {
    wreck.simT = 0
    // the proxies start in the spawn poses, so the tape never sees a frame
    // of bodies at the origin before the first step has mirrored them
    proxies.forEach((o, i) => {
      const c = wreck.cars[i]
      if (c) o.position.copy(c.position), o.quaternion.copy(c.quaternion)
    })
    struckProxies.forEach((o, i) => {
      const c = wreck.struck?.cars[i]
      if (c) o.position.copy(c.position), o.quaternion.copy(c.quaternion)
    })
    // the bodies are in the world from here: the plain cars may hide now
    wreck.live = true
    wreck.bodies = proxies
    wreck.struckBodies = struckProxies
    // fixed 1/60 steps: the accumulator keeps it frame-rate independent
    wreck.advance = (dt: number) => {
      acc.current += dt
      while (acc.current >= 1 / 60) {
        step(1 / 60)
        acc.current -= 1 / 60
        wreck.simT += 1 / 60
      }
      const t = body.current?.translation()
      if (t) wreck.lead.set(t.x, t.y, t.z)
      // mirror the bodies' transforms onto plain objects the replay can read
      const mirror = (b: RefObject<RapierRigidBody | null>, o: THREE.Object3D) => {
        const rb = b.current
        if (!rb) return
        const p = rb.translation()
        const q = rb.rotation()
        o.position.set(p.x, p.y, p.z)
        o.quaternion.set(q.x, q.y, q.z, q.w)
      }
      bodies.forEach((b, i) => mirror(b, proxies[i]))
      struck?.forEach((b, i) => mirror(b, struckProxies[i]))
    }
    return () => {
      wreck.advance = null
      wreck.live = false
      wreck.bodies = []
      wreck.struckBodies = []
    }
  }, [step, body, bodies, proxies, struck, struckProxies])
  useFrame((_, dt) => {
    if (wreck.simT >= SETTLE_S) return
    const scale = wreck.simT < SLOW_S ? SLOW_SCALE : 1
    wreck.advance?.(Math.min(dt, 0.1) * scale)
  })
  return null
}

function Cars() {
  const parts = useCarParts()
  const refs = useMemo(() => [0, 1, 2].map(() => createRef<RapierRigidBody>()), [])
  const initial = useMemo(() => {
    const travel = wreck.velocity.clone().normalize()
    if (wreck.struck) {
      // a collision: straight on, into the train ahead; the physics takes it
      // from there. The nudge picks a side so the set folds rather than
      // stacking up dead straight.
      const side = Math.random() < 0.5 ? -1 : 1
      const sideways = leftOf(travel).multiplyScalar(side)
      return LIFT_BY_CAR.map((lift, i) => ({
        lin: wreck.velocity
          .clone()
          .addScaledVector(sideways, i === 0 ? COLLISION_SIDE_MS : 0)
          .add(new THREE.Vector3(0, COLLISION_LIFT_MS * lift, 0)),
        ang: new THREE.Vector3(0, i === 0 ? side * COLLISION_YAW : 0, 0),
      }))
    }
    // never less than a real shove, however marginal the excess: a derailment
    // that merely slides to a halt reads as a bug, not a crash
    const excess = Math.max(1.2, wreck.lateralMs2 - A_LAT_DERAIL)
    // the outside of the bend: opposite the side it turns toward
    const side = -Math.sign(wreck.kappa || 1)
    const outward = leftOf(travel).multiplyScalar(side)
    // roll about the travel axis, toward the outside
    const ang = travel.clone().multiplyScalar(side * ROLL_PER_EXCESS * excess)
    return LIFT_BY_CAR.map((lift) => ({
      lin: wreck.velocity
        .clone()
        .addScaledVector(outward, KICK_PER_EXCESS * excess)
        .add(new THREE.Vector3(0, LIFT_PER_EXCESS * excess * lift, 0)),
      ang: ang.clone().multiplyScalar(0.6 + 0.4 * lift),
    }))
  }, [])
  const struckRefs = useMemo(() => [0, 1, 2].map(() => createRef<RapierRigidBody>()), [])
  const struckVel = useMemo(() => {
    if (!wreck.struck) return new THREE.Vector3()
    // along its own heading, at the timetable's speed
    return new THREE.Vector3(0, 0, 1).applyQuaternion(wreck.struck.cars[2].quaternion).multiplyScalar(wreck.struck.speedMs)
  }, [])
  return (
    <>
      {wreck.cars.map((c, i) => (
        <RigidBody
          key={i}
          ref={refs[i]}
          name="wreck-car"
          type="dynamic"
          position={[c.position.x, c.position.y + SPAWN_LIFT_M, c.position.z]}
          quaternion={c.quaternion.toArray() as [number, number, number, number]}
          linearVelocity={[initial[i].lin.x, initial[i].lin.y, initial[i].lin.z]}
          angularVelocity={[initial[i].ang.x, initial[i].ang.y, initial[i].ang.z]}
          linearDamping={0.05}
          angularDamping={0.25}
          colliders={false}
        >
          <CuboidCollider
            args={[TRAINSET.widthM / 2, TRAINSET.heightM / 2, CAR_BOX_LEN / 2]}
            position={[0, TRAINSET.heightM / 2, 0]}
            mass={CAR_MASS_KG}
            friction={CAR_FRICTION}
            restitution={0.05}
            collisionGroups={CARS}
          />
          <CarModel slot={i as 0 | 1 | 2} parts={parts} />
        </RigidBody>
      ))}
      <Coupler a={refs[0]} b={refs[1]} />
      <Coupler a={refs[1]} b={refs[2]} />
      {wreck.struck &&
        // the train we hit: three coupled cars of the same weight as ours,
        // where the timetable had them, at its speed. Its brakes are on
        // (the damping), so the shove is a few metres and the rear car,
        // caught between us and the car ahead of it, is what folds.
        wreck.struck.cars.map((c, i) => (
          <RigidBody
            key={`struck-${i}`}
            ref={struckRefs[i]}
            name="struck-car"
            type="dynamic"
            position={[c.position.x, c.position.y + SPAWN_LIFT_M, c.position.z]}
            quaternion={c.quaternion.toArray() as [number, number, number, number]}
            linearVelocity={[struckVel.x, struckVel.y, struckVel.z]}
            linearDamping={STRUCK_BRAKE_DAMPING}
            angularDamping={0.4}
            colliders={false}
          >
            <CuboidCollider
              args={[TRAINSET.widthM / 2, TRAINSET.heightM / 2, CAR_BOX_LEN / 2]}
              position={[0, TRAINSET.heightM / 2, 0]}
              mass={CAR_MASS_KG}
              friction={STRUCK_FRICTION}
              restitution={0.05}
              collisionGroups={OTHER}
            />
            <CarModel slot={i as 0 | 1 | 2} parts={parts} />
          </RigidBody>
        ))}
      {wreck.struck && <Coupler a={struckRefs[0]} b={struckRefs[1]} />}
      {wreck.struck && <Coupler a={struckRefs[1]} b={struckRefs[2]} />}
      <LeadTracker body={refs[0]} bodies={refs} struck={wreck.struck ? struckRefs : null} />
      <CrashFX />
    </>
  )
}

/** Hides the wreck's meshes (not its physics) while the replay ghost is shown. */
function WreckVisibility({ children }: { children: ReactNode }) {
  const replaying = useDriveStore((s) => s.replaying)
  return <group visible={!replaying}>{children}</group>
}

export default function DriveWreck() {
  const derail = useDriveStore((s) => s.drive?.derail ?? null)
  // DriveTrain writes the hand-off in its useFrame on the derail frame; this
  // runs later in the same frame (it mounted later), so the bodies are asked
  // for on the very next render, in the plain cars' exact poses
  const [armed, setArmed] = useState(false)
  useFrame(() => {
    if (derail && wreck.ready && !armed) setArmed(true)
    else if (!derail && armed) setArmed(false)
  })
  const active = !!derail && armed
  return (
    <Physics gravity={[0, -9.81, 0]} paused>
      {active && <Deck gM={gAt(derail.sKm)} />}
      {active && (
        <WreckVisibility>
          <Cars />
        </WreckVisibility>
      )}
    </Physics>
  )
}
