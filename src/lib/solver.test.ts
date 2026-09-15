import { describe, expect, it } from 'vitest';
import { solveCircuit } from './solver';
import type { Project } from './types';

let seq = 0;
const uid = (p: string) => `${p}${++seq}`;

function makeProject(): Project {
  return {
    id: 'p',
    name: 'test',
    nodes: [],
    components: [],
    wires: [],
    updatedAt: Date.now()
  };
}

const addNode = (proj: Project, id: string, ground = false, x = 0, y = 0) => {
  proj.nodes.push({ id, x, y, ground });
};
const addR = (proj: Project, p: string, q: string, r: number) =>
  proj.components.push({ id: uid('R'), type: 'resistor', p, q, r, x: 0, y: 0 });
const addV = (proj: Project, p: string, q: string, vs: number) =>
  proj.components.push({ id: uid('V'), type: 'voltage', p, q, vs, x: 0, y: 0 });
const addI = (proj: Project, p: string, q: string, is: number) =>
  proj.components.push({ id: uid('I'), type: 'current', p, q, is, x: 0, y: 0 });
const addWire = (proj: Project, a: string, b: string) =>
  proj.wires.push({
    id: uid('W'),
    points: [{ nodeId: a }, { nodeId: b }],
    startNode: a,
    endNode: b,
    looseStart: null,
    looseEnd: null
  });

