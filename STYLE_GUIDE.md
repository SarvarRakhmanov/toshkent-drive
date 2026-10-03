# BUILDING VISUAL SPEC

Locked reference for every building generated in this game. Read this before
writing any building code. If a request conflicts with this file, flag the
conflict instead of silently picking one side.

## CORE AESTHETIC
- **Style:** [FILL IN — e.g. neon-noir arcade, cyberpunk downtown, retro-synthwave]
- **Reality tier:** stylized low-poly, NOT photoreal. Runs in a browser at 60fps,
  many buildings on screen at once via instancing. Flat-shaded base geometry +
  cheap tricks for detail (baked bump maps, tinted emissive windows, bloom on
  neon only) — not per-pixel PBR normal/roughness/metalness stacks.
- **Key characteristic:** no flat single-color box towers. Every building gets
  at least a window-grid texture + one silhouette break (setback, cornice,
  antenna, balcony ledges — pick one, don't stack all of them).

## PALETTE
[FILL IN — e.g. "desaturated concrete + one saturated neon accent color per
building" or paste a reference image]

## PER-BUILDING SPEC FORMAT
Use this exact shape for each building type request (from prior turn):

```
"<Name>": <shape: box | stepped | cylinder | L-shape>,
<height range in stories>, <footprint WxD>,
<base color / material feel: glass|concrete|brick>,
<roof feature: flat | antenna | helipad | setback | none>,
<window pattern: grid density + % lit at night>
```

## TEXTURE RULES (what's actually cheap here)
1. **No flat shading on facades.** Minimum: a repeating window-grid texture
   (canvas-generated or tiled), tinted by building color.
2. **Bump, not full normal maps.** A grayscale bump texture for window-frame
   relief / panel seams is enough — matches what the original single-file
   game already does (`facadeMats` bumpMap, `grainTex` on ground).
3. **Emissive lit windows at night**, not baked-lit facade textures — reuses
   the day/night `nightK` emissiveIntensity system already in the engine.
4. **Color variation per instance**, not per-pixel — vary hue/lightness
   slightly across instanced copies of the same building so a skyline isn't
   visibly copy-pasted.
5. **Silhouette break > surface detail.** One roof/setback feature reads at
   driving speed and distance; scratches and micro-detail don't — skip them.

## DETAIL LEVEL (only 2 layers matter at driving distance/speed)
- **Macro:** overall shape/silhouette — this is what the player actually sees.
- **Meso:** window grid + one roof feature.
- Skip **micro** (rivets, scratches, dust) — invisible at gameplay camera
  distance and speed, pure perf cost for zero payoff.

## WHAT TO AVOID
- Flat single-color box with no window texture
- Full PBR material stacks (metalness/roughness/normal maps) per building —
  too expensive at instanced scale, wrong look for this art style anyway
- Perfectly identical repeated buildings with zero color/scale variation
- Micro-detail (bolts, scratches, moss) nobody will see from a moving car
- Neon/bloom on non-signage surfaces — bloom is reserved for actual neon
  elements (signs, underglow, club lights), not applied to whole buildings

## LOCK-IN PROMPT
Start a building request with: "Per STYLE_GUIDE.md, build [Name] using the
per-building spec format." If a request omits shape/height/color/roof/window
fields, ask for them instead of inventing values.
