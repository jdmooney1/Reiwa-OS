-- ============================================================================
-- Reiwa OS — Seed data
-- Three illustrative deals with metrics, DD, risks, contacts, documents,
-- investment scores, and decision-log entries.
--   1. 58 Queens Gate, London   (prime residential, value-add)
--   2. 16 Conduit Street, London (Mayfair office/retail, core+)
--   3. Magna Plaza, Amsterdam    (landmark mixed-use, value-add)
-- Figures are illustrative and internally plausible, not real transactions.
-- Run after schema.sql:  psql ... -f supabase/seed.sql
-- ============================================================================

-- Fixed UUIDs so child rows can reference their parent deterministically.
-- d1 = 58 Queens Gate, d2 = 16 Conduit Street, d3 = Magna Plaza

-- ----------------------------------------------------------------------------
-- 1. deals
-- ----------------------------------------------------------------------------
insert into deals (deal_id, asset_name, address, city, country, market, submarket,
  asset_type, strategy, deal_stage, source, broker_name, vendor_name, price_guidance,
  currency, size_sqft, size_sqm, passing_rent, erv, niy, reversionary_yield,
  capex_budget, target_irr, equity_multiple, status, probability) values
('a1111111-1111-1111-1111-111111111111', '58 Queens Gate',
  '58 Queens Gate, South Kensington', 'London', 'United Kingdom', 'London',
  'South Kensington (PCL)', 'residential', 'value_add', 'due_diligence',
  'Off-market introduction', 'Knight Frank', 'Private family office',
  42500000, 'GBP', 24500, 2276.10, 950000, 1450000, 2.1000, 3.2000,
  6500000, 14.5000, 1.8000, 'active', 60),

('a2222222-2222-2222-2222-222222222222', '16 Conduit Street',
  '16 Conduit Street, Mayfair', 'London', 'United Kingdom', 'London',
  'Mayfair / West End', 'mixed_use', 'core_plus', 'underwriting',
  'Marketed process', 'Savills', 'UK institutional fund',
  58000000, 'GBP', 32000, 2972.90, 2300000, 2900000, 3.7000, 4.5000,
  3000000, 12.0000, 1.6000, 'active', 45),

('a3333333-3333-3333-3333-333333333333', 'Magna Plaza',
  'Nieuwezijds Voorburgwal 182', 'Amsterdam', 'Netherlands', 'Amsterdam',
  'Centrum / Dam', 'mixed_use', 'value_add', 'screening',
  'Broker teaser', 'CBRE', 'European retail fund',
  85000000, 'EUR', 75347, 7000.00, 3800000, 5200000, 4.2000, 5.5000,
  12000000, 15.5000, 1.9000, 'active', 35);

-- ----------------------------------------------------------------------------
-- 2. deal_metrics
-- ----------------------------------------------------------------------------
insert into deal_metrics (deal_id, purchase_price, acquisition_costs,
  stamp_duty_or_transfer_tax, total_cost, debt_amount, ltv, interest_rate, rent,
  erv, noi, capex, exit_yield, exit_value, irr, equity_multiple, cash_on_cash,
  yield_on_cost) values
('a1111111-1111-1111-1111-111111111111', 42500000, 850000, 2125000, 51975000,
  28586250, 55.0000, 5.7500, 950000, 1450000, 1305000, 6500000, 2.8000,
  62000000, 14.5000, 1.8000, 6.5000, 2.5100),

('a2222222-2222-2222-2222-222222222222', 58000000, 1160000, 2900000, 65060000,
  32530000, 50.0000, 5.5000, 2300000, 2900000, 2610000, 3000000, 4.0000,
  72500000, 12.0000, 1.6000, 7.2000, 4.0100),

('a3333333-3333-3333-3333-333333333333', 85000000, 1700000, 5100000, 103800000,
  62280000, 60.0000, 4.9000, 3800000, 5200000, 4420000, 12000000, 5.0000,
  104000000, 15.5000, 1.9000, 6.8000, 4.2600);

-- ----------------------------------------------------------------------------
-- 3. due_diligence_items
-- ----------------------------------------------------------------------------
-- A handful of progressed workstreams per deal. In the app, the full London /
-- Amsterdam frameworks (21 sections) are instantiated via applyTemplate(); these
-- rows seed representative, in-flight items with realistic status and ownership.
insert into due_diligence_items (deal_id, section, item, question, jurisdiction,
  priority, status, owner, due_date, risk_level, notes, linked_documents) values
