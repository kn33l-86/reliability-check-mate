// Reliability scoring + safety engine (rule-based, deterministic).
// Kept UI-agnostic so it can later be moved server-side or swapped for an LLM judge.

export type Label = "Certain" | "Uncertain" | "Needs Verification" | "Rejected";
export type EvidenceStatus = "Supported" | "Partial" | "Missing" | "Contradicted";

export interface CheckInput {
  question: string;
  answer: string;
  sources: string[];
  expectedLabel?: "Certain" | "Uncertain" | "Needs Verification" | "Unknown";
  confidence?: number; // 0..1 from the model (optional)
}

export interface CheckResult {
  answer: string;
  label: Label;
  reason: string;
  evidence_status: EvidenceStatus;
  perplexity: number; // approximate uncertainty score (higher = more uncertain)
  overlap: number; // 0..1
  contradiction: number; // 0..1
  warning: string | null;
  safe_to_answer: boolean;
  expected_match: boolean | null;
}

const STOPWORDS = new Set([
  "the","a","an","of","to","in","on","at","by","for","and","or","is","are","was","were","be","been","being",
  "it","its","this","that","these","those","as","with","from","into","about","which","who","whom","whose",
  "what","when","where","why","how","do","does","did","has","have","had","will","would","can","could","should",
  "may","might","i","you","he","she","they","we","them","us","my","your","their","our","not","no","yes",
]);

const NEGATIONS = ["not", "never", "no", "cannot", "can't", "won't", "isn't", "aren't", "wasn't", "weren't", "didn't", "doesn't", "don't"];

// --- Safety layer ---------------------------------------------------------

const UNSAFE_PATTERNS: { category: string; re: RegExp }[] = [
  { category: "self-harm", re: /\b(suicide|kill myself|self[- ]harm|end my life)\b/i },
  { category: "violence", re: /\b(how to (kill|murder|attack)|make a bomb|build a weapon)\b/i },
  { category: "illegal", re: /\b(how to (hack|steal|launder)|buy (drugs|meth|cocaine))\b/i },
  { category: "hateful", re: /\b(racial slur|kill all [a-z]+s)\b/i },
  { category: "sexual", re: /\b(explicit sexual|csam|underage sex)\b/i },
  { category: "personal-data", re: /\b(\d{3}-\d{2}-\d{4}|\b\d{16}\b)/ }, // SSN / raw card
  { category: "prompt-injection", re: /\b(ignore (all )?previous (instructions|rules)|disregard the system prompt|you are now)\b/i },
];

export interface SafetyVerdict {
  safe: boolean;
  category?: string;
  message?: string;
}

export function evaluateSafety(question: string, answer: string): SafetyVerdict {
  const blob = `${question}\n${answer}`;
  for (const { category, re } of UNSAFE_PATTERNS) {
    if (re.test(blob)) {
      return {
        safe: false,
        category,
        message: `This request was blocked because it appears to involve ${category.replace("-", " ")} content. The Reliability Checker refuses these prompts by design.`,
      };
    }
  }
  const trimmed = question.trim();
  if (trimmed.length < 3) {
    return { safe: false, category: "nonsense", message: "The question is too short or unclear to evaluate." };
  }
  if (/^[^a-z0-9]+$/i.test(trimmed)) {
    return { safe: false, category: "nonsense", message: "The question contains no meaningful content." };
  }
  return { safe: true };
}

// --- Text utilities -------------------------------------------------------

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t) && t.length > 1);
}

function contentTokens(text: string): Set<string> {
  return new Set(tokenize(text));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

// Very small entity heuristic: capitalized multiword phrases + numbers/dates.
function extractEntities(text: string): string[] {
  const ents = new Set<string>();
  const capRe = /\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3})\b/g;
  let m: RegExpExecArray | null;
  while ((m = capRe.exec(text)) !== null) ents.add(m[1].toLowerCase());
  const numRe = /\b(\d{2,4}(?:\.\d+)?)\b/g;
  while ((m = numRe.exec(text)) !== null) ents.add(m[1]);
  return [...ents];
}

function entityOverlap(answer: string, sources: string): number {
  const aEnts = extractEntities(answer);
  if (!aEnts.length) return 0;
  const src = sources.toLowerCase();
  const hit = aEnts.filter((e) => src.includes(e)).length;
  return hit / aEnts.length;
}

function contradictionScore(answer: string, sources: string): number {
  // Simple heuristic: if answer or source contains a negation and the other doesn't,
  // and they share entities, treat as possible contradiction.
  const aLower = answer.toLowerCase();
  const sLower = sources.toLowerCase();
  const aNeg = NEGATIONS.some((n) => new RegExp(`\\b${n}\\b`).test(aLower));
  const sNeg = NEGATIONS.some((n) => new RegExp(`\\b${n}\\b`).test(sLower));
  const ents = extractEntities(answer).filter((e) => sLower.includes(e));
  if (!ents.length) return 0;
  if (aNeg !== sNeg) return 0.75;

  // Number mismatch on same entity context
  const aNums = (answer.match(/\b\d{2,4}\b/g) || []);
  const sNums = (sources.match(/\b\d{2,4}\b/g) || []);
  if (aNums.length && sNums.length) {
    const shared = aNums.some((n) => sNums.includes(n));
    if (!shared) return 0.6;
  }
  return 0;
}

