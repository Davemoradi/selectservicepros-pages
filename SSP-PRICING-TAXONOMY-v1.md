# SSP Pricing Taxonomy v1

Canonical intake rows: **106** after six scope splits.

Priced: **99** · Held for review: **7** · A: **25** · B: **32** · C: **42**.

Band prices: A $75 · B $35 · C $18.

## Six scope splits

- HVAC: `Duct cleaning or repair` → Duct cleaning / Duct repair
- Plumbing: `Pipe repair / repiping` → Pipe repair / Whole-home repiping
- Electrical: `Wiring repair or upgrade` → Wiring repair / Wiring upgrade / rewiring
- Roofing: `Shingle repair / replacement` → Shingle repair / Shingle replacement
- Roofing: `Gutter install or repair` → Gutter repair / Gutter installation
- Windows & Doors: `Door installation` → Interior door installation / Exterior / entry door installation

## Held-for-review rows

- **HVAC** — Other (`hvac_other`)
- **Plumbing** — Other (`plumb_other`)
- **Electrical** — Other (`elec_other`)
- **Roofing** — Other (`roof_other`)
- **Pool & Spa** — Other (`pool_other`)
- **Windows & Doors** — Other (`wd_other`)
- **Painting** — Other (`paint_other`)

These rows intentionally have no band or price. `create-lead.js` stores them as `HeldForReview` rather than guessing.

## Source-of-truth rule

`ssp-taxonomy-v1.js` is the canonical application taxonomy. The SQL seed must contain the same 106 `(category, issue_code, label, band, price)` rows. `verify-ssp-hardening.js` enforces parity before release.