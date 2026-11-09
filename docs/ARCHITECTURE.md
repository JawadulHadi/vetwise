# Architecture

**Vetwise** is one Node process with three faces: an MCP server, a small HTTP API for the simulator, and a static page that is only a view. The important boundary is that **the household record and the safety engine live on the server**, and every answer the UI shows came through `/mcp`.

```text
src/
├─ index.ts                 Express wiring, auth, static UI, startup banner
├─ config.ts                env parsing, demo clock, bearer tokens, Bedrock config
├─ clock.ts                 frozen/real clock, local day keys, time formatting
├─ domain/
│  ├─ types.ts              Database, Pet, Medication, Exposure, Verdict, …
│  ├─ toxins.ts             24-toxin catalogue, bands, products, citations
│  ├─ exposure.ts           deterministic safety engine + text rendering
│  ├─ care.ts               care summary, medication list/find, slot logic
│  ├─ confirmations.ts      two-phase token mint/apply with rollback
│  └─ alerts.ts             outbox delivery (optional webhook)
├─ store/
│  ├─ store.ts              serialised JSON store, atomic write-then-rename
│  └─ seed.ts               demo household, medications, care logs
├─ mcp/
│  ├─ server.ts             McpServer factory + server-level safety instructions
│  ├─ tools.ts              all 9 tools, scopes, validation, persistence
│  ├─ resources.ts          6 resources
│  ├─ prompts.ts            2 prompts
│  └─ auth.ts               caller context, scope checks, publishable state
├─ http/
│  ├─ auth.ts               bearer token → AuthInfo, optional resolver
│  ├─ traffic.ts            in-memory MCP traffic log for the UI
│  └─ chat.ts               /api/chat, /api/state, session state
├─ agent/
│  ├─ mcp.ts                short-lived MCP client + callTool wrapper
│  ├─ scripted.ts           deterministic planner
│  ├─ bedrock.ts            Converse tool loop
│  └─ run.ts                planner selection + scripted fallback
web/                        simulator shell (HTML/CSS/JS, no build step)
tests/
├─ toxins.test.ts           safety-engine unit tests
└─ mcp-smoke.ts             end-to-end transport test
```

---

## Request paths

### A. Host tool call

```text
POST /mcp  (Authorization: Bearer <token>)
  → bearerAuth              token → req.auth { clientId, scopes }
  → recordTraffic           JSON-RPC method + tool name for the UI
  → MCP handler             createServerFactory() → fresh McpServer per request
  → tool handler            requireScope(ctx, scope)
  → domain module           pure logic against the store
  → result                  text + structuredContent
```

The server factory runs once per HTTP request, so no session state leaks between callers. `toNodeHandler` forwards `req.auth` as `authInfo`; `requireScope` reads `ctx.http.authInfo.scopes`. Scopes are checked **inside** the tools, not only at the edge. A read-only token can list medicines but cannot propose a change, and the error names the missing scope.

### B. Simulator chat turn

```text
POST /api/chat { sessionId, message }
  → token lookup
  → session transcript + ScriptedState
  → withMcpClient(PUBLIC_BASE_URL/mcp, same token)
  → runAgent (scripted or Bedrock)
  → tools/call ... (recorded by recordTraffic)
  → { reply, steps, pendingConfirmation }
```

The planner is an MCP client like any other. It has no back door to the store. That is what makes the traffic panel honest: if the answer says "call your vet at 29.71 mg/kg", there is a matching `assess_toxin_exposure` call in the log.

### C. Read-only state refresh

`GET /api/state` returns a publishable snapshot (household, people, pets, clinics, medications, care, exposures, audit, outbox) plus the traffic log and the active agent mode. `GET /api/whoami` returns `{ clientId, scopes, token: "maya…", label }` — a prefix, never the usable bearer token.

---

## Data model

One JSON file holds the whole household:

```text
household   people   pets   clinics
medications careLogs exposures outbox confirmations audit
```