// Approximate a perplexity-like score from the answer text and evidence signals.
// Not a true LM perplexity; a bounded 1..100 uncertainty proxy the UI can display.
function approxPerplexity(answer: string, overlap: number, contradiction: number, modelConfidence?: number): number {
  const tokens = tokenize(answer);
  const uniqueRatio = tokens.length ? new Set(tokens).size / tokens.length : 1;
  const hedges = (answer.match(/\b(maybe|might|perhaps|possibly|i think|not sure|unclear|allegedly|reportedly)\b/gi) || []).length;
  let base = 20 + uniqueRatio * 25 + hedges * 8;
  base += (1 - overlap) * 35;
  base += contradiction * 40;
  if (typeof modelConfidence === "number") base -= modelConfidence * 20;
  return Math.max(5, Math.min(100, Math.round(base)));
}

// --- Sanitization ---------------------------------------------------------

export function sanitize(text: string, maxLen = 4000): string {
  return text
    .replace(/[\u0000-\u001F\u007F]/g, " ") // control chars
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

// --- Main check -----------------------------------------------------------

export function runReliabilityCheck(raw: CheckInput): CheckResult {
  const question = sanitize(raw.question, 1000);
  const answer = sanitize(raw.answer, 4000);
  const sources = raw.sources.map((s) => sanitize(s, 4000)).filter(Boolean);

  const safety = evaluateSafety(question, answer);
  if (!safety.safe) {
    return {
      answer: "",
      label: "Rejected",
      reason: safety.message ?? "Blocked by safety policy.",
      evidence_status: "Missing",
      perplexity: 100,
      overlap: 0,
      contradiction: 0,
      warning: "Request refused by safety layer.",
      safe_to_answer: false,
      expected_match: raw.expectedLabel && raw.expectedLabel !== "Unknown" ? raw.expectedLabel === "Needs Verification" : null,
    };
  }

  const joinedSources = sources.join("\n\n");
  const aTokens = contentTokens(answer);
  const sTokens = contentTokens(joinedSources);
  const lexical = jaccard(aTokens, sTokens);
  const entityOv = entityOverlap(answer, joinedSources);
  const overlap = sources.length ? Math.max(lexical, entityOv * 0.9 + lexical * 0.1) : 0;
  const contradiction = sources.length ? contradictionScore(answer, joinedSources) : 0;
  const perplexity = approxPerplexity(answer, overlap, contradiction, raw.confidence);

  let evidence_status: EvidenceStatus;
  let label: Label;
  let reason: string;
  let warning: string | null = null;

  if (sources.length === 0) {
    evidence_status = "Missing";
    label = "Needs Verification";
    reason = "No source snippet was provided, so the answer cannot be verified against evidence.";
    warning = "Evidence is missing — treat the answer as unverified.";
  } else if (contradiction >= 0.5) {
    evidence_status = "Contradicted";
    label = "Needs Verification";
    reason = "The answer appears to contradict the provided source (differing negation or key figures).";
    warning = "Possible contradiction between answer and source.";
  } else if (overlap >= 0.45 || entityOv >= 0.8) {
    evidence_status = "Supported";
    label = "Certain";
    reason = "The answer's key terms and entities are clearly present in the source snippet.";
  } else if (overlap >= 0.18 || entityOv >= 0.4) {
    evidence_status = "Partial";
    label = "Uncertain";
    reason = "The answer is only partially supported — some entities match but coverage is thin.";
    warning = "Evidence is weak. Consider adding a stronger source.";
  } else {
    evidence_status = "Missing";
    label = "Needs Verification";
    reason = "The provided source does not appear to support the answer's key claims.";
    warning = "Evidence does not cover the claim.";
  }

  if (perplexity > 75 && label === "Certain") {
    label = "Uncertain";
    reason += " Model uncertainty is high, so the label was softened.";
    warning = warning ?? "High uncertainty in the generated answer.";
  }

  const expected_match =
    raw.expectedLabel && raw.expectedLabel !== "Unknown" ? raw.expectedLabel === label : null;

  return {
    answer,
    label,
    reason,
    evidence_status,
    perplexity,
    overlap: Number(overlap.toFixed(2)),
    contradiction: Number(contradiction.toFixed(2)),
    warning,
    safe_to_answer: label !== "Rejected",
    expected_match,
  };
}

// --- Sample dataset -------------------------------------------------------

export interface SampleCase {
  id: string;
  title: string;
  question: string;
  answer: string;
  sources: string[];
  expectedLabel: CheckInput["expectedLabel"];
  confidence?: number;
}

export const SAMPLE_CASES: SampleCase[] = [
  {
    id: "supported",
    title: "Supported — Python's creator",
    question: "Who invented Python?",
    answer: "Guido van Rossum invented Python.",
    sources: ["Python was created by Guido van Rossum and first released in 1991."],
    expectedLabel: "Certain",
    confidence: 0.92,
  },
  {
    id: "partial",
    title: "Partial — Eiffel Tower height",
    question: "How tall is the Eiffel Tower?",
    answer: "The Eiffel Tower is roughly 300 meters tall, located in Paris.",
    sources: ["The Eiffel Tower is a wrought-iron tower in Paris, France."],
    expectedLabel: "Uncertain",
    confidence: 0.6,
  },
  {
    id: "missing",
    title: "Unsupported — No source",
    question: "What is the population of Mars colonies in 2040?",
    answer: "There will be about 1.2 million people living on Mars by 2040.",
    sources: [],
    expectedLabel: "Needs Verification",
    confidence: 0.4,
  },
  {
    id: "contradicted",
    title: "Contradicted — Wrong year",
    question: "When did the Berlin Wall fall?",
    answer: "The Berlin Wall fell in 1975.",
    sources: ["The Berlin Wall fell on November 9, 1989, marking the end of the Cold War era in Germany."],
    expectedLabel: "Needs Verification",
    confidence: 0.5,
  },
];
