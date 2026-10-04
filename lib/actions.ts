"use client";

// Game actions shared by the keyboard shortcuts (components/Game.tsx) and the
// on-screen touch buttons (components/TouchControls.tsx), so both always do
// exactly the same thing.
import { useEconomy, CAR_PRICE, HOUSES, houseSpot } from "@/lib/economy";
import { requestPlayerTeleport } from "@/lib/playerTeleport";
import { useHudStore, LIGHT_MODES, CAM_MODES } from "@/lib/hudStore";
import { useGfxStore } from "@/lib/gfx";
import { usePlayerCarStore, PLAYER_CARS } from "@/lib/playerCar";
import { requestCarSummon } from "@/lib/vehicleSummon";
import { worldState } from "@/lib/worldState";
import { toggleMute } from "@/lib/audio";
import { saveGame } from "@/lib/saveGame";
import { cycleWeather } from "@/lib/weatherState";
import { interiorDoorAction } from "@/lib/interiors";
import { toggleVehicleFoot } from "@/lib/player";
import { boatSwapAction } from "@/lib/boatSwap";
import { seatAction } from "@/lib/clubSeats";
import { armoryPickupAction } from "@/lib/armory";
import { ticketPickupAction } from "@/lib/ticketBooth";
import { stealTrafficAction } from "@/lib/steal";

const hud = () => useHudStore.getState();

/** E: ticket pickup beats door (need the ticket before the VENU gate matters) beats
 * sitting/standing beats gun pickup beats boat-swap beats mount beats stealing an NPC */
export function actionUse() {
  if (!ticketPickupAction() && !interiorDoorAction() && !seatAction() && !armoryPickupAction() && !boatSwapAction() && !toggleVehicleFoot()) stealTrafficAction();
}

export function actionSwitchVehicle() {
  const h = hud();
  h.toggleActive();
  h.showMsg("SWITCHED TO: " + h.vehicleName());
}

export function actionCamera() {
  const h = hud();
  h.cycleCamMode();
  h.showMsg("CAMERA: " + CAM_MODES[hud().camMode]);
}

export function actionLights() {
  const h = hud();
  h.showMsg("HEADLIGHTS: " + LIGHT_MODES[h.cycleLightMode()]);
}

export function actionMute() {
  hud().showMsg(toggleMute() ? "MUTED" : "UNMUTED");
}

export function actionWeather() {
  hud().showMsg("WEATHER: " + cycleWeather().toUpperCase());
}

export function actionMap() {
  const h = hud();
  h.setMapOpen(!h.mapOpen);
}

export function actionPhone() {
  const h = hud();
  h.setPhoneOpen(!h.phoneOpen);
}

export function actionGraphics() {
  saveGame();
  useGfxStore.getState().toggle();
  hud().showMsg("GRAPHICS: " + useGfxStore.getState().quality.toUpperCase());
}

/** v1.7b: K / car button / menu pick. Changes the player's car AND puts the
 *  player in it right away: from a bike, boat, plane, tank or on foot the car
 *  is brought to the player's spot (lib/safeSpot.ts picks a clear place next
 *  to it) and becomes the active vehicle. i undefined = next car. */
export function actionSelectCar(i?: number) {
  const pc = usePlayerCarStore.getState();
  const econ = useEconomy.getState();
  if (i === undefined) {
    // next OWNED car (v1.8: the dealer cars must be bought first)
    const n = PLAYER_CARS.length;
    let j = pc.index;
    for (let s = 0; s < n; s++) { j = (j + 1) % n; if (!econ.loaded || econ.isOwned(PLAYER_CARS[j].id)) break; }
    pc.select(j);
  } else {
    const c = PLAYER_CARS[i];
    if (c && econ.loaded && !econ.isOwned(c.id)) {
      hud().showMsg(`${c.name}: BUY IT AT AVTO BOZOR — $${CAR_PRICE[c.id] ?? 0}`);
      return;
    }
    pc.select(i);
  }
  const h = hud();
  if (h.stolenCar) h.setStolenCar(null);
  if (h.active !== "car") {
    const { px, pz, heading } = worldState;
    // right-hand side of where the player is (same side-step as dismounting)
    requestCarSummon(px + Math.cos(heading) * 3.2, pz - Math.sin(heading) * 3.2, heading);
    h.setActive("car");
  }
  h.showMsg("CAR: " + PLAYER_CARS[usePlayerCarStore.getState().index].name);
}

/** v1.8: back to the home you bought (lib/economy.ts) — car and all */
export function actionGoHome() {
  const e = useEconomy.getState();
  const h = HOUSES.find((q) => q.id === e.home);
  const H = hud();
  if (!h) { H.showMsg("BUY A HOME FIRST (FOR SALE SIGNS ON THE MAP)"); return; }
  const p = houseSpot(h);
  if (H.active === "car") requestCarSummon(p.x, p.z + 6, Math.PI);
  else if (H.active === "foot") requestPlayerTeleport(h.x + h.side * 2, h.z, -h.side * Math.PI / 2);
  else { requestCarSummon(p.x, p.z + 6, Math.PI); H.setActive("car"); }
  H.showMsg("HOME: " + h.name);
  setTimeout(saveGame, 1500);
}

export function actionNextCar() {
  actionSelectCar();
}

/** menu pick of a non-car vehicle (bike / boat) — same as the B cycle */
export function actionSelectVehicle(kind: "car" | "bike" | "boat") {
  if (kind === "car") return actionSelectCar(usePlayerCarStore.getState().index);
  const h = hud();
  h.setActive(kind);
  h.showMsg("SWITCHED TO: " + h.vehicleName());
}

/** reset / respawn: upright on the nearest road centre-lane, facing along it */
export function actionResetCar() {
  const h = hud();
  if (h.active !== "car") {
    h.showMsg("RESET WORKS IN YOUR CAR");
    return;
  }
  const { px, pz, heading } = worldState;
  const xs = Math.round((px - 50) / 100) * 100 + 50;
  const zs = Math.round((pz - 50) / 100) * 100 + 50;
  const along = (a: number, b: number) => (Math.cos(heading - a) >= Math.cos(heading - b) ? a : b);
  if (Math.abs(px - xs) <= Math.abs(pz - zs)) requestCarSummon(xs + 2.5, pz, along(0, Math.PI));
  else requestCarSummon(px, zs + 2.5, along(Math.PI / 2, -Math.PI / 2));
  h.showMsg("CAR RESET");
}
