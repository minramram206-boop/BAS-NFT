const EFFECT_DURATION_MS = 800;

/**
 * Shows a short "+1 LABEL" pop above `target`. Rendered outside React because
 * it is fire-and-forget and must not re-render the stat panel.
 */
export function spawnFloatingStatEffect(target: HTMLElement, label: string): void {
  if (typeof document === 'undefined') return;

  const rect = target.getBoundingClientRect();
  const effect = document.createElement('div');
  effect.className = 'floating-stat-fx';
  effect.textContent = `+1 ${label.toUpperCase()}`;
  effect.style.left = `${rect.left + rect.width / 2 - 20}px`;
  effect.style.top = `${rect.top - 10}px`;

  document.body.append(effect);
  setTimeout(() => effect.remove(), EFFECT_DURATION_MS);
}