-- 58 Queens Gate (London framework)
('a1111111-1111-1111-1111-111111111111', 'Tenure and Ownership', 'Title & tenure',
  'Freehold/leasehold confirmed from Land Registry official copies; ground rent reviewed?',
  'UK', 'critical', 'in_progress', 'Forsters LLP', '2026-07-10', 'high',
  'Awaiting official copies; confirming freehold and covenants.', '{}'),
('a1111111-1111-1111-1111-111111111111', 'Planning and Heritage', 'Listed building / conservation',
  'Is the building listed or in a conservation area, and what consents constrain the business plan?',
  'UK', 'critical', 'issue_identified', 'Gerald Eve', '2026-07-20', 'high',
  'Grade II listing constrains internal reconfiguration; pre-app with RBKC required.',
  '{Heritage-Statement.pdf}'),
('a1111111-1111-1111-1111-111111111111', 'ESG and Compliance', 'EPC / MEES',
  'Current EPC rating and the pathway to MEES compliance (min. EPC B by 2030)?',
  'UK', 'high', 'issue_identified', 'Arup', '2026-08-05', 'high',
  'Currently EPC D; capex pathway to EPC B required.', '{}'),
('a1111111-1111-1111-1111-111111111111', 'Valuation Metrics', 'Red Book valuation',
  'Independent RICS Red Book valuation obtained and reconciled to the underwriting?',
  'UK', 'high', 'resolved', 'KF Valuation', '2026-06-28', 'low',
  'Supports purchase price.', '{Red-Book-Valuation.pdf}'),
('a1111111-1111-1111-1111-111111111111', 'Cross Border Tax and Holding Structure', 'Japan tax treatment',
  'Treatment of income and gains for Japanese LPs (TK-GK) confirmed by Japan tax advisers?',
  'Japan', 'high', 'requested', 'PwC Japan', '2026-07-25', 'high', NULL, '{}'),
('a1111111-1111-1111-1111-111111111111', 'Currency Risk and Hedging', 'FX exposure',
  'What is the GBP/JPY exposure on equity and distributions?',
  'Cross-border', 'high', 'requested', 'Reiwa Treasury', '2026-07-30', 'high', NULL, '{}'),
-- 16 Conduit Street (London framework)
('a2222222-2222-2222-2222-222222222222', 'Income Profile and Tenancy', 'Tenancy schedule',
  'Is the tenancy schedule verified against the leases (passing rent, term, expiries, breaks)?',
  'UK', 'critical', 'in_progress', 'CBRE', '2026-07-12', 'medium', NULL, '{}'),
('a2222222-2222-2222-2222-222222222222', 'Valuation Metrics', 'Red Book valuation',
  'Independent RICS Red Book valuation obtained and reconciled to the underwriting?',
  'UK', 'high', 'requested', 'Knight Frank Valuation', '2026-07-18', 'low', NULL, '{}'),
('a2222222-2222-2222-2222-222222222222', 'Cross Border Tax and Holding Structure', 'Holding structure',
  'Is the acquisition structure (Propco/Holdco, TK-GK) defined and tax-reviewed?',
  'Cross-border', 'critical', 'in_progress', 'Mourant', '2026-07-22', 'high', NULL, '{}'),
-- Magna Plaza (Amsterdam framework)
('a3333333-3333-3333-3333-333333333333', 'Tenure and Ownership', 'Title & erfpacht',
  'Kadaster title confirmed; is the land eigendom or erfpacht, and what are the canon and expiry terms?',
  'Netherlands', 'critical', 'requested', 'Loyens & Loeff', '2026-07-28', 'high',
  'Confirm erfpacht (ground lease) obligations with the City.', '{}'),
('a3333333-3333-3333-3333-333333333333', 'Planning and Heritage', 'Monument status',
  'Is the building a rijksmonument / gemeentelijk monument, and what consents constrain repositioning?',
  'Netherlands', 'critical', 'issue_identified', 'Local architect TBC', '2026-08-10', 'high',
  'Rijksmonument status materially constrains the repositioning plan.', '{Magna-Plaza-Monument-Report.pdf}'),
('a3333333-3333-3333-3333-333333333333', 'Cross Border Tax and Holding Structure', 'RETT & transfer tax',
  'Is Dutch transfer tax (overdrachtsbelasting, 10.4%) modelled, and asset-vs-share deal analysed?',
  'Cross-border', 'high', 'in_progress', 'Loyens & Loeff', '2026-08-05', 'medium', NULL, '{}'),
