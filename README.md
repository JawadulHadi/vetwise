<p align="center">
  <img src="assets/banner.svg" alt="Vetwise — pet toxicosis and medication safety, grounded in the household record" width="100%">
</p>

<p align="center">
  <a href="LICENSE"><img alt="Licence: MIT" src="https://img.shields.io/badge/licence-MIT-8FE3BD"></a>
  <img alt="Node 24 or 26" src="https://img.shields.io/badge/node-24%20%7C%2026-8FE3BD">
  <img alt="Tests: 17 unit + transport smoke" src="https://img.shields.io/badge/tests-17%20unit%20%2B%20smoke-8FE3BD">
  <a href="https://modelcontextprotocol.io"><img alt="MCP: Streamable HTTP" src="https://img.shields.io/badge/MCP-streamable%20HTTP-F2B45C"></a>
  <img alt="Release: v0.2.0" src="https://img.shields.io/badge/release-v0.2.0-F2705A">
</p>

# Vetwise

A self-hosted MCP server that owns a household's pet records and answers **"is this safe for my pet?"** with species- and weight-aware toxicosis math and cited veterinary sources.

Vetwise is built for the ten minutes after a pet eats something wrong: a dog into a chocolate bar, a cat near a lily, a sitter who is not sure whether the evening dose was given. It is not a chatbot with a toxicology page pasted into its prompt. The server owns the household record, runs a deterministic safety engine, and returns one of five verdicts — including `unverified` when a fact is missing. A host (Claude, Alexa+, a local UI) talks to it over Streamable HTTP with a scoped bearer token.

> Not veterinary advice. Vetwise names the veterinarian and poison-control numbers; it never advises treatment or inducing vomiting.

