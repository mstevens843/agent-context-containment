// Declassification: the release valve, and the part most likely to ship broken.
//
// Every taint system dies the same way. Everything downstream becomes untrusted, every call needs a
// dialog, developers get tired, and the library is removed. Declassification is what stops that,
// which makes it the place where the design either earns its keep or quietly becomes a rubber stamp.
//
// ONE RULE DECIDES WHETHER A DECLASSIFIER IS SOUND, and it is arithmetic rather than judgement:
//
//   A rule may admit a value for a sensitive parameter only if the set of values it can possibly
//   admit is (a) FINITE, (b) enumerable from inputs that are all CLEAN, and (c) safe element by
//   element.
//
// Read it as a channel. Every declassification is a channel from the attacker to a side effect, and
// the only question is how many bits they get to push through it. A closed enum is log2(n) bits. A
// numeric range at fixed granularity is bounded. Free text is unbounded, and unbounded is the same
// as no control at all.
//
// WHY SCHEMA VALIDATION IS NOT ON THE LIST. This is the single most likely way to get this wrong.
// A string that passes a schema is still attacker-chosen text: parsing `{ to: string }` and calling
// the result clean hands the attacker the recipient field. Validation tells you the SHAPE is
// known-good and says nothing about WHO CHOSE THE BYTES. It is exactly the residual risk the design
// patterns paper (arXiv 2506.08837) names for Plan-Then-Execute - an injection cannot force a new
// action, and it can still choose that action's PARAMETERS.
//
// So the API separates two things that look alike and are not:
//
//   STRUCTURAL declassification tells you the shape is known-good. Free, unlimited, no receipt,
//   because it admits no value at all.
//
//   VALUE declassification says one specific value may fill one specific sensitive slot. Receipted,
//   scoped to one capability and one argument, and only ever issued from a finite trusted domain.
//
// WHY THERE IS NO SOURCE ALLOWLIST HERE. It is the rule everyone asks for and it is not admissible.
// A domain says who SERVED the bytes, never who WROTE them, and every allowlist entry worth having -
// a wiki, a docs host, a ticketing system, your own CMS - is a user-generated-content host, so
// allowlisting it allowlists the attacker. It also bounds nothing: a page on an allowlisted domain
// is still arbitrary text, which fails the finiteness test above. The sibling project states the
// same position in one line, and it is the right one: an allowlist is a label, not a trust grant.
// A source allowlist may lower a risk tier. It may never admit a value.

import type { DeclassificationRule } from "./policy.js";
import {
  type Capability,
  ContainmentError,
  type ParamRole,
  type ReceiptId,
  type Taint,
} from "./types.js";

/**
 * How large the set of admissible values is. Recorded on every declassification so an audit can ask
 * the only question that matters: how many bits of choice did the attacker have here?
 */
export interface Codomain {
  readonly kind: "singleton" | "finite" | "bounded_numeric" | "human_ratified";
  /** Size of the admissible set. Finite by construction; there is no unbounded variant. */
  readonly cardinality: number;
}

/**
 * A value admitted above a ceiling.
 *
 * `admitted` is the canonical value, and it is what `unwrap` returns. It is NOT a hash of the
 * input, and that is deliberate. A hash-and-compare design needs a collision-resistant hash; this
 * package has zero dependencies and must stay synchronous (so no WebCrypto, which is async), and a
 * hand-rolled hash is trivially collidable by an attacker who chooses the content on both sides.
 * Worse, even a perfect hash preserves the check-versus-use gap: the receipt says "some value
 * hashing to X is fine" and the code then uses whatever it happens to be holding. Carrying the
 * value closes both problems at once, and costs nothing.
 */
export interface Declassification<T> {
  readonly id: ReceiptId;
  readonly rule: DeclassificationRule;
  /** The one capability this admits for. Safety is capability-relative. */
  readonly capability: Capability;
  /** The one argument role this admits for. */
  readonly role: ParamRole;
  /** The highest taint this admits. */
  readonly lifts: Taint;
  /** The canonical admitted value. */
  readonly admitted: T;
  readonly codomain: Codomain;
  /** Why this was admissible, in prose. Goes into the audit trail. */
  readonly basis: string;
}

