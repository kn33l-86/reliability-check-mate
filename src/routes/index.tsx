import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  runReliabilityCheck,
  SAMPLE_CASES,
  type CheckResult,
  type Label,
  type SampleCase,
} from "@/lib/reliability";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Reliability Checker — Verify AI Answers Against Evidence" },
      {
        name: "description",
        content:
          "Score AI-generated answers for reliability. Get Certain / Uncertain / Needs Verification labels with evidence, contradiction detection, and an uncertainty meter.",
      },
      { property: "og:title", content: "Reliability Checker" },
      {
        property: "og:description",
        content: "Verify AI answers against sources with a rule-based reliability engine.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ReliabilityCheckerPage,
});

// --- Rate limiter (client-side courtesy limiter; backend adds real limits) --
const RATE_WINDOW_MS = 10_000;
const RATE_MAX = 8;
const rateHits: number[] = [];
function allowRun(): boolean {
  const now = Date.now();
  while (rateHits.length && now - rateHits[0] > RATE_WINDOW_MS) rateHits.shift();
  if (rateHits.length >= RATE_MAX) return false;
  rateHits.push(now);
  return true;
}

type ExpectedLabel = NonNullable<SampleCase["expectedLabel"]>;

function ReliabilityCheckerPage() {
  const [question, setQuestion] = useState(SAMPLE_CASES[0].question);
  const [answer, setAnswer] = useState(SAMPLE_CASES[0].answer);
  const [source, setSource] = useState(SAMPLE_CASES[0].sources.join("\n\n"));
  const [expected, setExpected] = useState<ExpectedLabel>(SAMPLE_CASES[0].expectedLabel!);
  const [confidence, setConfidence] = useState<number>(SAMPLE_CASES[0].confidence ?? 0.7);
  const [selectedSample, setSelectedSample] = useState<string>(SAMPLE_CASES[0].id);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const loadSample = (id: string) => {
    const s = SAMPLE_CASES.find((c) => c.id === id);
    if (!s) return;
    setSelectedSample(s.id);
    setQuestion(s.question);
    setAnswer(s.answer);
    setSource(s.sources.join("\n\n"));
    setExpected(s.expectedLabel!);
    setConfidence(s.confidence ?? 0.7);
    setResult(null);
    setError(null);
  };

  const handleRun = () => {
    setError(null);
    if (!allowRun()) {
      setError("Rate limit reached. Please wait a moment before running another check.");
      return;
    }
    if (!question.trim() || !answer.trim()) {
      setError("Question and answer are required.");
      return;
    }
    setRunning(true);
    // Simulated async so UI feels alive; scoring itself is sync.
    setTimeout(() => {
      const sources = source
        .split(/\n{2,}/)
        .map((s) => s.trim())
        .filter(Boolean);
      const res = runReliabilityCheck({
        question,
        answer,
        sources,
        expectedLabel: expected,
        confidence,
      });
      setResult(res);
      setRunning(false);
    }, 220);
  };

  const runAllDemo = () => {
    if (!allowRun()) {
      setError("Rate limit reached. Please wait a moment.");
      return;
    }
    // Runs all cases through the engine and shows the last for the panel;
    // the demo strip below always shows per-case badges anyway.
    const last = SAMPLE_CASES[SAMPLE_CASES.length - 1];
    loadSample(last.id);
    setTimeout(handleRun, 260);
  };

  const demoResults = useMemo(
    () =>
      SAMPLE_CASES.map((c) => ({
        c,
        r: runReliabilityCheck({
          question: c.question,
          answer: c.answer,
          sources: c.sources,
          expectedLabel: c.expectedLabel,
          confidence: c.confidence,
        }),
      })),
    [],
  );

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-6xl px-5 py-10 sm:py-14">
        <Header />

        <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-5">
          <section className="glass-card p-6 lg:col-span-3">
            <h2 className="text-lg font-semibold tracking-tight">Input</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Provide a question, the AI-generated answer, and any source snippets you want to verify against.
            </p>

            <div className="mt-5 space-y-4">
              <Field label="Question">
                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  rows={2}
                  maxLength={1000}
                  className="input"
                  placeholder="e.g. Who invented Python?"
                />
              </Field>

              <Field label="AI-generated answer">
                <textarea
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  rows={3}
                  maxLength={4000}
                  className="input"
                  placeholder="Paste the model's answer here"
                />
              </Field>

              <Field
                label="Source snippet(s)"
                hint="Separate multiple snippets with a blank line. Leave empty to test the 'no evidence' path."
              >
                <textarea
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  rows={4}
                  maxLength={8000}
                  className="input font-mono text-[13px]"
                  placeholder="Optional supporting text..."
                />
              </Field>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Expected label">
                  <select
                    value={expected}
                    onChange={(e) => setExpected(e.target.value as ExpectedLabel)}
                    className="input"
                  >
                    <option value="Certain">Certain</option>
                    <option value="Uncertain">Uncertain</option>
                    <option value="Needs Verification">Needs Verification</option>
                    <option value="Unknown">Unknown</option>
                  </select>
                </Field>

                <Field label={`Model confidence: ${Math.round(confidence * 100)}%`}>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(confidence * 100)}
                    onChange={(e) => setConfidence(Number(e.target.value) / 100)}
                    className="w-full accent-[var(--primary)]"
                  />
                </Field>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  onClick={handleRun}
                  disabled={running}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-black/20 transition hover:brightness-110 disabled:opacity-60"
                >
                  {running ? (
                    <>
                      <Spinner /> Checking…
                    </>
                  ) : (
                    <>Run Check →</>
                  )}
                </button>
                <button
                  onClick={runAllDemo}
                  className="rounded-lg border border-border bg-surface-elev px-4 py-2.5 text-sm font-medium text-foreground transition hover:bg-muted"
                >
                  Run demo mode
                </button>
                {error && <span className="text-sm text-[var(--danger)]">{error}</span>}
              </div>
            </div>
          </section>

          <section className="lg:col-span-2">
            <OutputPanel result={result} expected={expected} />
          </section>
        </div>

        <section className="mt-10">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold tracking-tight">Demo cases</h2>
            <span className="text-xs text-muted-foreground">Click a card to load it into the checker.</span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {demoResults.map(({ c, r }) => (
              <button
                key={c.id}
                onClick={() => loadSample(c.id)}
                className={`glass-card p-4 text-left transition hover:-translate-y-0.5 hover:border-[var(--primary)]/50 ${
                  selectedSample === c.id ? "ring-2 ring-[var(--primary)]/60" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">{c.title}</span>
                  <LabelBadge label={r.label} size="sm" />
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-foreground">{c.question}</p>
                <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{c.answer}</p>
              </button>
            ))}
          </div>
        </section>

        <footer className="mt-14 flex flex-col items-center gap-1 text-center text-xs text-muted-foreground">
          <p>Rule-based scoring runs locally. Swap in an LLM judge behind the same contract when ready.</p>
        </footer>
      </div>

      <style>{`
        .input {
          width: 100%;
          background: var(--input);
          color: var(--foreground);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 0.6rem 0.75rem;
          font-size: 0.9rem;
          outline: none;
          transition: border-color 120ms, box-shadow 120ms;
        }
        .input:focus {
          border-color: color-mix(in oklab, var(--primary) 70%, transparent);
          box-shadow: 0 0 0 3px color-mix(in oklab, var(--primary) 25%, transparent);
        }
        textarea.input { resize: vertical; min-height: 2.6rem; }
      `}</style>
    </main>
  );
}

function Header() {
  return (
    <header className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-[color-mix(in_oklab,var(--primary)_40%,transparent)]">
          <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2 3 6v6c0 5 4 9 9 10 5-1 9-5 9-10V6l-9-4Z" />
            <path d="m9 12 2 2 4-4" />
          </svg>
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Reliability Checker</h1>
          <p className="text-sm text-muted-foreground">
            Score AI answers with evidence, contradiction, and uncertainty signals.
          </p>
        </div>
      </div>
      <div className="hidden sm:flex items-center gap-2 rounded-full border border-border bg-surface-elev px-3 py-1.5 text-xs text-muted-foreground">
        <span className="h-2 w-2 rounded-full bg-[var(--primary)] shadow-[0_0_10px_var(--primary)]" />
        Engine online · v0.1
      </div>
    </header>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        {hint && <span className="text-[11px] text-muted-foreground/80">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

function OutputPanel({ result, expected }: { result: CheckResult | null; expected: ExpectedLabel }) {
  if (!result) {
    return (
      <div className="glass-card flex h-full min-h-[420px] flex-col items-center justify-center p-8 text-center">
        <div className="mb-3 grid h-14 w-14 place-items-center rounded-2xl border border-border bg-surface-elev text-muted-foreground">
          <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7" stroke="currentColor" strokeWidth={1.8}>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v4l3 2" />
          </svg>
        </div>
        <h3 className="text-base font-semibold">Awaiting check</h3>
        <p className="mt-1 max-w-xs text-sm text-muted-foreground">
          Fill in the inputs and hit <span className="text-foreground">Run Check</span> to see the reliability report.
        </p>
      </div>
    );
  }

  return (
    <div className="glass-card p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Reliability report</h2>
          <p className="text-xs text-muted-foreground">
            Expected: <span className="text-foreground">{expected}</span> ·{" "}
            {result.expected_match === null
              ? "no expectation set"
              : result.expected_match
                ? "matches expectation ✓"
                : "differs from expectation"}
          </p>
        </div>
        <LabelBadge label={result.label} />
      </div>

      {result.label === "Rejected" ? (
        <div className="mt-5 rounded-lg border border-[color-mix(in_oklab,var(--danger)_45%,transparent)] bg-[color-mix(in_oklab,var(--danger)_18%,transparent)] p-4 text-sm">
          <p className="font-semibold text-[var(--danger-foreground)]">Refused</p>
          <p className="mt-1 text-foreground/90">{result.reason}</p>
        </div>
      ) : (
        <>
          <div className="mt-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Answer</p>
            <p className="mt-1 text-sm text-foreground">{result.answer}</p>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <Stat label="Evidence" value={result.evidence_status} tone={evidenceTone(result.evidence_status)} />
            <Stat label="Overlap" value={`${Math.round(result.overlap * 100)}%`} />
            <Stat label="Contradiction" value={`${Math.round(result.contradiction * 100)}%`} tone={result.contradiction > 0.4 ? "danger" : "default"} />
            <Stat label="Perplexity" value={String(result.perplexity)} tone={result.perplexity > 70 ? "warn" : "default"} />
          </div>

          <div className="mt-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Uncertainty meter</p>
            <div className="meter-track mt-2 h-2.5 w-full">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${result.perplexity}%`,
                  background:
                    result.perplexity > 70
                      ? "var(--danger)"
                      : result.perplexity > 40
                        ? "var(--uncertain)"
                        : "var(--certain)",
                }}
              />
            </div>
          </div>

          <div className="mt-5 rounded-lg border border-border bg-surface-elev p-3 text-sm">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Reason</p>
            <p className="mt-1 text-foreground">{result.reason}</p>
          </div>

          {result.warning && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-[color-mix(in_oklab,var(--uncertain)_45%,transparent)] bg-[color-mix(in_oklab,var(--uncertain)_15%,transparent)] p-3 text-sm">
              <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="text-foreground/90">{result.warning}</span>
            </div>
          )}

          <details className="mt-4 rounded-lg border border-border bg-surface-elev/60 p-3 text-xs">
            <summary className="cursor-pointer text-muted-foreground">Raw JSON contract</summary>
            <pre className="mt-2 overflow-x-auto font-mono text-[11px] text-foreground/90">
{JSON.stringify(
  {
    answer: result.answer,
    label: result.label,
    reason: result.reason,
    evidence_status: result.evidence_status,
    perplexity: result.perplexity,
    warning: result.warning,
    safe_to_answer: result.safe_to_answer,
  },
  null,
  2,
)}
            </pre>
          </details>
        </>
      )}
    </div>
  );
}

