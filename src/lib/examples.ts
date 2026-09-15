import type { Project } from './types';
import { uid } from './geometry';

function base(name: string): Project {
  return { id: uid('prj_'), name, nodes: [], components: [], wires: [], updatedAt: Date.now() };
}

function node(p: Project, id: string, x: number, y: number, ground = false) {
  p.nodes.push({ id, x, y, ground });
}
function wire(p: Project, a: string, b: string) {
  p.wires.push({
    id: uid('W'),
    points: [{ nodeId: a }, { nodeId: b }],
    startNode: a,
    endNode: b,
    looseStart: null,
    looseEnd: null
  });
}

// 惠斯通电桥：12V 驱动，桥臂 Rbc。
export function bridgeExample(): Project {
  const p = base('惠斯通电桥');
  //            a(240,120)
  //     R1 10 ╱     ╲ R2 20
  //      b(120,260)──R5 30──c(360,260)
  //     R3 40 ╲     ╱ R4 50
  //            d(240,400) 地
  node(p, 'a', 240, 120);
  node(p, 'b', 120, 260);
  node(p, 'c', 360, 260);
  node(p, 'd', 240, 400, true);
  p.components.push(
    { id: 'V1', type: 'voltage', p: 'a', q: 'd', vs: 12, x: 470, y: 260 },
    { id: 'R1', type: 'resistor', p: 'a', q: 'b', r: 10, x: 140, y: 180 },
    { id: 'R2', type: 'resistor', p: 'a', q: 'c', r: 20, x: 340, y: 180 },
    { id: 'R5', type: 'resistor', p: 'b', q: 'c', r: 30, x: 240, y: 260 },
    { id: 'R3', type: 'resistor', p: 'b', q: 'd', r: 40, x: 140, y: 340 },
    { id: 'R4', type: 'resistor', p: 'c', q: 'd', r: 50, x: 340, y: 340 }
  );
  // 电源两端接线
  node(p, 'va', 422, 260);
  node(p, 'vd', 518, 260);
  wire(p, 'va', 'a');
  wire(p, 'vd', 'd');
  p.components[0].p = 'va';
  p.components[0].q = 'vd';
  return p;
}

// 串联电源（同向/反向可在 UI 切换），配合 KCL 与功率检查。
export function seriesSourcesExample(): Project {
  const p = base('串联电压源');
  // 方形回路：n1(左上,5V+) ─ V2(3V) ─ n2(右上)
  //           V1(5V)                  R1(8Ω)
  //           g(左下,地) ──导线── n3(右下)
  node(p, 'g', 160, 380, true);
  node(p, 'n1', 160, 140);
  node(p, 'n2', 440, 140);
  node(p, 'n3', 440, 380);
  p.components.push(
    { id: 'V1', type: 'voltage', p: 'n1', q: 'g', vs: 5, x: 160, y: 258 },
    { id: 'V2', type: 'voltage', p: 'n2', q: 'n1', vs: 3, x: 300, y: 140 },
    { id: 'R1', type: 'resistor', p: 'n2', q: 'n3', r: 8, x: 440, y: 258 }
  );
  wire(p, 'n3', 'g');
  return p;
}

// 经典错误：两个不同设定值的理想电压源直接并联。
export function conflictExample(): Project {
  const p = base('矛盾电压源（5V∥3V）');
  node(p, 'a', 300, 160);
  node(p, 'b', 300, 360, true);
  p.components.push(
    { id: 'V5', type: 'voltage', p: 'a', q: 'b', vs: 5, x: 200, y: 260 },
    { id: 'V3', type: 'voltage', p: 'a', q: 'b', vs: 3, x: 400, y: 260 }
  );
  return p;
}

// 电流源串联冲突示例。
export function currentConflictExample(): Project {
  const p = base('串联电流源冲突');
  node(p, 'g', 120, 320, true);
  node(p, 'n1', 300, 200);
  node(p, 'n2', 480, 320);
  p.components.push(
    { id: 'I1', type: 'current', p: 'g', q: 'n1', is: 1, x: 210, y: 258 },
    { id: 'I2', type: 'current', p: 'n1', q: 'n2', is: 2, x: 390, y: 258 },
    { id: 'R1', type: 'resistor', p: 'n2', q: 'g', r: 10, x: 300, y: 320 }
  );
  return p;
}

export function emptyExample(): Project {
  const p = base('未命名工程');
  node(p, 'n0', 400, 320, true);
  return p;
}
