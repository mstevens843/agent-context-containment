# @agent-context-containment/classifier

A prompt-injection text detector, **ported intact from a production agent wallet** — 267 lines, 13
frozen regex patterns, Apache-2.0 in origin.

It exists to be the baseline, and it is deliberately not a strawman: it catches every overt injection
in this corpus. It is here so the comparison is against something real rather than something written
to lose.

**Do not deploy this as a defence.** Its two failures are structural rather than fixable:

- **Silent attacks**: 0 of 34 caught, across every split. A false statement of fact, a URL that
  carries data outward, an instruction split across two retrieved chunks — there is nothing in the
  text to find.
- **Quoted attacks**: 3 of 6 benign holdout cases over-blocked. A security ticket discussing a
  payload string, a hostile page being summarised rather than acted on. Support desks and security
  teams discuss attack strings constantly.

Neither is fixed by a better detector. That is the argument the rest of the repository makes.

If you want detection, this package is the wrong dependency — take the patterns and own them. If you
want containment, see `@agent-context-containment/ledger`.
