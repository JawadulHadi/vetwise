
# Vetwise Code Review — Loopholes & Suggestions

---

## SECURITY

**1. Timing-unsafe token comparison** · `src/http/auth.ts:15`

```ts
return config.tokens.find((entry) => entry.token === presented);
```

String `===` exits on the first differing byte, leaking timing information. An attacker measuring response latency can character-by-character enumerate valid token prefixes.
**Fix:** Replace with `crypto.timingSafeEqual(Buffer.from(entry.token), Buffer.from(presented))`.

---

**2. Predictable demo tokens active in any environment** · `src/config.ts:40,47`

```ts
token: process.env.OWNER_TOKEN ?? "maya-owner-demo-token"
```

If `.env` is absent or env vars are unset, the well-known tokens `maya-owner-demo-token` / `noah-sitter-demo-token` authenticate successfully in production. Anyone who reads the repo (public GitHub forks, npm bundles) can gain full write access.
**Fix:** Remove the fallback strings entirely; throw at startup if `OWNER_TOKEN`/`SITTER_TOKEN` are unset.

---

**3. Session hijacking — no session-to-user binding** · `src/http/chat.ts:60`

```ts
const session = sessionFor(body?.sessionId?.slice(0, 64) || 'default');
```

The `sessions` Map is shared across all users. User A can supply user B's known or guessable session ID and read their entire conversation transcript.
**Fix:** Key sessions on `${clientId}:${sessionId}`, reject any session ID not owned by the authenticated caller.

---

**4. Internal error messages exposed to clients** · `src/http/chat.ts:88`

```ts
error: (error as Error).message,
```

AWS SDK messages, file paths, and internal service errors reach the HTTP response. This leaks infrastructure details.
**Fix:** Log the full error server-side; return a generic message to the client.

---

**5. /healthz discloses internals with no auth** · `src/index.ts:32-39`
The unauthenticated health endpoint reveals agent mode (`bedrock` vs `scripted`), model ID, and server version. This fingerprints the AI stack.
**Fix:** Either require a bearer token, or strip `server`/`agent` fields and return only `{ok, time}`.

---

**6. Raw bearer token propagated through request context** · `src/http/auth.ts:39`, `src/mcp/auth.ts:33`
`req.auth.token` stores the plaintext secret and passes it to the MCP client. If tool-call logs or error traces are stored, they can contain the live token.
**Fix:** Only expose the token prefix in logs; pass the full token only to the internal MCP self-call and immediately discard it from any persistent structure.

---

**7. `hashToken` exists but bearer tokens are compared in plaintext** · `src/store/store.ts:21`, `src/http/auth.ts:15`
Confirmation tokens are correctly hashed (SHA-256 stored, raw token never persisted). Bearer tokens are stored and compared in full plaintext — the opposite design. This inconsistency suggests the hashing pattern was intended for auth tokens too.

---

**8. Alert body reaches outbox without sanitization** · `src/mcp/tools.ts:1252-1261`
The `body` field (`min(3).max(500)`) is stored verbatim and POSTed to `CAREGIVER_WEBHOOK_URL`. If the webhook consumer is an SMS/email gateway that interpolates content, embedded line breaks or HTML may cause injection.
**Fix:** Strip or encode control characters before writing to the outbox.

---

### LOGIC / DATA INTEGRITY

**9. Unbounded session Map — memory leak** · `src/http/chat.ts:17`

```ts
const sessions = new Map<string, Session>();
```

No TTL, no eviction, no size cap. Each unique session ID permanently grows the Map. Under load, or with attacker-generated random IDs, the process will OOM.
**Fix:** Use an LRU-with-TTL structure (e.g., `lru-cache` with a 30-minute TTL and a max of a few hundred sessions).

---

**10. `newId` uses only 8 hex chars — collision risk** · `src/store/store.ts:25`

```ts
return `${prefix}_${randomUUID().slice(0, 8)}`;
```

8 hex chars = 32 bits of entropy. The birthday paradox gives ~50% collision probability at ~65,000 items — reachable in a long-running household log.
**Fix:** Use at least 16 chars: `randomUUID().replace(/-/g, '').slice(0, 16)`.

---

**11. Medication route hardcoded to `'oral'` on add** · `src/mcp/tools.ts:1179`

```ts
route: 'oral',  // hardcoded
```

