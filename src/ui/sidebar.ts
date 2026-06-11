import type { Clique } from '../types';

export interface SidebarHandlers {
  /** Hover an entry — glow the chain without zooming. */
  onHover: (index: number) => void;
  /** Click an entry — glow the chain and zoom to fit it. */
  onSelect: (index: number) => void;
  /** Pointer left an entry — clear the glow. */
  onClear: () => void;
}

/**
 * Render the "Chains" sidebar: one entry per clique (size > 2) showing its color
 * badge, top keywords, year range and lead author. Ports the sidebar generation
 * from the original index.html. Handlers receive the clique's index in the full
 * array so it lines up with GraphView.highlightChains.
 */
export function renderSidebar(
  container: HTMLElement,
  cliques: Clique[],
  handlers: SidebarHandlers,
): void {
  container.innerHTML = '';
  const interesting = cliques
    .map((clique, index) => ({ clique, index }))
    .filter(({ clique }) => clique.nodes.length > 2);

  if (interesting.length === 0) {
    container.innerHTML =
      '<p class="muted">No multi-paper chains yet. Build or expand the graph.</p>';
    return;
  }

  for (const { clique, index } of interesting) {
    const el = document.createElement('div');
    el.className = 'clique';
    const keywords = clique.keywords.filter(Boolean).join(', ');
    const years =
      clique.earliestYear != null ? `${clique.earliestYear} – ${clique.latestYear}` : '';
    const lead = clique.topAuthors[0];
    const leadStr = lead ? `${lead[0]} (${lead[1]}/${clique.nodes.length})` : '';
    el.innerHTML = `
      <span class="clique-badge" style="background:${clique.color}">${clique.nodes.length}</span>
      <b>${keywords}</b>
      <div class="muted">${years}</div>
      <div class="muted">${leadStr}</div>`;
    el.addEventListener('mouseenter', () => handlers.onHover(index));
    el.addEventListener('mouseleave', () => handlers.onClear());
    el.addEventListener('click', () => handlers.onSelect(index));
    container.appendChild(el);
  }
}
