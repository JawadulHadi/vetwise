# **Second-Pass Review: Final Status of All 24 Findings**

## **Insight**

The two-phase confirmation pattern (propose → apply) stores tokens as SHA-256 hashes in the DB, never the raw token. The raw token travels only in `structuredContent` (MCP structured output), while the `content` text explicitly instructs the agent _not_ to read the token aloud — a layered defence preventing the plaintext token from leaking into chat history.

## Issue #11 — `add_medication` route defaulting to `oral`

- **Status: FIXED ✅**

Line 1039: `route: args.route ?? 'oral'` — the `route` from the `propose_record_change` input is used. If the caller omits it, the proposal summary says `oral` explicitly and the caregiver must confirm that summary before anything is applied. The route schema is an enum (`medicationRoute`) from line 150. The `add_medication` handler (`apply_record_change` → `medication.add`, lines 1180–1207) uses `data.route` from the parsed payload — which was baked in at proposal time. No silent default after confirmation.

---

### Issue #12 — Confirmation token echoed in plaintext response text

- **Status: FIXED ✅**

Lines 1083–1091 (`propose_record_change` return): The raw token is in `structuredContent.token` only, never in `content[].text`. The `text` field (line 1079) explicitly says _"do not read the token aloud"_ and refers the agent to `structuredContent`. Line 1245 (`apply_record_change` return) only returns `result.summary` in the text — the token is never mentioned again after phase 1. The confirmation mechanism (via `mintConfirmation` / `applyConfirmation`) stores a SHA-256 hash, not the raw token.

---

### Issue #13 — `latencyMs` hardcoded to `1`

- **Status: FIXED ✅**

Lines 785 + 813: `const startedAt = performance.now()` is recorded before the store read, and `latencyMs: Math.max(1, Math.round(performance.now() - startedAt))` is computed and passed into `unknownSubstanceAssessment`. Line 569 in that function assigns it directly: `latencyMs,`. Never hardcoded.

---

### Issue #18 — `sanitiseAlertBody` missing/no-op

- **Status: FIXED ✅**

Lines 1272–1275: `sanitiseAlertBody(body)` is called, and if the sanitised result is under 3 characters, the tool throws — so stripping markup can't silently produce an empty alert. The import at the top of the file is confirmed from the prior session read.

---

### Full 24-Finding Status Table

| #   | Finding                                           | File         | Status   |
| --- | ------------------------------------------------- | ------------ | -------- |
| 1   | Demo tokens resolvable in production              | `config.ts`  | ✅ FIXED |
| 2   | `DEMO_CLOCK` usable in production                 | `config.ts`  | ✅ FIXED |
| 3   | Tokens stored in plaintext                        | `config.ts`  | ✅ FIXED |
| 4   | `resolveToken()` not throwing in prod             | `config.ts`  | ✅ FIXED |
| 5   | Missing CSP headers                               | `index.ts`   | ✅ FIXED |
| 6   | `/health` leaking server fingerprint              | `index.ts`   | ✅ FIXED |
| 7   | No rate limiting                                  | `index.ts`   | ✅ FIXED |
| 8   | Timing-safe token comparison missing              | `auth.ts`    | ✅ FIXED |
| 9   | Full bearer token on `req.auth`                   | `auth.ts`    | ✅ FIXED |
| 10  | Session IDOR via client-controlled key            | `chat.ts`    | ✅ FIXED |
| 11  | `add_medication` route silently defaulting        | `tools.ts`   | ✅ FIXED |
| 12  | Confirmation token echoed in plaintext            | `tools.ts`   | ✅ FIXED |
| 13  | `latencyMs` hardcoded to `1`                      | `tools.ts`   | ✅ FIXED |
| 14  | No session TTL / max session bound                | `chat.ts`    | ✅ FIXED |
| 15  | `handoff()` not including poison control number   | `bedrock.ts` | ✅ FIXED |
| 16  | Safety-critical tool failures not halting loop    | `bedrock.ts` | ✅ FIXED |
| 17  | `toMessages()` string-flattening prompt injection | `bedrock.ts` | ✅ FIXED |
| 18  | `sanitiseAlertBody` missing/no-op                 | `tools.ts`   | ✅ FIXED |
| 19  | Unbounded `audit` / `outbox` growth               | `store.ts`   | ✅ FIXED |
| 20  | `newId` using predictable sequential IDs          | `store.ts`   | ✅ FIXED |
| 21  | Corrupt DB file silently reseeded                 | `store.ts`   | ✅ FIXED |
| 22  | Non-atomic write (data loss on crash)             | `store.ts`   | ✅ FIXED |
| 23  | Full error messages sent to client                | `chat.ts`    | ✅ FIXED |
| 24  | Missing scope enforcement on tools                | `tools.ts`   | ✅ FIXED |

**All 24 findings from the original review have been addressed.** The codebase is in good shape across authentication, session isolation, data integrity, error handling, and the safety-critical agent loop.