('a3333333-3333-3333-3333-333333333333', 'Currency Risk and Hedging', 'FX exposure',
  'What is the EUR/JPY exposure on equity and distributions?',
  'Cross-border', 'high', 'requested', 'Reiwa Treasury', '2026-08-12', 'high', NULL, '{}');

-- ----------------------------------------------------------------------------
-- 4. risks
-- ----------------------------------------------------------------------------
insert into risks (deal_id, risk_title, risk_category, probability, impact,
  risk_score, mitigation, owner, status) values
-- 58 Queens Gate
('a1111111-1111-1111-1111-111111111111', 'Listed building consent delay',
  'planning', 4, 4, 16, 'Pre-application engagement with RBKC conservation officer.',
  'Gerald Eve', 'open'),
('a1111111-1111-1111-1111-111111111111', 'PCL capital value softening',
  'market', 3, 4, 12, 'Conservative exit pricing; phased sales strategy.',
  'Reiwa Analyst', 'open'),
('a1111111-1111-1111-1111-111111111111', 'Refurbishment cost overrun',
  'execution', 3, 3, 9, 'Fixed-price contract with contingency; QS oversight.',
  'Malcolm Hollis', 'mitigated'),
-- 16 Conduit Street
('a2222222-2222-2222-2222-222222222222', 'Lease expiry / void risk',
  'tenant', 3, 4, 12, 'Early tenant engagement; rent-free reserve in model.',
  'CBRE', 'open'),
('a2222222-2222-2222-2222-222222222222', 'Interest rate / refinancing',
  'financial', 3, 3, 9, 'Cap purchased; 50% LTV provides headroom.',
  'Reiwa Treasury', 'mitigated'),
('a2222222-2222-2222-2222-222222222222', 'West End rental tone correction',
  'market', 2, 3, 6, 'Mayfair supply constrained; durable demand.',
  'Reiwa Analyst', 'accepted'),
-- Magna Plaza
('a3333333-3333-3333-3333-333333333333', 'Monument repositioning constraints',
  'planning', 4, 5, 20, 'Specialist heritage architect; staged consents.',
  'Loyens & Loeff', 'open'),
('a3333333-3333-3333-3333-333333333333', 'Retail occupancy / leasing risk',
  'tenant', 4, 4, 16, 'Pre-lets to anchor F&B; flexible unit sizes.',
  'CBRE', 'open'),
('a3333333-3333-3333-3333-333333333333', 'EUR/JPY FX volatility',
  'fx', 3, 3, 9, 'Layered equity hedge per treasury policy.',
  'Reiwa Treasury', 'open');

-- ----------------------------------------------------------------------------
-- 5. contacts
-- ----------------------------------------------------------------------------
insert into contacts (deal_id, name, company, role, email, phone, notes) values
('a1111111-1111-1111-1111-111111111111', 'Edward Hartley', 'Knight Frank',
  'Selling agent', 'e.hartley@knightfrank.com', '+44 20 7629 8171',
  'Introduced the off-market opportunity.'),
('a1111111-1111-1111-1111-111111111111', 'Sarah Lin', 'Forsters LLP',
  'Acquisition lawyer', 's.lin@forsters.co.uk', '+44 20 7863 8333', NULL),
('a2222222-2222-2222-2222-222222222222', 'James Whitmore', 'Savills',
  'Selling agent', 'jwhitmore@savills.com', '+44 20 7499 8644', NULL),
('a2222222-2222-2222-2222-222222222222', 'Aoi Tanaka', 'PwC Japan',
  'Tax adviser', 'aoi.tanaka@pwc.com', '+81 3 5251 2400',
  'Leads Japan tax structuring across the portfolio.'),
('a3333333-3333-3333-3333-333333333333', 'Pieter de Vries', 'CBRE',
  'Selling agent', 'pieter.devries@cbre.com', '+31 20 626 2691', NULL),
('a3333333-3333-3333-3333-333333333333', 'Marieke Jansen', 'Loyens & Loeff',
  'Dutch counsel', 'marieke.jansen@loyensloeff.com', '+31 20 578 5785', NULL);

-- ----------------------------------------------------------------------------
-- 6. documents
-- ----------------------------------------------------------------------------
insert into documents (document_id, deal_id, file_name, file_type, category,
  storage_url, uploaded_by, summary, ingest_status) values
