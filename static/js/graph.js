// Obsidian-style knowledge graph (vis-network).

/* global vis */

import { api } from './api.js';
import { state } from './state.js';

let network = null;

const STYLES = {
  note: { bg: '#7c6cf0', border: '#9385f5', hover: '#9d8ef8', hoverBorder: '#ffffff' },
  connection: { bg: '#10b981', border: '#34d399', hover: '#34d399', hoverBorder: '#ffffff' },
  unresolved: { bg: '#3f3f4c', border: '#555566', hover: '#5a5a6e', hoverBorder: '#808096' },
};

const NODE_FONT = {
  color: '#c9c9d4',
  size: 11,
  face: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  strokeWidth: 2,
  strokeColor: '#0d0d10',
};

/**
 * Draw the graph. `onOpenNote(id)` is called when a note node is clicked.
 * The payload is cached in state.graphData and refetched after any change.
 */
export async function renderGraph(onOpenNote) {
  if (!state.graphData) {
    try {
      state.graphData = await api.graph();
    } catch (err) {
      console.error('Failed to load graph', err);
      return;
    }
  }
  const { nodes, edges } = state.graphData;

  const nodeData = new vis.DataSet(
    nodes.map((n) => {
      const style = STYLES[n.group] ?? STYLES.note;
      const isConn = n.group === 'connection';
      return {
        id: n.id,
        label: n.label,
        shape: 'dot',
        // Size scales with degree: 10px base + 2.5px per link (max 26px).
        size: isConn ? 9 : Math.min(10 + (n.link_count || 1) * 2.5, 26),
        color: {
          background: style.bg,
          border: style.border,
          highlight: { background: style.hover, border: style.hoverBorder },
          hover: { background: style.hover, border: style.hoverBorder },
        },
        font: NODE_FONT,
        borderWidth: 1.5,
        borderWidthSelected: 2.5,
        shadow: { enabled: true, color: 'rgba(0,0,0,0.4)', size: 6, x: 0, y: 2 },
      };
    }),
  );

  const edgeData = new vis.DataSet(
    edges.map((e, i) => ({
      id: `edge-${i}`,
      from: e.from,
      to: e.to,
      arrows: { to: { enabled: true, scaleFactor: 0.4 } },
      color: {
        color: e.label === 'uses' ? 'rgba(16, 185, 129, 0.35)' : 'rgba(255, 255, 255, 0.15)',
        highlight: '#7c6cf0',
        hover: '#a094f7',
      },
      width: 1.2,
      selectionWidth: 2,
      hoverWidth: 1.8,
      smooth: { enabled: true, type: 'continuous', roundness: 0.15 },
      dashes: e.label === 'uses',
    })),
  );

  const container = document.getElementById('graphContainer');
  network?.destroy();
  network = new vis.Network(
    container,
    { nodes: nodeData, edges: edgeData },
    {
      nodes: { scaling: { min: 8, max: 28 } },
      edges: { arrows: { to: { enabled: true } } },
      physics: {
        enabled: true,
        stabilization: { iterations: 150, fit: true },
        barnesHut: {
          gravitationalConstant: -2500,
          springLength: 110,
          springConstant: 0.04,
          centralGravity: 0.05,
          damping: 0.09,
        },
      },
      interaction: {
        hover: true,
        hoverConnectedEdges: true,
        selectConnectedEdges: true,
        tooltipDelay: 150,
        zoomView: true,
        dragView: true,
      },
    },
  );

  network.on('click', (params) => {
    const id = params.nodes[0];
    if (id !== undefined && !id.startsWith('conn:')) onOpenNote(id);
  });
  network.on('hoverNode', () => (container.style.cursor = 'pointer'));
  network.on('blurNode', () => (container.style.cursor = 'default'));
}
