'use client';
import { useEffect, useRef, useState } from 'react';
import type { ViewEdge, ViewNode } from '@/lib/knowledge/view';
import { useTheme } from '@/components/ThemeProvider';
import { colourOf } from './colours';

/**
 * The graph with depth.
 *
 * The flat view answers "what is connected to what"; this one answers "what is this shaped
 * like" — which clusters sit together, which node the whole space hangs off, where a space
 * is really two spaces joined by one edge. It is the same data and the same colours, laid
 * out by a force simulation in three dimensions and orbited with the mouse.
 *
 * Everything heavy is loaded on the client, when this view is first opened: three.js and a
 * force layout have no business in the bundle of a page that may never show a graph.
 */

type Sim = {
  graphData: (d: { nodes: Node3D[]; links: Link3D[] }) => Sim;
  width: (n: number) => Sim;
  height: (n: number) => Sim;
  backgroundColor: (c: string) => Sim;
  nodeId: (k: string) => Sim;
  nodeVal: (fn: (n: Node3D) => number) => Sim;
  nodeRelSize: (n: number) => Sim;
  d3Force: (name: string) =>
    | {
        strength?: (v: number) => { distanceMax?: (v: number) => unknown } | unknown;
        distance?: (v: number) => unknown;
        distanceMax?: (v: number) => unknown;
      }
    | undefined;
  d3VelocityDecay: (n: number) => Sim;
  nodeColor: (fn: (n: Node3D) => string) => Sim;
  nodeLabel: (fn: (n: Node3D) => string) => Sim;
  nodeThreeObject: (fn: (n: Node3D) => unknown) => Sim;
  nodeThreeObjectExtend: (v: boolean) => Sim;
  linkColor: (fn: (l: Link3D) => string) => Sim;
  linkWidth: (fn: (l: Link3D) => number) => Sim;
  linkOpacity: (n: number) => Sim;
  linkDirectionalArrowLength: (n: number) => Sim;
  linkDirectionalArrowRelPos: (n: number) => Sim;
  linkLabel: (fn: (l: Link3D) => string) => Sim;
  onNodeClick: (fn: (n: Node3D) => void) => Sim;
  onNodeHover: (fn: (n: Node3D | null) => void) => Sim;
  onBackgroundClick: (fn: () => void) => Sim;
  cooldownTicks: (n: number) => Sim;
  warmupTicks: (n: number) => Sim;
  onEngineStop: (fn: () => void) => Sim;
  zoomToFit: (ms?: number, padding?: number, filter?: (n: Node3D) => boolean) => Sim;
  cameraPosition: (pos: { x: number; y: number; z: number }, look?: { x: number; y: number; z: number }, ms?: number) => Sim;
  refresh: () => Sim;
  _destructor?: () => void;
};

type Node3D = ViewNode & { x?: number; y?: number; z?: number };
type Link3D = { source: string | Node3D; target: string | Node3D; rel: string };

/**
 * A hub should look like one without swallowing its neighbours: the value is a volume in
 * this renderer, so the square root keeps a node of forty links about twice the ball of a
 * node of ten rather than four times.
 */
const sizeOf = (n: Node3D) => 1 + Math.sqrt(n.degree ?? 0);

/** How far a node ended up from the middle of the space. */
const reachOf = (n: Node3D) => Math.hypot(n.x ?? 0, n.y ?? 0, n.z ?? 0);

