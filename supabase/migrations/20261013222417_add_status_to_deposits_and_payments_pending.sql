ALTER TABLE deposits_pending ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pendente';
ALTER TABLE payments_pending ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pendente';

-- Itens que já receberam baixa via pendency_resolutions em qualquer BT
-- passam a carregar a baixa no próprio registro (permanente e global).
UPDATE deposits_pending d SET status = 'realizado'
WHERE EXISTS (SELECT 1 FROM pendency_resolutions r WHERE r.kind = 'deposito' AND r.ref_id = d.id);

UPDATE payments_pending p SET status = 'pago'
WHERE EXISTS (SELECT 1 FROM pendency_resolutions r WHERE r.kind = 'pagamento' AND r.ref_id = p.id);
