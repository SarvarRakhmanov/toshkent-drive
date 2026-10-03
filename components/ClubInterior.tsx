"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RigidBody, CuboidCollider } from "@react-three/rapier";
import { Billboard, Text } from "@react-three/drei";
import * as THREE from "three";
import { useHudStore } from "@/lib/hudStore";
import { CLUB_IN } from "@/lib/club";
import { PersonFigure } from "@/components/PersonFigure";
import { FLOOR_TEX, POSTERS, CLUB_WOOD_TEX, CLUB_PANEL_TEX, CLUB_CURTAIN_TEX, CLUB_CHESTERFIELD_TEX, CLUB_MARBLE_TEX } from "@/lib/clubTextures";
import { LOCAL_SEATS } from "@/lib/clubSeats";

const W = 44;
const D = 30;
const H = 7;

const CROWD_COLORS = ["#ff2f8a", "#2fe9ff", "#ffd12f", "#b06bff", "#2fff8a", "#ff8a2f", "#8affd1"];

// Upgraded from the old bobbing capsule blobs to real PersonFigure rigs (see
// DancingFigure below) — same articulated legL/legR/armL/armR rig
// Pedestrians.tsx uses, just danced instead of walked. Kept off the stage
// footprint (z < -8) and clear of the bar (x > 15) / booths (x < -15).
const CROWD = Array.from({ length: 14 }, (_, i) => {
  const a = (i / 14) * Math.PI * 2;
  const r = i < 6 ? 3 + (i % 2) * 1.5 : 7 + (i % 3);
  return {
    x: Math.cos(a) * r,
    z: 3 + Math.sin(a) * r,
    color: CROWD_COLORS[i % CROWD_COLORS.length],
    seed: i * 1.7,
  };
});

const SPOT_COLORS = [0xff3fd6, 0x2fe9ff, 0xb06bff];

// Self-contained dancer: owns its own limb refs and per-frame animation, so
// dropping N of these into the scene doesn't mean plumbing N*4 refs through
// the parent's useFrame the way the old crowdRefs array did. `energetic`
// widens the swing for stage/pole performers vs. the background crowd;
// `spin` adds continuous yaw (the pole dancer).
function DancingFigure({
  position,
  jacketColor,
  pantsColor,
  seed,
  energetic = false,
  spin = false,
}: {
  position: [number, number, number];
  jacketColor: string;
  pantsColor?: string;
  seed: number;
  energetic?: boolean;
  spin?: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Mesh>(null);
  const legR = useRef<THREE.Mesh>(null);
  const armL = useRef<THREE.Mesh>(null);
  const armR = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime * (energetic ? 3.2 : 2.4) + seed;
    const amp = energetic ? 1.15 : 0.55;
    if (armL.current) armL.current.rotation.x = Math.sin(t) * amp - amp * 0.3;
    if (armR.current) armR.current.rotation.x = Math.sin(t + Math.PI) * amp - amp * 0.3;
    if (legL.current) legL.current.rotation.x = Math.sin(t + Math.PI) * amp * 0.35;
    if (legR.current) legR.current.rotation.x = Math.sin(t) * amp * 0.35;
    const g = groupRef.current;
    if (!g) return;
    g.position.y = position[1] + Math.abs(Math.sin(t)) * (energetic ? 0.14 : 0.07);
    g.rotation.y = spin ? state.clock.elapsedTime * 1.6 + seed : position[0] * 0 + Math.sin(t * 0.35) * 0.5;
  });

  return (
    <group ref={groupRef} position={position}>
      <PersonFigure legL={legL} legR={legR} armL={armL} armR={armR} jacketColor={jacketColor} pantsColor={pantsColor} />
    </group>
  );
}

// Chrome floor-to-ceiling pole + one DancingFigure spinning around it —
// the ask specifically called out "pole dancers" alongside the stage
// performers below, kept as its own small rig since the pole itself needs
// geometry the plain DancingFigure doesn't have.
function PoleDancer({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, H / 2, 0]}>
        <cylinderGeometry args={[0.05, 0.05, H, 10]} />
        <meshStandardMaterial color="#dfe4ea" metalness={0.9} roughness={0.15} />
      </mesh>
      <mesh position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.7, 0.7, 0.05, 16]} />
        <meshStandardMaterial color="#12aa44" emissive="#12aa44" emissiveIntensity={0.4} />
      </mesh>
      <DancingFigure position={[0, 0, 0]} jacketColor="#ff3fd6" pantsColor="#ff3fd6" seed={4.2} energetic spin />
    </group>
  );
}

