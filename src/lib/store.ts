import { derived, get, writable } from 'svelte/store';
import type {
  CircuitNode,
  Component,
  CurrentSource,
  Point,
  Project,
  Resistor,
  VoltageSource,
  Wire
} from './types';
import { solveCircuit } from './solver';
import { saveProject } from './db';
import { endpointPosition, uid } from './geometry';
import {
  bridgeExample,
  conflictExample,
  currentConflictExample,
  emptyExample,
  seriesSourcesExample
} from './examples';

export type Tool = 'select' | 'node' | 'ground' | 'wire' | 'resistor' | 'voltage' | 'current' | 'delete';

export interface Selection {
  kind: 'node' | 'component' | 'wire';
  id: string;
}

function createBench() {
  const project = writable<Project>(emptyExample());
  const tool = writable<Tool>('select');
  const selection = writable<Selection | null>(null);
  /** 求解开关；失败时电路不被清空，用户继续编辑会自动重新求解。 */
  const liveSolve = writable(true);
  const showValues = writable(true);
  /** 最近一次保存状态，用于标题栏提示。 */
  const savedAt = writable<number | null>(null);
  const saveError = writable<string | null>(null);
  /** 由面板点击方程行/问题时，请求画布高亮的元件。 */
  const highlightIds = writable<Set<string>>(new Set());

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const p = get(project);
      p.updatedAt = Date.now();
      try {
        await saveProject(p);
        savedAt.set(p.updatedAt);
        saveError.set(null);
      } catch (e) {
        saveError.set(`IndexedDB 保存失败：${(e as Error).message}`);
      }
    }, 500);
  };

  const mutate = (fn: (p: Project) => void, persist = true) => {
    project.update((p) => {
      fn(p);
      return p;
    });
    if (persist) scheduleSave();
  };

  // ---------------- 工程管理 ----------------
  const load = (p: Project) => {
    project.set(structuredClone(p));
    selection.set(null);
    scheduleSave();
  };
  const newProject = () => load(emptyExample());
  const examples = {
    bridge: () => load(bridgeExample()),
    series: () => load(seriesSourcesExample()),
    conflict: () => load(conflictExample()),
    currentConflict: () => load(currentConflictExample())
  };
  const rename = (name: string) => mutate((p) => void (p.name = name));

  // ---------------- 接点与地 ----------------
  const addNodeAt = (pt: Point, ground = false): string => {
    const id = uid('n');
    mutate((p) => {
      p.nodes.push({ id, x: pt.x, y: pt.y, ground });
    });
    return id;
  };

  const toggleGround = (nodeId: string) =>
    mutate((p) => {
      const target = p.nodes.find((n) => n.id === nodeId);
      if (!target) return;
      if (target.ground) {
        target.ground = false;
      } else {
        // 全电路至多一个参考地：明确地由用户设置，而不是隐式推断。
        p.nodes.forEach((n) => void (n.ground = false));
        target.ground = true;
      }
    });

  const moveNode = (id: string, pt: Point, persist = true) =>
    mutate((p) => {
      const n = p.nodes.find((nn) => nn.id === id);
      if (n) {
        n.x = pt.x;
        n.y = pt.y;
      }
    }, persist);

  const deleteNode = (id: string) =>
    mutate((p) => {
      const gone = p.nodes.find((n) => n.id === id);
      p.nodes = p.nodes.filter((n) => n.id !== id);
      // 删除接点后，引用它的元件端变为悬空，坐标保留在被删接点处，方便继续接线。
      for (const c of p.components) {
        for (const end of ['p', 'q'] as const) {
          if (c[end] === id) {
            c.loose = {
              ...(c.loose ?? { p: null, q: null }),
              [end]: gone ? { x: gone.x, y: gone.y } : { x: c.x, y: c.y }
            };
            c[end] = `__loose_${c.id}_${end}`;
          }
        }
      }
      p.wires = p.wires.filter((w) => w.startNode !== id && w.endNode !== id);
    });

  // ---------------- 元件 ----------------
  const createComponent = (type: Component['type'], pt: Point): string => {
    const id = uid(type === 'resistor' ? 'R' : type === 'voltage' ? 'V' : 'I');
    mutate((p) => {
      // 新元件自带两个端子接点，用户可拖走/接线。
      const np: CircuitNode = { id: uid('n'), x: pt.x - 48, y: pt.y };
      const nq: CircuitNode = { id: uid('n'), x: pt.x + 48, y: pt.y };
      p.nodes.push(np, nq);
      if (type === 'resistor') {
        p.components.push({ id, type, r: 100, p: np.id, q: nq.id, x: pt.x, y: pt.y } as Resistor);
      } else if (type === 'voltage') {
        p.components.push({ id, type, vs: 5, p: np.id, q: nq.id, x: pt.x, y: pt.y } as VoltageSource);
      } else {
        p.components.push({ id, type, is: 1, p: np.id, q: nq.id, x: pt.x, y: pt.y } as CurrentSource);
      }
    });
    return id;
  };

  const updateComponentValue = (id: string, field: string, value: number) =>
    mutate((p) => {
      const c = p.components.find((cc) => cc.id === id);
      if (!c) return;
      if (c.type === 'resistor' && field === 'r') c.r = value;
      if (c.type === 'voltage' && field === 'vs') c.vs = value;
      if (c.type === 'current' && field === 'is') c.is = value;
    });

  /** 翻转极性/电流方向：交换 p、q。 */
  const flipComponent = (id: string) =>
    mutate((p) => {
      const c = p.components.find((cc) => cc.id === id);
      if (!c) return;
      const tmp = c.p;
      c.p = c.q;
      c.q = tmp;
    });

  const moveComponentBody = (id: string, pt: Point, persist = true) =>
    mutate(
      (p) => {
        const c = p.components.find((cc) => cc.id === id);
        if (!c) return;
        // 只更新元件体中心；端子连接的节点不动 → 连接关系完全不变。
        c.x = pt.x;
        c.y = pt.y;
      },
      persist
    );

  /**
   * 拖动端子柄：接到接点上则重绑引用（电气连接改变是用户的明确动作）；
   * 放到空白则变成悬空端，坐标保存到 loose。
   */
  const connectTerminal = (
    componentId: string,
    end: 'p' | 'q',
    target: { nodeId: string } | { loose: Point }
  ) =>
    mutate((p) => {
      const c = p.components.find((cc) => cc.id === componentId);
      if (!c) return;
      if ('nodeId' in target) {
        c[end] = target.nodeId;
        if (c.loose) c.loose[end] = null;
      } else {
        c[end] = uid('__loose');
        c.loose = { ...(c.loose ?? { p: null, q: null }), [end]: target.loose };
      }
    });

  const dragLooseTerminal = (componentId: string, end: 'p' | 'q', pt: Point, persist = true) =>
    mutate(
      (p) => {
        const c = p.components.find((cc) => cc.id === componentId);
        if (!c) return;
        c.loose = { ...(c.loose ?? { p: null, q: null }), [end]: pt };
      },
      persist
    );

  const deleteComponent = (id: string) =>
    mutate((p) => {
      const c = p.components.find((cc) => cc.id === id);
      p.components = p.components.filter((cc) => cc.id !== id);
      if (c) {
        // 元件自带的两个端子节点若再无其它引用，一并删除。
        for (const nid of [c.p, c.q]) {
          const used =
            p.components.some((cc) => cc.p === nid || cc.q === nid) ||
            p.wires.some((w) => w.startNode === nid || w.endNode === nid);
          if (!used) p.nodes = p.nodes.filter((n) => n.id !== nid);
        }
      }
    });

  // ---------------- 导线 ----------------
  const createWire = (startNode: string, endNode: string): string => {
    const id = uid('W');
    mutate((p) => {
      const wire: Wire = {
        id,
        points: [{ nodeId: startNode }, { nodeId: endNode }],
        startNode,
        endNode,
        looseStart: null,
        looseEnd: null
      };
      p.wires.push(wire);
    });
    return id;
  };

  const setWireEndpoints = (
    wireId: string,
    start: { nodeId: string } | { loose: Point },
    end: { nodeId: string } | { loose: Point }
  ) =>
    mutate((p) => {
      const w = p.wires.find((ww) => ww.id === wireId);
      if (!w) return;
      w.startNode = 'nodeId' in start ? start.nodeId : null;
      w.endNode = 'nodeId' in end ? end.nodeId : null;
      w.looseStart = 'loose' in start ? start.loose : null;
      w.looseEnd = 'loose' in end ? end.loose : null;
      w.points = [
        'nodeId' in start ? { nodeId: start.nodeId } : (start as { loose: Point }).loose,
        ...w.points.slice(1, -1),
        'nodeId' in end ? { nodeId: end.nodeId } : (end as { loose: Point }).loose
      ];
    });

  const deleteWire = (id: string) =>
    mutate((p) => {
      p.wires = p.wires.filter((w) => w.id !== id);
    });

  const deleteSelected = () => {
    const sel = get(selection);
    if (!sel) return;
    if (sel.kind === 'node') deleteNode(sel.id);
    if (sel.kind === 'component') deleteComponent(sel.id);
    if (sel.kind === 'wire') deleteWire(sel.id);
    selection.set(null);
  };

  // ---------------- 求解（响应式） ----------------
  const result = derived([project, liveSolve], ([$project, $live]) =>
    $live ? solveCircuit($project) : null
  );

  return {
    // state
    project,
    tool,
    selection,
    liveSolve,
    showValues,
    savedAt,
    saveError,
    highlightIds,
    result,
    // actions
    load,
    newProject,
    examples,
    rename,
    addNodeAt,
    toggleGround,
    moveNode,
    deleteNode,
    createComponent,
    updateComponentValue,
    flipComponent,
    moveComponentBody,
    connectTerminal,
    dragLooseTerminal,
    deleteComponent,
    createWire,
    setWireEndpoints,
    deleteWire,
    deleteSelected,
    endpointXY: (c: Component, end: 'p' | 'q') => endpointPosition(get(project), c, end)
  };
}

export const bench = createBench();