**Try it live:** [VetWise](https://vetwise-demo.onrender.com). The demo household resets every 30 minutes. It runs on Render's free plan, so the first request after a quiet spell can take up to a minute while the server wakes.

![The Vetwise simulator after a chocolate exposure escalates to an emergency: dose math, the published dose scale, the Merck citation, the call list, and the MCP traffic panel](docs/screenshots/demo.png)

---

## Run the demo

```bash
npm install
cp .env.example .env        # optional; every value has a working demo default
npm start                   # http://127.0.0.1:3000
```

Open <http://127.0.0.1:3000>. The demo clock is frozen at **21:40**; the household has two pets and two doses still due. The page is a simulator: every answer it shows came from a real JSON-RPC `tools/call` against `/mcp`, and the traffic panel lists those calls.

Suggested first line: **“What's due tonight?”**

The full scripted walkthrough is in [docs/DEMO.md](docs/DEMO.md).

<p align="center">
  <img src="docs/demo.gif" alt="Vetwise demo: a chocolate exposure gets dose math and a call_vet verdict, a reported symptom escalates it to emergency, and the owner is alerted — with every MCP call listed in the traffic panel" width="100%">
</p>

### Demo household

|                |                                                                    |
| -------------- | ------------------------------------------------------------------ |
| Household      | The Chen–Patel house, Sacramento, CA                               |
| Owner          | Maya Chen — read, log, write, notify                               |
| Sitter         | Noah Patel — read, log, notify (no record changes)                 |
| Dog            | Mochi, Pembroke Welsh Corgi, 5 y, 13.6 kg                          |
| Cat            | Juniper, Domestic Shorthair, 9 y, 4.6 kg                           |
| Primary vet    | Cedar Creek Animal Hospital (Dr. Priya Raman) — `+1-916-555-0142`  |
| Emergency      | Sacramento Veterinary Emergency & Specialty — `+1-916-555-0199`    |
| Poison control | ASPCA APCC `(888) 426-4435` · Pet Poison Helpline `(855) 764-7661` |

---

## What is inside

### 10 MCP tools

| Tool                    | Scope                      | What it does                                                 |
| ----------------------- | -------------------------- | ------------------------------------------------------------ |
| `get_household`         | `read`                     | People, pets, clinics in one call                            |
| `get_pet`               | `read`                     | One pet, every medicine including stopped ones, today's care |
| `get_care_summary`      | `read`                     | Taken / skipped / missed / due / upcoming for a day          |
| `list_medications`      | `read`                     | Filter by pet; `status: "all"` really means all              |
| `list_exposures`        | `read`                     | Recorded exposures, newest first; filter by pet and day      |
| `assess_toxin_exposure` | `read` (+ `log` to record) | The safety engine: verdict, dose math, cited evidence        |
| `log_care_event`        | `log`                      | Medication, symptom, weight or note; never guesses a slot    |
| `propose_record_change` | `write`                    | Phase one: mint a single-use confirmation token              |
| `apply_record_change`   | `write`                    | Phase two: apply the token after an explicit yes             |
| `alert_caregiver`       | `notify`                   | Queue a message to a person already on the record            |

### 6 resources

`vetwise://household`, `vetwise://pets/{petId}`, `vetwise://care/today`, `vetwise://medications`, `vetwise://toxins`, `vetwise://toxins/{toxinId}`.

### 2 prompts

`evening_check_in` and `something_my_pet_ate` — the two shapes a real host would ship as suggested actions.

### 24 catalogued toxins

Foods, plants, human medicines, pesticides and household products. Every entry carries a published source URL and a verbatim quote. The full table with thresholds is in [docs/TOXIN_CATALOGUE.md](docs/TOXIN_CATALOGUE.md).

### Verdicts

`emergency` · `call_vet` · `monitor` · `no_known_toxicity` · `unverified`

`unverified` is a first-class answer. Missing weight, amount, species, product or a substance outside the catalogue never becomes reassurance. Grapes/raisins, lilies, rodenticide and antifreeze escalate on **any** exposure, before any amount is requested.

---

## How a request flows

```markdown
browser / host
   │  Bearer token
   ▼
Express  ──►  /mcp  ──►  MCP server (tools · resources · prompts)
   │                         │
   │                         ├─ scope check inside every tool
   │                         ├─ deterministic safety engine
   │                         └─ JSON-file store (atomic writes)
   │
   ├─ /api/chat  ──►  scripted planner or Bedrock planner
   │                    └─ its own short-lived MCP client ──► /mcp
   ├─ /api/state ──►  household snapshot + MCP traffic log
   └─ /            ──►  static simulator
```

The planner has no private access to the store. It is just another MCP client, authenticated with the same token the browser sent, so the traffic panel shows exactly what the model saw and called.

Deeper design notes: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Safety policy: [docs/SAFETY.md](docs/SAFETY.md).

---

## Agent modes

- **`scripted`** (default with no AWS credentials) — a deterministic planner that recognises exposure, symptom follow-up, medication logging, alerts and two-phase record changes. No network model call.
- **`bedrock`** — Amazon Bedrock Converse tool loop (`VETWISE_AGENT=bedrock`, AWS credentials required). If Bedrock fails, the turn falls back to the scripted planner and labels the answer.

Both paths call the same MCP tools over the same transport. The UI badge says which planner answered.

---

## Configuration

Copy `.env.example` to `.env`. The values that matter:

| Variable                     | Default                          | Purpose                                                                                                         |
| ---------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `PORT` / `HOST`              | `3000` / `127.0.0.1`             | HTTP listener                                                                                                   |
| `PUBLIC_BASE_URL`            | `http://127.0.0.1:3000`          | URL the simulator uses to reach its own `/mcp`                                                                  |
| `VETWISE_DATA`               | `./data/db.json`                 | JSON store; delete to reseed the demo                                                                           |
| `DEMO_CLOCK`                 | unset (real time)                | `21:40` freezes the demo narrative; refused when `NODE_ENV=production`                                          |
| `OWNER_TOKEN`                | demo token when `VETWISE_DEMO`   | Owner bearer token — required outside demo mode                                                                 |
| `SITTER_TOKEN`               | demo token when `VETWISE_DEMO`   | Sitter bearer token — required outside demo mode                                                                |
| `VETWISE_DEMO`               | `1` unless `NODE_ENV=production` | Allow the published demo tokens; set `0` to require real ones                                                   |
| `VETWISE_AGENT`              | `scripted` when no credentials   | `scripted` or `bedrock`                                                                                         |
| `BEDROCK_MODEL_ID`           | `amazon.nova-lite-v1:0`          | Required when `VETWISE_AGENT=bedrock`                                                                           |
| `ALLOWED_HOSTS`              | empty                            | Required behind a tunnel; prevents DNS rebinding                                                                |
| `CAREGIVER_WEBHOOK_URL`      | empty                            | If set, alerts are POSTed and delivery is recorded                                                              |
| `VETWISE_DEMO_RESET_MINUTES` | unset (off)                      | Public demos: reseed the household, transcripts and traffic every N minutes; refused when `NODE_ENV=production` |

`npm start` and `npm run dev` load `.env` automatically when the file exists. Running the entry point by hand works too: `node --env-file=.env --import tsx src/index.ts`.

### Tokens and write access

The simulator's **Signed in as** picker switches identity. Both demo tokens are published on purpose and only work in demo mode:

| Identity            | Token                    | Scopes                                      |
| ------------------- | ------------------------ | ------------------------------------------- |
| Maya Chen — owner   | `maya-owner-demo-token`  | `read`, `log`, `write`, `notify`            |
| Noah Patel — sitter | `noah-sitter-demo-token` | `read`, `log`, `notify` (no record changes) |

A record change sent as Noah is refused with *"This token is missing the `vetwise.write` scope"* — that is the safety model working. Switch the picker to **Maya Chen — owner**, or use the **Switch to Maya Chen — owner** button that appears on the refusal.

**Generate real tokens** before exposing the server:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
# run it twice: one for OWNER_TOKEN, one for SITTER_TOKEN
```

Then in `.env`:

```dotenv
VETWISE_DEMO=0
OWNER_TOKEN=<first value>
SITTER_TOKEN=<second value>
```

Restart the server. Startup prints only the first four characters of each token, so keep the values somewhere safe. The UI knows the two demo tokens; for your own pair choose **Paste a token…** in the picker once and it is remembered in `localStorage` for that browser. A pasted token is only accepted if the server was started with that exact value — generating a string and pasting it into the UI does not register it. `VETWISE_DEMO=0` (or `NODE_ENV=production`) makes the server refuse to start without both values, and it rejects the published demo strings.

---

## Deploy a public demo

A hosted demo lets a buyer try every tool, writes included, from a link. Strangers will change the record, so a public demo turns on the reset: the household, chat transcripts and traffic panel are reseeded every `VETWISE_DEMO_RESET_MINUTES`, and the simulator shows a "Public demo · resets in N min" notice. Requests still running when a reset fires cannot write into the fresh household, and if a reset cannot be saved, `/healthz` answers 503 and the demo refuses requests until the next attempt succeeds.

**Live demo:** <https://vetwise-demo.onrender.com>, deployed from `main` with the settings below (auto-deploys on every push).

**Render (one click).** `render.yaml` describes a free Docker web service with the demo clock at 21:40 and a 30-minute reset. In Render choose *New → Blueprint*, pick this repository, and deploy.

**Any container host.**

```bash
docker build -t vetwise .
docker run -p 3000:3000 -e DEMO_CLOCK=21:40 -e VETWISE_DEMO_RESET_MINUTES=30 vetwise
```

The image binds `0.0.0.0`, runs the scripted planner, keeps its data in `/app/data` (mount a volume to keep a real household), and has a `/healthz` health check. Render and similar hosts set `PORT`; the server's self-call follows it.

A public demo runs on the published demo tokens. For a real household, set `NODE_ENV=production`, `OWNER_TOKEN` and `SITTER_TOKEN`, and leave `DEMO_CLOCK` and `VETWISE_DEMO_RESET_MINUTES` unset; the server refuses to start otherwise.

---

## Connect from an MCP client

The server speaks Streamable HTTP at `/mcp` with a bearer token. Replace the URL with your deployment and the token with the owner or sitter token.

**Claude Code**

```bash
claude mcp add --transport http vetwise https://your-host/mcp \
  --header "Authorization: Bearer maya-owner-demo-token"
```

**Claude Desktop** (through the `mcp-remote` bridge, in `claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "vetwise": {
      "command": "npx",
      "args": ["mcp-remote", "https://your-host/mcp", "--header", "Authorization:${VETWISE_AUTH}"],
      "env": { "VETWISE_AUTH": "Bearer maya-owner-demo-token" }
    }
  }
}
```

**MCP Inspector**: `npx @modelcontextprotocol/inspector`, transport *Streamable HTTP*, URL `https://your-host/mcp`, header `Authorization: Bearer …`.

