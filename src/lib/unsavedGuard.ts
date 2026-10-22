// Barreira global de navegação para alterações não salvas.
// Cada tela com edição pendente (Movimentações, Controle da Receita) registra
// um "saver": a própria tela salva seus dados quando a navegação pede.
// O menu lateral consulta hasDirtyOrigins() antes de trocar de aba.

export type UnsavedSaver = () => Promise<boolean>;

const savers = new Map<string, UnsavedSaver>();
const dirty = new Set<string>();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach(fn => fn());
}

export function setUnsavedSaver(origin: string, saver: UnsavedSaver): () => void {
  savers.set(origin, saver);
  return () => {
    if (savers.get(origin) === saver) savers.delete(origin);
  };
}

export function setUnsavedGuard(origin: string, isDirty: boolean): void {
  const had = dirty.size > 0;
  if (isDirty) dirty.add(origin);
  else dirty.delete(origin);
  if (had !== dirty.size > 0) notify();
}

export function hasUnsavedGuard(): boolean {
  return dirty.size > 0;
}

// Executa todos os savers registrados. Retorna true se tudo foi salvo.
export async function runUnsavedSavers(): Promise<boolean> {
  let ok = true;
  for (const saver of savers.values()) {
    const done = await saver();
    if (!done) ok = false;
  }
  if (ok) dirty.clear();
  notify();
  return ok;
}

// Descarta as edições pendentes (sem salvar) e libera a navegação.
export function discardUnsaved(): void {
  dirty.clear();
  notify();
}

export function subscribeUnsavedGuard(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
