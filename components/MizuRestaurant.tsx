"use client";

import { RigidBody, CuboidCollider } from "@react-three/rapier";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import { CarMesh } from "@/components/Car";
import { RIDE_HEIGHT } from "@/components/SupercarBody";

// MIZU 21 — bespoke landmark modeled on a real reference photo (mountain-
// lodge restaurant: cross-gable roofline, stone entry tower, salmon lap
// siding, black steel canopy). Deliberately NOT neon — no bloom, no emissive
// signage — this building is matte/lit like a real storefront, unlike every
// other landmark in the city. Positioned at lib/landmarks.ts's MIZU 21
// coordinate; City.tsx's LANDMARK_CHUNKS exemption keeps random buildings
// off this spot the same way it does for PoliceStation/AutoYard.
const MX = 100;
const MZ = 0;
const FACING = -Math.PI / 2; // front (+local Z) points toward -world X, i.e. back toward spawn

// unit-sized front-facing gable roof (ridge runs front-to-back along local Z,
// so the triangular gable end faces +Z) — scaled per use like City.tsx's
// HIP_ROOF_GEO. DoubleSide on the material sidesteps winding guesswork on
// a hand-built prism.
const GABLE_ROOF_GEO = (() => {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array([
    -0.5, 0, -0.5, // 0 back-left base
    0.5, 0, -0.5, // 1 back-right base
    0.5, 0, 0.5, // 2 front-right base
    -0.5, 0, 0.5, // 3 front-left base
    0, 1, -0.5, // 4 ridge-back
    0, 1, 0.5, // 5 ridge-front
  ]);
  const idx = [0, 3, 5, 0, 5, 4, 2, 1, 4, 2, 4, 5, 1, 0, 4, 3, 2, 5];
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
})();

const SIDING_MAT = new THREE.MeshStandardMaterial({ color: "#c9836f", roughness: 0.88 });
const STONE_MAT = new THREE.MeshStandardMaterial({ color: "#a2907a", roughness: 0.95 });
const ROOF_MAT = new THREE.MeshStandardMaterial({ color: "#1b1d21", roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide });
const TRIM_MAT = new THREE.MeshStandardMaterial({ color: "#141519", roughness: 0.55, metalness: 0.35 });
const WINDOW_MAT = new THREE.MeshStandardMaterial({
  color: "#1a2530",
  roughness: 0.2,
  metalness: 0.3,
  emissive: new THREE.Color("#3a4a55"),
  emissiveIntensity: 0.15,
});
const GLASS_DOOR_MAT = new THREE.MeshStandardMaterial({ color: "#0d1218", roughness: 0.15, metalness: 0.4 });
const LAMP_MAT = new THREE.MeshStandardMaterial({ color: "#ffd9a0", emissive: new THREE.Color("#ffb862"), emissiveIntensity: 0.6 });
const SIGN_BOARD_MAT = new THREE.MeshStandardMaterial({ color: "#111114", roughness: 0.7 });
const ADA_MAT = new THREE.MeshStandardMaterial({ color: "#1f5fb0", roughness: 0.5 });
const ASPHALT_MAT = new THREE.MeshStandardMaterial({ color: "#2b2c30", roughness: 1 });
const STALL_LINE_MAT = new THREE.MeshBasicMaterial({ color: "#d8d8cc" });

// ---- neighbor fast-food building (TACO SPOT) — brick + purple band +
// stone corner pier + slat canopy, touching Mizu 21's right wing, sharing
// the same lot ----
const TACO_BRICK_MAT = new THREE.MeshStandardMaterial({ color: "#c2a97e", roughness: 0.85 });
const TACO_SLAT_MAT = new THREE.MeshStandardMaterial({ color: "#1c1d20", roughness: 0.5, metalness: 0.2 });
const TACO_BOLLARD_MAT = new THREE.MeshStandardMaterial({ color: "#f0c419", roughness: 0.5 });

// ---- second neighbor fast-food building (GOLDEN PATTY) — fictional
// burger-joint expy (red walls, yellow trim/signage), same treatment as
// TACO SPOT: not a real chain's name or logo. Flush against Mizu 21's LEFT
// wing edge (local x=-13.5) so the two flank Mizu on either side. Walk-up
// only — no drive-thru lane, no vehicle driveway. ----
const GOLDEN_WALL_MAT = new THREE.MeshStandardMaterial({ color: "#c1272d", roughness: 0.8 });
const GOLDEN_TRIM_MAT = new THREE.MeshStandardMaterial({ color: "#f4c430", roughness: 0.5, metalness: 0.2 });

