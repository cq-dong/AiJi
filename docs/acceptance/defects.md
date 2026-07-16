# Wave 3 Acceptance — Defects

Date: 2026-07-16 (pass 1) · 2026-07-17 (pass 2 — re-verify after fixes)
Verifier: review-wave3 (acceptance + code-review agent)
Scope: Wave 3 (7 user-feedback items) — capture toolbar/camera/voice/title/draft, summary reverse-chrono + 5-level detail, reminders full page, nav top-search, settings cleanup.
Method: static line-level review + full E2E browser verification at 390×844 via cloudflared tunnel on chrome-devtools-mcp. DEV BYOK keys live (real DeepSeek LLM + DashScope STT).

## Summary verdict (pass 2 — all defects fixed, all areas LGTM)

| area | verdict | notes |
|------|---------|-------|
| capture | LGTM | toolbar 4 btn / SaveBar 3 btn / title edit / 清空 confirm / draft save→restore→clear-on-save verified E2E; D2 a11y fix confirmed (no console warnings) |
| summary | LGTM | scope tabs, reverse-chrono, 5-level selector, badge, recompute all work; D1 fix confirmed — verbosity now scales: L1=1 / L3=3 / L5=7 sentences (live DeepSeek) |
| reminders | LGTM | 3 sections + count + empty placeholders + missed items render; D3 fix confirmed — snooze sets 'snoozed', chip shows "已稍后", due +10min, DB persisted |
| shared (store/types/ports/adapters/db) | LGTM | draft CRUD + detailLevel plumbing + recompute guard correct; typecheck green |
| nav + top search | LGTM | 5 tabs (no 搜索), search icon top-right → /search, /capture is BareLayout |
| settings | LGTM | no 提醒与待办 row; both AI rows green 已配置 |
| regression | LGTM | home / categories / detail all render, zero console errors |

Defect count: 0 open (3 fixed). No P0/P1 blockers.

## Defects (by severity)

### D1 — Summary verbosity does not scale with detail level (LLM ignores sentence-count instruction) — FIXED

- **status:** FIXED (pass 2, 2026-07-17)
- **area:** summary
- **file:** `src/adapters/deepSeekLlm.ts:105-146` (LEVELS array + buildAggregatePrompt), `:91-95` (AggregateResult), `:267` (sentences join)
- **severity:** P2 (was major product-experience gap; code plumbing was already correct)
- **trigger:**
  1. Go to /summary, any scope (day/week/month).
  2. Note the summary text at level 3 (标准, prompt asks "3 句话").
  3. Switch to level 4 (详细, prompt asks "4-5 句话") or 5 (详尽, "6 句以上").
  4. Wait for recompute (~10-30s live LLM).
