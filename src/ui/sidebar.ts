import type { Clique } from '../types';

/**
 * Render the "Chains" sidebar: one entry per clique (size > 2) showing its color
 * badge, top keywords, year range and lead author. Ports the sidebar generation
 * from the original index.html. `onSelect`/`onHover` receive the clique's index
 * in the full array so it lines up with GraphView.highlightClique.
 */
export function renderSidebar(
  container: HTMLElement,
  cliques: Clique[],
  onSelect: (index: number) => void,
  onClear: () => void,
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
    el.addEventListener('click', () => onSelect(index));
    el.addEventListener('mouseleave', onClear);
    container.appendChild(el);
  }
}
