"use client";

import { type RefObject } from "react";
import * as THREE from "three";
import { HEADLIGHT, TAILLIGHT, BEAM, RIDE_HEIGHT, type Detail } from "@/components/SupercarBody";

// Amber mirror-beacon materials — same flashing technique as PoliceCar.tsx's
// light bar (a MeshBasicMaterial ref, flipped color in the owning drive rig's
// useFrame), just amber instead of red/blue so a stolen commercial vehicle
// doesn't read as a cop car. `lightRefs` is optional: Traffic.tsx's own NPC
// copies (never driven, never stolen) pass none and just get a static beacon.
export type LightRefs = RefObject<(THREE.MeshBasicMaterial | null)[]>;

// Commercial traffic bodywork — jeeps/buses/trucks for Traffic.tsx, genuinely
// different boxy silhouettes rather than a recolour of SupercarBody's wedge.
// One file, not three: all three kinds share the same paint cache / glass /
// trim / wheel materials, and splitting them out would just triplicate those
// module-scope instances (the exact waste SupercarBody's own header comment
// warns about — a fresh material per mesh instead of one shared everywhere).
// SupercarBody can't be edited (another agent owns it) and doesn't export its
// Wheel component or wheel geometry, so wheels are rebuilt inline here rather
// than imported — same "unit cylinder pre-rotated onto the axle" trick, just
// not literally shared code.

const paintCache = new Map<string, THREE.MeshStandardMaterial>();
function paint(color: string) {
  let m = paintCache.get(color);
  if (!m) {
    // flatter and less metallic than SupercarBody's paint() — fleet/utility
    // vehicles, not clearcoat exotics
    m = new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.55 });
    paintCache.set(color, m);
  }
  return m;
}
const stripeCache = new Map<string, THREE.MeshStandardMaterial>();
function stripe(color: string) {
  let m = stripeCache.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, metalness: 0.2, roughness: 0.5 });
    stripeCache.set(color, m);
  }
  return m;
}
// deterministic livery pick off the body colour so a given bus lane always
// wears the same stripe (same reasoning as SupercarBody's styleFor: no prop
// to thread through Traffic.tsx just for this)
function liveryFor(color: string) {
  const n = parseInt(color.slice(1, 3), 16) || 0;
  return stripe(n % 2 === 0 ? "#f2b100" : "#e8eaee");
}

const TRIM = new THREE.MeshStandardMaterial({ color: "#1b1d22", metalness: 0.4, roughness: 0.55 });
const GLASS = new THREE.MeshStandardMaterial({
  color: "#16212e",
  metalness: 0.85,
  roughness: 0.08,
  transparent: true,
  opacity: 0.6,
});
const TIRE = new THREE.MeshStandardMaterial({ color: "#121316", roughness: 0.92 });
const RIM = new THREE.MeshStandardMaterial({ color: "#8a8f99", metalness: 0.8, roughness: 0.32 });
// "engine off" fixtures for parked/unlit instances — mirrors SupercarBody's
// HEADLIGHT_OFF/TAILLIGHT_OFF, redeclared locally since those two are
// module-private over there (not exported)
const HEADLIGHT_OFF = new THREE.MeshStandardMaterial({ color: "#3a3d42", roughness: 0.35, metalness: 0.2 });
const TAILLIGHT_OFF = new THREE.MeshStandardMaterial({ color: "#5a1414", roughness: 0.4 });

// Ground plane in every vehicle's local space: Traffic.tsx places each lane's
// group at world y = RIDE_HEIGHT regardless of kind, so whatever we build has
// to put its tyre contact patch at local y = -RIDE_HEIGHT or it floats/sinks.
const FLOOR = -RIDE_HEIGHT;

// Unit cylinder pre-rotated onto the axle (x) axis, scaled per wheel instead
// of a fixed size — same trick SupercarBody's TIRE_GEO/RIM_GEO use.
const TIRE_GEO = new THREE.CylinderGeometry(1, 1, 1, 16).rotateZ(Math.PI / 2);
const RIM_GEO = new THREE.CylinderGeometry(0.58, 0.58, 1.04, 12).rotateZ(Math.PI / 2);
// jeep spare, mounted flat against the tailgate — axle along z, not x
const SPARE_GEO = new THREE.CylinderGeometry(1, 1, 1, 16).rotateX(Math.PI / 2);

