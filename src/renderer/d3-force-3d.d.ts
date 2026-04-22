// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI
declare module "d3-force-3d" {
  export interface SimulationNode {
    x: number;
    y: number;
    z: number;
    vx?: number;
    vy?: number;
    vz?: number;
    fx?: number | null;
    fy?: number | null;
    fz?: number | null;
  }

  export interface Force<N> {
    (alpha: number): void;
    initialize?: (nodes: N[]) => void;
  }

  export interface Simulation<N> {
    nodes(nodes: N[]): this;
    nodes(): N[];
    alpha(): number;
    alpha(value: number): this;
    alphaTarget(): number;
    alphaTarget(value: number): this;
    alphaDecay(): number;
    alphaDecay(value: number): this;
    velocityDecay(): number;
    velocityDecay(value: number): this;
    force(name: string): unknown;
    force(name: string, force: Force<N> | null): this;
    tick(iterations?: number): this;
    restart(): this;
    stop(): this;
    numDimensions(n: number): this;
    on(event: string, listener: () => void): this;
  }

  export interface LinkForce<N, L> extends Force<N> {
    links(links: L[]): this;
    links(): L[];
    id(fn: (d: N) => number | string): this;
    distance(fn: ((l: L) => number) | number): this;
    strength(fn: ((l: L) => number) | number): this;
    iterations(n: number): this;
  }

  export interface ManyBodyForce<N> extends Force<N> {
    strength(fn: ((d: N) => number) | number): this;
    theta(n: number): this;
    distanceMin(n: number): this;
    distanceMax(n: number): this;
  }

  export interface CenterForce<N> extends Force<N> {
    x(n: number): this;
    y(n: number): this;
    z(n: number): this;
    strength(n: number): this;
  }

  export interface PositionForce<N> extends Force<N> {
    strength(fn: ((d: N) => number) | number): this;
    x?(fn: ((d: N) => number) | number): this;
    y?(fn: ((d: N) => number) | number): this;
    z?(fn: ((d: N) => number) | number): this;
  }

  export function forceSimulation<N>(nodes?: N[]): Simulation<N>;
  export function forceManyBody<N>(): ManyBodyForce<N>;
  export function forceLink<N, L>(links?: L[]): LinkForce<N, L>;
  export function forceCenter<N>(x?: number, y?: number, z?: number): CenterForce<N>;
  export function forceX<N>(fn?: ((d: N) => number) | number): PositionForce<N>;
  export function forceY<N>(fn?: ((d: N) => number) | number): PositionForce<N>;
  export function forceZ<N>(fn?: ((d: N) => number) | number): PositionForce<N>;
}