export {};

declare global {
  interface Window {
    __controlsTest?: {
      getYaw: () => number;
      getSpeed: () => number;
      setKeys: (codes: string[]) => void;
      setSteer?: (v: number) => void;
      setCam?: (c: "chase" | "close" | "hood" | "cabin" | "rear" | "cinema") => void;
      debug?: () => unknown;
    };
  }
}

declare module "three/addons/environments/RoomEnvironment.js" {
  import { Scene } from "three";
  export class RoomEnvironment extends Scene {
    constructor();
  }
}
