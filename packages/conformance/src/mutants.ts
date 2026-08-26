// Deliberately broken policy engines, and the reason they exist.
//
// A conformance suite that only ever runs against the implementation that shipped with it proves
// nothing: every scenario passes, and "every scenario passes" is equally consistent with a suite
// that tests something real and a suite that tests nothing. Mutants are the control.
//
// THE REQUIREMENT IS SHARPER THAN "THEY ALL FAIL". The suite must DISCRIMINATE. A mutant that fails
// every scenario proves only that the suite is a tripwire; what proves the suite measures something
// is a mutant that passes the scenarios it genuinely handles and fails exactly the ones that isolate
// its defect. `effect_only` should sail through every irreversible-effect case and break only on
// egress. That is the same property that made a replacement schedule family credible on the
// benchmark this project grew out of: it caught five of six engines and correctly did NOT catch the
// one that actually handled the case.
//
// The house verb for a check that fires is "bites".

import { detect } from "@agent-containment/classifier";
import { CAPABILITY_POLICY, type CapabilityPolicy, decide } from "@agent-containment/core";
import type { ContainmentPolicy, ContainmentRequest, ContainmentResponse } from "./ports.js";

/** The real engine. Passes everything; the control at the other end. */
export const reference: ContainmentPolicy = {
  name: "M0 reference",
  decide: (r: ContainmentRequest): ContainmentResponse => {
    const v = decide({
      action: r.action,
      sources: r.sources,
      receipts: r.receipts,
      confirmed: r.confirmed,
    });
    return { decision: v.decision, reasons: v.reasons.map((x) => x.code) };
  },
};

/** Rewrite the shipped table, then run the real engine against it. */
const withPolicy = (
  name: string,
  patch: (p: CapabilityPolicy) => CapabilityPolicy,
): ContainmentPolicy => {
  const policy = patch(CAPABILITY_POLICY);
  return {
    name,
    decide: (r) => {
      const v = decide(
        { action: r.action, sources: r.sources, receipts: r.receipts, confirmed: r.confirmed },
        policy,
      );
      return { decision: v.decision, reasons: v.reasons.map((x) => x.code) };
    },
  };
};

/**
 * M1. Rates capabilities on the effect axis alone and ignores egress.
 *
 * The most defensible wrong engine in the set, and the one that proves the two-axis model earns its
 * keep. It stops every payment, every send, every broadcast. It waves through `web_fetch` to an
 * attacker-chosen host, because fetching a URL changes nothing - which is true, and is exactly why
 * a one-dimensional sensitivity scale gets the most common real exfiltration path wrong.
 */
export const effectOnly = withPolicy("M1 effect_only", (p) => ({
  ...p,
  // Rated EXPLICITLY, not by clearing roleCeilings. `ceilingFor` fails closed for steering roles, so
  // an omitted sink_identity tightens to USER_CONTROLLED and the mutant would accidentally be
  // correct - which is what happened the first time this was written. A mutant that does not
  // actually contain its defect is worse than no mutant: the suite reports it as discriminated and
  // nothing was tested.
  web_fetch: {
    ...p.web_fetch,
    defaultCeiling: "UNTRUSTED_EXTERNAL",
    roleCeilings: { sink_identity: "UNTRUSTED_EXTERNAL", control: "UNTRUSTED_EXTERNAL" },
  },
  read_only_tool: {
    ...p.read_only_tool,
    defaultCeiling: "UNTRUSTED_EXTERNAL",
    roleCeilings: { sink_identity: "UNTRUSTED_EXTERNAL", control: "UNTRUSTED_EXTERNAL" },
  },
}));

/**
 * M2. Treats a value that parses as a value that is trusted.
 *
 * Modelled by lifting the `sink_identity` ceiling on capabilities that consume structured tool
 * output. The record is well-formed, the field is a syntactically valid address, every validator
 * passes - and a self-serve CRM lets a prospect type their own billing email.
 */
export const schemaIsTrust = withPolicy("M2 schema_is_value_declassification", (p) => ({
  ...p,
  email_send: {
    ...p.email_send,
    roleCeilings: { ...p.email_send.roleCeilings, sink_identity: "TOOL_DERIVED" },
  },
  payment: {
    ...p.payment,
    roleCeilings: { ...p.payment.roleCeilings, sink_identity: "TOOL_DERIVED" },
  },
}));

/**
 * M3. Taints each source correctly, then takes the MINIMUM rather than the join when combining.
 *
 * `CLEAN` joined with `UNTRUSTED_EXTERNAL` comes out `CLEAN`, so any argument that touches one
 * trusted source is laundered. Passes every single-source case, which is most of the corpus - a
 * strong discriminator rather than a blanket failure.
 */
export const noJoin: ContainmentPolicy = {
  name: "M3 no_join",
  decide: (r) => {
    const weakened = r.sources.map((s) =>
      s.provenance === "SYSTEM" || s.provenance === "USER"
        ? s
        : { ...s, provenance: "USER" as const },
    );
    const anyTrusted = r.sources.some((s) => s.provenance === "SYSTEM" || s.provenance === "USER");
    const v = decide({
      action: r.action,
      sources: anyTrusted ? weakened : r.sources,
      receipts: r.receipts,
      confirmed: r.confirmed,
    });
    return { decision: v.decision, reasons: v.reasons.map((x) => x.code) };
  },
};

/**
 * M4. Model output is treated as clean because our own model wrote it.
 *
 * Drops the `derivedFrom` edges, so a summary of a hostile page is TOOL_DERIVED rather than
 * inheriting WEB. The most dangerous mistake an integrator can actually make, because it is the
 * natural one: the summary feels like our text.
 */
