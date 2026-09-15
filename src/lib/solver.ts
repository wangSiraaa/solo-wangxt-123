import { matrix, lusolve } from 'mathjs';
import type {
  CircuitIssue,
  Component,
  ComponentResult,
  EqRow,
  EqTerm,
  Project,
  SolveResult,
  Wire
} from './types';

// ---------------------------------------------------------------------------
// 并查集：导线 / 0V 电压源把显式节点合并成“网络(net)”——真正的等电位点。
// 线交叉不在任何节点上，因此永远不会被合并；连接只由显式节点 id 决定。
// ---------------------------------------------------------------------------
class UnionFind {
  parent = new Map<string, string>();
  add(id: string) {
    if (!this.parent.has(id)) this.parent.set(id, id);
  }
  find(id: string): string {
    this.add(id);
    let root = id;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    let cur = id;
    while (this.parent.get(cur) !== cur) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  union(a: string, b: string) {
    this.add(a);
    this.add(b);
    this.parent.set(this.find(a), this.find(b));
  }
}

interface Prepped {
  netOfNode: Map<string, string>;
  issues: CircuitIssue[];
  validComponents: Component[];
  groundNet: string | null;
}

function nodeLabel(project: Project, id: string, labelOf?: Map<string, string>): string {
  return labelOf?.get(id) ?? id;
}

function wireEndpoints(w: Wire): { a: string | null; b: string | null } {
  // points 数组保留折点，电气端点只看首末引用。
  const first = w.points[0];
  const last = w.points[w.points.length - 1];
  return {
    a: first && 'nodeId' in first ? first.nodeId : w.startNode,
    b: last && 'nodeId' in last ? last.nodeId : w.endNode
  };
}

function prepare(project: Project, labelOf?: Map<string, string>): Prepped {
  const issues: CircuitIssue[] = [];
  const nodeIds = new Set(project.nodes.map((n) => n.id));
  const uf = new UnionFind();
  project.nodes.forEach((n) => uf.add(n.id));

  // 1) 导线合并节点；悬空导线端只给警告，绝不凭空造节点。
  for (const w of project.wires) {
    const { a, b } = wireEndpoints(w);
    if (!a || !b) {
      issues.push({
        kind: 'dangling',
        severity: 'warning',
        message: `导线 ${w.id} 有未连接端，已从分析中排除。`,
        nodeIds: [a, b].filter(Boolean) as string[]
      });
      continue;
    }
    if (!nodeIds.has(a) || !nodeIds.has(b)) continue;
    uf.union(a, b);
  }

  // 2) 元件端检查；0V 电压源等价导线（合并并提示）。
  const validComponents: Component[] = [];
  for (const c of project.components) {
    const endpointsOk =
      nodeIds.has(c.p) && nodeIds.has(c.q) && !(c.loose && (c.loose.p || c.loose.q));
    if (!endpointsOk) {
      issues.push({
        kind: 'dangling',
        severity: 'warning',
        message: `元件 ${c.id} 有悬空端，已从分析中排除。请把端点拖到接点上。`,
        componentIds: [c.id]
      });
      continue;
    }
    if (c.type === 'voltage' && Math.abs(c.vs) === 0) {
      uf.union(c.p, c.q);
      issues.push({
        kind: 'dangling',
        severity: 'warning',
        message: `电压源 ${c.id} 为 0V，按理想导线（等电位）处理。`,
        componentIds: [c.id]
      });
      continue;
    }
    validComponents.push(c);
  }

  const netOfNode = new Map<string, string>();
  project.nodes.forEach((n) => netOfNode.set(n.id, uf.find(n.id)));

  const grounds = project.nodes.filter((n) => n.ground);
  let groundNet: string | null = null;
  if (grounds.length === 0) {
    issues.push({
      kind: 'no-ground',
      severity: 'error',
      message: '电路没有参考地：节点电压只确定到一个任意常数。请放置一个接地符号。'
    });
  } else {
    groundNet = uf.find(grounds[0].id);
    if (grounds.length > 1) {
      // UI 层只允许一个地；到这里说明数据异常，多地由导线合并即可。
      const extra = grounds.slice(1);
      extra.forEach((g) => uf.union(grounds[0].id, g.id));
      groundNet = uf.find(grounds[0].id);
    }
  }

  return { netOfNode, issues, validComponents, groundNet };
}

// ---------------------------------------------------------------------------
// 主求解入口
// ---------------------------------------------------------------------------
export function solveCircuit(project: Project, labelOf?: Map<string, string>): SolveResult {
  const empty: SolveResult = {
    ok: false,
    nodeVoltages: {},
    components: [],
    equations: [],
    netNames: {},
    varNames: [],
    issues: [],
    dimension: 0,
    kclResidual: 0,
    powerGenerated: 0,
    powerDissipated: 0,
    powerMismatch: 0
  };

  const prepped = prepare(project, labelOf);
  const issues = prepped.issues;
  const { netOfNode, validComponents, groundNet } = prepped;

  const net = (nodeId: string) => netOfNode.get(nodeId)!;
  const label = (nodeId: string) => nodeLabel(project, nodeId, labelOf);

  // 网络命名：取其中最小显示名的节点名。
  const netMembers = new Map<string, string[]>();
  for (const n of project.nodes) {
    const root = net(n.id);
    if (!netMembers.has(root)) netMembers.set(root, []);
    netMembers.get(root)!.push(n.id);
  }
  const netNames: Record<string, string> = {};
  for (const [root, members] of netMembers) {
    const sorted = [...members].sort((a, b) => label(a).localeCompare(label(b), undefined, { numeric: true }));
    netNames[root] = root === groundNet ? '0 (地)' : label(sorted[0]);
  }

  if (validComponents.length === 0) {
    issues.push({
      kind: 'no-component',
      severity: 'warning',
      message: '没有可分析的有效元件。'
    });
  }

  // ---- 3) 零电阻边界 -----------------------------------------------------
  const zeroR = validComponents.filter((c) => c.type === 'resistor' && (c as { r: number }).r <= 0);
  for (const c of zeroR) {
    const zc = c as { r: number };
    issues.push({
      kind: 'zero-resistance',
      severity: 'error',
      message:
        zc.r === 0
          ? `电阻 ${c.id} 阻值为 0：电导 1/R 无穷大，修正节点方程无法盖章。请改用导线连接两个接点。`
          : `电阻 ${c.id} 阻值为负 (${zc.r} Ω)：本工作台只处理无源正电阻。`,
      componentIds: [c.id],
      constraint: `1/${c.id} 必须为有限正值`
    });
  }

  // ---- 4) 网络拓扑分组（所有元件都是电气连接） ---------------------------
  const allNets = new Set<string>(netOfNode.values());
  const adjacency = new Map<string, Set<string>>();
  const addEdge = (a: string, b: string) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  };
  for (const c of validComponents) addEdge(net(c.p), net(c.q));

