// Shared per-frame day/night singleton, same plain-mutable-object pattern as
// worldState/vehicleState — updated every frame by SkyCycle.tsx, read by
// anything that needs the current night factor/clock without subscribing
// (City.tsx's building windows) or persistence (saveGame.ts).
export const skyState = { nightK: 0.1, hour: 9.4, phase: 0.9, jumpTo: NaN as number }; // Toshkent Drive: mid-morning start
