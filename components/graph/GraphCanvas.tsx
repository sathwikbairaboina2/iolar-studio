'use client';
import { useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';
import type { ViewEdge, ViewNode } from '@/lib/knowledge/view';
import { COLOUR } from './colours';

cytoscape.use(fcose);


/** cytoscape owns the DOM inside the div; React only hands it data. */
export default function GraphCanvas({
  nodes,
  edges,
  onSelect,
}: {
  nodes: ViewNode[];
  edges: ViewEdge[];
  onSelect?: (n: ViewNode) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const ids = new Set(nodes.map((n) => n.id));
    const cy = cytoscape({
      container: ref.current,
      elements: [
        ...nodes.map((n) => ({ data: { id: n.id, label: n.label, kind: n.kind, degree: n.degree, node: n } })),
        ...edges
          .filter((e) => ids.has(e.source) && ids.has(e.target))
          .map((e, i) => ({ data: { id: `e${i}`, source: e.source, target: e.target, rel: e.rel } })),
      ],
      style: [
        {
          selector: 'node',
          style: {
            'background-color': (el: cytoscape.NodeSingular) => COLOUR[el.data('kind') as string] ?? '#888',
            label: 'data(label)',
            'font-size': 9,
            width: (el: cytoscape.NodeSingular) => 12 + Math.min(Number(el.data('degree')), 30),
            height: (el: cytoscape.NodeSingular) => 12 + Math.min(Number(el.data('degree')), 30),
            'text-valign': 'bottom',
            'text-margin-y': 4,
            color: '#666',
          },
        },
        { selector: 'edge', style: { width: 1, 'line-color': '#bbb', 'curve-style': 'haystack', opacity: 0.6 } },
        { selector: ':selected', style: { 'border-width': 3, 'border-color': '#c02a58' } },
      ],
      layout: { name: 'fcose', animate: false, quality: 'default' } as cytoscape.LayoutOptions,
      wheelSensitivity: 0.2,
    });
    cy.on('tap', 'node', (ev) => onSelect?.(ev.target.data('node') as ViewNode));
    return () => {
      cy.destroy();
    };
  }, [nodes, edges, onSelect]);
  return (
    <div
      ref={ref}
      data-testid="graph-canvas"
      style={{ width: '100%', height: 560, background: 'var(--ant-color-bg-container, #fff)', borderRadius: 8 }}
    />
  );
}