  const componentsOnNet = new Map<string, Component[]>();
  for (const c of validComponents) {
    for (const n of [net(c.p), net(c.q)]) {
      if (!componentsOnNet.has(n)) componentsOnNet.set(n, []);
      componentsOnNet.get(n)!.push(c);
    }
  }

  // ---- 5) 孤立节点 -------------------------------------------------------
  for (const n of allNets) {
    if (!componentsOnNet.has(n)) {
      const members = netMembers.get(n)!;
      if (n !== groundNet) {
        issues.push({
          kind: 'isolated-node',
          severity: 'error',
          message: `接点 ${netNames[n]} 未连接任何元件且不是地：其电位无任何约束。删除它，或接入元件。`,
          nodeIds: members,
          constraint: `KCL @ ${netNames[n]}: 0 = 0（无支路电流，电位 V_${netNames[n]} 自由）`
        });
      } else {
        issues.push({
          kind: 'isolated-node',
          severity: 'warning',
          message: `接地接点 ${netNames[n]} 上没有元件。`,
          nodeIds: members
        });
      }
    }
  }

  // ---- 6) 浮空子网：不含地的电气连通块，绝对电位自由 ---------------------
  const visited = new Set<string>();
  const subnets: string[][] = [];
  for (const start of adjacency.keys()) {
    if (visited.has(start)) continue;
    const stack = [start];
    const group: string[] = [];
    visited.add(start);
    while (stack.length) {
      const cur = stack.pop()!;
      group.push(cur);
      for (const nb of adjacency.get(cur) ?? []) {
        if (!visited.has(nb)) {
          visited.add(nb);
          stack.push(nb);
        }
      }
    }
    subnets.push(group);
  }
  for (const group of subnets) {
    if (!group.includes(groundNet ?? '___')) {
      const memberNodes = group.flatMap((n) => netMembers.get(n) ?? []);
      const nameList = group.map((n) => netNames[n]).join(', ');
      issues.push({
        kind: 'floating-subnet',
        severity: 'error',
        message: `浮空子网 {${nameList}} 没有任何到参考地的路径：整体可平移任意电位，KCL 矩阵奇异。请在其中一个接点放置地，或用导线/电源把它接入接地网络。`,
        nodeIds: memberNodes,
        constraint: `子网绝对电位 V_common 自由：对子网中每个节点都有 V_k = V_common + …，V_common 不出现在任何方程中`
      });
    }
  }

