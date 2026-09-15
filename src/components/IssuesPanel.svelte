<script lang="ts">
  import { bench } from '../lib/store';
  import type { CircuitIssue } from '../lib/types';

  let issues: CircuitIssue[] = [];
  bench.result.subscribe((r) => (issues = r?.issues ?? []));

  function focus(issue: CircuitIssue) {
    const ids = new Set<string>([...(issue.componentIds ?? []), ...(issue.nodeIds ?? [])]);
    bench.highlightIds.set(ids);
    // 3 秒后自动取消高亮
    setTimeout(() => {
      const cur = bench.highlightIds;
      // 简单清除（仅在没有新选择时）
      cur.set(new Set());
    }, 3000);
  }

  const icon: Record<string, string> = {
    error: '⛔',
    warning: '⚠️'
  };
</script>

<div class="issues">
  <h3>诊断（{issues.filter((i) => i.severity === 'error').length} 错误 / {issues.filter((i) => i.severity === 'warning').length} 警告）</h3>
  {#if issues.length === 0}
    <p class="ok">✓ 未发现约束冲突或拓扑问题</p>
  {/if}
  {#each issues as issue}
    <button class="issue {issue.severity}" on:click={() => focus(issue)}>
      <span class="ic">{icon[issue.severity]}</span>
      <span class="msg">
        {issue.message}
        {#if issue.constraint}
          <code>{issue.constraint}</code>
        {/if}
      </span>
    </button>
  {/each}
</div>

<style>
  .issues {
    padding: 10px 12px;
    border-bottom: 1px solid #e2e8f0;
    max-height: 240px;
    overflow: auto;
  }
  h3 {
    margin: 0 0 8px;
    font-size: 13px;
  }
  .ok {
    color: #15803d;
    font-size: 12px;
    margin: 4px 0;
  }
  .issue {
    display: flex;
    gap: 8px;
    width: 100%;
    text-align: left;
    background: none;
    border: 0;
    border-left: 3px solid transparent;
    padding: 6px 8px;
    cursor: pointer;
    font-size: 12px;
    line-height: 1.5;
  }
  .issue:hover {
    background: #f1f5f9;
  }
  .issue.error {
    border-left-color: #dc2626;
    color: #7f1d1d;
  }
  .issue.warning {
    border-left-color: #d97706;
    color: #78350f;
  }
  .ic {
    flex-shrink: 0;
  }
  code {
    display: block;
    margin-top: 3px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 4px;
    padding: 2px 6px;
    font-size: 11px;
    color: #0f172a;
  }
</style>
