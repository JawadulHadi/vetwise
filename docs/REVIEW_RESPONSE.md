# Response to `Vetwise-Code-Review.md`

Every finding is fixed, and `npm run regress` (`tests/review-regressions.ts`) asserts the behaviour over real HTTP and the real MCP client. The labels in that suite use the same numbers as the review.

| #  | Finding | Status | Where |
| -- | ------- | ------ | ----- |
| 1  | Timing-unsafe token comparison | Fixed | `src/http/auth.ts` — SHA-256 digests compared with `timingSafeEqual`; the loop checks every record so there is no early exit |
| 2  | Predictable demo tokens | Fixed | `src/config.ts` — demo tokens only in demo mode; `NODE_ENV=production` or `VETWISE_DEMO=0` requires explicit tokens and rejects the published strings |
| 3  | Session hijacking | Fixed | `src/http/chat.ts` — sessions keyed `clientId:sessionId`; a guessed id creates a new session |
| 4  | Internal errors exposed | Fixed | `src/http/chat.ts` — one generic sentence to the caller, full cause to the operator log, `502` |
| 5  | `/healthz` discloses internals | Fixed | `src/index.ts` — `{ ok, time }` only |
| 6  | Raw token propagated | Fixed | `src/http/auth.ts`, `src/mcp/auth.ts` — `req.auth.token` is a four-character hint and `Caller` has no token field; only the chat route reads the header for its self-call |
| 7  | Bearer tokens compared in plaintext | Fixed | `src/hash.ts`, `src/config.ts` — own tokens are stored as SHA-256 digests; `/api/state` omits the hashes |
| 8  | Alert body unsanitised | Fixed | `src/domain/alerts.ts` — control characters and angle brackets stripped before the outbox and webhook |
| 9  | Unbounded session map | Fixed | `src/http/chat.ts` — 30-minute TTL, 200-session cap, swept on create |
| 10 | 8-hex ids | Fixed | `src/store/store.ts` — 16 hex chars; the same class of bug in `src/domain/care.ts` (`Math.random`) now uses `newId` too |
| 11 | Medication route hardcoded | Fixed | `src/mcp/tools.ts` — `route` is in the proposal input, the signed payload and the applied medication |
| 12 | Token echoed in text | Fixed | `src/mcp/tools.ts` — the token lives only in `structuredContent` |
| 13 | `latencyMs: 1` | Fixed | `src/mcp/tools.ts` — measured from the start of the tool call |
| 14 | Audit and outbox grow forever | Fixed | `src/store/store.ts` — capped at 1,000 audit entries and 100 outbox items on every write |
| 15 | `MAX_TURNS` dead end | Fixed | `src/agent/bedrock.ts` — 10 turns, then a hand-off that names the on-file poison-control number |
| 16 | Failed safety tool silently continues | Fixed | `src/agent/bedrock.ts` — a thrown `assess_toxin_exposure`, `log_care_event`, `apply_record_change` or `alert_caregiver` aborts the loop and returns the hand-off |
| 17 | Prompt injection via transcript string | Fixed | `src/agent/bedrock.ts` — Bedrock's native multi-turn `messages` array, no flattened prompt |
| 18 | No credential check at startup | Fixed | `src/agent/bedrock.ts` — `assertBedrockReady()` runs at boot in `bedrock` mode and a failure stops the process |
| 19 | Silent `nova-lite` default | Fixed | `src/config.ts` — `VETWISE_AGENT=bedrock` requires `BEDROCK_MODEL_ID` |
| 20 | No rate limiting | Fixed | `src/http/limits.ts` — 20 chat requests/minute per token; `/api/state` has its own, higher budget |
| 21 | Single-process write lock | Documented | `docs/ARCHITECTURE.md` — "Single process only"; startup warns when `WEB_CONCURRENCY > 1` |
| 22 | `DEMO_CLOCK` in production | Fixed | `src/config.ts` — refused with `NODE_ENV=production`, warned everywhere else |
| 23 | No security headers | Fixed | `src/index.ts` — strict CSP, `nosniff`, `X-Frame-Options: DENY`, referrer and permissions policy |
| 24 | `publicBaseUrl` unvalidated | Fixed | `src/index.ts` — probed once after the listener opens; a wrong URL is reported at boot |

## Deliberate deviations

- **#2** keeps the demo tokens usable when `VETWISE_DEMO` is unset outside production, because `npm start` on a fresh clone is the recorded demo. The moment the process is declared production — or demo mode is switched off — the fallback disappears and startup fails. The warning is printed on every boot.
- **#18** probes with a one-token `Converse` call rather than `sts:GetCallerIdentity`, so it checks the permission that actually matters (model access) and does not add another SDK dependency.
- **#10** was extended beyond the review: `src/domain/care.ts` was generating care-event ids with `Math.random()`, which is both shorter and not a CSPRNG.

## Not changed

The two design choices the review praised are untouched: confirmation tokens are still stored as hashes and marked used only after a successful apply, and the JSON store still writes through a temp file then renames.