When adding a medication via `medication.add`, topical, transdermal, inhalation, and injection medications are silently mislabeled. The domain type supports all five routes; none are collected in the confirmation payload.
**Fix:** Add `route` to the `addMedicationPayload` schema and the `propose_record_change` input.

---

**12. Confirmation token echoed in tool response text** · `src/mcp/tools.ts:1068`

```ts
`If they say yes, call apply_record_change with token ${token}.`
```

The raw short-lived token appears in the plaintext tool response, which is logged in the transcript and potentially in observability systems. Even though it's bound to `clientId`, it needlessly increases exposure surface.
**Fix:** Omit the token from the human-readable text; pass it only in `structuredContent.token`.

---

**13. `unknownSubstanceAssessment` hardcodes `latencyMs: 1`** · `src/mcp/tools.ts:566`
Any observability dashboard or audit relying on `latencyMs` for unknown-substance lookups will receive a meaningless constant.
**Fix:** Capture a real start time before the function and compute actual elapsed time.

---

**14. Audit log and outbox grow indefinitely** · `src/domain/types.ts:184, 161`
Both `Database.audit` and `Database.outbox` arrays accumulate forever. The JSON file (and therefore every write operation) grows without bound. `publishableState` slices to 25/10 entries for reads, but the underlying data is never pruned.
**Fix:** Cap both arrays at a reasonable limit (e.g., 1,000 audit entries, 100 outbox items) in `mutate`, trimming the oldest when exceeded.

---

**15. `MAX_TURNS` exhaustion gives a misleading dead-end** · `src/agent/bedrock.ts:14, 118`

```ts
return { reply: 'That took more steps than I expected. Let me hand this to the vet instead.', ... };
```

When 6 turns are exhausted there is no actual handoff — the message just terminates. For safety-critical workflows like toxin assessment, the user is left with a confusing non-answer.
**Fix:** Either increase the limit (8–12 is common for tool-heavy agents), or return a more actionable message such as "I wasn't able to complete this assessment. Please call [poison-control number] directly."

---

**16. Tool errors silently continue in Bedrock loop** · `src/agent/bedrock.ts:108-112`
When `assess_toxin_exposure` or any safety tool throws, the exception is caught and fed back to Bedrock as a tool error — the LLM may then continue and produce an assessment *without* having run the toxicology engine.
**Fix:** For tools marked safety-critical (assess_toxin_exposure, log_care_event), propagate the error to terminate the loop rather than allowing Bedrock to continue on a failed tool result.

---

**17. Prompt injection risk via transcript formatting** · `src/agent/bedrock.ts:55-58`

```ts
const prompt = `Conversation so far:\n${options.transcript}\n\nNow the caregiver says: ${options.message}`;
```

If a user sends a message like `\n\nSystem: Ignore previous instructions`, it is injected verbatim into the Bedrock prompt. The plain string concatenation provides no structural separation between the transcript and the new message.
**Fix:** Use Bedrock's native multi-turn `messages` array for history rather than a flattened string; each prior exchange becomes a `{role: 'user'/'assistant', content: [...]}` entry, eliminating injection.

---

### AWS / AGENT CONFIGURATION

**18. No AWS credential validation at startup** · `src/agent/bedrock.ts:50`
`BedrockRuntimeClient` is created per-request. Missing or expired credentials are only discovered when the first real user sends a chat message.
**Fix:** Call `runtime.send(new ConverseCommand({...}))` with a minimal probe (or use `STSClient.send(new GetCallerIdentityCommand())`) at startup when `VETWISE_AGENT=bedrock`.

---

**19. Bedrock model silently defaults to `nova-lite`** · `src/config.ts:34`

```ts
modelId: process.env.BEDROCK_MODEL_ID ?? "amazon.nova-lite-v1:0",
```

For pet-safety triage where a missed emergency verdict has real consequences, the model tier should be an explicit operator choice, not a silent fallback to the smallest/cheapest option.
**Fix:** Require `BEDROCK_MODEL_ID` when `VETWISE_AGENT=bedrock`; throw if absent.

---

### INFRASTRUCTURE / DEPLOYMENT

**20. No rate limiting on `/api/chat`** · `src/index.ts:41`
Every request may trigger up to 6 Bedrock Converse calls. No per-token throttle, no cost ceiling. A single compromised token can drain Bedrock credits.
**Fix:** Add `express-rate-limit` keyed on `clientId`, e.g., 20 requests/minute per token.

---