  // ---- 7) 纯电压源环：沿环电压代数和必须为 0（KVL 约束冲突） -------------
  detectVoltageLoops(validComponents, net, netNames, issues);

  // ---- 8) 电流源割集冲突：删去电流源后每个 R+V 连通块边界电流代数和须为 0
  detectCurrentCuts(validComponents, net, netNames, netMembers, issues);

  const hardErrors = issues.filter((i) => i.severity === 'error');
  if (hardErrors.length > 0 || !groundNet) {
    return { ...empty, issues, netNames };
  }

  // ---- 9) 组装修正节点方程 ----------------------------------------------
  const nonGroundNets = [...allNets].filter((n) => n !== groundNet).sort();
  const vSources = validComponents.filter((c) => c.type === 'voltage') as Extract<
    Component,
    { type: 'voltage' }
  >[];
  const resistors = validComponents.filter((c) => c.type === 'resistor') as Extract<
    Component,
    { type: 'resistor' }
  >[];
  const currentSources = validComponents.filter((c) => c.type === 'current') as Extract<
    Component,
    { type: 'current' }
  >[];

  const netIndex = new Map<string, number>();
  nonGroundNets.forEach((n, i) => netIndex.set(n, i));

  // 把“同一对网络、同一设定值”的电压约束合并为一个支路电流变量：
  // 同值理想电压源并联时节点电压有解，但各源电流分配不唯一（矩阵将奇异）。
  // 取一个变量表示并联组的总电流，单源电流按均分展示并给出警告。
  interface VGroup {
    primary: Extract<Component, { type: 'voltage' }>;
    members: Extract<Component, { type: 'voltage' }>[];
    val: number;
  }
  const vGroups: VGroup[] = [];
  const groupOf = new Map<string, number>();
  for (const s of vSources) {
    const np = net(s.p);
    const nq = net(s.q);
    // 规范成 V(lo) − V(hi) = val
    const [lo, hi] = np < nq ? [np, nq] : [nq, np];
    const val = np < nq ? s.vs : -s.vs;
    let gi = vGroups.findIndex((g) => {
      const gp = net(g.primary.p);
      const gq = net(g.primary.q);
      const [glo, ghi] = gp < gq ? [gp, gq] : [gq, gp];
      const gval = gp < gq ? g.primary.vs : -g.primary.vs;
      return glo === lo && ghi === hi && gval === val;
    });
    if (gi < 0) {
      gi = vGroups.length;
      vGroups.push({ primary: s, members: [], val });
    }
    vGroups[gi].members.push(s);
    groupOf.set(s.id, gi);
  }

  const srcIndex = new Map<string, number>();
  vGroups.forEach((g, k) => {
    g.members.forEach((m) => srcIndex.set(m.id, nonGroundNets.length + k));
  });
  const dim = nonGroundNets.length + vGroups.length;

  const varNames = [
    ...nonGroundNets.map((n) => `V(${netNames[n]})`),
    ...vGroups.map((g) => (g.members.length > 1 ? `i_[${g.members.join('+')}]` : `i_${g.primary.id}`))
  ];

