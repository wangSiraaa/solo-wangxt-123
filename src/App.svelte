<script lang="ts">
  import Header from './components/Header.svelte';
  import Toolbar from './components/Toolbar.svelte';
  import Schematic from './components/Schematic.svelte';
  import Inspector from './components/Inspector.svelte';
  import IssuesPanel from './components/IssuesPanel.svelte';
  import EquationsPanel from './components/EquationsPanel.svelte';
  import ResultsPanel from './components/ResultsPanel.svelte';
  import { bench } from './lib/store';
  import { listProjects } from './lib/db';
  import { bridgeExample } from './lib/examples';

  // 启动时恢复最近编辑的工程；IndexedDB 为空则载入电桥示例。
  listProjects()
    .then((all) => {
      if (all.length > 0) bench.load(all[0]);
      else bench.load(bridgeExample());
    })
    .catch(() => bench.load(bridgeExample()));
</script>

<Header />
<Toolbar />
<main>
  <section class="canvas-wrap">
    <Schematic />
  </section>
  <aside class="sidebar">
    <Inspector />
    <IssuesPanel />
    <EquationsPanel />
    <ResultsPanel />
  </aside>
</main>

<style>
  main {
    display: flex;
    flex: 1;
    min-height: 0;
  }
  .canvas-wrap {
    flex: 1;
    min-width: 0;
    position: relative;
  }
  .sidebar {
    width: 380px;
    flex-shrink: 0;
    background: #ffffff;
    border-left: 1px solid #cbd5e1;
    overflow-y: auto;
  }

  :global(html),
  :global(body),
  :global(#app) {
    height: 100%;
    margin: 0;
  }
  :global(#app) {
    display: flex;
    flex-direction: column;
    font-family:
      'Inter', system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
    color: #0f172a;
  }
  :global(*) {
    box-sizing: border-box;
  }
</style>