export default function GraphCanvas3D({
  nodes,
  edges,
  onSelect,
  height = 560,
}: {
  nodes: ViewNode[];
  edges: ViewEdge[];
  onSelect?: (n: ViewNode) => void;
  height?: number;
}) {
  const { mode } = useTheme();
  const dark = mode === 'dark';
  const holder = useRef<HTMLDivElement>(null);
  const sim = useRef<Sim | null>(null);
  /** How far out the bulk of the graph sits, so one stray node cannot decide the framing. */
  const core = useRef(Number.POSITIVE_INFINITY);
  /** Only the nodes that hold a space together are named; the rest would be fog. */
  const labelFloor = useRef(3);
  /** The very objects the simulation moves, so the camera can be framed on where they ended up. */
  const placed = useRef<Node3D[]>([]);
  const inCore = (n: Node3D) => reachOf(n) <= core.current;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [hover, setHover] = useState<ViewNode | null>(null);

  // The scene is built once and fed new data as it changes, because rebuilding it would
  // throw away the camera and start the layout again on every search.
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const [{ default: ForceGraph3D }, { default: SpriteText }] = await Promise.all([
          import('3d-force-graph'),
          import('three-spritetext'),
        ]);
        if (dead || !holder.current) return;

        // The library exports a class: called without `new` it builds an instance that
        // never attaches itself, which looks exactly like a blank canvas.
        const Scene3D = ForceGraph3D as unknown as new (el: HTMLElement) => Sim;
        const g = new Scene3D(holder.current)
          .backgroundColor(dark ? '#0b1017' : '#f7f9fc')
          .nodeId('id')
          .nodeVal(sizeOf)
          .nodeRelSize(2)
          .nodeColor((n) => colourOf(n.kind))
          .nodeLabel((n) => `${n.label} · ${n.kind} · ${n.degree} link${n.degree === 1 ? '' : 's'}`)
          .nodeThreeObjectExtend(true)
          .nodeThreeObject((n) => {
            if ((n.degree ?? 0) < labelFloor.current) return null;
            const text = new SpriteText(n.label.length > 28 ? `${n.label.slice(0, 27)}…` : n.label);
            text.color = dark ? '#e8eef7' : '#1b2431';
            text.textHeight = 8;
            // The sprite is a three.js Object3D; its own typings stop at the text options.
            (text as unknown as { position: { set: (x: number, y: number, z: number) => void } }).position.set(
              0,
              sizeOf(n) + 3,
              0
            );
            return text;
          })
          .linkColor(() => (dark ? '#3a4657' : '#c7d0dd'))
          .linkWidth(() => 0.6)
          .linkOpacity(0.28)
          .linkDirectionalArrowLength(3)
          .linkDirectionalArrowRelPos(1)
          .linkLabel((l) => l.rel)
          .onNodeHover((n) => setHover(n))
          .onNodeClick((n) => {
            // Fly to the node and look at it, then hand it to the panel beside the canvas.
            const distance = 90;
            // A node still at the origin would divide by zero on the first click.
            const reach = Math.hypot(n.x ?? 0, n.y ?? 0, n.z ?? 0) || 1;
            const ratio = 1 + distance / reach;
            g.cameraPosition(
              { x: (n.x ?? 0) * ratio, y: (n.y ?? 0) * ratio, z: (n.z ?? 0) * ratio },
              { x: n.x ?? 0, y: n.y ?? 0, z: n.z ?? 0 },
              900
            );
            onSelect?.(n);
          })
          .onBackgroundClick(() => setHover(null))
          // The warm-up runs before the first frame is drawn, so the shape is already
          // there when the canvas appears — and stays there in a background tab, where the
          // browser stops handing out animation frames at all.
          .warmupTicks(60)
          .cooldownTicks(60)
          .d3VelocityDecay(0.25)
          // Framing on everything means framing on the one stray node a space always has,
          // and the rest becomes dust. The camera is set by where nine nodes in ten ended up.
          .onEngineStop(() => {
            measureCore();
            g.zoomToFit(700, 30, inCore);
          });

        // The default forces pack four hundred nodes into a ball. Pushing them apart and
        // giving the links room is what turns the ball back into a shape worth reading.
        // Repulsion is capped at a radius. Without that cap the dozens of little islands a
        // space always has push each other to the far corners of the universe, and the
        // whole graph becomes dust around one legible cluster.
        const charge = g.d3Force('charge');
        charge?.strength?.(-60);
        charge?.distanceMax?.(180);
        g.d3Force('link')?.distance?.(28);

        sim.current = g;
        setReady(true);
      } catch (err) {
        setFailed(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      dead = true;
      sim.current?._destructor?.();
      sim.current = null;
    };
    // The scene outlives the data: `onSelect` is read through the closure it was built with.
    // The theme is in the dependencies because the palette is baked into the sprites.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark]);

  // Data, and only data, flows in on every change.
  useEffect(() => {
    if (!ready || !sim.current) return;
    // Twenty-five names is a legible sky; four hundred is a fog. The floor moves with the graph.
    const degrees = nodes.map((n) => n.degree ?? 0).sort((a, b) => b - a);
    labelFloor.current = Math.max(2, degrees[Math.min(24, degrees.length - 1)] ?? 2);
    const ids = new Set(nodes.map((n) => n.id));
    placed.current = nodes.map((n) => ({ ...n }));
    sim.current.graphData({
      nodes: placed.current,
      links: edges
        .filter((e) => ids.has(e.source) && ids.has(e.target))
        .map((e) => ({ source: e.source, target: e.target, rel: e.rel })),
    });

    // The warm-up has already placed everything, so the space can be framed now rather
    // than waiting for an engine stop that a background tab never reaches.
    const framed = setTimeout(() => {
      measureCore();
      sim.current?.zoomToFit(600, 30, inCore);
    }, 350);
    return () => clearTimeout(framed);
  }, [nodes, edges, ready]);

  // Where the bulk of the graph ended up, measured once it has stopped moving.
  const measureCore = () => {
    const reach = placed.current.map(reachOf).sort((a, b) => a - b);
    core.current = reach.length ? (reach[Math.floor(reach.length * 0.8)] ?? reach.at(-1) ?? Infinity) : Infinity;
  };

  // The canvas fills its column, whatever the window does.
  useEffect(() => {
    if (!ready || !sim.current || !holder.current) return;
    const el = holder.current;
    const fit = () => sim.current?.width(el.clientWidth).height(height);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready, height]);

  if (failed) {
    return (
      <div style={{ height, display: 'grid', placeItems: 'center', color: '#7b8798', fontSize: 13 }}>
        the three-dimensional view could not start: {failed}
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }} data-testid="graph-3d">
      <div ref={holder} style={{ height, borderRadius: 8, overflow: 'hidden' }} />
      <button
        type="button"
        onClick={() => {
          measureCore();
          sim.current?.zoomToFit(600, 40, inCore);
        }}
        style={{
          position: 'absolute',
          right: 12,
          top: 12,
          padding: '4px 12px',
          fontSize: 12,
          borderRadius: 6,
          cursor: 'pointer',
          border: '1px solid rgba(255,255,255,.18)',
          background: 'rgba(16,24,32,.72)',
          color: '#e8eef7',
        }}
        data-testid="graph-3d-fit"
      >
        Fit
      </button>
      <div
        style={{
          position: 'absolute',
          left: 12,
          bottom: 12,
          padding: '6px 10px',
          borderRadius: 6,
          fontSize: 12,
          pointerEvents: 'none',
          background: 'rgba(16,24,32,.72)',
          color: '#e8eef7',
        }}
      >
        {hover ? `${hover.label} · ${hover.kind}` : 'drag to orbit · scroll to zoom · click a node to fly to it'}
      </div>
    </div>
  );
}
