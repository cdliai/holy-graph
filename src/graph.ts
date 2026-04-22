// Semantic 3D renderer.
//
//   - Clusters are laid out by a second d3-force sim seeded with
//     cluster-cluster co-change affinity, so related modules sit next to
//     each other on the XZ plane.
//   - Nodes render as additive-blended glow points (nebula, not spheres).
//     Y position comes from current activity — hot files float up.
//   - Each cluster has a subtle beacon at its anchor. Hover info is
//     surfaced through an HTML tooltip in main.ts; this file draws only
//     the 3D scene.
//   - The per-node sim cools via alphaDecay, so a paused view is static.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCenter,
  forceX,
  forceY,
  forceZ,
} from "d3-force-3d";
import type { Dataset, FileMeta, Cluster } from "./types";
import type { Replay, CommitEvent } from "./state";

// ── tunables ────────────────────────────────────────────────────
const BASE_NODE_SIZE = 6;
const SIZE_GAIN = 7; // multiplied by sqrt(activity)

const CLUSTER_PULL_STRENGTH = 0.45;
// Vertical axis carries *activity height*: hot files float up, cooling ones sink.
// Target Y per node = sqrt(activity) * ACTIVITY_Y_GAIN. forceY with this
// strength keeps the cluster discs mostly planar while letting live hotspots
// rise above the plane — so the commit animation reads as a wave, not a flat lattice.
const ACTIVITY_Y_STRENGTH = 0.2;
const ACTIVITY_Y_GAIN = 8;
const LINK_DISTANCE_BASE = 10;
const CHARGE_STRENGTH = -14;
const ALPHA_DECAY = 0.028;
const ALPHA_ON_REHEAT = 0.25;
const ALPHA_SLEEP_THRESHOLD = 0.0015;

// Cluster-layout sim
const CLUSTER_SIM_TICKS = 500;
const CLUSTER_LAYOUT_RADIUS = 260;

const BIRTH_DURATION_MS = 900;
const BIRTH_RING_START_SCALE = 0.5;
const BIRTH_RING_END_SCALE = 9.0;
const TOUCH_RING_DURATION_MS = 550;
const TOUCH_RING_END_SCALE = 4.5;
const PULSE_DURATION_MS = 520;

// Electric signal pulses
const SIGNAL_DURATION_MS = 620;
const SIGNAL_BASE_SIZE = 7;
const SIGNAL_MAX_EDGES_PER_TOUCH = 5;     // fan-out cap per touched file
const SIGNAL_STAGGER_MS = 18;             // delay between files in the same commit
const SIGNAL_MAX_ACTIVE = 600;            // global cap so heavy commits don't drown the scene
const HIGHLIGHT_BOOST = 1.7;              // size multiplier when cluster is highlighted

const CAMERA_TILT = 1.15; // radians from horizontal; ~π/2 = top-down

// ── internal types ──────────────────────────────────────────────
interface SimNode {
  id: number;
  cluster: string;
  color: THREE.Color;
  x: number; y: number; z: number;
  vx?: number; vy?: number; vz?: number;
  clusterTargetX: number;
  clusterTargetZ: number;
  /** Target Y position — sqrt(activity) * ACTIVITY_Y_GAIN. */
  activityLift: number;
  targetSize: number;
  renderedSize: number;
  alive: boolean;
  pulseUntil: number;
  pulseStrength: number;
}

interface SimLink {
  source: SimNode | number;
  target: SimNode | number;
  weight: number;
}

interface BirthRing {
  node: SimNode;
  startedAt: number;
  mesh: THREE.Mesh;
}

interface TouchRing {
  node: SimNode;
  startedAt: number;
  mesh: THREE.Mesh;
}

/** An electric pulse travelling along an edge between two live nodes. */
interface SignalPulse {
  src: SimNode;
  dst: SimNode;
  startsAt: number; // performance.now() when the pulse begins traveling
  color: THREE.Color;
  size: number;
}

/** Payload surfaced to the hover callback — file OR cluster, never both. */
export type HoverInfo =
  | { kind: "file"; file: FileMeta }
  | { kind: "cluster"; cluster: Cluster };

// ── textures ────────────────────────────────────────────────────

