import './style.css';
import { detectCliques } from './graph/cliques';
import { breakCycles } from './graph/cycles';
import { expand } from './graph/expand';
import { GraphModel } from './graph/model';
import { visibleNodes } from './graph/visibility';
import { DEFAULT_PROVIDER_ID, getProvider, providers } from './providers/registry';
import type { CitationProvider } from './providers/types';
import { LocalCache, withCache } from './state';
import type { Clique, Direction, LayoutName, Settings } from './types';
import { buildShareUrl, downloadJson, parseImport, readUrlParams } from './ui/importExport';
import { History } from './ui/history';
import { renderSidebar } from './ui/sidebar';
import { fetchJson } from './providers/http';
import type { SerializedGraph } from './types';
import { GraphView } from './viz/cytoscape';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
};

// --- DOM handles ---
const providerSel = $<HTMLSelectElement>('provider');
const authorInput = $<HTMLInputElement>('author');
const searchButton = $<HTMLButtonElement>('searchButton');
const authorMatch = $<HTMLSelectElement>('authorMatch');
const paperSel = $<HTMLSelectElement>('paper');
const expandButton = $<HTMLButtonElement>('expandButton');
const layersInput = $<HTMLInputElement>('layers');
const layersShow = $<HTMLElement>('layersShow');
const directionSel = $<HTMLSelectElement>('direction');
const progressEl = $<HTMLElement>('progress');
const stopButton = $<HTMLButtonElement>('stopButton');
const colorsInput = $<HTMLInputElement>('colors');
const yearOrderInput = $<HTMLInputElement>('yearOrder');
const prioritizeChainsInput = $<HTMLInputElement>('prioritizeChains');
const simplifyInput = $<HTMLInputElement>('simplifyChains');
const mergeStyleInput = $<HTMLSelectElement>('mergeStyle');
const layoutSel = $<HTMLSelectElement>('layout');
const collapseInput = $<HTMLInputElement>('collapse');
const collapseShow = $<HTMLElement>('collapseShow');
const collapseStyleSel = $<HTMLSelectElement>('collapseStyle');
const historyEl = $<HTMLElement>('history');
const cliqueListEl = $<HTMLElement>('cliqueList');
const dataInput = $<HTMLTextAreaElement>('dataInput');
const exportButton = $<HTMLButtonElement>('exportButton');
const importButton = $<HTMLButtonElement>('importButton');
const shareButton = $<HTMLButtonElement>('shareButton');
const clearCacheButton = $<HTMLButtonElement>('clearCacheButton');
const statusBar = $<HTMLElement>('statusBar');

// --- App state ---
const cache = new LocalCache();
const model = new GraphModel();
const history = new History();
let providerId = DEFAULT_PROVIDER_ID;
let provider: CitationProvider = withCache(getProvider(providerId), cache);
let seedId: string | null = null;
/** Nodes the user explicitly clicked to expand (controls leaf visibility). */
let expanded = new Set<string>();
let controller: AbortController | null = null;
let rerenderTimer: number | undefined;
let lastRenderAt = 0;
let pendingFit = false;
/** Min gap between live re-renders while loading, so big graphs don't thrash. */
const RENDER_THROTTLE_MS = 1500;

const view = new GraphView($('cy'), { onExpandNode: extendFrom, onRerootNode: reroot });

// --- Settings <-> controls ---
function readSettings(): Settings {
  return {
    layers: Number(layersInput.value),
    direction: directionSel.value as Direction,
    colors: colorsInput.checked,
    layout: layoutSel.value as LayoutName,
    collapse: Number(collapseInput.value),
    yearOrder: yearOrderInput.checked,
    prioritizeChains: prioritizeChainsInput.checked,
    simplifyChains: simplifyInput.checked,
    mergeStyle: mergeStyleInput.value as Settings['mergeStyle'],
    collapseStyle: collapseStyleSel.value as Settings['collapseStyle'],
  };
}

function writeSettings(s: Settings): void {
  layersInput.value = String(s.layers);
  layersShow.textContent = String(s.layers);
  directionSel.value = s.direction;
  colorsInput.checked = s.colors;
  layoutSel.value = s.layout;
  collapseInput.value = String(s.collapse);
  collapseShow.textContent = String(s.collapse);
  yearOrderInput.checked = s.yearOrder ?? true;
  prioritizeChainsInput.checked = s.prioritizeChains ?? true;
  simplifyInput.checked = s.simplifyChains ?? true;
  mergeStyleInput.value = s.mergeStyle ?? 'split';
  collapseStyleSel.value = s.collapseStyle ?? 'ratio';
  updateLayoutControls();
}

/** Year ordering only applies to the layered (hierarchical) layouts. */
function updateLayoutControls(): void {
  const force = layoutSel.value === 'fcose';
  yearOrderInput.disabled = force;
  prioritizeChainsInput.disabled = force;
}

function setStatus(msg: string): void {
  statusBar.textContent = msg;
}

