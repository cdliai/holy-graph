// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI
// Textures and visual beacon meshes for clusters.

import * as THREE from "three";

/** Radial-gradient glow, used as the sprite texture for nebula nodes. */
export function makeGlowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, "rgba(255,255,255,1.0)");
  g.addColorStop(0.15, "rgba(255,255,255,0.85)");
  g.addColorStop(0.45, "rgba(255,255,255,0.3)");
  g.addColorStop(1.0, "rgba(255,255,255,0.0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

/**
 * Small, always-visible beacon at each cluster anchor. Subtle by default —
 * makes cluster centres legible without competing with the nodes themselves.
 */
export function makeBeacon(color: string): THREE.Group {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.2, 1.5, 28),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  const core = new THREE.Mesh(
    new THREE.CircleGeometry(0.45, 20),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  core.rotation.x = -Math.PI / 2;
  group.add(ring, core);
  return group;
}