- **expected:** Higher detail level produces visibly more summary sentences; 详尽 should be markedly longer than 极简.
- **actual:** The summary stays ~1 sentence at every level. Spot-check 7/14 (4 entries): level 3 = 1 sentence (~60 chars), level 4 = 1 sentence (~98 chars) — same sentence count, marginally longer. Highlights DO scale (level 4 yields 1-5 highlights, matching the prompt's "3-5 条"), but the summary sentence count — the primary verbosity signal — does not.
- **root cause:** DeepSeek does not honor the "N 句话" instruction in `buildAggregatePrompt`; the LEVELS array (`deepSeekLlm.ts:105-111`) encodes expected sentence counts but the model returns a single compound sentence. The plumbing (detailLevel passed to `di.llm.aggregate`, stored on `Aggregate.detailLevel`, badge reads `?? 3`, recompute guard treats level mismatch as stale) is all correct — this is a prompt-engineering issue, not a code bug.
- **fix direction:** Strengthen the prompt to force sentence count — e.g. "必须输出恰好 N 个完整句子，用句号分隔" + few-shot per level; or restructure to request a JSON `{"sentences":[...]}` array of exactly N strings and join on render. Validate on 2-3 levels before shipping.
- **verified via:** DB query confirms `Aggregate.detailLevel` and `highlights.length` scale correctly; the gap is summary text only.
- **screenshot?:** no (text evidence above)

**Pass 2 re-verification (FIXED):** Prompt restructured to `{"sentences":string[], "highlights":string[]}` with exact count N per level (L1=1, L2=2, L3=3, L4=5, L5=7); adapter joins sentences into summary with fallback. Live DeepSeek recompute on day 7/14 (4 entries), sentence count by 。:
- L1 (极简): 1 sentence — "今日围绕记忆外包理念，捕获生活片段与阅读灵感，并探索 AiJi 的涌现分类机制。" ✓ (expected 1)
- L3 (标准): 3 sentences — "今日思考围绕记忆外包…AiJi 项目推进分类涌现机制…穿插生活记录（桂花拿铁），整体偏理念与工程思考。" ✓ (expected 3)
- L5 (详尽): 7 sentences, 6 highlights ✓ (expected 7 sentences / 5-7 highlights)
Verbosity now scales materially with level. Fix confirmed. (Minor nit, not a defect: at L1 the LLM returned 4 highlights despite the "0 条（空数组）" instruction — highlights-at-L1 is cosmetic and out of D1's summary-verbosity scope.)

---

### D2 — a11y: capture form fields lack id/name attribute — FIXED

- **status:** FIXED (pass 2, 2026-07-17)
- **area:** capture
- **file:** `src/ui/screens/capture/widgets.tsx:109-110` (title input name/aria-label), `:522-523` (textarea name/aria-label)
- **severity:** P3 (nit, was pre-existing)
- **trigger:** Open /capture, open the text sheet or edit the title; observe browser console.
- **expected:** Form fields have an id or name for a11y / form-label association.
- **actual:** Console issue logged: "A form field element should have an id or name attribute (count: 2)". The title `<input>` and text `<textarea>` have only `placeholder`/`aria-label`, no `id`/`name`.
- **fix direction:** Add `name` (e.g. `name="capture-title"`, `name="capture-text"`) or an `id`. Low priority.
- **screenshot?:** no

**Pass 2 re-verification (FIXED):** `name="captureTitle"` + `aria-label="条目标题"` added to title input; `name="captureText"` + `aria-label="条目内容"` added to textarea. Opened /capture, opened text sheet + entered title-edit mode: zero a11y console warnings (was "count: 2"). DOM query confirmed textarea renders with name/aria-label. Fix confirmed.

---

### D3 — snoozed status is dead code; snoozed reminders mislabeled as 待提醒 — FIXED

- **status:** FIXED (pass 2, 2026-07-17)
- **area:** reminders
- **file:** `src/app/store.ts:458` (snoozeReminder status 'snoozed'), `:128,140` (scheduleReminders treats snoozed as schedulable); UI `src/ui/screens/reminders/index.tsx:50-51,18` now reachable
- **severity:** P3 (nit, was pre-existing B5 design surfaced in new Wave 3 screen)
- **trigger:** Snooze a pending reminder (稍后提醒 button); observe the reminders list.
- **expected:** The snoozed reminder shows a distinct "已稍后" chip so the user sees it was snoozed.
- **actual:** `snoozeReminder` (store.ts:457) deliberately keeps status as 'pending' (comment: "status stays 'pending'…B5 逻辑用 pending 统一调度"). So the reminders screen's `r.status === 'snoozed'` filter branch (index.tsx:51) and `STATUS_LABELS['已稍后']` (index.tsx:18) are unreachable — a snoozed reminder shows chip "待提醒" identical to a normal pending one. The "已稍后" label is dead.
- **fix direction:** Either (a) actually set status 'snoozed' in snoozeReminder + adjust `scheduleReminders` to treat 'snoozed' like 'pending' for timeout scheduling, or (b) remove the dead 'snoozed' branch + label to avoid confusion. Low priority — cosmetic.
- **note:** No pending reminders existed during E2E (both seed reminders auto-marked missed, >1h overdue), so snooze/取消 buttons were not live-exercised. Structure confirmed via static review.
- **screenshot?:** no

**Pass 2 re-verification (FIXED):** `snoozeReminder` now sets `status: 'snoozed'` (store.ts:458); `scheduleReminders` treats 'snoozed' as schedulable (lines 128, 140). Inserted a pending reminder (rm-test, due +30min) into IndexedDB, reloaded /reminders: appeared in 待提醒 with chip "待提醒". Clicked 稀后提醒 → chip changed to "已稍后", due time jumped 00:31→00:41 (+10min). DB query confirmed `status: 'snoozed'` + `dueAt` +10min persisted. The dead 'snoozed' branch + "已稍后" label are now live. Fix confirmed. (Test reminder cleaned up after.)

---

## Not a defect — verification notes

### N1 — Voice/camera not runtime-verified (environment limitation)
getUserMedia hangs in the headless chrome-devtools-mcp browser (no mic/camera hardware), so the non-fullscreen VoiceBar + InterimBubble couldn't be live-tested. Static review confirms the wiring: `recording` state → `<VoiceBar>` footer renders (capture/index.tsx:228), `<InterimBubble>` renders inline during recording (capture/index.tsx:212), parts list stays visible. CameraView photo↔video toggle statically confirmed (widgets.tsx:644-660). **Recommend manual verification on a real device** (per PRD §7.4 A1/A2).

### N2 — Tunnel flakiness
The cloudflared tunnel intermittently times out on navigation (>10s). This caused some navigate calls to report timeout even though the page eventually loaded. All E2E checks were completed by re-snapshotting after the timeout. Not an app defect.

### N3 — Subagent collision check: clean
`git diff --name-only` confirms modified files are exactly the Wave 3 scope: capture/{index,widgets}.tsx, summary/{index,DigestCard,aggregate}.tsx, settings/index.tsx (lead), and shared-layer files (lead). The only new untracked source file is `src/ui/screens/reminders/index.tsx` (T3's own dir). No subagent touched another's screen dir or out-of-scope shared files. No collision-rule violations.

### N4 — TypeScript strictness: clean
`npx tsc -p tsconfig.app.json` exits 0 (no errors). `import type` used for all type-only imports; no enum/namespace/ctor-param-props; no unused vars flagged.
