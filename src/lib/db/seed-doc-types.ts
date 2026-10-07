// ============================================================================
// Document type catalogue seed (supabase/migrations/0035, docs/24).
// ----------------------------------------------------------------------------
// Idempotent: a row is only written when it is new or its values differ from
// what is already stored — a no-op re-run writes nothing and leaves no
// doc_type_audit trail, so the catalogue's audit history stays meaningful
// rather than filling with identical re-seeds.
//
// JA names are best-effort drafts (name_ja_reviewed = false on every row),
// flagged per rule 8 for a native-speaker review before any investor-facing
// use — this file does not claim otherwise.
//
// `scripts/seed-doc-types.ts` is the CLI entry point; `seedDocTypes()` is
// exported separately so tests/future server actions can call it without
// going through a script that calls process.exit/closePool.
// ============================================================================
import { adminQuery } from "@/lib/db/client";

type GateKind = "none" | "transition" | "action";
type Origin = "produce" | "commission" | "receive";
type Scope = "deal" | "investor" | "counterparty";
type GenerationMode = "none" | "template_fill" | "memo_backed" | "manual_upload";

export interface DocTypeSeed {
  key: string;
  name_en: string;
  name_ja: string;
  stage: 0 | 1 | 2 | 3 | 4;
  origin: Origin;
  scope: Scope;
  audience: string[];
  gate_kind: GateKind;
  gate_action?: string | null;
  gate_condition?: string | null;
  jurisdiction?: "UK" | "NL" | null;
  jurisdiction_labels?: Record<string, string> | null;
  recurring?: boolean;
  generation_mode: GenerationMode;
  template_key?: string | null;
  governing_language?: "EN" | "JA";
  sort_order: number;
}