  // 稀疏行收集：row -> varKey -> {coeff, origins}
  const rows: EqRow[] = nonGroundNets.map((n) => ({
    kind: 'kcl' as const,
    refId: n,
    label: `KCL @ ${netNames[n]}`,
    terms: [],
    rhs: 0,
    rhsOrigins: []
  }));
  for (const g of vGroups) {
    rows.push({
      kind: 'voltage' as const,
      refId: g.primary.id,
      label:
        g.members.length > 1
          ? `并联电压源组 [${g.members.map((s) => s.id).join(', ')}]（同值 ${g.primary.vs} V）: ` +
            `V(${netNames[net(g.primary.p)]}) − V(${netNames[net(g.primary.q)]}) = ${g.primary.vs} V`
          : `电压源 ${g.primary.id}: V(${netNames[net(g.primary.p)]}) − V(${netNames[net(g.primary.q)]}) = ${g.primary.vs} V`,
      terms: [],
      rhs: g.primary.vs,
      rhsOrigins: g.members.map((s) => s.id)
    });
  }

  const termMap = new Map<number, Map<number, EqTerm>>();
  const ensure = (row: number, v: number): EqTerm => {
    if (!termMap.has(row)) termMap.set(row, new Map());
    const m = termMap.get(row)!;
    if (!m.has(v)) {
      const t: EqTerm = { varIndex: v, coeff: 0, origin: '' };
      m.set(v, t);
    }
    return m.get(v)!;
  };

  const stampResistor = (row: number, v: number, coeff: number, origin: string) => {
    const t = ensure(row, v);
    t.coeff += coeff;
    if (!t.origin) t.origin = origin;
    else if (!t.origin.split(',').includes(origin)) t.origin += `,${origin}`;
  };

  // 电阻：g·(Va−Vb)，电流取“流出节点”为正。
  for (const r of resistors) {
    const a = net(r.p);
    const b = net(r.q);
    const g = 1 / r.r;
    const ia = netIndex.get(a);
    const ib = netIndex.get(b);
    if (ia !== undefined) {
      stampResistor(ia, ia, g, r.id);
      if (ib !== undefined) stampResistor(ia, ib, -g, r.id);
    }
    if (ib !== undefined) {
      stampResistor(ib, ib, g, r.id);
      if (ia !== undefined) stampResistor(ib, ia, -g, r.id);
    }
  }

  // 电压源支路电流 i（p→q 为正）：p 节点 KCL +i，q 节点 KCL −i。
  vGroups.forEach((g, k) => {
    const rowV = nonGroundNets.length + k;
    const s = g.primary;
    const a = netIndex.get(net(s.p));
    const b = netIndex.get(net(s.q));
    const iv = nonGroundNets.length + k;
    if (a !== undefined) stampResistor(a, iv, 1, g.members.map((m) => m.id).join(','));
    if (b !== undefined) stampResistor(b, iv, -1, g.members.map((m) => m.id).join(','));
    // 电压约束行：Va − Vb = vs
    if (a !== undefined) stampResistor(rowV, a, 1, s.id);
    if (b !== undefined) stampResistor(rowV, b, -1, s.id);
  });

  // 电流源（p→q）：p 端流出 Is 移到右端 −Is，q 端 +Is。
  for (const cs of currentSources) {
    const a = netIndex.get(net(cs.p));
    const b = netIndex.get(net(cs.q));
    if (a !== undefined) {
      rows[a].rhs -= cs.is;
      rows[a].rhsOrigins.push(cs.id);
    }
    if (b !== undefined) {
      rows[b].rhs += cs.is;
      rows[b].rhsOrigins.push(cs.id);
    }
  }

  // 固化 termMap 到行（按变量排序，合并同 origin）。
  rows.forEach((row, ri) => {
    const m = termMap.get(ri);
    if (!m) return;
    row.terms = [...m.values()].filter((t) => Math.abs(t.coeff) > 0).sort((x, y) => x.varIndex - y.varIndex);
  });