function Wheel({
  x,
  z,
  radius,
  width,
  detail,
}: {
  x: number;
  z: number;
  radius: number;
  width: number;
  detail: Detail;
}) {
  return (
    <group position={[x, FLOOR + radius, z]}>
      <mesh geometry={TIRE_GEO} material={TIRE} scale={[width, radius, radius]} castShadow />
      {detail === "high" && (
        <mesh geometry={RIM_GEO} material={RIM} scale={[width * 0.85, radius * 0.55, radius * 0.55]} />
      )}
    </group>
  );
}

// Wheel-arch liner: same bug as SupercarBody.tsx's tyres — the skid/rail/hull
// slab that runs the vehicle's length sits well above the wheel and never
// reached down to it, so the tyre floated exposed under the body with nothing
// bracketing it front-to-back. This closes that gap on the outboard face at
// each corner, sized off the wheel's own radius so it scales with jeep/bus/
// truck's very different tyre sizes.
function WheelArch({ x, z, radius, material }: { x: number; z: number; radius: number; material: THREE.Material }) {
  return (
    <mesh position={[x, FLOOR + radius * 0.85, z]} material={material} castShadow>
      <boxGeometry args={[0.14, radius * 1.5, radius * 2.05]} />
    </mesh>
  );
}

export type CommercialKind = "jeep" | "bus" | "truck";

export function CommercialBody({
  kind,
  color,
  detail = "high",
  lit = true,
  lightRefs,
}: {
  kind: CommercialKind;
  color: string;
  detail?: Detail;
  lit?: boolean;
  lightRefs?: LightRefs;
}) {
  if (kind === "bus") return <BusBody color={color} detail={detail} lit={lit} lightRefs={lightRefs} />;
  if (kind === "truck") return <TruckBody color={color} detail={detail} lit={lit} lightRefs={lightRefs} />;
  return <JeepBody color={color} detail={detail} lit={lit} lightRefs={lightRefs} />;
}