// ---- second connected row, across the shared lot facing row 1 (SUDS &
// THREADS / PIXEL ARCADE / CORNER BOOKS) — three more fictional storefronts,
// flush-touching each other like TACO SPOT/GOLDEN PATTY, each a different
// building type + texture so the corner doesn't read as one repeated box ----
const SUDS_WALL_MAT = new THREE.MeshStandardMaterial({ color: "#5a9aa8", roughness: 0.75 });
const SUDS_TRIM_MAT = new THREE.MeshStandardMaterial({ color: "#e8e8e8", roughness: 0.4, metalness: 0.1 });
const ARCADE_WALL_MAT = new THREE.MeshStandardMaterial({ color: "#3a2352", roughness: 0.55, metalness: 0.15 });
const ARCADE_TRIM_MAT = new THREE.MeshStandardMaterial({ color: "#ff4fd6", roughness: 0.35, metalness: 0.2 });
const BOOKS_WALL_MAT = new THREE.MeshStandardMaterial({ color: "#8a4a3a", roughness: 0.9 });
const BOOKS_TRIM_MAT = new THREE.MeshStandardMaterial({ color: "#e8dcc0", roughness: 0.6 });

// a real striped row: perpendicular divider lines only (no end caps) — the
// same convention as an ordinary strip-mall lot, matches the reference
// photo. Big-box sized: 16 stalls (was 8) spanning most of the lot's width,
// z is a prop so the same row can be stamped down twice (see FRONT_ROW_Z).
// half-extents of the same collision box Car.tsx uses for the driven car
// (new THREE.Vector3(1.85,1.3,4.6)) — parked cars had no RigidBody at all,
// so the player could drive straight through them; this gives every parked
// car the same box the real cars use.
const CAR_HALF = { x: 0.925, y: 0.65, z: 2.3 };
const STALL_W = 3;
const STALL_D = 6;
const STALL_COUNT = 16;
const STALL_START_X = -20;
const STALL_ROW_Z = 26;
const FRONT_ROW_Z = 14; // second row, further back in the courtyard (WALL_Z1 reverted to 30)

function ParkingRow({ z = STALL_ROW_Z }: { z?: number }) {
  const dividers = Array.from({ length: STALL_COUNT + 1 }, (_, i) => STALL_START_X + i * STALL_W);
  return (
    <group>
      {dividers.map((x) => (
        <mesh key={x} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.03, z]} material={STALL_LINE_MAT}>
          <planeGeometry args={[0.12, STALL_D]} />
        </mesh>
      ))}
    </group>
  );
}

// parked cars, sitting still — reuses the same CarMesh the player drives,
// just mounted with no RigidBody/physics. Two sets (back row + front row)
// so the bigger lot doesn't read as empty.
const PARKED = [
  { stall: 1, color: "#e8eaee", style: "gt" as const },
  { stall: 3, color: "#16171b", style: "roadster" as const },
  { stall: 6, color: "#1d5fd8", style: "gt" as const },
  { stall: 9, color: "#c8b44f", style: "gt" as const },
  { stall: 12, color: "#4f7ac8", style: "roadster" as const },
];
const FRONT_PARKED = [
  { stall: 2, color: "#9a4fc8", style: "gt" as const },
  { stall: 5, color: "#e8e8e8", style: "roadster" as const },
  { stall: 8, color: "#2f8a6a", style: "gt" as const },
  { stall: 11, color: "#c84f4f", style: "roadster" as const },
  { stall: 14, color: "#5a5a5a", style: "gt" as const },
];

function ParkedCars({ z = STALL_ROW_Z, cars = PARKED }: { z?: number; cars?: typeof PARKED }) {
  return (
    <>
      {cars.map(({ stall, color, style }) => (
        <group key={stall} position={[STALL_START_X + STALL_W * (stall + 0.5), RIDE_HEIGHT, z]}>
          <CarMesh color={color} style={style} detail="low" lit={false} />
        </group>
      ))}
    </>
  );
}

// second + third rows, parallel to the LEFT and RIGHT walls instead of the
// back row — same shared lot, just running along Z with each stall's car
// facing sideways into the drive aisle instead of facing the back row.
// Dividers are the same STALL_LINE_MAT lines as ParkingRow, just with width/
// depth swapped (long edge along X, spaced along Z) to match the row's turn.
// 13 stalls (was 7) to fill out the longer walls the wider lot now has.
const SIDE_STALL_D = 5;
const SIDE_STALL_COUNT = 13;
const SIDE_STALL_Z0 = -22;
const LEFT_ROW_X = -16; // ~3 clear of the left wall's inner face for a drive aisle
const RIGHT_ROW_X = 29; // ~7 clear of the right wall's inner face (x=36)

function SideStallRow({ x, z0, count, d }: { x: number; z0: number; count: number; d: number }) {
  const dividers = Array.from({ length: count + 1 }, (_, i) => z0 + i * STALL_W);
  return (
    <group>
      {dividers.map((z) => (
        <mesh key={z} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.03, z]} material={STALL_LINE_MAT}>
          <planeGeometry args={[d, 0.12]} />
        </mesh>
      ))}
    </group>
  );
}

