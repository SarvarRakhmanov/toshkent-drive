"use client";

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { PersonFigure, PERSON_MODEL_HEIGHT } from "@/components/PersonFigure";
import { AirlinerMesh, AIRLINER_GROUND_Y } from "@/components/Airliner";

// Everything that MOVES at INTERNATIONAL AIRPORT: the airliners flying the
// departure/arrival circuit, the ground crew, the security patrols and the
// work vehicles buzzing around the apron. Static structure lives in
// components/Airport.tsx; this file is imported from there and rendered
// inside the same <group position={[AX,0,AZ]}>, so every coordinate here is
// airport-local, exactly like Airport.tsx's own.
//
// Nothing here is physics-driven. Every mover is a keyframed path sampled per
// frame (pathAt below) — the same "kinematic, no collider, dressing not
// gameplay" call components/Traffic.tsx and Airport.tsx's parked cruisers
// make. A rapier body per airliner would cost far more and buy nothing: you
// can't drive these, only the player's own plane (components/Plane.tsx).

// ---------------------------------------------------------------- paths ----

export interface Key {
  t: number;
  x: number;
  y: number;
  z: number;
}

// Piecewise-linear sample with a cosine ease inside each leg, so corners
// round off instead of snapping. Times are seconds; the list must be sorted
// and is looped modulo the last key's t.
function pathAt(keys: Key[], t: number, out: THREE.Vector3) {
  const period = keys[keys.length - 1].t;
  let u = t % period;
  if (u < 0) u += period;
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].t <= u) i++;
  const a = keys[i],
    b = keys[i + 1];
  const span = Math.max(1e-3, b.t - a.t);
  const k = (1 - Math.cos(((u - a.t) / span) * Math.PI)) / 2;
  out.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
  return out;
}

// Shortest-arc angle lerp — headings come from finite-differencing the path,
// which wraps through ±PI whenever a mover turns past south.
function angLerp(from: number, to: number, k: number) {
  let d = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return from + d * k;
}

// Drives a group along `keys`: position, heading (from travel direction),
// pitch (from climb rate) and bank (from turn rate). One shared hook so the
// airliners, the work vehicles and the walking crew all move the same way.
// exported so other landmarks with their own moving dressing (e.g.
// components/MilitaryBase.tsx's fighter-jet flyover and patrolling guard)
// can reuse the same keyframed-path/bank/pitch driver instead of a second copy
export function usePathFollower(
  keys: Key[],
  ref: React.RefObject<THREE.Group | null>,
  opts: { offset?: number; bank?: number; pitch?: number; groundY?: number } = {}
) {
  const state = useRef({ h: 0, pitch: 0, roll: 0 });
  const p = useMemo(() => new THREE.Vector3(), []);
  const q = useMemo(() => new THREE.Vector3(), []);
  const r = useMemo(() => new THREE.Vector3(), []);
  useFrame((s, dt) => {
    const g = ref.current;
    if (!g) return;
    const d = Math.min(dt, 0.05);
    const t = s.clock.elapsedTime + (opts.offset ?? 0);
    pathAt(keys, t, p);
    pathAt(keys, t + 0.35, q);
    const dx = q.x - p.x,
      dz = q.z - p.z,
      dy = q.y - p.y;
    if (Math.abs(dx) + Math.abs(dz) > 1e-4) {
      state.current.h = angLerp(state.current.h, Math.atan2(dx, dz), Math.min(1, d * 2.5));
    }
    // Bank angle, from path curvature rather than this frame's heading delta
    // over dt: dividing a frame-to-frame turn by a variable, sometimes-tiny
    // dt was the actual source of the reported glitching — any frame-rate
    // hitch (and this airport adds a lot of draw calls) spiked the estimated
    // turn rate and made the roll visibly snap. Comparing two path-time
    // samples 0.35s apart is a function of the clock, not of how long the
    // last frame took, so it stays smooth regardless of frame-rate variance.
    pathAt(keys, t - 0.35, r);
    const pdx = p.x - r.x,
      pdz = p.z - r.z;
    let targetRoll = 0;
    if (Math.abs(dx) + Math.abs(dz) > 1e-4 && Math.abs(pdx) + Math.abs(pdz) > 1e-4) {
      const dh = Math.atan2(Math.sin(Math.atan2(dx, dz) - Math.atan2(pdx, pdz)), Math.cos(Math.atan2(dx, dz) - Math.atan2(pdx, pdz)));
      targetRoll = -(dh / 0.35) * (opts.bank ?? 0);
    }
    state.current.roll += (targetRoll - state.current.roll) * Math.min(1, d * 3);
    const speed = Math.hypot(dx, dz) / 0.35;
    const targetPitch = speed > 0.5 ? Math.atan2(dy / 0.35, speed) * (opts.pitch ?? 0) : 0;
    state.current.pitch += (targetPitch - state.current.pitch) * Math.min(1, d * 1.5);
    g.position.set(p.x, p.y + (opts.groundY ?? 0), p.z);
    g.rotation.set(state.current.pitch, state.current.h, state.current.roll, "YXZ");
  });
}