function setProgress(loaded: number, total: number): void {
  progressEl.textContent = `${loaded} expanded / ${total} papers`;
}

function setRunning(running: boolean): void {
  stopButton.disabled = !running;
  expandButton.disabled = running;
}

// --- Rendering ---
// `fit` re-centers the viewport; false keeps the user's current pan/zoom.
function rerender(fit: boolean): void {
  const settings = readSettings();
  const nodeIds = model.getNodes().map((n) => n.id);
  // Break citation cycles before any structural calculation, dropping each cycle's
  // most anti-chronological edge. `kept` feeds every later step; `removed` is shown
  // by the view but excluded from clique detection, columns, ordering and layout.
  const { kept, removed } = breakCycles(nodeIds, model.getEdges(), (id) => model.getNode(id)?.year);
  const cliques: Clique[] = detectCliques(
    nodeIds,
    kept,
    (id) => model.getNode(id),
    settings.collapse,
    settings.mergeStyle,
    settings.collapseStyle,
  );
  // Visibility still counts every real connection (incl. removed edges) so a cycle's
  // papers stay on screen and the removed edge can be drawn between them.
  const visible = visibleNodes(model, cliques, expanded, seedId);
  view.render(model, cliques, settings, visible, fit, seedId, removed);
  renderSidebar(cliqueListEl, cliques, {
    onHover: (i) => view.highlightChains([i], false),
    onSelect: (i) => view.highlightChains([i], true),
    onClear: () => view.clearHighlight(),
  });
}

function doRender(): void {
  if (rerenderTimer != null) {
    clearTimeout(rerenderTimer);
    rerenderTimer = undefined;
  }
  lastRenderAt = Date.now();
  const fit = pendingFit;
  pendingFit = false;
  rerender(fit);
}

/**
 * Throttle live re-renders during loading: render immediately if enough time has
 * passed since the last one, otherwise batch (many nodes load before one render).
 * `fit` requests sticky so a fit isn't lost while batching.
 */
function scheduleRerender(fit: boolean): void {
  pendingFit = pendingFit || fit;
  if (rerenderTimer != null) return;
  const elapsed = Date.now() - lastRenderAt;
  if (elapsed >= RENDER_THROTTLE_MS) doRender();
  else rerenderTimer = window.setTimeout(doRender, RENDER_THROTTLE_MS - elapsed);
}

function flushRerender(fit: boolean): void {
  pendingFit = pendingFit || fit;
  doRender();
}

// --- Expansion flows ---
async function runExpansion(id: string, layers: number, fit: boolean): Promise<void> {
  controller?.abort();
  controller = new AbortController();
  const mine = controller;
  setRunning(true);
  setStatus('Loading…');
  try {
    await expand(model, {
      provider,
      seedId: id,
      layers,
      direction: readSettings().direction,
      signal: mine.signal,
      onProgress: (p) => setProgress(p.loaded, p.total),
      onUpdate: () => scheduleRerender(fit),
    });
    setStatus(`Done — ${model.nodeCount()} papers, ${model.getEdges().length} citations.`);
  } catch (err) {
    setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (controller === mine) {
      controller = null;
      setRunning(false);
    }
    flushRerender(fit);
  }
}

async function newGraph(id: string): Promise<void> {
  seedId = id;
  expanded = seedExpansionSet(id);
  model.clear();
  history.clear();
  renderHistory();
  view.resetViewportTracking(); // an explicit Build is allowed to re-fit
  await runExpansion(id, readSettings().layers, true);
}

/**
 * Whether to treat the seed as already-expanded for visibility. In references
 * mode the seed's references are the point (and low-volume), so show them even
 * as degree-1 leaves. In citers mode keep the declutter — a paper can have huge
 * numbers of citers, and showing every non-chained one from the root is noise.
 */
function seedExpansionSet(id: string): Set<string> {
  return readSettings().direction === 'references' ? new Set([id]) : new Set();
}

async function extendFrom(id: string): Promise<void> {
  snapshot();
  // Mark this node as explicitly expanded so its direct citers become visible.
  expanded.add(id);
  // Keep the viewport where it is when expanding by click.
  await runExpansion(id, 2, false);
}

async function reroot(id: string): Promise<void> {
  snapshot();
  seedId = id;
  expanded = seedExpansionSet(id);
  model.clear();
  view.resetViewportTracking();
  await runExpansion(id, readSettings().layers, true);
}

// --- History ---
function snapshot(): void {
  if (model.nodeCount() === 0) return;
  history.push(model.serialize(providerId, seedId, readSettings(), [...expanded]));
  renderHistory();
}

function renderHistory(): void {
  history.render(historyEl, (i) => {
    const graph = history.restoreTo(i);
    if (graph) applyGraph(graph);
    renderHistory();
  });
}

// --- Provider / author / paper pickers ---
function setProvider(id: string): void {
  providerId = id;
  provider = withCache(getProvider(id), cache);
}