// small flashing beacon mesh, dropped at a mirror/stalk position — undefined-
// safe on lightRefs so Traffic.tsx's own NPC copies (which pass none) just
// render a static amber dot instead of crashing on a missing ref array
function Beacon({ x, y, z, index, lightRefs }: { x: number; y: number; z: number; index: number; lightRefs?: LightRefs }) {
  return (
    <mesh position={[x, y, z]}>
      <sphereGeometry args={[0.05, 8, 8]} />
      <meshBasicMaterial ref={(el) => { if (lightRefs) lightRefs.current[index] = el; }} color="#ffb000" />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Jeep: boxy 4x4, flat hardtop, big wheels for a taller stance than the
// sedan, spare tire on the tailgate — that spare is the one silhouette cue
// that stays visible at every detail level, the rest of the fine stuff
// (mirrors, hub caps) drops out at low like SupercarBody's chrome trim does.
function JeepBody({ color, detail, lit, lightRefs }: { color: string; detail: Detail; lit: boolean; lightRefs?: LightRefs }) {
  const body = paint(color);
  const high = detail === "high";
  const headlightMat = lit ? HEADLIGHT : HEADLIGHT_OFF;
  const taillightMat = lit ? TAILLIGHT : TAILLIGHT_OFF;
  const wr = 0.42; // bigger than the sedan's 0.34/0.36 tyres — reads as a lifted 4x4

  return (
    <group>
      {/* frame/skid */}
      <mesh position={[0, FLOOR + 0.48, 0]} material={body} castShadow receiveShadow>
        <boxGeometry args={[1.92, 0.28, 3.5]} />
      </mesh>
      {/* rocker skirt */}
      <mesh position={[0, FLOOR + 0.24, -0.1]} material={TRIM} castShadow>
        <boxGeometry args={[2.0, 0.14, 2.1]} />
      </mesh>
      {/* boxy tub/cabin — the main silhouette */}
      <mesh position={[0, FLOOR + 1.0, -0.1]} material={body} castShadow>
        <boxGeometry args={[1.84, 0.68, 3.15]} />
      </mesh>
      {/* flat hood, lower than the cabin roof */}
      <mesh position={[0, FLOOR + 0.82, 1.82]} material={body} castShadow>
        <boxGeometry args={[1.62, 0.34, 1.0]} />
      </mesh>
      {/* flat hardtop roof */}
      <mesh position={[0, FLOOR + 1.4, -0.35]} material={body} castShadow>
        <boxGeometry args={[1.76, 0.08, 1.9]} />
      </mesh>
      {/* windshield */}
      <mesh position={[0, FLOOR + 1.1, 1.02]} rotation={[0.62, 0, 0]} material={GLASS}>
        <boxGeometry args={[1.5, 0.5, 0.05]} />
      </mesh>
      {/* side glass */}
      {[0.94, -0.94].map((x) => (
        <mesh key={`sg${x}`} position={[x, FLOOR + 1.0, -0.15]} material={GLASS}>
          <boxGeometry args={[0.03, 0.32, 1.95]} />
        </mesh>
      ))}
      {/* grille */}
      <mesh position={[0, FLOOR + 0.56, 2.34]} material={TRIM}>
        <boxGeometry args={[1.5, 0.3, 0.06]} />
      </mesh>
      {/* bumpers */}
      <mesh position={[0, FLOOR + 0.4, 2.4]} material={TRIM} castShadow>
        <boxGeometry args={[1.92, 0.16, 0.14]} />
      </mesh>
      <mesh position={[0, FLOOR + 0.4, -1.85]} material={TRIM} castShadow>
        <boxGeometry args={[1.92, 0.16, 0.14]} />
      </mesh>
      {/* headlights / taillights */}
      {[0.55, -0.55].map((x) => (
        <mesh key={`hl${x}`} position={[x, FLOOR + 0.66, 2.42]} material={headlightMat}>
          <boxGeometry args={[0.28, 0.12, 0.05]} />
        </mesh>
      ))}
      {[0.7, -0.7].map((x) => (
        <mesh key={`tl${x}`} position={[x, FLOOR + 0.7, -1.9]} material={taillightMat}>
          <boxGeometry args={[0.16, 0.14, 0.05]} />
        </mesh>
      ))}
      {/* headlight beam pool, ahead of the front bumper — same shared quad
          every other vehicle in the game uses */}
      {lit && (
        <mesh position={[0, FLOOR + 0.03, 6.0]} rotation={[-Math.PI / 2, 0, 0]} material={BEAM} renderOrder={2}>
          <planeGeometry args={[4.6, 7.2]} />
        </mesh>
      )}
      {/* spare tire on the tailgate — the defining jeep cue, kept at every
          detail level unlike the fine chrome below */}
      <mesh position={[0, FLOOR + 0.98, -1.98]} material={TIRE} scale={[0.36, 0.36, 0.2]} geometry={SPARE_GEO} castShadow />
      {high && (
        <mesh position={[0, FLOOR + 0.98, -2.04]} material={RIM} scale={[0.2, 0.2, 0.22]} geometry={SPARE_GEO} />
      )}
      {/* mirrors — high detail only, same call SupercarBody makes — plus an
          amber beacon at each, flashed by the owning drive rig (or static
          amber for Traffic.tsx's own un-driven NPC copies) */}
      {high &&
        [1, -1].map((s, i) => (
          <group key={`mir${s}`}>
            <mesh position={[s * 0.98, FLOOR + 1.12, 1.2]} material={TRIM} castShadow>
              <boxGeometry args={[0.06, 0.12, 0.14]} />
            </mesh>
            <Beacon x={s * 0.98} y={FLOOR + 1.2} z={1.2} index={i} lightRefs={lightRefs} />
          </group>
        ))}

      <Wheel x={0.86} z={1.5} radius={wr} width={0.34} detail={detail} />
      <Wheel x={-0.86} z={1.5} radius={wr} width={0.34} detail={detail} />
      <Wheel x={0.86} z={-1.5} radius={wr} width={0.34} detail={detail} />
      <Wheel x={-0.86} z={-1.5} radius={wr} width={0.34} detail={detail} />
      <WheelArch x={0.9} z={1.5} radius={wr} material={body} />
      <WheelArch x={-0.9} z={1.5} radius={wr} material={body} />
      <WheelArch x={0.9} z={-1.5} radius={wr} material={body} />
      <WheelArch x={-0.9} z={-1.5} radius={wr} material={body} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Bus: long rectangular box, tall, rows of side glass, one livery stripe.
function BusBody({ color, detail, lit, lightRefs }: { color: string; detail: Detail; lit: boolean; lightRefs?: LightRefs }) {
  const body = paint(color);
  const livery = liveryFor(color);
  const high = detail === "high";
  const headlightMat = lit ? HEADLIGHT : HEADLIGHT_OFF;
  const taillightMat = lit ? TAILLIGHT : TAILLIGHT_OFF;
  const wr = 0.48; // biggest tyre of the three — a bus rides on real truck-size rubber

  return (
    <group>
      {/* lower hull */}
      <mesh position={[0, FLOOR + 0.4, 0]} material={body} castShadow receiveShadow>
        <boxGeometry args={[2.16, 0.5, 6.4]} />
      </mesh>
      {/* main body — the long tall box that reads as "bus" from a block away */}
      <mesh position={[0, FLOOR + 1.28, 0]} material={body} castShadow>
        <boxGeometry args={[2.1, 1.5, 6.2]} />
      </mesh>
      {/* roof cap */}
      <mesh position={[0, FLOOR + 2.1, 0]} material={body} castShadow>
        <boxGeometry args={[2.0, 0.14, 6.0]} />
      </mesh>
      {/* livery stripe at the beltline */}
      <mesh position={[0, FLOOR + 0.98, 0]} material={livery} castShadow>
        <boxGeometry args={[2.18, 0.22, 6.42]} />
      </mesh>
      {/* windshield + rear glass */}
      <mesh position={[0, FLOOR + 1.5, 3.06]} rotation={[0.1, 0, 0]} material={GLASS}>
        <boxGeometry args={[1.9, 0.7, 0.06]} />
      </mesh>
      <mesh position={[0, FLOOR + 1.5, -3.06]} rotation={[-0.06, 0, 0]} material={GLASS}>
        <boxGeometry args={[1.9, 0.6, 0.06]} />
      </mesh>
      {/* rows of side windows, both sides */}
      {[1, -1].map((s) =>
        [-2.6, -1.4, -0.2, 1.0, 2.2].map((z) => (
          <mesh key={`sw${s}-${z}`} position={[s * 1.06, FLOOR + 1.35, z]} material={GLASS}>
            <boxGeometry args={[0.04, 0.55, 0.9]} />
          </mesh>
        ))
      )}
      {/* front/rear bumper trim */}
      <mesh position={[0, FLOOR + 0.42, 3.36]} material={TRIM} castShadow>
        <boxGeometry args={[2.1, 0.24, 0.12]} />
      </mesh>
      <mesh position={[0, FLOOR + 0.42, -3.36]} material={TRIM} castShadow>
        <boxGeometry args={[2.1, 0.24, 0.12]} />
      </mesh>
      {/* headlights / taillights */}
      {[0.85, -0.85].map((x) => (
        <mesh key={`hl${x}`} position={[x, FLOOR + 0.68, 3.4]} material={headlightMat}>
          <boxGeometry args={[0.3, 0.14, 0.05]} />
        </mesh>
      ))}
      <mesh position={[0, FLOOR + 0.68, -3.4]} material={taillightMat}>
        <boxGeometry args={[1.9, 0.1, 0.05]} />
      </mesh>
      {lit && (
        <mesh position={[0, FLOOR + 0.03, 7.4]} rotation={[-Math.PI / 2, 0, 0]} material={BEAM} renderOrder={2}>
          <planeGeometry args={[5.4, 8.4]} />
        </mesh>
      )}
      {/* front door inset — high detail only, a subtle panel line, not core silhouette */}
      {high && (
        <mesh position={[1.08, FLOOR + 1.0, 1.9]} material={TRIM}>
          <boxGeometry args={[0.04, 0.9, 0.7]} />
        </mesh>
      )}
      {/* mirror stalks — BusBody had none at all; same style/height as the
          jeep/truck mirrors, mounted either side of the windshield, plus the
          same amber beacon */}
      {high &&
        [1, -1].map((s, i) => (
          <group key={`mir${s}`}>
            <mesh position={[s * 1.08, FLOOR + 1.62, 2.9]} material={TRIM} castShadow>
              <boxGeometry args={[0.06, 0.16, 0.18]} />
            </mesh>
            <Beacon x={s * 1.08} y={FLOOR + 1.72} z={2.9} index={i} lightRefs={lightRefs} />
          </group>
        ))}

      <Wheel x={0.83} z={2.4} radius={wr} width={0.4} detail={detail} />
      <Wheel x={-0.83} z={2.4} radius={wr} width={0.4} detail={detail} />
      <Wheel x={0.83} z={-2.4} radius={wr} width={0.4} detail={detail} />
      <Wheel x={-0.83} z={-2.4} radius={wr} width={0.4} detail={detail} />
      <WheelArch x={0.9} z={2.4} radius={wr} material={body} />
      <WheelArch x={-0.9} z={2.4} radius={wr} material={body} />
      <WheelArch x={0.9} z={-2.4} radius={wr} material={body} />
      <WheelArch x={-0.9} z={-2.4} radius={wr} material={body} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Truck: cab-over cab (no hood — simpler than a bonneted cab, and reads
// clearly as "truck" next to a box cargo body that's taller/wider than the cab).
function TruckBody({ color, detail, lit, lightRefs }: { color: string; detail: Detail; lit: boolean; lightRefs?: LightRefs }) {
  const body = paint(color);
  const high = detail === "high";
  const headlightMat = lit ? HEADLIGHT : HEADLIGHT_OFF;
  const taillightMat = lit ? TAILLIGHT : TAILLIGHT_OFF;
  const wr = 0.44;

  return (
    <group>
      {/* chassis rail spanning cab + cargo */}
      <mesh position={[0, FLOOR + 0.32, -0.5]} material={body} castShadow receiveShadow>
        <boxGeometry args={[1.9, 0.2, 5.4]} />
      </mesh>
      {/* cab-over cab */}
      <mesh position={[0, FLOOR + 0.92, 1.7]} material={body} castShadow>
        <boxGeometry args={[1.86, 0.86, 1.55]} />
      </mesh>
      {/* windshield */}
      <mesh position={[0, FLOOR + 1.1, 2.44]} rotation={[0.15, 0, 0]} material={GLASS}>
        <boxGeometry args={[1.6, 0.5, 0.05]} />
      </mesh>
      {/* cab side glass */}
      {[0.94, -0.94].map((x) => (
        <mesh key={`sg${x}`} position={[x, FLOOR + 1.06, 1.6]} material={GLASS}>
          <boxGeometry args={[0.03, 0.34, 0.5]} />
        </mesh>
      ))}
      {/* cab grille + bumper */}
      <mesh position={[0, FLOOR + 0.56, 2.5]} material={TRIM}>
        <boxGeometry args={[1.86, 0.22, 0.1]} />
      </mesh>
      {/* box cargo — taller and wider than the cab, the truck's real bulk */}
      <mesh position={[0, FLOOR + 1.32, -1.1]} material={body} castShadow>
        <boxGeometry args={[2.05, 1.7, 3.7]} />
      </mesh>
      {/* rear door panel line — high only, subtle */}
      {high && (
        <mesh position={[0, FLOOR + 1.32, -2.97]} material={TRIM}>
          <boxGeometry args={[2.0, 1.6, 0.04]} />
        </mesh>
      )}
      {/* headlights / taillights */}
      {[0.6, -0.6].map((x) => (
        <mesh key={`hl${x}`} position={[x, FLOOR + 0.72, 2.52]} material={headlightMat}>
          <boxGeometry args={[0.26, 0.14, 0.05]} />
        </mesh>
      ))}
      {[0.8, -0.8].map((x) => (
        <mesh key={`tl${x}`} position={[x, FLOOR + 0.5, -2.98]} material={taillightMat}>
          <boxGeometry args={[0.18, 0.24, 0.05]} />
        </mesh>
      ))}
      {lit && (
        <mesh position={[0, FLOOR + 0.03, 6.6]} rotation={[-Math.PI / 2, 0, 0]} material={BEAM} renderOrder={2}>
          <planeGeometry args={[5.0, 7.8]} />
        </mesh>
      )}
      {/* mirrors — high detail only, plus an amber beacon at each */}
      {high &&
        [1, -1].map((s, i) => (
          <group key={`mir${s}`}>
            <mesh position={[s * 1.0, FLOOR + 1.14, 2.1]} material={TRIM} castShadow>
              <boxGeometry args={[0.06, 0.14, 0.16]} />
            </mesh>
            <Beacon x={s * 1.0} y={FLOOR + 1.22} z={2.1} index={i} lightRefs={lightRefs} />
          </group>
        ))}

      <Wheel x={0.86} z={1.55} radius={wr} width={0.36} detail={detail} />
      <Wheel x={-0.86} z={1.55} radius={wr} width={0.36} detail={detail} />
      <Wheel x={0.86} z={-1.9} radius={wr} width={0.4} detail={detail} />
      <Wheel x={-0.86} z={-1.9} radius={wr} width={0.4} detail={detail} />
      <WheelArch x={0.9} z={1.55} radius={wr} material={body} />
      <WheelArch x={-0.9} z={1.55} radius={wr} material={body} />
      <WheelArch x={0.9} z={-1.9} radius={wr} material={body} />
      <WheelArch x={-0.9} z={-1.9} radius={wr} material={body} />
    </group>
  );
}