// Two "Conditional: X" shapes in the original catalogue mean different
// things and are kept distinct here:
//   gate_kind='transition', gate_condition=X   — blocks leaving the stage
//                                                 until X holds (or overridden)
//   gate_kind='none',       gate_condition=X   — the row only APPLIES when X
//                                                 holds (app.doc_type_applies,
//                                                 migration 0047); not a gate
export const DOC_TYPE_CATALOGUE: DocTypeSeed[] = [
  // ---- Stage 0 — Screen -----------------------------------------------
  { key: "broker_im", name_en: "Broker teaser / information memorandum", name_ja: "ブローカー・ティーザー／インフォメーション・メモランダム",
    stage: 0, origin: "receive", scope: "deal", audience: ["internal"], gate_kind: "none", generation_mode: "none", sort_order: 1 },
  { key: "screening_memo", name_en: "Five Tests screening memo", name_ja: "ファイブ・テスト審査メモ",
    stage: 0, origin: "produce", scope: "deal", audience: ["internal"], gate_kind: "transition", generation_mode: "memo_backed", sort_order: 2 },

  // ---- Stage 1 — Pitch-ready -------------------------------------------
  { key: "tenancy_schedule", name_en: "Tenancy schedule + lease summaries", name_ja: "テナンシー・スケジュール及びリース要約",
    stage: 1, origin: "produce", scope: "deal", audience: ["investor"], gate_kind: "transition", generation_mode: "template_fill", template_key: "tenancy_schedule_v1", sort_order: 10 },
  { key: "underwriting_model", name_en: "Underwriting model (full, yen-hedged returns)", name_ja: "アンダーライティング・モデル（フル、円ヘッジ後リターン）",
    stage: 1, origin: "produce", scope: "deal", audience: ["internal only — never in deal room"], gate_kind: "transition", generation_mode: "none", sort_order: 11 },
  { key: "underwriting_summary", name_en: "Underwriting summary (returns, sensitivities, key assumptions)", name_ja: "アンダーライティング・サマリー（リターン、感応度、主要前提条件）",
    stage: 1, origin: "produce", scope: "deal", audience: ["investor"], gate_kind: "transition", generation_mode: "memo_backed", sort_order: 12 },
  { key: "comps_sheet", name_en: "Comparables sheet", name_ja: "比較事例シート",
    stage: 1, origin: "produce", scope: "deal", audience: ["investor"], gate_kind: "none", generation_mode: "none", sort_order: 13 },
  { key: "business_plan", name_en: "Business plan + risk register", name_ja: "事業計画及びリスク登録簿",
    stage: 1, origin: "produce", scope: "deal", audience: ["investor"], gate_kind: "transition", generation_mode: "memo_backed", sort_order: 14 },
  { key: "investor_teaser", name_en: "Anonymised investor teaser", name_ja: "匿名化インベスター・ティーザー",
    stage: 1, origin: "produce", scope: "deal", audience: ["investor"], gate_kind: "transition", generation_mode: "memo_backed", sort_order: 15 },
  { key: "investor_nda", name_en: "Investor NDA with non-circumvention and fee protection", name_ja: "インベスターNDA（非回避及びフィー保護条項付き）",
    stage: 1, origin: "produce", scope: "investor", audience: ["investor"], gate_kind: "action", gate_action: "release_pitch_pack_and_portal_access", generation_mode: "manual_upload", sort_order: 16 },
  { key: "pitch_pack", name_en: "Investment summary / pitch pack", name_ja: "投資サマリー／ピッチパック",
    stage: 1, origin: "produce", scope: "deal", audience: ["investor"], gate_kind: "transition", generation_mode: "memo_backed", sort_order: 17 },

  // ---- Stage 2 — Soft-circled -------------------------------------------
  { key: "investor_ioi", name_en: "Investor indication of interest", name_ja: "インベスター関心表明書（IOI）",
    stage: 2, origin: "receive", scope: "investor", audience: ["internal"], gate_kind: "transition", generation_mode: "none", sort_order: 20 },
  { key: "advisory_mandate", name_en: "Advisory mandate / engagement letter", name_ja: "アドバイザリー・マンデート／エンゲージメント・レター",
    stage: 2, origin: "produce", scope: "investor", audience: ["investor"], gate_kind: "transition", generation_mode: "manual_upload", sort_order: 21 },
  { key: "jp_pre_contract_disclosure", name_en: "Pre-contract disclosure document (契約締結前交付書面)", name_ja: "契約締結前交付書面",
    stage: 2, origin: "produce", scope: "investor", audience: ["investor"], gate_kind: "transition", gate_condition: "regulated_disclosure", generation_mode: "template_fill", template_key: "jp_pre_contract_disclosure_v1", sort_order: 22 },
  { key: "investor_kyc", name_en: "Investor KYC / AML file (incl. source of funds)", name_ja: "インベスターKYC／AMLファイル（資金源泉含む）",
    stage: 2, origin: "receive", scope: "investor", audience: ["internal"], gate_kind: "transition", generation_mode: "none", sort_order: 23 },
  { key: "sanctions_screening_investor", name_en: "Sanctions and PEP screening (investor)", name_ja: "制裁及びPEPスクリーニング（投資家）",
    stage: 2, origin: "produce", scope: "investor", audience: ["internal"], gate_kind: "transition", generation_mode: "none", sort_order: 24 },
  { key: "sanctions_screening_vendor", name_en: "Sanctions and PEP screening (vendor)", name_ja: "制裁及びPEPスクリーニング（売主）",
    stage: 2, origin: "produce", scope: "counterparty", audience: ["internal"], gate_kind: "transition", generation_mode: "none", sort_order: 25 },
  { key: "abort_cost_agreement", name_en: "Abort-cost / DD cost-sharing agreement", name_ja: "アボートコスト／DDコスト分担契約",
    stage: 2, origin: "produce", scope: "investor", audience: ["investor"], gate_kind: "action", gate_action: "instruct_stage3_commission", generation_mode: "manual_upload", sort_order: 26 },
  { key: "ringi_pack", name_en: "Internal approval support pack (稟議 support, JA-first)", name_ja: "社内承認支援パック（稟議サポート、日本語優先）",
    stage: 2, origin: "produce", scope: "investor", audience: ["investor"], gate_kind: "none", gate_condition: "investor_type:corporate", generation_mode: "template_fill", template_key: "ringi_pack_v1", governing_language: "JA", sort_order: 27 },
  { key: "offer_letter", name_en: "Indicative offer letter to vendor", name_ja: "売主への指標的オファーレター",
    stage: 2, origin: "produce", scope: "deal", audience: ["vendor"], gate_kind: "transition", generation_mode: "template_fill", template_key: "offer_letter_v1", sort_order: 28 },
  { key: "vendor_nda", name_en: "Vendor NDA + data room access", name_ja: "売主NDA及びデータルームアクセス",
    stage: 2, origin: "receive", scope: "deal", audience: ["internal"], gate_kind: "none", generation_mode: "none", sort_order: 29 },

  // ---- Stage 3 — Closing -------------------------------------------------
  { key: "heads_of_terms", name_en: "Heads of terms", name_ja: "基本合意書（HOT）",
    stage: 3, origin: "produce", scope: "deal", audience: ["vendor", "investor"], gate_kind: "transition", generation_mode: "none", sort_order: 30 },
  { key: "title_report", name_en: "Legal report on title (incl. searches and enquiries)", name_ja: "権利関係法務報告書（調査事項含む）",
    stage: 3, origin: "commission", scope: "deal", audience: ["investor"], gate_kind: "transition", generation_mode: "none", sort_order: 31 },
  { key: "building_survey", name_en: "Building survey / technical DD", name_ja: "建物調査／テクニカルDD",
    stage: 3, origin: "commission", scope: "deal", audience: ["investor"], gate_kind: "transition", generation_mode: "none", sort_order: 32 },
  { key: "environmental_report", name_en: "Environmental report", name_ja: "環境報告書",
    stage: 3, origin: "commission", scope: "deal", audience: ["investor"], gate_kind: "none", generation_mode: "none", sort_order: 33 },
  { key: "valuation_report", name_en: "Valuation report", name_ja: "鑑定評価報告書",
    stage: 3, origin: "commission", scope: "deal", audience: ["investor", "lender"], gate_kind: "transition", generation_mode: "none", sort_order: 34 },
  { key: "tax_structuring_memo", name_en: "Tax and structuring memo (SPV, UK/NL side)", name_ja: "税務及びストラクチャリング・メモ（SPV、英国／オランダ側）",
    stage: 3, origin: "commission", scope: "deal", audience: ["investor"], gate_kind: "transition", generation_mode: "none", sort_order: 35 },
  { key: "jp_tax_opinion", name_en: "Japanese tax opinion (depreciation schedule, useful-life basis, investor-level treatment)", name_ja: "日本税務意見書（減価償却スケジュール、耐用年数基準、投資家レベルの取扱い）",
    stage: 3, origin: "commission", scope: "deal", audience: ["investor"], gate_kind: "transition", generation_mode: "none", sort_order: 36 },
  { key: "final_ic_memo", name_en: "Final IC memo + investor approval", name_ja: "最終IC（投資委員会）メモ及び投資承認",
    stage: 3, origin: "produce", scope: "deal", audience: ["investor"], gate_kind: "transition", gate_condition: "requires_ic_decision", generation_mode: "memo_backed", sort_order: 37 },
  { key: "spv_agreement", name_en: "SPV / JV or shareholders' agreement", name_ja: "SPV／JVまたは株主間契約",
    stage: 3, origin: "commission", scope: "deal", audience: ["investor"], gate_kind: "transition", generation_mode: "none", sort_order: 38 },
  { key: "financing_docs", name_en: "Financing term sheet + facility agreement", name_ja: "ファイナンス・タームシート及びファシリティ契約",
    stage: 3, origin: "commission", scope: "deal", audience: ["investor", "lender"], gate_kind: "transition", gate_condition: "geared", generation_mode: "none", sort_order: 39 },
  { key: "lender_reliance_letters", name_en: "Lender reliance letters on DD reports", name_ja: "DDレポートに関するレンダー・リライアンス・レター",
    stage: 3, origin: "commission", scope: "deal", audience: ["lender"], gate_kind: "transition", gate_condition: "geared", generation_mode: "none", sort_order: 40 },
  { key: "fx_hedge_docs", name_en: "FX hedge documentation (ISDA / confirmations)", name_ja: "FXヘッジ関連文書（ISDA／コンファメーション）",
    stage: 3, origin: "commission", scope: "deal", audience: ["investor"], gate_kind: "transition", gate_condition: "hedged", generation_mode: "none", sort_order: 41 },
  { key: "overseas_entity_registration", name_en: "Register of Overseas Entities (UK) / UBO register filing (NL)", name_ja: "海外事業体登録（英国）／UBO登録申請（オランダ）",
    stage: 3, origin: "commission", scope: "deal", audience: ["internal"], gate_kind: "transition", generation_mode: "none",
    jurisdiction_labels: { UK: "Register of Overseas Entities filing", NL: "UBO register filing" }, sort_order: 42 },
  { key: "insurance_certificate", name_en: "Buildings insurance certificate", name_ja: "建物保険証券",
    stage: 3, origin: "commission", scope: "deal", audience: ["investor", "lender"], gate_kind: "transition", generation_mode: "none", sort_order: 43 },
  { key: "exchange_contracts", name_en: "Exchange of contracts + deposit", name_ja: "契約交換及び手付金",
    stage: 3, origin: "commission", scope: "deal", audience: ["investor"], gate_kind: "transition", gate_condition: "jurisdiction:UK", jurisdiction: "UK", generation_mode: "none", sort_order: 44 },
  { key: "spa_transfer", name_en: "SPA / transfer deed (UK) or notarial deed (NL)", name_ja: "SPA／譲渡証書（英国）または公証契約書（オランダ）",
    stage: 3, origin: "commission", scope: "deal", audience: ["investor"], gate_kind: "transition", generation_mode: "none",
    jurisdiction_labels: { UK: "SPA / transfer deed", NL: "Notarial deed" }, sort_order: 45 },
  { key: "completion_statement", name_en: "Completion statement + funds flow", name_ja: "完了ステートメント及びファンズフロー",
    stage: 3, origin: "commission", scope: "deal", audience: ["investor"], gate_kind: "transition", generation_mode: "none", sort_order: 46 },

  // ---- Stage 4 — Hold ------------------------------------------------------
  { key: "completion_report", name_en: "Completion report + business plan baseline", name_ja: "完了報告書及び事業計画ベースライン",
    stage: 4, origin: "produce", scope: "deal", audience: ["investor"], gate_kind: "none", generation_mode: "template_fill", template_key: "completion_report_v1", sort_order: 50 },
  { key: "am_agreement", name_en: "Asset management agreement", name_ja: "アセットマネジメント契約",
    stage: 4, origin: "produce", scope: "deal", audience: ["investor"], gate_kind: "none", generation_mode: "manual_upload", sort_order: 51 },
  { key: "jp_fx_filing", name_en: "Japanese FX Act overseas investment report (外為法)", name_ja: "外為法に基づく対外直接投資報告書",
    stage: 4, origin: "receive", scope: "investor", audience: ["internal"], gate_kind: "none", gate_condition: "investor_type:corporate", generation_mode: "none", sort_order: 52 },
  { key: "quarterly_report", name_en: "Quarterly investor report + distribution notices", name_ja: "四半期投資家報告書及び分配通知",
    stage: 4, origin: "produce", scope: "deal", audience: ["investor"], gate_kind: "none", recurring: true, generation_mode: "template_fill", template_key: "quarterly_report_v1", sort_order: 53 },
  { key: "annual_valuation", name_en: "Annual valuation", name_ja: "年次鑑定評価",
    stage: 4, origin: "commission", scope: "deal", audience: ["investor"], gate_kind: "none", recurring: true, generation_mode: "none", sort_order: 54 },
];