// Back-bar bottle shelf — two dense rows of small coloured "bottles" against
// a mirror backing, matching the reference photo's fully-stocked back-bar
// instead of one sparse row.
function BottleShelf({ x, z0, z1 }: { x: number; z0: number; z1: number }) {
  const colors = ["#2fe9ff", "#ff3fd6", "#ffd12f", "#2fff8a", "#b06bff", "#ff8a2f"];
  const n = 16;
  return (
    <>
      {[1.35, 1.85].map((y, row) =>
        Array.from({ length: n }, (_, i) => {
          const z = z0 + ((z1 - z0) * (i + 0.5)) / n + (row === 1 ? 0.06 : -0.06);
          const c = colors[(i + row * 3) % colors.length];
          return (
            <mesh key={`${row}-${i}`} position={[x, y, z]}>
              <cylinderGeometry args={[0.055, 0.075, 0.32, 8]} />
              <meshStandardMaterial color={c} emissive={c} emissiveIntensity={0.4} roughness={0.25} />
            </mesh>
          );
        })
      )}
    </>
  );
}

// Small hanging mirror ball — same metal-sphere look as the main disco ball
// (ClubInterior's discoRef) but mini-scale and self-rotating, several of
// them strung above the bar the way the reference photo does.
function MiniDiscoBall({ x, z, y = 6.1, r = 0.22 }: { x: number; z: number; y?: number; r?: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 1.6;
  });
  return (
    <group position={[x, y, z]}>
      <mesh position={[0, r + 0.35, 0]}>
        <cylinderGeometry args={[0.01, 0.01, 0.7, 4]} />
        <meshBasicMaterial color="#1a1a1e" />
      </mesh>
      <mesh ref={ref}>
        <sphereGeometry args={[r, 14, 10]} />
        <meshStandardMaterial color="#eeeeff" metalness={1} roughness={0.1} />
      </mesh>
    </group>
  );
}

// Padded stool: pole leg + round cushioned seat + low backrest, the
// customer-side seating the reference bar lines up along its counter.
function BarStool({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.4, 0]} castShadow>
        <cylinderGeometry args={[0.04, 0.04, 0.8, 8]} />
        <meshStandardMaterial color="#3a3a42" metalness={0.85} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.06, 0]}>
        <cylinderGeometry args={[0.22, 0.22, 0.04, 12]} />
        <meshStandardMaterial color="#28282e" metalness={0.7} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.82, 0]} castShadow>
        <cylinderGeometry args={[0.24, 0.24, 0.09, 14]} />
        <meshStandardMaterial color="#5a1030" roughness={0.55} />
      </mesh>
      <mesh position={[0, 1.08, -0.19]} castShadow>
        <boxGeometry args={[0.4, 0.32, 0.06]} />
        <meshStandardMaterial color="#5a1030" roughness={0.55} />
      </mesh>
    </group>
  );
}

// Exposed ceiling pipe run above the bar — the industrial-loft detail the
// reference photo reads as much as the neon does. Visual only, no collider.
function OverheadPipe({ x, z0, z1 }: { x: number; z0: number; z1: number }) {
  const midZ = (z0 + z1) / 2;
  return (
    <group>
      <mesh position={[x, H - 0.35, midZ]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.09, 0.09, z1 - z0, 10]} />
        <meshStandardMaterial color="#2a2a30" metalness={0.8} roughness={0.35} />
      </mesh>
      {[z0 + 1, midZ, z1 - 1].map((z, i) => (
        <mesh key={i} position={[x, H - 0.35, z]}>
          <sphereGeometry args={[0.13, 10, 8]} />
          <meshStandardMaterial color="#1e1e24" metalness={0.85} roughness={0.3} />
        </mesh>
      ))}
    </group>
  );
}

