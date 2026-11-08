# Toxin catalogue

24 entries. Every entry has at least one published source with a URL and a verbatim quote; every dose band traces to that source. The engine will not use a threshold that is not in this file.

**Basis** is what the bands are measured in. `mg/kg`, `g/kg` and `ml/kg` are dose per kilogram of the pet's body weight. `pieces/kg` is pieces per kilogram (grapes). A band at `0` means "below the first published toxic range", not "safe": the verdict there is `monitor` because GI upset is still possible.

**Any-exposure** means the toxin has an explicit rule that does not depend on amount. The engine escalates before it asks for a number.

---

## Summary

| ID                | Toxin                         | Category       | Species  | Basis                 | Any exposure                       |
| ----------------- | ----------------------------- | -------------- | -------- | --------------------- | ---------------------------------- |
| `chocolate`       | Chocolate                     | food           | dog, cat | mg/kg methylxanthines | —                                  |
| `xylitol`         | Xylitol                       | food           | dog only | mg/kg xylitol         | —                                  |
| `grapes`          | Grapes and raisins            | food           | dog only | pieces/kg             | `call_vet`                         |
| `allium`          | Onion and garlic              | food           | dog, cat | g/kg                  | —                                  |
| `macadamia`       | Macadamia nuts                | food           | dog only | g/kg                  | —                                  |
| `avocado`         | Avocado                       | food           | dog, cat | g/kg                  | `monitor`                          |
| `bread-dough`     | Bread dough                   | food           | dog, cat | g/kg                  | —                                  |
| `alcohol`         | Alcohol (ethanol)             | food           | dog, cat | g/kg                  | —                                  |
| `caffeine`        | Caffeine                      | food           | dog, cat | mg/kg                 | —                                  |
| `salt`            | Salt (sodium chloride)        | food           | dog, cat | g/kg                  | —                                  |
| `lily`            | True lily (Lilium spp.)       | plant          | cat only | —                     | `emergency`                        |
| `sago-palm`       | Sago palm (Cycas revoluta)    | plant          | dog, cat | —                     | `emergency`                        |
| `azalea`          | Azalea and rhododendron       | plant          | dog, cat | g/kg                  | `call_vet`                         |
| `tulip`           | Tulip and daffodil bulbs      | plant          | dog, cat | g/kg                  | `call_vet`                         |
| `pothos`          | Pothos and philodendron       | plant          | dog, cat | g/kg                  | `monitor`                          |
| `ibuprofen`       | Ibuprofen                     | human medicine | dog, cat | mg/kg                 | —                                  |
| `acetaminophen`   | Acetaminophen                 | human medicine | dog, cat | mg/kg                 | —                                  |
| `aspirin`         | Aspirin                       | human medicine | dog, cat | mg/kg                 | —                                  |
| `ssri`            | Antidepressants (SSRIs/SNRIs) | human medicine | dog, cat | mg/kg                 | —                                  |
| `permethrin`      | Permethrin flea products      | pesticide      | dog, cat | mg/kg                 | `call_vet` (cat: `emergency` band) |
| `rodenticide`     | Rodenticide                   | pesticide      | dog, cat | —                     | `emergency`                        |
| `ethylene-glycol` | Ethylene glycol (antifreeze)  | household      | dog, cat | ml/kg                 | `emergency`                        |
| `mothballs`       | Mothballs                     | household      | dog, cat | g/kg                  | `call_vet`                         |
| `essential-oils`  | Essential oils                | household      | dog, cat | ml/kg                 | `call_vet`                         |

`no_known_toxicity` is not used by any entry. Missing amount for a toxin without an any-exposure rule returns `unverified`, not "below threshold".

---

## Foods

### Chocolate — `chocolate`

Bands are methylxanthines per kilogram of body weight:

| Dose        | Verdict     | Meaning                                                                              |
| ----------- | ----------- | ------------------------------------------------------------------------------------ |
| < 20 mg/kg  | `monitor`   | Below the threshold for methylxanthine signs; fat and sugar can still cause GI upset |
| 20–39 mg/kg | `call_vet`  | Mild signs expected                                                                  |
| 40–59 mg/kg | `emergency` | Cardiotoxic range                                                                    |
| ≥ 60 mg/kg  | `emergency` | Seizure range                                                                        |

Products and methylxanthine content:

| Product                       | mg/g | Typical piece |
| ----------------------------- | ---- | ------------- |
| Cocoa powder                  | 28.5 | 5 g           |
| Unsweetened baker's chocolate | 15.5 | 28 g          |
| 65% cocoa dark chocolate bar  | 10.1 | 100 g         |
| Semisweet / sweet dark        | 5.45 | 10 g          |
| Milk chocolate                | 2.3  | 43 g          |
| White chocolate               | 0.04 | 43 g          |