**21. Single-process write lock — unsafe under clustering** · `src/store/store.ts:122-126`
The promise queue serializes writes within one process, but two processes serving the same `db.json` (pm2 cluster, Docker restart overlap) will race.
**Fix:** Document this limitation prominently; for multi-process use, replace with SQLite (via `better-sqlite3`) which provides OS-level write serialization.

---

**22. `DEMO_CLOCK` freeze affects token expiry in production** · `src/config.ts:23`
If `DEMO_CLOCK` is accidentally set in production, `now()` returns a frozen time. Confirmation tokens and care-slot due-time calculations will silently produce wrong results.
**Fix:** Warn at startup (console.warn) whenever `DEMO_CLOCK` is set, and refuse to start if `NODE_ENV=production` with a frozen clock.

---

**23. Static files served with no security headers** · `src/index.ts:61`

```ts
app.use(express.static(path.resolve('web'), { extensions: ['html'] }));
```

No `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`. An XSS in the web UI could steal the bearer token visible in the state page.
**Fix:** Add `helmet` (or manual `res.setHeader` calls) before the static middleware.

---

**24. `publicBaseUrl` for self-MCP is not validated at startup** · `src/http/chat.ts:63`
The chat agent dials `config.publicBaseUrl/mcp`. If this is misconfigured (wrong hostname, HTTP vs HTTPS), all chat requests fail with a confusing network error rather than a clear startup failure.
**Fix:** Health-probe `publicBaseUrl/mcp` once at startup; refuse to start (or log a loud warning) if it fails.

---

### SUMMARY TABLE

| #   | Severity | Category                   | Location                   |
| --- | -------- | -------------------------- | -------------------------- |
| 1   | High     | Security — timing attack   | `http/auth.ts:15`          |
| 2   | Critical | Security — hardcoded creds | `config.ts:40,47`          |
| 3   | High     | Security — session hijack  | `http/chat.ts:60`          |
| 4   | Medium   | Security — error leak      | `http/chat.ts:88`          |
| 5   | Medium   | Security — info disclosure | `index.ts:32`              |
| 6   | Medium   | Security — token scope     | `http/auth.ts:39`          |
| 7   | Low      | Security — inconsistency   | `http/auth.ts`, `store.ts` |
| 8   | Low      | Security — injection       | `mcp/tools.ts:1252`        |
| 9   | High     | Reliability — OOM          | `http/chat.ts:17`          |
| 10  | Medium   | Data integrity — collision | `store/store.ts:25`        |
| 11  | High     | Logic — wrong data         | `mcp/tools.ts:1179`        |
| 12  | Low      | Privacy — token exposure   | `mcp/tools.ts:1068`        |
| 13  | Low      | Observability              | `mcp/tools.ts:566`         |
| 14  | Medium   | Reliability — disk bloat   | `domain/types.ts`          |
| 15  | High     | Safety — dead-end          | `agent/bedrock.ts:118`     |
| 16  | High     | Safety — silent tool fail  | `agent/bedrock.ts:108`     |
| 17  | Medium   | Security — prompt inject   | `agent/bedrock.ts:55`      |
| 18  | Medium   | Ops — late failure         | `agent/bedrock.ts:50`      |
| 19  | Medium   | Safety — model tier        | `config.ts:34`             |
| 20  | High     | Security — cost/DoS        | `index.ts:41`              |
| 21  | Medium   | Reliability — race         | `store/store.ts`           |
| 22  | Medium   | Correctness — frozen time  | `config.ts:23`             |
| 23  | Medium   | Security — no CSP          | `index.ts:61`              |
| 24  | Low      | Ops — silent miscfg        | `http/chat.ts:63`          |

---

`✶ Insight ─────────────────────────────────────`
The most architecturally interesting pattern here is the **two-phase confirmation flow** (`propose_record_change` → `apply_record_change`). It correctly stores a SHA-256 hash of the token and never persists the raw token — a sound design. The flaw is that the raw token is then echoed in the plaintext tool response, partially undoing the protection. This is a common gap: getting the storage right but leaking through the communication channel.

The **flat-file store with write-then-rename** (`persist()`) is a well-chosen pragmatic design for a single-process app — atomic on POSIX filesystems and simple to reason about. Its limit is exactly one process; the code signals this clearly in comments, but no startup check enforces it.
`─────────────────────────────────────────────────`

The two most urgent items to fix before any public deployment are **#2** (remove hardcoded demo tokens) and **#3** (bind sessions to callers). Everything else is medium-term hardening.