// Postgres jsonb does not preserve object key insertion order (it is
// normalised on storage), so a plain JSON.stringify of a value round-tripped
// through `jurisdiction_labels` can differ textually from the literal that
// was inserted even when semantically identical — which would make this
// comparison report "changed" forever and defeat the no-op re-run guarantee.
// Sort object keys (never array elements, where order is meaningful) before
// comparing.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).sort().reduce((acc, k) => {
      acc[k] = canonical((value as Record<string, unknown>)[k]);
      return acc;
    }, {} as Record<string, unknown>);
  }
  return value;
}

function sameRow(existing: Record<string, unknown>, seed: DocTypeSeed): boolean {
  const normalised = {
    name_en: seed.name_en, name_ja: seed.name_ja, stage: seed.stage, origin: seed.origin,
    scope: seed.scope, audience: seed.audience, gate_kind: seed.gate_kind,
    gate_action: seed.gate_action ?? null, gate_condition: seed.gate_condition ?? null,
    jurisdiction: seed.jurisdiction ?? null, jurisdiction_labels: seed.jurisdiction_labels ?? null,
    recurring: seed.recurring ?? false, generation_mode: seed.generation_mode,
    template_key: seed.template_key ?? null, governing_language: seed.governing_language ?? "EN",
    sort_order: seed.sort_order,
  };
  const current = {
    name_en: existing.name_en, name_ja: existing.name_ja, stage: existing.stage, origin: existing.origin,
    scope: existing.scope, audience: existing.audience, gate_kind: existing.gate_kind,
    gate_action: existing.gate_action, gate_condition: existing.gate_condition,
    jurisdiction: existing.jurisdiction, jurisdiction_labels: existing.jurisdiction_labels,
    recurring: existing.recurring, generation_mode: existing.generation_mode,
    template_key: existing.template_key, governing_language: existing.governing_language,
    sort_order: existing.sort_order,
  };
  return JSON.stringify(canonical(normalised)) === JSON.stringify(canonical(current));
}

