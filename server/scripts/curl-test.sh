#!/usr/bin/env bash
# AiJi 后端本机验证脚本。用法：cd server && bash scripts/curl-test.sh
# 需要 .env 里填好 JWT_SECRET/REFRESH_SECRET（DEEPSEEK_KEY/DASHSCOPE_KEY 可空，LLM/STT 路由会 502）。
set -uo pipefail
BASE="${BASE:-http://localhost:8787}"
PASS=0; FAIL=0
check() { local name="$1" cond="$2"; if eval "$cond"; then echo "  ✓ $name"; PASS=$((PASS+1)); else echo "  ✗ $name [cond: $cond]"; FAIL=$((FAIL+1)); fi; }

echo "=== auth ==="
EMAIL="test_$(date +%s)@aiji.test"
R=$(curl -s -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}")
echo "$R" | head -c 200; echo
check "register 返 account+session" "[[ \"\$R\" == *\"account\"* && \"\$R\" == *\"session\"* && \"\$R\" == *\"jwt\"* ]]"
JWT=$(echo "$R" | node -pe "JSON.parse(process.argv[1]||'{}').session?.jwt" "$R" 2>/dev/null)
REFRESH=$(echo "$R" | node -pe "JSON.parse(process.argv[1]||'{}').session?.refreshToken" "$R" 2>/dev/null)
check "register jwt 非空" "[ -n \"\$JWT\" ]"

# 重复注册 → 409
R2=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}")
check "重复注册 409" "[ \"\$R2\" = \"409\" ]"

# 短密码 → 400
R3=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' -d "{\"email\":\"x@y.z\",\"password\":\"123\"}")
check "短密码 400" "[ \"\$R3\" = \"400\" ]"

# 错密码 → 401
R4=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"wrongpassword\"}")
check "错密码 401" "[ \"\$R4\" = \"401\" ]"

# 正常登录 → 200
R5=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}")
check "正常登录 200" "[ \"\$R5\" = \"200\" ]"

echo "=== refresh ==="
# refresh → 新 session
RR=$(curl -s -X POST "$BASE/api/auth/refresh" -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$REFRESH\"}")
NEWJWT=$(echo "$RR" | node -pe "JSON.parse(process.argv[1]||'{}').session?.jwt" "$RR" 2>/dev/null)
check "refresh 返新 jwt" "[ -n \"\$NEWJWT\" ]"
check "refresh 返 account" "[[ \"\$RR\" == *\"account\"* ]]"

# 旧 refresh 失效 → 401
R6=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/auth/refresh" -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$REFRESH\"}")
check "旧 refresh 失效 401" "[ \"\$R6\" = \"401\" ]"

echo "=== quota + plans ==="
RQ=$(curl -s "$BASE/api/quota" -H "Authorization: Bearer $NEWJWT")
echo "$RQ" | head -c 200; echo
check "quota 返字段" "[[ \"\$RQ\" == *\"llmUsed\"* && \"\$RQ\" == *\"resetAt\"* ]]"
check "quota 无 JWT 401" "[ \"\$(curl -s -o /dev/null -w '%{http_code}' \$BASE/api/quota)\" = \"401\" ]"

RP=$(curl -s "$BASE/api/plan")
check "plans 返数组" "[[ \"\$RP\" == *\"free\"* && \"\$RP\" == *\"yearly\"* ]]"

echo "=== llm ==="
RL=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/llm/chat" -H "Authorization: Bearer $NEWJWT" -H 'Content-Type: application/json' -d '{"messages":[{"role":"user","content":"ping"}]}')
check "llm 路由可达（200/502，非 401/500）" "[ \"\$RL\" = \"200\" -o \"\$RL\" = \"502\" ]"

echo "=== logout ==="
RO=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/auth/logout" -H "Authorization: Bearer $NEWJWT" -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$NEWJWT\"}")
check "logout 200" "[ \"\$RO\" = \"200\" ]"

echo "=== health ==="
RH=$(curl -s "$BASE/health")
check "health ok" "echo \"\$RH\" | grep -q '\"ok\":true'"

echo ""
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]
