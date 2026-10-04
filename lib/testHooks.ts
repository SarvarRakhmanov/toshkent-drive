// Automation hooks for the Playwright tests (scripts/*.cjs). Read-mostly; the
// only "write" is summoning the player's own car, which the in-game phone can
// already do. Not used by the game itself.
import { requestCarSummon } from "@/lib/vehicleSummon";
import { trafficPositions } from "@/components/Traffic";
import { vehicleState } from "@/lib/vehicleState";
import { useLoadStore } from "@/lib/loadState";
import { frameErrors } from "@/lib/safeFrame";
import { physicsHealth } from "@/lib/physicsGuard";
import { useHudStore } from "@/lib/hudStore";
import { cameraLook } from "@/lib/cameraLook";
import { pedestrianPositions, pedDrawStats } from "@/components/Pedestrians";
import { requestPlayerTeleport } from "@/lib/playerTeleport";
import { worldState } from "@/lib/worldState";
import { signalFor, signalTime } from "@/lib/trafficSignals";
import { useMissions, type MissionKind } from "@/lib/missions";
import { useWanted } from "@/lib/wanted";
import { chaseUnits } from "@/components/PoliceChase";
import { useCareer } from "@/lib/career";
import { weatherState } from "@/lib/weatherState";
import { carSummon } from "@/lib/vehicleSummon";
import { carSafety, carWorldRef } from "@/components/Car";
import { isClear } from "@/lib/safeSpot";
import { skyState } from "@/lib/skyState";
import { ambienceState } from "@/lib/ambience";
import { fuelOf, fuelSpec, fuelTank, useEconomy, carRepair, STATIONS, HOUSES, pumpSpot, houseSpot } from "@/lib/economy";
import { PLAYER_CARS, usePlayerCarStore } from "@/lib/playerCar";
import { engineTelemetry } from "@/lib/vehicleDynamics";

if (typeof window !== "undefined") {
  (window as unknown as { __td: unknown }).__td = {
    // v1.7b: NPC traffic state (scripts/traffic-heading-test.cjs)
    npcTraffic: () => trafficPositions.map((t, i) => ({ i, npc: t.npc, x: t.x, z: t.z, h: t.h, speed: t.speed, uturn: t.uturn, axis: t.laneAxis, c: t.laneC, convoy: t.convoy, stolen: t.stolen })),
    summonCar: (x: number, z: number, h: number) => requestCarSummon(x, z, h),
    // v1.6.1: place the car EXACTLY there (no safe-spot search) — stuck tests
    forceCar: (x: number, z: number, h: number) => { requestCarSummon(x, z, h); carSummon.raw = true; },
    safety: () => ({ ...carSafety }),
    clear: (x: number, z: number, h = 0, ahead = 0) => (carWorldRef.world ? isClear(carWorldRef.world, x, z, h, ahead) : null),
    traffic: () => trafficPositions.map((t) => ({ x: t.x, z: t.z, h: t.h, police: t.police, stolen: t.stolen, kind: t.kind ?? null })),
    car: () => ({ ...vehicleState.car }),
    load: () => { const s = useLoadStore.getState(); return { phase: s.phase, progress: s.progress, stage: s.stage, readyAt: s.readyAt }; },
    health: () => ({ frameErrors: { ...frameErrors }, physics: { ...physicsHealth } }),
    active: () => useHudStore.getState().active,
    // orbit the chase camera (screenshots of the car's front)
    pedStats: () => ({ ...pedDrawStats, total: pedestrianPositions.length }),
    peds: () => pedestrianPositions.map((p) => ({ x: p.x, z: p.z, h: p.h, robot: p.robot })),
    player: () => ({ x: worldState.px, y: worldState.py, z: worldState.pz, h: worldState.heading }),
    // on-foot only: drop the player at x,z facing h (screenshots of the robots)
    tp: (x: number, z: number, h = 0) => requestPlayerTeleport(x, z, h),
    mission: () => { const m = useMissions.getState().m; return m ? { kind: m.kind, stage: m.stage, n: m.targets.length, target: m.targets[m.stage], timeLeft: m.timeLeft, pay: m.pay } : null; },
    startMission: (k: MissionKind) => useMissions.getState().start(k),
    wanted: () => { const w = useWanted.getState(); return { level: w.level, reason: w.reason, evade: w.evade, bust: w.bust, fines: w.fines, units: chaseUnits.filter((u) => u.on).map((u) => ({ x: +u.x.toFixed(1), z: +u.z.toFixed(1), v: +u.v.toFixed(1) })) }; },
    crime: (c: "red" | "crash" | "ped") => useWanted.getState().report(c),
    career: () => { const c = useCareer.getState(); return { money: c.money, jobs: c.jobs, levels: c.levels, rev: c.rev }; },
    ambience: () => ({ ...ambienceState }),
    // v1.8 economy
    fuel: () => { const id = PLAYER_CARS[usePlayerCarStore.getState().index]?.id ?? ""; return { id, litres: fuelOf(id), tank: fuelSpec(id).tank, damage: engineTelemetry.damage }; },
    setFuel: (l: number) => { const id = PLAYER_CARS[usePlayerCarStore.getState().index]?.id ?? ""; fuelTank[id] = l; },
    damage: (v: number) => { carRepair.set = v; },
    econ: () => { const e = useEconomy.getState(); return { owned: e.owned, houses: e.houses, home: e.home, loaded: e.loaded }; },
    stations: () => STATIONS.map((s) => ({ ...s, pump: pumpSpot(s) })),
    houses: () => HOUSES.map((h) => ({ ...h, spot: houseSpot(h) })),
    giveMoney: (n: number) => useCareer.getState().addMoney(n),
    buyUpgrade: (car: string, k: "power" | "grip" | "brakes" | "weight") => useCareer.getState().buy(car, k),
    enter: (k: string) => { useHudStore.getState().setActive(k as never); useHudStore.getState().setCamMode(0); },
    weather: (k?: string) => { if (k) { weatherState.kind = k as never; weatherState.timer = 9999; } return { kind: weatherState.kind, wind: { ...weatherState.wind }, flash: weatherState.flash, hour: skyState.hour, nightK: skyState.nightK }; },
    // phase: sine phase of the day cycle (0.9 ~ 09:30, 3.9 ~ dusk/night, 4.7 ~ midnight)
    skyPhase: (p: number) => { skyState.jumpTo = p; },
    signal: () => { const t = signalTime(); return { t, x: signalFor("x", t), z: signalFor("z", t) }; },
    look: (yaw: number, pitch = 0) => { cameraLook.targetYaw = cameraLook.yaw = yaw; cameraLook.targetPitch = cameraLook.pitch = pitch; },
  };
}