// Bar counter + mirror-backed double bottle shelf + hanging mini disco balls
// + overhead pipe + stools + two bartenders — matches the reference photo's
// neon-lit back-bar: magenta strip up top, blue wash low, mirror behind the
// bottles instead of a flat wall.
function Bar({ x, z0, z1 }: { x: number; z0: number; z1: number }) {
  const midZ = (z0 + z1) / 2;
  const shelfX = x + 1.05;
  const stoolX = x - 1.15;
  return (
    <group>
      <mesh position={[x, 0.55, midZ]} castShadow>
        <boxGeometry args={[1.4, 1.1, z1 - z0]} />
        <meshStandardMaterial color="#1a141f" roughness={0.25} metalness={0.35} />
      </mesh>
      <mesh position={[x, 1.13, midZ]}>
        <boxGeometry args={[1.5, 0.06, z1 - z0 + 0.2]} />
        <meshBasicMaterial color="#ff3fd6" />
      </mesh>
      {/* mirror backing behind the bottles */}
      <mesh position={[shelfX + 0.35, 1.75, midZ]} castShadow>
        <boxGeometry args={[0.04, 1.5, z1 - z0]} />
        <meshStandardMaterial color="#0a0f14" metalness={0.95} roughness={0.05} />
      </mesh>
      <mesh position={[shelfX + 0.36, 2.52, midZ]}>
        <boxGeometry args={[0.05, 0.05, z1 - z0 + 0.1]} />
        <meshBasicMaterial color="#2fe9ff" />
      </mesh>
      <BottleShelf x={shelfX} z0={z0 + 0.6} z1={z1 - 0.6} />
      {/* warm/cool wash gradient over the shelf, echoing the exterior's uplights */}
      <pointLight position={[shelfX - 0.4, 3.2, midZ]} color="#ff3fd6" intensity={1.6} distance={9} decay={2} />
      <pointLight position={[shelfX - 0.4, 1.1, midZ]} color="#2fe9ff" intensity={1.4} distance={7} decay={2} />
      <OverheadPipe x={shelfX - 0.5} z0={z0} z1={z1} />
      {[z0 + 1.5, z0 + 4, midZ, z1 - 4, z1 - 1.5].map((z, i) => (
        <MiniDiscoBall key={i} x={shelfX - 0.6} z={z} y={5.7 + (i % 2) * 0.4} r={i === 2 ? 0.3 : 0.2} />
      ))}
      {[z0 + 1.3, z0 + 3.6, midZ, z1 - 3.6, z1 - 1.3].map((z, i) => (
        <BarStool key={i} x={stoolX} z={z} />
      ))}
      <DancingFigure position={[x + 0.9, 0, midZ - 2]} jacketColor="#12141a" pantsColor="#0b0d12" seed={1.1} />
      <DancingFigure position={[x + 0.9, 0, midZ + 2]} jacketColor="#12141a" pantsColor="#0b0d12" seed={2.6} />
    </group>
  );
}

// Chesterfield sofa bench, oriented to face +x (matches lib/clubSeats.ts's
// seat ry=PI/2) — tufted-leather back + seat cushions on a dark plinth, with
// rolled bolster arms at each end. `length` spans the z-axis; two seats sit
// along it (lib/clubSeats.ts's LOCAL_SEATS, 3 units apart).
function ChesterfieldSofa({ x, z, length }: { x: number; z: number; length: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.09, 0]} castShadow>
        <boxGeometry args={[1.5, 0.18, length + 0.6]} />
        <meshStandardMaterial color="#0a0710" roughness={0.7} />
      </mesh>
      {/* seat cushion top sits at 0.38 — matched to lib/clubSeats.ts's SEATS.y
          (0.54) so a seated player's hip lands on the cushion and the
          hip+knee leg (components/Player.tsx, SEG_LEN 0.25 each) reaches
          the floor instead of dangling; the reference photo's much taller
          couch doesn't work against this character's short fixed leg rig */}
      <mesh position={[0, 0.24, 0]} castShadow>
        <boxGeometry args={[1.2, 0.28, length]} />
        <meshStandardMaterial map={CLUB_CHESTERFIELD_TEX} color="#ffffff" roughness={0.65} />
      </mesh>
      <mesh position={[-0.42, 0.72, 0]} castShadow>
        <boxGeometry args={[0.3, 1.1, length]} />
        <meshStandardMaterial map={CLUB_CHESTERFIELD_TEX} color="#ffffff" roughness={0.65} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0.05, 0.44, (s * length) / 2]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.24, 0.24, 0.55, 12]} />
          <meshStandardMaterial map={CLUB_CHESTERFIELD_TEX} color="#ffffff" roughness={0.65} />
        </mesh>
      ))}
    </group>
  );
}