- **Pets** carry species, weight and `weightUpdatedAt`. Weight is required for every mg/kg calculation.
- **Medications** have status `active | paused | stopped | prn`, a schedule of `HH:MM` slots, a prescriber and a plain-language dose label. Vetwise never converts a prescription into a therapeutic recommendation.
- **Care logs** bind a medication to a slot id and a day. A dose is `taken`, `skipped`, `due`, `upcoming` or `missed`; logging refuses to guess when two unlogged doses exist.
- **Exposures** keep the verdict, headline, dose per kg, symptoms and the reporter. They are the incident history the UI shows.
- **Confirmations** store only the SHA-256 hash of the token, the action, the payload and the caller. The raw token exists once, in the response to the person who proposed the change.
- **Audit** records proposals, applications, exposure assessments and care writes.

### Store guarantees

`Store.mutate` serialises every mutation through one promise chain and persists with write-then-rename. A crash cannot leave a half-written JSON file. A file that exists but does not parse is an error, not an invitation to reseed: silently replacing a household record because of a transient read failure is exactly the data-loss bug the store avoids.

The demo seeds only when the file is absent (`ENOENT`). Delete `data/db.json` to reset.

---

## Safety engine

`src/domain/exposure.ts` is pure: no I/O, no model, no network. Input is a pet, a toxin, an optional product, an optional amount, symptoms and the household contacts. Output is an `ExposureAssessment`.

The pipeline is ordered and each step can only raise the floor:

