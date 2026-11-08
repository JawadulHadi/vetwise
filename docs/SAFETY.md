# Safety policy

Vetwise is triage, not diagnosis, and not a prescription. The person using it is often frightened and may be holding a phone in one hand and a chewed package in the other. The safety rules below are enforced in code, not only in a prompt.

---

## 1. Five verdicts, one of which is "I don't know"

| Verdict             | What it means                                                        | What the person should do                                          |
| ------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `emergency`         | Signs or exposure warrant immediate emergency care                   | Go now, or call the emergency clinic and poison control on the way |
| `call_vet`          | A real toxicosis risk that needs a veterinarian's judgement          | Call the primary vet now; use the emergency clinic if closed       |
| `monitor`           | Below the first published toxic range, or low concern                | Watch for named signs; call if they appear                         |
| `no_known_toxicity` | *Reserved.* Not currently reachable for the 24 catalogued toxins     | —                                                                  |
| `unverified`        | A required fact is missing or the substance is outside the catalogue | Get the missing fact, or call poison control now                   |

`unverified` is a **successful** answer. It is never softened into "probably fine", and it always carries a concrete next step: get a weight, read the package, say whether the pet is a dog or a cat, or call the vet/poison control.

### Why `no_known_toxicity` is unreachable

Every published band in the catalogue starts at `0` and resolves to `monitor` or higher. There is no toxin for which the engine can honestly say "no known toxicity". Inventing a reassuring band to exercise the verdict would be exactly the failure mode this project is built to avoid. The verdict stays in the type and the UI so the model is complete, and is documented as reserved.

---

## 2. Missing facts never become reassurance

| Missing fact                   | Result                                                                 |
| ------------------------------ | ---------------------------------------------------------------------- |
| Species                        | `unverified` — "I need to know whether Mochi is a dog or a cat."       |
| Weight                         | `unverified` — "I need Mochi's current weight."                        |
| Amount                         | `unverified`, unless the toxin has an explicit any-exposure rule       |
| Product (for a mass exposure)  | `unverified` — white chocolate and a 65% bar are not the same question |
| Substance not in the catalogue | `unverified` — "I don't have a verified toxicosis record for X."       |

The engine returns the rationale in `summary` and a finding that names the gap. The headline is specific, not generic.

### Species gaps are not safety

A toxin with only a canine record (xylitol, grapes, macadamia) returns `unverified` for a cat. A toxin with only a feline record (lily) returns `unverified` for a dog. The summary says, in plain words, that a missing record is **not the same as safety**.

---

## 3. Any-exposure rules

Four toxins escalate before any amount is requested:

| Toxin              | Floor                                                           |
| ------------------ | --------------------------------------------------------------- |
| Grapes and raisins | `call_vet` on any exposure; `emergency` at ≥ 1 grape per 4.5 kg |
| True lily (cats)   | `emergency` on any exposure, including pollen and vase water    |
| Rodenticide        | `emergency` on any exposure                                     |
| Ethylene glycol    | `emergency` on any exposure                                     |

The tool description and the server instructions say this explicitly, so a host does not ask "how much?" before telling the person to act. Permethrin is a fifth high-risk class with a species-specific floor: any feline exposure is an `emergency` band; any canine exposure is at least `call_vet`.

The `amountOptional` flag is what lets `assess_toxin_exposure` be called with no amount at all and still return the floor.

---

## 4. Symptoms only raise a verdict

- Moderate signs (`vomiting`, `diarrhea`, `lethargy`, `drooling`, `abdominal_pain`) raise to at least `call_vet`.
- Severe signs (`seizure`, `collapse`, `tremors`, `difficulty_breathing`) raise to `emergency`.
- A mild sign can never lower an any-exposure emergency.
- A symptom follow-up re-runs the **same** exposure with the merged sign list; it does not start a new assessment from scratch.

Escalation is recorded in `escalation: { reason, from, to }` so the UI can show why the verdict changed between two turns.

---

## 5. Dose bands can raise a gate verdict, never lower one

The engine evaluates gates first (species, intent, amount, weight, product) and bands afterwards. A `decided` flag records that a gate has already set the floor. Later bands may call `setVerdict`, which only moves upward in the rank order:

```text
emergency > call_vet > monitor > no_known_toxicity > unverified
```

This is deliberate. Without it, a cat exposed to xylitol at a low mg/kg would fall into the `monitor` band and the answer would quietly become reassuring. The tests cover this class of bug.

The same rule applies to intent: "Can I give Mochi ibuprofen?" is a `call_vet` with a "Do not give…" headline, not a dose calculation. A missing amount on that question is a note, not a downgrade.

---

## 6. Evidence, not memory