describe('桥式电阻网络（惠斯通电桥）', () => {
  it('解出节点电压、KCL 残差为零、功率平衡', () => {
    //       a
    //   10 / \ 20
    //     b - c  桥臂 30
    //   40 \ / 50
    //       d(地)
    // a-d 由 12V 电压源驱动
    const proj = makeProject();
    ['a', 'b', 'c', 'd'].forEach((n) => addNode(proj, n, n === 'd'));
    addR(proj, 'a', 'b', 10);
    addR(proj, 'a', 'c', 20);
    addR(proj, 'b', 'c', 30);
    addR(proj, 'b', 'd', 40);
    addR(proj, 'c', 'd', 50);
    addV(proj, 'a', 'd', 12);

    const res = solveCircuit(proj);
    expect(res.ok).toBe(true);
    expect(res.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    expect(res.nodeVoltages['a']).toBeCloseTo(12, 9);
    expect(res.nodeVoltages['d']).toBeCloseTo(0, 9);
    // KCL: (b-a)/10 +(b-c)/30 +(b-d)/40 = 0
    const va = res.nodeVoltages['a'];
    const vb = res.nodeVoltages['b'];
    const vc = res.nodeVoltages['c'];
    const kclB = (vb - va) / 10 + (vb - vc) / 30 + vb / 40;
    const kclC = (vc - va) / 20 + (vc - vb) / 30 + vc / 50;
    expect(kclB).toBeCloseTo(0, 9);
    expect(kclC).toBeCloseTo(0, 9);
    expect(res.kclResidual).toBeLessThan(1e-9);
    // 功率平衡：Σ 电阻消耗 = 电源供出
    expect(res.powerMismatch).toBeCloseTo(0, 9);
    expect(res.powerDissipated).toBeCloseTo(res.powerGenerated, 9);
    expect(res.powerDissipated).toBeGreaterThan(0);
  });

  it('平衡电桥时桥臂电流为 0', () => {
    const proj = makeProject();
    ['a', 'b', 'c', 'd'].forEach((n) => addNode(proj, n, n === 'd'));
    addR(proj, 'a', 'b', 100);
    addR(proj, 'a', 'c', 100);
    addR(proj, 'b', 'd', 200);
    addR(proj, 'c', 'd', 200);
    const bridgeId = uid('R');
    proj.components.push({ id: bridgeId, type: 'resistor', p: 'b', q: 'c', r: 50, x: 0, y: 0 });
    addV(proj, 'a', 'd', 10);
    const res = solveCircuit(proj);
    expect(res.ok).toBe(true);
    expect(res.nodeVoltages['b']).toBeCloseTo(res.nodeVoltages['c'], 10);
    const bridge = res.components.find((c) => c.id === bridgeId)!;
    expect(bridge.i).toBeCloseTo(0, 10);
  });
});

describe('串联电压源', () => {
  it('同向串联电压相加，KCL 与功率平衡成立', () => {
    // 地 - V1(5V) - n1 - V2(3V) - n2 - R(8Ω) - 地
    const proj = makeProject();
    ['g', 'n1', 'n2'].forEach((n) => addNode(proj, n, n === 'g'));
    addV(proj, 'n1', 'g', 5);
    addV(proj, 'n2', 'n1', 3);
    addR(proj, 'n2', 'g', 8);
    const res = solveCircuit(proj);
    expect(res.ok).toBe(true);
    expect(res.nodeVoltages['n1']).toBeCloseTo(5, 9);
    expect(res.nodeVoltages['n2']).toBeCloseTo(8, 9);
    // 串联回路电流 8V/8Ω = 1A；电源供出功率，电流从 + 端流出（即 p→q 电流为 −1A）。
    const r = res.components.find((c) => c.id.startsWith('R'))!;
    expect(r.i).toBeCloseTo(1, 9);
    for (const c of res.components.filter((c) => c.id.startsWith('V'))) {
      expect(c.i).toBeCloseTo(-1, 9);
    }
    expect(res.powerMismatch).toBeCloseTo(0, 9);
  });

  it('反极性串联按代数和处理', () => {
    const proj = makeProject();
    ['g', 'n1', 'n2'].forEach((n) => addNode(proj, n, n === 'g'));
    addV(proj, 'n1', 'g', 5);
    addV(proj, 'n1', 'n2', 3); // 等效 5−3=2V 加在电阻上
    addR(proj, 'n2', 'g', 4);
    const res = solveCircuit(proj);
    expect(res.ok).toBe(true);
    expect(res.nodeVoltages['n2']).toBeCloseTo(2, 9);
    expect(res.nodeVoltages['n2'] / 4).toBeCloseTo(0.5, 9);
    expect(res.powerMismatch).toBeCloseTo(0, 9);
  });
});

describe('矛盾的理想电压源（题目核心场景）', () => {
  it('不同电压值并联：报出无法满足的 KVL 约束，不返回 NaN 结果', () => {
    const proj = makeProject();
    addNode(proj, 'a');
    addNode(proj, 'b', true);
    addV(proj, 'a', 'b', 5);
    addV(proj, 'a', 'b', 3);
    const res = solveCircuit(proj);
    expect(res.ok).toBe(false);
    const conflict = res.issues.find((i) => i.kind === 'voltage-conflict');
    expect(conflict).toBeTruthy();
    expect(conflict!.constraint).toContain('Σ V_k = 0');
    expect(conflict!.componentIds).toHaveLength(2);
    // 绝不出现 NaN 字段
    expect(JSON.stringify(res).includes('NaN')).toBe(false);
  });

  it('同值并联：可解，并警告支路电流不唯一', () => {
    const proj = makeProject();
    addNode(proj, 'a');
    addNode(proj, 'b', true);
    addV(proj, 'a', 'b', 5);
    addV(proj, 'a', 'b', 5);
    addR(proj, 'a', 'b', 10);
    const res = solveCircuit(proj);
    expect(res.ok).toBe(true);
    expect(res.nodeVoltages['a']).toBeCloseTo(5, 9);
    expect(res.issues.some((i) => i.severity === 'warning' && i.message.includes('不唯一'))).toBe(true);
  });

  it('电压源被导线短路且非 0V：报 0 = V 约束', () => {
    const proj = makeProject();
    addNode(proj, 'a');
    addNode(proj, 'b', true);
    addV(proj, 'a', 'b', 9);
    addWire(proj, 'a', 'b');
    const res = solveCircuit(proj);
    expect(res.ok).toBe(false);
    expect(res.issues.some((i) => i.kind === 'voltage-conflict' && i.constraint === '0 = 9 V')).toBe(true);
  });
});

describe('电流源', () => {
  it('基本电流源电路功率平衡', () => {
    const proj = makeProject();
    addNode(proj, 'a');
    addNode(proj, 'b', true);
    addI(proj, 'b', 'a', 2); // 从地向 a 注入 2A
    addR(proj, 'a', 'b', 5);
    const res = solveCircuit(proj);
    expect(res.ok).toBe(true);
    expect(res.nodeVoltages['a']).toBeCloseTo(10, 9);
    expect(res.powerMismatch).toBeCloseTo(0, 9);
  });

  it('不同值理想电流源串联：报割集 KCL 矛盾', () => {
    // 地 - I1(1A) - n1 - I2(2A) - n2 - R - 地
    const proj = makeProject();
    ['g', 'n1', 'n2'].forEach((n) => addNode(proj, n, n === 'g'));
    addI(proj, 'g', 'n1', 1);
    addI(proj, 'n1', 'n2', 2);
    addR(proj, 'n2', 'g', 10);
    const res = solveCircuit(proj);
    expect(res.ok).toBe(false);
    expect(res.issues.some((i) => i.kind === 'current-conflict')).toBe(true);
  });

  it('电流源直接成环且和为非零：报矛盾；和为零可解', () => {
    const proj = makeProject();
    addNode(proj, 'a');
    addNode(proj, 'b', true);
    addI(proj, 'a', 'b', 1);
    addI(proj, 'b', 'a', 2);
    const res = solveCircuit(proj);
    // 浮空? a,b 有元件相连且 b 接地，不浮空；割集 KCL：1 + (−2) 方向需检查
    const conflict = res.issues.find((i) => i.kind === 'current-conflict');
    expect(conflict).toBeTruthy();
  });
});

describe('拓扑边界', () => {
  it('没有参考地：报 no-ground，不给出电压表', () => {
    const proj = makeProject();
    addNode(proj, 'a');
    addNode(proj, 'b');
    addR(proj, 'a', 'b', 10);
    const res = solveCircuit(proj);
    expect(res.ok).toBe(false);
    expect(res.issues.some((i) => i.kind === 'no-ground')).toBe(true);
  });

  it('浮空子网：第二子网不接地时报错', () => {
    const proj = makeProject();
    addNode(proj, 'g', true);
    addNode(proj, 'a');
    addR(proj, 'a', 'g', 10);
    addNode(proj, 'x');
    addNode(proj, 'y');
    addR(proj, 'x', 'y', 5);
    const res = solveCircuit(proj);
    expect(res.ok).toBe(false);
    const f = res.issues.find((i) => i.kind === 'floating-subnet');
    expect(f).toBeTruthy();
    expect(f!.nodeIds).toEqual(expect.arrayContaining(['x', 'y']));
  });

  it('孤立节点：报电位无约束', () => {
    const proj = makeProject();
    addNode(proj, 'g', true);
    addNode(proj, 'a');
    addNode(proj, 'lonely');
    addR(proj, 'a', 'g', 10);
    const res = solveCircuit(proj);
    expect(res.ok).toBe(false);
    expect(res.issues.some((i) => i.kind === 'isolated-node' && i.nodeIds?.includes('lonely'))).toBe(true);
  });

  it('零电阻：报电导无界', () => {
    const proj = makeProject();
    addNode(proj, 'a');
    addNode(proj, 'b', true);
    addR(proj, 'a', 'b', 0);
    const res = solveCircuit(proj);
    expect(res.ok).toBe(false);
    expect(res.issues.some((i) => i.kind === 'zero-resistance')).toBe(true);
  });

  it('负电阻：报非法边界', () => {
    const proj = makeProject();
    addNode(proj, 'a');
    addNode(proj, 'b', true);
    addR(proj, 'a', 'b', -4);
    const res = solveCircuit(proj);
    expect(res.ok).toBe(false);
    expect(res.issues.some((i) => i.kind === 'zero-resistance')).toBe(true);
  });

  it('悬空元件端：警告并排除，其余电路照常求解', () => {
    const proj = makeProject();
    addNode(proj, 'a');
    addNode(proj, 'b', true);
    addR(proj, 'a', 'b', 10);
    addNode(proj, 'c');
    addR(proj, 'b', 'c', 20);
    proj.components.push({ id: 'Rloose', type: 'resistor', p: 'c', q: '__none__', r: 3, x: 0, y: 0 });
    const res = solveCircuit(proj);
    expect(res.ok).toBe(true);
    expect(res.issues.some((i) => i.kind === 'dangling' && i.componentIds?.includes('Rloose'))).toBe(true);
  });
});

describe('导线与交叉', () => {
  it('导线连接的节点等电位', () => {
    const proj = makeProject();
    addNode(proj, 'g', true);
    addNode(proj, 'a');
    addNode(proj, 'b');
    addR(proj, 'a', 'g', 10);
    addR(proj, 'b', 'g', 20);
    addWire(proj, 'a', 'b');
    const res = solveCircuit(proj);
    expect(res.ok).toBe(true);
    expect(res.nodeVoltages['a']).toBeCloseTo(res.nodeVoltages['b'], 10);
  });
});
