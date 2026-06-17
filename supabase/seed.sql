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
insert into due_diligence_items (deal_id, category, item, description, priority,
  status, owner, due_date, risk_level, notes) values
-- 58 Queens Gate
('a1111111-1111-1111-1111-111111111111', 'Legal', 'Title review',
  'Confirm freehold title, restrictive covenants and rights of way.', 'high',
  'in_progress', 'Forsters LLP', '2026-07-10', 'medium', 'Awaiting office copies.'),
('a1111111-1111-1111-1111-111111111111', 'Planning', 'Listed building consent',
  'Assess scope for internal reconfiguration under listed status (Grade II).',
  'critical', 'open', 'Gerald Eve', '2026-07-20', 'high',
  'Conservation area — heritage statement required.'),
('a1111111-1111-1111-1111-111111111111', 'Technical', 'Building survey',
  'Full structural and M&E condition survey ahead of refurbishment.', 'high',
  'in_progress', 'Malcolm Hollis', '2026-07-15', 'medium', NULL),
('a1111111-1111-1111-1111-111111111111', 'Japan Tax', 'TK/GK structuring review',
  'Confirm tax treatment of UK property income for Japanese LPs via TK-GK.',
  'high', 'open', 'PwC Japan', '2026-07-25', 'medium',
  'Coordinate with UK structure workstream.'),
('a1111111-1111-1111-1111-111111111111', 'FX', 'GBP/JPY hedging policy',
  'Define equity hedging approach for JPY-denominated investors.', 'medium',
  'open', 'Reiwa Treasury', '2026-07-30', 'medium', NULL),
('a1111111-1111-1111-1111-111111111111', 'ESG', 'EPC uplift pathway',
  'Plan route from EPC D to minimum EPC B post-refurbishment.', 'medium',
  'open', 'Arup', '2026-08-05', 'low', NULL),
-- 16 Conduit Street
('a2222222-2222-2222-2222-222222222222', 'Leasing', 'Tenancy schedule review',
  'Verify passing rents, break options and expiries across office and retail.',
  'high', 'in_progress', 'CBRE', '2026-07-12', 'medium', NULL),
('a2222222-2222-2222-2222-222222222222', 'Valuation', 'Red Book valuation',
  'Independent RICS valuation to support debt and IC.', 'high', 'open',
  'Knight Frank Valuation', '2026-07-18', 'low', NULL),
('a2222222-2222-2222-2222-222222222222', 'Commercial', 'Rental tone analysis',
  'Benchmark Mayfair office ERVs and rent-free incentives.', 'medium',
  'complete', 'Reiwa Analyst', '2026-06-30', 'low', 'Tone supports ERV.'),
('a2222222-2222-2222-2222-222222222222', 'Structure', 'Acquisition SPV setup',
  'Establish UK Propco / Jersey Holdco structure.', 'high', 'open',
  'Mourant', '2026-07-22', 'medium', NULL),
('a2222222-2222-2222-2222-222222222222', 'Insurance', 'Reinstatement assessment',
  'Confirm buildings reinstatement value and cover.', 'low', 'open',
  'Gallagher', '2026-08-01', 'low', NULL),
-- Magna Plaza
('a3333333-3333-3333-3333-333333333333', 'Legal', 'Dutch title & erfpacht',
  'Review ownership and any ground lease (erfpacht) terms with the City.',
  'critical', 'open', 'Loyens & Loeff', '2026-07-28', 'high',
  'Confirm canfeed/erfpacht obligations.'),
('a3333333-3333-3333-3333-333333333333', 'Planning', 'Monument status',
  'Rijksmonument constraints on repositioning the former post office.', 'critical',
  'open', 'Local architect TBC', '2026-08-10', 'high', NULL),
('a3333333-3333-3333-3333-333333333333', 'Commercial', 'Repositioning business plan',
  'Test F&B / experiential retail mix vs current vacancy.', 'high', 'in_progress',
  'Reiwa Analyst', '2026-08-15', 'medium', NULL),
('a3333333-3333-3333-3333-333333333333', 'Tax', 'Dutch RETT analysis',
  'Confirm 10.4% transfer tax treatment vs share deal.', 'high', 'open',
  'Loyens & Loeff', '2026-08-05', 'medium', NULL),
('a3333333-3333-3333-3333-333333333333', 'FX', 'EUR/JPY exposure',
  'Assess EUR/JPY hedging for the equity tranche.', 'medium', 'open',
  'Reiwa Treasury', '2026-08-12', 'medium', NULL);

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
insert into documents (deal_id, file_name, file_type, category, storage_url,
  uploaded_by, summary) values
('a1111111-1111-1111-1111-111111111111', 'Queens-Gate-IM.pdf', 'application/pdf',
  'Marketing', 'deal-documents/a1111111/queens-gate-im.pdf', 'Reiwa Analyst',
  'Information memorandum from Knight Frank.'),
('a1111111-1111-1111-1111-111111111111', 'Queens-Gate-Underwriting.xlsx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Financial',
  'deal-documents/a1111111/underwriting.xlsx', 'Reiwa Analyst',
  'Base-case underwriting model.'),
('a2222222-2222-2222-2222-222222222222', 'Conduit-St-Tenancy-Schedule.pdf',
  'application/pdf', 'Legal', 'deal-documents/a2222222/tenancy-schedule.pdf',
  'Reiwa Analyst', 'Current tenancy schedule and lease summaries.'),
('a3333333-3333-3333-3333-333333333333', 'Magna-Plaza-Teaser.pdf',
  'application/pdf', 'Marketing', 'deal-documents/a3333333/teaser.pdf',
  'Reiwa Analyst', 'CBRE marketing teaser.'),
('a3333333-3333-3333-3333-333333333333', 'Magna-Plaza-Monument-Report.pdf',
  'application/pdf', 'Planning', 'deal-documents/a3333333/monument-report.pdf',
  'Reiwa Analyst', 'Heritage / Rijksmonument constraints overview.');

-- ----------------------------------------------------------------------------
-- 7. investment_scores  (pillars 0–10)
-- ----------------------------------------------------------------------------
insert into investment_scores (deal_id, location_score, liquidity_score,
  income_score, reversion_score, capex_score, planning_score, tenant_score,
  depreciation_score, fx_score, exit_score, overall_score, recommendation) values
('a1111111-1111-1111-1111-111111111111', 9.5, 8.0, 4.5, 8.0, 5.0, 4.0, 6.0,
  7.0, 6.5, 7.5, 6.6, 'pursue'),
('a2222222-2222-2222-2222-222222222222', 9.0, 8.5, 7.0, 6.5, 8.0, 7.5, 6.5,
  7.5, 6.5, 7.0, 7.4, 'pursue'),
('a3333333-3333-3333-3333-333333333333', 8.5, 6.5, 5.0, 8.5, 4.0, 3.5, 5.0,
  6.0, 6.0, 6.5, 5.9, 'conditional');

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
