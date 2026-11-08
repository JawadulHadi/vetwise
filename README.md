# Vetwise

A self-hosted MCP server that owns a household's pet records and answers **"is this safe for my pet?"** with species- and weight-aware toxicosis math and cited veterinary sources.

Vetwise is built for the ten minutes after a pet eats something wrong: a dog into a chocolate bar, a cat near a lily, a sitter who is not sure whether the evening dose was given. It is not a chatbot with a toxicology page pasted into its prompt. The server owns the household record, runs a deterministic safety engine, and returns one of five verdicts — including `unverified` when a fact is missing. A host (Claude, Alexa+, a local UI) talks to it over Streamable HTTP with a scoped bearer token.

> Not veterinary advice. Vetwise names the veterinarian and poison-control numbers; it never advises treatment or inducing vomiting.

![The Vetwise simulator after a chocolate exposure escalates to an emergency: dose math, the published dose scale, the Merck citation, the call list, and the MCP traffic panel](docs/screenshots/demo.png)

---

## Run the demo

```bash
npm install
cp .env.example .env        # optional; every value has a working demo default
npm start                   # http://127.0.0.1:8787
```

Open <http://127.0.0.1:8787>. The demo clock is frozen at **21:40**; the household has two pets and two doses still due. The page is a simulator: every answer it shows came from a real JSON-RPC `tools/call` against `/mcp`, and the traffic panel lists those calls.

Suggested first line: **“What's due tonight?”**

The full scripted walkthrough is in [docs/DEMO.md](docs/DEMO.md).

### Demo household

| | |
|---|---|
| Household | The Chen–Patel house, Sacramento, CA |
| Owner | Maya Chen — read, log, write, notify |
| Sitter | Noah Patel — read, log, notify (no record changes) |
| Dog | Mochi, Pembroke Welsh Corgi, 5 y, 13.6 kg |
| Cat | Juniper, Domestic Shorthair, 9 y, 4.6 kg |
| Primary vet | Cedar Creek Animal Hospital (Dr. Priya Raman) — `+1-916-555-0142` |
| Emergency | Sacramento Veterinary Emergency & Specialty — `+1-916-555-0199` |
| Poison control | ASPCA APCC `(888) 426-4435` · Pet Poison Helpline `(855) 764-7661` |

---

## What is inside

### 9 MCP tools

| Tool | Scope | What it does |
|---|---|---|
| `get_household` | `read` | People, pets, clinics in one call |
| `get_pet` | `read` | One pet, every medicine including stopped ones, today's care |
| `get_care_summary` | `read` | Taken / skipped / missed / due / upcoming for a day |
| `list_medications` | `read` | Filter by pet; `status: "all"` really means all |
| `assess_toxin_exposure` | `read` (+ `log` to record) | The safety engine: verdict, dose math, cited evidence |
| `log_care_event` | `log` | Medication, symptom, weight or note; never guesses a slot |
| `propose_record_change` | `write` | Phase one: mint a single-use confirmation token |
| `apply_record_change` | `write` | Phase two: apply the token after an explicit yes |
| `alert_caregiver` | `notify` | Queue a message to a person already on the record |

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

```
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

| Variable | Default | Purpose |
|---|---|---|
| `PORT` / `HOST` | `8787` / `127.0.0.1` | HTTP listener |
| `PUBLIC_BASE_URL` | `http://127.0.0.1:8787` | URL the simulator uses to reach its own `/mcp` |
| `VETWISE_DATA` | `./data/db.json` | JSON store; delete to reseed the demo |
| `DEMO_CLOCK` | unset (real time) | `21:40` freezes the demo narrative; ISO timestamps also accepted |
| `OWNER_TOKEN` | `maya-owner-demo-token` | Owner bearer token |
| `SITTER_TOKEN` | `noah-sitter-demo-token` | Sitter bearer token |
| `VETWISE_AGENT` | `scripted` when no credentials | `scripted` or `bedrock` |
| `ALLOWED_HOSTS` | empty | Required behind a tunnel; prevents DNS rebinding |
| `CAREGIVER_WEBHOOK_URL` | empty | If set, alerts are POSTed and delivery is recorded |

Run with an env file if you prefer:

```bash
node --env-file=.env --import tsx src/index.ts
```

---

## Scripts

```bash
npm run typecheck   # tsc --noEmit
npm test            # safety-engine unit tests (17)
npm run smoke       # boots the real server and drives it with a real MCP client
npm run check       # all three
npm run dev         # tsx watch
```

The smoke test starts its own server on port `8799` with a temporary data file, exercises all 9 tools, both identities, resources, prompts, single-use confirmations and the 401 gate, then removes its data.

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

## Licence

MIT — see [LICENSE](LICENSE).