A product is required for a mass exposure. 40 g of chocolate with no product detail is `unverified`: white chocolate at that mass is `monitor`, a 65% bar is `call_vet`. Product text matching falls back to the toxin's default product (milk chocolate) only when the text is present but unrecognised.

Source: Merck Veterinary Manual, *Chocolate Toxicosis in Animals* — <https://www.merckvetmanual.com/toxicology/food-hazards/chocolate-toxicosis-in-animals>.

### Xylitol — `xylitol`

Dogs only; cats return `unverified` because the canine thresholds do not establish feline safety.

| Dose          | Verdict                                |
| ------------- | -------------------------------------- |
| < 100 mg/kg   | `monitor`                              |
| 100–499 mg/kg | `call_vet` (hypoglycemia threshold)    |
| ≥ 500 mg/kg   | `emergency` (hepatic injury threshold) |

Products: sugar-free gum (500 mg/piece), mints (250 mg/piece), toothpaste (250 mg/g), xylitol-sweetened peanut butter (100 mg/g), baked goods (100 mg/g).

Sources: Merck Veterinary Manual, *Xylitol Toxicosis in Dogs*; Pet Poison Helpline, *Xylitol*.

### Grapes and raisins — `grapes`

Any exposure is `call_vet`; at or above **one grape (or raisin) per 4.5 kg** the verdict is `emergency`. Amount is optional, so the any-exposure answer is available before the caregiver counts.

Product pieces: grape 5 g, raisin 1 g. Pieces per kilogram are used for the threshold, so the count matters more than the mass.

Sources: Merck Veterinary Manual, *Grape, Raisin, and Tamarind Toxicosis in Dogs*; Pet Poison Helpline, *Grapes*.

### Onion and garlic — `allium`

| Dose      | Verdict     |
| --------- | ----------- |
| < 5 g/kg  | `monitor`   |
| 5–14 g/kg | `call_vet`  |
| ≥ 15 g/kg | `emergency` |

Concentrated powders are far more potent than fresh onion: 2 g per piece for powder versus 150 g for an onion and 3 g for a garlic clove. Sources: Merck Veterinary Manual, *Garlic and Onion (Allium spp.) Toxicosis*; Pet Poison Helpline, *Onion*.

### Macadamia nuts — `macadamia`

Dogs only. `monitor` below 2 g/kg, `call_vet` from 2 g/kg (weakness, tremors, hyperthermia). Sources: Merck Veterinary Manual, *Macadamia Nut Toxicosis in Dogs*; Pet Poison Helpline, *Macadamia Nuts*.

### Avocado — `avocado`

`monitor` below 10 g/kg, `call_vet` at or above. Persin causes GI upset; the pit is an obstruction risk. Any-exposure floor is `monitor`. Sources: Merck Veterinary Manual, *Avocado (Persea spp.) Toxicosis*; Pet Poison Helpline, *Avocado*.

### Bread dough — `bread-dough`

`monitor` below 5 g/kg, `call_vet` 5–19 g/kg, `emergency` at 20 g/kg or more (bloat plus fermenting ethanol). Sources: Merck Veterinary Manual, *Bread Dough Toxicosis*; Pet Poison Helpline, *Bread Dough*.

### Alcohol — `alcohol`

`monitor` below 0.5 g/kg, `call_vet` 0.5–2.9 g/kg, `emergency` at 3 g/kg or more. Sources: Merck Veterinary Manual, *Toxicoses from Alcohols*; Pet Poison Helpline, *Alcohol*.

### Caffeine — `caffeine`

`monitor` below 15 mg/kg, `call_vet` 15–39 mg/kg, `emergency` at 40 mg/kg or more. Sources: Merck Veterinary Manual (methylxanthine toxicosis); Pet Poison Helpline, *Caffeine*.

### Salt — `salt`

`monitor` below 2 g/kg, `call_vet` 2–3.9 g/kg, `emergency` at 4 g/kg or more. Source: Pet Poison Helpline, *Salt*.

---

## Plants

### True lily — `lily`

Cats only. Any exposure is an `emergency`: every part, including pollen and vase water, can cause acute kidney failure. Dogs return `unverified`; the feline record does not establish canine safety. Amount is optional. Sources: Pet Poison Helpline, *Lilies*; ASPCA APCC, *Toxic and Non-Toxic Plants*.

### Sago palm — `sago-palm`