const SIDE_PARKED = [
  { row: "left" as const, stall: 1, color: "#8a2be2", style: "gt" as const },
  { row: "left" as const, stall: 4, color: "#e8eaee", style: "roadster" as const },
  { row: "right" as const, stall: 2, color: "#c81e3a", style: "gt" as const },
  { row: "right" as const, stall: 5, color: "#2fa84f", style: "roadster" as const },
];

function SideParkedCars() {
  return (
    <>
      {SIDE_PARKED.map(({ row, stall, color, style }) => (
        <group
          key={`${row}${stall}`}
          position={[row === "left" ? LEFT_ROW_X : RIGHT_ROW_X, RIDE_HEIGHT, SIDE_STALL_Z0 + STALL_W * (stall + 0.5)]}
          rotation={[0, Math.PI / 2, 0]}
        >
          <CarMesh color={color} style={style} detail="low" lit={false} />
        </group>
      ))}
    </>
  );
}

// window bank with black mullions between panes — the tower's 2nd-floor
// row in the reference photo
function WindowBank({ count, w, y, z }: { count: number; w: number; y: number; z: number }) {
  const paneW = (w / count) * 0.72;
  const step = w / count;
  return (
    <group position={[0, y, z]}>
      {Array.from({ length: count }, (_, i) => (
        <mesh key={i} position={[-w / 2 + step * (i + 0.5), 0, 0]} material={WINDOW_MAT}>
          <boxGeometry args={[paneW, 1.15, 0.05]} />
        </mesh>
      ))}
    </group>
  );
}

// dark louvered vent set into the gable end, arched cap on top — the two
// peak vents from the reference photo
function GableVent({ x, y }: { x: number; y: number }) {
  return (
    <group position={[x, y, 0.06]}>
      <mesh material={TRIM_MAT}>
        <boxGeometry args={[0.5, 0.7, 0.04]} />
      </mesh>
      <mesh position={[0, 0.35, 0]} material={TRIM_MAT}>
        <circleGeometry args={[0.25, 12, 0, Math.PI]} />
      </mesh>
    </group>
  );
}

function PendantLight({ x, z }: { x: number; z: number }) {
  return (
    <mesh position={[x, 2.55, z]} material={LAMP_MAT}>
      <sphereGeometry args={[0.09, 8, 8]} />
    </mesh>
  );
}

// freestanding parking-lot light pole — pole + crossarm + glowing head, same
// LAMP_MAT/TRIM_MAT as everything else in this file so it reads as part of
// the same lit-storefront lot rather than a bolted-on prop
const LAMP_POLE_H = 4.4;
function StreetLamp({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, LAMP_POLE_H / 2, 0]} material={TRIM_MAT} castShadow>
        <cylinderGeometry args={[0.07, 0.09, LAMP_POLE_H, 8]} />
      </mesh>
      <mesh position={[0, LAMP_POLE_H - 0.15, 0]} material={TRIM_MAT}>
        <boxGeometry args={[0.8, 0.1, 0.1]} />
      </mesh>
      <mesh position={[0, LAMP_POLE_H, 0]} material={LAMP_MAT}>
        <sphereGeometry args={[0.15, 10, 10]} />
      </mesh>
    </group>
  );
}

// small entrance monument at the one open side of the lot — post + sign,
// no text needed to read as "you drive in here"
// a real gate now, not a narrow sign — pillars sit near the full width of
// the opening (was +/-2.2 apart, basically a signpost; now ~54 apart) with
// a crossbeam overhead high enough to drive under, so the whole ~65-unit-
// wide entrance actually reads as one big gate instead of a plaque off to
// the side of it
function EntranceMonument() {
  const ex = (WALL_X_LEFT + WALL_X_RIGHT) / 2;
  const ez = WALL_Z1 + 3;
  const half = 27; // pillar offset from center
  const pillarH = 3.6;
  return (
    <group position={[ex, 0, ez]}>
      {[-half, half].map((px) => (
        <mesh key={px} position={[px, pillarH / 2, 0]} material={TRIM_MAT} castShadow>
          <boxGeometry args={[0.5, pillarH, 0.5]} />
        </mesh>
      ))}
      <mesh position={[0, pillarH + 0.15, 0]} material={TRIM_MAT} castShadow>
        <boxGeometry args={[half * 2 + 0.6, 0.3, 0.5]} />
      </mesh>
      <mesh position={[0, pillarH - 0.65, 0]} material={SIGN_BOARD_MAT} castShadow>
        <boxGeometry args={[10, 1.1, 0.2]} />
      </mesh>
      <Text position={[0, pillarH - 0.65, 0.11]} fontSize={0.44} color="#f4c430" anchorX="center" anchorY="middle">
        SHOPPING LOT
      </Text>
    </group>
  );
}

