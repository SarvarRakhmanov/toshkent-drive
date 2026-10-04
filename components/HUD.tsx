"use client";

import { useHudStore, CAM_MODES, type CamMode } from "@/lib/hudStore";
import { useAuthStore } from "@/lib/authStore";
import { useGfxStore } from "@/lib/gfx";
import { WantedHud } from "@/components/WantedHud";
import { usePlayerCarStore, PLAYER_CARS } from "@/lib/playerCar";
import { actionNextCar } from "@/lib/actions";
import { PauseMenu } from "@/components/PauseMenu";
import { CreditsPanel, useCreditsStore } from "@/components/CreditsPanel";
import { saveGame } from "@/lib/saveGame";
import { Minimap } from "@/components/Minimap";
import { BigMap } from "@/components/BigMap";
import { Phone } from "@/components/Phone";
import { MissionHud } from "@/components/MissionHud";
import { ServicePanel } from "@/components/ServicePanel";
import { Ambience } from "@/components/Ambience";
import { useTouchStore } from "@/lib/touch";

// Speedo/NitroBar/Waypoint each own their own store subscription and are
// split out from HUD's own render — speedKmh/nitroFuel/waypointDist all
// change nearly every frame while driving (constant 0 while parked, which is
// why the lag reported only starts "as soon as I accelerate"). Before this
// split, all three lived directly in HUD(), so React re-rendered the WHOLE
// HUD tree — camsel buttons, the static controls legend, the sensitivity
// slider, the Minimap/BigMap wrapper divs — 60x/sec any time any of them
// ticked, on top of the Canvas's own render loop. Isolating each fast-
// changing value to its own leaf component means only that few-line
// component re-renders per tick; HUD's own shell only re-renders on its
// own (much rarer) state changes.
function Speedo() {
  const active = useHudStore((s) => s.active);
  const speedKmh = useHudStore((s) => s.speedKmh);
  const vehicleName = useHudStore((s) => s.vehicleName());
  const gear = useHudStore((s) => s.gear);
  const rpmFrac = useHudStore((s) => s.rpmFrac);
  if (active === "foot") return null;
  const isCar = active === "car";
  return (
    <div id="speedo" style={{ display: "block" }}>
      <div className="num">{speedKmh}</div>
      <div className="unit">KM/H{isCar && <span className="gear">{gear < 0 ? "R" : speedKmh < 1 && gear === 1 ? "N" : gear}</span>}</div>
      {isCar && <div className="rpm"><div className={rpmFrac > 0.92 ? "fill red" : "fill"} style={{ width: `${Math.round(rpmFrac * 100)}%` }} /></div>}
      <div className="veh">{vehicleName}</div>
    </div>
  );
}

function NitroBar() {
  const active = useHudStore((s) => s.active);
  const nitroFuel = useHudStore((s) => s.nitroFuel);
  const nitroActive = useHudStore((s) => s.nitroActive);
  const isTouch = useTouchStore((s) => s.isTouch);
  if (active !== "car") return null;
  return (
    <div id="nitrobar" className={nitroActive ? "active" : ""} style={{ display: "block" }}>
      <div className="nlabel">
        NITRO {!isTouch && <span className="nhint">(SHIFT)</span>}
      </div>
      <div className="ntrack">
        <div className="nfill" style={{ width: `${(nitroFuel * 100).toFixed(1)}%` }} />
      </div>
    </div>
  );
}

function Waypoint() {
  const navTarget = useHudStore((s) => s.navTarget);
  const waypointDist = useHudStore((s) => s.waypointDist);
  const waypointDeg = useHudStore((s) => s.waypointDeg);
  if (!navTarget || waypointDist < 7) return null;
  return (
    <div id="waypoint" style={{ display: "flex" }}>
      <span className="arrow" style={{ color: navTarget.col, transform: `rotate(${waypointDeg}deg)` }}>
        ➤
      </span>
      <span className="lbl">{navTarget.name}</span>
      <span className="dist">{Math.round(waypointDist)}m</span>
    </div>
  );
}

function ClockDisplay() {
  const clock = useHudStore((s) => s.clock);
  return <div id="clock">{clock}</div>;
}

function _UnusedLogoutButton() {
  const signOut = useAuthStore((s) => s.signOut);
  return (
    <button
      id="logout"
      type="button"
      onClick={() => {
        saveGame();
        signOut();
      }}
    >
      LOG OUT
    </button>
  );
}

