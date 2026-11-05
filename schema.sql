CREATE TABLE IF NOT EXISTS site_leads (
  id TEXT PRIMARY KEY,
  created TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  first_name TEXT,
  last_name TEXT,
  situs TEXT,
  county TEXT,
  state TEXT,
  apn TEXT,
  acres TEXT,
  data TEXT NOT NULL,
  ip_hash TEXT,
  ua TEXT,
  country TEXT,
  synced INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_site_leads_created ON site_leads(created);
CREATE INDEX IF NOT EXISTS idx_site_leads_ip ON site_leads(ip_hash, created);
CREATE INDEX IF NOT EXISTS idx_site_leads_email ON site_leads(email, situs);
CREATE INDEX IF NOT EXISTS idx_site_leads_synced ON site_leads(synced);
