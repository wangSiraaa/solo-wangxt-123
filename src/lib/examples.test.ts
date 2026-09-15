import { describe, expect, it } from 'vitest';
import { solveCircuit } from './solver';
import {
  bridgeExample,
  conflictExample,
  currentConflictExample,
  seriesSourcesExample
} from './examples';

describe('内置示例电路', () => {
  it('惠斯通电桥：可解、KCL 残差小、功率平衡', () => {
    const r = solveCircuit(bridgeExample());
    expect(r.ok).toBe(true);
    expect(r.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    expect(r.kclResidual).toBeLessThan(1e-9);
    expect(r.powerMismatch).toBeCloseTo(0, 8);
  });

  it('串联电源：V1+V2=8V 驱动 8Ω，功率平衡', () => {
    const r = solveCircuit(seriesSourcesExample());
    expect(r.ok).toBe(true);
    expect(r.nodeVoltages['n2']).toBeCloseTo(8, 9);
    expect(r.powerMismatch).toBeCloseTo(0, 8);
  });

  it('矛盾电压源示例：报 KVL 环路，列出两个源', () => {
    const r = solveCircuit(conflictExample());
    expect(r.ok).toBe(false);
    const issue = r.issues.find((i) => i.kind === 'voltage-conflict');
    expect(issue).toBeTruthy();
    expect(issue!.componentIds?.sort()).toEqual(['V3', 'V5']);
    expect(JSON.stringify(r)).not.toContain('NaN');
  });

  it('串联异值电流源示例：报割集矛盾', () => {
    const r = solveCircuit(currentConflictExample());
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.kind === 'current-conflict')).toBe(true);
  });
});
