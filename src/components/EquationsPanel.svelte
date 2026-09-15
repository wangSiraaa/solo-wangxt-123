<script lang="ts">
  import { bench } from '../lib/store';
  import type { EqRow, SolveResult } from '../lib/types';

  let result: SolveResult | null = null;
  bench.result.subscribe((r) => (result = r));

  let project;
  bench.project.subscribe((p) => (project = p));

  // 变量名顺序与求解器 EqTerm.varIndex 严格对齐。
  const varName = (idx: number): string => result?.varNames[idx] ?? `x${idx}`;

  const fmt = (x: number) => {
    if (Math.abs(x) < 1e-12) return '0';
    return Number(x.toPrecision(4)).toString();
  };

  const termText = (coeff: number, name: string) => {
    const c = Math.abs(coeff - 1) < 1e-12 ? '' : Math.abs(coeff + 1) < 1e-12 ? '−' : fmt(coeff);
    return `${c}${name}`;
  };

  function trace(ids: string) {
    bench.highlightIds.set(new Set(ids.split(',')));
    setTimeout(() => bench.highlightIds.set(new Set()), 2500);
  }
</script>

<div class="eqpanel">
  <h3>修正节点方程（MNA）— 点击任一系数可在图上追到元件</h3>
  {#if !result}
    <p class="hint">已暂停求解。</p>
  {:else}
    <p class="hint">
      矩阵维度 {result.dimension}；KCL 残差
      <b class={result.ok ? 'ok' : 'bad'}>{result.kclResidual.toExponential(1)}</b> A。
      每项系数标注了盖章元件，电压源附加电流变量取 p→q 为正。
    </p>
    <div class="eqlist">
      {#each result.equations as eq, ri (eq.label + ri)}
        <div class="eqrow" class:vrow={eq.kind === 'voltage'}>
          <span class="label">{eq.label}</span>
          <span class="math">
            {#each eq.terms as term, ti}
              <button
                class="coeff"
                title={`来自元件: ${term.origin}`}
                on:click={() => trace(term.origin)}
              >
                {ti === 0 ? '' : term.coeff < 0 ? ' − ' : ' + '}{termText(
                  Math.abs(term.coeff),
                  varName(term.varIndex)
                )}
                <sub>{term.origin}</sub>
              </button>
            {/each}
            =
            <button class="rhs" title={`右端来源: ${eq.rhsOrigins.join(', ') || '（无）'}`}
              on:click={() => trace(eq.rhsOrigins.join(','))}>
              {fmt(eq.rhs)}{#if eq.rhsOrigins.length}<sub>{eq.rhsOrigins.join(',')}</sub>{/if}
            </button>
          </span>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .eqpanel {
    padding: 10px 12px;
    border-bottom: 1px solid #e2e8f0;
  }
  h3 {
    margin: 0 0 6px;
    font-size: 13px;
  }
  .hint {
    font-size: 11px;
    color: #64748b;
    margin: 0 0 8px;
  }
  .ok {
    color: #15803d;
  }
  .bad {
    color: #dc2626;
  }
  .eqlist {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 260px;
    overflow: auto;
  }
  .eqrow {
    display: flex;
    flex-direction: column;
    gap: 2px;
    background: #f8fafc;
    border-left: 3px solid #2563eb;
    padding: 6px 8px;
    border-radius: 4px;
  }
  .eqrow.vrow {
    border-left-color: #7c3aed;
    background: #faf5ff;
  }
  .label {
    font-size: 11px;
    color: #475569;
  }
  .math {
    font-size: 12px;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 2px;
  }
  .coeff,
  .rhs {
    border: 0;
    background: none;
    padding: 1px 3px;
    cursor: pointer;
    font-size: 12px;
    color: #0f172a;
    border-radius: 3px;
    font-family: inherit;
  }
  .coeff:hover,
  .rhs:hover {
    background: #dbeafe;
  }
  sub {
    color: #2563eb;
    font-size: 9px;
    margin-left: 1px;
  }
</style>
