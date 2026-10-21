import { useRef, useState } from 'react';
import { Download, Upload, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button } from './ui/Field';

const TABLES = [
  'bt_reports',
  'accounts',
  'convenios',
  'convenio_sources',
  'transactions',
  'revenue_own',
  'subalinhas',
  'cheques',
  'deposits_pending',
  'reconciliation',
] as const;

export function exportBackup(): Promise<void> {
  return (async () => {
    const backup: Record<string, unknown> = { __version: 1 };
    for (const table of TABLES) {
      const { data, error } = await supabase.from(table).select('*');
      if (error) throw new Error(`Falha ao exportar ${table}: ${error.message}`);
      backup[table] = data || [];
    }
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup-boletim-tesouraria-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  })();
}

interface RestoreBackupProps {
  onDone: (message: string, ok: boolean) => void;
}

export function RestoreBackup({ onDone }: RestoreBackupProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [restoring, setRestoring] = useState(false);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRestoring(true);
    try {
      const text = await file.text();
      const backup = JSON.parse(text) as Record<string, unknown[]>;
      if (!backup.bt_reports || !Array.isArray(backup.bt_reports)) {
        throw new Error('Arquivo inválido: não contém dados de bt_reports.');
      }

      // Ordem respeita dependências (pai antes de filho)
      for (const table of [...TABLES].reverse()) {
        const rows = backup[table];
        if (!Array.isArray(rows) || rows.length === 0) continue;
        // Limpa a tabela antes de reinserir (upsert por id mantém chaves)
        await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
        const { error } = await supabase.from(table).upsert(rows, { onConflict: 'id' });
        if (error) throw new Error(`Falha ao restaurar ${table}: ${error.message}`);
      }

      onDone('Backup restaurado com sucesso!', true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido ao restaurar.';
      onDone(msg, false);
    } finally {
      setRestoring(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={handleFile}
      />
      <Button variant="secondary" onClick={() => inputRef.current?.click()} disabled={restoring}>
        <Upload className="w-4 h-4" /> {restoring ? 'Restaurando...' : 'Restaurar Backup'}
      </Button>
    </>
  );
}

export function BackupRestoreSection() {
  const [message, setMessage] = useState('');
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleExport = async () => {
    setBusy(true);
    setMessage('');
    try {
      await exportBackup();
      setMessage('Backup exportado com sucesso!');
      setOk(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao exportar backup.';
      setMessage(msg);
      setOk(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
        <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
        <p className="text-xs text-amber-700">
          A restauração substitui todos os dados atuais pelos dados do arquivo. Faça um backup antes de restaurar.
        </p>
      </div>
      <div className="flex gap-2">
        <Button onClick={handleExport} disabled={busy}>
          <Download className="w-4 h-4" /> {busy ? 'Exportando...' : 'Exportar Backup'}
        </Button>
        <RestoreBackup onDone={(msg, success) => { setMessage(msg); setOk(success); }} />
      </div>
      {message && (
        <p className={`text-sm font-medium ${ok ? 'text-emerald-600' : 'text-red-600'}`}>{message}</p>
      )}
    </div>
  );
}
