"use client";

// Game actions shared by the keyboard shortcuts (components/Game.tsx) and the
// on-screen touch buttons (components/TouchControls.tsx), so both always do
// exactly the same thing.
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

export function actionNextCar() {
  usePlayerCarStore.getState().next();
  hud().showMsg("CAR: " + PLAYER_CARS[usePlayerCarStore.getState().index].name);
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