1. **Species gate.** Unknown → `unverified`. A toxin that only has a feline record (lily) or only a canine record (xylitol, grapes, macadamia) returns `unverified` for the other species — not "safe".
2. **Intent gate.** "Can I give this?" for a non-food substance → `call_vet` with a "Do not give…" headline.
3. **Amount gate.** Missing amount → `unverified` (or the toxin's explicit any-exposure floor). Missing weight → `unverified`. Unconvertible product → `unverified`.
4. **Product override.** A product may carry its own higher-risk verdict (tea tree oil, avocado pit, etc.).
5. **Dose bands.** The highest published band at or below the calculated dose decides, but only if no earlier gate already decided.
6. **Symptoms.** Moderate signs → `call_vet`; severe signs → `emergency`.
7. **Any-exposure floor.** Grapes/raisins, lilies, rodenticide and antifreeze escalate on any exposure, independent of amount.

The `decided` flag is what prevents a dose band from downgrading a gate. A cat exposed to xylitol does not become `monitor` because the mg/kg happens to fall in the first band.

Each assessment carries:

- `verdict`, `headline`, `summary`
- `dosePerKg`, `doseUnit`, `amount.normalised`
- `threshold`, `nextThreshold`, `scale` (all published bands, for the UI dose scale)
- `escalation` when a later step raised an earlier verdict
- `findings[]` with the citation used for the verdict
- `signs`, `firstAid` (record-level first steps, never treatment)
- `contacts` (primary, emergency, poison control)
- `assumptions` and `limitations`

See [SAFETY.md](SAFETY.md) for the policy, and [TOXIN_CATALOGUE.md](TOXIN_CATALOGUE.md) for every band.

---

## Two-phase record changes

Changing a household record is deliberately awkward:

1. `propose_record_change` validates the action and mints `vw_<random>` bound to `clientId`, the action and the exact payload. It stores the hash, not the token, and returns the raw token plus a summary.
2. The host must read the summary back and get an explicit yes.
3. `apply_record_change` presents the token. It must be the same caller, unexpired and unused. The token is marked used **only after** the mutation succeeds, so a failed apply does not burn the confirmation.
4. A replay returns "That confirmation code was already used. Ask me to prepare the change again."

The sitter has `read`, `log` and `notify`, so Noah can assess an exposure and text Maya, but cannot stop a medicine. The smoke test asserts both halves.

---

## Authentication and scopes

| Token          | Client | Scopes                                                           |
| -------------- | ------ | ---------------------------------------------------------------- |
| `OWNER_TOKEN`  | `maya` | `vetwise.read`, `vetwise.log`, `vetwise.write`, `vetwise.notify` |
| `SITTER_TOKEN` | `noah` | `vetwise.read`, `vetwise.log`, `vetwise.notify`                  |

- Tokens are stored as SHA-256 digests and compared with `timingSafeEqual`, so the process never holds a comparable plaintext credential outside the request that presented it.
- `bearerAuth` puts only `clientId`, the granted scopes and a four-character hint on `req.auth`. `Caller` has no token field at all, so no later log line or tool result can leak one.
- The chat handler is the single place that still needs the plaintext: it reads it from the same header to make its internal `POST /mcp` call, and never stores it.
- Missing or unknown bearer → `401` with `WWW-Authenticate`.
- The MCP endpoint rejects unknown `Host` headers when `ALLOWED_HOSTS` is set (DNS-rebinding protection).
- `PUBLIC_BASE_URL` must be the URL the process can reach itself on; it is probed once after the listener opens, and a misconfiguration is reported at boot rather than per request.
- Outside demo mode (`VETWISE_DEMO=0` or `NODE_ENV=production`) the process refuses to start without explicit `OWNER_TOKEN` and `SITTER_TOKEN`, and refuses the published demo strings.
- `npm start` / `npm run dev` load `.env` when it exists (`--env-file-if-exists`). Generate a pair with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`, set both, restart, and paste the owner token into the simulator's **Paste a token…** option once. Startup logs only the first four characters.

### Sessions and limits

Chat sessions live in a `Map` keyed by `clientId:sessionId` — a caller cannot reach another person's transcript by guessing an id. Entries expire after 30 minutes and the map is capped at 200. `/api/chat` allows 20 requests per minute per token (each turn can cost several model calls) and refuses messages over 2,000 characters.

### Single process only

The JSON store serialises writes inside one process with a promise queue and `write-then-rename`. That is atomic against a crash, but **two processes sharing `data/db.json` will race** (pm2 cluster, overlapping deploys, two containers on one volume). Run one instance per data file; a multi-process deployment needs a database with OS-level locking (SQLite or Postgres). Startup warns when `WEB_CONCURRENCY > 1`.

---

## Agent layer

`scripted.ts` is a deterministic planner, not a language model. It recognises:

- care questions ("what's due tonight?")
- exposures and "can I give…?" questions
- symptom follow-ups by re-running the last exposure with merged signs
- medication logging ("give Mochi his gabapentin")
- alerts ("text Maya the summary")
- record-change proposals and yes/no confirmation
- unsafe requests ("stop his carprofen because I said so") routed through the two-phase flow

`bedrock.ts` is the optional Converse loop. `run.ts` picks Bedrock when `VETWISE_AGENT=bedrock` or credentials exist, and falls back to the scripted planner on failure, labelling the reply. The demo never requires AWS.

The scripted planner keeps a small `ScriptedState` per chat session: pending confirmation, last exposure, last reply. That is how "Now she's drooling and shaky" knows which pet and which chocolate bar.

---

## Simulator

`web/` is plain HTML/CSS/JS with no build step:

- left column: pets, tonight's doses, PRN medicines, call list
- centre: identity switcher, scope chips, chat transcript, verdict cards
- right: latest assessment (dose scale, cited evidence, copy-vet-handoff) and MCP traffic
- record-change suggestions show the confirmation buttons only after a proposal

The browser never computes a verdict. `web/app.js` renders `structuredContent` from `assess_toxin_exposure`; the dose scale is the `scale` array the server published. The handoff text is assembled from the same assessment so a caregiver can paste it into a message to the vet.

Voice input/output is browser-native (`SpeechRecognition`, `speechSynthesis`) and optional.

---

## Testing

- `tests/toxins.test.ts` — 17 unit tests: catalogue integrity, chocolate, xylitol, grapes, lilies, rodenticide/antifreeze, missing weight/species/amount/product, considering questions, symptom escalation, copy hygiene, rendering safety.
- `tests/mcp-smoke.ts` — boots the real server on `8799` with a temp data file and drives it with `@modelcontextprotocol/client`: 9 tools, care summary, all-medication filtering, five assessments, logging, restricted alerts, owner-only write, single-use token, resources, prompts, sitter scopes, 401 gate.

`npm run check` runs typecheck, unit tests and smoke.

---

## Deliberate trade-offs

- **One JSON file, not Postgres.** A hackathon demo should start with `npm start`; the store still serialises writes and writes atomically.
- **Deterministic engine, not an LLM.** The model can phrase an answer, but it cannot invent a threshold. The planner may only call tools.
- **`unverified` over coverage.** It would be easy to add a reassuring band for every toxin. The five-verdict model is more useful if "I don't know" is allowed.
- **Two-phase changes, not undo.** The token flow is more friction, but it is the difference between a sitter changing a prescription and a sitter asking the owner.
- **Scripted defaults.** The recording should work on a laptop with no cloud account. Bedrock is an upgrade, not a dependency.