// ------------------------------------------------------------- airliners ----

// One full departure→circuit→arrival→gate cycle, ~215s, parameterised by the
// aircraft's own gate x. Ground legs are slow (taxi ~8 m/s), the takeoff roll
// and climb are fast — that difference is entirely in the chosen times, which
// is why the path is time-keyed rather than an arc-length curve.
export function circuitKeys(gateX: number): Key[] {
  return [
    { t: 0, x: gateX, y: 0, z: 20 },
    { t: 12, x: gateX, y: 0, z: -60 },
    { t: 18, x: gateX - 34, y: 0, z: -105 },
    { t: 38, x: -170, y: 0, z: -105 },
    { t: 45, x: -205, y: 0, z: -140 },
    { t: 50, x: -208, y: 0, z: -165 },
    { t: 62, x: -60, y: 0, z: -165 },
    { t: 68, x: 70, y: 9, z: -165 },
    { t: 80, x: 270, y: 62, z: -165 },
    { t: 93, x: 470, y: 112, z: -50 },
    { t: 106, x: 400, y: 125, z: 190 },
    { t: 118, x: 0, y: 125, z: 280 },
    { t: 131, x: -430, y: 115, z: 130 },
    { t: 143, x: -520, y: 82, z: -90 },
    { t: 153, x: -430, y: 40, z: -165 },
    { t: 163, x: -262, y: 11, z: -165 },
    { t: 169, x: -212, y: 0, z: -165 },
    { t: 181, x: 20, y: 0, z: -165 },
    { t: 188, x: 74, y: 0, z: -128 },
    { t: 194, x: 74, y: 0, z: -105 },
    { t: 206, x: gateX + 26, y: 0, z: -70 },
    { t: 218, x: gateX, y: 0, z: 20 },
    { t: 236, x: gateX, y: 0, z: 20 },
  ];
}

// A taxiing-only aircraft: never leaves the ground, just shuffles between the
// remote stands and the cargo apron. Cheap way to keep the tarmac alive
// without every jet in the world being airborne at once.
function taxiKeys(x0: number, z0: number, x1: number, z1: number): Key[] {
  return [
    { t: 0, x: x0, y: 0, z: z0 },
    { t: 30, x: x0, y: 0, z: -80 },
    { t: 48, x: (x0 + x1) / 2, y: 0, z: -95 },
    { t: 70, x: x1, y: 0, z: -80 },
    { t: 92, x: x1, y: 0, z: z1 },
    { t: 108, x: x1, y: 0, z: z1 },
    { t: 130, x: x1, y: 0, z: -80 },
    { t: 152, x: (x0 + x1) / 2, y: 0, z: -95 },
    { t: 174, x: x0, y: 0, z: -80 },
    { t: 196, x: x0, y: 0, z: z0 },
    { t: 214, x: x0, y: 0, z: z0 },
  ];
}