// Round marble coffee table on a slim metal pedestal, one warm point light
// on top standing in for a candle — sits in front of each sofa cluster.
function RoundTable({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.18, 0.22, 0.04, 16]} />
        <meshStandardMaterial color="#1a1a1e" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.16, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.05, 0.24, 10]} />
        <meshStandardMaterial color="#1a1a1e" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.31, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.62, 0.62, 0.06, 24]} />
        <meshStandardMaterial map={CLUB_MARBLE_TEX} color="#ffffff" roughness={0.25} metalness={0.1} />
      </mesh>
      <pointLight color="#ffb060" intensity={0.6} distance={4} position={[0, 0.45, 0]} decay={2} />
    </group>
  );
}

// Small backlit wall sconce — a flat emissive disc close to the wall, the
// red accent lighting the reference photo lines its lounge wall with.
function WallSconce({ x, y, z }: { x: number; y: number; z: number }) {
  return (
    <group position={[x, y, z]}>
      <mesh rotation={[0, -Math.PI / 2, 0]}>
        <cylinderGeometry args={[0.16, 0.16, 0.04, 16]} />
        <meshBasicMaterial color="#ff2050" toneMapped={false} />
      </mesh>
      <pointLight color="#ff2050" intensity={0.9} distance={4.5} decay={2} />
    </group>
  );
}

// Big nested-ring ceiling light fixture over the VIP lounge — two concentric
// glowing tori recessed into a dark disc, the centrepiece of the reference
// photo's ceiling.
function CeilingRing({ x, y, z }: { x: number; y: number; z: number }) {
  return (
    <group position={[x, y, z]} rotation={[Math.PI / 2, 0, 0]}>
      <mesh position={[0, 0, -0.03]}>
        <circleGeometry args={[2.3, 32]} />
        <meshStandardMaterial color="#0a0f18" roughness={0.6} side={THREE.DoubleSide} />
      </mesh>
      <mesh>
        <torusGeometry args={[1.9, 0.12, 12, 48]} />
        <meshBasicMaterial color="#2fe9ff" toneMapped={false} />
      </mesh>
      <mesh>
        <torusGeometry args={[1.15, 0.09, 12, 40]} />
        <meshBasicMaterial color="#2fe9ff" toneMapped={false} />
      </mesh>
      <pointLight color="#2fe9ff" intensity={2.2} distance={16} position={[0, 0, -1]} decay={2} />
    </group>
  );
}

// VIP lounge: two chesterfield-sofa clusters (one per lib/clubSeats.ts pair)
// facing into the room, each with its own marble coffee table, under a
// shared big ceiling ring and a run of red wall sconces — replaces the old
// three flat-box Booth()s. Sofa/table placement is derived from
// LOCAL_SEATS so the geometry always lines up with where E actually seats
// the player, not a hand-tuned guess.
function VipLounge() {
  const wallX = -W / 2 + 0.9;
  const [seatA0, seatA1, seatB0, seatB1] = LOCAL_SEATS;
  const midA = (seatA0.z + seatA1.z) / 2;
  const midB = (seatB0.z + seatB1.z) / 2;
  return (
    <group>
      <ChesterfieldSofa x={wallX} z={midA} length={seatA1.z - seatA0.z + 1.2} />
      <ChesterfieldSofa x={wallX} z={midB} length={seatB1.z - seatB0.z + 1.2} />
      <RoundTable x={seatA0.x + 1.6} z={midA} />
      <RoundTable x={seatB0.x + 1.6} z={midB} />
      <CeilingRing x={wallX + 1.4} y={H - 0.4} z={(midA + midB) / 2} />
      {[midA - 4, midA, midB, midB + 4].map((z, i) => (
        <WallSconce key={i} x={-W / 2 + 0.15} y={2.6} z={z} />
      ))}
      {/* low red neon wash along the lounge wall, echoing the reference's floor-level strip */}
      <mesh position={[-W / 2 + 0.1, 0.15, (midA + midB) / 2]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[Math.abs(midB - midA) + 8, 0.1]} />
        <meshBasicMaterial color="#ff2050" toneMapped={false} />
      </mesh>
    </group>
  );
}

// Tall folded-velvet curtain panel — flanks the stage like a proscenium,
// baked-fold texture instead of a flat red fill.
function CurtainPanel({ x, z, w = 1.6, h = 5.2 }: { x: number; z: number; w?: number; h?: number }) {
  return (
    <mesh position={[x, h / 2, z]}>
      <planeGeometry args={[w, h]} />
      <meshStandardMaterial map={CLUB_CURTAIN_TEX} color="#ffffff" roughness={0.9} side={THREE.DoubleSide} />
    </mesh>
  );
}

