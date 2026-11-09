# Changelog

All notable changes to Vetwise are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Public-demo mode: `VETWISE_DEMO_RESET_MINUTES` reseeds the household, chat
  transcripts and MCP traffic log on a timer, and the simulator shows when the
  next reset happens. Refused under `NODE_ENV=production`.
- `Dockerfile`, `.dockerignore` and a Render blueprint (`render.yaml`) for a
  one-click hosted demo.
- README sections on deploying a public demo and connecting Claude Code,
  Claude Desktop or the MCP Inspector.
- Regression tests for the reset and its production refusal.

## [0.1.0] — 2026-11-08

First public cut: one household, dogs and cats, nine tools. The review hardening
below shipped in the same release.

### Security

- Bearer tokens are stored as SHA-256 digests and compared with
  `timingSafeEqual`; the raw token is no longer carried on `req.auth`, and
  `/api/whoami` and `/api/state` return a four-character hint only.
- Published demo tokens are confined to demo mode. `NODE_ENV=production` (or
  `VETWISE_DEMO=0`) refuses to start without explicit `OWNER_TOKEN` and
  `SITTER_TOKEN`, and rejects the demo strings.
- Chat sessions are keyed by `clientId:sessionId`, expire after 30 minutes and
  are capped at 200 entries.
- `/api/chat` is rate limited per token (20/min); oversized messages are refused
  with a generic error while the full cause goes to the operator log.
- Security headers on the static app: strict CSP, `nosniff`, `X-Frame-Options:
  DENY`, referrer and permissions policy.
- `/healthz` returns `{ ok, time }` only.
- Alert bodies are stripped of control characters and angle brackets before the
  outbox or a webhook sees them.
- `DEMO_CLOCK` is refused under `NODE_ENV=production` and warns everywhere else.
- `VETWISE_AGENT=bedrock` now requires `BEDROCK_MODEL_ID` and fails at startup if
  the model is unreachable, instead of failing on the first caregiver message.

### Fixed

- Medication route is carried through the confirmation payload instead of being
  hardcoded to `oral`.
- Care-event and household ids use 16 hex characters; the `Math.random()` ids in
  `care.ts` are gone.
- Unknown-substance assessments report a measured `latencyMs`.
- The audit log and outbox are capped at 1,000 and 100 entries.
- The Bedrock loop uses native multi-turn messages (no injected transcript
  string), aborts when a safety tool throws, and hands off to the poison-control
  number when it runs out of turns.
- The confirmation token no longer appears in the human-readable tool text.

### Changed

- The scripted planner resolves a pet from a breed ("my corgi") or the only dog
  or cat in the household, not just from the pet's name.
- An ingestion the catalogue does not recognise ("Mochi got into the trash") is
  now sent to the safety engine and answered `unverified`, instead of falling
  through to a generic menu.
- A symptom with no exposure attached ("Mochi vomited twice tonight") is logged
  as a care event and answered with the emergency clinic on the record.
- "Remind Noah…" is treated as an alert request.

### Added

- `PLAN.md`, `CHANGELOG.md`, `docs/REVIEW_RESPONSE.md`, `assets/logo.svg`,
  `assets/banner.svg` and `docs/demo.gif`.
- `npm run regress`: a regression suite that replays every finding from
  `Vetwise-Code-Review.md` over real HTTP and MCP.
- GitHub Actions CI (Node 22 and 24) and issue/PR templates, including a
  catalogue-correction form that requires a citable source.
- A delete/erase request is refused explicitly: the MCP surface has no delete
  tool.
- **MCP server** over Streamable HTTP at `/mcp`, with a fresh server instance per
  request and bearer-token authentication.
- **Nine tools**: `get_household`, `get_pet`, `get_care_summary`,
  `list_medications`, `assess_toxin_exposure`, `log_care_event`,
  `propose_record_change`, `apply_record_change`, `alert_caregiver`.
- **Six resources** and **two prompts** (`evening_check_in`,
  `something_my_pet_ate`).
- **Twenty-four toxins** with published dose bands, product strengths and a
  citation per entry: chocolate, xylitol, grapes and raisins, allium, macadamia,
  avocado, bread dough, alcohol, caffeine, salt, true lily, sago palm, azalea,
  tulip bulbs, pothos, ibuprofen, acetaminophen, aspirin, SSRIs and SNRIs,
  permethrin, rodenticide, ethylene glycol, mothballs and essential oils.
- **Deterministic safety engine** with gate evaluation, species-specific bands,
  any-exposure rules and symptom escalation that can only raise a verdict.
- **`unverified` as a first-class verdict** for a missing amount, weight,
  species, product or catalogue entry.
- **Two-phase record changes**: propose mints a single-use token bound to the
  caller; apply requires an explicit yes; replay is rejected.
- **Scope enforcement inside every tool** — `vetwise.read`, `vetwise.log`,
  `vetwise.write`, `vetwise.notify`; the sitter cannot change the record.
- **Scripted demo planner** that calls the same MCP tools a host would, plus an
  optional Amazon Bedrock Converse loop.
- **Simulator UI**: verdict cards with dose scale and cited evidence, call list,
  copy-vet-handoff, identity switcher, voice input, and a traffic panel that
  shows the server's real JSON-RPC calls.
- **Tests**: 17 safety-engine unit tests and an end-to-end transport smoke test.
- **Docs**: architecture, safety policy, toxin catalogue, demo script.

[0.1.0]: https://github.com/JawadulHadi/vetwise/releases/tag/v0.1.0
