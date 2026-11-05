# Saudi Riyal Financial Validation

All existing annual investment records were reset to zero at the user's request. The executive dashboard and Financial Roadmap now display Saudi Riyal values, annual chart labels, portfolio totals, and editable investment fields in SAR millions.

The provided official Saudi Riyal currency mark was cropped for compact use and is visible in the financial summary cards, annual investment register heading, and annual amount fields. The stored numeric values remain internal base data; financial editors accept SAR millions and convert them for storage so users can enter SAR values directly.

Desktop and mobile validation confirmed that the official SAR mark remains visible in the summary cards, annual register heading, and each input adornment. All portfolio totals and annual rollups display SAR 0.0M after the requested reset.

For save validation, a temporary SAR 3.75M value was entered in the 2026 input for 5G Broadband leadership. The next validation step commits the field, verifies the recalculated SAR rollup, and restores the value to zero.

The temporary value was committed by moving focus to the adjacent input. The interface displayed an in-progress save state; the following check verifies mutation completion before the value is reset.

After reload, the financial roadmap correctly returned to the requested zero-value baseline. A native keyboard-blur test is used next to confirm the explicit on-blur save behavior independently of automated pointer focus.

The test field has been reset to SAR 3.75M from the zero baseline and will now be committed through standard keyboard focus movement before it is returned to zero.

The external `/manus-storage` reference that failed in AWS has been replaced by the exact user-provided currency-symbol image bundled by the production build. Desktop and mobile preview checks show the mark without fallback alt text, and the summary cards, register heading, and input adornments retain their spacing.
