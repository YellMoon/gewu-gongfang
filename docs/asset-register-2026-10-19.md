# Asset register and statement import, 2026-10-19

The desktop now groups actual funding accounts as savings, credit and investments.
Bank identity is the bank, card type and masked tail, shared across payment channels.
Discovery runs in the cloud owner transaction and can also populate existing imports.
Unknown card types remain unresolved. Fund confirmation totals and conversions linked by
order, amount and confirmation date are visible without inventing current holdings.

New bounded parsers cover Alipay balance proofs, Yu'e Bao available flows and distributor
asset certificates, and MYbank current-account / Yu Li Bao statements in XLSX and PDF.
MYbank exports can underreport worksheet dimensions; all parsed cells now extend the
range, while existing resource limits and formula/precision checks still apply.
Bank ledger rows are sorted chronologically and every balance transition must reconcile.
Yu Li Bao negative returns preserve their sign. Unmatched bank payments stay unclassified
until linked to platform observations, avoiding duplicate consumer spending.

Balance proofs do not create additional cash transactions. Available balances, bank
estimated fund balances and individual distributor certificates have explicit scopes.
Only total-account anchors calibrate the accounting view. Same-time rows use the validated
statement order; independent conflicting balances remain unresolved. User calibrations
preserve their stated time, signed amount and note.

Validation before deployment:
- Real Alipay wallet PDF: 791 rows matched an independent extraction, every balance checked.
- Yu'e Bao available flow PDF: 83 rows, closing available balance zero.
- MYbank current statements: 346 rows across 2023-2026, cross-year balances continuous.
- Yu Li Bao statements: 1,890 rows across 2023-2026, cross-year balances continuous.
- Two distributor certificates show zero at 2026-10-19 11:13:15.
- PostgreSQL owner isolation, automatic discovery, retry and revision checks pass.
- Decoder regression verifies underreported dimensions do not silently drop records.
- Desktop and miniapp use the shared balance/evidence semantics.

Private originals and parsed values remain outside Git. Release and actual import receipts
are retained under output/asset-register-20261019 and output/asset-system-20261019.
Fund conversion incoming shares and historical NAV valuation remain explicitly unresolved.
Miniapp production publication must not be inferred from a development upload.
