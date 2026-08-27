// The `Tainted<T>` wrapper: a label that ordinary transformation cannot lose.
//
// WHAT THIS IS NOT. CaMeL (arXiv 2503.18813) gets automatic propagation because it owns a Python
// interpreter and can intercept every operation. Plain TypeScript cannot intercept `a + b`, a
// template literal, or `JSON.stringify`. So this is a LABELLING DISCIPLINE, not information-flow
// control, and calling it IFC would be a lie. `map(f)` hands `f` the raw value; `f` can capture it,
// close over it, and pass it anywhere.
//
// That is why the library has TWO mechanisms and not one. This wrapper is ergonomics and a
// compile-time nudge. `decide()` in policy.ts is the load-bearing part: it re-derives taint from
// the declared input provenance at the tool-call boundary, so a value laundered through a plain
// string still gets caught. Neither is sufficient alone; both are cheap.
//
// LABELS NEVER CARRY ATTACKER DATA. `taint` is a lattice member and `provenance` is a set drawn
// from a closed enum. Nothing in a label can carry a payload, which is why reading a label needs no
// receipt while reading a value does. It is also why there is no `detail: string` on a label,
// however much one would help debugging - a string there is a covert channel out of the wrapper.

import type { Declassification } from "./declassify.js";
import {
  type Capability,
  ContainmentError,
  type Provenance,
  type Taint,
  joinTaint,
  taintOf,
} from "./types.js";

/** What a `Tainted` knows about itself. Safe to read without declassifying. */
export interface TaintLabel {
  readonly taint: Taint;
  readonly provenance: ReadonlySet<Provenance>;
  /** More than one trust class contributed. A splice of user intent and injected text. */
  readonly mixed: boolean;
}

/**
 * A value carrying a label that transformation preserves.
 *
 * Deliberately an interface over a closure rather than a plain record: the value is captured in
 * scope and is not reachable as a property, so `JSON.stringify` of a `Tainted` yields the label and
 * not the payload. A naive `{ value, label }` object leaks the payload into every log line.
 */
export interface Tainted<T> {
  readonly label: TaintLabel;
  /** Transform the value; the label is preserved exactly. */
  readonly map: <U>(f: (value: T) => U) => Tainted<U>;
  /** Transform into another `Tainted`; the labels JOIN. Prefer this to `map` when combining. */
  readonly chain: <U>(f: (value: T) => Tainted<U>) => Tainted<U>;
  /** Lattice join of two labelled values. */
  readonly zip: <U>(other: Tainted<U>) => Tainted<readonly [T, U]>;
  /**
   * The only sanctioned way out. Requires a declassification whose capability and lift both cover
   * this value.
   *
   * Returns the DECLASSIFICATION'S admitted value, not the wrapped one. That is the most important
   * line in this file: it makes check-versus-use divergence unrepresentable. The usual design -
   * verify a hash, then use whatever you were holding - lets code validate one string and send
   * another, which is the bug this class of library exists to prevent.
   */
  readonly unwrap: (d: Declassification<T>, forCapability: Capability) => T;
  /**
   * Refuses to coerce. A TRIPWIRE, not a membrane - see the implementation for the distinction.
   *
   * Typed as `never` so a caller who interpolates a tainted value is told at compile time as well as
   * at runtime. The runtime half is the one that matters, because the compile-time half is exactly
   * what a JavaScript consumer of the published package does not have.
   */
  /** Refuses too. An explicit toString() bypasses ToPrimitive entirely; see the implementation. */
  readonly toString: () => never;
  readonly [Symbol.toPrimitive]: (hint: string) => never;
  /** Escape hatch. Always returns a warning string alongside; see docs/LIMITATIONS.md. */
  readonly unsafeUnwrap: (justification: string) => { readonly value: T; readonly warning: string };
}

const ORDER: Readonly<Record<Taint, number>> = {
  CLEAN: 0,
  USER_CONTROLLED: 1,
  TOOL_DERIVED: 2,
  UNTRUSTED_EXTERNAL: 3,
};

const covers = (lifts: Taint, actual: Taint): boolean => ORDER[actual] <= ORDER[lifts];

const makeLabel = (taint: Taint, provenance: ReadonlySet<Provenance>): TaintLabel => {
  const classes = new Set<Taint>([...provenance].map(taintOf));
  return { taint, provenance, mixed: classes.size > 1 };
};

/** Read the value out of a `Tainted` from inside this module, where that is legitimate. */
const peek = <T>(t: Tainted<T>): T => {
  let captured!: T;
  t.map((v) => {
    captured = v;
    return v;
  });
  return captured;
};

