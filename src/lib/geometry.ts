// 元件几何与导线布点。所有连接都按节点 id 引用；几何只负责显示与命中。
import type { Component, Point, Project, Wire } from './types';

export const TERMINAL_OFFSET = 48;
export const SNAP_RADIUS = 16;
export const NODE_RADIUS = 6;

export function terminalPoint(c: Component, end: 'p' | 'q'): Point {
  const d = end === 'p' ? -TERMINAL_OFFSET : TERMINAL_OFFSET;
  return { x: c.x + d, y: c.y };
}

/** 元件端当前的世界坐标：已接节点取节点位置，悬空取 loose 坐标，缺省退回端子位置。 */
export function endpointPosition(
  project: Project,
  c: Component,
  end: 'p' | 'q'
): Point {
  const nodeId = c[end];
  const node = project.nodes.find((n) => n.id === nodeId);
  if (node) return { x: node.x, y: node.y };
  const loose = c.loose?.[end];
  if (loose) return loose;
  return terminalPoint(c, end);
}

export function wirePoints(
  project: Project,
  w: Wire,
  bends: Point[]
): Point[] {
  const nodePos = (id: string | null): Point | null => {
    const n = project.nodes.find((nn) => nn.id === id);
    return n ? { x: n.x, y: n.y } : null;
  };
  const start = nodePos(w.startNode) ?? w.looseStart;
  const end = nodePos(w.endNode) ?? w.looseEnd;
  if (!start || !end) return [];
  return [start, ...bends, end];
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function nearestNode(project: Project, p: Point, radius = SNAP_RADIUS) {
  let best: { id: string; dist: number } | null = null;
  for (const n of project.nodes) {
    const d = distance(p, n);
    if (d <= radius && (!best || d < best.dist)) best = { id: n.id, dist: d };
  }
  return best;
}

/** 命中元件体（矩形包围盒）。 */
export function hitComponent(project: Project, p: Point): Component | null {
  for (const c of [...project.components].reverse()) {
    if (Math.abs(p.x - c.x) <= 34 && Math.abs(p.y - c.y) <= 30) return c;
  }
  return null;
}

/** 命中元件端的接线柄（无论是否已接节点）。 */
export function hitTerminal(
  project: Project,
  p: Point
): { id: string; end: 'p' | 'q' } | null {
  for (const c of [...project.components].reverse()) {
    for (const end of ['p', 'q'] as const) {
      const tp = endpointPosition(project, c, end);
      if (distance(p, tp) <= 9) return { id: c.id, end };
    }
  }
  return null;
}

export function hitNode(project: Project, p: Point) {
  return nearestNode(project, p, NODE_RADIUS + 4);
}

export function hitWire(
  project: Project,
  w: Wire,
  p: Point,
  tolerance = 6
): number {
  const pts = wirePoints(project, w, getBends(w));
  for (let i = 0; i < pts.length - 1; i++) {
    if (pointToSegment(p, pts[i], pts[i + 1]) <= tolerance) return i;
  }
  return -1;
}

function pointToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// 导线折点直接存在 points 中（首末为 {nodeId} 引用或 Point）。
export function getBends(w: Wire): Point[] {
  return w.points.slice(1, -1).filter((pt): pt is Point => !('nodeId' in pt));
}

export function setBends(w: Wire, bends: Point[]) {
  const head = w.points[0];
  const tail = w.points[w.points.length - 1];
  w.points = [head, ...bends, tail];
}

/** 线段相交（不含端点接触，端点接触说明共享接点，本来就导通）。 */
export function interiorIntersections(
  a: Point[],
  b: Point[]
): { point: Point; seg: [Point, Point] }[] {
  const out: { point: Point; seg: [Point, Point] }[] = [];
  for (let i = 0; i < a.length - 1; i++) {
    for (let j = 0; j < b.length - 1; j++) {
      const hit = segmentCross(a[i], a[i + 1], b[j], b[j + 1]);
      if (hit) out.push({ point: hit, seg: [b[j], b[j + 1]] });
    }
  }
  return out;
}

function segmentCross(p1: Point, p2: Point, p3: Point, p4: Point): Point | null {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-12) return null;
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  const eps = 1e-9;
  if (t > eps && t < 1 - eps && u > eps && u < 1 - eps) {
    return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
  }
  return null;
}

export function uid(prefix: string): string {
  return `${prefix}${Math.random().toString(36).slice(2, 8)}`;
}
