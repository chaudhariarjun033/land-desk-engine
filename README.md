# land-desk-engine
Cloudflare Worker for ccinvgroup.com (Chaudhari Investments LLC): website + seller form → D1 (`site_leads`).
- Deploy: Cloudflare Workers Builds from this repo (`npx wrangler deploy`). D1 `land-desk` auto-provisions on first deploy.
- Pages are prebuilt into `src/pages/` by `build.py` from the site source.
- `/api/lead` (POST) form intake · `/api/health` · `/api/admin/*` Land Desk sync (x-admin-key).
