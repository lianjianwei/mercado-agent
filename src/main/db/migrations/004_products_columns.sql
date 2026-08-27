-- Persist the Miaoshou collect-box list columns on the workbench row so the
-- list can show category, net profit, stock, sites and source price without
-- re-fetching. All nullable: a detail-driven sync (syncOne) does not know these
-- list-only fields and must not clobber values a list-driven sync stored.
ALTER TABLE products ADD COLUMN breadcrumb TEXT;
ALTER TABLE products ADD COLUMN global_price TEXT;
ALTER TABLE products ADD COLUMN stock TEXT;
ALTER TABLE products ADD COLUMN sites TEXT;
ALTER TABLE products ADD COLUMN price TEXT;
