/*
# Add performance indexes

1. Plain-English explanation
- Adds database indexes that speed up the most frequent queries of the app
  (lookups by BT report, account and pendencies) without changing any data.
- Adds a unique index on bt_reports.numero (BT number) ONLY if no duplicate
  numbers exist; if duplicates are found, the unique index is skipped with a
  NOTICE and the migration still succeeds.

2. New indexes
- bt_reports(data) — orders BTs by date (latest BT, previous BT, chain).
- transactions(bt_report_id, account_id, ordem) — saldo chain recalculation
  and per-account transaction listing.
- payments_pending(bt_report_id) — pendência snapshot queries.
- pendency_resolutions(bt_report_id) — pendência resolution timeline.
- bt_convenios(bt_report_id) — convênio snapshot per BT.

3. Modified tables
- None (indexes only; no columns, rows or policies changed).

4. Security changes
- None. Indexes do not affect RLS or grants.

5. Important notes
- All statements are idempotent (IF NOT EXISTS / conditional DO block).
- The unique index on bt_reports.numero is created only when
  (SELECT count(*) FROM (SELECT numero FROM bt_reports GROUP BY numero HAVING count(*) > 1) d) = 0.
*/

CREATE INDEX IF NOT EXISTS idx_bt_reports_data ON bt_reports (data);

CREATE INDEX IF NOT EXISTS idx_transactions_bt_acc_ordem
  ON transactions (bt_report_id, account_id, ordem);

CREATE INDEX IF NOT EXISTS idx_payments_pending_bt ON payments_pending (bt_report_id);

CREATE INDEX IF NOT EXISTS idx_pendency_resolutions_bt ON pendency_resolutions (bt_report_id);

CREATE INDEX IF NOT EXISTS idx_bt_convenios_bt ON bt_convenios (bt_report_id);

DO $$
DECLARE
  dup_count integer;
BEGIN
  SELECT count(*) INTO dup_count
  FROM (
    SELECT numero FROM bt_reports GROUP BY numero HAVING count(*) > 1
  ) d;

  IF dup_count > 0 THEN
    RAISE NOTICE 'Índice único em bt_reports(numero) pulado: % numero(s) duplicado(s) encontrado(s).', dup_count;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS idx_bt_reports_numero_unique ON bt_reports (numero);
  END IF;
END $$;
