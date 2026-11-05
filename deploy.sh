#!/usr/bin/env bash
# Deploy land-desk-engine to Cloudflare through the REST API.
# Auth: the session's network secret attaches "Authorization: Bearer <token>" to api.cloudflare.com.
# No token is stored here or in the environment.
set -euo pipefail
cd "$(dirname "$0")"
A=a62c145b5fa2a12f3b6dd64ab5422610
API=https://api.cloudflare.com/client/v4
NAME=land-desk-engine
HOSTS=(ccinvgroup.com www.ccinvgroup.com ccinvland.com www.ccinvland.com ccinvholdings.com www.ccinvholdings.com)
cf(){ curl -sS --max-time 60 "$@"; }
ok(){ python3 -c 'import json,sys; d=json.load(sys.stdin); print(json.dumps(d.get("errors"))) if not d.get("success") else None; sys.exit(0 if d.get("success") else 1)'; }

echo "1/5 token check"; cf "$API/user/tokens/verify" | ok || cf "$API/accounts/$A/tokens/verify" | ok

echo "2/5 D1 database"
DB=$(cf "$API/accounts/$A/d1/database?name=land-desk" | python3 -c 'import json,sys; r=json.load(sys.stdin)["result"]; print(r[0]["uuid"] if r else "")')
if [ -z "$DB" ]; then
  DB=$(cf -X POST "$API/accounts/$A/d1/database" -H 'content-type: application/json' -d '{"name":"land-desk"}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["uuid"])')
fi
echo "   DB=$DB"; echo "$DB" > .d1_id
python3 -c 'import json; print(json.dumps({"sql": open("schema.sql").read()}))' | cf -X POST "$API/accounts/$A/d1/database/$DB/query" -H 'content-type: application/json' -d @- | ok

echo "3/5 build + upload worker"
python3 build.py >/dev/null
META=$(python3 -c "import json; print(json.dumps({'main_module':'worker.js','compatibility_date':'2026-10-01','bindings':[{'type':'d1','name':'DB','id':'$DB'}],'observability':{'enabled':True}}))")
cf -X PUT "$API/accounts/$A/workers/scripts/$NAME" \
  -F "metadata=$META;type=application/json" \
  -F "worker.js=@src/worker.js;type=application/javascript+module" \
  -F "pages/index.html=@src/pages/index.html;type=text/plain" \
  -F "pages/privacy.html=@src/pages/privacy.html;type=text/plain" \
  -F "pages/terms.html=@src/pages/terms.html;type=text/plain" \
  -F "pages/404.html=@src/pages/404.html;type=text/plain" | ok

echo "4/5 custom domains"
if [ "${WITH_DOMAINS:-0}" != 1 ]; then
  echo "   skipped (token has no zone permissions) — attach domains in dashboard: Workers & Pages → $NAME → Settings → Domains & Routes"
  HOSTS=()
fi
for H in "${HOSTS[@]}"; do
  ZN=${H#www.}
  Z=$(cf "$API/zones?name=$ZN" | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"][0]["id"])')
  # A custom domain can't share its name with an existing A/AAAA/CNAME record.
  CONFLICT=$(cf "$API/zones/$Z/dns_records?name=$H" | python3 -c 'import json,sys; print(" ".join(r["type"] for r in json.load(sys.stdin)["result"] if r["type"] in ("A","AAAA","CNAME")))')
  [ -n "$CONFLICT" ] && echo "   $H has existing $CONFLICT record(s) — skipping, needs review" && continue
  cf -X PUT "$API/accounts/$A/workers/domains" -H 'content-type: application/json' \
    -d "{\"hostname\":\"$H\",\"service\":\"$NAME\",\"zone_id\":\"$Z\",\"environment\":\"production\"}" | ok && echo "   $H ✓"
done

echo "5/5 live check (certificates can take a few minutes)"
for i in $(seq 1 20); do
  C=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 https://ccinvgroup.com/api/health || true)
  [ "$C" = 200 ] && echo "   https://ccinvgroup.com is live" && exit 0
  sleep 15
done
echo "   not reachable from this session yet (DNS/cert pending, or ccinvgroup.com not in allowed domains)"
