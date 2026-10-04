"use client";

import { create } from "zustand";

// In-game credits (the full list lives in CREDITS.md). Opened from the desktop
// help panel ("?") and from the touch "…" menu.
export const useCreditsStore = create<{ open: boolean; setOpen: (o: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

const REPO = "https://github.com/SarvarRakhmanov/toshkent-drive/blob/main/CREDITS.md";

export function CreditsPanel() {
  const open = useCreditsStore((s) => s.open);
  const setOpen = useCreditsStore((s) => s.setOpen);
  if (!open) return null;
  return (
    <div id="td-credits" role="dialog" aria-label="Credits" onPointerDown={(e) => e.stopPropagation()}>
      <button type="button" className="close" onClick={() => setOpen(false)} aria-label="Close credits">✕</button>
      <h2>CREDITS</h2>
      <p>
        <b>BMW M3 Competition</b> by{" "}
        <a href="https://sketchfab.com/VTX_car" target="_blank" rel="noreferrer">VTX</a>{" "}
        (<a href="https://sketchfab.com/3d-models/bmw-m3-competition-641603169bfa4285a297a59883c653de" target="_blank" rel="noreferrer">Sketchfab</a>),{" "}
        <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noreferrer">CC BY-NC-SA 4.0</a>,
        modified (decimated/compressed). The modified model is shared under the same license, so
        Toshkent Drive is a free, non-commercial game.
      </p>
      <p>
        <b>Lacetti</b> by uzb_rx7, <b>BMW M3 E30</b> by TinoD2, <b>Kia K5</b> by dannzjs,{" "}
        <b>Chevrolet Cobalt LTZ</b> by uzb_rx7, <b>Chevrolet Captiva</b> by Alien1974555,{" "}
        <b>Lada VAZ-2103 Zhiguli</b> by Black Snow (Sketchfab, CC BY 4.0, modified: decimated/compressed). Kia Seltos model supplied by the owner.
      </p>
      <p>
        Cockpit interiors: <b>Autonomous GT Car Interior Design</b> by benlockett and{" "}
        <b>Car interior</b> by Gerhald (Sketchfab, CC BY 4.0, modified).
      </p>
      <p>
        Player robot: <b>The Big Boss</b> by FrazierChristopher (Sketchfab, CC BY 4.0, modified).
      </p>
      <p>
        Pedestrian robots: <b>Militor Mechanoid</b> and <b>Checkered Guard</b> by Lagst,{" "}
        <b>Mini-bot</b> by lorib2306, <b>WW1 french robot solider</b> by bovos5,{" "}
        <b>Biped robot</b> by skudgee, <b>Robot</b> by bumstrum (Sketchfab, CC BY 4.0, modified).
      </p>
      <p>
        Traffic cars by DanielZhabotinsky and roh3d. Buildings by cn-entertainment, MrAeterna,
        bral_unit, Lost_Gecko and Colin.Greenall (Sketchfab, CC BY 4.0). Sky HDRI and tree
        textures from Poly Haven (CC0).
      </p>
      <p>
        Engine template: Neon City Drive by ma67-ex (MIT). Built with three.js, React Three
        Fiber, Rapier and Next.js.
      </p>
      <p>
        Full list with links: <a href={REPO} target="_blank" rel="noreferrer">CREDITS.md</a>
      </p>
    </div>
  );
}