  // ---- 10) 数值求解（mathjs） -------------------------------------------
  const A: number[][] = Array.from({ length: dim }, () => new Array(dim).fill(0));
  const b: number[] = new Array(dim).fill(0);
  rows.forEach((row, ri) => {
    b[ri] = row.rhs;
    for (const t of row.terms) A[ri][t.varIndex] += t.coeff;
  });

  let x: number[] = [];
  let numericFail: CircuitIssue | null = null;
  try {
    const sol = lusolve(matrix(A), matrix(b.map((v) => [v])));
    const arr = sol.toArray() as number[][];
    x = arr.map((row) => row[0]);
  } catch (err) {
    numericFail = {
      kind: 'singular',
      severity: 'error',
      message: `修正节点矩阵求解失败（${(err as Error).message}）。通常意味着存在未发现的理想源矛盾或浮空回路。电路已保留，可继续编辑。`
    };
  }
  if (!numericFail && x.some((v) => !Number.isFinite(v))) {
    numericFail = {
      kind: 'singular',
      severity: 'error',
      message: '求解结果出现非有限值（Inf/NaN）：矩阵奇异。请检查矛盾的理想电压源回路或电流源割集。'
    };
  }

  // 残差校验：||Ax−b||∞
  let residual = 0;
  if (x.length === dim && x.every(Number.isFinite)) {
    for (let i = 0; i < dim; i++) {
      let s = 0;
      for (let j = 0; j < dim; j++) s += A[i][j] * x[j];
      residual = Math.max(residual, Math.abs(s - b[i]));
    }
    const scale = Math.max(1, ...b.map(Math.abs), ...x.map(Math.abs));
    if (residual > 1e-7 * scale * Math.max(1, dim)) {
      numericFail = {
        kind: 'numerical',
        severity: 'error',
        message: `数值解未满足方程（KCL 残差 ${residual.toExponential(2)} A），结果不可信。请检查极端阻值/电压量级。`
      };
    }
  }

  if (numericFail) {
    issues.push(numericFail);
    return { ...empty, issues, netNames, varNames, equations: rows, dimension: dim, raw: x };
  }

  // ---- 11) 回收结果 ------------------------------------------------------
  const nodeVoltages: Record<string, number> = {};
  for (const n of project.nodes) {
    const root = net(n.id);
    nodeVoltages[n.id] = root === groundNet ? 0 : x[netIndex.get(root)!];
  }

  const results: ComponentResult[] = [];
  let powerDissipated = 0;
  let sourcePower = 0; // 电源吸收功率之和（供出为负）

  // 并联同值电压源组：总电流确定，组内各源电流不唯一。
  const groupSize = new Map<string, number>();
  for (const g of vGroups) {
    for (const m of g.members) groupSize.set(m.id, g.members.length);
    if (g.members.length > 1) {
      issues.push({
        kind: 'singular',
        severity: 'warning',
        message: `电压源 ${g.members
          .map((s) => s.id)
          .join('、')} 同值并联：节点电压与并联组总电流唯一，但各理想电压源的电流分配不唯一（表中按均分给值，仅示量级）。`,
        componentIds: g.members.map((s) => s.id)
      });
    }
  }

  for (const c of validComponents) {
    const vp = nodeVoltages[c.p];
    const vq = nodeVoltages[c.q];
    const v = vp - vq; // 始终 V(p)−V(q)，与定义的极性一致
    let i = 0; // 始终 p→q
    let note: string | undefined;
    if (c.type === 'resistor') {
      i = v / c.r;
      powerDissipated += i * i * c.r;
    } else if (c.type === 'voltage') {
      const total = x[srcIndex.get(c.id)!];
      const size = groupSize.get(c.id) ?? 1;
      i = size > 1 ? total / size : total;
      if (size > 1) note = `并联组总电流 ${total.toPrecision(4)} A，均分（不唯一）`;
      // 功率平衡按总电流计一次（用 primary 的 v*total），避免均分重复计入。
      sourcePower += v * (total / size);
    } else {
      i = c.is;
      sourcePower += v * i;
    }
    results.push({ id: c.id, v, i, pAbsorbed: v * i, note });
  }