function MovingAirliner({
  keys,
  offset,
  liveryColor,
  cargo,
}: {
  keys: Key[];
  offset: number;
  liveryColor: string;
  cargo?: boolean;
}) {
  const ref = useRef<THREE.Group>(null);
  usePathFollower(keys, ref, { offset, bank: 0.5, pitch: 0.9, groundY: AIRLINER_GROUND_Y });
  return (
    <group ref={ref}>
      <AirlinerMesh liveryColor={liveryColor} cargo={cargo} />
    </group>
  );
}

// ------------------------------------------------------- ground vehicles ----

const VEH_DARK = new THREE.MeshStandardMaterial({ color: "#1a1d22", roughness: 0.6, metalness: 0.4 });
const VEH_GLASS = new THREE.MeshStandardMaterial({
  color: "#16212e",
  metalness: 0.9,
  roughness: 0.08,
  transparent: true,
  opacity: 0.6,
});
const HIVIS_MAT = new THREE.MeshStandardMaterial({ color: "#f2c00a", roughness: 0.5, metalness: 0.2 });
const WHITE_MAT = new THREE.MeshStandardMaterial({ color: "#dfe3e8", roughness: 0.5, metalness: 0.3 });
const AMBER_MAT = new THREE.MeshBasicMaterial({ color: "#ffa219" });
const STEEL_MAT = new THREE.MeshStandardMaterial({ color: "#7d838b", metalness: 0.7, roughness: 0.4 });

function Wheels({ w, z0, z1, r = 0.4 }: { w: number; z0: number; z1: number; r?: number }) {
  return (
    <>
      {[z0, z1].map((z) =>
        [1, -1].map((s) => (
          <mesh key={`${z}:${s}`} position={[s * w, r, z]} rotation={[0, 0, Math.PI / 2]} material={VEH_DARK}>
            <cylinderGeometry args={[r, r, 0.28, 10]} />
          </mesh>
        ))
      )}
    </>
  );
}