('c0000001-0000-0000-0000-000000000001', 'a1111111-1111-1111-1111-111111111111',
  'Queens-Gate-IM.pdf', 'application/pdf', 'Broker Brochure',
  'deal-documents/a1111111/queens-gate-im.pdf', 'Reiwa Analyst',
  'Information memorandum from Knight Frank.', 'reviewed'),
('c0000001-0000-0000-0000-000000000002', 'a1111111-1111-1111-1111-111111111111',
  'Queens-Gate-Rent-Roll.xlsx', 'spreadsheet', 'Rent Roll',
  'deal-documents/a1111111/rent-roll.xlsx', 'Reiwa Analyst',
  'Vendor rent roll — multi-let apartments.', 'extracted'),
('c0000001-0000-0000-0000-000000000003', 'a1111111-1111-1111-1111-111111111111',
  'Red-Book-Valuation.pdf', 'application/pdf', 'Valuation',
  'deal-documents/a1111111/valuation.pdf', 'KF Valuation',
  'RICS Red Book valuation.', 'reviewed'),
('c0000001-0000-0000-0000-000000000004', 'a1111111-1111-1111-1111-111111111111',
  'Heritage-Statement.pdf', 'application/pdf', 'Planning',
  'deal-documents/a1111111/heritage.pdf', 'Gerald Eve',
  'Heritage statement for listed consent.', 'extracted'),
('c0000001-0000-0000-0000-000000000005', 'a1111111-1111-1111-1111-111111111111',
  'Title-Register-NGL123456.pdf', 'application/pdf', 'Title',
  'deal-documents/a1111111/title.pdf', 'Forsters LLP',
  'Land Registry official copy.', 'uploaded');

-- Conduit & Magna documents (no extraction yet)
insert into documents (deal_id, file_name, file_type, category, storage_url,
  uploaded_by, summary, ingest_status) values
('a2222222-2222-2222-2222-222222222222', 'Conduit-St-Tenancy-Schedule.pdf',
  'application/pdf', 'Rent Roll', 'deal-documents/a2222222/tenancy-schedule.pdf',
  'Reiwa Analyst', 'Current tenancy schedule and lease summaries.', 'uploaded'),
('a3333333-3333-3333-3333-333333333333', 'Magna-Plaza-Teaser.pdf',
  'application/pdf', 'Broker Brochure', 'deal-documents/a3333333/teaser.pdf',
  'Reiwa Analyst', 'CBRE marketing teaser.', 'uploaded'),
('a3333333-3333-3333-3333-333333333333', 'Magna-Plaza-Monument-Report.pdf',
  'application/pdf', 'Planning', 'deal-documents/a3333333/monument-report.pdf',
  'Reiwa Analyst', 'Heritage / Rijksmonument constraints overview.', 'extracted');

-- Structured extractions (AI deal memory) for ingested 58 Queens Gate documents
insert into document_extractions (document_id, deal_id, summary, key_facts,
  financial_figures, lease_terms, risks, missing_information, follow_up_questions) values
('c0000001-0000-0000-0000-000000000001', 'a1111111-1111-1111-1111-111111111111',
  'Knight Frank IM for 58 Queens Gate offered at GBP 42.5m. Headline figures are vendor-prepared and require verification.',
  ARRAY['58 Queens Gate, South Kensington (SW7)', 'Grade II listed, c. 24,500 sq ft'],
  ARRAY['Guide price: GBP 42,500,000', 'Passing rent: GBP 950,000 p.a.', 'ERV: GBP 1,450,000 p.a.', 'NIY: 2.1%'],
  ARRAY[]::text[],
  ARRAY['Vendor-prepared figures — verify independently.'],
  ARRAY['Verified tenancy schedule', 'Vendor income & expenditure history'],
  ARRAY['Please provide the underlying data behind the headline rent and ERV.']),
('c0000001-0000-0000-0000-000000000002', 'a1111111-1111-1111-1111-111111111111',
  'Rent roll confirms in-place income materially below ERV, supporting the reversionary thesis.',
  ARRAY['Multi-let residential — several apartments'],
  ARRAY['Total passing rent: GBP 950,000 p.a.', 'ERV: GBP 1,450,000 p.a.', 'Reversion: GBP 500,000 p.a.'],
  ARRAY['Mix of ASTs and longer leases — expiries to verify per unit.'],
  ARRAY['Income reversionary; several units let below market.'],
  ARRAY['Unit-by-unit lease expiry profile', 'Arrears schedule'],
  ARRAY['Which units can be obtained with vacant possession, and when?']),