// Overhead lighting truss over the stage — a boxed beam + diagonal end
// struts + a row of small red fixture housings, the rigging silhouette a
// real stage reads under.
function StageTruss({ x0, x1, y, z }: { x0: number; x1: number; y: number; z: number }) {
  const midX = (x0 + x1) / 2;
  const fixtures = [x0 + 1, x0 + (x1 - x0) * 0.35, midX, x0 + (x1 - x0) * 0.65, x1 - 1];
  return (
    <group>
      <mesh position={[midX, y, z]}>
        <boxGeometry args={[x1 - x0, 0.35, 0.35]} />
        <meshStandardMaterial color="#1c1c22" metalness={0.75} roughness={0.4} />
      </mesh>
      {[x0, x1].map((x, i) => (
        <mesh key={i} position={[x, y - 1.1, z]} rotation={[0, 0, i === 0 ? 0.5 : -0.5]}>
          <boxGeometry args={[0.14, 2.4, 0.14]} />
          <meshStandardMaterial color="#1c1c22" metalness={0.75} roughness={0.4} />
        </mesh>
      ))}
      {fixtures.map((x, i) => (
        <mesh key={i} position={[x, y - 0.32, z]}>
          <cylinderGeometry args={[0.18, 0.14, 0.4, 10]} />
          <meshStandardMaterial color="#2a1010" emissive="#ff2020" emissiveIntensity={0.5} metalness={0.5} roughness={0.4} />
        </mesh>
      ))}
    </group>
  );
}

// Neon ring "clock" centrepiece above the DJ booth — torus rim + tick marks
// + two static hands, all emissive so it glows without needing its own light.
function NeonClockRing({ x, y, z }: { x: number; y: number; z: number }) {
  const ticks = Array.from({ length: 12 }, (_, i) => (i / 12) * Math.PI * 2);
  return (
    <group position={[x, y, z]}>
      <mesh>
        <torusGeometry args={[1.5, 0.07, 10, 40]} />
        <meshBasicMaterial color="#2fe9ff" toneMapped={false} />
      </mesh>
      {ticks.map((a, i) => (
        <mesh key={i} position={[Math.sin(a) * 1.5, Math.cos(a) * 1.5, 0]} rotation={[0, 0, -a]}>
          <boxGeometry args={[0.05, 0.22, 0.05]} />
          <meshBasicMaterial color="#2fe9ff" toneMapped={false} />
        </mesh>
      ))}
      <mesh position={[0.15, 0.25, 0.03]} rotation={[0, 0, -0.4]}>
        <boxGeometry args={[0.05, 0.75, 0.05]} />
        <meshBasicMaterial color="#2fe9ff" toneMapped={false} />
      </mesh>
      <mesh position={[0.35, 0.55, 0.03]} rotation={[0, 0, -1.15]}>
        <boxGeometry args={[0.05, 1.05, 0.05]} />
        <meshBasicMaterial color="#2fe9ff" toneMapped={false} />
      </mesh>
      <pointLight color="#2fe9ff" intensity={1.4} distance={14} />
    </group>
  );
}

// Black PA speaker stack (bass bin + top box) with a faint grille dot
// pattern, flanking the stage — matches floor-monitor/stack pairs at a
// concert front-of-house.
function SpeakerStack({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.7, 0]} castShadow>
        <boxGeometry args={[1.1, 1.4, 1.0]} />
        <meshStandardMaterial color="#0e0e10" roughness={0.6} />
      </mesh>
      <mesh position={[0, 1.75, 0]} castShadow>
        <boxGeometry args={[0.85, 0.7, 0.8]} />
        <meshStandardMaterial color="#141416" roughness={0.6} />
      </mesh>
      {Array.from({ length: 3 }, (_, i) => (
        <mesh key={i} position={[0, 1.6 + i * 0.22, 0.41]}>
          <cylinderGeometry args={[0.06, 0.06, 0.02, 10]} />
          <meshStandardMaterial color="#050506" />
        </mesh>
      ))}
    </group>
  );
}