// Rotating amber beacon — every airside vehicle has one, and it's the single
// cheapest cue that the apron is a working, hazardous place.
function Beacon({ y }: { y: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((s) => {
    if (ref.current) ref.current.scale.setScalar(0.7 + 0.55 * (0.5 + 0.5 * Math.sin(s.clock.elapsedTime * 9)));
  });
  return (
    <mesh ref={ref} position={[0, y, 0]} material={AMBER_MAT}>
      <sphereGeometry args={[0.16, 8, 8]} />
    </mesh>
  );
}

export type VehKind = "tug" | "baggage" | "fuel" | "stairs" | "catering" | "pushback";

export function WorkVehicleMesh({ kind }: { kind: VehKind }) {
  if (kind === "fuel") {
    return (
      <group>
        <mesh position={[0, 1.1, 1.9]} material={WHITE_MAT} castShadow>
          <boxGeometry args={[2.4, 1.8, 3.0]} />
        </mesh>
        <mesh position={[0, 1.75, 3.3]} material={VEH_GLASS}>
          <boxGeometry args={[2.2, 0.9, 0.3]} />
        </mesh>
        <mesh position={[0, 1.5, -1.6]} rotation={[Math.PI / 2, 0, 0]} material={STEEL_MAT} castShadow>
          <cylinderGeometry args={[1.25, 1.25, 6.4, 14]} />
        </mesh>
        <mesh position={[0, 2.5, -1.6]} material={HIVIS_MAT}>
          <boxGeometry args={[0.9, 0.5, 5.6]} />
        </mesh>
        <Wheels w={1.25} z0={2.6} z1={-3.4} r={0.55} />
        <Beacon y={3.9} />
      </group>
    );
  }
  if (kind === "stairs") {
    return (
      <group>
        <mesh position={[0, 0.9, 2.0]} material={WHITE_MAT} castShadow>
          <boxGeometry args={[2.2, 1.6, 2.6]} />
        </mesh>
        <mesh position={[0, 1.6, 3.1]} material={VEH_GLASS}>
          <boxGeometry args={[2.0, 0.8, 0.25]} />
        </mesh>
        {/* stair flight rising toward the aircraft door height (~5m) */}
        <mesh position={[0, 3.0, -1.6]} rotation={[0.62, 0, 0]} material={STEEL_MAT} castShadow>
          <boxGeometry args={[2.0, 0.2, 7.2]} />
        </mesh>
        {Array.from({ length: 9 }, (_, i) => (
          <mesh key={i} position={[0, 0.9 + i * 0.48, 0.6 - i * 0.62]} material={STEEL_MAT}>
            <boxGeometry args={[1.9, 0.09, 0.5]} />
          </mesh>
        ))}
        {[1, -1].map((s) => (
          <mesh key={s} position={[s * 0.95, 3.7, -1.6]} rotation={[0.62, 0, 0]} material={HIVIS_MAT}>
            <boxGeometry args={[0.08, 1.2, 7.2]} />
          </mesh>
        ))}
        <Wheels w={1.1} z0={2.4} z1={-3.6} r={0.45} />
        <Beacon y={2.0} />
      </group>
    );
  }
  if (kind === "catering") {
    return (
      <group>
        <mesh position={[0, 1.0, 2.2]} material={WHITE_MAT} castShadow>
          <boxGeometry args={[2.3, 1.8, 2.4]} />
        </mesh>
        <mesh position={[0, 1.7, 3.3]} material={VEH_GLASS}>
          <boxGeometry args={[2.1, 0.8, 0.25]} />
        </mesh>
        {/* scissor-lift box raised to main-deck door height */}
        <mesh position={[0, 3.4, -1.4]} material={WHITE_MAT} castShadow>
          <boxGeometry args={[2.5, 3.0, 4.6]} />
        </mesh>
        {[0.6, -0.6].map((s) => (
          <mesh key={s} position={[0, 1.4, -1.4 + s]} rotation={[0, 0, 0.3 * Math.sign(s)]} material={STEEL_MAT}>
            <boxGeometry args={[0.16, 2.6, 0.16]} />
          </mesh>
        ))}
        <Wheels w={1.15} z0={2.6} z1={-3.4} r={0.48} />
        <Beacon y={5.1} />
      </group>
    );
  }
  if (kind === "pushback") {
    // low, wide, flat — the tractor that shoves a 200-tonne jet backwards
    return (
      <group>
        <mesh position={[0, 0.65, 0]} material={HIVIS_MAT} castShadow>
          <boxGeometry args={[3.0, 1.0, 5.4]} />
        </mesh>
        <mesh position={[0, 1.7, -1.1]} material={VEH_DARK} castShadow>
          <boxGeometry args={[1.9, 1.3, 1.8]} />
        </mesh>
        <mesh position={[0, 1.8, -0.2]} material={VEH_GLASS}>
          <boxGeometry args={[1.8, 0.9, 0.2]} />
        </mesh>
        <mesh position={[0, 0.5, 3.1]} material={STEEL_MAT}>
          <boxGeometry args={[1.4, 0.4, 1.4]} />
        </mesh>
        <Wheels w={1.55} z0={1.9} z1={-2.0} r={0.62} />
        <Beacon y={2.6} />
      </group>
    );
  }
  // tug / baggage train — same tractor, the baggage variant tows carts
  return (
    <group>
      <mesh position={[0, 0.75, 0.4]} material={HIVIS_MAT} castShadow>
        <boxGeometry args={[1.7, 0.9, 2.8]} />
      </mesh>
      <mesh position={[0, 1.6, -0.1]} material={VEH_DARK}>
        <boxGeometry args={[1.5, 1.0, 1.3]} />
      </mesh>
      <mesh position={[0, 1.65, 0.55]} material={VEH_GLASS}>
        <boxGeometry args={[1.4, 0.8, 0.15]} />
      </mesh>
      <Wheels w={0.9} z0={1.3} z1={-0.9} r={0.38} />
      <Beacon y={2.3} />
      {kind === "baggage" &&
        [-3.2, -6.0, -8.8].map((z) => (
          <group key={z} position={[0, 0, z]}>
            <mesh position={[0, 0.9, 0]} material={STEEL_MAT} castShadow>
              <boxGeometry args={[1.9, 0.15, 2.4]} />
            </mesh>
            <mesh position={[0, 1.55, 0]} material={VEH_DARK}>
              <boxGeometry args={[1.7, 1.2, 2.1]} />
            </mesh>
            {[0.5, -0.5].map((s) => (
              <mesh key={s} position={[0, 1.7, s * 1.02]} material={HIVIS_MAT}>
                <boxGeometry args={[1.6, 0.9, 0.06]} />
              </mesh>
            ))}
            <Wheels w={0.85} z0={0.8} z1={-0.8} r={0.3} />
          </group>
        ))}
    </group>
  );
}

function WorkVehicle({ kind, keys, offset }: { kind: VehKind; keys: Key[]; offset: number }) {
  const ref = useRef<THREE.Group>(null);
  usePathFollower(keys, ref, { offset });
  return (
    <group ref={ref}>
      <WorkVehicleMesh kind={kind} />
    </group>
  );
}

// ------------------------------------------------------------- the crew ----

const CREW_SCALE = 1.8 / PERSON_MODEL_HEIGHT;

// A person who walks a there-and-back patrol, arms and legs swinging. Same rig
// as components/Pedestrians.tsx (PersonFigure + direct mesh rotations), just a
// two-point patrol instead of the city's block loop.
function CrewMember({
  ax,
  az,
  bx,
  bz,
  speed = 1.4,
  offset = 0,
  jacket,
  pants = "#20242c",
  officer = false,
  hat,
}: {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  speed?: number;
  offset?: number;
  jacket: string;
  pants?: string;
  officer?: boolean;
  hat?: string;
}) {
  const g = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Mesh>(null);
  const legR = useRef<THREE.Mesh>(null);
  const armL = useRef<THREE.Mesh>(null);
  const armR = useRef<THREE.Mesh>(null);
  const len = Math.hypot(bx - ax, bz - az);
  const half = Math.max(0.5, len / Math.max(0.1, speed));

  useFrame((s) => {
    const grp = g.current;
    if (!grp) return;
    const t = (s.clock.elapsedTime + offset) % (half * 2);
    const back = t > half;
    const k = back ? 1 - (t - half) / half : t / half;
    grp.position.set(ax + (bx - ax) * k, 0, az + (bz - az) * k);
    grp.rotation.y = Math.atan2((bx - ax) * (back ? -1 : 1), (bz - az) * (back ? -1 : 1));
    const stride = Math.sin(s.clock.elapsedTime * speed * 3.4 + offset) * 0.55;
    if (legL.current) legL.current.rotation.x = stride;
    if (legR.current) legR.current.rotation.x = -stride;
    if (armL.current) armL.current.rotation.x = -stride * 0.8;
    if (armR.current) armR.current.rotation.x = stride * 0.8;
  });

  return (
    <group ref={g} scale={CREW_SCALE}>
      <PersonFigure legL={legL} legR={legR} armL={armL} armR={armR} jacketColor={jacket} pantsColor={pants} officer={officer} />
      {hat && (
        <mesh position={[0, 1.56, -0.02]}>
          <sphereGeometry args={[0.19, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshLambertMaterial color={hat} />
        </mesh>
      )}
    </group>
  );
}

// A worker standing in place doing a job — arms working, no walking. Used on
// the scaffolding around the broken jet and at the wing-inspection points.
function BusyWorker({
  x,
  z,
  y = 0,
  h = 0,
  jacket = "#f2c00a",
  hat = "#f25c19",
  rate = 4,
}: {
  x: number;
  z: number;
  y?: number;
  h?: number;
  jacket?: string;
  hat?: string;
  rate?: number;
}) {
  const armL = useRef<THREE.Mesh>(null);
  const armR = useRef<THREE.Mesh>(null);
  const legL = useRef<THREE.Mesh>(null);
  const legR = useRef<THREE.Mesh>(null);
  useFrame((s) => {
    const a = Math.sin(s.clock.elapsedTime * rate + x) * 0.5 - 0.9;
    if (armL.current) armL.current.rotation.x = a;
    if (armR.current) armR.current.rotation.x = a * 0.8 - 0.2;
  });
  return (
    <group position={[x, y, z]} rotation={[0, h, 0]} scale={CREW_SCALE}>
      <PersonFigure legL={legL} legR={legR} armL={armL} armR={armR} jacketColor={jacket} pantsColor="#20242c" />
      <mesh position={[0, 1.56, -0.02]}>
        <sphereGeometry args={[0.19, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshLambertMaterial color={hat} />
      </mesh>
    </group>
  );
}

// ------------------------------------------------------- repair scene ------

const SCAFF_MAT = new THREE.MeshStandardMaterial({ color: "#c9a227", metalness: 0.5, roughness: 0.55 });
const PLANK_MAT = new THREE.MeshStandardMaterial({ color: "#6b5433", roughness: 0.9 });
const TOOL_MAT = new THREE.MeshStandardMaterial({ color: "#b3402a", roughness: 0.6, metalness: 0.3 });
const WELD_MAT = new THREE.MeshBasicMaterial({ color: "#bfe4ff" });

// Scaffold tower: 4 legs, cross braces, a planked deck at `h`.
function Scaffold({ x, z, w, d, h }: { x: number; z: number; w: number; d: number; h: number }) {
  return (
    <group position={[x, 0, z]}>
      {[1, -1].map((sx) =>
        [1, -1].map((sz) => (
          <mesh key={`${sx}:${sz}`} position={[(sx * w) / 2, h / 2, (sz * d) / 2]} material={SCAFF_MAT} castShadow>
            <cylinderGeometry args={[0.09, 0.09, h, 6]} />
          </mesh>
        ))
      )}
      {[h * 0.34, h * 0.67, h].map((y) =>
        [1, -1].map((sz) => (
          <mesh key={`${y}:${sz}`} position={[0, y, (sz * d) / 2]} rotation={[0, 0, Math.PI / 2]} material={SCAFF_MAT}>
            <cylinderGeometry args={[0.06, 0.06, w, 6]} />
          </mesh>
        ))
      )}
      <mesh position={[0, h, 0]} material={PLANK_MAT} castShadow receiveShadow>
        <boxGeometry args={[w, 0.14, d]} />
      </mesh>
      <mesh position={[0, h + 0.55, -d / 2]} rotation={[0, 0, Math.PI / 2]} material={SCAFF_MAT}>
        <cylinderGeometry args={[0.05, 0.05, w, 6]} />
      </mesh>
      {/* access ladder */}
      <group position={[w / 2 + 0.2, 0, 0]}>
        {[0.3, -0.3].map((s) => (
          <mesh key={s} position={[0, h / 2, s]} material={SCAFF_MAT}>
            <cylinderGeometry args={[0.05, 0.05, h, 6]} />
          </mesh>
        ))}
        {Array.from({ length: Math.floor(h / 0.5) }, (_, i) => (
          <mesh key={i} position={[0, 0.4 + i * 0.5, 0]} rotation={[Math.PI / 2, 0, 0]} material={SCAFF_MAT}>
            <cylinderGeometry args={[0.035, 0.035, 0.6, 5]} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

// Welding arc: a flickering unlit sprite + a matching point light, so the
// repair bay actually throws light at night instead of being a dark diorama.
function WeldingArc({ x, y, z }: { x: number; y: number; z: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const light = useRef<THREE.PointLight>(null);
  useFrame((s) => {
    // bursts: a few seconds of arcing, then a pause — not a steady lamp
    const c = s.clock.elapsedTime;
    const on = Math.sin(c * 0.7) > -0.1 ? (Math.random() < 0.75 ? 1 : 0.2) : 0;
    if (ref.current) ref.current.scale.setScalar(0.6 + on * 1.6);
    if (light.current) light.current.intensity = on * 26;
  });
  return (
    <group position={[x, y, z]}>
      <mesh ref={ref} material={WELD_MAT}>
        <sphereGeometry args={[0.16, 8, 8]} />
      </mesh>
      <pointLight ref={light} color="#cfe8ff" distance={26} decay={2} />
    </group>
  );
}

// The one unflyable airframe: parked off the live taxiways in the maintenance
// bay, wing off, scaffolding up, crew crawling over it. Everything else on
// this field taxis, takes off and lands (see MovingAirliner) — this is the
// deliberate exception the brief calls for.
function BrokenJet({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]} rotation={[0, -0.3, 0]}>
      <group position={[0, AIRLINER_GROUND_Y, 0]}>
        <AirlinerMesh broken liveryColor="#6b6f76" />
      </group>
      {/* the removed starboard wing, laid out on trestles beside the jet */}
      <group position={[26, 0, -6]} rotation={[0, 0.15, 0]}>
        <mesh position={[0, 1.5, 0]} castShadow>
          <boxGeometry args={[26, 0.9, 8.5]} />
          <meshStandardMaterial color="#c9ccd1" roughness={0.5} metalness={0.55} />
        </mesh>
        {[-9, 0, 9].map((d) => (
          <mesh key={d} position={[d, 0.55, 0]} material={SCAFF_MAT}>
            <boxGeometry args={[0.8, 1.1, 5]} />
          </mesh>
        ))}
      </group>
      {/* the removed engine, on a stand */}
      <group position={[16, 0, 12]}>
        <mesh position={[0, 2.4, 0]} rotation={[Math.PI / 2, 0, 0]} material={STEEL_MAT} castShadow>
          <cylinderGeometry args={[2.35, 2.15, 9.5, 18]} />
        </mesh>
        <mesh position={[0, 0.9, 0]} material={SCAFF_MAT}>
          <boxGeometry args={[3.2, 1.8, 8]} />
        </mesh>
      </group>
      <Scaffold x={-9} z={9} w={7} d={5} h={7.5} />
      <Scaffold x={9.5} z={-2} w={6} d={5} h={6.5} />
      <Scaffold x={-2} z={-24} w={6} d={5} h={9.5} />
      <BusyWorker x={-9} z={9} y={7.64} h={Math.PI} />
      <BusyWorker x={-7} z={10.4} y={7.64} h={2.4} jacket="#ff7a1a" />
      <BusyWorker x={9.5} z={-1} y={6.64} h={0.4} rate={5.5} />
      <BusyWorker x={-2.5} z={-23} y={9.64} h={0.2} jacket="#ff7a1a" rate={3} />
      <BusyWorker x={4} z={7} h={-1.2} rate={6} />
      <BusyWorker x={14} z={11} h={2.8} jacket="#ff7a1a" />
      <WeldingArc x={-6.4} y={7.9} z={9.6} />
      <WeldingArc x={9.5} y={6.9} z={-1.6} />
      <CrewMember ax={-16} az={16} bx={20} bz={18} jacket="#f2c00a" hat="#f25c19" speed={1.1} />
      {/* tool chests + drums scattered under the wing */}
      {[
        [-14, 4],
        [-11, 12],
        [6, 15],
        [18, -4],
      ].map(([tx, tz]) => (
        <mesh key={`${tx}:${tz}`} position={[tx, 0.6, tz]} material={TOOL_MAT} castShadow>
          <boxGeometry args={[1.6, 1.2, 0.9]} />
        </mesh>
      ))}
      {[
        [-18, 8],
        [12, 18],
        [-4, 20],
      ].map(([tx, tz]) => (
        <mesh key={`d${tx}:${tz}`} position={[tx, 0.55, tz]} material={HIVIS_MAT} castShadow>
          <cylinderGeometry args={[0.45, 0.45, 1.1, 12]} />
        </mesh>
      ))}
    </group>
  );
}

export { BrokenJet, CrewMember, BusyWorker, WorkVehicle, MovingAirliner, taxiKeys };
