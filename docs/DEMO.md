# Demo script

A 2–3 minute walkthrough that shows the whole product: a household record, grounded toxicosis math, `unverified` refusal, symptom escalation, a two-phase record change, and a sitter who cannot change a prescription.

---

## Before you start

```bash
npm install
npm run check          # optional but reassuring: 17 unit tests + transport smoke
npm start
```

Open <http://127.0.0.1:8787>. The server prints the two demo tokens and the data file it is using. The clock is frozen at **9:40 PM** by `DEMO_CLOCK=21:40`; the seeded household has two doses still due.

**Reset between takes:**

```bash
# stop the server, then:
rm data/db.json
npm start
```

The demo reseeds only when the file is absent. `npm start` with `VETWISE_DATA` pointing elsewhere works too.

The screenshot used in the README lives at `docs/screenshots/demo.png`. Regenerate it after a reset at the end of the chocolate flow.

---

## The 90-second version

| # | Say | What it proves |
|---|---|---|
| 1 | “What's due tonight?” | The server owns the record; two doses are due |
| 2 | “Mochi got into my 65% dark chocolate. She ate about 40 grams.” | Species + weight + product + dose math + cited evidence |
| 3 | “Now she's drooling and shaky.” | Symptoms re-run the same exposure and escalate to emergency |
| 4 | “Text Maya the summary.” | Alerts stay inside the household |
| 5 | “Stop Mochi's carprofen — the vet said to.” | Phase one: nothing changes yet |
| 6 | click **Yes, apply it** (or say “yes”) | Phase two: the token is applied once |
| 7 | switch identity to **Noah Patel (sitter)** and repeat step 5 | `vetwise.write` is missing; the record is safe |

---

## Full walkthrough

### 1. The evening check-in

**Say:** `What's due tonight?`

> It is 9:40 PM. Due now: Juniper — Methimazole 2.5 mg (8:00 PM); Mochi — Gabapentin 100 mg (9:00 PM). 2 doses logged as taken today.

The transcript shows one chip: `get_care_summary`. The left column shows the same two doses and the PRN medicine. The traffic panel on the right shows the matching `tools/call`.

**Point out:** Vetwise is not guessing from a prompt. It read the household's own medication schedule.

### 2. The chocolate incident

**Say:** `Mochi got into my 65% dark chocolate. She ate about 40 grams.`

> Call your veterinarian about Mochi now. 404 mg for a 13.6 kg dog is about **29.71 mg/kg** methylxanthines. That falls in the “Mild methylxanthine signs expected” band, which starts at 20 mg/kg methylxanthines. Call Cedar Creek Animal Hospital (Dr. Priya Raman) at +1-916-555-0142; if it is closed, call Sacramento Veterinary Emergency & Specialty. Source: Merck Veterinary Manual — https://www.merckvetmanual.com/toxicology/food-hazards/chocolate-toxicosis-in-animals. This is on the household record.

The verdict card in the right column shows:
- verdict **Call your vet**
- the dose math (`29.71 mg/kg` from 404 mg ÷ 13.6 kg)
- the dose scale with the marker between 20 and 40 mg/kg
- the Merck quote and link
- the clinic and poison-control numbers
- **Copy vet handoff**

**Point out:** 404 mg is 40 g × 10.1 mg/g for a 65% bar. The threshold and the methylxanthine content both come from the cited source. Change the product to white chocolate and the same 40 g is `monitor`; remove the product and the answer is `unverified`. That is the whole design in one comparison.

### 3. The symptom follow-up

**Say:** `Now she's drooling and shaky.`

> Mochi is showing emergency signs. Go now. 404 mg for a 13.6 kg dog is about 29.71 mg/kg methylxanthines. That falls in the “Mild methylxanthine signs expected” band, which starts at 20 mg/kg methylxanthines. Call Sacramento Veterinary Emergency & Specialty at +1-916-555-0199 now. Source: Merck Veterinary Manual — … This is on the household record.

The verdict card flips to **Emergency** and the headline changes. The dose math is unchanged; the symptoms raised the verdict. The server records an `escalation` from `call_vet` to `emergency`.

**Point out:** The agent did not start a new assessment. It re-ran the last exposure with the merged sign list, because “she” refers to Mochi and the chocolate is still the exposure.

### 4. Tell the owner

**Say:** `Text Maya the summary.`

> Queued a text to Maya Chen. It is in the outbox and will be delivered to the number on file.