Any exposure is an `emergency` for dogs and cats (cycasin → liver failure). Amount is optional. Sources: Pet Poison Helpline, *Sago Palm*; ASPCA APCC.

### Azalea and rhododendron — `azalea`

`call_vet` on any exposure, `emergency` at 5 g/kg or more (grayanotoxins, heart rhythm). Sources: Pet Poison Helpline, *Azalea*; ASPCA APCC.

### Tulip and daffodil bulbs — `tulip`

`call_vet` on any exposure, `emergency` at 2 g/kg or more. The bulb is the most dangerous part. Sources: Pet Poison Helpline, *Tulip* and *Daffodil*.

### Pothos and philodendron — `pothos`

`monitor` on any exposure, `call_vet` at 10 g/kg or more. Insoluble calcium oxalate crystals irritate the mouth and GI tract. Sources: Pet Poison Helpline, *Philodendron*; ASPCA APCC.

---

## Human medicines

These are never a dosing question. A "can I give this?" question returns `call_vet` with a "Do not give…" headline before any dose math.

| Toxin           | Bands                                                        | Sources                                            |
| --------------- | ------------------------------------------------------------ | -------------------------------------------------- |
| `ibuprofen`     | `monitor` < 50 mg/kg · `call_vet` 50–99 · `emergency` ≥ 100  | Pet Poison Helpline, *Ibuprofen*; ASPCA APCC       |
| `acetaminophen` | `monitor` < 75 mg/kg · `call_vet` 75–149 · `emergency` ≥ 150 | Pet Poison Helpline, *Acetaminophen*; ASPCA APCC   |
| `aspirin`       | `monitor` < 25 mg/kg · `call_vet` 25–49 · `emergency` ≥ 50   | Pet Poison Helpline, *Aspirin*; ASPCA APCC         |
| `ssri`          | `monitor` < 5 mg/kg · `call_vet` 5–19 · `emergency` ≥ 20     | Pet Poison Helpline, *Antidepressants*; ASPCA APCC |

Cats are called out in the summaries (acetaminophen and aspirin are especially dangerous), but the published bands are shared because the sources do not give separate feline numbers for every drug.

---

## Pesticides

### Permethrin — `permethrin`

Species-specific bands:

| Species | Bands                                                                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Cat     | Any exposure: `emergency`. Dog spot-on products can be fatal to cats, including from grooming a treated dog or lying on a treated blanket. |
| Dog     | `call_vet` on any exposure; `emergency` at 100 mg/kg or more.                                                                              |

Products: dog spot-on (450 mg/ml, 4 g/piece), flea spray (2 mg/ml, 100 g/piece), flea collar (500 mg/piece). Product concentration varies widely; without a product the engine does not estimate a dose.

Sources: ASPCA APCC, *Flea and Tick Product Safety*; ASPCA APCC.

### Rodenticide — `rodenticide`

Any exposure is an `emergency`, dogs and cats. Amount is optional. The active ingredient (anticoagulant, bromethalin, cholecalciferol) changes the treatment, so the package is the most useful thing to bring. Sources: ASPCA APCC, *Rodenticides*; ASPCA APCC.

---

## Household

### Ethylene glycol — `ethylene-glycol`

Any exposure is an `emergency`, dogs and cats. Amount is optional: even a small amount can cause acute kidney failure. Sources: Pet Poison Helpline, *Antifreeze*; ASPCA APCC.

### Mothballs — `mothballs`

`call_vet` on any exposure, `emergency` at 1 g/kg or more. Naphthalene and paradichlorobenzene cause hemolysis and neurologic signs. Sources: Merck Veterinary Manual, *Toxicosis from Mothballs*; Pet Poison Helpline, *Mothballs*.

### Essential oils — `essential-oils`

`call_vet` on any exposure, `emergency` at 1 ml/kg or more. Cats are especially vulnerable; aspiration pneumonia is a risk. Tea tree oil carries a product-level `emergency` override. Sources: Merck Veterinary Manual, *Toxicoses from Essential Oils*; Pet Poison Helpline, *Tea Tree Oil*.

---

## How to add a toxin

1. Find a published veterinary source with a stable URL and a sentence that states the threshold. Record the quote verbatim.
2. Add the entry to `src/domain/toxins.ts`: bands ascending, severe signs, record-level first steps, limitations.
3. Add products only when the source gives a concentration or a typical mass. Do not guess a bar size.
4. Add a unit test that proves the missing-fact behaviour, not just the happy path.
5. Run `npm run check`.

If a source does not give a number, leave the band list empty and give the toxin an any-exposure rule or `unverified`. A gap is better than a fabricated threshold.
