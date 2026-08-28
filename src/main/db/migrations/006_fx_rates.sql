-- USD reference-rate cache used by the net-profit calculator. Refreshed from
-- open.er-api.com on app start and on demand; the app falls back to the last
-- stored snapshot (or built-in defaults) while offline.
CREATE TABLE fx_rates (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
) STRICT;
