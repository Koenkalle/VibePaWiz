import './style.css';
import { detectCliques } from './graph/cliques';
import { expand } from './graph/expand';
import { GraphModel } from './graph/model';
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
const layoutSel = $<HTMLSelectElement>('layout');
const collapseInput = $<HTMLInputElement>('collapse');
const collapseShow = $<HTMLElement>('collapseShow');
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
let controller: AbortController | null = null;
let rerenderTimer: number | undefined;

const view = new GraphView($('cy'), { onExpandNode: extendFrom, onRerootNode: reroot });

// --- Settings <-> controls ---
function readSettings(): Settings {
  return {
    layers: Number(layersInput.value),
    direction: directionSel.value as Direction,
    colors: colorsInput.checked,
    layout: layoutSel.value as LayoutName,
    collapse: Number(collapseInput.value),
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
function rerender(): void {
  const settings = readSettings();
  const nodeIds = model.getNodes().map((n) => n.id);
  const cliques: Clique[] = detectCliques(
    nodeIds,
    model.getEdges(),
    (id) => model.getNode(id),
    settings.collapse,
  );
  view.render(model, cliques, settings);
  renderSidebar(
    cliqueListEl,
    cliques,
    (i) => view.highlightClique(i),
    () => view.clearHighlight(),
  );
}

function scheduleRerender(): void {
  if (rerenderTimer != null) return;
  rerenderTimer = window.setTimeout(() => {
    rerenderTimer = undefined;
    rerender();
  }, 500);
}

function flushRerender(): void {
  if (rerenderTimer != null) {
    clearTimeout(rerenderTimer);
    rerenderTimer = undefined;
  }
  rerender();
}

// --- Expansion flows ---
async function runExpansion(id: string, layers: number): Promise<void> {
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
      onUpdate: scheduleRerender,
    });
    setStatus(`Done — ${model.nodeCount()} papers, ${model.getEdges().length} citations.`);
  } catch (err) {
    setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (controller === mine) {
      controller = null;
      setRunning(false);
    }
    flushRerender();
  }
}

async function newGraph(id: string): Promise<void> {
  seedId = id;
  model.clear();
  history.clear();
  renderHistory();
  await runExpansion(id, readSettings().layers);
}

async function extendFrom(id: string): Promise<void> {
  snapshot();
  await runExpansion(id, 2);
}

async function reroot(id: string): Promise<void> {
  snapshot();
  seedId = id;
  model.clear();
  await runExpansion(id, readSettings().layers);
}

// --- History ---
function snapshot(): void {
  if (model.nodeCount() === 0) return;
  history.push(model.serialize(providerId, seedId, readSettings()));
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
    for (const w of works) {
      const opt = document.createElement('option');
      opt.value = w.id;
      opt.textContent = `${w.title}${w.year ? ` (${w.year})` : ''}`;
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
  model.load(graph);
  flushRerender();
  setStatus(`Loaded ${graph.nodes.length} papers.`);
}

function currentSerialized(): SerializedGraph {
  return model.serialize(providerId, seedId, readSettings());
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
    flushRerender();
  });
  colorsInput.addEventListener('change', flushRerender);
  layoutSel.addEventListener('change', flushRerender);
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
setStatus('Ready. Search an author to begin.');
void loadFromUrl();
