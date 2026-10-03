import { registerInterior } from "@/lib/interiors";
import { useHudStore } from "@/lib/hudStore";

// CLUB_IN (interior) keeps the original's far-south coordinate; the EXTERIOR was
// moved off the (-50,-50) road intersection — where the 38×28 building straddled
// both streets — to the centre of the block one south of spawn. There it clears
// every road band (x∈[-19,19]⊂[-40,40], z∈[-114,-86]⊂[-140,-60]) and its +z
// entrance face still points back at the spawn block.
export const CLUB = { cx: 0, cz: -100 };
export const CLUB_IN = { x: -50, z: -4050 };

// exported so lib/ticketBooth.ts can place the booth a short walk from the
// door without duplicating this offset
export const DOOR_OUT = { x: CLUB.cx, z: CLUB.cz + 15.5 }; // matches the VENU landmark spot
const DOOR_IN = { x: CLUB_IN.x, z: CLUB_IN.z + 13 };

// VENU registered as lib/interiors.ts's first entry — same door points/
// thresholds/messages the original hand-written clubDoorAction()/
// clubHintText() used (on-foot-only restriction, teleport routing, and the
// wider hint-vs-action radii are all now generic, see lib/interiors.ts).
registerInterior({
  id: "venu",
  displayName: "VENU",
  enterMsg: "VENU — BOLLYWOOD NIGHT",
  exitMsg: "BACK ON THE STREET",
  doorOut: DOOR_OUT,
  doorIn: DOOR_IN,
  interiorSpawn: { x: CLUB_IN.x, z: CLUB_IN.z + 3, h: Math.PI },
  enterRadius2: 22,
  exitRadius2: 14,
  hintEnterRadius2: 40,
  hintExitRadius2: 30,
  // door won't let you in without a ticket from lib/ticketBooth.ts's booth
  gate: () => useHudStore.getState().hasTicket,
  gateMsg: "You need a ticket first — check the booth",
});
