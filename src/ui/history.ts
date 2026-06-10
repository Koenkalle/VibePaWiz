import type { SerializedGraph } from '../types';

interface Snapshot {
  graph: SerializedGraph;
  label: string;
}

/**
 * Undo history of graph snapshots. Each expansion pushes a deep copy; clicking a
 * chip restores that state and truncates everything after it. Ports the
 * graphHistory / goBackInTime behavior from the original.
 */
export class History {
  private stack: Snapshot[] = [];

  push(graph: SerializedGraph): void {
    this.stack.push({ graph: structuredClone(graph), label: `#${this.stack.length + 1}` });
  }

  /** Restore the snapshot at `index`, dropping it and any later snapshots. */
  restoreTo(index: number): SerializedGraph | undefined {
    const snap = this.stack[index];
    if (!snap) return undefined;
    this.stack = this.stack.slice(0, index);
    return structuredClone(snap.graph);
  }

  clear(): void {
    this.stack = [];
  }

  render(container: HTMLElement, onRestore: (index: number) => void): void {
    container.innerHTML = '';
    if (this.stack.length === 0) {
      container.innerHTML = '<span class="muted">No history yet.</span>';
      return;
    }
    this.stack.forEach((snap, index) => {
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.textContent = snap.label;
      chip.title = `Restore to ${snap.label} (${snap.graph.nodes.length} papers)`;
      chip.addEventListener('click', () => onRestore(index));
      container.appendChild(chip);
    });
  }
}