  // 被排除（悬空等）的元件也给出占位，方便 UI 列出。
  for (const c of project.components) {
    if (!results.find((r) => r.id === c.id)) {
      results.push({ id: c.id, v: NaN, i: NaN, pAbsorbed: NaN });
    }
  }

  const powerGenerated = -sourcePower;
  const powerMismatch = powerDissipated + sourcePower;

  return {
    ok: true,
    nodeVoltages,
    components: results,
    equations: rows,
    netNames,
    varNames,
    issues,
    dimension: dim,
    kclResidual: residual,
    powerGenerated,
    powerDissipated,
    powerMismatch
  };
}

// ---------------------------------------------------------------------------
// 纯电压源环冲突：在“仅电压源”图上取生成树，每条余树边给出一个基本环；
// 沿环电压升代数和不为零 -> KVL 约束无法满足（如两个不同值理想电压源并联）。
// ---------------------------------------------------------------------------
function detectVoltageLoops(
  comps: Component[],
  net: (id: string) => string,
  netNames: Record<string, string>,
  issues: CircuitIssue[]
) {
  const vs = comps.filter((c) => c.type === 'voltage') as Extract<Component, { type: 'voltage' }>[];

  // 自环：电压源两端落在同一网络（被导线短接）。
  for (const s of vs) {
    if (net(s.p) === net(s.q)) {
      issues.push({
        kind: 'voltage-conflict',
        severity: 'error',
        message: `电压源 ${s.id}（${s.vs} V）两端被导线短接：约束 V(${netNames[net(s.p)]}) − V(${netNames[
          net(s.p)
        ]}) = ${s.vs} 无法满足。`,
        componentIds: [s.id],
        constraint: `0 = ${s.vs} V`
      });
    }
  }

  // 在“仅电压源”图上构造生成森林，记录每个节点的 parent 与树边。
  const adj = new Map<string, Set<string>>();
  const edgeAt = new Map<string, Extract<Component, { type: 'voltage' }>>(); // "a|b" a<b
  for (const s of vs) {
    const a = net(s.p);
    const b = net(s.q);
    if (a === b) continue;
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
    edgeAt.set(a < b ? `${a}|${b}` : `${b}|${a}`, s);
  }
  const treeEdge = new Map<string, Extract<Component, { type: 'voltage' }>>();
  const parent = new Map<string, string>();
  for (const start of adj.keys()) {
    if (treeEdge.has(start) || parent.has(start)) continue;
    treeEdge.set(start, null as unknown as Extract<Component, { type: 'voltage' }>);
    const queue = [start];
    while (queue.length) {
      const u = queue.shift()!;
      for (const v of adj.get(u) ?? []) {
        if (v === start || treeEdge.has(v) || parent.has(v)) continue;
        parent.set(v, u);
        treeEdge.set(v, edgeAt.get(u < v ? `${u}|${v}` : `${v}|${u}`)!);
        queue.push(v);
      }
    }
  }

  // 从 child 经过其树边走到 parent 的电压升：q→p 为 +vs，p→q 为 −vs。
  const riseToParent = (child: string): number => {
    const s = treeEdge.get(child)!;
    return net(s.q) === child ? s.vs : -s.vs;
  };

  // 每条非树边给出一个基本回路。
  for (const s of vs) {
    const a = net(s.p);
    const b = net(s.q);
    if (a === b) continue;
    if (parent.get(a) === b && treeEdge.get(a) === s) continue; // 树边
    if (parent.get(b) === a && treeEdge.get(b) === s) continue;

    // 回溯到 LCA。
    const ancestors = new Set<string>();
    let cur = a;
    ancestors.add(cur);
    while (parent.has(cur)) {
      cur = parent.get(cur)!;
      ancestors.add(cur);
    }
    let lca = b;
    if (!ancestors.has(lca)) {
      cur = b;
      while (parent.has(cur)) {
        cur = parent.get(cur)!;
        if (ancestors.has(cur)) {
          lca = cur;
          break;
        }
      }
    }

    const loopSources: string[] = [];
    let sum = 0;

    cur = a; // a 上溯到 LCA：方向 child→parent
    while (cur !== lca) {
      const se = treeEdge.get(cur)!;
      loopSources.push(se.id);
      sum += riseToParent(cur);
      cur = parent.get(cur)!;
    }
    const down: string[] = []; // LCA 下行到 b
    cur = b;
    while (cur !== lca) {
      down.push(cur);
      cur = parent.get(cur)!;
    }
    for (let i = down.length - 1; i >= 0; i--) {
      loopSources.push(treeEdge.get(down[i])!.id);
      sum -= riseToParent(down[i]); // 回路方向是 parent→child
    }
    // 经新源从 b 回到 a：b 为 − 端(q)时为 +vs。
    sum += net(s.q) === b ? s.vs : -s.vs;
    loopSources.push(s.id);

    if (Math.abs(sum) > 1e-10) {
      issues.push({
        kind: 'voltage-conflict',
        severity: 'error',
        message: `理想电压源环路无解：沿回路 ${loopSources.join(' → ')} 的电压升代数和为 ${sum} V ≠ 0，KVL 约束无法同时满足。例如两个设定值不同的理想电压源直接并联（或与电阻并联的电压源设定值矛盾）。`,
        componentIds: loopSources,
        constraint: `沿环 Σ V_k = 0，实际 Σ = ${sum} V`
      });
    }
  }
}