// DOM/CSS structure ported 1:1 from the original index.html's HUD (#hud,
// #speedo, #nitrobar, #hint, #msg, #camsel, #controls, #vig, #minimap,
// #waypoint, #mapscreen — see app/globals.css for the matching styles,
// copied from the original's <style> block). Touch devices get their own
// controls instead (components/TouchControls.tsx) and hide the keyboard-only
// bits (camera tabs, look slider, key legend, GFX/CAR labels) — those live
// in the touch top row / "more" menu there.
function GfxButton() {
  const quality = useGfxStore((s) => s.quality);
  const toggle = useGfxStore((s) => s.toggle);
  const car = usePlayerCarStore((s) => s.index);
  return (
    <div id="td-tools">
      <button type="button" onClick={() => { saveGame(); toggle(); }} title="Graphics quality (Q)">
        GFX: {quality === "high" ? "HIGH" : "LOW"}
      </button>
      <button type="button" onClick={() => actionNextCar()} title="Change car (K)">
        CAR: {PLAYER_CARS[car].name}
      </button>
    </div>
  );
}

export function HUD() {
  const isTouch = useTouchStore((s) => s.isTouch);
  const toggleControlsVisible = useHudStore((s) => s.toggleControlsVisible);
  const controlsVisible = useHudStore((s) => s.controlsVisible);
  const hint = useHudStore((s) => s.hint);
  const msg = useHudStore((s) => s.msg);
  const camMode = useHudStore((s) => s.camMode);
  const setCamMode = useHudStore((s) => s.setCamMode);
  const setMapOpen = useHudStore((s) => s.setMapOpen);
  const lookSensitivity = useHudStore((s) => s.lookSensitivity);
  const setLookSensitivity = useHudStore((s) => s.setLookSensitivity);

  return (
    <>
      <div id="hud">
        <div className="title">TOSHKENT DRIVE</div>
        <ClockDisplay />
      </div>

      {!isTouch && <GfxButton />}

      <Speedo />
      <NitroBar />
      <Waypoint />

      {hint && (
        <div id="hint" style={{ display: "block" }}>
          {isTouch ? hint.replace(/^Press E/, "Tap E") : hint}
        </div>
      )}

      <div id="msg" className={msg ? "show" : ""}>
        {msg}
      </div>

      {!isTouch && (
      <>
      <div id="camsel">
        {CAM_MODES.map((name, i) => (
          <button
            key={name}
            type="button"
            className={camMode === i ? "on" : ""}
            onClick={() => setCamMode(i as CamMode)}
          >
            {name}
          </button>
        ))}
      </div>

      <div id="sensitivity">
        <label htmlFor="sensSlider">LOOK SENS</label>
        <input
          id="sensSlider"
          type="range"
          min={0.4}
          max={2.5}
          step={0.05}
          value={lookSensitivity}
          onChange={(e) => setLookSensitivity(parseFloat(e.target.value))}
        />
        <span>{lookSensitivity.toFixed(2)}x</span>
      </div>

      <button
        id="helpbtn"
        type="button"
        className={controlsVisible ? "on" : ""}
        onClick={toggleControlsVisible}
        title="Keyboard controls (H)"
        aria-expanded={controlsVisible}
      >
        ?
      </button>
      {controlsVisible && (
      <div id="controls">
        <b>W A S D</b> move / drive
        <br />
        <b>SPACE</b> handbrake
        <br />
        <b>SHIFT</b> nitro (car)
        <br />
        <b>R</b> reset car onto road
        <br />
        <b>K</b> change car (Seltos/Lacetti/M3/K5/M3 Comp.)
        <br />
        <b>Q</b> graphics high / low
        <br />
        <b>G</b> city map
        <br />
        <b>F</b> fire main gun (tank)
        <br />
        <b>SPACE</b> jump (on foot)
        <br />
        <b>E</b> vehicle / club door
        <br />
        <b>B</b> switch vehicle
        <br />
        <b>CLICK</b> free-look camera
        <br />
        <b>C</b> camera view
        <br />
        <b>L</b> headlights auto/on/off
        <br />
        <b>M</b> mute engine
        <br />
        <b>P</b> phone
        <br />
        <b>H</b> hide this help
        <br />
        <button type="button" className="td-credits-link" onClick={() => useCreditsStore.getState().setOpen(true)}>CREDITS</button>
      </div>
      )}
      </>
      )}

      <CreditsPanel />
      <div id="vig" />
      <div onClick={() => setMapOpen(true)}>
        <Minimap />
      </div>
      {!isTouch && <div id="maphint">click map for directions</div>}
      <BigMap />
      <Phone />
      <MissionHud />
      <ServicePanel />
      <Ambience />
      <WantedHud />
      <PauseMenu />
    </>
  );
}