One `alert_caregiver` call. The outbox entry is visible in the API/state and the UI's exposure history. Try `Text +1-555-999-0000` and the server refuses: it only alerts people on the household record.

### 5. A record change, in two phases

**Say:** `Stop Mochi's carprofen — the vet said to.`

> Stop Carprofen 25 mg for Mochi — the vet said to. I have not changed anything yet — say yes and I will apply it. Never stop a prescribed medicine without your veterinarian's agreement.

Nothing has changed. The response carries a `vw_…` token bound to Maya and to that exact action. The UI shows **Yes, apply it** and **Not now**.

**Say:** `yes` (or click the button)

> Done — Stopped Carprofen 25 mg — the vet said to. The change is on the household record.

Now the medication list shows Carprofen as stopped, with the reason. Replaying the same token fails with “That confirmation code was already used. Ask me to prepare the change again.”

**Point out:** The token is single-use, caller-bound and stored only as a hash. A failed apply does not burn the confirmation.

### 6. The sitter

Switch the identity picker in the header to **Noah Patel (pet sitter)**. The scope chips show `read`, `log`, `notify`; `write` is off.

**Say:** `Stop Mochi's gabapentin — the vet said to.`

> This token is missing the vetwise.write scope. Ask Maya, the account owner, for access.

Noah can still:
- ask what is due
- assess an exposure (which records it, because Noah has `log`)
- text Maya (because Noah has `notify`)

He cannot stop a medicine or change a weight. That is the scope model working at the tool boundary, not just in the UI.

Switch back to **Maya Chen (owner)** for the rest of the demo.

### 7. Care logging

**Say:** `Give Mochi his gabapentin.`

> Logged Gabapentin 100 mg at 21:00 as taken for Mochi. Anything else?

The left column marks the 9:00 PM dose taken; “What's due tonight?” now reports one due dose. If a medicine has two unlogged doses in a day, the tool refuses to guess and asks for `scheduledTime`.

### 8. Refusal as a feature

Try any of these:

| Say | Expected |
|---|---|
| `Mochi ate some chocolate.` | `unverified` — product and amount missing; asks for both |
| `Juniper ate a lily.` | `emergency` — any feline exposure, no amount requested |
| `Mochi ate a grape.` | `call_vet` — any exposure; emergency at ≥ 1 grape per 4.5 kg |
| `Can I give Mochi ibuprofen?` | `call_vet` with a “Do not give…” headline, no dose |
| `Mochi got into glitter glue.` | `unverified` — outside the catalogue, never reassuring |
| `Mochi ate 3 pieces of sugar-free gum.` | `call_vet` or `emergency` depending on the 13.6 kg dose; xylitol is dogs only |

The point of the demo is not that Vetwise always has an answer. It is that Vetwise never turns a missing fact into reassurance.

---

## What each panel shows

- **Left — household.** Pets with species and weight (the numbers the engine uses), tonight's doses with status, PRN medicines, and the three phone numbers a frightened person needs.
- **Centre — conversation.** Your message, the agent's reply, the MCP tool chips, and any confirmation buttons.
- **Right top — latest assessment.** Verdict, headline, dose math, dose scale, cited evidence, signs to watch for, contacts, and the copy-vet-handoff button.
- **Right bottom — MCP traffic.** Every JSON-RPC method and tool name with duration and status. The traffic is the server's own log; it is not synthesized by the page.

---

## Voice

The microphone button uses the browser's `SpeechRecognition`; spoken replies use `speechSynthesis`. The mute button persists across reloads. Voice is optional and never required for the demo. If the browser has no speech input, the mic shows a toast and typing still works.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| The page loads but every call is 401 | Use one of the tokens printed at startup, or the identity picker |
| “I have no verified toxicosis record…” | The substance is outside the 24-entry catalogue — intentional |
| The demo already has exposures / stopped medicines | Delete `data/db.json` and restart |
| Port 8787 is busy | `PORT=8788 npm start`, or stop the old process |
| The demo clock shows the real time | Set `DEMO_CLOCK=21:40` before `npm start` |
| Bedrock is unreachable | Set `VETWISE_AGENT=scripted`; the fallback also labels the answer |
| Chat works but the traffic panel is empty | Reload after the first message; the panel polls `/api/state` |

---

## Reset for a clean recording

```bash
# stop the server
rm data/db.json
DEMO_CLOCK=21:40 VETWISE_AGENT=scripted npm start
```

Then run steps 1–5 and capture `docs/screenshots/demo.png` with the emergency verdict card and the traffic panel visible.