function LabelBadge({ label, size = "md" }: { label: Label; size?: "sm" | "md" }) {
  const styles: Record<Label, { bg: string; fg: string; dot: string; text: string }> = {
    Certain: {
      bg: "color-mix(in oklab, var(--certain) 22%, transparent)",
      fg: "var(--certain)",
      dot: "var(--certain)",
      text: "Certain",
    },
    Uncertain: {
      bg: "color-mix(in oklab, var(--uncertain) 22%, transparent)",
      fg: "var(--uncertain)",
      dot: "var(--uncertain)",
      text: "Uncertain",
    },
    "Needs Verification": {
      bg: "color-mix(in oklab, var(--danger) 20%, transparent)",
      fg: "var(--danger)",
      dot: "var(--danger)",
      text: "Needs Verification",
    },
    Rejected: {
      bg: "color-mix(in oklab, var(--danger) 30%, transparent)",
      fg: "var(--danger-foreground)",
      dot: "var(--danger)",
      text: "Rejected",
    },
  };
  const s = styles[label];
  const pad = size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-3 py-1 text-xs";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold ${pad}`}
      style={{ background: s.bg, color: s.fg, border: `1px solid ${s.fg}` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.dot, boxShadow: `0 0 8px ${s.dot}` }} />
      {s.text}
    </span>
  );
}

function evidenceTone(e: CheckResult["evidence_status"]): StatTone {
  switch (e) {
    case "Supported": return "good";
    case "Partial": return "warn";
    case "Contradicted": return "danger";
    case "Missing": return "danger";
  }
}

type StatTone = "default" | "good" | "warn" | "danger";

function Stat({ label, value, tone = "default" }: { label: string; value: string; tone?: StatTone }) {
  const color =
    tone === "good"
      ? "var(--certain)"
      : tone === "warn"
        ? "var(--uncertain)"
        : tone === "danger"
          ? "var(--danger)"
          : "var(--foreground)";
  return (
    <div className="rounded-lg border border-border bg-surface-elev p-3">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-base font-semibold" style={{ color }}>{value}</p>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
