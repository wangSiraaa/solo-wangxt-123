<script lang="ts">
  import { bench } from '../lib/store';
  import type { Project } from '../lib/types';

  let project: Project;
  bench.project.subscribe((p) => (project = p));
  let savedAt: number | null = null;
  bench.savedAt.subscribe((v) => (savedAt = v));
  let saveError: string | null = null;
  bench.saveError.subscribe((v) => (saveError = v));
  let live = true;
  bench.liveSolve.subscribe((v) => (live = v));
</script>

<header class="bar">
  <div class="brand">DC Bench · 直流电阻网络工作台</div>
  <input class="name" value={project.name} on:change={(e) => bench.rename(e.currentTarget.value)} />

  <div class="group">
    <span class="caption">载入示例：</span>
    <button on:click={bench.examples.bridge}>惠斯通电桥</button>
    <button on:click={bench.examples.series}>串联电源</button>
    <button on:click={bench.examples.conflict}>矛盾电压源</button>
    <button on:click={bench.examples.currentConflict}>串联异值电流源</button>
  </div>

  <div class="spacer"></div>

  <label class="live" title="关闭后可在已知失败状态下继续编辑而不重算">
    <input type="checkbox" bind:checked={live} on:change={() => bench.liveSolve.set(live)} />
    实时求解
  </label>
  <button on:click={bench.newProject}>新建工程</button>
  <span class="save" class:err={!!saveError}>
    {saveError ?? (savedAt ? `已存入 IndexedDB · ${new Date(savedAt).toLocaleTimeString()}` : '自动保存中…')}
  </span>
</header>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    background: #0f172a;
    color: #e2e8f0;
  }
  .brand {
    font-weight: 700;
    font-size: 14px;
    white-space: nowrap;
  }
  .name {
    background: #1e293b;
    border: 1px solid #334155;
    color: #f1f5f9;
    border-radius: 4px;
    padding: 4px 8px;
    width: 150px;
    font-size: 12px;
  }
  .group {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .caption {
    font-size: 11px;
    color: #94a3b8;
  }
  button {
    background: #1e293b;
    border: 1px solid #334155;
    color: #e2e8f0;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 11px;
    cursor: pointer;
  }
  button:hover {
    background: #334155;
  }
  .spacer {
    flex: 1;
  }
  .live {
    font-size: 11px;
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .save {
    font-size: 10px;
    color: #94a3b8;
    white-space: nowrap;
  }
  .save.err {
    color: #fca5a5;
  }
</style>