export interface SeedDocTypesResult {
  created: number;
  updated: number;
  skipped: number;
  total: number;
}

export async function seedDocTypes(): Promise<SeedDocTypesResult> {
  const existingRows = await adminQuery<Record<string, unknown>>("select * from doc_type");
  const existingByKey = new Map(existingRows.map((r) => [r.key as string, r]));

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const seed of DOC_TYPE_CATALOGUE) {
    const existing = existingByKey.get(seed.key);
    if (existing && sameRow(existing, seed)) {
      skipped++;
      continue;
    }
    await adminQuery(
      `insert into doc_type (key, name_en, name_ja, name_ja_reviewed, stage, origin, scope, audience,
                             gate_kind, gate_action, gate_condition, jurisdiction, jurisdiction_labels,
                             recurring, generation_mode, template_key, governing_language, sort_order)
       values ($1,$2,$3,false,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       on conflict (key) do update set
         name_en = excluded.name_en, name_ja = excluded.name_ja, stage = excluded.stage,
         origin = excluded.origin, scope = excluded.scope, audience = excluded.audience,
         gate_kind = excluded.gate_kind, gate_action = excluded.gate_action,
         gate_condition = excluded.gate_condition, jurisdiction = excluded.jurisdiction,
         jurisdiction_labels = excluded.jurisdiction_labels, recurring = excluded.recurring,
         generation_mode = excluded.generation_mode, template_key = excluded.template_key,
         governing_language = excluded.governing_language, sort_order = excluded.sort_order,
         updated_at = now()`,
      [seed.key, seed.name_en, seed.name_ja, seed.stage, seed.origin, seed.scope, seed.audience,
       seed.gate_kind, seed.gate_action ?? null, seed.gate_condition ?? null, seed.jurisdiction ?? null,
       seed.jurisdiction_labels ? JSON.stringify(seed.jurisdiction_labels) : null,
       seed.recurring ?? false, seed.generation_mode, seed.template_key ?? null,
       seed.governing_language ?? "EN", seed.sort_order],
    );
    if (existing) updated++; else created++;
  }

  return { created, updated, skipped, total: DOC_TYPE_CATALOGUE.length };
}
