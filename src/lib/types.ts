// 电路域模型：所有元件都以“端点引用节点 id”的方式连接。
// 连接关系完全由节点 id 决定；拖动只改 x/y，永远不改引用，因此拖动不改变连接。

export type ComponentType = 'resistor' | 'voltage' | 'current';

export interface Point {
  x: number;
  y: number;
}

export interface CircuitNode {
  id: string;
  x: number;
  y: number;
  /** 全电路至多一个参考地；地由用户明确放置，绝不隐式推断。 */
  ground?: boolean;
}

export interface BaseComponent {
  id: string;
  type: ComponentType;
  /** 正端 / +端 / 箭头尾端（电流从 p 端流出到 q 端）。 */
  p: string;
  /** 负端 / -端 / 箭头尖端。 */
  q: string;
  /** 未连接的悬空端：null 表示该端尚未接到任何节点。 */
  loose?: { p: Point | null; q: Point | null };
  /** 元件中心点（供渲染与整体拖动）。 */
  x: number;
  y: number;
}

export interface Resistor extends BaseComponent {
  type: 'resistor';
  /** 欧姆。0 或负数是非法边界，求解器会以错误形式指出。 */
  r: number;
}

export interface VoltageSource extends BaseComponent {
  type: 'voltage';
  /** 伏特；V(p)-V(q) = vs，即 p 为 + 极。 */
  vs: number;
}

export interface CurrentSource extends BaseComponent {
  type: 'current';
  /** 安培；电流从 p 流向 q（箭头由 p 指向 q）。 */
  is: number;
}

export type Component = Resistor | VoltageSource | CurrentSource;

export interface Wire {
  id: string;
  /** 折线的各段；首末点要么落在节点上，要么是悬空端坐标。 */
  points: (Point | { nodeId: string })[];
  /** 首端悬空坐标（未接节点时）。 */
  looseStart: Point | null;
  /** 末端悬空坐标（未接节点时）。 */
  looseEnd: Point | null;
  /** 首端节点。 */
  startNode: string | null;
  /** 末端节点。 */
  endNode: string | null;
}

export interface Project {
  id: string;
  name: string;
  nodes: CircuitNode[];
  components: Component[];
  wires: Wire[];
  updatedAt: number;
}

// ---------- 求解结果 ----------

export interface EqTerm {
  /** 变量索引：0..nNets-1 为节点电压；其后为各电压源支路电流。 */
  varIndex: number;
  coeff: number;
  /** 产生该项的元件（电阻/电压源），点击方程可追溯。 */
  origin: string;
}

export interface EqRow {
  kind: 'kcl' | 'voltage';
  /** KCL 行对应网络 id；电压行对应电压源 id。 */
  refId: string;
  label: string;
  terms: EqTerm[];
  rhs: number;
  rhsOrigins: string[];
}

export type IssueKind =
  | 'dangling'
  | 'isolated-node'
  | 'floating-subnet'
  | 'zero-resistance'
  | 'voltage-conflict'
  | 'current-conflict'
  | 'singular'
  | 'numerical'
  | 'no-ground'
  | 'no-component';

export interface CircuitIssue {
  kind: IssueKind;
  severity: 'error' | 'warning';
  message: string;
  /** 相关元件/节点/导线，前端可高亮。 */
  componentIds?: string[];
  nodeIds?: string[];
  /** 无法满足的约束的可读描述（矛盾电压源等）。 */
  constraint?: string;
}

export interface ComponentResult {
  id: string;
  v: number; // V(p)-V(q)，与极性定义一致
  i: number; // 从 p 流向 q 的电流，与箭头一致
  pAbsorbed: number; // 吸收功率 p = v*i；电源正常工作时为负
  /** 电流不确定等情形的说明（同值理想电压源并联）。 */
  note?: string;
}

export interface SolveResult {
  ok: boolean;
  nodeVoltages: Record<string, number>;
  components: ComponentResult[];
  equations: EqRow[];
  netNames: Record<string, string>;
  /** 变量顺序：先非地网络电压，再电压源(组)支路电流。与 EqTerm.varIndex 对齐。 */
  varNames: string[];
  issues: CircuitIssue[];
  /** 矩阵规模，供面板展示。 */
  dimension: number;
  kclResidual: number;
  powerGenerated: number;
  powerDissipated: number;
  powerMismatch: number;
  /** 失败时保留原始元件值映射，电路仍可继续编辑。 */
  raw?: number[];
}