('c0000001-0000-0000-0000-000000000003', 'a1111111-1111-1111-1111-111111111111',
  'Independent RICS Red Book valuation supporting the purchase price.',
  ARRAY['Independent RICS valuer', 'Basis: Market Value'],
  ARRAY['Market Value: GBP 43,000,000', 'NIY: 2.1%', 'Reversionary yield: 3.2%'],
  ARRAY[]::text[],
  ARRAY['Value sensitive to the assumed exit yield.'],
  ARRAY['Comparable evidence schedule'],
  ARRAY['Does the valuation reflect the proposed business plan and capex?']),
('c0000001-0000-0000-0000-000000000004', 'a1111111-1111-1111-1111-111111111111',
  'Heritage statement on the Grade II listing; internal reconfiguration is constrained and requires consent.',
  ARRAY['Grade II listed', 'Within an RBKC conservation area'],
  ARRAY[]::text[],
  ARRAY[]::text[],
  ARRAY['Listed building consent constrains the target reconfiguration.', 'Consent timeline could delay the programme.'],
  ARRAY['Pre-application advice from RBKC'],
  ARRAY['What unit mix is deliverable under listed consent, and on what timeline?']);

-- ----------------------------------------------------------------------------
-- 7. investment_scores  (header) + investment_score_categories (11 lines each)
-- Overall is weight x score / 10 summed across the 11 weighted criteria (=/100).
-- ----------------------------------------------------------------------------
insert into investment_scores (score_id, deal_id, overall_score, recommendation, summary, scored_by) values
('b1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 70.5, 'proceed',
  'Trophy PCL asset strong on location, liquidity and fit with material reversionary upside; held back by weak in-place income and flagged listed-building and EPC/MEES risks. A Proceed, conditional on planning visibility.', 'JD Mooney'),
('b2222222-2222-2222-2222-222222222222', 'a2222222-2222-2222-2222-222222222222', 75.5, 'proceed',
  'Core-plus Mayfair asset with strong location, liquidity and in-place income, modest capex and a clean risk profile. A confident Proceed.', 'JD Mooney'),
('b3333333-3333-3333-3333-333333333333', 'a3333333-3333-3333-3333-333333333333', 61.0, 'proceed_with_caution',
  'Landmark Amsterdam repositioning with strong reversionary upside, constrained by rijksmonument planning risk, large capex and retail leasing risk. Proceed with Caution.', 'JD Mooney');

