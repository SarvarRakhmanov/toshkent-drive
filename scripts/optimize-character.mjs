#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { weld, simplify, resample, dedup, prune, textureCompress } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const input = path.join(root, "characters", "walking.glb");
const output = path.join(root, "public", "models", "walking.glb");

// characters/walking.glb is a Mixamo export mislabeled "low-poly": 161,634
// vertices, 4096x4096 textures per material (~335MB GPU footprint). 50 of
// those in a scene crashes WebGL on software-rendered/low-VRAM setups. This
// decimates it to a real crowd-appropriate character on every re-run —
// never edits characters/ itself, only writes the public/ copy the app
// actually fetches.
await MeshoptSimplifier.ready;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const document = await io.read(input);

await document.transform(
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: 0.03, error: 0.01 }),
  resample(),
  dedup(),
  prune(),
  textureCompress({ targetFormat: "webp", resize: [512, 512] }),
);

await io.write(output, document);
console.log(`wrote ${output}`);