function wrap<T>(value: T, label: TaintLabel): Tainted<T> {
  return {
    label,
    map: <U>(f: (v: T) => U): Tainted<U> => wrap(f(value), label),
    chain: <U>(f: (v: T) => Tainted<U>): Tainted<U> => {
      const inner = f(value);
      const provenance = new Set<Provenance>([...label.provenance, ...inner.label.provenance]);
      return wrap(peek(inner), makeLabel(joinTaint(label.taint, inner.label.taint), provenance));
    },
    zip: <U>(other: Tainted<U>): Tainted<readonly [T, U]> => {
      const provenance = new Set<Provenance>([...label.provenance, ...other.label.provenance]);
      return wrap(
        [value, peek(other)] as const,
        makeLabel(joinTaint(label.taint, other.label.taint), provenance),
      );
    },
    unwrap: (d: Declassification<T>, forCapability: Capability): T => {
      if (d.capability !== forCapability) {
        throw new ContainmentError(
          "undeclassified_unwrap",
          `declassification was issued for ${d.capability}, not ${forCapability}. A receipt is not a bearer token: safety is capability-relative, and a value vetted for one sink says nothing about another.`,
        );
      }
      if (!covers(d.lifts, label.taint)) {
        throw new ContainmentError(
          "undeclassified_unwrap",
          `declassification lifts up to ${d.lifts} but this value is ${label.taint}`,
        );
      }
      return d.admitted;
    },
    unsafeUnwrap: (justification: string) => ({
      value,
      warning:
        `POLICY BYPASS: unsafeUnwrap on a ${label.taint} value. Justification: ` +
        `${JSON.stringify(justification)}. Recorded so an audit can find it. See LIMITATIONS.md.`,
    }),
    /**
     * A TRIPWIRE, not a membrane, and the difference is worth being exact about.
     *
     * There is still no membrane in JavaScript, and there cannot be: `+` returns a primitive, and a
     * primitive cannot carry a label, so nothing can propagate taint into the RESULT of a coercion.
     * That half of the limitation is unchanged and unchangeable. What IS interceptable is the
     * coercion itself - `Symbol.toPrimitive` fires for a template literal, for `String(x)`, and for
     * `x + ""`.
     *
     * Before this existed, all three silently produced the string "[object Object]". That never
     * leaked the VALUE, which is why it was not a security defect - but it is the wrong failure. A
     * developer interpolating an untrusted value into a prompt or a URL got a plausible-looking
     * string and no signal at all, and the mistake surfaces much later as a bug with no obvious
     * cause. Failing at the moment of coercion turns a silent wrong answer into a stack trace
     * pointing at the line that did it.
     *
     * `toJSON` is deliberately NOT overridden. `JSON.stringify` on a `Tainted` already emits the
     * label and never the value, because `value` is closed over rather than an own property, so
     * logging one is safe and useful. Breaking that would cost debuggability and buy nothing.
     */
    /**
     * `toString` is a SEPARATE hole and was one until the release-prep audit found it.
     *
     * An explicit `t.toString()` never goes through ToPrimitive, so `Symbol.toPrimitive` above does
     * not see it, and it silently returned "[object Object]" - the exact failure the tripwire was
     * built to remove, on a call shape that appears in every logging helper anyone writes. The four
     * documents that said "coercion now throws instead of silently stringifying" were wrong about
     * this one path. See DEFECTS_FOUND.md section 31.
     *
     * `Object.prototype.toString.call(t)` still returns "[object Object]" and cannot be intercepted.
     * That is a real remaining gap and it is named rather than papered over.
     */
    toString: (): never => {
      throw new ContainmentError(
        "undeclassified_unwrap",
        `a ${label.taint} value had toString() called on it. Same reason as a coercion: the result is a plain string and cannot carry a label. Use unwrap() with a declassification, map() to transform inside the wrapper, or unsafeUnwrap() with a written justification.`,
      );
    },
    [Symbol.toPrimitive]: (hint: string): never => {
      throw new ContainmentError(
        "undeclassified_unwrap",
        `a ${label.taint} value was coerced to a primitive (hint: ${hint}). Interpolating a
tainted value into a string is how a label gets lost: the result is a plain primitive and cannot
carry one. Use unwrap() with a declassification, map() to transform inside the wrapper, or
unsafeUnwrap() with a written justification to bypass this deliberately.`,
      );
    },
  };
}

/** Label a value with the taint implied by where it came from. */
export const tainted = <T>(value: T, provenance: Provenance): Tainted<T> =>
  wrap(value, makeLabel(taintOf(provenance), new Set([provenance])));

/**
 * A value that originated inside the trust boundary.
 *
 * Takes no provenance argument on purpose. `clean(x, "WEB")` should be unwriteable, because a
 * caller confident enough to hand-label web content as clean is exactly the caller an injection has
 * already talked to.
 */
export const clean = <T>(value: T): Tainted<T> =>
  wrap(value, makeLabel("CLEAN", new Set<Provenance>(["SYSTEM"])));

/** Join a list of labels. An empty list is `CLEAN`, the only defensible identity. */
export function joinLabels(labels: readonly TaintLabel[]): TaintLabel {
  let taint: Taint = "CLEAN";
  const provenance = new Set<Provenance>();
  for (const l of labels) {
    taint = joinTaint(taint, l.taint);
    for (const p of l.provenance) provenance.add(p);
  }
  return makeLabel(taint, provenance);
}