export const modelLaunders: ContainmentPolicy = {
  name: "M4 model_launders",
  decide: (r) => {
    const flattened = r.sources.map(({ id, provenance }) => ({ id, provenance }));
    const v = decide({
      action: r.action,
      sources: flattened,
      receipts: r.receipts,
      confirmed: r.confirmed,
    });
    return { decision: v.decision, reasons: v.reasons.map((x) => x.code) };
  },
};

/**
 * M5. Denies anything above CLEAN.
 *
 * THE MOST IMPORTANT MUTANT IN THE SET. It blocks 100% of attacks. If the report showed only an
 * attack-blocked rate it would look flawless - better than the reference. It is caught solely by
 * the benign row, which is why over-blocking is scored as a first-class failure and why a headline
 * number without its over-blocking counterpart is not reported anywhere in this repository.
 */
export const paranoid: ContainmentPolicy = {
  name: "M5 paranoid",
  decide: (r) => {
    const dirty = r.sources.some((s) => s.provenance !== "SYSTEM");
    return dirty
      ? { decision: "DENY", reasons: ["taint_exceeds_ceiling"] }
      : { decision: "ALLOW", reasons: ["within_taint_ceiling"] };
  },
};

/**
 * M6. A containment engine that is secretly a classifier.
 *
 * Propagates provenance correctly, then declassifies any tainted value whose text contains no
 * injection-looking keyword. Scores near the reference on overt cases and collapses on the
 * `textualMarkers: "none"` half.
 *
 * THIS IS THE THESIS-VIOLATING MUTANT. If the suite cannot separate it from the reference, this
 * repository has not demonstrated anything a better regex could not do, and the central claim is
 * unfalsifiable. It is here so that claim can fail.
 */
export const denylistInside: ContainmentPolicy = {
  name: "M6 denylist_inside",
  decide: (r) => {
    const suspicious = Object.values(r.content).some((t) => detect(t).matched);
    if (!suspicious) return { decision: "ALLOW", reasons: ["within_taint_ceiling"] };
    const v = decide({
      action: r.action,
      sources: r.sources,
      receipts: r.receipts,
      confirmed: r.confirmed,
    });
    return { decision: v.decision, reasons: v.reasons.map((x) => x.code) };
  },
};

/**
 * M7. Treats a receipt as a bearer token for the whole action.
 *
 * Drops `argName` from the matching predicate, so a confirmation obtained for one argument admits
 * every other argument of the same capability and role. The most plausible wrong implementation in
 * the set, because the shortcut is invisible: every case with a single receipted argument still
 * passes, and the defect only appears when one action has two arguments in the same slot type.
 *
 * It exists because the receipt machinery would otherwise ship ungraded - the five-conjunct
 * predicate in `decide()` had zero mutation coverage before this phase, and a corpus that exercises
 * a feature without a mutant that breaks it is a corpus that cannot tell working from broken.
 */
export const receiptBearerToken: ContainmentPolicy = {
  name: "M7 receipt_bearer_token",
  decide: (r) => {
    // Widens ONLY the receipt's binding: one copy per argument name, everything else untouched.
    //
    // The first version blanked the argument names on both sides instead, which worked until the
    // tuple gate arrived - two arguments then shared a name, the gate saw one combination admitted
    // twice, and it escalated. The mutant was rescued by a mechanism that has nothing to do with its
    // defect, so it stopped being caught and the suite reported it as discriminated. Same failure as
    // M1's first version, and the same lesson: a mutant must contain its defect and NOTHING ELSE, or
    // an unrelated change quietly turns it into a pass.
    const names = r.action.args.map((a) => a.name);
    const widened = r.receipts.flatMap((x) => names.map((argName) => ({ ...x, argName })));
    const v = decide({
      action: r.action,
      sources: r.sources,
      receipts: widened,
      confirmed: r.confirmed,
    });
    return { decision: v.decision, reasons: v.reasons.map((x) => x.code) };
  },
};

/**
 * M8. Walks the provenance graph exactly one hop.
 *
 * A strictly better engine than M4 - it DOES inherit taint, so a single summary of a hostile page is
 * caught - and still wrong, because taint is transitive and this stops after one edge. Two hops
 * through our own tools and the value comes out clean.
 *
 * It exists because "does the engine launder?" turned out to be two questions rather than one, and
 * v0 could not have told them apart even if it had discriminated M4: the difference only shows up on
 * a case with a chain longer than one, and v0 has none. `lau-h2-004` is that case.
 */
export const oneHopOnly: ContainmentPolicy = {
  name: "M8 one_hop_only",
  decide: (r) => {
    // Flatten anything more than one edge from a root, keeping the first hop intact.
    const byId = new Map(r.sources.map((s) => [s.id as string, s]));
    const shallow = r.sources.map((s) => {
      const parents = s.derivedFrom ?? [];
      if (parents.length === 0) return s;
      const grandparents = parents.flatMap((id) => byId.get(id as string)?.derivedFrom ?? []);
      return grandparents.length > 0 ? { id: s.id, provenance: s.provenance } : s;
    });
    const v = decide({
      action: r.action,
      sources: shallow,
      receipts: r.receipts,
      confirmed: r.confirmed,
    });
    return { decision: v.decision, reasons: v.reasons.map((x) => x.code) };
  },
};

/** Every mutant, plus the reference. */
export const MUTANTS: readonly ContainmentPolicy[] = [
  reference,
  effectOnly,
  schemaIsTrust,
  noJoin,
  modelLaunders,
  paranoid,
  denylistInside,
  receiptBearerToken,
  oneHopOnly,
];
