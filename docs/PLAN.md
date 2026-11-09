# Vetwise — build plan

This is the plan the project was built against, kept current so the repo shows
what is done, what is deliberately out of scope, and what is next.

Status legend: **done** · **next** · **out of scope for v1**

---

## Problem

A dog eats a dark chocolate bar at 9:40 PM. The person who notices is not the
owner, the primary vet is closed, and the internet says both "it's fine" and
"go to the ER". The hard part is not finding a chocolate toxicity chart. It is
knowing **which pet, how heavy, which product, how much, and what the published
thresholds actually say** — and knowing when the honest answer is "I cannot
verify this".

Vetwise is an MCP server that owns one household's pet record and answers that
question with species- and weight-aware maths plus a citation. It never
prescribes, never advises inducing vomiting, and never turns a missing fact into
reassurance.

## Users

| User | What they need |
|---|---|
| Owner (Maya) | One place that knows both pets, their medicines, and what to tell the sitter |
| Pet sitter (Noah) | Read the record and log care without being able to change prescriptions |
| Host / agent | A machine-readable safety verdict it can quote, with the evidence attached |

## Design commitments

These are non-negotiable and every milestone is judged against them.

1. **The server owns the record.** The UI is a view; every answer the page shows
   arrived through a real JSON-RPC `tools/call` against `/mcp`.
2. **`unverified` is a first-class verdict.** Missing amount, weight, species,
   product or substance is never softened into "probably fine".
3. **Grounded citations.** Every verdict carries the source and access date;
   every non-trivial answer names the vet, the ER and poison control.
4. **Deterministic safety engine.** No model decides a verdict. The engine
   evaluates gates, then published bands, and bands may only raise the floor.
5. **Two-phase record changes.** Propose mints a single-use, caller-bound token;
   apply requires an explicit yes. A sitter cannot write at all.
6. **Scopes are checked inside the tool**, not at the route.
7. **No treatment advice, ever.** Name the number and get out of the way.

---

## Milestones

### M0 — Foundation · done

- [x] Repository, TypeScript, `tsx` runtime, no build step for the server
- [x] Domain types for people, pets, medications, care logs, exposures
- [x] JSON store with a single-file household record and atomic writes
- [x] Seeded demo household: 2 people, 2 pets, 5 medicines, 24 toxins

### M1 — Safety engine · done

- [x] 24-toxin catalogue with published bands, product strengths and citations
- [x] Gate evaluation: species, intent, amount, weight, product
- [x] `decided` flag so a dose band can raise a gate but never lower it
- [x] Any-exposure rules for grapes, lilies, rodenticide, ethylene glycol
- [x] Permethrin species-specific bands (cats: emergency on any exposure)
- [x] Symptom escalation that only ever raises the verdict
- [x] Rendered-text rules: no dosing, no "probably fine", numbers always named
- [x] 17 unit tests covering the engine and its copy

### M2 — MCP surface · done

- [x] Streamable HTTP transport at `/mcp`, bearer auth, host allow-list
- [x] 10 tools with zod schemas and `structuredContent`
- [x] 6 resources (`household`, `pet`, `care`, `medications`, `toxins`, `toxin`)
- [x] 2 prompts (`evening_check_in`, `something_my_pet_ate`)
- [x] Scope checks inside every tool (`read`, `log`, `write`, `notify`)
- [x] Single-use, caller-bound, expiring confirmation tokens
- [x] End-to-end transport smoke test against a real client

### M3 — Demo experience · done

- [x] Scripted planner that composes answers from tool results, not canned text
- [x] Optional Bedrock Converse loop as an LLM fallback
- [x] Three-column simulator with verdict cards, dose scale and evidence
- [x] Honest MCP traffic panel backed by the server's own log
- [x] Identity switcher that really swaps scopes (sitter write is denied)
- [x] Copy-vet-handoff button that assembles a call-ready summary
- [x] Voice input and spoken replies (browser APIs, no server dependency)
- [x] Demo screenshot in `docs/screenshots/demo.png`
- [x] Demo GIF walkthrough in `docs/demo.gif`

### M4 — Project hygiene · done

- [x] README, architecture, safety policy, toxin catalogue, demo script
- [x] MIT licence, `CHANGELOG.md`, `PLAN.md`, issue/PR templates
- [x] CI workflow: typecheck, unit tests, smoke test on Node 24 and 26
- [x] Logo and repository banner under `assets/`
- [x] `v0.1.0` tag and GitHub release with notes

---

## Known gaps

These are real and recorded on purpose. They are the first entries in the
backlog, not surprises.

| Gap | Impact | Next step |
|---|---|---|
| The scripted planner is a keyword router | Unusual phrasings fall back to a menu; "my dog is limping" is not a logged symptom | Broaden intent coverage, or default to Bedrock when credentials exist |
| No delete or edit tool | A record entry cannot be corrected from an MCP host | Add an owner-only `amend_care_event` with the same two-phase token |
| One household per process | A second household needs a second deployment | Tenant id in the store and token record |
| 24 toxins | Common but not exhaustive | Grow the catalogue with a citation per entry; keep the unknown path |
| Scripted agent is English-only | Regexes are English | Locale-aware planner or model fallback |

## Non-goals for v1

- Diagnosis, dosing, or any treatment instruction
- Calculating a dose of any medication
- Storing payment, insurance or vet-invoice data
- Multi-tenant hosting, SSO, or an admin console
- Replacing a veterinarian, an ER, or poison control

## Definition of done

A milestone is done when the behaviour is covered by a test or a smoke
assertion, the docs describe it, and the demo still tells the same 90-second
story without a manual step.
