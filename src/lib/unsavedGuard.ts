// Barreira global de navegação para alterações não salvas.
// A aba de lançamento registra quando há valores digitados ainda não salvos
// (setUnsavedGuard(true)); o menu lateral consulta antes de trocar de aba.
type GuardListener = () => void;

let hasUnsavedChanges = false;
const listeners = new Set<GuardListener>();

export function setUnsavedGuard(dirty: boolean): void {
  if (hasUnsavedChanges === dirty) return;
  hasUnsavedChanges = dirty;
  listeners.forEach(fn => fn());
}

export function hasUnsavedGuard(): boolean {
  return hasUnsavedChanges;
}

export function clearUnsavedGuard(): void {
  setUnsavedGuard(false);
}

export function subscribeUnsavedGuard(fn: GuardListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
