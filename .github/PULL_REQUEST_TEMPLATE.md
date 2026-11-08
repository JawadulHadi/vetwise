## What this changes

<!-- One paragraph. Link the issue if there is one: "Closes #12". -->

## Safety checklist

Vetwise answers questions people act on in an emergency. Tick what applies and
explain any box left unticked.

- [ ] No new path can turn a missing fact (amount, weight, species, product) into
      a reassuring verdict.
- [ ] Symptoms and dose bands can still only raise a verdict, never lower it.
- [ ] No treatment advice, no induced vomiting, no therapeutic dosing was added.
- [ ] Every new or changed number traces to a citation in `src/domain/toxins.ts`.
- [ ] Scopes are checked inside the tool, not only at the route.
- [ ] Any new write goes through the two-phase confirmation and is caller-bound.

## Tests

- [ ] `npm run check` passes locally.
- [ ] A regression test was added for a fixed bug (or an existing one already
      covers it — name it).
- [ ] No real household, patient, or credential data is included.

## Notes for the reviewer

<!-- Trade-offs, deliberate deviations, or follow-up work. -->
