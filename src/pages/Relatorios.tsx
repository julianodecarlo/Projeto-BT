import { useEffect, useState } from 'react';
import { FileText, Download, Eye, FilePlus, Pencil } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useBt } from '@/context/BtContext';
import { Card, Button, Badge, EmptyState } from '@/components/ui/Field';
import { formatDate } from '@/lib/format';
import { generateAndDownloadPdf, previewPdf } from '@/lib/pdf';
import type { BtReport } from '@/types';
import Modal from '@/components/ui/Modal';
import type { PageKey } from '@/components/Sidebar';

interface RelatoriosProps {
  onNavigate?: (page: PageKey) => void;
}

export default function Relatorios({ onNavigate }: RelatoriosProps) {
  const { currentBt, setCurrentBt } = useBt();
  const [allBts, setAllBts] = useState<BtReport[]>([]);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('bt_reports')
        .select('*')
        .order('data', { ascending: false });
      if (data) setAllBts(data as BtReport[]);
    })();
  }, [currentBt]);

  const handleDownload = async (bt: BtReport) => {
    setLoading(true);
    await generateAndDownloadPdf(bt.id);
    setLoading(false);
  };

  const handlePreview = async (bt: BtReport) => {
    setLoading(true);
    const html = await previewPdf(bt.id);
    setLoading(false);
    if (html) {
      setPreviewHtml(html);
      setPreviewTitle(`BT ${bt.numero} - ${formatDate(bt.data)}`);
    }
  };

  const handleEdit = (bt: BtReport) => {
    setCurrentBt(bt);
    onNavigate?.('movimentacao');
  };

  return (
    <div className="p-6 space-y-4">
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <FileText className="w-5 h-5 text-blue-600" />
          <div>
            <h3 className="text-sm font-bold text-slate-800">Relatórios de BT</h3>
            <p className="text-xs text-slate-500 mt-0.5">Visualize, exporte em PDF e edite Boletins de Tesouraria anteriores</p>
          </div>
        </div>

        {allBts.length === 0 ? (
          <EmptyState icon={FilePlus} title="Nenhum BT encontrado" description="Crie um novo Boletim de Tesouraria para gerar relatórios." />
        ) : (
          <div className="space-y-2">
            {allBts.map(bt => (
              <div key={bt.id} className="flex items-center justify-between py-3 px-4 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors group">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
                    <FileText className="w-5 h-5 text-slate-500" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-800">BT {bt.numero}</p>
                    <p className="text-xs text-slate-500">{formatDate(bt.data)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge color={bt.status === 'fechado' ? 'green' : bt.status === 'validado' ? 'amber' : 'slate'}>
                    {bt.status === 'fechado' ? 'Fechado' : bt.status === 'validado' ? 'Validado' : 'Rascunho'}
                  </Badge>
                  <Button size="sm" variant="ghost" onClick={() => handleEdit(bt)} title="Abrir e editar">
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => handlePreview(bt)} disabled={loading}>
                    <Eye className="w-3.5 h-3.5" /> Visualizar
                  </Button>
                  <Button size="sm" onClick={() => handleDownload(bt)} disabled={loading}>
                    <Download className="w-3.5 h-3.5" /> PDF
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Preview modal */}
      <Modal open={!!previewHtml} onClose={() => setPreviewHtml(null)} title={previewTitle} maxWidth="max-w-4xl">
        {previewHtml && (
          <iframe
            srcDoc={previewHtml}
            className="w-full h-[70vh] border border-slate-200 rounded-lg"
            title="Preview"
          />
        )}
      </Modal>
    </div>
  );
}
