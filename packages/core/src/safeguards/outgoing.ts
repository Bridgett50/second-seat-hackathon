/**
 * Outgoing safeguard: blocks commitment language (accepting offers,
 * approving purchases) while staying negation-safe.
 *
 * Rule: the bot drafts replies, but only a person may commit Bridgett to
 * an offer or a purchase. Anything that reads as acceptance or as an
 * instruction to proceed is blocked; negated or neutral text stays allowed.
 */

export interface ScreenResult {
  allowed: boolean;
  reason?: string;
}

export type IncomingKind = "offer" | "request" | "neutral";

export interface IncomingClassification {
  kind: IncomingKind;
}

/** Words that negate a nearby acceptance, so the text must stay allowed. */
const NEGATION_PATTERN =
  /n't\b|n’t\b|\b(can\s+not|cannot|will\s+not|do\s+not|does\s+not|did\s+not|would\s+not|could\s+not|never|unable|refus\w*|declin\w*|reject\w*)\b/i;

/** Bare acceptance: "we accept", "I accept", "accepted", "accept your offer". */
const ACCEPT_PATTERN = /\b(we|i)\s+accept\b|\baccepted\b|\baccept\s+(your|the|this|that)\s+offer\b/i;

/** Approve + proceed in either order: "Approved. Please proceed ...". */
const APPROVE_PROCEED_PATTERN =
  /approv\w*[\s\S]*proceed|proceed[\s\S]*approv\w*/i;

/** "go ahead with the purchase/order/payment" and "proceed with the ...". */
const GO_AHEAD_PATTERN =
  /\bgo\s+ahead\s+with\s+the\s+(purchase|order|payment)\b|\bproceed\s+with\s+the\s+(purchase|order|payment)\b/i;

/**
 * Screen a draft outgoing message. Returns `{ allowed: false }` with a
 * reason when the text commits to an offer or a purchase; otherwise
 * `{ allowed: true }`. Negated acceptance ("can't accept ...") is allowed.
 */
export function screenOutgoing(text: string): ScreenResult {
  const input = text.trim();
  if (input.length === 0) {
    return { allowed: true, reason: "empty text carries no commitment" };
  }
  if (NEGATION_PATTERN.test(input)) {
    return { allowed: true, reason: "negation-safe: no commitment detected" };
  }
  if (GO_AHEAD_PATTERN.test(input)) {
    return { allowed: false, reason: "blocked: instruction to proceed with a purchase/order/payment" };
  }
  if (APPROVE_PROCEED_PATTERN.test(input)) {
    return { allowed: false, reason: "blocked: approve combined with proceed" };
  }
  if (ACCEPT_PATTERN.test(input)) {
    return { allowed: false, reason: "blocked: acceptance language" };
  }
  return { allowed: true };
}

const OFFER_PATTERN = /\b(offer|propos\w*|deal\b|terms\b|bid\b)\b/i;
const REQUEST_PATTERN = /\?|\bplease\b|\bcould\s+you\b|\bwould\s+you\b|\bcan\s+you\b|\bwill\s+you\b/i;

/** Classify an incoming transcript line as an offer, a request, or neutral. */
export function classifyIncoming(text: string): IncomingClassification {
  if (OFFER_PATTERN.test(text)) {
    return { kind: "offer" };
  }
  if (REQUEST_PATTERN.test(text)) {
    return { kind: "request" };
  }
  return { kind: "neutral" };
}