- Every catalogue entry has at least one source with an HTTPS URL and a verbatim quote.
- The finding used for the verdict carries the publisher, title, URL and quote.
- Rendered text always includes an `Evidence:` line and the clinic phone numbers.
- The server instructions tell the host: ground every answer in `assess_toxin_exposure`; never call something safe from memory.
- If evidence is unavailable, the answer is `unverified`, not a confident guess.

The catalogue's sources are the Merck Veterinary Manual, Pet Poison Helpline and the ASPCA Animal Poison Control Center. Category index pages that return 404 are not used; where a specific article could not be verified, the entry cites the APCC homepage rather than a guessed URL.

---

## 7. No treatment, no vomiting, no therapeutic dosing

The engine and the prompts never:

- advise inducing vomiting
- recommend a home treatment or a dose of any medicine
- calculate a therapeutic dose for a pet
- tell someone to wait and see when the verdict is `call_vet` or `emergency`

`firstAid` on a toxin record contains only record-level first steps (move the pet away, keep the package, wash off a topical product with lukewarm water and mild soap, call the vet). It is labelled "First steps on the record" in the UI, not "treatment".

Every non-trivial answer names:

- the primary vet and phone
- the emergency clinic
- ASPCA APCC `(888) 426-4435`
- Pet Poison Helpline `(855) 764-7661`

The rendered-text test asserts that a clinic number and poison control appear and that phrases like "treat at home" or "give N mg" do not.

---

## 8. Record changes are two-phase and caller-bound

| Step      | Guarantee                                                                                           |
| --------- | --------------------------------------------------------------------------------------------------- |
| Propose   | Requires `vetwise.write`; validates the action and payload; stores only a SHA-256 hash of the token |
| Read back | The response includes a human summary and the expiry time                                           |
| Confirm   | The host must get an explicit yes from the person                                                   |
| Apply     | Same `clientId`, unexpired, unused; the token is marked used only after the mutation succeeds       |
| Replay    | Rejected with "That confirmation code was already used. Ask me to prepare the change again."        |

A sitter cannot stop a medicine. The sitter token has `read`, `log` and `notify`; the tool error names the missing `vetwise.write` scope. The smoke test asserts both the denial and the owner's successful apply.

---

## 9. Alerts stay inside the household

`alert_caregiver` resolves the recipient against the people on the household record. A phone number or name not on file is rejected with "I can only alert people in this household… I will not send to an outside contact." This prevents a prompt-injected or confused host from texting an arbitrary number.

Optional webhook delivery records the result in the outbox. Without a webhook, alerts are queued in the outbox only; the UI says "queued", not "delivered".

---

## 10. Scope checks live inside the tools

The bearer gate authenticates the caller; it does not decide what the caller may do. Every tool calls `requireScope` against the `AuthInfo` forwarded by the MCP integration. This matters because the agent is also an MCP client: if the browser switches to Noah, the planner's calls are Noah's calls, and write attempts fail at the tool boundary.

`/api/whoami` returns a token prefix, never the usable token. `/api/state` exposes only the publishable household snapshot.

---

## 11. Privacy and data handling

- The store is one local JSON file (`VETWISE_DATA`); nothing is sent to a third party in scripted mode.
- Bedrock mode sends the conversation and tool results to Amazon Bedrock. The demo does not require it.
- The traffic log is in memory, capped at 80 entries, and cleared when the process restarts.
- Confirmations store a hash, not the token.
- Demo tokens are not secrets and should be replaced before exposing the server beyond localhost.

---

## 12. Known limitations

- **Bands are shared across dog and cat for most medicines.** The sources do not always publish separate feline numbers. Species-specific records exist where the source supports them (xylitol, grapes, macadamia, lily, permethrin).
- **Product concentrations vary.** Without a product, a mass exposure is `unverified`. Spot-on flea products are the clearest example.
- **The catalogue is not exhaustive.** 24 toxins cover the common household calls, not every possible substance. An unknown substance is `unverified`.
- **The scripted planner is pattern-based.** It recognises the demo vocabulary; Bedrock is the open-ended path. Both call the same tools.
- **Triage, not diagnosis.** A veterinarian who examines the pet may reach a different conclusion. The answer says so.
- **Time matters.** The engine does not model absorption curves or hours-since-ingestion. It reports the exposure as described and names the vet.

---

## 13. Review checklist for a new rule

Before merging a change that affects a verdict:

- [ ] Is the threshold in a cited source, with a verbatim quote?
- [ ] Does a missing fact still return `unverified`, or does it now guess?
- [ ] Can a later step lower a gate verdict? It must not.
- [ ] Does a mild symptom downgrade an emergency? It must not.
- [ ] Does the answer name a clinic and poison control?
- [ ] Does it avoid treatment advice, inducing vomiting and therapeutic dosing?
- [ ] Is there a test that asserts the **refusal**, not just the happy path?
- [ ] Does `npm run check` pass, including the transport smoke test?
