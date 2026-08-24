#!/usr/bin/env bash
# 云端同步冒烟：register → push → 再 push 旧时间戳(应 rejected) → tombstone 覆盖(应胜)。
# 用法：BASE=http://localhost:8787 bash scripts/sync-test.sh
set -euo pipefail
BASE="${BASE:-http://localhost:8787}"
EMAIL="synctest_$(date +%s)@test.com"
JWT=$(curl -s -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"synctest123\"}" | python3 -c 'import json,sys;print(json.load(sys.stdin)["session"]["jwt"])')
echo "JWT ok ($EMAIL)"

echo '--- push entry ---'
curl -s -X POST "$BASE/api/sync/push" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d '{
  "changes":[{"kind":"entry","id":"e1","payload":{"entry":{"id":"e1","createdAt":"2026-08-08T01:00:00.000Z","updatedAt":"2026-08-08T01:00:00.000Z","parts":[{"type":"text","content":"hello"}],"status":"ready"},"ai":null},"updatedAt":"2026-08-08T01:00:00.000Z"}]
}' | tee /tmp/sync_push1.json | python3 -c 'import json,sys;d=json.load(sys.stdin);assert d["applied"]==1 and not d["rejected"],d;print("applied=1 ok")'

echo '--- push stale (older updatedAt, expect rejected) ---'
curl -s -X POST "$BASE/api/sync/push" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d '{
  "changes":[{"kind":"entry","id":"e1","payload":{"entry":{"id":"e1"},"ai":null},"updatedAt":"2026-08-07T01:00:00.000Z"}]
}' | python3 -c 'import json,sys;d=json.load(sys.stdin);assert d["applied"]==0 and len(d["rejected"])==1,d;print("stale rejected ok")'

echo '--- tombstone wins over newer non-tombstone ---'
curl -s -X POST "$BASE/api/sync/push" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d '{
  "changes":[{"kind":"entry","id":"e1","updatedAt":"2026-08-07T02:00:00.000Z","deletedAt":"2026-08-07T02:00:00.000Z"}]
}' | python3 -c 'import json,sys;d=json.load(sys.stdin);assert d["applied"]==1,d;print("tombstone applied ok")'

echo '--- non-tombstone never beats tombstone (even with newer ts) ---'
curl -s -X POST "$BASE/api/sync/push" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d '{
  "changes":[{"kind":"entry","id":"e1","payload":{"entry":{"id":"e1"},"ai":null},"updatedAt":"2026-08-09T01:00:00.000Z"}]
}' | python3 -c 'import json,sys;d=json.load(sys.stdin);assert d["applied"]==0 and len(d["rejected"])==1,d;print("tombstone held ok")'

echo '--- pull since=0 sees tombstone ---'
curl -s "$BASE/api/sync/pull?since=0" -H "Authorization: Bearer $JWT" | python3 -c '
import json,sys
d=json.load(sys.stdin)
assert d["hasMore"] is False and d["cursor"] > 0, d
e1=[c for c in d["changes"] if c["id"]=="e1"]
assert e1 and e1[-1]["deletedAt"], d
print("pull ok, cursor=%s" % d["cursor"])'

echo '--- pull since=cursor returns empty ---'
CUR=$(curl -s "$BASE/api/sync/pull?since=0" -H "Authorization: Bearer $JWT" | python3 -c 'import json,sys;print(json.load(sys.stdin)["cursor"])')
curl -s "$BASE/api/sync/pull?since=$CUR" -H "Authorization: Bearer $JWT" | python3 -c 'import json,sys;d=json.load(sys.stdin);assert d["changes"]==[] and d["hasMore"] is False,d;print("incremental empty ok")'

echo '--- status ---'
curl -s "$BASE/api/sync/status" -H "Authorization: Bearer $JWT" | python3 -c 'import json,sys;d=json.load(sys.stdin);assert d["usedBytes"]==0 and d["limitBytes"]==-1,d;print("status ok (trial=-1)")'

echo '--- media upload/download roundtrip ---'
printf 'fake-image-bytes-0808' > /tmp/sync_media.bin
curl -s -X PUT "$BASE/api/sync/media/refabc123" -H "Authorization: Bearer $JWT" -H 'Content-Type: image/jpeg' --data-binary @/tmp/sync_media.bin | python3 -c 'import json,sys;d=json.load(sys.stdin);assert d["ok"] and d["size"]==21,d;print("upload ok")'
curl -s "$BASE/api/sync/media/refabc123" -H "Authorization: Bearer $JWT" | cmp - /tmp/sync_media.bin && echo "download bytes identical"
curl -s "$BASE/api/sync/status" -H "Authorization: Bearer $JWT" | python3 -c 'import json,sys;d=json.load(sys.stdin);assert d["usedBytes"]==21,d;print("usage=21 ok")'

echo '--- media appears in pull feed ---'
curl -s "$BASE/api/sync/pull?since=0" -H "Authorization: Bearer $JWT" | python3 -c 'import json,sys;d=json.load(sys.stdin);m=[c for c in d["changes"] if c["kind"]=="media" and c["id"]=="refabc123"];assert m and m[0]["payload"]["size"]==21,d;print("media in feed ok")'

echo '--- media tombstone deletes file + frees quota ---'
curl -s -X POST "$BASE/api/sync/push" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d '{"changes":[{"kind":"media","id":"refabc123","updatedAt":"2026-08-08T03:00:00.000Z","deletedAt":"2026-08-08T03:00:00.000Z"}]}' | python3 -c 'import json,sys;d=json.load(sys.stdin);assert d["applied"]==1,d;print("media tombstone applied")'
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/sync/media/refabc123" -H "Authorization: Bearer $JWT")
[ "$CODE" = "404" ] && echo "gone ok" || { echo "expected 404 got $CODE"; exit 1; }
curl -s "$BASE/api/sync/status" -H "Authorization: Bearer $JWT" | python3 -c 'import json,sys;d=json.load(sys.stdin);assert d["usedBytes"]==0,d;print("usage freed ok")'

echo '--- unauth 401 ---'
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/sync/push" -H 'Content-Type: application/json' -d '{"changes":[]}')
[ "$CODE" = "401" ] && echo "401 ok" || { echo "expected 401 got $CODE"; exit 1; }

echo '--- delete account cascades sync rows + media dir ---'
curl -s -X PUT "$BASE/api/sync/media/refdel1" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/octet-stream' --data-binary 'x' > /dev/null
curl -s -X POST "$BASE/api/account/delete" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d '{"password":"synctest123"}' | python3 -c 'import json,sys;assert json.load(sys.stdin)["ok"];print("deleted")'
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/sync/pull?since=0" -H "Authorization: Bearer $JWT")
[ "$CODE" = "401" ] && echo "sync rows unreachable (user gone) ok" || { echo "expected 401 got $CODE"; exit 1; }
echo 'ALL SYNC TESTS PASSED'