// ---------------------------------------------------------------------------
// 电流源割集冲突：仅保留 R 与 V 边得到连通块 S；电流源在块边界上构成割集。
// 对每个块做 KCL：边界上电流源注入代数和必须为 0，否则强制电流矛盾（串联异值）。
// ---------------------------------------------------------------------------
function detectCurrentCuts(
  comps: Component[],
  net: (id: string) => string,
  netNames: Record<string, string>,
  netMembers: Map<string, string[]>,
  issues: CircuitIssue[]
) {
  const cs = comps.filter((c) => c.type === 'current') as Extract<Component, { type: 'current' }>[];
  if (cs.length === 0) return;

  const uf = new UnionFind();
  comps.forEach((c) => {
    uf.add(net(c.p));
    uf.add(net(c.q));
  });
  for (const c of comps) {
    if (c.type !== 'current') uf.union(net(c.p), net(c.q));
  }

  const blockOf = new Map<string, string>();
  const blockNets = new Map<string, Set<string>>();
  for (const c of comps) {
    for (const n of [net(c.p), net(c.q)]) {
      const root = uf.find(n);
      blockOf.set(n, root);
      if (!blockNets.has(root)) blockNets.set(root, new Set());
      blockNets.get(root)!.add(n);
    }
  }

  const injection = new Map<string, number>();
  const sourcesOnBlock = new Map<string, string[]>();
  for (const s of cs) {
    // p→q：离开 p 所在块记 +Is（该块必须通过其他割集边流回）。
    const bp = blockOf.get(net(s.p));
    const bq = blockOf.get(net(s.q));
    if (bp === undefined || bq === undefined || bp === bq) continue; // 同一块内部，不构成割集
    injection.set(bp, (injection.get(bp) ?? 0) + s.is);
    injection.set(bq, (injection.get(bq) ?? 0) - s.is);
    for (const blk of new Set([bp, bq])) {
      if (!sourcesOnBlock.has(blk)) sourcesOnBlock.set(blk, []);
      sourcesOnBlock.get(blk)!.push(s.id);
    }
  }

  for (const [blk, sum] of injection) {
    if (Math.abs(sum) > 1e-12) {
      const nets = [...(blockNets.get(blk) ?? [])];
      const nodeIds = nets.flatMap((n) => netMembers.get(n) ?? []);
      issues.push({
        kind: 'current-conflict',
        severity: 'error',
        message: `电流源割集矛盾：包围接点 {${nets
          .map((n) => netNames[n])
          .join(', ')}} 的闭合面上，电流源净电流为 ${sum} A 而非 0。典型情形：两个不同设定值的理想电流源串联，强制同一支路电流取两个值。`,
        componentIds: sourcesOnBlock.get(blk),
        nodeIds,
        constraint: `割集 KCL：Σ I_source = 0，实际 Σ = ${sum} A`
      });
    }
  }
}
