-- Owner: R3 (roles.md). Minimal version by R1; extend, don't duplicate.
-- Local/demo seed (runs on `supabase db reset`). Demo persona Lin (Shenzhen, CNY, PRD §9.3).
-- All dates are relative to the reset date so the demo is always "current".
-- No real personal data: names, accounts and addresses below are fictional.
-- Stable ids: Lin = 11111111-1111-4111-8111-111111111111; bills and transactions use
-- md5-derived uuids (pg_temp.sid) so public.* and mockbank.* rows share ids.

-- Deterministic, RFC 4122-shaped (version 4, variant 8) uuid from a label.
create function pg_temp.sid(label text) returns uuid language sql immutable as $$
  select (substr(h, 1, 12) || '4' || substr(h, 14, 3) || '8' || substr(h, 18, 15))::uuid
  from (select md5(label) as h) x
$$;

-- ---------------------------------------------------------------------------------------
-- Local login for the server roles (LOCAL ONLY; production passwords are set out of band).
alter role reins_server with login password 'reins-server-local';
alter role reins_mockbank with login password 'reins-mockbank-local';

-- ---------------------------------------------------------------------------------------
-- Demo user Lin (email lin@demo.reins.local, password "reins-demo" for local login)
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change)
values ('00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111111', 'authenticated',
  'authenticated', 'lin@demo.reins.local', extensions.crypt('reins-demo', extensions.gen_salt('bf')), now(),
  now(), now(), '{"provider":"email","providers":["email"]}', '{"name":"Lin"}', '', '', '', '');

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111',
  '{"sub":"11111111-1111-4111-8111-111111111111","email":"lin@demo.reins.local","email_verified":true}',
  'email', now(), now(), now());

insert into public.users (id, email, display_name, locale, timezone, base_currency)
values ('11111111-1111-4111-8111-111111111111', 'lin@demo.reins.local', 'Lin', 'zh-CN', 'Asia/Shanghai', 'CNY');

insert into public.kill_switch (user_id, enabled) values ('11111111-1111-4111-8111-111111111111', false);

-- ---------------------------------------------------------------------------------------
-- Reference: merchants
insert into public.merchants (id, canonical_name, category, aliases, cancel_method, manage_url) values
  ('c0000000-0000-4000-8000-000000000001', 'State Grid Shenzhen', 'utilities', '{"SZ POWER","深圳供电局"}', null, null),
  ('c0000000-0000-4000-8000-000000000002', 'China Mobile', 'telecom', '{"CMCC","中国移动"}', null, null),
  ('c0000000-0000-4000-8000-000000000003', 'Landlord Wang', 'housing', '{"WANG RENT"}', null, null),
  ('c0000000-0000-4000-8000-000000000004', 'ChatGPT Plus', 'software', '{"OPENAI *CHATGPT SUBSCR"}', 'web', 'https://chatgpt.com/#settings'),
  ('c0000000-0000-4000-8000-000000000005', 'iQIYI', 'entertainment', '{"爱奇艺","IQIYI VIP"}', 'app', null),
  ('c0000000-0000-4000-8000-000000000006', 'NetEase Cloud Music', 'entertainment', '{"网易云音乐","NETEASE MUSIC"}', 'app', null),
  ('c0000000-0000-4000-8000-000000000007', 'Keep Premium', 'fitness', '{"KEEP 会员"}', 'app', null),
  ('c0000000-0000-4000-8000-000000000008', 'FitBox Futian', 'fitness', '{"FITBOX"}', null, null),
  ('c0000000-0000-4000-8000-000000000009', 'IronPulse Nanshan', 'fitness', '{"IRONPULSE"}', null, null),
  ('c0000000-0000-4000-8000-00000000000a', 'Hema Fresh', 'groceries', '{"盒马"}', null, null),
  ('c0000000-0000-4000-8000-00000000000b', 'Meituan', 'food_delivery', '{"美团"}', null, null),
  ('c0000000-0000-4000-8000-00000000000c', 'Shenzhen Metro', 'transport', '{"深圳通"}', null, null);

