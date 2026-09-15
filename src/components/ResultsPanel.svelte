<script lang="ts">
  import { bench } from '../lib/store';
  import type { Project, SolveResult } from '../lib/types';

  let result: SolveResult | null = null;
  bench.result.subscribe((r) => (result = r));
  let project: Project;
  bench.project.subscribe((p) => (project = p));
  let showValues = true;
  bench.showValues.subscribe((v) => (showValues = v));

  const fmt = (x: number | undefined) => (x !== undefined && Number.isFinite(x) ? Number(x.toPrecision(5)).toString() : '—');

  const compType = (t: string) => (t === 'resistor' ? '电阻' : t === 'voltage' ? '电压源' : '电流源');
  const compValue = (c: { type: string; r?: number; vs?: number; is?: number }) =>
    c.type === 'resistor' ? `${c.r} Ω` : c.type === 'voltage' ? `${c.vs} V` : `${c.is} A`;
</script>

<div class="results">
  <h3>结果与功率平衡</h3>
  <label class="toggle">
    <input type="checkbox" bind:checked={showValues} on:change={() => bench.showValues.set(showValues)} />
    在图上叠加电压/电流
  </label>

  {#if !result?.ok}
    <p class="bad">求解未完成：请先处理诊断中的错误。电路保持可编辑，修改后会自动重试。</p>
  {:else}
    <div class="cards">
      <div class="card">
        <span>KCL 残差</span>
        <b>{result.kclResidual.toExponential(1)} A</b>
      </div>
      <div class="card gen">
        <span>电源供出</span>
        <b>{fmt(result.powerGenerated)} W</b>
      </div>
      <div class="card dis">
        <span>电阻消耗</span>
        <b>{fmt(result.powerDissipated)} W</b>
      </div>
      <div class="card" class:bad={Math.abs(result.powerMismatch) > 1e-6}>
        <span>功率失配</span>
        <b>{result.powerMismatch.toExponential(1)} W</b>
      </div>
    </div>

    <details open>
      <summary>节点电压（对地）</summary>
      <table>
        <thead>
          <tr><th>接点</th><th>电压 V</th></tr>
        </thead>
        <tbody>
          {#each project.nodes as n}
            <tr>
              <td>{n.ground ? '⏚ ' : ''}{n.id}</td>
              <td>{fmt(result.nodeVoltages[n.id])}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </details>

    <details open>
      <summary>元件 v / i / p（约定：v = V(p)−V(q)，i 方向 p→q，p 吸收 = v·i）</summary>
      <table>
        <thead>
          <tr><th>编号</th><th>类型</th><th>设定</th><th>v (V)</th><th>i (A)</th><th>P 吸收 (W)</th></tr>
        </thead>
        <tbody>
          {#each project.components as c}
            {@const cr = result.components.find((r) => r.id === c.id)}
            <tr class:indet={cr?.note}>
              <td>{c.id}</td>
              <td>{compType(c.type)}</td>
              <td>{compValue(c)}</td>
              <td>{fmt(cr?.v)}</td>
              <td>{fmt(cr?.i)}</td>
              <td>{fmt(cr?.pAbsorbed)}</td>
            </tr>
            {#if cr?.note}
              <tr class="note-row"><td colspan="6">注：{cr.note}</td></tr>
            {/if}
          {/each}
        </tbody>
      </table>
      <p class="hint">P 吸收为负表示该元件实际向外供出功率；所有元件 ΣP 应为 0（Tellegen 定理）。</p>
    </details>
  {/if}
</div>

<style>
  .results {
    padding: 10px 12px;
  }
  h3 {
    margin: 0 0 8px;
    font-size: 13px;
  }
  .toggle {
    font-size: 12px;
    display: flex;
    gap: 6px;
    align-items: center;
    margin-bottom: 8px;
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 6px;
    margin-bottom: 8px;
  }
  .card {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    font-size: 11px;
    color: #64748b;
  }
  .card b {
    font-size: 14px;
    color: #0f172a;
  }
  .card.gen b {
    color: #15803d;
  }
  .card.dis b {
    color: #b45309;
  }
  .card.bad b {
    color: #dc2626;
  }
  details {
    margin-bottom: 8px;
  }
  summary {
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
    margin-bottom: 4px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
  }
  th,
  td {
    border-bottom: 1px solid #e2e8f0;
    padding: 3px 4px;
    text-align: right;
  }
  th:first-child,
  td:first-child,
  th:nth-child(2),
  td:nth-child(2) {
    text-align: left;
  }
  tr.indet td {
    color: #d97706;
  }
  .note-row td {
    font-size: 10px;
    color: #d97706;
    text-align: left;
    background: #fffbeb;
  }
  .hint {
    font-size: 10px;
    color: #94a3b8;
    margin: 4px 0 0;
  }
  .bad {
    color: #b91c1c;
    font-size: 12px;
  }
</style>
