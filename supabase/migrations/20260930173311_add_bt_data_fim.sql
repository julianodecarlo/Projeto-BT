/*
# BTs multi-dia: data_fim opcional

## Changes
- `bt_reports`: adds optional `data_fim` (end date) so a BT can cover a
  period larger than one day. When null, the BT is single-day (data only).
*/

ALTER TABLE bt_reports
  ADD COLUMN IF NOT EXISTS data_fim date;