// Pushed the whole building this far back from the road/entry side so the
// lot in front of it reads as a real "sidepath -> parking -> storefront"
// strip-mall lot. Also TACO SPOT's depth line below.
const BACK = -34; // true limit: 2 units clear of the actual road pavement (worldX 140), not just the aesthetic random-building margin

// TACO SPOT — touches Mizu 21's right wing edge (local x=18) with zero gap,
// same depth line as the wings (flush "end of sidewalk" front), shares the
// one shared lot pad above. Fictional name/signage, not a real chain's.
// Plain one-colour walls per feedback (no band/stone/slat-array mix reading
// as a busy texture) — just the brick body + a plain flat awning.
const TX = 27; // 18 (Mizu's right wing edge) + 9 (half of TW) = flush touch
const TZ = BACK;
const TW = 18,
  TD = 8,
  TH = 4.8;

// GOLDEN PATTY — shrunk down to a small corner building (was 16 wide and
// reached all the way to the left wall's outer line, so the wall's blank
// back face landed square in the middle of GOLDEN PATTY's own storefront
// face instead of at its corner). Now 8 wide, so its west edge lands exactly
// on WALL_X_LEFT+SUDS_D (-21.5) — the same line the left wall's inner face
// sits on — touching it corner-to-corner with no overlap and no gap.
const GW = 8,
  GD = 10,
  GH = 5.2;
const GX = -13.5 - GW / 2;
const GZ = BACK;

// Side walls close off the left and right flanks of the lot, picking up
// exactly where row 1's corner buildings' own front faces end (GOLDEN
// PATTY's is GZ+GD/2=-29, TACO SPOT's is TZ+TD/2=-30) and running forward to
// WALL_Z1 — separate start lines per side since the two corner buildings
// aren't the same depth, so a single shared line would overlap one of them.
// Beyond WALL_Z1 is left open — the one gap left for cars to drive in.
// rotation.y=+/-PI/2 turns each shop's own "+z front" convention (same one
// TACO SPOT/GOLDEN PATTY use) to face sideways into the courtyard instead of
// forward; the shop's own W (its long, sign-bearing dimension) becomes the
// along-wall run length and D (thin front-depth) becomes the wall's
// thickness once rotated.
const WALL_Z0_LEFT = -29; // = GOLDEN PATTY's front edge
const WALL_Z0_RIGHT = -30; // = TACO SPOT's front edge
// reverted from 40 back to 30 — pushing it to 40 (and the pad/gate further
// with it) put the pavement and gate on top of the actual road; the real
// boundary this side sits closer than the estimate that 40 was based on.
// 30 is the value that was live with no reported road overlap.
const WALL_Z1 = 30;
const WALL_X_LEFT = -29.5; // outer face, flush with GOLDEN PATTY's (pre-shrink) left edge
const WALL_X_RIGHT = 36; // inner face, flush with TACO SPOT's right edge — zero gap

const STREET_LAMPS = [
  { x: WALL_X_LEFT + 2, z: WALL_Z1 }, // entrance, left flank
  { x: WALL_X_RIGHT - 2, z: WALL_Z1 }, // entrance, right flank
  { x: LEFT_ROW_X, z: 0 }, // left aisle, mid-run
  { x: RIGHT_ROW_X, z: 0 }, // right aisle, mid-run
  { x: -24, z: -26 }, // back-left corner, near GOLDEN PATTY/SUDS
  { x: 32, z: -26 }, // back-right corner, near TACO SPOT/CORNER BOOKS
];

const SUDS_W = 30,
  SUDS_D = 8,
  SUDS_H = 4.4;
const SUDS_X = WALL_X_LEFT + SUDS_D / 2;
const SUDS_Z = WALL_Z0_LEFT + SUDS_W / 2;

const ARCADE_W = WALL_Z1 - WALL_Z0_LEFT - SUDS_W; // fills the rest of the left wall's run
const ARCADE_D = 9,
  ARCADE_H = 5.4;
const ARCADE_X = WALL_X_LEFT + ARCADE_D / 2;
const ARCADE_Z = WALL_Z0_LEFT + SUDS_W + ARCADE_W / 2;

const BOOKS_W = WALL_Z1 - WALL_Z0_RIGHT; // the whole right wall's run, one long building
const BOOKS_D = 8,
  BOOKS_H = 4.8;
const BOOKS_X = WALL_X_RIGHT + BOOKS_D / 2;
const BOOKS_Z = WALL_Z0_RIGHT + BOOKS_W / 2;