Then ask the host "Mochi ate half a bar of dark chocolate" and watch the same tools the simulator uses.

---

## Scripts

```bash
npm run typecheck   # tsc --noEmit
npm test            # safety-engine unit tests (17)
npm run smoke       # boots the real server and drives it with a real MCP client
npm run regress     # replays every finding in Vetwise-Code-Review.md
npm run check       # all four
npm run dev         # tsx watch
```

The smoke test starts its own server on port `8799` with a temporary data file, exercises all 10 tools, both identities, resources, prompts, single-use confirmations and the 401 gate, then removes its data. `npm run regress` boots a second server on `8811` and asserts the review fixes over real HTTP and MCP: hashed tokens, caller-bound sessions, `/healthz` minimalism, security headers, rate limiting, sanitised alert bodies, medication routes, id length, and the startup refusals.

---

## Security posture

- Bearer tokens are stored as SHA-256 digests and compared with `timingSafeEqual`; the raw secret never leaves the request that carried it, and `/api/whoami` only ever returns a four-character hint.
- Published demo tokens work only in demo mode. `NODE_ENV=production` (or `VETWISE_DEMO=0`) refuses to start without `OWNER_TOKEN` and `SITTER_TOKEN`, and rejects the demo strings outright.
- Chat sessions are keyed by `clientId:sessionId`, expire after 30 minutes, and are capped at 200.
- `/api/chat` is rate limited per token (20/min), request bodies over 2,000 characters are refused, and the client sees one generic error while the operator sees the full cause.
- The static app is served with a strict CSP (`default-src 'self'`), `nosniff`, `X-Frame-Options: DENY` and no third-party origins.
- `/healthz` returns `{ ok, time }` only; version, agent mode and model are not public.
- Alert bodies are stripped of control characters and angle brackets before they reach the outbox or a webhook.
- `npm run regress` proves each of those still holds.

