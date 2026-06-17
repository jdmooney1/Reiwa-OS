"use client";

import { useMemo, useState } from "react";
import {
  FilePlus, RefreshCw, ShieldAlert, Scale, Languages, MessageSquare,
  ListChecks, Copy, Sparkles, Loader2, X, Check, FileDown,
} from "lucide-react";
import type { DealFile } from "@/types/database";
import type { DealNarrative } from "@/lib/mock-data";
import {
  MEMO_SECTIONS, SECTION_LABEL, OUTPUT_FORMATS, FORMAT_BY_KEY,
  type MemoSectionKey, type OutputFormat,
} from "@/lib/memo/sections";
import {
  generateSection, generateDraft, summariseRisks, generateICRecommendation,
  generateJapaneseSummary, generateBrokerQuestions, generateDDRequestList,
  assembleDocument,
} from "@/lib/memo/generate";
import { cn } from "@/lib/utils";

type SideOutput = { title: string; items: string[] } | null;

// Simulate an async "generation" call (placeholder for an LLM backend).
const withDelay = <T,>(value: T, ms = 500): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

export function MemoTab({ file, narrative }: { file: DealFile; narrative?: DealNarrative }) {
  const [format, setFormat] = useState<OutputFormat>("ic");
  const [content, setContent] = useState<Partial<Record<MemoSectionKey, string>>>({});
  const [japanese, setJapanese] = useState<string>("");
  const [active, setActive] = useState<MemoSectionKey>("executive_summary");
  const [busy, setBusy] = useState<string | null>(null);
  const [side, setSide] = useState<SideOutput>(null);
  const [copied, setCopied] = useState(false);

  const isJP = format === "japanese";
  const visibleSections = isJP ? [] : FORMAT_BY_KEY[format].sections;

  const run = async (id: string, fn: () => void | Promise<void>) => {
    setBusy(id);
    await withDelay(null);
    await fn();
    setBusy(null);
  };

  const changeFormat = (f: OutputFormat) => {
    setSide(null);
    setFormat(f);
    if (f !== "japanese") {
      const first = FORMAT_BY_KEY[f].sections[0];
      if (first) setActive(first);
    }
  };

  // ---- Actions -------------------------------------------------------------
  const onFirstDraft = () =>
    run("draft", () => {
      setContent(generateDraft(file, narrative));
      setJapanese(generateJapaneseSummary(file, narrative));
      setSide(null);
    });

  const onRegenerate = () =>
    run("regen", () => {
      if (isJP) setJapanese(generateJapaneseSummary(file, narrative));
      else setContent((c) => ({ ...c, [active]: generateSection(active, file, narrative) }));
    });

  const onSummariseRisks = () =>
    run("risks", () => {
      setContent((c) => ({ ...c, risk_mitigation: summariseRisks(file) }));
      setSide(null);
      setFormat("ic");
      setActive("risk_mitigation");
    });

  const onICRec = () =>
    run("ic", () => {
      setContent((c) => ({ ...c, recommendation: generateICRecommendation(file) }));
      setSide(null);
      setFormat("ic");
      setActive("recommendation");
    });

  const onJapanese = () =>
    run("jp", () => {
      setJapanese(generateJapaneseSummary(file, narrative));
      setFormat("japanese");
      setSide(null);
    });

  const onBroker = () =>
    run("broker", () => setSide({ title: "Broker Question List", items: generateBrokerQuestions(file) }));

  const onDD = () =>
    run("ddlist", () => setSide({ title: "DD Request List", items: generateDDRequestList(file) }));

  const onCopy = async () => {
    const text = isJP
      ? japanese
      : assembleDocument(visibleSections, content, `${file.deal.asset_name} — ${FORMAT_BY_KEY[format].label}`);
    try {
      await navigator.clipboard.writeText(text || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const hasDraft = Object.keys(content).length > 0 || japanese.length > 0;

  return (
    <div className="flex h-[calc(100vh-15rem)] min-h-[560px] flex-col overflow-hidden rounded-lg border border-line bg-surface-card">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-1 rounded-lg border border-line p-0.5">
          {OUTPUT_FORMATS.map((f) => (
            <button
              key={f.key}
              onClick={() => changeFormat(f.key)}
              title={f.description}
              className={cn(
                "rounded px-2.5 py-1 text-2xs font-medium transition-colors",
                format === f.key ? "bg-navy text-surface" : "text-ink-muted hover:text-ink",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onCopy}
            className="flex items-center gap-1.5 rounded border border-line px-2.5 py-1.5 text-2xs font-medium text-ink-muted hover:text-ink"
          >
            {copied ? <Check className="h-3 w-3 text-positive" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            disabled
            title="PDF export arrives in a later phase"
            className="flex items-center gap-1.5 rounded border border-line px-2.5 py-1.5 text-2xs font-medium text-ink-faint opacity-60"
          >
            <FileDown className="h-3 w-3" /> PDF
          </button>
          <button
            onClick={onFirstDraft}
            className="flex items-center gap-1.5 rounded bg-gold px-3 py-1.5 text-2xs font-semibold text-navy hover:bg-gold-soft"
          >
            {busy === "draft" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            Generate First Draft
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Left: section navigation */}
        <nav className="w-52 shrink-0 overflow-y-auto border-r border-line py-2">
          <div className="eyebrow px-4 py-1.5">{isJP ? "Summary" : "Sections"}</div>
          {isJP ? (
            <NavItem label="Japanese Summary" active drafted={!!japanese} onClick={() => {}} index={1} />
          ) : (
            visibleSections.map((key, i) => (
              <NavItem
                key={key}
                index={i + 1}
                label={SECTION_LABEL[key]}
                active={active === key && !side}
                drafted={!!content[key]?.trim()}
                onClick={() => { setActive(key); setSide(null); }}
              />
            ))
          )}
        </nav>

        {/* Center: editor or side output */}
        <div className="flex min-w-0 flex-1 flex-col">
          {side ? (
            <SideOutputView output={side} onClose={() => setSide(null)} />
          ) : (
            <Editor
              title={isJP ? "Japanese Language Summary" : SECTION_LABEL[active]}
              index={isJP ? undefined : visibleSections.indexOf(active) + 1}
              value={isJP ? japanese : content[active] ?? ""}
              onChange={(v) => (isJP ? setJapanese(v) : setContent((c) => ({ ...c, [active]: v })))}
              onRegenerate={onRegenerate}
              regenerating={busy === "regen"}
              placeholder={
                hasDraft
                  ? "This section is empty. Use Regenerate to draft it from the deal data."
                  : "No draft yet. Use “Generate First Draft” to compose the memo from the deal file, DD tracker, risk register, financial metrics and documents."
              }
            />
          )}
        </div>

        {/* Right: AI actions */}
        <aside className="w-60 shrink-0 overflow-y-auto border-l border-line bg-surface/60 px-3 py-3">
          <div className="eyebrow px-1 pb-2">AI Actions</div>
          <ActionGroup label="Draft">
            <Action icon={FilePlus} label="Generate first draft" hint="All sections" busy={busy === "draft"} onClick={onFirstDraft} />
            <Action icon={RefreshCw} label="Regenerate section" hint={isJP ? "Japanese summary" : SECTION_LABEL[active]} busy={busy === "regen"} onClick={onRegenerate} />
          </ActionGroup>
          <ActionGroup label="Analysis">
            <Action icon={ShieldAlert} label="Summarise risks" hint="→ Risk and Mitigation" busy={busy === "risks"} onClick={onSummariseRisks} />
            <Action icon={Scale} label="IC recommendation" hint="→ Recommendation" busy={busy === "ic"} onClick={onICRec} />
          </ActionGroup>
          <ActionGroup label="Audience">
            <Action icon={Languages} label="Japanese investor summary" hint="日本語サマリー" busy={busy === "jp"} onClick={onJapanese} />
            <Action icon={MessageSquare} label="Broker question list" hint="From open items" busy={busy === "broker"} onClick={onBroker} />
            <Action icon={ListChecks} label="DD request list" hint="Outstanding DD" busy={busy === "ddlist"} onClick={onDD} />
          </ActionGroup>
          <p className="mt-3 px-1 text-[10px] leading-relaxed text-ink-faint">
            Drafts are composed from this deal&apos;s data, DD tracker, risk register, metrics and documents. Review before circulation.
          </p>
        </aside>
      </div>
    </div>
  );
}

function NavItem({
  index, label, active, drafted, onClick,
}: {
  index: number; label: string; active: boolean; drafted: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-4 py-1.5 text-left text-xs transition-colors",
        active ? "bg-gold/10 text-ink" : "text-ink-muted hover:bg-surface-sunken/60 hover:text-ink",
      )}
    >
      <span className="tabular w-4 shrink-0 text-2xs text-ink-faint">{index}</span>
      <span className="flex-1 truncate">{label}</span>
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", drafted ? "bg-positive" : "bg-line")} />
    </button>
  );
}

function Editor({
  title, index, value, onChange, onRegenerate, regenerating, placeholder,
}: {
  title: string;
  index?: number;
  value: string;
  onChange: (v: string) => void;
  onRegenerate: () => void;
  regenerating: boolean;
  placeholder: string;
}) {
  const words = value.trim() ? value.trim().split(/\s+/).length : 0;
  return (
    <>
      <div className="flex items-center justify-between border-b border-line px-5 py-2.5">
        <div className="flex items-baseline gap-2">
          {index != null && <span className="tabular text-2xs text-ink-faint">{index}</span>}
          <h3 className="font-serif text-base text-ink">{title}</h3>
        </div>
        <button
          onClick={onRegenerate}
          className="flex items-center gap-1.5 rounded border border-line px-2.5 py-1 text-2xs font-medium text-ink-muted hover:border-gold/40 hover:text-ink"
        >
          {regenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Regenerate
        </button>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 resize-none bg-transparent px-6 py-5 text-sm leading-relaxed text-ink/90 placeholder:text-ink-faint focus:outline-none"
      />
      <div className="border-t border-line px-5 py-1.5 text-right text-[10px] text-ink-faint">
        {words} words
      </div>
    </>
  );
}

function SideOutputView({ output, onClose }: { output: { title: string; items: string[] }; onClose: () => void }) {
  return (
    <>
      <div className="flex items-center justify-between border-b border-line px-5 py-2.5">
        <h3 className="font-serif text-base text-ink">{output.title}</h3>
        <button onClick={onClose} className="flex items-center gap-1 text-2xs text-ink-muted hover:text-ink">
          <X className="h-3 w-3" /> Back to memo
        </button>
      </div>
      <ol className="flex-1 space-y-2.5 overflow-y-auto px-6 py-5">
        {output.items.map((item, i) => (
          <li key={i} className="flex gap-3 text-sm leading-relaxed text-ink/90">
            <span className="tabular mt-0.5 shrink-0 text-2xs font-medium text-gold-deep">{i + 1}.</span>
            <span>{item}</span>
          </li>
        ))}
      </ol>
    </>
  );
}

function ActionGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="px-1 pb-1 text-[10px] uppercase tracking-label text-ink-faint">{label}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Action({
  icon: Icon, label, hint, busy, onClick,
}: {
  icon: React.ElementType; label: string; hint: string; busy: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="flex w-full items-start gap-2.5 rounded border border-line bg-surface-card px-2.5 py-2 text-left transition-colors hover:border-gold/40 disabled:opacity-60"
    >
      <span className="mt-0.5 text-gold-deep">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />}
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-medium text-ink">{label}</span>
        <span className="block truncate text-[10px] text-ink-faint">{hint}</span>
      </span>
    </button>
  );
}