function GoldenPatty() {
  return (
    <group position={[GX, 0, GZ]}>
      <mesh castShadow receiveShadow position={[0, GH / 2, 0]} material={GOLDEN_WALL_MAT}>
        <boxGeometry args={[GW, GH, GD]} />
      </mesh>
      <mesh position={[0, GH + 0.15, 0]} material={ROOF_MAT} castShadow>
        <boxGeometry args={[GW + 0.6, 0.3, GD + 0.6]} />
      </mesh>
      {/* yellow accent band under the roofline — fast-food read without a literal arches logo */}
      <mesh position={[0, GH - 0.15, GD / 2 + 0.02]} material={GOLDEN_TRIM_MAT}>
        <boxGeometry args={[GW - 1, 0.3, 0.06]} />
      </mesh>
      <WindowBank count={4} w={GW * 0.75} y={2.6} z={GD / 2 + 0.03} />
      <mesh position={[0, 1.6, GD / 2 + 0.05]} material={GLASS_DOOR_MAT}>
        <boxGeometry args={[2.2, 3.2, 0.06]} />
      </mesh>
      <mesh position={[0, 3.6, GD / 2 + 0.08]} material={SIGN_BOARD_MAT}>
        <boxGeometry args={[GW * 0.55, 0.9, 0.06]} />
      </mesh>
      <Text position={[0, 3.6, GD / 2 + 0.12]} fontSize={0.5} color="#f4c430" anchorX="center" anchorY="middle">
        GOLDEN PATTY
      </Text>
      {/* pedestrian entry apron only — no drive-thru lane, no vehicle driveway */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, GD / 2 + 3]} receiveShadow material={ASPHALT_MAT}>
        <planeGeometry args={[10, 6]} />
      </mesh>
    </group>
  );
}

// laundromat — flat roof + plain trim band, biggest windows of the three (a
// laundromat storefront in real life is mostly glass)
function SudsAndThreads() {
  return (
    <group position={[SUDS_X, 0, SUDS_Z]} rotation={[0, Math.PI / 2, 0]}>
      <mesh castShadow receiveShadow position={[0, SUDS_H / 2, 0]} material={SUDS_WALL_MAT}>
        <boxGeometry args={[SUDS_W, SUDS_H, SUDS_D]} />
      </mesh>
      <mesh position={[0, SUDS_H + 0.15, 0]} material={ROOF_MAT} castShadow>
        <boxGeometry args={[SUDS_W + 0.6, 0.3, SUDS_D + 0.6]} />
      </mesh>
      <mesh position={[0, SUDS_H - 0.15, SUDS_D / 2 + 0.02]} material={SUDS_TRIM_MAT}>
        <boxGeometry args={[SUDS_W - 1, 0.3, 0.06]} />
      </mesh>
      <WindowBank count={5} w={SUDS_W * 0.85} y={2.2} z={SUDS_D / 2 + 0.03} />
      <mesh position={[0, 1.6, SUDS_D / 2 + 0.05]} material={GLASS_DOOR_MAT}>
        <boxGeometry args={[2.2, 3.2, 0.06]} />
      </mesh>
      <mesh position={[0, 3.7, SUDS_D / 2 + 0.08]} material={SIGN_BOARD_MAT}>
        <boxGeometry args={[SUDS_W * 0.5, 0.8, 0.06]} />
      </mesh>
      <Text position={[0, 3.7, SUDS_D / 2 + 0.12]} fontSize={0.42} color="#e8e8e8" anchorX="center" anchorY="middle">
        SUDS & THREADS
      </Text>
    </group>
  );
}

// arcade — dark walls, glossy magenta trim + slat canopy (reuses TACO_SLAT_MAT
// for a different roof texture than the plain flat boxes on either side of it)
function PixelArcade() {
  return (
    <group position={[ARCADE_X, 0, ARCADE_Z]} rotation={[0, Math.PI / 2, 0]}>
      <mesh castShadow receiveShadow position={[0, ARCADE_H / 2, 0]} material={ARCADE_WALL_MAT}>
        <boxGeometry args={[ARCADE_W, ARCADE_H, ARCADE_D]} />
      </mesh>
      <mesh position={[0, ARCADE_H + 0.15, 0]} material={ROOF_MAT} castShadow>
        <boxGeometry args={[ARCADE_W + 0.6, 0.3, ARCADE_D + 0.6]} />
      </mesh>
      <mesh position={[0, ARCADE_H - 0.7, ARCADE_D / 2 + 0.5]} rotation={[0.15, 0, 0]} material={TACO_SLAT_MAT} castShadow>
        <boxGeometry args={[ARCADE_W - 2, 0.1, 1.2]} />
      </mesh>
      <mesh position={[0, ARCADE_H - 0.15, ARCADE_D / 2 + 0.02]} material={ARCADE_TRIM_MAT}>
        <boxGeometry args={[ARCADE_W - 1, 0.15, 0.06]} />
      </mesh>
      <WindowBank count={2} w={ARCADE_W * 0.5} y={2.9} z={ARCADE_D / 2 + 0.03} />
      <mesh position={[0, 1.6, ARCADE_D / 2 + 0.05]} material={GLASS_DOOR_MAT}>
        <boxGeometry args={[2.2, 3.2, 0.06]} />
      </mesh>
      <mesh position={[0, 3.3, ARCADE_D / 2 + 0.08]} material={SIGN_BOARD_MAT}>
        <boxGeometry args={[ARCADE_W * 0.6, 0.9, 0.06]} />
      </mesh>
      <Text position={[0, 3.3, ARCADE_D / 2 + 0.12]} fontSize={0.46} color="#ff4fd6" anchorX="center" anchorY="middle">
        PIXEL ARCADE
      </Text>
    </group>
  );
}

