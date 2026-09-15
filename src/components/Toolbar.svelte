<script lang="ts">
  import { bench, type Tool } from '../lib/store';

  let tool: Tool;
  bench.tool.subscribe((v) => (tool = v));

  const tools: { id: Tool; label: string; hint: string }[] = [
    { id: 'select', label: '选择/拖动', hint: 'V' },
    { id: 'node', label: '接点', hint: 'N' },
    { id: 'ground', label: '参考地', hint: 'G' },
    { id: 'wire', label: '导线', hint: 'W' },
    { id: 'resistor', label: '电阻 R', hint: 'R' },
    { id: 'voltage', label: '电压源 V', hint: 'Shift+V' },
    { id: 'current', label: '电流源 I', hint: 'I' },
    { id: 'delete', label: '删除', hint: 'X' }
  ];

  const shortcuts: Record<string, Tool> = {
    v: 'select',
    n: 'node',
    g: 'ground',
    w: 'wire',
    r: 'resistor',
    i: 'current',
    x: 'delete'
  };

  function onKey(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const key = e.shiftKey && e.key === 'V' ? 'voltage' : shortcuts[e.key];
    if (key) bench.tool.set(key);
  }
</script>

<svelte:window on:keydown={onKey} />

<div class="toolbar">
  {#each tools as t}
    <button
      class="tool"
      class:active={tool === t.id}
      title={t.label}
      on:click={() => bench.tool.set(t.id)}
    >
      {t.label}
      <span class="key">{t.hint}</span>
    </button>
  {/each}
</div>

<style>
  .toolbar {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    padding: 8px 12px;
    background: #0f172a;
  }
  .tool {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    border: 1px solid #334155;
    background: #1e293b;
    color: #e2e8f0;
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 12px;
    cursor: pointer;
    min-width: 64px;
  }
  .tool:hover {
    background: #334155;
  }
  .tool.active {
    background: #2563eb;
    border-color: #60a5fa;
  }
  .key {
    font-size: 10px;
    color: #94a3b8;
  }
</style>