function Poster({ x, z, ry, map }: { x: number; z: number; ry: number; map: THREE.Texture }) {
  return (
    <mesh position={[x, 3.4, z]} rotation={[0, ry, 0]}>
      <planeGeometry args={[1.6, 2.4]} />
      <meshStandardMaterial map={map} emissive="#ffffff" emissiveMap={map} emissiveIntensity={0.3} roughness={0.7} />
    </mesh>
  );
}

// Floating "emoticon" — a music note that fades in/out above a dancer, drei
// Text billboard rather than an image asset.
function EmojiFloat({ x, z, seed, glyph, color }: { x: number; z: number; seed: number; glyph: string; color: string }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((state) => {
    const t = (state.clock.elapsedTime * 0.5 + seed) % (Math.PI * 2);
    const g = ref.current;
    if (!g) return;
    g.position.y = 1.9 + Math.sin(t) * 0.3 + t * 0.15;
    g.visible = Math.sin(t) > -0.3;
  });
  return (
    <group ref={ref} position={[x, 1.9, z]}>
      <Billboard>
        <Text fontSize={0.35} color={color} outlineWidth={0.02} outlineColor="#0a0612">
          {glyph}
        </Text>
      </Billboard>
    </group>
  );
}

// VENU interior — a real place in the world at CLUB_IN, not an overlay scene
// (see lib/club.ts). Rendered only while inClub so it costs nothing outside
// the club. Full set dressing: floor/walls/stage/DJ booth/disco
// ball/spotlights (with visible beam cones)/lasers/dancing crowd/stage
// dancers/pole dancer/bar+bartenders/VIP booths/wall posters/floating
// emoji — the bar/bottle-shelf/VIP-couch/pole-dancer set the original file
// comment documented as cut for scope is now in.
export function ClubInterior() {
  const inClub = useHudStore((s) => s.inClub);
  const discoRef = useRef<THREE.Mesh>(null);
  const floorMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const spotRefs = useRef<(THREE.PointLight | null)[]>([]);
  const beamRefs = useRef<(THREE.Mesh | null)[]>([]);
  const laserRefs = useRef<(THREE.Mesh | null)[]>([]);

  useFrame((state, dt) => {
    if (!inClub) return;
    const time = state.clock.elapsedTime;
    const bps = 130 / 60;
    const beat = Math.pow(Math.max(0, Math.sin(time * Math.PI * 2 * bps)), 8);

    if (discoRef.current) discoRef.current.rotation.y += dt * 2.4;
    if (floorMatRef.current) {
      floorMatRef.current.emissiveIntensity = 0.6 + 0.5 * Math.sin(time * 7) + beat * 1.5;
      floorMatRef.current.emissive.setHSL((time * 0.1) % 1, 0.85, 0.5);
    }

    spotRefs.current.forEach((L, i) => {
      if (!L) return;
      const a = time * 2 + i * 2.09;
      const x = Math.cos(a) * 11;
      const z = 1 + Math.sin(a * 1.3) * 6.5;
      L.position.set(x, 4.8, z);
      L.intensity = 1.8 + Math.sin(time * 9 + i) * 0.8 + beat * 1.2;
      L.color.setHSL((time * 0.15 + i * 0.34) % 1, 0.9, 0.55);
      // visible beam column tracking the same moving spot, ceiling to floor —
      // this is what makes the sweep actually readable as light instead of
      // just an invisible point-light's illumination on other objects
      const beam = beamRefs.current[i];
      if (beam) {
        beam.position.set(x, H / 2, z);
        (beam.material as THREE.MeshBasicMaterial).color.copy(L.color);
        (beam.material as THREE.MeshBasicMaterial).opacity = 0.1 + Math.max(0, Math.sin(time * 9 + i)) * 0.1 + beat * 0.08;
      }
    });
    laserRefs.current.forEach((b, i) => {
      if (!b) return;
      b.rotation.z = Math.sin(time * 2.3 + i * 1.3) * 1.2;
      b.rotation.x = Math.cos(time * 1.8 + i) * 0.75;
      (b.material as THREE.MeshBasicMaterial).opacity = 0.14 + 0.16 * Math.sin(time * 12 + i * 2) + beat * 0.18;
    });
  });

  if (!inClub) return null;

  const IN = CLUB_IN;
  // Same brushed-black-panel texture as the exterior facade (Club.tsx) — the
  // interior's own last set-dressing pass predates the exterior's premium
  // redesign by a day, so walls were still a flat colour with no material
  // continuity into the room. Wood trim band below mirrors the exterior's
  // backlit soffit.
  const wallMat = <meshStandardMaterial map={CLUB_PANEL_TEX} color="#2a2230" roughness={0.6} metalness={0.3} />;

  return (
    <group position={[IN.x, 0, IN.z]}>
      {/* floor + walls + ceiling, walls solid so driving can't clip through */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} receiveShadow>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial color="#0e0c14" roughness={0.25} metalness={0.5} />
      </mesh>
      <mesh position={[0, H + 0.25, 0]}>
        <boxGeometry args={[W, 0.5, D]} />
        {wallMat}
      </mesh>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[W / 2, H / 2, 0.5]} position={[0, H / 2, -D / 2]} />
        <CuboidCollider args={[W / 2, H / 2, 0.5]} position={[0, H / 2, D / 2]} />
        <CuboidCollider args={[0.5, H / 2, D / 2]} position={[-W / 2, H / 2, 0]} />
        <CuboidCollider args={[0.5, H / 2, D / 2]} position={[W / 2, H / 2, 0]} />
        {/* floor — CLUB_IN (lib/club.ts) is a far-off pocket coordinate with no
            city ground under it, and the floor mesh above is visual-only, so
            without this the player fell straight through on entry */}
        <CuboidCollider args={[W / 2, 0.5, D / 2]} position={[0, -0.47, 0]} />
      </RigidBody>
      {[
        [W, H, 1, 0, H / 2, -D / 2],
        [W, H, 1, 0, H / 2, D / 2],
        [1, H, D, -W / 2, H / 2, 0],
        [1, H, D, W / 2, H / 2, 0],
      ].map((p, i) => (
        <mesh key={i} position={[p[3], p[4], p[5]]} castShadow receiveShadow>
          <boxGeometry args={[p[0], p[1], p[2]]} />
          {wallMat}
        </mesh>
      ))}
      {/* backlit wood trim band, same warm-timber material as the exterior's
          soffit, run just below the ceiling on all four walls */}
      {[
        [W, 0.5, -D / 2 + 0.02],
        [W, 0.5, D / 2 - 0.02],
      ].map(([w, h, z], i) => (
        <mesh key={`tz${i}`} position={[0, H - 0.35, z as number]}>
          <planeGeometry args={[w as number, h as number]} />
          <meshBasicMaterial map={CLUB_WOOD_TEX} toneMapped={false} />
        </mesh>
      ))}
      {[
        [-W / 2 + 0.02, D],
        [W / 2 - 0.02, D],
      ].map(([x, d], i) => (
        <mesh key={`tx${i}`} position={[x as number, H - 0.35, 0]} rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[d as number, 0.5]} />
          <meshBasicMaterial map={CLUB_WOOD_TEX} toneMapped={false} />
        </mesh>
      ))}

      {/* colourful checker dance floor — texture gives it real pattern, the
          emissive hue+intensity animation on top (in useFrame) is what makes
          it cycle colour with the beat instead of just pulsing white */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 1]}>
        <planeGeometry args={[14, 14]} />
        <meshStandardMaterial
          ref={floorMatRef}
          map={FLOOR_TEX}
          color="#ffffff"
          emissive={new THREE.Color("#ffffff")}
          emissiveIntensity={0.7}
          roughness={0.3}
        />
      </mesh>

      {/* stage + DJ booth */}
      <mesh position={[0, 0.45, -D / 2 + 3]} castShadow>
        <boxGeometry args={[13, 0.9, 5]} />
        <meshStandardMaterial color="#241a30" roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.92, -D / 2 + 3]}>
        <boxGeometry args={[13.2, 0.1, 5.2]} />
        <meshBasicMaterial color="#ff3fd6" />
      </mesh>
      <mesh position={[-9, 0.65, -D / 2 + 4]} castShadow>
        <boxGeometry args={[3, 1.3, 1.6]} />
        <meshStandardMaterial color="#101018" roughness={0.4} emissive="#2fe9ff" emissiveIntensity={0.15} />
      </mesh>

      {/* proscenium: red velvet curtain legs + overhead truss + neon ring
          "clock" on the back wall + PA stacks flanking the stage front —
          matches the reference photo's curtained, truss-lit stage look. */}
      <CurtainPanel x={-6.6} z={-D / 2 + 2.8} />
      <CurtainPanel x={6.6} z={-D / 2 + 2.8} />
      <StageTruss x0={-6.4} x1={6.4} y={H - 0.6} z={-D / 2 + 3} />
      <NeonClockRing x={0} y={4.3} z={-D / 2 + 0.6} />
      <SpeakerStack x={-6.3} z={-D / 2 + 5.2} />
      <SpeakerStack x={6.3} z={-D / 2 + 5.2} />
      <pointLight color="#ff2020" intensity={2.4} distance={13} position={[-3, H - 1, -D / 2 + 2]} />
      <pointLight color="#ff2020" intensity={2.4} distance={13} position={[3, H - 1, -D / 2 + 2]} />

      {/* stage dancers, on the stage platform (top surface at y=0.9) */}
      <DancingFigure position={[3, 0.9, -D / 2 + 2.4]} jacketColor="#ff3fd6" pantsColor="#ff3fd6" seed={0.4} energetic />
      <DancingFigure position={[6.5, 0.9, -D / 2 + 3.6]} jacketColor="#2fe9ff" pantsColor="#2fe9ff" seed={3.1} energetic />
      {/* pole dancer, opposite the DJ booth */}
      <PoleDancer x={-3} z={-D / 2 + 4} />

      {/* disco ball + moving spotlights (with visible beam columns) + lasers */}
      <mesh ref={discoRef} position={[0, 5.6, 1]}>
        <sphereGeometry args={[0.9, 18, 14]} />
        <meshStandardMaterial color="#eeeeff" metalness={1} roughness={0.08} />
      </mesh>
      {SPOT_COLORS.map((col, i) => (
        <pointLight
          key={i}
          ref={(el) => {
            spotRefs.current[i] = el;
          }}
          color={col}
          intensity={1.6}
          distance={34}
          position={[0, 5, 0]}
        />
      ))}
      {SPOT_COLORS.map((col, i) => (
        <mesh
          key={`beam${i}`}
          ref={(el) => {
            beamRefs.current[i] = el;
          }}
          position={[0, H / 2, 0]}
        >
          <coneGeometry args={[1.6, H, 12, 1, true]} />
          <meshBasicMaterial
            color={col}
            transparent
            opacity={0.12}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
      <pointLight color="#8a6aff" intensity={0.6} distance={50} position={[0, 4, 6]} />
      {[-9, -6, -3, 0, 3, 6, 9, -1].map((ox, i) => (
        <mesh
          key={i}
          ref={(el) => {
            laserRefs.current[i] = el;
          }}
          position={[ox, 6.4, 1]}
        >
          <coneGeometry args={[0.9, 9, 10, 1, true]} />
          <meshBasicMaterial
            color={["#ff3fd6", "#2fe9ff", "#2fff8a", "#b06bff", "#ff8a2f", "#8affd1", "#ffd12f", "#ff2f8a"][i]}
            transparent
            opacity={0.2}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}

      {/* dancing crowd */}
      {CROWD.map((p, i) => (
        <DancingFigure key={i} position={[p.x, 0, p.z]} jacketColor={p.color} pantsColor="#161b26" seed={p.seed} />
      ))}
      {/* floating emoji over a few dancers */}
      <EmojiFloat x={CROWD[0].x} z={CROWD[0].z} seed={0} glyph="♪" color="#ff3fd6" />
      <EmojiFloat x={CROWD[4].x} z={CROWD[4].z} seed={2.1} glyph="♫" color="#2fe9ff" />
      <EmojiFloat x={CROWD[9].x} z={CROWD[9].z} seed={4.3} glyph="★" color="#ffd12f" />

      {/* bar along the +x wall, VIP lounge along the -x wall */}
      <Bar x={W / 2 - 2} z0={-6} z1={6} />
      <VipLounge />

      {/* wall posters */}
      <Poster x={-14} z={D / 2 - 0.4} ry={Math.PI} map={POSTERS[0]} />
      <Poster x={14} z={D / 2 - 0.4} ry={Math.PI} map={POSTERS[1]} />
      <Poster x={9} z={-D / 2 + 0.4} ry={0} map={POSTERS[2]} />

      {/* exit door + sign */}
      <mesh position={[0, 2.2, D / 2 - 0.55]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[3, 4.4]} />
        <meshBasicMaterial color="#9a4fff" />
      </mesh>
      <mesh position={[0, 5, D / 2 - 0.56]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[2, 1]} />
        <meshBasicMaterial color="#12aa44" />
      </mesh>
    </group>
  );
}