// bookstore — the only gabled roof in row 2 (reuses Mizu's own GABLE_ROOF_GEO),
// warm brick instead of flat-roofed boxes, so the row reads as three different
// building types, not one shape recolored three times
function CornerBooks() {
  return (
    <group position={[BOOKS_X, 0, BOOKS_Z]} rotation={[0, -Math.PI / 2, 0]}>
      <mesh castShadow receiveShadow position={[0, BOOKS_H / 2, 0]} material={BOOKS_WALL_MAT}>
        <boxGeometry args={[BOOKS_W, BOOKS_H, BOOKS_D]} />
      </mesh>
      <mesh position={[0, BOOKS_H, 0]} geometry={GABLE_ROOF_GEO} material={ROOF_MAT} scale={[BOOKS_W + 0.8, 2.4, BOOKS_D + 0.8]} castShadow />
      <mesh position={[0, BOOKS_H - 0.1, BOOKS_D / 2 + 0.02]} material={BOOKS_TRIM_MAT}>
        <boxGeometry args={[BOOKS_W - 1, 0.15, 0.06]} />
      </mesh>
      <WindowBank count={4} w={BOOKS_W * 0.75} y={2.3} z={BOOKS_D / 2 + 0.03} />
      <mesh position={[0, 1.6, BOOKS_D / 2 + 0.05]} material={GLASS_DOOR_MAT}>
        <boxGeometry args={[2.2, 3.2, 0.06]} />
      </mesh>
      <mesh position={[0, 3.6, BOOKS_D / 2 + 0.08]} material={SIGN_BOARD_MAT}>
        <boxGeometry args={[BOOKS_W * 0.5, 0.85, 0.06]} />
      </mesh>
      <Text position={[0, 3.6, BOOKS_D / 2 + 0.12]} fontSize={0.42} color="#e8dcc0" anchorX="center" anchorY="middle">
        CORNER BOOKS
      </Text>
    </group>
  );
}

function TacoSpot() {
  return (
    <group position={[TX, 0, TZ]}>
      <mesh castShadow receiveShadow position={[0, TH / 2, 0]} material={TACO_BRICK_MAT}>
        <boxGeometry args={[TW, TH, TD]} />
      </mesh>
      <mesh position={[0, TH + 0.15, 0]} material={ROOF_MAT} castShadow>
        <boxGeometry args={[TW + 0.6, 0.3, TD + 0.6]} />
      </mesh>
      {/* one flat awning over the storefront windows, not a slat array */}
      <mesh position={[0, TH - 0.9, TD / 2 + 0.5]} rotation={[0.15, 0, 0]} material={TACO_SLAT_MAT} castShadow>
        <boxGeometry args={[TW - 2, 0.1, 1.2]} />
      </mesh>
      <WindowBank count={4} w={TW * 0.7} y={2.4} z={TD / 2 + 0.03} />
      <mesh position={[TW / 2 - 3, 1.6, TD / 2 + 0.05]} material={GLASS_DOOR_MAT}>
        <boxGeometry args={[2, 3.2, 0.06]} />
      </mesh>
      <mesh position={[0, 3.4, TD / 2 + 0.08]} material={SIGN_BOARD_MAT}>
        <boxGeometry args={[4.2, 0.8, 0.06]} />
      </mesh>
      <Text position={[0, 3.4, TD / 2 + 0.12]} fontSize={0.42} color="#f0e8d8" anchorX="center" anchorY="middle">
        TACO SPOT
      </Text>
      <mesh position={[TW / 2 - 0.9, 0.45, TD / 2 + 0.9]} castShadow material={TACO_BOLLARD_MAT}>
        <cylinderGeometry args={[0.14, 0.16, 0.9, 10]} />
      </mesh>
    </group>
  );
}

