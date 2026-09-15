<script lang="ts">
  import { bench } from '../lib/store';
  import type { CircuitNode, Component, Project, Wire } from '../lib/types';

  let sel: { kind: string; id: string } | null = null;
  bench.selection.subscribe((v) => (sel = v));

  let project: Project;
  bench.project.subscribe((v) => (project = v));

  let node: CircuitNode | null = null;
  let comp: Component | null = null;
  let wire: Wire | null = null;
  $: node = sel?.kind === 'node' ? project.nodes.find((n) => n.id === sel!.id) ?? null : null;
  $: comp = sel?.kind === 'component' ? project.components.find((c) => c.id === sel!.id) ?? null : null;
  $: wire = sel?.kind === 'wire' ? project.wires.find((w) => w.id === sel!.id) ?? null : null;

  let rVal = 100;
  let vVal = 5;
  let iVal = 1;
  $: if (comp?.type === 'resistor') rVal = comp.r;
  $: if (comp?.type === 'voltage') vVal = comp.vs;
  $: if (comp?.type === 'current') iVal = comp.is;
</script>

<div class="inspector">
  <h3>属性</h3>
  {#if !sel}
    <p class="hint">点选元件、接点或导线后在此编辑。</p>
  {:else if node}
    <div class="row"><span class="lab">接点</span><b>{node.id}</b></div>
    <div class="row"><span class="lab">坐标</span>{node.x.toFixed(0)}, {node.y.toFixed(0)}</div>
    <label class="check">
      <input type="checkbox" checked={!!node.ground} on:change={() => bench.toggleGround(node.id)} />
      设为参考地（全电路唯一）
    </label>
    <button class="danger" on:click={() => bench.deleteNode(node.id)}>删除接点</button>
  {:else if comp}
    <div class="row">
      <span class="lab">编号</span><b>{comp.id}</b>
    </div>
    <div class="row small">
      {#if comp.type === 'resistor'}
        <label>
          阻值 R (Ω)
          <input
            type="number"
            step="any"
            bind:value={rVal}
            on:change={() => bench.updateComponentValue(comp.id, 'r', Number(rVal))}
          />
        </label>
      {:else if comp.type === 'voltage'}
        <label>
          电压 Vs (V)，约束 V(p)−V(q) = Vs
          <input
            type="number"
            step="any"
            bind:value={vVal}
            on:change={() => bench.updateComponentValue(comp.id, 'vs', Number(vVal))}
          />
        </label>
      {:else}
        <label>
          电流 Is (A)，方向 p → q
          <input
            type="number"
            step="any"
            bind:value={iVal}
            on:change={() => bench.updateComponentValue(comp.id, 'is', Number(iVal))}
          />
        </label>
      {/if}
    </div>
    <div class="row small polar">
      <span>极性/方向：p(+) → q(−)</span>
      <button on:click={() => bench.flipComponent(comp.id)}>翻转极性</button>
    </div>
    <div class="row small">
      端子 p：{comp.p.startsWith('__loose') ? '悬空' : comp.p} ｜ q：
      {comp.q.startsWith('__loose') ? '悬空' : comp.q}
    </div>
    <button class="danger" on:click={() => bench.deleteComponent(comp.id)}>删除元件</button>
  {:else if wire}
    <div class="row"><span class="lab">导线</span><b>{wire.id}</b></div>
    <div class="row small">{wire.startNode ?? '悬空'} → {wire.endNode ?? '悬空'}</div>
    <p class="hint">导线交叉不会导通；仅两端落在接点上才建立电气连接。</p>
    <button class="danger" on:click={() => bench.deleteWire(wire.id)}>删除导线</button>
  {/if}
</div>

<style>
  .inspector {
    padding: 10px 12px;
    border-bottom: 1px solid #e2e8f0;
  }
  h3 {
    margin: 0 0 8px;
    font-size: 13px;
    color: #0f172a;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    font-size: 12px;
  }
  .row.small {
    flex-direction: column;
    align-items: stretch;
  }
  .lab {
    color: #64748b;
    min-width: 44px;
  }
  .polar {
    align-items: center;
    justify-content: space-between;
    flex-direction: row;
  }
  input[type='number'] {
    width: 100%;
    padding: 4px 6px;
    border: 1px solid #cbd5e1;
    border-radius: 4px;
    font-size: 13px;
  }
  .check {
    display: flex;
    gap: 6px;
    font-size: 12px;
    align-items: center;
    margin-bottom: 8px;
  }
  .hint {
    font-size: 11px;
    color: #94a3b8;
    margin: 4px 0;
  }
  button {
    padding: 4px 10px;
    border: 1px solid #cbd5e1;
    background: #f8fafc;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  }
  .danger {
    border-color: #fca5a5;
    color: #b91c1c;
    background: #fef2f2;
  }
</style>