insert into investment_score_categories (score_id, deal_id, category, score, commentary, risk_flag) values
-- 58 Queens Gate
('b1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'location_quality', 10, 'Prime South Kensington; supply-constrained.', false),
('b1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'liquidity_exit', 9, 'Deep domestic and international UHNW buyer pool.', false),
('b1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'income_security', 4, 'Low passing rent; income thesis is reversion-led.', false),
('b1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'reversionary_potential', 9, 'Strong reversion plus £/sq ft capital uplift.', false),
('b1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'asset_management_upside', 8, 'Comprehensive refurbishment to best-in-class.', false),
('b1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'capex_risk', 5, 'GBP 6.5m programme; overrun / listed-fabric risk.', true),
('b1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'planning_heritage_risk', 3, 'Grade II listing constrains reconfiguration.', true),
('b1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'tenant_covenant_risk', 6, 'Residential; limited covenant dependency.', false),
('b1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'japanese_depreciation', 7, 'Building-portion depreciation benefit.', false),
('b1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'fx_financing_resilience', 6, '55% LTV with rate cap; GBP/JPY hedge to size.', false),
('b1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'strategic_fit', 9, 'Squarely within the PCL value-add mandate.', false),
-- 16 Conduit Street
('b2222222-2222-2222-2222-222222222222', 'a2222222-2222-2222-2222-222222222222', 'location_quality', 9, 'Prime Mayfair / West End frontage.', false),
('b2222222-2222-2222-2222-222222222222', 'a2222222-2222-2222-2222-222222222222', 'liquidity_exit', 9, 'Highly liquid prime West End.', false),
('b2222222-2222-2222-2222-222222222222', 'a2222222-2222-2222-2222-222222222222', 'income_security', 8, 'Established office and retail income.', false),
('b2222222-2222-2222-2222-222222222222', 'a2222222-2222-2222-2222-222222222222', 'reversionary_potential', 6, 'Moderate reversion to ERV.', false),
('b2222222-2222-2222-2222-222222222222', 'a2222222-2222-2222-2222-222222222222', 'asset_management_upside', 6, 'Selective re-gear and light refurbishment.', false),
('b2222222-2222-2222-2222-222222222222', 'a2222222-2222-2222-2222-222222222222', 'capex_risk', 8, 'Modest GBP 3m programme; low risk.', false),
('b2222222-2222-2222-2222-222222222222', 'a2222222-2222-2222-2222-222222222222', 'planning_heritage_risk', 7, 'Limited constraints vs listed stock.', false),
('b2222222-2222-2222-2222-222222222222', 'a2222222-2222-2222-2222-222222222222', 'tenant_covenant_risk', 7, 'Solid covenants; some lease-event exposure.', true),
('b2222222-2222-2222-2222-222222222222', 'a2222222-2222-2222-2222-222222222222', 'japanese_depreciation', 7, 'Commercial depreciation benefit.', false),
('b2222222-2222-2222-2222-222222222222', 'a2222222-2222-2222-2222-222222222222', 'fx_financing_resilience', 7, '50% LTV with rate cap.', false),
('b2222222-2222-2222-2222-222222222222', 'a2222222-2222-2222-2222-222222222222', 'strategic_fit', 8, 'Trophy West End income.', false),
-- Magna Plaza
('b3333333-3333-3333-3333-333333333333', 'a3333333-3333-3333-3333-333333333333', 'location_quality', 8, 'Landmark adjacent to Dam Square.', false),
('b3333333-3333-3333-3333-333333333333', 'a3333333-3333-3333-3333-333333333333', 'liquidity_exit', 6, 'Narrower buyer pool for large repositioning.', false),
('b3333333-3333-3333-3333-333333333333', 'a3333333-3333-3333-3333-333333333333', 'income_security', 5, 'Elevated vacancy; income to be rebuilt.', false),
('b3333333-3333-3333-3333-333333333333', 'a3333333-3333-3333-3333-333333333333', 'reversionary_potential', 8, 'Strong reversion toward EUR 5.2m ERV.', false),
('b3333333-3333-3333-3333-333333333333', 'a3333333-3333-3333-3333-333333333333', 'asset_management_upside', 8, 'F&B / experiential retail repositioning.', false),
('b3333333-3333-3333-3333-333333333333', 'a3333333-3333-3333-3333-333333333333', 'capex_risk', 4, 'EUR 12m programme within a protected monument.', true),
('b3333333-3333-3333-3333-333333333333', 'a3333333-3333-3333-3333-333333333333', 'planning_heritage_risk', 3, 'Rijksmonument status constrains repositioning.', true),
('b3333333-3333-3333-3333-333333333333', 'a3333333-3333-3333-3333-333333333333', 'tenant_covenant_risk', 5, 'Retail occupancy / covenant risk in lease-up.', true),
('b3333333-3333-3333-3333-333333333333', 'a3333333-3333-3333-3333-333333333333', 'japanese_depreciation', 6, 'Depreciation benefit; longer stabilisation.', false),
('b3333333-3333-3333-3333-333333333333', 'a3333333-3333-3333-3333-333333333333', 'fx_financing_resilience', 6, '60% LTV; EUR/JPY hedge required.', false),
('b3333333-3333-3333-3333-333333333333', 'a3333333-3333-3333-3333-333333333333', 'strategic_fit', 7, 'Trophy repositioning fits the mandate.', false);

-- ----------------------------------------------------------------------------
-- 8. decision_log
-- ----------------------------------------------------------------------------
insert into decision_log (deal_id, decision_date, decision_type, decision,
  rationale, next_steps, author) values
('a1111111-1111-1111-1111-111111111111', '2026-06-02', 'screening',
  'Proceed to underwriting', 'Trophy PCL asset with reversion potential and limited supply.',
  'Build base-case model; commission building survey.', 'JD Mooney'),
('a1111111-1111-1111-1111-111111111111', '2026-06-12', 'bid',
  'Submit indicative offer at £42.5m', 'Reflects refurb capex and conservative exit pricing.',
  'Enter due diligence on exclusivity.', 'JD Mooney'),
('a2222222-2222-2222-2222-222222222222', '2026-06-08', 'screening',
  'Advance to underwriting', 'Core+ Mayfair income with rental reversion; strong liquidity.',
  'Confirm tenancy schedule and ERV tone.', 'JD Mooney'),
('a3333333-3333-3333-3333-333333333333', '2026-06-15', 'screening',
  'Continue, subject to planning review', 'Landmark repositioning upside offset by monument risk.',
  'Commission heritage report; refine repositioning plan.', 'JD Mooney');
