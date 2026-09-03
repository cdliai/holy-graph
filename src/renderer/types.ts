// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI
// Renderer types and tunables.

import type * as THREE from "three";
import type { FileMeta, Cluster } from "../schema/v1.js";

// ── tunables ────────────────────────────────────────────────────
export const BASE_NODE_SIZE = 6;
export const SIZE_GAIN = 7; // multiplied by sqrt(activity)

export const CLUSTER_PULL_STRENGTH = 0.45;
export const ACTIVITY_Y_STRENGTH = 0.2;
export const ACTIVITY_Y_GAIN = 8;
export const LINK_DISTANCE_BASE = 10;
export const CHARGE_STRENGTH = -14;
export const ALPHA_DECAY = 0.028;
export const ALPHA_ON_REHEAT = 0.25;
export const ALPHA_SLEEP_THRESHOLD = 0.0015;

// Cluster-layout sim
export const CLUSTER_SIM_TICKS = 500;
export const CLUSTER_LAYOUT_RADIUS = 260;

export const BIRTH_DURATION_MS = 900;
export const BIRTH_RING_START_SCALE = 0.5;
export const BIRTH_RING_END_SCALE = 9.0;
export const TOUCH_RING_DURATION_MS = 550;
export const TOUCH_RING_END_SCALE = 4.5;
export const PULSE_DURATION_MS = 520;

// Electric signal pulses
export const SIGNAL_DURATION_MS = 620;
export const SIGNAL_BASE_SIZE = 7;
export const SIGNAL_MAX_EDGES_PER_TOUCH = 5;
export const SIGNAL_STAGGER_MS = 18;
export const SIGNAL_MAX_ACTIVE = 600;
export const HIGHLIGHT_BOOST = 1.7;

export const CAMERA_TILT = 1.15; // radians from horizontal

// ── node & link structures ──────────────────────────────────────
export interface SimNode {
  id: number;
  cluster: string;
  color: THREE.Color;
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  clusterTargetX: number;
  clusterTargetZ: number;
  activityLift: number;
  targetSize: number;
  renderedSize: number;
  alive: boolean;
  pulseUntil: number;
  pulseStrength: number;
}

export interface SimLink {
  source: SimNode | number;
  target: SimNode | number;
  weight: number;
}

export interface BirthRing {
  node: SimNode;
  startedAt: number;
  mesh: THREE.Mesh;
}

export interface TouchRing {
  node: SimNode;
  startedAt: number;
  mesh: THREE.Mesh;
}

/** An electric pulse travelling along an edge between two live nodes. */
export interface SignalPulse {
  src: SimNode;
  dst: SimNode;
  startsAt: number;
  color: THREE.Color;
  size: number;
}

export interface PendingSpawn {
  at: number;
  kind: "birth" | "touch";
  node: SimNode;
}

export interface PendingSignal {
  at: number;
  src: SimNode;
  dst: SimNode;
  color: THREE.Color;
  size: number;
}

/** Payload surfaced to the hover callback — file OR cluster, never both. */
export type HoverInfo =
  | { kind: "file"; file: FileMeta }
  | { kind: "cluster"; cluster: Cluster };
