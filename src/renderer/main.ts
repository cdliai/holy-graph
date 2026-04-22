import { Graph, type HoverInfo } from "./graph";
import { Replay } from "./state";
import type { Dataset } from "../schema";
import { SCHEMA_VERSION } from "../schema";

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing element ${sel}`);
  return el;
};

const canvas = $<HTMLCanvasElement>("#stage");
const subtitleEl = $<HTMLDivElement>("#subtitle");
const statCommit = $<HTMLSpanElement>("#stat-commit");
const statDate = $<HTMLSpanElement>("#stat-date");
const statMessage = $<HTMLDivElement>("#stat-message");
const statAuthor = $<HTMLDivElement>("#stat-author");
const statNodes = $<HTMLSpanElement>("#stat-nodes");
const statEdges = $<HTMLSpanElement>("#stat-edges");
const statBridges = $<HTMLSpanElement>("#stat-bridges");
const statProgress = $<HTMLSpanElement>("#stat-progress");
const btnPlay = $<HTMLButtonElement>("#btn-play");
const scrubber = $<HTMLInputElement>("#scrubber");
const speedSel = $<HTMLSelectElement>("#speed");
const legendEl = $<HTMLElement>("#legend");
const hotlistEl = $<HTMLOListElement>("#hotlist");
const tooltip = $<HTMLDivElement>("#tooltip");

async function loadData(): Promise<Dataset> {
  const res = await fetch("/data.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`failed to load data.json: ${res.status}`);
  const json = await res.json();
  if (json?.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `this viewer requires schemaVersion ${SCHEMA_VERSION} (got ${json?.schemaVersion}). upgrade the renderer.`,
    );
  }
  return json as Dataset;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}

function fmtRepo(data: Dataset): string {
  const start = data.meta.firstCommit.slice(0, 10);
  const end = data.meta.lastCommit.slice(0, 10);
  return `${data.meta.totalCommits.toLocaleString()} commits · ${start} → ${end}`;
}

async function main(): Promise<void> {
  subtitleEl.textContent = "loading graph…";

  let data: Dataset;
  try {
    data = await loadData();
  } catch (err) {
    subtitleEl.textContent = `⚠ ${(err as Error).message}. Run \`pnpm extract\` first.`;
    return;
  }

  subtitleEl.textContent = fmtRepo(data);
  scrubber.max = String(data.commits.length);
  scrubber.value = "0";

  const replay = new Replay(data);
  const graph = new Graph(canvas, data, replay);

  // ── legend chips (top 16 clusters) ──────────────
  let selectedCluster: string | null = null;
  const chipByCluster = new Map<string, HTMLElement>();
  function renderLegend(): void {
    legendEl.innerHTML = "";
    for (const c of data.clusters.slice(0, 16)) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.innerHTML = `<i style="background:${c.color};color:${c.color}"></i>${escapeHtml(c.label)}<small>${c.size}</small>`;
      chip.addEventListener("mouseenter", () => graph.highlightCluster(c.id));
      chip.addEventListener("mouseleave", () => {
        if (!selectedCluster) graph.highlightCluster(null);
        else graph.highlightCluster(selectedCluster);
      });
      chip.addEventListener("click", () => {
        if (selectedCluster === c.id) {
          selectedCluster = null;
          graph.highlightCluster(null);
          graph.resetCamera();
          chip.classList.remove("active");
        } else {
          chipByCluster.get(selectedCluster ?? "")?.classList.remove("active");
          selectedCluster = c.id;
          graph.highlightCluster(c.id);
          graph.focusOnCluster(c.id);
          chip.classList.add("active");
        }
      });
      legendEl.appendChild(chip);
      chipByCluster.set(c.id, chip);
    }
  }
  renderLegend();

  // ── hover tooltip ───────────────────────────────
  graph.onHover((info: HoverInfo | null, x: number, y: number) => {
    if (!info) {
      tooltip.hidden = true;
      return;
    }
    if (info.kind === "file") {
      const file = info.file;
      const act = replay.activity.get(file.id) ?? 0;
      tooltip.innerHTML = `
        <div class="path">${escapeHtml(file.path)}</div>
        <div class="meta">${escapeHtml(file.cluster)} · ${file.totalTouches} touches · activity ${act.toFixed(1)}</div>
      `;
    } else {
      const c = info.cluster;
      tooltip.innerHTML = `
        <div class="path">${escapeHtml(c.label)}</div>
        <div class="meta">${c.size} files · module</div>
      `;
    }
    tooltip.hidden = false;
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  });

  // ── HUD updates ─────────────────────────────────
  function countBridges(): number {
    // Edges whose endpoints belong to different clusters — architectural
    // boundary crossings that live right now.
    const snap = replay.liveSnapshot();
    let bridges = 0;
    for (const e of snap.edges) {
      const ca = data.files[e.a]?.cluster;
      const cb = data.files[e.b]?.cluster;
      if (ca && cb && ca !== cb) bridges++;
    }
    return bridges;
  }

  function updateHotList(): void {
    // Top 5 live files by activity.
    const rows: Array<{ id: number; act: number }> = [];
    for (const [id, act] of replay.activity) rows.push({ id, act });
    rows.sort((a, b) => b.act - a.act);
    const top = rows.slice(0, 5);
    hotlistEl.innerHTML = "";
    for (const r of top) {
      const file = data.files[r.id];
      if (!file) continue;
      const cluster = data.clusters.find((c) => c.id === file.cluster);
      const color = cluster?.color ?? "#888";
      const li = document.createElement("li");
      li.innerHTML = `
        <span class="dot" style="background:${color};color:${color}"></span>
        <span class="path" title="${escapeHtml(file.path)}">${escapeHtml(file.path)}</span>
        <span class="score">${r.act.toFixed(1)}</span>
      `;
      li.addEventListener("mouseenter", () => graph.highlightCluster(file.cluster));
      li.addEventListener("mouseleave", () => {
        if (selectedCluster) graph.highlightCluster(selectedCluster);
        else graph.highlightCluster(null);
      });
      li.addEventListener("click", () => graph.focusOnFile(r.id));
      hotlistEl.appendChild(li);
    }
  }

  function updateCommitPanel(idx: number): void {
    // Walk backwards to last real commit (idx can be 0 before any has applied).
    const display = Math.max(0, idx - 1);
    const c = data.commits[display];
    if (!c) {
      statCommit.textContent = "—";
      statDate.textContent = "—";
      statMessage.textContent = "";
      statAuthor.textContent = "";
      return;
    }
    statCommit.textContent = c.short;
    statDate.textContent = c.date;
    statMessage.textContent = c.msg;
    statAuthor.textContent = c.author;
  }

  function updateStats(idx: number): void {
    const snap = replay.liveSnapshot();
    statNodes.textContent = snap.nodes.length.toString();
    statEdges.textContent = snap.edges.length.toString();
    statBridges.textContent = countBridges().toString();
    const pct = data.commits.length === 0 ? 0 : Math.round((idx / data.commits.length) * 100);
    statProgress.textContent = `${pct}%`;
    updateCommitPanel(idx);
    updateHotList();
  }

  // ── playback ────────────────────────────────────
  let playing = false;
  let targetIdx = 0;
  let lastTickMs = performance.now();
  // Don't recompute HUD every RAF — throttle.
  let lastHudMs = 0;
  const HUD_INTERVAL_MS = 120;

  function commitAt(idx: number): void {
    const clamped = Math.max(0, Math.min(idx, data.commits.length));
    targetIdx = clamped;
    if (clamped < replay.cursor) {
      replay.seek(clamped);
      graph.applySeek();
    } else {
      while (replay.cursor < clamped) {
        const ev = replay.step();
        if (!ev) break;
        graph.applyCommitEvent(ev);
      }
    }
    scrubber.value = String(Math.floor(clamped));
    updateStats(Math.floor(clamped));
    lastHudMs = performance.now();
  }

  commitAt(0);

  btnPlay.addEventListener("click", () => {
    playing = !playing;
    btnPlay.textContent = playing ? "⏸ Pause" : "▶ Play";
    lastTickMs = performance.now();
    if (playing && targetIdx >= data.commits.length) commitAt(0);
  });

  scrubber.addEventListener("input", () => {
    playing = false;
    btnPlay.textContent = "▶ Play";
    commitAt(Number(scrubber.value));
  });

  // Double-click anywhere on canvas resets focus.
  canvas.addEventListener("dblclick", () => {
    if (selectedCluster) {
      chipByCluster.get(selectedCluster)?.classList.remove("active");
      selectedCluster = null;
    }
    graph.highlightCluster(null);
    graph.resetCamera();
  });

  function tick(now: number): void {
    if (playing) {
      const commitsPerSec = Number(speedSel.value);
      const dt = (now - lastTickMs) / 1000;
      lastTickMs = now;
      targetIdx += commitsPerSec * dt;
      const floor = Math.floor(targetIdx);
      if (floor >= data.commits.length) {
        playing = false;
        btnPlay.textContent = "▶ Play";
        targetIdx = data.commits.length;
      }
      const MAX_STEP_PER_FRAME = 120;
      let steps = 0;
      while (replay.cursor < Math.min(data.commits.length, floor) && steps < MAX_STEP_PER_FRAME) {
        const ev = replay.step();
        if (!ev) break;
        graph.applyCommitEvent(ev);
        steps++;
      }
      scrubber.value = String(Math.floor(targetIdx));
      if (now - lastHudMs >= HUD_INTERVAL_MS) {
        updateStats(Math.floor(targetIdx));
        lastHudMs = now;
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  btnPlay.click();
}

main().catch((err) => {
  console.error(err);
  subtitleEl.textContent = `error: ${(err as Error).message}`;
});
