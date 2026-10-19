# Personal finance account analytics and bank statements

This release attributes income and expenses to the actual funding account and supports any account selection, separate currency totals, dated balances and daily/weekly/monthly trends. Internal transfers, purchases of investment principal and repayment principal remain recorded without counting as spending. Refunds reduce spending.

An account's complete, validated statement supplies its cash movements for its declared interval. Platform receipts remain available as evidence but no longer add a second cash movement in that interval. Known cash balances can be projected forward or backward using these movements. Unknown balances stay unknown; a portfolio with missing balances displays only a known subtotal.

Huaxia debit-card Excel statements are validated against transaction count, income/expense totals and the running balance. Encrypted OOXML workbooks accept a password associated with the individual file. The original encrypted bytes are archived; passwords are transient. Loan principal and interest remain unsplit when the source does not distinguish them.

Minsheng credit-card statements sent as HTML email bodies are exposed in the existing mailbox import flow. The parser validates monthly totals and preserves purchases, repayments, refunds, trade dates and posting dates. A monthly billed amount is labelled as billed debt, never as total current debt. Multi-card statements and unsupported interest/adjustment layouts require review.

Unique card/date/amount/merchant evidence can reconcile platform and bank receipts. Ambiguous overlaps remain visible for review, with the bank statement provisionally supplying the spending figure. An explicit distinct-transaction decision overrides that provisional treatment. No original observation is deleted.

Verification before release:

- Full project test suite passed; the affected finance suite passed again after the final changes.
- Encrypted Excel standard/agile password cases and bank statement consistency checks passed.
- Real-source local reconciliation checked both new statements and the existing historical cash balance without committing private source files.
- Electron interaction checks covered single/multiple/all account selection, daily trend selection, per-file passwords, account switching and narrow-window rendering.

Release matrix: desktop 8.26.0, cloud business 8.24.0, miniapp 8.13.0. Storage proxy remains 8.9.2 because its byte-storage protocol and executable did not change. Deployment and public update-feed evidence are generated outside the repository; a miniapp development upload is not a production publication.
