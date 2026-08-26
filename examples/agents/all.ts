// All four agent demos, end to end.
//
//   pnpm build && npx tsx examples/agents/all.ts
//
// Five domains, one engine, no domain logic anywhere in it. Email, DevOps, support, code and payments
// have nothing in common at the level of tools, vocabulary or consequence - and every refusal below
// comes from the same two questions: where did this value come from, and what is it being used for.
//
// That is the claim this repository is actually making, and running these back to back is the
// cheapest way to check it. If containment were a wallet-safety idea with a general-sounding name,
// four of these five would need special cases. None of them do - and a test asserts the engine's
// source contains no word like `refund`, `deploy` or `invoice`.

import { codeDemo } from "./code.js";
import { devopsDemo } from "./devops.js";
import { emailDemo } from "./email.js";
import { type DemoResult, runDemo, summarise } from "./harness.js";
import { paymentsDemo } from "./payments.js";
import { supportDemo } from "./support.js";

// Ordered so a reader meets the most familiar domain first and the highest-consequence one last.
// Payments is ONE domain here, not the centre - a containment model that only worked on money would
// not be containment.
const results: DemoResult[] = [emailDemo, devopsDemo, supportDemo, codeDemo, paymentsDemo].map(
  (d) => runDemo(d),
);
summarise(results);