-- Reference: FX (fx_provider). Recent USD->CNY plus CNY/IDR both ways.
insert into public.fx_rates (date, base, quote, rate, source, provider, fetched_at)
select current_date - d, 'USD', 'CNY', 7.1200 + (d % 3) * 0.0050, 'fx_provider', 'frankfurter', now() - make_interval(days => d)
from generate_series(0, 6) d;
insert into public.fx_rates (date, base, quote, rate, source, provider, fetched_at)
select current_date - d, 'CNY', 'USD', round(1 / (7.1200 + (d % 3) * 0.0050), 10), 'fx_provider', 'frankfurter', now() - make_interval(days => d)
from generate_series(0, 6) d;
insert into public.fx_rates (date, base, quote, rate, source, provider, fetched_at)
select current_date - d, 'CNY', 'IDR', 2245.50 + d, 'fx_provider', 'frankfurter', now() - make_interval(days => d)
from generate_series(0, 6) d;
insert into public.fx_rates (date, base, quote, rate, source, provider, fetched_at)
select current_date - d, 'IDR', 'CNY', round(1 / (2245.50 + d), 10), 'fx_provider', 'frankfurter', now() - make_interval(days => d)
from generate_series(0, 6) d;

-- ---------------------------------------------------------------------------------------
-- Accounts (app view of the mock bank)
insert into public.data_sources (id, user_id, type, status, last_synced_at)
values ('d0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'mock_bank', 'active', now());

insert into public.accounts (id, user_id, data_source_id, provider, type, name, currency, balance, origin, source_id) values
  ('a0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-000000000001',
   'mockbank', 'checking', 'Everyday account', 'CNY', 12850.40, 'mock_bank', 'a0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-000000000001',
   'mockbank', 'savings', 'Savings', 'CNY', 30000.00, 'mock_bank', 'a0000000-0000-4000-8000-000000000002');

-- Payee registry (verified via the mock bank). payee_account_ref is a registry value.
insert into public.billers (id, user_id, name, merchant_id, payee_account_ref, verified_at, verified_via) values
  ('SZ_POWER', '11111111-1111-4111-8111-111111111111', 'State Grid Shenzhen', 'c0000000-0000-4000-8000-000000000001', 'registry:SZ_POWER', now() - interval '200 days', 'mock_bank'),
  ('CHINA_MOBILE', '11111111-1111-4111-8111-111111111111', 'China Mobile', 'c0000000-0000-4000-8000-000000000002', 'registry:CHINA_MOBILE', now() - interval '200 days', 'mock_bank'),
  ('LANDLORD_WANG', '11111111-1111-4111-8111-111111111111', 'Landlord Wang', 'c0000000-0000-4000-8000-000000000003', 'registry:LANDLORD_WANG', now() - interval '200 days', 'user_ui');

-- ---------------------------------------------------------------------------------------
-- Bills: 6 paid months of history + the current unpaid month.
-- Electricity history 196..251, current bill is the anomalous ¥612.
with hist(biller_id, m, amount) as (
  values
    ('LANDLORD_WANG', 6, 4500), ('LANDLORD_WANG', 5, 4500), ('LANDLORD_WANG', 4, 4500),
    ('LANDLORD_WANG', 3, 4500), ('LANDLORD_WANG', 2, 4500), ('LANDLORD_WANG', 1, 4500),
    ('LANDLORD_WANG', 0, 4500),
    ('SZ_POWER', 6, 196), ('SZ_POWER', 5, 214), ('SZ_POWER', 4, 238), ('SZ_POWER', 3, 251),
    ('SZ_POWER', 2, 205), ('SZ_POWER', 1, 222), ('SZ_POWER', 0, 612),
    ('CHINA_MOBILE', 6, 98), ('CHINA_MOBILE', 5, 98), ('CHINA_MOBILE', 4, 98), ('CHINA_MOBILE', 3, 98),
    ('CHINA_MOBILE', 2, 98), ('CHINA_MOBILE', 1, 98), ('CHINA_MOBILE', 0, 98)
)
insert into public.bills (id, user_id, biller_id, amount, currency, amount_origin, due_date, period, status, source_id, created_at)
select pg_temp.sid('bill:' || biller_id || ':' || m), '11111111-1111-4111-8111-111111111111', biller_id, amount, 'CNY', 'mock_bank',
  case when m = 0 then current_date + case biller_id when 'SZ_POWER' then 3 when 'CHINA_MOBILE' then 4 else 6 end
       else (current_date - make_interval(months => m))::date end,
  to_char(current_date - make_interval(months => m + 1), 'YYYY-MM'),
  case when m = 0 then 'unpaid' else 'paid' end,
  'mb:' || pg_temp.sid('bill:' || biller_id || ':' || m),
  now() - make_interval(months => m, days => 10)
from hist;

-- ---------------------------------------------------------------------------------------
-- Subscriptions
insert into public.subscriptions (id, user_id, merchant_id, cycle_days, amount, currency, billing_currency, original_amount,
  next_renewal, status, first_seen, last_charged, confidence, detection_source, trial_end, trial_status_origin, keep_flag, notice_sent, source_id)
values
  ('5b000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000004',
   30, 142.40, 'CNY', 'USD', 20.00, current_date + 9, 'active', current_date - 200, current_date - 21, 0.97, 'mock_bank', null, null, false, false, 'mb:sub:chatgpt'),
  ('5b000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000005',
   30, 25.00, 'CNY', 'CNY', 25.00, current_date + 12, 'active', current_date - 200, current_date - 18, 0.95, 'mock_bank', null, null, false, false, 'mb:sub:iqiyi'),
  ('5b000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000006',
   30, 15.00, 'CNY', 'CNY', 15.00, current_date + 20, 'active', current_date - 200, current_date - 10, 0.95, 'mock_bank', null, null, false, false, 'mb:sub:netease'),
  ('5b000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000007',
   30, 28.00, 'CNY', 'CNY', 28.00, current_date + 2, 'trial', current_date - 5, null, 0.90, 'mock_bank',
   now() + interval '2 days', 'mock_bank', false, false, 'mb:sub:keep');

-- Simulated usage (labeled simulated; recommendations only, never authorization)
insert into public.usage_signals (user_id, merchant_id, subscription_id, source, metric, value, period_start, period_end, origin, simulated) values
  ('11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000005', '5b000000-0000-4000-8000-000000000002',
   'mock_bank', 'sessions_per_month', 1, current_date - 30, current_date, 'simulated', true),
  ('11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000006', '5b000000-0000-4000-8000-000000000003',
   'mock_bank', 'sessions_per_month', 22, current_date - 30, current_date, 'simulated', true),
  ('11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000004', '5b000000-0000-4000-8000-000000000001',
   'mock_bank', 'sessions_per_month', 35, current_date - 30, current_date, 'simulated', true);

-- ---------------------------------------------------------------------------------------
-- Transactions (6 months): salary, paid bills, subscription charges, everyday spending.
insert into public.transactions (id, user_id, account_id, posted_at, amount, currency, raw_descriptor, merchant_id, category, source_id, origin)
select pg_temp.sid('tx:salary:' || m), '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001',
  date_trunc('month', now() - make_interval(months => m)) + interval '9 days 10 hours', 18000.00, 'CNY',
  'SALARY SHENZHEN TECH CO', null, 'income', 'tx:salary:' || m, 'mock_bank'
from generate_series(0, 5) m;

insert into public.transactions (id, user_id, account_id, posted_at, amount, currency, raw_descriptor, merchant_id, category, source_id, origin)
select pg_temp.sid('tx:' || b.id), b.user_id, 'a0000000-0000-4000-8000-000000000001', b.due_date::timestamptz + interval '9 hours',
  -b.amount, 'CNY', 'BILLPAY ' || bl.name, bl.merchant_id,
  case b.biller_id when 'LANDLORD_WANG' then 'housing' when 'SZ_POWER' then 'utilities' else 'telecom' end,
  'tx:' || b.id, 'mock_bank'
from public.bills b join public.billers bl on bl.id = b.biller_id and bl.user_id = b.user_id
where b.status = 'paid';

insert into public.transactions (id, user_id, account_id, posted_at, amount, currency, raw_descriptor, original_amount, original_currency,
  fx_rate, fx_rate_date, merchant_id, category, source_id, origin)
select pg_temp.sid('tx:sub:' || s.id || ':' || m), s.user_id, 'a0000000-0000-4000-8000-000000000001',
  (s.last_charged - (m * 30))::timestamptz + interval '3 hours',
  case when s.billing_currency = 'USD' then -round(s.original_amount * (7.10 + (m % 4) * 0.01), 2) else -s.amount end,
  'CNY', upper(mc.aliases[1]),
  case when s.billing_currency = 'USD' then s.original_amount end,
  case when s.billing_currency = 'USD' then 'USD' end,
  case when s.billing_currency = 'USD' then 7.10 + (m % 4) * 0.01 end,
  case when s.billing_currency = 'USD' then s.last_charged - (m * 30) end,
  s.merchant_id, 'subscriptions', 'tx:sub:' || s.id || ':' || m, 'mock_bank'
from public.subscriptions s join public.merchants mc on mc.id = s.merchant_id
cross join generate_series(0, 5) m
where s.status = 'active';

insert into public.transactions (id, user_id, account_id, posted_at, amount, currency, raw_descriptor, merchant_id, category, source_id, origin)
select pg_temp.sid('tx:spend:' || i), '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001',
  now() - make_interval(days => i * 4 + 1, hours => (i * 7) % 12),
  -(round((35 + (i * 37) % 160)::numeric, 2) + ((i * 13) % 100) / 100.0),
  'CNY',
  case i % 3 when 0 then '盒马 HEMA FRESH' when 1 then '美团 MEITUAN' else '深圳通 METRO' end,
  case i % 3 when 0 then 'c0000000-0000-4000-8000-00000000000a'::uuid when 1 then 'c0000000-0000-4000-8000-00000000000b'::uuid
       else 'c0000000-0000-4000-8000-00000000000c'::uuid end,
  case i % 3 when 0 then 'groceries' when 1 then 'food_delivery' else 'transport' end,
  'tx:spend:' || i, 'mock_bank'
from generate_series(0, 44) i;

-- ---------------------------------------------------------------------------------------
-- Mandate v3 (PRD §9.3). policy_json is the canonical JSON of LIN_MANDATE_V3
-- (src/core/mandate/examples.ts); the hash is computed from that exact text.
with p(canon) as (values (
  '{"base_currency":"CNY","bills":{"anomaly":{"k":3,"method":"median_mad","min_history":3},"auto_pay_max":300,"pay_days_before_due":2},"fx":{"margin_pct":3,"rate_source":"ecb_reference"},"global":{"daily_outflow_cap":1000},"payees":{"allow":["SZ_POWER","CHINA_MOBILE","LANDLORD_WANG"],"new_payee":"deny"},"prepaid":{"attestation_max_age_days":2,"auto_exit_on":["court_enforcement","closure_notice"],"escrow_only":true,"max_prepay":8000,"purchase":"confirm","warn_on_soft_signals":true},"subscriptions":{"auto_cancel_trials":{"days_before_charge":1,"enabled":true,"notify_days_before":3},"cancel":"confirm","renew_unseen_price_increase":"confirm","renewal_notice_days":5,"subscribe":"deny"},"version":3}'
))
insert into public.mandates (user_id, version, policy_json, policy_hash, prev_version, signed_at, status, created_via)
select '11111111-1111-4111-8111-111111111111', 3, canon::jsonb, encode(sha256(convert_to(canon, 'UTF8')), 'hex'), 2,
  now() - interval '3 days', 'active', 'template'
from p;

-- ---------------------------------------------------------------------------------------
-- Prepaid (architecture §24.8). Fictional addresses; no keys are seeded anywhere.
--   Lin's browser wallet 0x5a1e000000000000000000000000000000001a11
--   Agent address        0xa9e7000000000000000000000000000000000a9e  (AGENT_ADDRESS)
--   Oracle address       0x0dac1e0000000000000000000000000000000001  (ORACLE_ADDRESS)
insert into public.wallets (user_id, address, kind)
values ('11111111-1111-4111-8111-111111111111', '0x5a1e000000000000000000000000000000001a11', 'consumer_browser');

insert into public.prepaid_merchants (id, merchant_id, name, chain_address, escrow_supported, risk_level) values
  ('FITBOX_FUTIAN', 'c0000000-0000-4000-8000-000000000008', 'FitBox Futian', '0xf17b000000000000000000000000000000000f17', true, 'none'),
  ('IRONPULSE_NANSHAN', 'c0000000-0000-4000-8000-000000000009', 'IronPulse Nanshan', '0x1e0b000000000000000000000000000000001e0b', false, 'watch');

insert into public.prepaid_offers (id, merchant_id, unit_price, units, cancel_fee_bps, pay_per_visit_price, expires_at, offer_json, merchant_sig) values
  ('0f000000-0000-4000-8000-000000000001', 'FITBOX_FUTIAN', 10000, 60, 1000, 12500, now() + interval '30 days',
   '{"merchant":"0xf17b000000000000000000000000000000000f17","unitPrice":10000,"units":60,"cancelFeeBps":1000,"nonce":1}', 'mock:unsigned'),
  ('0f000000-0000-4000-8000-000000000002', 'IRONPULSE_NANSHAN', 8000, 50, 1500, 10000, now() + interval '30 days',
   '{"merchant":"0x1e0b000000000000000000000000000000001e0b","unitPrice":8000,"units":50,"cancelFeeBps":1500,"nonce":1}', 'mock:unsigned');

insert into public.prepaid_plans (id, user_id, chain_plan_id, merchant_id, unit_price, units_total, units_redeemed, cancel_fee_bps,
  agent_address, status, purchase_tx, origin, last_synced_block)
values ('9a000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 1, 'FITBOX_FUTIAN', 10000, 60, 12, 1000,
  '0xa9e7000000000000000000000000000000000a9e', 'active', 'mock:' || pg_temp.sid('purchase:1'), 'chain', 0);

insert into public.prepaid_sessions (plan_id, user_id, session_no, tx_hash, redeemed_at)
select '9a000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', n,
  'mock:' || pg_temp.sid('redeem:1:' || n), now() - make_interval(days => (13 - n) * 7)
from generate_series(1, 12) n;

insert into public.risk_signals (merchant_id, kind, level, summary, source_ids, origin, simulated, observed_at) values
  ('IRONPULSE_NANSHAN', 'complaints', 'watch', 'Several members report the Nanshan branch closing early.', '{"sim:complaint:1"}', 'simulated', true, now() - interval '2 days');

-- ---------------------------------------------------------------------------------------
-- Mock bank mirror (the "external" bank's own state)
insert into mockbank.billers (id, name, category, account_ref) values
  ('SZ_POWER', 'State Grid Shenzhen', 'utilities', '6222-0000-0000-1001'),
  ('CHINA_MOBILE', 'China Mobile', 'telecom', '6222-0000-0000-1002'),
  ('LANDLORD_WANG', 'Landlord Wang', 'housing', '6222-0000-0000-1003');

insert into mockbank.accounts (id, customer_id, name, type, currency, balance, is_default)
select id, user_id, name, type, currency, balance, type = 'checking' from public.accounts;

insert into mockbank.transactions (id, account_id, posted_at, amount, currency, descriptor, original_amount, original_currency)
select id, account_id, posted_at, amount, currency, raw_descriptor, original_amount, original_currency from public.transactions;

insert into mockbank.bills (id, customer_id, biller_id, amount, currency, due_date, period, status, created_at)
select id, user_id, biller_id, amount, currency, due_date, period, case status when 'paid' then 'paid' else 'unpaid' end, created_at
from public.bills;

insert into mockbank.subscriptions (id, customer_id, merchant_name, amount, currency, cycle_days, next_renewal, status, trial_end)
select s.id, s.user_id, m.canonical_name, s.original_amount, s.billing_currency, s.cycle_days, s.next_renewal,
  case s.status when 'trial' then 'trial' when 'cancelled' then 'cancelled' else 'active' end, s.trial_end
from public.subscriptions s join public.merchants m on m.id = s.merchant_id;

insert into mockbank.escrow_plans (chain_plan_id, owner, merchant, agent, unit_price, units_total, units_redeemed, cancel_fee_bps, status, balance)
values (1, '0x5a1e000000000000000000000000000000001a11', '0xf17b000000000000000000000000000000000f17',
  '0xa9e7000000000000000000000000000000000a9e', 10000, 60, 12, 1000, 'active', 48 * 10000);

insert into mockbank.escrow_sessions (chain_plan_id, session_no, tx_id, redeemed_at)
select 1, session_no, tx_hash, redeemed_at from public.prepaid_sessions;

insert into mockbank.events (customer_id, type, payload)
select user_id, 'bill.created', jsonb_build_object('bill_id', id, 'biller_id', biller_id, 'amount', amount, 'due_date', due_date)
from public.bills where status = 'unpaid';
