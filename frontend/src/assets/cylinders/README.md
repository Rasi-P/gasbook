# Default cylinder pictures

Shown for a cylinder type that has **no custom picture** uploaded, chosen by its weight
(rule and manifest: `src/lib/cylinderImages.ts`). They ship inside the app build, so they are never
uploaded per record, never use media storage, and are never touched when a custom picture is removed.

This folder and `src/lib/cylinderImages.ts` are kept **identical** in `gasbook/frontend` and
`gasbook-customer`. `tests/cylinderImages.shared.test.ts` in each repo pins the SHA-256 of every file
here, so a change in one repo fails that test until both copies (and both pins) are updated.

| Weight | File | Source |
| --- | --- | --- |
| 2 kg | `placeholder-2kg.svg` | **Placeholder**: unbranded, made for GasBook. Replace with approved SABCO artwork. |
| 3 kg | `placeholder-3kg.svg` | **Placeholder**: as above |
| 4 kg | `placeholder-4kg.svg` | **Placeholder**: as above |
| 5 kg | `sabco-5kg.png` | SABCO-branded artwork already in `gasbook-customer` (was `src/assets/cylinder_5kg.png`, commit 430ea20) |
| 12 kg | `sabco-12kg.png` | as above (`cylinder_12kg.png`) |
| 14 kg | `placeholder-14kg.svg` | **Placeholder** |
| 17 kg | `sabco-17kg.png` | as above (`cylinder_17kg.png`); not one of the nine standard weights, kept for older catalogs |
| 19 kg | `sabco-19kg.png` | as above (`cylinder_19kg.png`) |
| 21 kg | `sabco-21kg.png` | as above (`cylinder_21kg.png`) |
| 33 kg | `placeholder-33kg.svg` | **Placeholder** |
| any other weight, or when a picture fails to load | `generic-cylinder.svg` | Unbranded generic cylinder, made for GasBook |

**Provenance still to confirm:** the `sabco-*.png` files were committed to the customer app on
2026-08-21 with no source or licence recorded. Before release, confirm with SABCO that they are
approved artwork. The placeholders carry no SABCO name or logo on purpose; do not add branding to
them. Replace each one with approved artwork instead.

## Replacing a placeholder with approved artwork

1. Add the file to this folder in **both** repos, e.g. `sabco-2kg.png` (PNG or WebP, transparent
   background, portrait, about 820×1024 like the existing ones).
2. In `src/lib/cylinderImages.ts` (both repos) import it and change that weight's entry to
   `entry(2, sabco2, 'sabco')`. Delete the placeholder file.
3. Update the pinned hashes in `tests/cylinderImages.shared.test.ts` (both repos):
   `shasum -a 256 src/assets/cylinders/*`.

No database change is needed: every type without a custom picture picks up the new file on the next deploy.