/** Bits of attacker choice this permits. The honest measure of what a declassification costs. */
export const bitsOfChoice = (c: Codomain): number =>
  c.cardinality <= 1 ? 0 : Math.ceil(Math.log2(c.cardinality));

let counter = 0;
const nextId = (): ReceiptId => `dcl-${++counter}` as ReceiptId;

// ---------------------------------------------------------------------------------------------
// Value rules. Each is finite by construction.
// ---------------------------------------------------------------------------------------------

/**
 * Admit a value because it is a member of a set fixed BEFORE any untrusted content was read.
 *
 * Returns the MATCHED MEMBER, never the input. That defeats the whole family of normalise-one-side
 * bugs: comparing a trimmed, lower-cased form and then shipping the raw form lets an address with a
 * zero-width character appended sail through a comparison it appeared to pass.
 *
 * What this does not stop: an allowlist that is correct and contains a member with far more
 * authority than the rest. An `all-staff@` entry on a mail allowlist is sound by this rule and
 * catastrophic in practice, because the attacker simply picks the worst member. Review the domain,
 * not only the rule.
 */
export function admitAllowlistMember(args: {
  readonly candidate: string;
  /** Fixed in advance. If this was built from tool output, it is not an allowlist. */
  readonly allowlist: readonly string[];
  readonly capability: Capability;
  readonly role: ParamRole;
  readonly lifts: Taint;
}): Declassification<string> | undefined {
  const match = args.allowlist.find((m) => m === args.candidate);
  if (match === undefined) return undefined;
  return {
    id: nextId(),
    rule: "allowlist_member",
    capability: args.capability,
    role: args.role,
    lifts: args.lifts,
    admitted: match,
    codomain: { kind: "finite", cardinality: args.allowlist.length },
    basis: `member of a ${args.allowlist.length}-element allowlist fixed in advance`,
  };
}

/**
 * Admit a number inside a bound.
 *
 * THE BOUND MUST BE CLEAN. A bounds check whose bound came from the attacker is not a bounds check.
 * That is not hypothetical: an invoice stating its own approval limit is a real attack and is a
 * case in this repository's holdout corpus.
 *
 * What this does not stop: ACCUMULATION. Four hundred payments of 9.99 under a limit of 10 pass
 * every individual check. This package is pure and stateless, so a per-call bound is meaningless
 * against a loop unless the caller threads a running budget. Stated plainly in LIMITATIONS.md.
 */
export function admitNumericEnvelope(args: {
  readonly candidate: number;
  readonly low: number;
  readonly high: number;
  /** Smallest distinguishable step. Fixes the cardinality, which is what makes this finite. */
  readonly granularity: number;
  readonly capability: Capability;
  readonly role: ParamRole;
  readonly lifts: Taint;
}): Declassification<number> | undefined {
  const { candidate, low, high, granularity } = args;
  if (granularity <= 0) {
    throw new ContainmentError(
      "inadmissible_declassification",
      "a numeric envelope needs a positive granularity; without one the codomain is not finite",
    );
  }
  if (!Number.isFinite(candidate)) return undefined;
  if (candidate < low || candidate > high) return undefined;
  return {
    id: nextId(),
    rule: "numeric_envelope",
    capability: args.capability,
    role: args.role,
    lifts: args.lifts,
    admitted: candidate,
    codomain: { kind: "bounded_numeric", cardinality: Math.floor((high - low) / granularity) + 1 },
    basis: `within [${low}, ${high}] at granularity ${granularity}, all three fixed in advance`,
  };
}

/**
 * Admit a value because it is byte-identical to something already held cleanly.
 *
 * Zero bits of attacker choice: the value is not attacker-influenced at all, it is a clean value we
 * happened to observe inside a tainted cell. This is the only rule whose codomain is a singleton,
 * and therefore the only one it would be defensible to admit for every capability at once.
 */
export function admitEchoOfClean<T>(args: {
  readonly candidate: T;
  readonly cleanValue: T;
  readonly capability: Capability;
  readonly role: ParamRole;
  readonly lifts: Taint;
}): Declassification<T> | undefined {
  if (!Object.is(args.candidate, args.cleanValue)) return undefined;
  return {
    id: nextId(),
    rule: "echo_of_clean",
    capability: args.capability,
    role: args.role,
    lifts: args.lifts,
    admitted: args.cleanValue,
    codomain: { kind: "singleton", cardinality: 1 },
    basis: "byte-identical to a value already held cleanly; zero bits of attacker choice",
  };
}