function fillProviders(): void {
  for (const p of providers) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.label;
    providerSel.appendChild(opt);
  }
  providerSel.value = providerId;
}

async function search(): Promise<void> {
  const query = authorInput.value.trim();
  if (!query) return;
  setStatus('Searching authors…');
  authorMatch.innerHTML = '';
  paperSel.innerHTML = '';
  try {
    const hits = await provider.searchAuthors(query);
    if (hits.length === 0) {
      setStatus('No authors found.');
      return;
    }
    for (const hit of hits) {
      const opt = document.createElement('option');
      opt.value = hit.id;
      opt.textContent = hit.hint ? `${hit.name} — ${hit.hint}` : hit.name;
      authorMatch.appendChild(opt);
    }
    setStatus(`${hits.length} authors. Pick a match, then a paper.`);
    await loadWorks(authorMatch.value);
  } catch (err) {
    setStatus(`Search failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function loadWorks(authorId: string): Promise<void> {
  if (!authorId) return;
  setStatus('Loading papers…');
  paperSel.innerHTML = '';
  try {
    const works = await provider.worksByAuthor(authorId);
    // Newest first; papers without a year sort to the end.
    works.sort((a, b) => (b.year ?? -Infinity) - (a.year ?? -Infinity));
    for (const w of works) {
      const opt = document.createElement('option');
      opt.value = w.id;
      const year = w.year ? ` (${w.year})` : '';
      const cites = w.citedByCount != null ? ` · ${w.citedByCount} citations` : '';
      opt.textContent = `${w.title}${year}${cites}`;
      paperSel.appendChild(opt);
    }
    setStatus(`${works.length} papers. Choose one and click "Build graph".`);
  } catch (err) {
    setStatus(`Failed to load papers: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// --- Import / export / share ---
function applyGraph(graph: SerializedGraph): void {
  setProvider(graph.providerId);
  providerSel.value = providerId;
  writeSettings(graph.settings);
  seedId = graph.seedId;
  expanded = new Set(graph.expanded ?? []);
  model.load(graph);
  view.resetViewportTracking();
  flushRerender(true);
  setStatus(`Loaded ${graph.nodes.length} papers.`);
}

function currentSerialized(): SerializedGraph {
  return model.serialize(providerId, seedId, readSettings(), [...expanded]);
}

async function loadFromUrl(): Promise<void> {
  const { inline, remoteUrl } = readUrlParams();
  if (inline) {
    applyGraph(inline);
    return;
  }
  if (remoteUrl) {
    try {
      setStatus('Loading shared graph…');
      const graph = await fetchJson<SerializedGraph>(remoteUrl);
      applyGraph(graph);
    } catch (err) {
      setStatus(`Could not load ?data= graph: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// --- Wire up events ---
function bindEvents(): void {
  providerSel.addEventListener('change', () => setProvider(providerSel.value));
  searchButton.addEventListener('click', () => void search());
  authorInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void search();
  });
  authorMatch.addEventListener('change', () => void loadWorks(authorMatch.value));
  expandButton.addEventListener('click', () => {
    if (paperSel.value) void newGraph(paperSel.value);
  });
  layersInput.addEventListener('input', () => (layersShow.textContent = layersInput.value));
  collapseInput.addEventListener('input', () => {
    collapseShow.textContent = collapseInput.value;
    flushRerender(false);
  });
  // Display toggles keep the current viewport; switching layout re-fits.
  colorsInput.addEventListener('change', () => flushRerender(false));
  yearOrderInput.addEventListener('change', () => flushRerender(false));
  prioritizeChainsInput.addEventListener('change', () => flushRerender(false));
  simplifyInput.addEventListener('change', () => flushRerender(false));
  mergeStyleInput.addEventListener('change', () => flushRerender(false));
  collapseStyleSel.addEventListener('change', () => flushRerender(false));
  layoutSel.addEventListener('change', () => {
    updateLayoutControls();
    view.resetViewportTracking();
    flushRerender(true);
  });
  stopButton.addEventListener('click', () => controller?.abort());

  exportButton.addEventListener('click', () => {
    dataInput.value = JSON.stringify(currentSerialized());
    downloadJson(currentSerialized());
  });
  importButton.addEventListener('click', () => {
    const graph = parseImport(dataInput.value);
    if (graph) applyGraph(graph);
    else setStatus('Import failed: not a valid VibePaWiz graph.');
  });
  shareButton.addEventListener('click', async () => {
    const url = buildShareUrl(currentSerialized());
    try {
      await navigator.clipboard.writeText(url);
      setStatus('Share link copied to clipboard.');
    } catch {
      dataInput.value = url;
      setStatus('Share link placed in the text box (clipboard blocked).');
    }
  });
  clearCacheButton.addEventListener('click', () => {
    cache.clear();
    setStatus('Cache cleared.');
  });
}

// --- Boot ---
fillProviders();
renderHistory();
bindEvents();
updateLayoutControls();
setStatus('Ready. Search an author to begin.');
void loadFromUrl();
