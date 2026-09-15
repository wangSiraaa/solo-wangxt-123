<script lang="ts">
  import { onMount } from 'svelte';
  import Konva from 'konva';
  import { bench, type Tool } from '../lib/store';
  import type { Component, Point, Project, SolveResult, Wire } from '../lib/types';
  import {
    NODE_RADIUS,
    SNAP_RADIUS,
    endpointPosition,
    getBends,
    hitComponent,
    hitNode,
    hitTerminal,
    hitWire,
    interiorIntersections,
    nearestNode,
    wirePoints
  } from '../lib/geometry';

  let container: HTMLDivElement;
  let stage: Konva.Stage;
  let gridLayer: Konva.Layer;
  let wireLayer: Konva.Layer;
  let symbolLayer: Konva.Layer;
  let nodeLayer: Konva.Layer;
  let overlayLayer: Konva.Layer;

  const GRID = 20;
  const COLORS = {
    wire: '#1f2933',
    body: '#1f2933',
    node: '#1f2933',
    accent: '#2563eb',
    danger: '#dc2626',
    warn: '#d97706',
    ok: '#15803d',
    ghost: '#94a3b8',
    loose: '#dc2626'
  };

  // ---------------- 交互状态（非响应式，直接驱动 Konva） ----------------
  type DragBody = { kind: 'body'; id: string; dx: number; dy: number };
  type DragNode = { kind: 'node'; id: string };
  type DragHandle = {
    kind: 'handle';
    id: string;
    end: 'p' | 'q';
    startBound: string | null;
    moved: boolean;
  };
  type WireDraft = {
    fromNode: string | null;
    fromHandle: { id: string; end: 'p' | 'q' } | null;
  };
  let interaction: DragBody | DragNode | DragHandle | null = null;
  let draft: WireDraft | null = null;
  let cursorPos: Point = { x: 0, y: 0 };

  const pointer = (): Point => {
    const p = stage.getPointerPosition();
    return p ? { x: p.x, y: p.y } : { x: 0, y: 0 };
  };

  const isLooseId = (id: string | null | undefined) => !!id && id.startsWith('__loose');
  const boundNode = (c: Component, end: 'p' | 'q'): string | null =>
    isLooseId(c[end]) ? null : c[end];

  // ---------------- 绘制 ----------------
  function drawGrid(w: number, h: number) {
    gridLayer.destroyChildren();
    for (let x = GRID; x < w; x += GRID) {
      for (let y = GRID; y < h; y += GRID) {
        gridLayer.add(new Konva.Circle({ x, y, radius: 0.8, fill: '#d9dee5' }));
      }
    }
    gridLayer.add(
      new Konva.Text({
        x: 12,
        y: 8,
        text: '线交叉不导通；连接只能发生在接点（实心圆点）上',
        fontSize: 12,
        fill: '#94a3b8'
      })
    );
  }

  function crossingsFor(project: Project): Map<string, Set<string>> {
    const key = (p: Point) => `${Math.round(p.x)},${Math.round(p.y)}`;
    const map = new Map<string, Set<string>>();
    const polys = project.wires.map((w) => ({
      w,
      pts: wirePoints(project, w, getBends(w))
    }));
    for (let i = 0; i < polys.length; i++) {
      for (let j = i + 1; j < polys.length; j++) {
        const hits = interiorIntersections(polys[i].pts, polys[j].pts);
        if (hits.length) {
          // 跳弧画在序号较大的导线上，保证每处交叉只有一个“跨越”。
          for (const h of hits) {
            if (!map.has(polys[j].w.id)) map.set(polys[j].w.id, new Set());
            map.get(polys[j].w.id)!.add(key(h.point));
          }
        }
      }
    }
    return map;
  }

  function drawWires(project: Project, result: SolveResult | null, selectedId: string | null, hl: Set<string>) {
    const jumps = crossingsFor(project);
    for (const w of project.wires) {
      const pts = wirePoints(project, w, getBends(w));
      if (pts.length < 2) continue;
      const selected = selectedId === w.id;
      const emphasized = hl.has(w.id);
      const line = new Konva.Line({
        points: pts.flatMap((p) => [p.x, p.y]),
        stroke: emphasized ? COLORS.danger : selected ? COLORS.accent : COLORS.wire,
        strokeWidth: selected || emphasized ? 3.5 : 2.5,
        lineJoin: 'round',
        hitStrokeWidth: 12
      });
      line.id(w.id);
      wireLayer.add(line);

      // 跨越弧：提示两条线只是几何交叉，电气上不相连。
      for (const k of jumps.get(w.id) ?? []) {
        const [x, y] = k.split(',').map(Number);
        // 找该处的线段方向
        let ang = 0;
        for (let i = 0; i < pts.length - 1; i++) {
          if (
            x > Math.min(pts[i].x, pts[i + 1].x) - 1 &&
            x < Math.max(pts[i].x, pts[i + 1].x) + 1 &&
            y > Math.min(pts[i].y, pts[i + 1].y) - 1 &&
            y < Math.max(pts[i].y, pts[i + 1].y) + 1
          ) {
            ang = Math.atan2(pts[i + 1].y - pts[i].y, pts[i + 1].x - pts[i].x);
            break;
          }
        }
        wireLayer.add(
          new Konva.Arc({
            x,
            y,
            angle: 180,
            rotation: (ang * 180) / Math.PI + 90,
            innerRadius: 7,
            outerRadius: 9,
            fill: '#f8fafc',
            stroke: COLORS.wire,
            strokeWidth: 1.5
          })
        );
      }
    }

    // 导线电流方向箭头（求解成功时）。
    if (result?.ok) {
      for (const w of project.wires) {
        const pts = wirePoints(project, w, getBends(w));
        if (pts.length < 2) continue;
        const va = result.nodeVoltages[w.startNode ?? ''];
        const vb = result.nodeVoltages[w.endNode ?? ''];
        // 导线本身无电流；取中点附近的分量留给元件层展示，这里不画。
        void va;
        void vb;
      }
    }
  }

  function zigzag(x0: number, x1: number, amp = 9, teeth = 6): number[] {
    const out: number[] = [x0, 0];
    const step = (x1 - x0) / (teeth + 1);
    for (let i = 1; i <= teeth; i++) out.push(x0 + step * i, i % 2 ? -amp : amp);
    out.push(x1, 0);
    return out;
  }

  function drawComponents(
    project: Project,
    result: SolveResult | null,
    selectedId: string | null,
    hl: Set<string>,
    showVals: boolean
  ) {
    for (const c of project.components) {
      const grp = new Konva.Group({ x: c.x, y: c.y });
      const selected = selectedId === c.id;
      const emphasized = hl.has(c.id);
      const pPos = endpointPosition(project, c, 'p');
      const qPos = endpointPosition(project, c, 'q');
      const px = pPos.x - c.x;
      const py = pPos.y - c.y;
      const qx = qPos.x - c.x;
      const qy = qPos.y - c.y;

      // 选中/高亮框
      if (selected || emphasized) {
        grp.add(
          new Konva.Rect({
            x: -58,
            y: -34,
            width: 116,
            height: 68,
            cornerRadius: 8,
            stroke: emphasized ? COLORS.danger : COLORS.accent,
            strokeWidth: 1.5,
            dash: [6, 4],
            listening: false
          })
        );
      }

      // 引脚线
      grp.add(new Konva.Line({ points: [px, py, -24, 0], stroke: COLORS.body, strokeWidth: 2.5, listening: false }));
      grp.add(new Konva.Line({ points: [qx, qy, 24, 0], stroke: COLORS.body, strokeWidth: 2.5, listening: false }));

      const valueText =
        c.type === 'resistor'
          ? `${c.r} Ω`
          : c.type === 'voltage'
            ? `${c.vs} V`
            : `${c.is} A`;

      if (c.type === 'resistor') {
        grp.add(
          new Konva.Line({ points: zigzag(-24, 24), stroke: COLORS.body, strokeWidth: 2.5, lineJoin: 'round', listening: false })
        );
      } else {
        grp.add(
          new Konva.Circle({
            x: 0,
            y: 0,
            radius: 24,
            stroke: COLORS.body,
            strokeWidth: 2.5,
            fill: '#ffffff',
            listening: false
          })
        );
        if (c.type === 'voltage') {
          // p 在左：左 + 右 −
          grp.add(new Konva.Text({ x: -16, y: -12, text: '+', fontSize: 18, fontStyle: 'bold', fill: COLORS.body, listening: false }));
          grp.add(new Konva.Text({ x: 6, y: -13, text: '−', fontSize: 20, fontStyle: 'bold', fill: COLORS.body, listening: false }));
        } else {
          // 电流源：箭头由 p(左) 指向 q(右)
          grp.add(
            new Konva.Arrow({
              points: [-13, 0, 13, 0],
              pointerLength: 8,
              pointerWidth: 8,
              fill: COLORS.body,
              stroke: COLORS.body,
              strokeWidth: 2,
              listening: false
            })
          );
        }
      }

      grp.add(
        new Konva.Text({
          x: -40,
          y: -32,
          text: `${c.id}  ${valueText}`,
          fontSize: 12,
          fontStyle: 'bold',
          fill: '#334155',
          listening: false
        })
      );

      // 求解结果：电流小箭头 + v/i 标注
      const cr = result?.components.find((r) => r.id === c.id);
      if (showVals && cr && Number.isFinite(cr.i)) {
        const dir = cr.i >= 0 ? 1 : -1; // 正方向 p→q
        const mag = Math.min(10, 4 + Math.log10(1 + Math.abs(cr.i)) * 3);
        if (c.type === 'resistor') {
          grp.add(
            new Konva.Arrow({
              points: [dir * -14, 16, dir * 14, 16],
              pointerLength: 6,
              pointerWidth: 6,
              fill: COLORS.accent,
              stroke: COLORS.accent,
              strokeWidth: 1.5,
              listening: false
            })
          );
        }
        grp.add(
          new Konva.Text({
            x: -46,
            y: 24,
            width: 92,
            align: 'center',
            text: `v=${cr.v.toPrecision(3)}V  i=${cr.i.toPrecision(3)}A`,
            fontSize: 11,
            fill: COLORS.accent,
            listening: false
          })
        );
      }

      // 端子柄：始终可见，接线/拖拽入口；悬空端红色方块。
      for (const end of ['p', 'q'] as const) {
        const pos = end === 'p' ? { x: px, y: py } : { x: qx, y: qy };
        const loose = isLooseId(c[end]);
        grp.add(
          loose
            ? new Konva.Rect({
                x: pos.x - 5,
                y: pos.y - 5,
                width: 10,
                height: 10,
                fill: '#fff',
                stroke: COLORS.loose,
                strokeWidth: 2,
                name: `handle:${c.id}:${end}`
              })
            : new Konva.Circle({
                x: pos.x,
                y: pos.y,
                radius: 5,
                fill: '#fff',
                stroke: COLORS.body,
                strokeWidth: 2,
                name: `handle:${c.id}:${end}`
              })
        );
      }

      grp.id(c.id);
      symbolLayer.add(grp);
    }
  }

  function drawNodes(project: Project, result: SolveResult | null, selectedId: string | null, hl: Set<string>, showVals: boolean) {
    for (const n of project.nodes) {
      const grp = new Konva.Group({ x: n.x, y: n.y });
      grp.id(`node:${n.id}`);
      if (n.ground) {
        grp.add(new Konva.Line({ points: [-12, 0, 12, 0], stroke: COLORS.body, strokeWidth: 2.5 }));
        grp.add(new Konva.Line({ points: [-8, 6, 8, 6], stroke: COLORS.body, strokeWidth: 2.5 }));
        grp.add(new Konva.Line({ points: [-4, 12, 4, 12], stroke: COLORS.body, strokeWidth: 2.5 }));
        grp.add(
          new Konva.Text({ x: -14, y: 16, text: 'GND', fontSize: 10, fill: '#475569', listening: false })
        );
      } else {
        grp.add(
          new Konva.Circle({
            radius: NODE_RADIUS,
            fill: selectedId === n.id ? COLORS.accent : COLORS.node,
            stroke: hl.has(n.id) ? COLORS.danger : '#fff',
            strokeWidth: hl.has(n.id) ? 3 : 1.5
          })
        );
        grp.add(
          new Konva.Text({
            x: 9,
            y: -18,
            text: n.id.replace(/^n/, 'n'),
            fontSize: 11,
            fill: '#64748b',
            listening: false
          })
        );
      }
      if (showVals && result?.ok) {
        const v = result.nodeVoltages[n.id];
        grp.add(
          new Konva.Text({
            x: 10,
            y: 6,
            text: `${v.toPrecision(4)} V`,
            fontSize: 11,
            fontStyle: 'bold',
            fill: COLORS.ok,
            listening: false
          })
        );
      }
      nodeLayer.add(grp);
    }
  }

  function draftStart(): Point | null {
    const d = draft;
    if (!d) return null;
    if (d.fromNode) {
      const n = curProject.nodes.find((nn) => nn.id === d.fromNode);
      return n ? { x: n.x, y: n.y } : null;
    }
    if (d.fromHandle) {
      const c = curProject.components.find((cc) => cc.id === d.fromHandle!.id);
      return c ? endpointPosition(curProject, c, d.fromHandle.end) : null;
    }
    return null;
  }

  function drawOverlay() {
    // 接线预览（橡皮筋折线）与接点吸附高亮。
    if (!draft) return;
    const start = draftStart();
    const snap = nearestNode(curProject, cursorPos, SNAP_RADIUS);
    const end = snap
      ? (curProject.nodes.find((n) => n.id === snap.id) as { x: number; y: number })
      : cursorPos;
    if (start) {
      overlayLayer.add(
        new Konva.Line({
          points: [start.x, start.y, end.x, end.y],
          stroke: COLORS.accent,
          strokeWidth: 2,
          dash: [5, 4],
          listening: false
        })
      );
    }
    overlayLayer.add(
      new Konva.Ring({
        x: end.x,
        y: end.y,
        innerRadius: 8,
        outerRadius: 13,
        stroke: snap ? COLORS.ok : COLORS.accent,
        strokeWidth: 2,
        listening: false
      })
    );

    // 拖拽中的端子幽灵
    if (interaction?.kind === 'handle') {
      overlayLayer.add(
        new Konva.Circle({ x: cursorPos.x, y: cursorPos.y, radius: 6, fill: COLORS.accent, listening: false })
      );
    }
  }

  // ---------------- 渲染调度 ----------------
  let raf = 0;
  const render = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      wireLayer.destroyChildren();
      symbolLayer.destroyChildren();
      nodeLayer.destroyChildren();
      overlayLayer.destroyChildren();
      const sel = curSel;
      drawWires(curProject, curResult, sel?.kind === 'wire' ? sel.id : null, curHl);
      drawComponents(
        curProject,
        curResult,
        sel?.kind === 'component' ? sel.id : null,
        curHl,
        curShow
      );
      drawNodes(curProject, curResult, sel?.kind === 'node' ? sel.id : null, curHl, curShow);
      drawOverlay();
      [wireLayer, symbolLayer, nodeLayer, overlayLayer].forEach((l) => l.batchDraw());
    });
  };

  let curProject: Project;
  let curSel: { kind: string; id: string } | null = null;
  let curResult: SolveResult | null = null;
  let curHl = new Set<string>();
  let curShow = true;
  let curTool: Tool = 'select';

  // ---------------- 交互事件 ----------------
  function onPointerDown(e: Konva.KonvaEventObject<PointerEvent>) {
    const pos = pointer();
    cursorPos = pos;
    const t = curTool;

    if (t === 'node') {
      const hit = hitNode(curProject, pos);
      if (hit) {
        bench.selection.set({ kind: 'node', id: hit.id });
      } else {
        const id = bench.addNodeAt(pos);
        bench.selection.set({ kind: 'node', id });
      }
      return;
    }
    if (t === 'ground') {
      const hit = hitNode(curProject, pos);
      if (hit) bench.toggleGround(hit.id);
      else {
        const id = bench.addNodeAt(pos, true);
        bench.selection.set({ kind: 'node', id });
      }
      return;
    }
    if (t === 'resistor' || t === 'voltage' || t === 'current') {
      const id = bench.createComponent(t, pos);
      bench.selection.set({ kind: 'component', id });
      return;
    }
    if (t === 'delete') {
      const h = hitTerminal(curProject, pos);
      if (h) {
        bench.deleteComponent(h.id);
        return;
      }
      const hc = hitComponent(curProject, pos);
      if (hc) return bench.deleteComponent(hc.id);
      const hn = hitNode(curProject, pos);
      if (hn) return bench.deleteNode(hn.id);
      for (const w of curProject.wires) if (hitWire(curProject, w, pos) >= 0) return bench.deleteWire(w.id);
      return;
    }

    if (t === 'wire') {
      const term = hitTerminal(curProject, pos);
      if (term) {
        const c = curProject.components.find((cc) => cc.id === term.id)!;
        draft = {
          fromNode: boundNode(c, term.end),
          fromHandle: term
        };
      } else {
        const hn = hitNode(curProject, pos);
        if (hn) {
          draft = { fromNode: hn.id, fromHandle: null };
        }
      }
      return;
    }

    // select 工具：共享接点（接了 ≥2 个元件端/导线）优先整体拖动；
    // 只属于单个元件的端子节点则抓端子柄，允许重接线。
    const hn0 = hitNode(curProject, pos);
    const degree = hn0
      ? curProject.components.reduce(
          (n, c) => n + (c.p === hn0.id ? 1 : 0) + (c.q === hn0.id ? 1 : 0),
          0
        ) +
        curProject.wires.reduce(
          (n, w) => n + (w.startNode === hn0.id ? 1 : 0) + (w.endNode === hn0.id ? 1 : 0),
          0
      )
      : 0;

    const term = degree <= 1 ? hitTerminal(curProject, pos) : null;
    if (term) {
      const c = curProject.components.find((cc) => cc.id === term.id)!;
      interaction = {
        kind: 'handle',
        id: term.id,
        end: term.end,
        startBound: boundNode(c, term.end),
        moved: false
      };
      bench.selection.set({ kind: 'component', id: term.id });
      return;
    }
    const hn = hitNode(curProject, pos);
    if (hn) {
      interaction = { kind: 'node', id: hn.id };
      bench.selection.set({ kind: 'node', id: hn.id });
      return;
    }
    const hc = hitComponent(curProject, pos);
    if (hc) {
      interaction = { kind: 'body', id: hc.id, dx: pos.x - hc.x, dy: pos.y - hc.y };
      bench.selection.set({ kind: 'component', id: hc.id });
      return;
    }
    for (const w of curProject.wires) {
      if (hitWire(curProject, w, pos) >= 0) {
        bench.selection.set({ kind: 'wire', id: w.id });
        return;
      }
    }
    bench.selection.set(null);
  }

  function onPointerMove() {
    const pos = pointer();
    cursorPos = pos;

    if (draft) {
      render();
      return;
    }
    if (!interaction) return;

    if (interaction.kind === 'node') {
      bench.moveNode(interaction.id, pos, false);
    } else if (interaction.kind === 'body') {
      bench.moveComponentBody(interaction.id, { x: pos.x - interaction.dx, y: pos.y - interaction.dy }, false);
    } else if (interaction.kind === 'handle') {
      interaction.moved = true;
      // 已绑定的端子在拖起前保持原位；原本悬空的端子跟随。
      if (!interaction.startBound) bench.dragLooseTerminal(interaction.id, interaction.end, pos, false);
    }
    render();
  }

  function onPointerUp() {
    const pos = cursorPos;

    if (draft) {
      // 找到终点接点：优先吸附；否则若落在元件端子上，落在其已绑接点。
      let toNode: string | null = nearestNode(curProject, pos, SNAP_RADIUS)?.id ?? null;
      if (!toNode) {
        const endTerm = hitTerminal(curProject, pos);
        if (endTerm) {
          const tc = curProject.components.find((cc) => cc.id === endTerm.id)!;
          toNode = boundNode(tc, endTerm.end);
        }
      }

      // 起点端子悬空时，在其端子位置就地建一个接点并重绑。
      const d = draft;
      let fromNode = d.fromNode;
      if (!fromNode && d.fromHandle) {
        const c = curProject.components.find((cc) => cc.id === d.fromHandle!.id)!;
        const nid = bench.addNodeAt(endpointPosition(curProject, c, d.fromHandle.end));
        bench.connectTerminal(c.id, d.fromHandle.end, { nodeId: nid });
        fromNode = nid;
      }

      if (fromNode && toNode && fromNode !== toNode) {
        bench.createWire(fromNode, toNode);
      }
      draft = null;
      render();
      return;
    }

    if (interaction?.kind === 'handle') {
      const drag = interaction;
      const c = curProject.components.find((cc) => cc.id === drag.id)!;
      const snap = nearestNode(curProject, pos, SNAP_RADIUS);
      if (drag.moved) {
        if (snap) {
          // 明确拖到某接点上：重绑端子，删除因此孤立的旧端子节点。
          const oldBound = drag.startBound;
          bench.connectTerminal(c.id, drag.end, { nodeId: snap.id });
          if (oldBound && oldBound !== snap.id) removeOrphanNode(oldBound);
        } else if (drag.startBound) {
          // 从接点上拖走且未落在新接点 → 变成悬空端。
          const old = drag.startBound;
          bench.connectTerminal(c.id, drag.end, { loose: pos });
          removeOrphanNode(old);
        } else {
          bench.dragLooseTerminal(c.id, drag.end, pos);
        }
      }
    }
    interaction = null;
    // 触发一次持久化（拖动期间 persist=false）。
    bench.project.update((p) => {
      p.updatedAt = Date.now();
      return p;
    });
    render();
  }

  function removeOrphanNode(nodeId: string) {
    const p = curProject;
    const used =
      p.components.some((c) => c.p === nodeId || c.q === nodeId) ||
      p.wires.some((w) => w.startNode === nodeId || w.endNode === nodeId);
    if (!used) bench.deleteNode(nodeId);
  }

  function onKey(e: KeyboardEvent) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && curSel) {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      bench.deleteSelected();
    }
    if (e.key === 'Escape') {
      draft = null;
      interaction = null;
      bench.selection.set(null);
      render();
    }
  }

  function stageCursor(): string {
    switch (curTool) {
      case 'node':
      case 'ground':
      case 'resistor':
      case 'voltage':
      case 'current':
        return 'copy';
      case 'wire':
        return 'crosshair';
      case 'delete':
        return 'not-allowed';
      default:
        return 'default';
    }
  }

  onMount(() => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    stage = new Konva.Stage({ container, width: w, height: h });
    gridLayer = new Konva.Layer({ listening: false });
    wireLayer = new Konva.Layer();
    symbolLayer = new Konva.Layer();
    nodeLayer = new Konva.Layer();
    overlayLayer = new Konva.Layer({ listening: false });
    stage.add(gridLayer, wireLayer, symbolLayer, nodeLayer, overlayLayer);
    drawGrid(w, h);

    stage.on('pointerdown', onPointerDown);
    stage.on('pointermove', onPointerMove);
    stage.on('pointerup', onPointerUp);
    window.addEventListener('keydown', onKey);

    const unsubs = [
      bench.project.subscribe((v) => {
        curProject = v;
        render();
      }),
      bench.selection.subscribe((v) => {
        curSel = v;
        render();
      }),
      bench.result.subscribe((v) => {
        curResult = v;
        render();
      }),
      bench.highlightIds.subscribe((v) => {
        curHl = v;
        render();
      }),
      bench.showValues.subscribe((v) => {
        curShow = v;
        render();
      }),
      bench.tool.subscribe((v) => {
        curTool = v;
        stage.container().style.cursor = stageCursor();
        draft = null;
        interaction = null;
      })
    ];

    const onResize = () => {
      stage.width(container.clientWidth);
      stage.height(container.clientHeight);
      drawGrid(container.clientWidth, container.clientHeight);
      gridLayer.batchDraw();
      render();
    };
    window.addEventListener('resize', onResize);

    return () => {
      unsubs.forEach((u) => u());
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      stage.destroy();
    };
  });
</script>

<div class="schematic" bind:this={container}></div>

<style>
  .schematic {
    width: 100%;
    height: 100%;
    background: #f8fafc;
    overflow: hidden;
  }
  :global(.schematic canvas) {
    display: block;
  }
</style>
