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

---

# Wave 4 / code-audit-v3 Acceptance — Defects

Date: 2026-07-17
Verifier: review-wave2 (acceptance agent; this is the post-`c9c5774` final gate for the GLM-5.2 code-audit-v3 remediation)
Scope: FULL e2e sweep of audit-touched shared layers + golden paths, per `docs/acceptance/code-audit-v3-fixes.md` FIXED/DEFERRED matrix. Viewport 390×844, chrome-devtools-mcp, dev server http://localhost:5173.
Method: navigate→act→assert→screenshot per path. TS self-check `npx tsc -p tsconfig.app.json` EXIT 0 (green).

## Summary verdict

All 7 regression paths + 5 golden paths exercised. Audit fixes behave correctly in browser where verifiable. **2 new defects found — both PRE-EXISTING (NOT regressions from audit fix c9c5774); both are gaps in the audit's scope, not failures of the audit's fixes.** Plus 1 environment blocker (expired dev key) that prevented live classify-WRITE verification.

| path | verdict | evidence |
|------|---------|---------|
| A2 onboarding gate | LGTM | navigated `/` with `onboarded:false` → redirected to `/onboarding`; `开始记` sets onboarded:true → lands on `/`. A5 `type="password"` on API key input confirmed via DOM. |
| A3 summary week label (ISO) | LGTM | week scope `本周 7/13–7/19` EXACTLY matches ISO week containing today 2026-07-17 (Thu). `上周 7/6–7/12` contiguous+correct. Day scope (7/17→7/4) + month scope (2026年7月→2月) labels track. No W00, no off-by-one. `shots/v3-summary-week-7-13-7-19.png` · `v3-summary-month-2026-7.png` |
| capture→save→classify→detail (D1/D7/D9/D11) | LGTM (partial) | Fresh capture saved → home. D7 confirmed: entry marked `处理失败` (NOT stuck `处理中`) after LLM 401. Detail AI panel renders 类别/标签/标题/摘要 on existing classified entry. D10 mutex bidirectional (ReminderConfirm only → clear → TodoConfirm shows). D11 suggestion clears synchronously. `shots/v3-detail-d10-mutex.png`. **Classify-WRITE path (D1/D3/D4) NOT live-verifiable — expired dev key, see E1.** |
| M12 reminders 清除 | LGTM | clicked 清除 on fired card → count 8→7, 已提醒 5→4, card vanished (dismissReminder). Separate navigate-button + 清除-button, no button-in-button. Zero console warnings. `shots/v3-reminders-clear-works.png` |
| M4/M5 export zip | LGTM (partial) | `导出 .zip` → `aiji-export.zip` (40 files: 33 entries/*.md + ai.json + manifest.json + 5 media). M5 hydrate guard structurally present (zipExport.ts:207,286 `if(!hydrated) await hydrate()`). M4 image branch untestable (no image parts in DB). **Found D5 (audio→.bin) below.** `shots/v3-settings-export.png` |
| A1 theme toggle | LGTM | 暗色 → `<html class="dark">`, bodyBg `rgb(17,17,21)`, bodyColor `rgb(255,255,255)`, CSS vars `--c-page:17 17 21`/`--c-ink:240 240 245`. 亮色 → class removed, vars restored `--c-page:247 247 250`/`--c-ink:20 20 26`. No flash. `shots/v3-theme-dark.png` |
| B1 drafts/trash reachable | LGTM | categories 草稿 card → `/drafts` (renders, no 404); 回收站 card → `/trash` (renders, no 404). |
| golden: home/categories/search/detail/capture | LGTM | home loads 32 entries; categories 5 emerged cats + pinned cards; search "AiJi"→6 results (text+tag match) with emerged facets; detail 编辑 dialog editable (title/summary/category-combo/tags); capture 文本/语音/相机/相册 reachable (text fully exercised; voice/camera getUserMedia env-limited per N1). |
| `npx tsc -p tsconfig.app.json` | GREEN | EXIT 0. |

## Defects (by severity) — continuing from D3

### D4 — Summary aggregate cards stuck "正在重新生成" after LLM failure (recalculating flag not cleared on error)

- **status:** OPEN
- **classification:** PRE-EXISTING (not a regression from audit fix `c9c5774`). Related to audit D9 — D9 fixed the in-flight guard (`if(get().recalculating[key]) return`) but did NOT add a failure-clear, so this gap was outside the audit's described scope.
- **severity:** P2 (major UX — under any LLM failure in production, summary cards for that period become permanently stuck until full reload)
- **file:** `src/app/store.ts` (`recomputeAggregate` — the `catch` path does not clear `recalculating[key]`; D9 fix at the same fn's head only guards entry, not exit-on-error); UI `src/ui/screens/summary/DigestCard.tsx` renders `status="加载中" / 正在重新生成` while `recalculating[key]` is truthy.
- **trigger:**
  1. Have an aggregate whose period has entries but no fresh successful aggregate (e.g. a day/week with entries that was never summarized, or is stale per detailLevel).
  2. Force an LLM failure (expired key / network / rate-limit / 401).
  3. Open `/summary`, switch to that scope.
  4. Cards fire `recomputeAggregate` → DeepSeek 401 → `[store] recomputeAggregate failed` logged → but the card keeps rendering `status "加载中" / 正在重新生成 / {label} / 摘要…`.
  5. Observe: ALL 11 DeepSeek POSTs returned 401 (none pending, verified via `list_network_requests`), yet 5 day cards (7/17, 7/14, 7/13, 7/12, 7/11) still show `role="status" 加载中` + "正在重新生成".
- **expected:** On recompute failure, clear `recalculating[key]` and either fall back to the stale aggregate (if any) or show a "生成失败 · 重新生成" state — mirroring the D7 entry fix (`失败标 failed 不静默卡 processing`). The card must not stay in a perpetual "regenerating" state.
- **actual:** `recalculating[key]` stays `true` after the catch; the card is stuck "正在重新生成…摘要…" for the rest of the session. (In-flight retries on scope-switch DO still fire — flag appears to clear on unmount/next mount — but within a single view the failed cards never recover.)
- **note:** Surfaced acutely here because the dev key is expired (E1), but the root cause is missing failure-clear, not the key. Production LLM failures (network blips, 429, key revocation) hit the same path.
- **screenshot:** `docs/acceptance/shots/v3-summary-stuck-regenerating.png`

### D5 — Exported audio media gets `.bin` extension (unplayable); OPFS audio stored without MIME type

- **status:** OPEN
- **classification:** PRE-EXISTING (not a regression from audit fix `c9c5774`). Related to audit M4 — M4 only added IMAGE branches to `extFromType`; the audio/video MIME-preservation gap was not in the audit's scope.
- **severity:** P2 (major — exported audio is unplayable/unnamed for any real voice capture)
- **file:** `src/adapters/zipExport.ts:151-167` (`extFromType` derives ext from `blob.type`, falls back to `bin`); `:237,:303` (`media/${ref}.${extFromType(blob.type)}`); root cause upstream in the OPFS media write (audio Blob stored with no MIME + extension-less filename → `getFileHandle.getFile()` returns `File.type===""`).
- **trigger:**
  1. Capture a voice entry (audio saved to OPFS under ref `audio-<uuid>` — no file extension).
  2. Settings → 导出 .zip.
  3. Inspect zip central directory.
- **expected:** Audio exported as `media/audio-<uuid>.opus` / `.webm` / `.ogg` — a playable extension matching the recorded format.
- **actual:** All 5 audio files in the zip are `media/audio-<uuid>.bin` (verified by parsing zip central directory: 40 files, 5 in `media/` all `.bin`). Direct OPFS probe of `audio-8e400eaf-...` confirms `File.type === ""` (empty MIME) — browser cannot infer type from the extension-less filename, so `extFromType("")` returns `bin`.
- **root cause chain:** MediaRecorder produces a typed Blob (`audio/webm` or `audio/ogg`) → written to OPFS under an extension-less name `audio-<uuid>` → read back via `getFileHandle.getFile()` yields `File.type===""` (browser derives type from filename extension, which is absent) → `extFromType("")` → `bin`.
- **fix direction:** Persist MIME on the part (e.g. `EntryPart.mime`) at capture time and use it in `extFromType` (`media/${ref}.${extFromType(part.mime ?? blob.type)}`); OR name OPFS media files with an extension at write time. Note `EntryPart` already has a `mime` field in the schema — it is currently empty (`"?"`) for real captures, so the write side also isn't populating it.
- **scope note:** Audit M4 ("照片 .bin") was IMAGE-only and is untestable here (no image parts in DB — 10 audio + 1 video only). The seed entries with mediaRef `e1.opus`/`e5.webm` are correctly named but their OPFS blobs don't exist (seed mock), so they're skipped by `getMedia` — not a second defect.
- **screenshot:** (zip central-directory evidence captured inline in acceptance transcript; zip blob not saved to disk — intercepted in-memory via `URL.createObjectURL` patch)

## Environment notes (NOT defects — per task constraints, dev keys are user-authorized and not flaggable; recorded for lead awareness)

### E1 — DeepSeek dev key — RESOLVED (was: stale localStorage, not expiry)
**RESOLVED 2026-07-17.** The key was never expired — curl on `sk-9c3...4581` returns HTTP 200 on both `deepseek-v4-flash` and `deepseek-chat`. The 401 was a stale localStorage value: the browser had the **old** key `sk-...dd3a` in `localStorage['llm:key']`, and `devSeed.ts:27-28` is seed-once (writes only when the key is absent, never overwrites an existing value). So the `.env.local` rotation to `...4581` never reached the browser. **Fix was data-layer, not code:** cleared `localStorage['llm:key']` + reloaded → devSeed seeded the new key → classify-WRITE path live-verified. No code change (the seed-once design is correct — it must not clobber a key the user set via Settings UI; rotation-by-env requires a manual clear, documented in the `.env.local` header). **Live-verified post-fix (chrome-devtools-mcp 390×844):** (1) fresh text capture → saved → DeepSeek classify → home shows `项目进展` chip + `AI 已分类` (NOT `处理中`); (2) summary 本周 recompute succeeded → real digest content + `重新生成` button (D4 success path). Shots: `v3-e1-newkey-classify-success.png`, `v3-d4-success-path-summary.png`. D1/D3/D4 classify-WRITE gap now CLOSED. STT key (`stt:key`) still not live-exercised — getUserMedia env-limited (see N5).

### N5 — Voice/camera not live-exercised (headless env, same as prior N1)
getUserMedia hangs / is unavailable in the headless chrome-devtools-mcp browser. Capture `语音`/`相机` buttons are reachable and present (uid-verified); L2 (MediaRecorder construction try/catch) + L3 (pickMedia 30s timeout) fixes verified structurally. Recommend manual verification on a real device (PRD §7.4 A1/A2). Not a defect.

### N6 — Pre-existing stuck "处理中" entries on home (16 of 32 entries lack entryAi)
16 entries show "AI 正在分类 · 已转写 处理中" — these were captured in prior sessions (before D7 fix / before the dev key was set) and never reached a terminal status. No auto-retry mechanism exists on reload (M11 reprocess double-click guard is DEFERRED by design). These are pre-existing test artifacts in the dev DB, NOT a regression. D7's NEW-behavior (mark failed not stuck) is confirmed on the fresh capture. Flagging only because the home screen looks noisy with stuck entries — a "reprocess all stuck" maintenance action (out of this gate's scope) would clean it up.


---

## Round: 提醒三联修 (Reminder-creator consolidation) — 2026-07-17

Date: 2026-07-17
Verifier: acceptance agent (Playwright MCP, 390×844, real DeepSeek BYOK live)
Scope: 3 fixes — (1) merged "创建待办"+"提醒我" into single `<ReminderCreator>` (创建待办 primary + 忽略 ghost + time chips + editable label); (2) persistent anti-repop via `ai.todoDismissed=true` on both confirm + dismiss, detail gate `!ai.todoDismissed && !reminders.some(r=>r.entryId===entry.id)`; (3) time default = AI-detected chip when `reminderSuggestion.dueAt` present, else 今天 23:59.

### Verdict: LGTM — 0 defects

| item | verdict | evidence |
|------|---------|----------|
| V1 modal default = AI chip (not 23:59) | PASS | Entry "明天上午10点提醒我开会讨论预算" → modal chip "AI · 明天 10:00" had `bg-pri` (rgb(79,70,229)); all others `bg-card` white. 创建待办 → Dexie reminder `dueAt=2026-07-18T10:00:00+08:00` (NOT today 23:59), label="开会讨论预算", status=pending; entryAi `todoDismissed=true`, `reminderSuggestion` cleared. |
| V2 anti-repop (build path) | PASS | Same entry → 回首页 → 进 detail: no "AI 检测到 · 待办" title, no 提醒时间 chips, no 创建待办/忽略 buttons. AI panel (category 待办 / tags reminder,work / title / summary) renders normally. Gate holds (todoDismissed=true). |
| V2 anti-repop (忽略 path) | PASS | Entry "后天下午4点提醒我去取快递" → modal 忽略 → Dexie: entryAi `todoDismissed=true`, `reminderSuggestion` cleared, `reminders` table has NO row for this entryId. 回首页进 detail: no ReminderCreator card. |
| V3 no-time entry detail inline | PASS | Entry "该买菜了" (LLM category=errand, no reminderSuggestion, facets empty) → home NO modal (correct, no suggestion). Detail DID render inline ReminderCreator (below AI panel). Default chip "今天 23:59" had `bg-pri`; no "AI ·" chip present. Chips: 今天23:59/明天09:00/明天18:00/后天09:00/周六09:00/自定义. |
| V3 自定义 datetime-local | PASS | Click 自定义 chip → revealed `<input type="datetime-local">` (verified via `input.type`). Set value 2026-07-20T10:30 → 创建待办 → Dexie reminder `dueAt=2026-07-20T02:30:00.000Z` (= local 10:30 +08:00), status=pending, todoDismissed=true. |
| R1 non-todo entry no modal/card | PASS | Entry "今天天气不错，云朵像棉花糖" (LLM category=life, facets.mood=轻松, no suggestion) → home NO modal; detail NO ReminderCreator card (no 创建待办, no 提醒时间). |
| R2 label editable + persisted | PASS | Detail inline card label input changed "买菜" → "买菜带袋子" → 创建待办 → Dexie `reminders.label="买菜带袋子"` (edited value persisted). |

Defect count: 0. No P0/P1/P2. All three fixes behave as specified; reminder creation, persistence, anti-repop, and time-default logic all verified against live DeepSeek classify + Dexie reads.

### Files touched (read-only reference, no source edits by verifier)
- `src/ui/components/ReminderCreator.tsx` (buildPicks L59-76, default L90, confirm L169-170, dismiss L179-186)
- `src/ui/components/ReminderPopup.tsx` (modal gate L9-10, render L11-26)
- `src/ui/layout/AppShell.tsx` (mount L42)
- `src/ui/screens/detail/index.tsx` (inline gate L624, render L625-630)
- `src/app/store.ts` (confirmReminder L582-617, pendingReminder set L500-501)
- `src/adapters/dexieStorage.ts` (saveReminder L172-174)
- `src/data/db.ts` (schema, tables entries/entryAi/reminders)