/**
 * Admit the element that a tainted index selects out of a collection we already hold cleanly.
 *
 * The index is attacker-chosen, so this carries log2(n) bits. It is NOT a singleton: the element
 * being clean does not make the CHOICE clean.
 *
 * Uses an explicit bounds check against an array rather than property access. `collection[key]` on
 * a plain object hands back `__proto__`, `constructor` and `toString` as live objects rather than
 * `undefined`, which turns a selection rule into prototype pollution.
 */
export function admitCleanSelection<T>(args: {
  readonly index: number;
  readonly collection: readonly T[];
  readonly capability: Capability;
  readonly role: ParamRole;
  readonly lifts: Taint;
}): Declassification<T> | undefined {
  const { index, collection } = args;
  if (!Number.isInteger(index) || index < 0 || index >= collection.length) return undefined;
  const element = collection[index];
  if (element === undefined) return undefined;
  return {
    id: nextId(),
    rule: "clean_selection",
    capability: args.capability,
    role: args.role,
    lifts: args.lifts,
    admitted: element,
    codomain: { kind: "finite", cardinality: collection.length },
    basis: `element ${index} of a ${collection.length}-element collection held cleanly`,
  };
}

/**
 * Characters that let a rendered string lie about what it says: bidirectional overrides,
 * zero-width joiners and spaces, the byte-order mark, and newlines.
 *
 * These are attacks the library CAN see, so it should. What it cannot see is pixels - truncation,
 * CSS, notification previews and screen-reader output are all outside it, so a passing check here
 * is not a guarantee that the human saw what we were told they saw.
 */
const DECEPTIVE_RENDER = /[‪-‮⁦-⁩​-‏﻿\n\r]/;

/**
 * Admit a value a human ratified after being shown it verbatim.
 *
 * `presented` is stored so an auditor can diff what the human was shown against what was used.
 * Confirmation fatigue is worse than every technical attack on this rule and is a product problem,
 * not a library one: the fortieth dialog of a session is not a security control.
 */
export function admitUserConfirmedValue(args: {
  readonly candidate: string;
  /** Exactly what the human was shown. Must contain the candidate verbatim. */
  readonly presented: string;
  readonly capability: Capability;
  readonly role: ParamRole;
  readonly lifts: Taint;
}): Declassification<string> | undefined {
  const { candidate, presented } = args;
  if (candidate.length === 0) return undefined;
  if (!presented.includes(candidate)) return undefined;
  if (DECEPTIVE_RENDER.test(candidate)) return undefined;
  if (candidate.trim() !== candidate) return undefined;
  return {
    id: nextId(),
    rule: "user_confirmed_value",
    capability: args.capability,
    role: args.role,
    lifts: args.lifts,
    admitted: candidate,
    codomain: { kind: "human_ratified", cardinality: 1 },
    basis: `ratified by a human shown: ${JSON.stringify(presented)}`,
  };
}

// ---------------------------------------------------------------------------------------------
// Structural declassification: free, unlimited, and admits nothing.
// ---------------------------------------------------------------------------------------------

/** What `declassifyShape` reports. Deliberately carries no values. */
export interface Shape {
  readonly kind: "object" | "array" | "primitive" | "null";
  readonly fields: readonly string[];
  readonly length: number | null;
}

/**
 * Report the shape of a tainted record without admitting any of its values.
 *
 * This is the release valve that keeps the library usable. Most real friction is routing logic -
 * does this object have a `dueDate`, how many items are there, which variant is it - and none of it
 * needs a value. There is deliberately no way to get a value out of the result, so a structural
 * check can never be mistaken for a value declassification.
 */
export function declassifyShape(value: unknown): Shape {
  if (value === null || value === undefined) return { kind: "null", fields: [], length: null };
  if (Array.isArray(value)) return { kind: "array", fields: [], length: value.length };
  if (typeof value === "object") {
    return { kind: "object", fields: Object.keys(value).sort(), length: null };
  }
  return { kind: "primitive", fields: [], length: null };
}