export function MizuRestaurant() {
  // --- center entrance tower: 2-story, stone base, front gable, window bank ---
  const tw = 11,
    td = 11,
    th = 7.5,
    tz = 3 + BACK;
  const stoneH = 3.2;

  // --- left wing: single story, small front gable, covered walkway ---
  const lw = 9,
    ld = 8,
    lh = 4.6,
    lx = -9,
    lz = 0 + BACK;

  // --- right wing: longer single story, flat roof + dark fascia ---
  const rw = 17,
    rd = 8,
    rh2 = 4.8,
    rx = 9.5,
    rz = 0 + BACK;

  return (
    <group position={[MX, 0, MZ]} rotation={[0, FACING, 0]}>
      {/* parking lot pad + entry apron — stretched back to reach the
          relocated building with no gap, and widened to also cover TACO
          SPOT's and GOLDEN PATTY's frontage so all three buildings share
          one lot (was x=[-17,43], leaving GOLDEN PATTY's [-29.5,-13.5]
          footprint outside it — the generic city sidewalk tile showed
          through there; now x=[-33,43], 1 unit clear of the BACK/road limit) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[7.5, 0.02, 2.5]} receiveShadow material={ASPHALT_MAT}>
        <planeGeometry args={[81, 73]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, tz + td / 2 + 3]} receiveShadow material={ASPHALT_MAT}>
        <planeGeometry args={[10, 6]} />
      </mesh>
      <ParkingRow />
      <ParkedCars />
      <ParkingRow z={FRONT_ROW_Z} />
      <ParkedCars z={FRONT_ROW_Z} cars={FRONT_PARKED} />
      <SideStallRow x={LEFT_ROW_X} z0={SIDE_STALL_Z0} count={SIDE_STALL_COUNT} d={SIDE_STALL_D} />
      <SideStallRow x={RIGHT_ROW_X} z0={SIDE_STALL_Z0} count={SIDE_STALL_COUNT} d={SIDE_STALL_D} />
      <SideParkedCars />
      {STREET_LAMPS.map((l, i) => (
        <StreetLamp key={i} x={l.x} z={l.z} />
      ))}
      <EntranceMonument />
      {/* two ADA spots, matching the reference photo's marked accessible parking */}
      {[-6, 6].map((sx) => (
        <group key={sx} position={[sx, 0, tz + td / 2 + 9]}>
          <mesh position={[0, 1.1, 0]} material={ADA_MAT}>
            <boxGeometry args={[0.5, 0.7, 0.04]} />
          </mesh>
          <mesh position={[0, 0.55, 0]} material={TRIM_MAT}>
            <cylinderGeometry args={[0.06, 0.06, 1.1, 6]} />
          </mesh>
        </group>
      ))}

      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[tw / 2, th / 2, td / 2]} position={[0, th / 2, tz]} />
        <CuboidCollider args={[lw / 2, lh / 2, ld / 2]} position={[lx, lh / 2, lz]} />
        <CuboidCollider args={[rw / 2, rh2 / 2, rd / 2]} position={[rx, rh2 / 2, rz]} />
        <CuboidCollider args={[TW / 2, TH / 2, TD / 2]} position={[TX, TH / 2, TZ]} />
        <CuboidCollider args={[GW / 2, GH / 2, GD / 2]} position={[GX, GH / 2, GZ]} />
        {/* args are [D/2,H/2,W/2] not [W/2,H/2,D/2] here — these three are rotated
            90 deg so their long run (W) lies along world-frame Z, thin depth (D) along X */}
        <CuboidCollider args={[SUDS_D / 2, SUDS_H / 2, SUDS_W / 2]} position={[SUDS_X, SUDS_H / 2, SUDS_Z]} />
        <CuboidCollider args={[ARCADE_D / 2, ARCADE_H / 2, ARCADE_W / 2]} position={[ARCADE_X, ARCADE_H / 2, ARCADE_Z]} />
        <CuboidCollider args={[BOOKS_D / 2, BOOKS_H / 2, BOOKS_W / 2]} position={[BOOKS_X, BOOKS_H / 2, BOOKS_Z]} />

        {/* parked cars — were pure decoration, driveable-through; now solid */}
        {PARKED.map(({ stall }) => (
          <CuboidCollider
            key={`p${stall}`}
            args={[CAR_HALF.x, CAR_HALF.y, CAR_HALF.z]}
            position={[STALL_START_X + STALL_W * (stall + 0.5), CAR_HALF.y, STALL_ROW_Z]}
          />
        ))}
        {FRONT_PARKED.map(({ stall }) => (
          <CuboidCollider
            key={`f${stall}`}
            args={[CAR_HALF.x, CAR_HALF.y, CAR_HALF.z]}
            position={[STALL_START_X + STALL_W * (stall + 0.5), CAR_HALF.y, FRONT_ROW_Z]}
          />
        ))}
        {SIDE_PARKED.map(({ row, stall }) => (
          // rotated 90 deg like the side walls — swap x/z half-extents to match
          <CuboidCollider
            key={`${row}${stall}`}
            args={[CAR_HALF.z, CAR_HALF.y, CAR_HALF.x]}
            position={[row === "left" ? LEFT_ROW_X : RIGHT_ROW_X, CAR_HALF.y, SIDE_STALL_Z0 + STALL_W * (stall + 0.5)]}
          />
        ))}
      </RigidBody>

      {/* ---------- center tower ---------- */}
      <group position={[0, 0, tz]}>
        <mesh castShadow receiveShadow position={[0, stoneH / 2, 0]} material={STONE_MAT}>
          <boxGeometry args={[tw, stoneH, td]} />
        </mesh>
        <mesh castShadow receiveShadow position={[0, stoneH + (th - stoneH) / 2, 0]} material={SIDING_MAT}>
          <boxGeometry args={[tw, th - stoneH, td]} />
        </mesh>
        <mesh position={[0, th, 0]} geometry={GABLE_ROOF_GEO} material={ROOF_MAT} scale={[tw + 1, 5, td + 1]} castShadow />
        <GableVent x={-1.7} y={th + 1.6} />
        <GableVent x={1.7} y={th + 1.6} />

        <WindowBank count={6} w={tw * 0.82} y={5.6} z={td / 2 + 0.03} />

        {/* stone-tower glass double door + canopy + sign board */}
        <mesh position={[0, 1.6, td / 2 + 0.05]} material={GLASS_DOOR_MAT}>
          <boxGeometry args={[2.4, 3.2, 0.06]} />
        </mesh>
        <mesh position={[0, 3.35, td / 2 + 0.5]} material={TRIM_MAT} castShadow>
          <boxGeometry args={[3.4, 0.12, 1]} />
        </mesh>
        <mesh position={[0, 2.5, td / 2 + 0.08]} material={SIGN_BOARD_MAT}>
          <boxGeometry args={[3.6, 0.9, 0.06]} />
        </mesh>
        <Text position={[0, 2.5, td / 2 + 0.12]} fontSize={0.5} color="#f2c230" anchorX="center" anchorY="middle">
          MIZU 21
        </Text>
        {[-1.5, 1.5].map((sx) => (
          <group key={sx} position={[sx, 0, td / 2]}>
            <mesh position={[0, 2.2, 0.1]} material={TRIM_MAT}>
              <cylinderGeometry args={[0.03, 0.03, 0.3, 6]} />
            </mesh>
            <mesh position={[0, 2.05, 0.2]} material={LAMP_MAT}>
              <sphereGeometry args={[0.07, 8, 8]} />
            </mesh>
          </group>
        ))}
      </group>

      {/* ---------- left wing + covered walkway ---------- */}
      <group position={[lx, 0, lz]}>
        <mesh castShadow receiveShadow position={[0, lh / 2, 0]} material={SIDING_MAT}>
          <boxGeometry args={[lw, lh, ld]} />
        </mesh>
        <mesh position={[0, 0.15, 0]} material={STONE_MAT}>
          <boxGeometry args={[lw + 0.05, 0.3, ld + 0.05]} />
        </mesh>
        <mesh position={[0, lh, 0]} geometry={GABLE_ROOF_GEO} material={ROOF_MAT} scale={[lw + 0.8, 2.6, ld + 0.8]} castShadow />
        <WindowBank count={2} w={lw * 0.7} y={2.6} z={ld / 2 + 0.03} />
      </group>
      {/* canopy walkway running from the left wing toward the tower */}
      <mesh position={[-3.5, 2.7, lz + ld / 2 + 1.6]} material={TRIM_MAT} castShadow>
        <boxGeometry args={[12, 0.1, 3]} />
      </mesh>
      {[-8.5, -5.5, -2.5, 0.5].map((px) => (
        <mesh key={px} position={[px, 1.35, lz + ld / 2 + 2.9]} material={TRIM_MAT}>
          <cylinderGeometry args={[0.07, 0.07, 2.7, 6]} />
        </mesh>
      ))}
      {[-8, -5.5, -3, -0.5].map((px) => (
        <PendantLight key={px} x={px} z={lz + ld / 2 + 1.6} />
      ))}

      {/* ---------- right wing ---------- */}
      <group position={[rx, 0, rz]}>
        <mesh castShadow receiveShadow position={[0, rh2 / 2, 0]} material={SIDING_MAT}>
          <boxGeometry args={[rw, rh2, rd]} />
        </mesh>
        <mesh position={[0, 0.2, 0]} material={STONE_MAT}>
          <boxGeometry args={[rw + 0.05, 0.4, rd + 0.05]} />
        </mesh>
        {/* flat roof + dark fascia band, not a full gable — matches the low
            roofline along this wing in the reference photo */}
        <mesh position={[0, rh2 + 0.15, 0]} material={ROOF_MAT} castShadow>
          <boxGeometry args={[rw + 0.6, 0.3, rd + 0.6]} />
        </mesh>
        <WindowBank count={5} w={rw * 0.85} y={2.9} z={rd / 2 + 0.03} />
      </group>

      <TacoSpot />
      <GoldenPatty />
      <SudsAndThreads />
      <PixelArcade />
      <CornerBooks />
    </group>
  );
}