---

## Safety posture

- The engine **never** invents a threshold. Every band traces to a cited source, and every answer carries the evidence it used.
- Missing facts produce `unverified` with a concrete next step (get a weight, read the package, call poison control).
- Symptoms can only raise a verdict, never lower it.
- Dose bands can raise a gate verdict but never lower one.
- Record changes are two-phase and bound to the caller; replay is rejected.
- Alerts go only to people on the household record.
- No treatment advice, no induced vomiting, no therapeutic dosing. Ever.

`no_known_toxicity` exists as a verdict but is currently unreachable for the 24 catalogued toxins: every published band starts at 0 and resolves to `monitor` or higher. It is documented as reserved rather than used to manufacture false reassurance. See [docs/SAFETY.md](docs/SAFETY.md).

---

## Deliberately not included

Vetwise is sized for one household on one process. These are decisions, not a backlog:

- **No accounts, OAuth or SSO.** Two bearer tokens — owner and sitter — express the only two roles this record needs. The token is the identity.
- **No multi-tenant database.** One serialised JSON file, written atomically. A second household should be a second deployment; a shared Postgres would add tenancy, migrations and backups without making any safety answer better.
- **No admin console or password reset.** Change the tokens in `.env` and restart.
- **No diagnosis, treatment or dosing.** The engine triages and names a veterinarian or poison-control number. It never says what to give or to induce vomiting.
- **No deletion or in-place editing.** From outside, the record is append-only; corrections go through the owner and the two-phase confirmation.

Revisit the first two only if a second household needs the same instance, or real records are hosted for other people. That is a v2 architecture decision, not a missing feature.

---

## Licence

MIT — see [LICENSE](LICENSE).
