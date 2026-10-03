export type Quality = "low" | "medium" | "high" | "ultra";
export type Density = "low" | "medium" | "high";
export type ControlMode = "wheel" | "buttons" | "tilt";
export type WeatherId = "sun" | "cloud" | "rain" | "fog";
export type MapId = "amir" | "grid" | "neon" | "block";

export type SaveData = {
  version: 2;
  money: number;
  unlocked: string[];
  vehicle: string;
  paint: string;
  tint: number;
  plate: string;
  upgrades: { engine: number; brakes: number; tires: number; suspension: number };
  missions: string[];
  settings: {
    quality: Quality;
    autoGfx: boolean;
    density: Density;
    control: ControlMode;
    showTouch: "auto" | "on" | "off";
    volume: number;
    weather: WeatherId;
    autoTime: boolean;
    hour: number;
    assists: { abs: boolean; tcs: boolean; esp: boolean };
    manual: boolean;
    unlimited: boolean;
    map: MapId;
  };
};

const KEY = "toshkent-drive-v2";
const OLD_KEY = "toshkent-drive-v1";

export const DEFAULT_SAVE: SaveData = {
  version: 2,
  money: 600,
  unlocked: ["seltos", "lacetti"],
  vehicle: "seltos",
  paint: "#b7c0b0",
  tint: 0.45,
  plate: "01 D 666 FB",
  upgrades: { engine: 0, brakes: 0, tires: 0, suspension: 0 },
  missions: [],
  settings: {
    quality: "high",
    autoGfx: true,
    density: "medium",
    control: "buttons",
    showTouch: "auto",
    volume: 0.7,
    weather: "sun",
    autoTime: false,
    hour: 16.7,
    assists: { abs: true, tcs: true, esp: true },
    manual: false,
    unlimited: false,
    map: "amir",
  },
};

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(OLD_KEY);
    if (!raw) return structuredClone(DEFAULT_SAVE);
    const parsed = JSON.parse(raw) as Omit<SaveData, "version"> & { version?: number };
    if (!parsed || (parsed.version !== 1 && parsed.version !== 2)) return structuredClone(DEFAULT_SAVE);
    const unlocked = Array.from(new Set([...(parsed.unlocked?.length ? parsed.unlocked : ["seltos"]), "lacetti"]));
    return {
      ...structuredClone(DEFAULT_SAVE),
      ...parsed,
      version: 2,
      upgrades: { ...DEFAULT_SAVE.upgrades, ...parsed.upgrades },
      settings: {
        ...DEFAULT_SAVE.settings,
        ...parsed.settings,
        assists: { ...DEFAULT_SAVE.settings.assists, ...parsed.settings?.assists },
        map: parsed.settings?.map === "grid" || parsed.settings?.map === "neon" || parsed.settings?.map === "block" ? parsed.settings.map : "amir",
      },
      unlocked,
      plate: parsed.plate === "90 O 909 BA" ? "01 D 666 FB" : parsed.plate || "01 D 666 FB",
    };
  } catch {
    return structuredClone(DEFAULT_SAVE);
  }
}

export function writeSave(data: SaveData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* private mode / quota — driving still works */
  }
}