// Radial-gradient glow, used as the sprite texture for nebula nodes.
function makeGlowTexture(): THREE.CanvasTexture {
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

// Small, always-visible beacon at each cluster anchor. Subtle by default —
// makes cluster centres legible without competing with the nodes themselves.
function makeBeacon(color: string): THREE.Group {
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

// ── utility: cluster layout via d3-force ───────────────────────
function computeClusterLayout(
  clusters: Cluster[],
  edges: [number, number, number][],
  radius: number,
): Map<string, [number, number, number]> {
  // 2.5D: clusters live mostly on XZ plane with tiny Y offset.
  interface CNode {
    id: string;
    x: number; y: number; z: number;
    vx?: number; vy?: number; vz?: number;
    size: number;
  }
  const nodes: CNode[] = clusters.map((c, i) => {
    // Seed with a ring so the sim has a reasonable starting shape.
    const angle = (i / clusters.length) * Math.PI * 2;
    return {
      id: c.id,
      x: Math.cos(angle) * radius * 0.7,
      y: 0,
      z: Math.sin(angle) * radius * 0.7,
      size: c.size,
    };
  });
  const links = edges.map(([a, b, w]) => ({
    source: nodes[a],
    target: nodes[b],
    weight: w,
  }));

  const sim = forceSimulation<CNode>(nodes)
    .numDimensions(3)
    .alpha(1)
    .alphaDecay(0.02)
    .velocityDecay(0.4)
    .force(
      "charge",
      forceManyBody<CNode>()
        // Bigger clusters repel more so they don't overlap smaller neighbours.
        .strength((d: CNode) => -Math.max(60, Math.sqrt(d.size) * 30)),
    )
    .force("center", forceCenter<CNode>(0, 0, 0).strength(0.05))
    .force("y", forceY<CNode>(() => 0).strength(0.35)) // keep mostly flat
    .force(
      "link",
      forceLink<CNode, { source: CNode; target: CNode; weight: number }>(links)
        .id((d: CNode) => d.id)
        // Distance shrinks with weight: high-affinity clusters snuggle up.
        .distance((l) => Math.max(28, 180 / Math.log2(l.weight + 4)))
        .strength((l) => Math.min(0.9, 0.2 + Math.log2(l.weight + 1) * 0.12)),
    )
    .stop();

  for (let i = 0; i < CLUSTER_SIM_TICKS; i++) sim.tick(1);

  // Fix any NaN fallouts (can happen when isolated nodes collide)
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (!Number.isFinite(n.x) || !Number.isFinite(n.z)) {
      const angle = (i / nodes.length) * Math.PI * 2;
      n.x = Math.cos(angle) * radius * 0.9;
      n.z = Math.sin(angle) * radius * 0.9;
      n.y = 0;
    }
    if (!Number.isFinite(n.y)) n.y = 0;
  }

  // Recenter so the *weighted* centroid (by cluster size) sits at the origin.
  // Unweighted centroid would pull toward the many tiny singleton clusters;
  // we want the visual mass (big clusters) to be what the camera centres on.
  let cx = 0, cz = 0, totalW = 0;
  for (const n of nodes) {
    const w = Math.max(1, n.size);
    cx += n.x * w;
    cz += n.z * w;
    totalW += w;
  }
  cx /= totalW;
  cz /= totalW;
  let maxR = 0;
  for (const n of nodes) {
    n.x -= cx;
    n.z -= cz;
    maxR = Math.max(maxR, Math.hypot(n.x, n.z));
  }
  const k = maxR > 0 ? radius / maxR : 1;

  const out = new Map<string, [number, number, number]>();
  for (const n of nodes) {
    out.set(n.id, [n.x * k, 0, n.z * k]);
  }
  return out;
}

// ── easing ──────────────────────────────────────────────────────
function easeOutCubic(t: number): number {
  const k = 1 - t;
  return 1 - k * k * k;
}
function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

// ── main class ──────────────────────────────────────────────────
export class Graph {
  private readonly canvas: HTMLCanvasElement;
  private readonly data: Dataset;
  private readonly replay: Replay;

  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;

  private readonly sim = forceSimulation<SimNode>([]).numDimensions(3);
  private readonly nodeById = new Map<number, SimNode>();

  // Nebula-style node rendering
  private readonly glowTex: THREE.CanvasTexture;
  private pointsGeom = new THREE.BufferGeometry();
  private pointsPositions = new Float32Array(0);
  private pointsColors = new Float32Array(0);
  private pointsSizes = new Float32Array(0);
  private pointsNodes: SimNode[] = [];
  private pointsObj!: THREE.Points;

  // edges
  // Edges are split into two meshes: "inner" (same-cluster, muted) and
  // "bridge" (cross-cluster, brighter). Bridges are the architectural story —
  // showing them louder surfaces real coupling between modules.
  private innerEdgeGeom = new THREE.BufferGeometry();
  private innerEdgePositions = new Float32Array(0);
  private innerEdgeLines!: THREE.LineSegments;

  private bridgeEdgeGeom = new THREE.BufferGeometry();
  private bridgeEdgePositions = new Float32Array(0);
  private bridgeEdgeLines!: THREE.LineSegments;

  // Separate link arrays for position updates in the render loop.
  private innerLinks: SimLink[] = [];
  private bridgeLinks: SimLink[] = [];

  private readonly births: BirthRing[] = [];
  private readonly touches: TouchRing[] = [];

  // Electric signals
  private signals: SignalPulse[] = [];
  private signalGeom = new THREE.BufferGeometry();
  private signalPositions = new Float32Array(0);
  private signalColors = new Float32Array(0);
  private signalSizes = new Float32Array(0);
  private signalObj!: THREE.Points;

  // Per-node adjacency (rebuilt with each frame's link set) so a touched file
  // can find its live neighbours in O(1) to emit signals.
  private readonly adjacency = new Map<number, SimLink[]>();

  // Queued visual events (stagger bulk commits so 30 files appear as a flow).
  private pendingSpawns: Array<{
    at: number; // perf.now() when to fire
    kind: "birth" | "touch";
    node: SimNode;
  }> = [];
  private pendingSignals: Array<{
    at: number;
    src: SimNode;
    dst: SimNode;
    color: THREE.Color;
    size: number;
  }> = [];

  // cluster anchors/meta
  private readonly clusterAnchor = new Map<string, [number, number, number]>();
  private readonly clusterMeta = new Map<string, Cluster>();
  private readonly clusterBeaconByCluster = new Map<string, THREE.Group>();

  // Interaction: when non-null, nodes not in this cluster dim down.
  private highlightedCluster: string | null = null;

  // Camera focus tween state
  private cameraTween: {
    from: THREE.Vector3;
    to: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    startedAt: number;
    duration: number;
  } | null = null;

  // hover
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private onHoverCb: (info: HoverInfo | null, x: number, y: number) => void = () => {};

  constructor(canvas: HTMLCanvasElement, data: Dataset, replay: Replay) {
    this.canvas = canvas;
    this.data = data;
    this.replay = replay;

    for (const c of data.clusters) this.clusterMeta.set(c.id, c);

    // ── compute organic cluster layout from affinity ──
    const layout = computeClusterLayout(data.clusters, data.clusterEdges, CLUSTER_LAYOUT_RADIUS);
    for (const c of data.clusters) {
      this.clusterAnchor.set(c.id, layout.get(c.id) ?? [c.position[0], 0, c.position[1]]);
    }

    // ── renderer ─────────────────────────────────
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.scene.background = new THREE.Color("#05070d");
    this.scene.fog = new THREE.FogExp2(0x05070d, 0.0014);

    // ── camera ───────────────────────────────────
    const camDist = Math.max(320, CLUSTER_LAYOUT_RADIUS * 2.1);
    this.camera = new THREE.PerspectiveCamera(
      46,
      window.innerWidth / window.innerHeight,
      0.1,
      6000,
    );
    this.camera.position.set(
      0,
      camDist * Math.sin(CAMERA_TILT) * 0.9,
      camDist * Math.cos(CAMERA_TILT),
    );
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.7;
    this.controls.zoomSpeed = 0.9;
    this.controls.minDistance = 40;
    this.controls.maxDistance = 2000;
    this.controls.target.set(0, 0, 0);

    // ── lights (for the rare opaque element, e.g. beacons) ──
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.85));

    // ── beacons at each cluster anchor ──
    for (const c of data.clusters) {
      const anchor = this.clusterAnchor.get(c.id)!;
      const beacon = makeBeacon(c.color);
      beacon.position.set(anchor[0], 0.1, anchor[2]);
      // Scale the beacon slightly with cluster size so big modules read louder.
      const s = 0.9 + Math.min(2.4, Math.sqrt(c.size) * 0.12);
      beacon.scale.setScalar(s);
      beacon.userData.cluster = c.id;
      this.scene.add(beacon);
      this.clusterBeaconByCluster.set(c.id, beacon);
    }

    // ── nebula points ────────────────────────────
    this.glowTex = makeGlowTexture();
    const pointMat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: this.glowTex },
      },
      vertexShader: `
        attribute float aSize;
        attribute vec3 aColor;
        varying vec3 vColor;
        void main() {
          vColor = aColor;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          // Scale with inverse distance so points are perspective-correct.
          gl_PointSize = aSize * (420.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        varying vec3 vColor;
        void main() {
          vec4 t = texture2D(uMap, gl_PointCoord);
          // Slight inner boost so dense nodes feel like hot cores.
          float a = t.a;
          vec3 c = vColor * (0.85 + 0.7 * a);
          gl_FragColor = vec4(c, a);
          if (gl_FragColor.a < 0.01) discard;
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    // Seed with empty attributes so the renderer never sees a bare geometry.
    this.pointsGeom.setAttribute("position", new THREE.BufferAttribute(this.pointsPositions, 3));
    this.pointsGeom.setAttribute("aColor", new THREE.BufferAttribute(this.pointsColors, 3));
    this.pointsGeom.setAttribute("aSize", new THREE.BufferAttribute(this.pointsSizes, 1));
    this.pointsObj = new THREE.Points(this.pointsGeom, pointMat);
    this.pointsObj.frustumCulled = false;
    this.scene.add(this.pointsObj);

    // ── electric signal pulses (second Points buffer) ──
    // Shares the same glow texture, but rendered hotter (brighter boost) and
    // smaller so they read as "travelling sparks", not additional stars.
    const signalMat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: this.glowTex } },
      vertexShader: `
        attribute float aSize;
        attribute vec3 aColor;
        varying vec3 vColor;
        void main() {
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (520.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        varying vec3 vColor;
        void main() {
          vec4 t = texture2D(uMap, gl_PointCoord);
          // Boost colour: pulses punch harder than nodes.
          vec3 c = mix(vColor, vec3(1.0), 0.35) * (0.9 + 0.9 * t.a);
          gl_FragColor = vec4(c, t.a);
          if (gl_FragColor.a < 0.01) discard;
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.signalGeom.setAttribute("position", new THREE.BufferAttribute(this.signalPositions, 3));
    this.signalGeom.setAttribute("aColor", new THREE.BufferAttribute(this.signalColors, 3));
    this.signalGeom.setAttribute("aSize", new THREE.BufferAttribute(this.signalSizes, 1));
    this.signalObj = new THREE.Points(this.signalGeom, signalMat);
    this.signalObj.frustumCulled = false;
    this.scene.add(this.signalObj);

    // ── edge lines: inner (same-cluster) vs bridge (cross-cluster) ──
    const innerMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.innerEdgeLines = new THREE.LineSegments(this.innerEdgeGeom, innerMat);
    this.innerEdgeLines.frustumCulled = false;
    this.scene.add(this.innerEdgeLines);

    const bridgeMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.bridgeEdgeLines = new THREE.LineSegments(this.bridgeEdgeGeom, bridgeMat);
    this.bridgeEdgeLines.frustumCulled = false;
    this.scene.add(this.bridgeEdgeLines);

    // ── sim config ───────────────────────────────
    this.sim
      .alpha(0)
      .alphaTarget(0)
      .alphaDecay(ALPHA_DECAY)
      .velocityDecay(0.42)
      .force("charge", forceManyBody<SimNode>().strength(CHARGE_STRENGTH).theta(0.9).distanceMax(120))
      .force("center", forceCenter(0, 0, 0).strength(0.01))
      .force("x", forceX<SimNode>((d: SimNode) => d.clusterTargetX).strength(CLUSTER_PULL_STRENGTH))
      .force("y", forceY<SimNode>((d: SimNode) => d.activityLift).strength(ACTIVITY_Y_STRENGTH))
      .force("z", forceZ<SimNode>((d: SimNode) => d.clusterTargetZ).strength(CLUSTER_PULL_STRENGTH))
      .force(
        "link",
        forceLink<SimNode, SimLink>([])
          .id((d: SimNode) => d.id)
          .distance((l: SimLink) => LINK_DISTANCE_BASE / Math.sqrt(l.weight + 1))
          .strength((l: SimLink) => Math.min(0.85, 0.2 + l.weight * 0.05)),
      )
      .stop();

    window.addEventListener("resize", this.handleResize);
    canvas.addEventListener("pointermove", this.handlePointerMove);
    canvas.addEventListener("pointerleave", this.handlePointerLeave);

    // Raycaster Points threshold is world-space; we scale it with camera
    // distance each move so nodes stay easy to hover at any zoom level.
    this.raycaster.params.Points = { threshold: 3 };

    requestAnimationFrame(this.renderLoop);
  }

  onHover(cb: (info: HoverInfo | null, x: number, y: number) => void): void {
    this.onHoverCb = cb;
  }

  // ────────────────────────────────────────────────────────────
  // Commit events
  // ────────────────────────────────────────────────────────────

  applyCommitEvent(ev: CommitEvent): void {
    this.rebuildFromReplay(false, ev, performance.now());
  }

  applySeek(): void {
    this.rebuildFromReplay(true, null, performance.now());
  }

  private rebuildFromReplay(isSeek: boolean, ev: CommitEvent | null, now: number): void {
    const snap = this.replay.liveSnapshot();
    const liveIds = new Set<number>(snap.nodes.map((n) => n.id));
    const bornSet = new Set<number>(ev?.born ?? []);
    const touchedSet = new Set<number>(ev?.touched ?? []);

    for (const [id, n] of this.nodeById) {
      if (!liveIds.has(id)) {
        n.alive = false;
        n.activityLift = 0; // sink back to the cluster plane while fading out
      }
    }

    // Build live nodes in the order the event reports them so we can stagger
    // visuals by index.
    const freshBorn: SimNode[] = [];
    const freshTouched: SimNode[] = [];

    for (const nd of snap.nodes) {
      const file = this.data.files[nd.id];
      if (!file) continue;
      const cm = this.clusterMeta.get(file.cluster);
      const anchor = this.clusterAnchor.get(file.cluster) ?? [0, 0, 0];
      const actSqrt = Math.sqrt(nd.activity);
      const size = BASE_NODE_SIZE + SIZE_GAIN * actSqrt;
      const lift = actSqrt * ACTIVITY_Y_GAIN;
      let n = this.nodeById.get(nd.id);
      if (!n) {
        n = {
          id: nd.id,
          cluster: file.cluster,
          color: new THREE.Color(cm?.color ?? "#ffffff"),
          x: anchor[0] + (Math.random() - 0.5) * 4,
          y: (Math.random() - 0.5) * 1.2,
          z: anchor[2] + (Math.random() - 0.5) * 4,
          vx: 0, vy: 0, vz: 0,
          clusterTargetX: anchor[0],
          clusterTargetZ: anchor[2],
          activityLift: lift,
          targetSize: size,
          renderedSize: 0.1,
          alive: true,
          pulseUntil: 0,
          pulseStrength: 0,
        };
        this.nodeById.set(nd.id, n);
        if (!isSeek && bornSet.has(nd.id)) freshBorn.push(n);
      } else {
        n.alive = true;
        n.targetSize = size;
        n.activityLift = lift;
        if (!isSeek && touchedSet.has(nd.id)) freshTouched.push(n);
      }
    }

    // Rebuild links among live nodes only
    const liveMap = new Map<number, SimNode>();
    for (const nd of snap.nodes) {
      const n = this.nodeById.get(nd.id);
      if (n) liveMap.set(nd.id, n);
    }
    const newLinks: SimLink[] = [];
    for (const e of snap.edges) {
      const na = liveMap.get(e.a);
      const nb = liveMap.get(e.b);
      if (na && nb) newLinks.push({ source: na, target: nb, weight: e.weight });
    }

    // Rebuild per-node adjacency for fast signal lookup.
    this.adjacency.clear();
    for (const l of newLinks) {
      const s = l.source as SimNode;
      const t = l.target as SimNode;
      const a = this.adjacency.get(s.id);
      if (a) a.push(l); else this.adjacency.set(s.id, [l]);
      const b = this.adjacency.get(t.id);
      if (b) b.push(l); else this.adjacency.set(t.id, [l]);
    }

    // Queue staggered visual effects for births and touches.
    if (!isSeek) {
      for (let i = 0; i < freshBorn.length; i++) {
        this.pendingSpawns.push({
          at: now + i * SIGNAL_STAGGER_MS,
          kind: "birth",
          node: freshBorn[i],
        });
      }
      for (let i = 0; i < freshTouched.length; i++) {
        const node = freshTouched[i];
        const fireAt = now + (freshBorn.length + i) * SIGNAL_STAGGER_MS;
        this.pendingSpawns.push({ at: fireAt, kind: "touch", node });
        // Enqueue signal pulses to each top-weighted neighbour.
        const neighbours = this.adjacency.get(node.id) ?? [];
        if (neighbours.length > 0) {
          const sorted = neighbours.slice().sort((a, b) => b.weight - a.weight);
          const pick = sorted.slice(0, SIGNAL_MAX_EDGES_PER_TOUCH);
          for (let j = 0; j < pick.length; j++) {
            const l = pick[j];
            const other = (l.source as SimNode).id === node.id
              ? (l.target as SimNode)
              : (l.source as SimNode);
            this.pendingSignals.push({
              at: fireAt + j * 25,
              src: node,
              dst: other,
              color: node.color.clone(),
              size: SIGNAL_BASE_SIZE + Math.min(3, Math.sqrt(l.weight)),
            });
          }
        }
      }
    }

    // Push into simulation (including dying nodes so they fade cleanly)
    const allSim = Array.from(this.nodeById.values());
    this.sim.nodes(allSim);
    (this.sim.force("link") as ReturnType<typeof forceLink>).links(newLinks);

    const heat = isSeek ? ALPHA_ON_REHEAT : Math.max(this.sim.alpha(), 0.08);
    this.sim.alpha(heat).restart().stop();

    // Partition into inner vs bridge edges by source/target cluster.
    const inner: SimLink[] = [];
    const bridge: SimLink[] = [];
    for (const l of newLinks) {
      const s = l.source as SimNode;
      const t = l.target as SimNode;
      if (s.cluster === t.cluster) inner.push(l);
      else bridge.push(l);
    }
    this.innerLinks = inner;
    this.bridgeLinks = bridge;

    // Rebuild buffers for each group.
    const fill = (links: SimLink[]) => {
      const n = links.length;
      const positions = new Float32Array(n * 2 * 3);
      const colors = new Float32Array(n * 2 * 3);
      for (let i = 0; i < n; i++) {
        const l = links[i];
        const s = l.source as SimNode;
        const t = l.target as SimNode;
        const o = i * 6;
        colors[o + 0] = s.color.r; colors[o + 1] = s.color.g; colors[o + 2] = s.color.b;
        colors[o + 3] = t.color.r; colors[o + 4] = t.color.g; colors[o + 5] = t.color.b;
      }
      return { positions, colors };
    };

    {
      const { positions, colors } = fill(inner);
      this.innerEdgePositions = positions;
      this.innerEdgeGeom.dispose();
      this.innerEdgeGeom = new THREE.BufferGeometry();
      this.innerEdgeGeom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      this.innerEdgeGeom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      this.innerEdgeLines.geometry = this.innerEdgeGeom;
    }
    {
      const { positions, colors } = fill(bridge);
      this.bridgeEdgePositions = positions;
      this.bridgeEdgeGeom.dispose();
      this.bridgeEdgeGeom = new THREE.BufferGeometry();
      this.bridgeEdgeGeom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      this.bridgeEdgeGeom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      this.bridgeEdgeLines.geometry = this.bridgeEdgeGeom;
    }
  }

  // ────────────────────────────────────────────────────────────
  private spawnBirthRing(node: SimNode, now: number): void {
    const geom = new THREE.RingGeometry(0.9, 1.1, 40);
    const mat = new THREE.MeshBasicMaterial({
      color: node.color.clone().lerp(new THREE.Color("#ffffff"), 0.55),
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.scale.setScalar(BIRTH_RING_START_SCALE);
    this.scene.add(mesh);
    this.births.push({ node, startedAt: now, mesh });
    node.pulseUntil = now + PULSE_DURATION_MS;
    node.pulseStrength = 1.0;
  }

  private spawnTouchRing(node: SimNode, now: number): void {
    const geom = new THREE.RingGeometry(0.6, 0.8, 32);
    const mat = new THREE.MeshBasicMaterial({
      color: node.color.clone().lerp(new THREE.Color("#ffffff"), 0.6),
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.scale.setScalar(0.3);
    this.scene.add(mesh);
    this.touches.push({ node, startedAt: now, mesh });
    node.pulseUntil = now + PULSE_DURATION_MS;
    node.pulseStrength = 0.75;
  }

  private flushPending(now: number): void {
    if (this.pendingSpawns.length > 0) {
      // pendingSpawns is roughly time-sorted; shift while due.
      let i = 0;
      while (i < this.pendingSpawns.length && this.pendingSpawns[i].at <= now) i++;
      const due = this.pendingSpawns.splice(0, i);
      for (const e of due) {
        if (!e.node.alive) continue;
        if (e.kind === "birth") this.spawnBirthRing(e.node, now);
        else this.spawnTouchRing(e.node, now);
      }
    }
    if (this.pendingSignals.length > 0) {
      let i = 0;
      while (i < this.pendingSignals.length && this.pendingSignals[i].at <= now) i++;
      const due = this.pendingSignals.splice(0, i);
      for (const e of due) {
        if (this.signals.length >= SIGNAL_MAX_ACTIVE) break;
        if (!e.src.alive || !e.dst.alive) continue;
        this.signals.push({
          src: e.src,
          dst: e.dst,
          startsAt: now,
          color: e.color,
          size: e.size,
        });
      }
    }
  }

  // ────────────────────────────────────────────────────────────
  // Public interaction API
  // ────────────────────────────────────────────────────────────

  highlightCluster(clusterId: string | null): void {
    this.highlightedCluster = clusterId;
  }

  focusOnCluster(clusterId: string, durationMs = 900): void {
    const anchor = this.clusterAnchor.get(clusterId);
    if (!anchor) return;
    const toTarget = new THREE.Vector3(anchor[0], 0, anchor[2]);
    // Place the camera a fixed distance from the anchor, matching our tilt.
    const dist = 180;
    const offset = new THREE.Vector3(
      0,
      dist * Math.sin(CAMERA_TILT) * 0.9,
      dist * Math.cos(CAMERA_TILT),
    );
    const to = toTarget.clone().add(offset);
    this.cameraTween = {
      from: this.camera.position.clone(),
      to,
      fromTarget: this.controls.target.clone(),
      toTarget,
      startedAt: performance.now(),
      duration: durationMs,
    };
  }

  focusOnFile(fileId: number, durationMs = 700): void {
    const n = this.nodeById.get(fileId);
    if (!n) return;
    const toTarget = new THREE.Vector3(n.x, n.y, n.z);
    const dist = 100;
    const offset = new THREE.Vector3(
      0,
      dist * Math.sin(CAMERA_TILT) * 0.9,
      dist * Math.cos(CAMERA_TILT),
    );
    const to = toTarget.clone().add(offset);
    this.cameraTween = {
      from: this.camera.position.clone(),
      to,
      fromTarget: this.controls.target.clone(),
      toTarget,
      startedAt: performance.now(),
      duration: durationMs,
    };
    // Pulse the file so the user can see exactly where the camera lands.
    n.pulseUntil = performance.now() + PULSE_DURATION_MS * 1.4;
    n.pulseStrength = 1;
  }

  resetCamera(durationMs = 900): void {
    const dist = Math.max(320, CLUSTER_LAYOUT_RADIUS * 2.1);
    const to = new THREE.Vector3(
      0,
      dist * Math.sin(CAMERA_TILT) * 0.9,
      dist * Math.cos(CAMERA_TILT),
    );
    this.cameraTween = {
      from: this.camera.position.clone(),
      to,
      fromTarget: this.controls.target.clone(),
      toTarget: new THREE.Vector3(0, 0, 0),
      startedAt: performance.now(),
      duration: durationMs,
    };
  }

  // ────────────────────────────────────────────────────────────
  // Render loop
  // ────────────────────────────────────────────────────────────

  private renderLoop = (): void => {
    const now = performance.now();

    // Flush any staggered spawns/signals that are due.
    this.flushPending(now);

    // Advance camera tween (smooth zoom-to-cluster)
    if (this.cameraTween) {
      const ct = this.cameraTween;
      const t = Math.min(1, (now - ct.startedAt) / ct.duration);
      const e = easeOutCubic(t);
      this.camera.position.lerpVectors(ct.from, ct.to, e);
      this.controls.target.lerpVectors(ct.fromTarget, ct.toTarget, e);
      if (t >= 1) this.cameraTween = null;
    }

    if (this.sim.alpha() > ALPHA_SLEEP_THRESHOLD) this.sim.tick(1);

    // Smooth sizes, reap dead nodes
    const lerp = 0.22;
    const toDelete: number[] = [];
    for (const [id, n] of this.nodeById) {
      const tgt = n.alive ? n.targetSize : 0;
      n.renderedSize += (tgt - n.renderedSize) * lerp;
      if (!n.alive && n.renderedSize < 0.4) toDelete.push(id);
    }
    for (const id of toDelete) this.nodeById.delete(id);

    // Rebuild Points buffers if node count changed
    const visibleNodes: SimNode[] = [];
    for (const n of this.nodeById.values()) {
      if (n.renderedSize > 0.4) visibleNodes.push(n);
    }
    this.pointsNodes = visibleNodes;
    const count = visibleNodes.length;
    if (this.pointsPositions.length !== count * 3) {
      this.pointsPositions = new Float32Array(count * 3);
      this.pointsColors = new Float32Array(count * 3);
      this.pointsSizes = new Float32Array(count);
      this.pointsGeom.dispose();
      this.pointsGeom = new THREE.BufferGeometry();
      this.pointsGeom.setAttribute("position", new THREE.BufferAttribute(this.pointsPositions, 3));
      this.pointsGeom.setAttribute("aColor", new THREE.BufferAttribute(this.pointsColors, 3));
      this.pointsGeom.setAttribute("aSize", new THREE.BufferAttribute(this.pointsSizes, 1));
      this.pointsObj.geometry = this.pointsGeom;
    }
    const highlighted = this.highlightedCluster;
    for (let i = 0; i < count; i++) {
      const n = visibleNodes[i];
      this.pointsPositions[i * 3 + 0] = n.x;
      this.pointsPositions[i * 3 + 1] = n.y;
      this.pointsPositions[i * 3 + 2] = n.z;
      // Cluster highlight: off-cluster nodes dim to their quarter-intensity.
      let dim = 1;
      let boost = 1;
      if (highlighted) {
        if (n.cluster === highlighted) boost = HIGHLIGHT_BOOST;
        else dim = 0.28;
      }
      this.pointsColors[i * 3 + 0] = n.color.r * dim;
      this.pointsColors[i * 3 + 1] = n.color.g * dim;
      this.pointsColors[i * 3 + 2] = n.color.b * dim;
      let s = n.renderedSize * boost;
      if (n.pulseUntil > now) {
        const left = (n.pulseUntil - now) / PULSE_DURATION_MS;
        s *= 1 + easeOutQuad(left) * 0.9 * n.pulseStrength;
      }
      this.pointsSizes[i] = s;
    }
    if (count > 0) {
      (this.pointsGeom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.pointsGeom.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
      (this.pointsGeom.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    }

    // Birth rings
    for (let i = this.births.length - 1; i >= 0; i--) {
      const b = this.births[i];
      const t = Math.min(1, (now - b.startedAt) / BIRTH_DURATION_MS);
      const eased = easeOutCubic(t);
      const s = BIRTH_RING_START_SCALE + (BIRTH_RING_END_SCALE - BIRTH_RING_START_SCALE) * eased;
      b.mesh.scale.setScalar(s);
      b.mesh.position.set(b.node.x, b.node.y + 0.05, b.node.z);
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = 0.95 * (1 - eased);
      if (t >= 1) {
        this.scene.remove(b.mesh);
        (b.mesh.geometry as THREE.BufferGeometry).dispose();
        (b.mesh.material as THREE.Material).dispose();
        this.births.splice(i, 1);
      }
    }

    // Touch rings (softer, smaller than birth rings)
    for (let i = this.touches.length - 1; i >= 0; i--) {
      const tr = this.touches[i];
      const t = Math.min(1, (now - tr.startedAt) / TOUCH_RING_DURATION_MS);
      const eased = easeOutCubic(t);
      const s = 0.3 + (TOUCH_RING_END_SCALE - 0.3) * eased;
      tr.mesh.scale.setScalar(s);
      tr.mesh.position.set(tr.node.x, tr.node.y + 0.05, tr.node.z);
      (tr.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - eased);
      if (t >= 1) {
        this.scene.remove(tr.mesh);
        (tr.mesh.geometry as THREE.BufferGeometry).dispose();
        (tr.mesh.material as THREE.Material).dispose();
        this.touches.splice(i, 1);
      }
    }

    // Electric signal pulses travelling along edges
    {
      // Advance + cull
      const alive: SignalPulse[] = [];
      for (const sp of this.signals) {
        const t = (now - sp.startsAt) / SIGNAL_DURATION_MS;
        if (t >= 1) continue;
        if (!sp.src.alive || !sp.dst.alive) continue;
        alive.push(sp);
      }
      this.signals = alive;

      const n = this.signals.length;
      if (this.signalPositions.length !== n * 3) {
        this.signalPositions = new Float32Array(n * 3);
        this.signalColors = new Float32Array(n * 3);
        this.signalSizes = new Float32Array(n);
        this.signalGeom.dispose();
        this.signalGeom = new THREE.BufferGeometry();
        this.signalGeom.setAttribute("position", new THREE.BufferAttribute(this.signalPositions, 3));
        this.signalGeom.setAttribute("aColor", new THREE.BufferAttribute(this.signalColors, 3));
        this.signalGeom.setAttribute("aSize", new THREE.BufferAttribute(this.signalSizes, 1));
        this.signalObj.geometry = this.signalGeom;
      }
      for (let i = 0; i < n; i++) {
        const sp = this.signals[i];
        const t = (now - sp.startsAt) / SIGNAL_DURATION_MS;
        // Ease-in-out so the spark accelerates toward the target and fades at the end.
        const p = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const x = sp.src.x + (sp.dst.x - sp.src.x) * p;
        const y = sp.src.y + (sp.dst.y - sp.src.y) * p;
        const z = sp.src.z + (sp.dst.z - sp.src.z) * p;
        this.signalPositions[i * 3 + 0] = x;
        this.signalPositions[i * 3 + 1] = y + 0.4; // hover slightly so it doesn't clip its source
        this.signalPositions[i * 3 + 2] = z;
        this.signalColors[i * 3 + 0] = sp.color.r;
        this.signalColors[i * 3 + 1] = sp.color.g;
        this.signalColors[i * 3 + 2] = sp.color.b;
        // Size fades in fast, out slower — a flare profile.
        const sizeT = t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8;
        this.signalSizes[i] = sp.size * Math.max(0.0, sizeT);
      }
      if (n > 0) {
        (this.signalGeom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
        (this.signalGeom.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
        (this.signalGeom.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
      }
    }

    // Gentle beacon breathing
    const breathe = 1 + Math.sin(now * 0.002) * 0.06;
    for (const [, beacon] of this.clusterBeaconByCluster) {
      beacon.children[0].scale.setScalar(breathe);
    }

    // Edges — inner (same-cluster)
    if (this.innerLinks.length > 0) {
      const pos = this.innerEdgePositions;
      for (let i = 0; i < this.innerLinks.length; i++) {
        const l = this.innerLinks[i];
        const s = l.source as SimNode;
        const t = l.target as SimNode;
        const o = i * 6;
        pos[o + 0] = s.x; pos[o + 1] = s.y; pos[o + 2] = s.z;
        pos[o + 3] = t.x; pos[o + 4] = t.y; pos[o + 5] = t.z;
      }
      (this.innerEdgeGeom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
    // Edges — bridge (cross-cluster, architectural)
    if (this.bridgeLinks.length > 0) {
      const pos = this.bridgeEdgePositions;
      for (let i = 0; i < this.bridgeLinks.length; i++) {
        const l = this.bridgeLinks[i];
        const s = l.source as SimNode;
        const t = l.target as SimNode;
        const o = i * 6;
        pos[o + 0] = s.x; pos[o + 1] = s.y; pos[o + 2] = s.z;
        pos[o + 3] = t.x; pos[o + 4] = t.y; pos[o + 5] = t.z;
      }
      (this.bridgeEdgeGeom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.renderLoop);
  };

  // ────────────────────────────────────────────────────────────
  // Hover
  // ────────────────────────────────────────────────────────────

  private handleResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  };

  private handlePointerMove = (e: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    // Scale the Points raycaster threshold with camera distance so hovering
    // stays easy whether zoomed in or pulled way out.
    const camDist = this.camera.position.distanceTo(this.controls.target);
    this.raycaster.params.Points = { threshold: Math.max(2, camDist * 0.012) };
    this.raycaster.setFromCamera(this.pointer, this.camera);

    // First, try to hit a node (precise)
    const pointHits = this.raycaster.intersectObject(this.pointsObj, false);
    let best: { node?: SimNode; cluster?: string; dist: number } | null = null;
    for (const h of pointHits) {
      const idx = h.index;
      if (idx === undefined) continue;
      const node = this.pointsNodes[idx];
      if (!node) continue;
      if (!best || h.distance < best.dist) best = { node, dist: h.distance };
    }

    // If no node, check cluster beacons
    if (!best) {
      const beacons = Array.from(this.clusterBeaconByCluster.values());
      const beaconHits = this.raycaster.intersectObjects(beacons, true);
      for (const h of beaconHits) {
        let obj: THREE.Object3D | null = h.object;
        while (obj && !obj.userData.cluster) obj = obj.parent;
        if (!obj) continue;
        if (!best || h.distance < best.dist) best = { cluster: obj.userData.cluster as string, dist: h.distance };
      }
    }

    if (!best) {
      this.onHoverCb(null, e.clientX, e.clientY);
      return;
    }

    if (best.node) {
      const file = this.data.files[best.node.id];
      this.onHoverCb({ kind: "file", file }, e.clientX, e.clientY);
    } else if (best.cluster) {
      const cm = this.clusterMeta.get(best.cluster);
      if (cm) this.onHoverCb({ kind: "cluster", cluster: cm }, e.clientX, e.clientY);
    }
  };

  private handlePointerLeave = (): void => {
    this.onHoverCb(null, 0, 0);
  };
}
