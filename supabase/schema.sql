-- CEED Mock Test — Supabase database (tables + secure functions).
-- Tables live in the private "app" schema (not exposed to the internet).
-- The website only calls the public.ceed_* functions below. Answer keys never leave the database
-- until a student has submitted (and only if "show answers" is on for that paper).

create schema if not exists app;
revoke all on schema app from public;

-- ---------------------------------------------------------------- tables
create table if not exists app.config (
  key text primary key,
  value text not null
);

create table if not exists app.papers (
  id uuid primary key default gen_random_uuid(),
  slug text unique,
  title text not null,
  exam text default 'CEED',
  year int,
  description text not null default '',
  instructions text not null default '',
  answer_key_note text not null default '',
  duration_min int not null default 60,
  published boolean not null default false,
  allow_reattempt boolean not null default true,
  show_answers boolean not null default true,
  timer_mode text not null default 'pause',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app.sections (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references app.papers(id) on delete cascade,
  name text not null,
  short_name text,
  qtype text not null,
  info text not null default '',
  position int not null
);
create index if not exists sections_paper_idx on app.sections (paper_id, position);

create table if not exists app.images (
  id uuid primary key default gen_random_uuid(),
  data text not null,
  bytes int,
  created_at timestamptz not null default now()
);

create table if not exists app.questions (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references app.papers(id) on delete cascade,
  section_id uuid not null references app.sections(id) on delete cascade,
  position int not null,
  qtype text not null,
  image_path text,
  image_id uuid references app.images(id) on delete set null,
  text text,
  options_count int not null default 4,
  answer jsonb,
  marks double precision not null default 1,
  neg_marks double precision not null default 0,
  partial boolean not null default false,
  bonus boolean not null default false,
  topic text,
  solution text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists questions_section_idx on app.questions (section_id, position);
create index if not exists questions_paper_idx on app.questions (paper_id);

create table if not exists app.students (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  phone text,
  city text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists app.attempts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references app.students(id) on delete cascade,
  paper_id uuid not null references app.papers(id) on delete cascade,
  attempt_no int not null,
  status text not null default 'in_progress',
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  time_used_ms bigint not null default 0,
  duration_ms bigint not null,
  submitted_at timestamptz,
  submit_reason text,
  current_qid uuid,
  events jsonb not null default '[]'::jsonb,
  tab_switches int not null default 0,
  score double precision,
  max_score double precision,
  summary jsonb
);
create index if not exists attempts_paper_idx on app.attempts (paper_id, status);
create index if not exists attempts_student_idx on app.attempts (student_id, paper_id);
create index if not exists attempts_started_idx on app.attempts (started_at);
create unique index if not exists attempts_no_uidx on app.attempts (student_id, paper_id, attempt_no);

-- Secret keys that open an attempt (one per device). Only the SHA-256 hash is stored.
create table if not exists app.attempt_tokens (
  token_hash text primary key,
  attempt_id uuid not null references app.attempts(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists attempt_tokens_attempt_idx on app.attempt_tokens (attempt_id);
create index if not exists attempt_tokens_created_idx on app.attempt_tokens (created_at);

create table if not exists app.responses (
  attempt_id uuid not null references app.attempts(id) on delete cascade,
  question_id uuid not null references app.questions(id) on delete cascade,
  answer jsonb,
  status text not null default 'not_visited',
  time_ms bigint not null default 0,
  visits int not null default 0,
  first_seen_ms bigint,
  answered_ms bigint,
  changes int not null default 0,
  outcome text,
  marks double precision,
  primary key (attempt_id, question_id)
);
create index if not exists responses_question_idx on app.responses (question_id);

alter table app.config enable row level security;
alter table app.papers enable row level security;
alter table app.sections enable row level security;
alter table app.images enable row level security;
alter table app.questions enable row level security;
alter table app.students enable row level security;
alter table app.attempts enable row level security;
alter table app.attempt_tokens enable row level security;
alter table app.responses enable row level security;

do $$ begin
  create type app.eval_result as (outcome text, marks double precision);
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- helpers (private)
create or replace function app.fail(p_msg text) returns void
language plpgsql set search_path = '' as $$
begin
  raise exception using message = p_msg, errcode = 'P0001';
end $$;

create or replace function app.ms(p_ts timestamptz) returns bigint
language sql immutable set search_path = '' as $$
  select case when p_ts is null then null else (extract(epoch from p_ts) * 1000)::bigint end
$$;

create or replace function app.r2(p_v double precision) returns double precision
language sql immutable set search_path = '' as $$
  select round(coalesce(p_v, 0)::numeric, 2)::double precision
$$;

create or replace function app.hash_token(p_token text) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
$$;

create or replace function app.clamp(p_v jsonb, p_lo bigint, p_hi bigint, p_default bigint) returns bigint
language plpgsql immutable set search_path = '' as $$
declare n numeric;
begin
  if p_v is null or jsonb_typeof(p_v) not in ('number', 'string') then return p_default; end if;
  begin
    n := (p_v #>> '{}')::numeric;
  exception when others then
    return p_default;
  end;
  if n is null or n = 'NaN'::numeric then return p_default; end if;
  return greatest(p_lo, least(p_hi, round(n)))::bigint;
end $$;

create or replace function app.clamp_null(p_v jsonb, p_lo bigint, p_hi bigint) returns bigint
language plpgsql immutable set search_path = '' as $$
begin
  if p_v is null or jsonb_typeof(p_v) = 'null' then return null; end if;
  return app.clamp(p_v, p_lo, p_hi, null);
end $$;

create or replace function app.check_admin(p_pass text) returns void
language plpgsql stable set search_path = '' as $$
declare salt text; h text;
begin
  select value into salt from app.config where key = 'admin_salt';
  select value into h from app.config where key = 'admin_hash';
  if salt is null or h is null or p_pass is null
     or encode(sha256(convert_to(salt || p_pass, 'UTF8')), 'hex') <> h then
    perform app.fail('Wrong admin passcode.');
  end if;
end $$;

create or replace function app.is_admin(p_pass text) returns boolean
language plpgsql stable set search_path = '' as $$
declare salt text; h text;
begin
  if p_pass is null or p_pass = '' then return false; end if;
  select value into salt from app.config where key = 'admin_salt';
  select value into h from app.config where key = 'admin_hash';
  return salt is not null and h is not null and encode(sha256(convert_to(salt || p_pass, 'UTF8')), 'hex') = h;
end $$;

create or replace function app.image_url(p_path text, p_image uuid) returns text
language sql immutable set search_path = '' as $$
  select coalesce(p_path, case when p_image is not null then 'db:' || p_image::text end)
$$;

create or replace function app.key_text(p_qtype text, p_answer jsonb) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_answer is null or jsonb_typeof(p_answer) <> 'object' then ''
    when p_qtype = 'NAT' then
      coalesce((select string_agg(case when (k->>'max') is null or (k->>'min')::numeric = (k->>'max')::numeric then k->>'min'
                                       else (k->>'min') || ' to ' || (k->>'max') end, ' or ' order by o)
                  from jsonb_array_elements(jsonb_build_array(p_answer) || coalesce(p_answer->'alts', '[]'::jsonb)) with ordinality as e(k, o)
                 where jsonb_typeof(k) = 'object' and k->>'min' is not null), '')
    else coalesce((select string_agg(t, ' or ' order by o)
                     from (select o, (select string_agg(x, case when p_qtype = 'MCQ' then ' or ' else ', ' end order by x)
                                        from jsonb_array_elements_text(k) x) as t
                             from jsonb_array_elements(jsonb_build_array(coalesce(p_answer->'options', '[]'::jsonb)) || coalesce(p_answer->'alts', '[]'::jsonb)) with ordinality as e(k, o)
                            where jsonb_typeof(k) = 'array' and jsonb_array_length(k) > 0) s), '')
  end
$$;

create or replace function app.answer_text(p_ans jsonb) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_ans is null or jsonb_typeof(p_ans) = 'null' then ''
    when jsonb_typeof(p_ans) = 'array' then coalesce((select string_agg(x, ', ') from jsonb_array_elements_text(p_ans) x), '')
    else p_ans #>> '{}'
  end
$$;

create or replace function app.sanitize_answer(p_qtype text, p_options int, p_raw jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  letters text := substr('ABCDEFGH', 1, greatest(2, least(8, coalesce(p_options, 4))));
  s text;
  arr text[];
begin
  if p_raw is null or jsonb_typeof(p_raw) = 'null' then return null; end if;
  if p_qtype = 'MCQ' then
    if jsonb_typeof(p_raw) <> 'string' then return null; end if;
    s := upper(p_raw #>> '{}');
    if length(s) = 1 and position(s in letters) > 0 then return to_jsonb(s); end if;
    return null;
  elsif p_qtype = 'MSQ' then
    arr := array(
      select distinct upper(x) from jsonb_array_elements_text(
        case when jsonb_typeof(p_raw) = 'array' then p_raw else jsonb_build_array(p_raw) end) x
      where length(x) = 1 and position(upper(x) in letters) > 0
      order by 1);
    if coalesce(array_length(arr, 1), 0) = 0 then return null; end if;
    return to_jsonb(arr);
  else
    if jsonb_typeof(p_raw) not in ('string', 'number') then return null; end if;
    s := left(btrim(p_raw #>> '{}'), 14);
    if s !~ '^-?[0-9]*\.?[0-9]*$' or s !~ '[0-9]' then return null; end if;
    return to_jsonb(s);
  end if;
end $$;

create or replace function app.evaluate(p_q app.questions, p_status text, p_answer jsonb) returns app.eval_result
language plpgsql immutable set search_path = '' as $$
-- Marks one answer. The key may list other accepted answers in "alts" (official keys like "7 OR 9" or "B or B, D").
-- MSQ partial marking (CEED 2024+): when no wrong option is chosen, each correct option chosen earns marks / options_count.
declare
  ans jsonb; k jsonb;
  v numeric; n int;
  keyset text[]; sel text[];
  neg double precision := case when coalesce(p_q.neg_marks, 0) = 0 then 0 else -p_q.neg_marks end;
  best app.eval_result;
begin
  if p_q.bonus then return row('bonus', p_q.marks)::app.eval_result; end if;
  ans := case when p_status in ('answered', 'answered_marked') then p_answer else null end;
  if ans is null or jsonb_typeof(ans) = 'null' or ans = '""'::jsonb or ans = '[]'::jsonb then
    return row('unattempted', 0)::app.eval_result;
  end if;
  if p_q.qtype = 'NAT' then
    begin
      v := (ans #>> '{}')::numeric;
    exception when others then
      return row('wrong', neg)::app.eval_result;
    end;
    for k in select value from jsonb_array_elements(jsonb_build_array(p_q.answer) || coalesce(p_q.answer->'alts', '[]'::jsonb)) loop
      if jsonb_typeof(k) = 'object' and (k->>'min') is not null
         and v >= (k->>'min')::numeric - 0.000000001
         and v <= coalesce((k->>'max')::numeric, (k->>'min')::numeric) + 0.000000001 then
        return row('correct', p_q.marks)::app.eval_result;
      end if;
    end loop;
    return row('wrong', neg)::app.eval_result;
  end if;
  if p_q.qtype = 'MCQ' then
    if exists (select 1 from jsonb_array_elements(jsonb_build_array(coalesce(p_q.answer->'options', '[]'::jsonb)) || coalesce(p_q.answer->'alts', '[]'::jsonb)) a
                where jsonb_typeof(a) = 'array' and a ? (ans #>> '{}')) then
      return row('correct', p_q.marks)::app.eval_result;
    end if;
    return row('wrong', neg)::app.eval_result;
  end if;
  sel := case when jsonb_typeof(ans) = 'array' then array(select jsonb_array_elements_text(ans)) else array[ans #>> '{}'] end;
  n := coalesce(array_length(sel, 1), 0);
  best := row('wrong', neg)::app.eval_result;
  for k in select value from jsonb_array_elements(jsonb_build_array(coalesce(p_q.answer->'options', '[]'::jsonb)) || coalesce(p_q.answer->'alts', '[]'::jsonb)) loop
    if jsonb_typeof(k) <> 'array' or jsonb_array_length(k) = 0 then continue; end if;
    keyset := array(select jsonb_array_elements_text(k));
    if sel <@ keyset and keyset <@ sel then return row('correct', p_q.marks)::app.eval_result; end if;
    if p_q.partial and n > 0 and sel <@ keyset then
      if best.outcome = 'wrong' or best.marks < p_q.marks * n / greatest(1, coalesce(nullif(p_q.options_count, 0), 4)) then
        best := row('partial', round((p_q.marks * n / greatest(1, coalesce(nullif(p_q.options_count, 0), 4)))::numeric, 2)::double precision)::app.eval_result;
      end if;
    end if;
  end loop;
  return best;
end $$;

create or replace function app.time_used(p_a app.attempts, p_mode text, p_resume boolean) returns bigint
language plpgsql stable set search_path = '' as $$
declare t bigint := app.ms(now()); last_seen bigint := app.ms(p_a.last_seen_at); started bigint := app.ms(p_a.started_at);
begin
  if p_mode = 'strict' then return least(p_a.duration_ms, greatest(0, t - started)); end if;
  if p_resume then return least(p_a.duration_ms, p_a.time_used_ms); end if;
  return least(p_a.duration_ms, p_a.time_used_ms + greatest(0, least(t - last_seen, 90000)));
end $$;

-- (Re)marks one attempt with the current answer key and stores the summary.
create or replace function app.evaluate_attempt(p_attempt uuid) returns jsonb
language plpgsql set search_path = '' as $$
declare a app.attempts; summ jsonb;
begin
  select * into a from app.attempts where id = p_attempt;
  update app.responses r set outcome = (x.ev).outcome, marks = (x.ev).marks
    from (
      select r2.question_id, app.evaluate(q, r2.status, r2.answer) as ev
        from app.responses r2 join app.questions q on q.id = r2.question_id
       where r2.attempt_id = p_attempt
    ) x
   where r.attempt_id = p_attempt and r.question_id = x.question_id;

  with qs as (
    select q.id, q.section_id, q.marks as maxm,
           coalesce(r.outcome, case when q.bonus then 'bonus' else 'unattempted' end) as outcome,
           coalesce(r.marks, case when q.bonus then q.marks else 0 end) as m,
           coalesce(r.time_ms, 0) as t,
           r.status
      from app.questions q
      left join app.responses r on r.question_id = q.id and r.attempt_id = p_attempt
     where q.paper_id = a.paper_id
  ), per as (
    select section_id,
           count(*) as total,
           count(*) filter (where outcome in ('correct', 'wrong', 'partial')) as attempted,
           count(*) filter (where outcome = 'correct') as correct,
           count(*) filter (where outcome = 'wrong') as wrong,
           count(*) filter (where outcome = 'partial') as partial,
           count(*) filter (where outcome = 'unattempted') as unattempted,
           count(*) filter (where outcome = 'bonus') as bonus,
           app.r2(sum(m)) as score, app.r2(sum(maxm)) as mx, sum(t) as time_ms,
           app.r2(coalesce(sum(-m) filter (where m < 0), 0)) as neg
      from qs group by section_id
  )
  select jsonb_build_object(
      'total', (select count(*) from qs),
      'attempted', (select count(*) from qs where outcome in ('correct', 'wrong', 'partial')),
      'correct', (select count(*) from qs where outcome = 'correct'),
      'wrong', (select count(*) from qs where outcome = 'wrong'),
      'partial', (select count(*) from qs where outcome = 'partial'),
      'unattempted', (select count(*) from qs where outcome = 'unattempted'),
      'bonus', (select count(*) from qs where outcome = 'bonus'),
      'score', (select app.r2(sum(m)) from qs),
      'max', (select app.r2(sum(maxm)) from qs),
      'time_ms', (select coalesce(sum(t), 0) from qs),
      'neg', (select app.r2(coalesce(sum(-m) filter (where m < 0), 0)) from qs),
      'marked', (select count(*) from qs where status in ('marked', 'answered_marked')),
      'sections', coalesce((select jsonb_object_agg(section_id::text, jsonb_build_object(
          'total', total, 'attempted', attempted, 'correct', correct, 'wrong', wrong, 'partial', partial,
          'unattempted', unattempted, 'bonus', bonus, 'score', score, 'max', mx, 'time_ms', time_ms, 'neg', neg)) from per), '{}'::jsonb))
    into summ;
  update app.attempts set score = (summ->>'score')::double precision, max_score = (summ->>'max')::double precision, summary = summ
   where id = p_attempt;
  return summ;
end $$;

create or replace function app.finalize(p_attempt uuid, p_reason text) returns void
language plpgsql set search_path = '' as $$
declare a app.attempts;
begin
  select * into a from app.attempts where id = p_attempt for update;
  if not found or a.status = 'submitted' then return; end if;
  perform app.evaluate_attempt(a.id);
  update app.attempts
     set status = 'submitted', submitted_at = now(), submit_reason = p_reason,
         events = events || jsonb_build_array(jsonb_build_object('t', least(a.duration_ms, a.time_used_ms), 'type', 'submit', 'reason', p_reason))
   where id = a.id;
end $$;

create or replace function app.attempt_for_token(p_token text) returns app.attempts
language plpgsql stable set search_path = '' as $$
declare a app.attempts;
begin
  if p_token is null or length(p_token) < 32 or length(p_token) > 128 then perform app.fail('Attempt not found.'); end if;
  select x.* into a
    from app.attempt_tokens t join app.attempts x on x.id = t.attempt_id
   where t.token_hash = app.hash_token(p_token);
  if not found then perform app.fail('Attempt not found. It may have been deleted by the admin.'); end if;
  return a;
end $$;

-- New random secret key for an attempt (returned once, only its hash is kept).
create or replace function app.new_token(p_attempt uuid) returns text
language plpgsql volatile set search_path = '' as $$
declare tok text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  insert into app.attempt_tokens (token_hash, attempt_id) values (app.hash_token(tok), p_attempt);
  return tok;
end $$;

create or replace function app.do_sync(p_attempt uuid, p_payload jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  a app.attempts; mode text; used bigint; dur bigint;
  item jsonb; e jsonb; ev jsonb; evs jsonb := '[]'::jsonb;
  q record; ans jsonb; st text; cur uuid; tabs bigint; qid_txt text;
begin
  select * into a from app.attempts where id = p_attempt for update;
  if a.status <> 'in_progress' then return jsonb_build_object('submitted', true); end if;
  select timer_mode into mode from app.papers where id = a.paper_id;
  used := app.time_used(a, mode, false);
  dur := a.duration_ms;

  for item in select value from jsonb_array_elements(case when jsonb_typeof(p_payload->'responses') = 'array' then p_payload->'responses' else '[]'::jsonb end) limit 500 loop
    qid_txt := item->>'qid';
    if qid_txt is null or qid_txt !~ '^[0-9a-fA-F-]{36}$' then continue; end if;
    select id, qtype, options_count into q from app.questions where id = qid_txt::uuid and paper_id = a.paper_id;
    if not found then continue; end if;
    ans := app.sanitize_answer(q.qtype, q.options_count, item->'answer');
    st := case when item->>'status' in ('not_visited', 'not_answered', 'answered', 'marked', 'answered_marked') then item->>'status' else 'not_answered' end;
    if st = 'answered' and ans is null then st := 'not_answered'; end if;
    if st = 'answered_marked' and ans is null then st := 'marked'; end if;
    insert into app.responses (attempt_id, question_id, answer, status, time_ms, visits, first_seen_ms, answered_ms, changes)
    values (a.id, q.id, ans, st,
            app.clamp(item->'time_ms', 0, used + 10000, 0), app.clamp(item->'visits', 0, 100000, 0),
            app.clamp_null(item->'first_seen_ms', 0, dur), app.clamp_null(item->'answered_ms', 0, dur),
            app.clamp(item->'changes', 0, 100000, 0))
    on conflict (attempt_id, question_id) do update
      set answer = excluded.answer, status = excluded.status, time_ms = excluded.time_ms, visits = excluded.visits,
          first_seen_ms = excluded.first_seen_ms, answered_ms = excluded.answered_ms, changes = excluded.changes;
  end loop;

  for e in select value from jsonb_array_elements(case when jsonb_typeof(p_payload->'events') = 'array' then p_payload->'events' else '[]'::jsonb end) limit 300 loop
    if jsonb_typeof(e) <> 'object' or coalesce(e->>'type', '') not in ('visit', 'save', 'clear', 'mark', 'blur', 'focus', 'fullscreen_exit') then continue; end if;
    ev := jsonb_build_object('t', app.clamp(e->'t', 0, dur, 0), 'type', e->>'type');
    qid_txt := e->>'q';
    if qid_txt is not null and qid_txt ~ '^[0-9a-fA-F-]{36}$' then
      select id, qtype, options_count into q from app.questions where id = qid_txt::uuid and paper_id = a.paper_id;
      if found then
        ev := ev || jsonb_build_object('q', q.id);
        if e->>'type' in ('save', 'mark') then ev := ev || jsonb_build_object('a', app.sanitize_answer(q.qtype, q.options_count, e->'a')); end if;
      end if;
    end if;
    evs := evs || jsonb_build_array(ev);
  end loop;

  qid_txt := p_payload->>'current_qid';
  cur := a.current_qid;
  if qid_txt is not null and qid_txt ~ '^[0-9a-fA-F-]{36}$' and exists (select 1 from app.questions where id = qid_txt::uuid and paper_id = a.paper_id) then
    cur := qid_txt::uuid;
  end if;
  tabs := app.clamp(p_payload->'tab_switches', 0, 100000, 0);
  update app.attempts
     set last_seen_at = now(), time_used_ms = used, current_qid = cur,
         tab_switches = greatest(tab_switches, tabs::int),
         events = case when jsonb_array_length(events) > 6000 then events else events || evs end
   where id = a.id;
  if used >= dur then
    perform app.finalize(a.id, 'timeout');
    return jsonb_build_object('submitted', true, 'remaining_ms', 0);
  end if;
  return jsonb_build_object('ok', true, 'remaining_ms', dur - used, 'time_used_ms', used);
end $$;

create or replace function app.sections_json(p_paper uuid) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'short_name', s.short_name, 'qtype', s.qtype,
                                               'info', s.info, 'position', s.position) order by s.position), '[]'::jsonb)
    from app.sections s
   where s.paper_id = p_paper and exists (select 1 from app.questions q where q.section_id = s.id)
$$;

create or replace function app.build_result(p_attempt uuid, p_admin boolean) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  a app.attempts; p app.papers; st app.students;
  show_keys boolean; my double precision; comp jsonb; qrows jsonb; hist jsonb;
begin
  select * into a from app.attempts where id = p_attempt;
  if not found then perform app.fail('Attempt not found.'); end if;
  if a.status <> 'submitted' then perform app.fail('This attempt is still in progress.'); end if;
  select * into p from app.papers where id = a.paper_id;
  select * into st from app.students where id = a.student_id;
  show_keys := p.show_answers or p_admin;
  my := coalesce(a.score, 0);

  with firsts as (
    select student_id, coalesce(score, 0) as sc from app.attempts
     where paper_id = a.paper_id and status = 'submitted' and attempt_no = 1
  ), others as (select sc from firsts where student_id <> a.student_id)
  select jsonb_build_object(
      'students', (select count(*) from others) + 1,
      'rank', 1 + (select count(*) from others where sc > my),
      'percentile', case when (select count(*) from others) > 0
                         then round(100.0 * (select count(*) from others where sc < my) / (select count(*) from others), 2) end,
      'topper', app.r2(greatest(my, coalesce((select max(sc) from others), my))),
      'average', app.r2(((select coalesce(sum(sc), 0) from others) + my) / ((select count(*) from others) + 1)))
    into comp;

  with qs as (
    select q.*, row_number() over (order by s.position, q.position) as num
      from app.questions q join app.sections s on s.id = q.section_id
     where q.paper_id = a.paper_id
  ), stats as (
    select r.question_id, count(*) as n,
           count(*) filter (where r.outcome = 'correct') as c,
           count(*) filter (where r.outcome in ('correct', 'wrong', 'partial')) as att,
           avg(r.time_ms) as avg_t
      from app.responses r join app.attempts a2 on a2.id = r.attempt_id
     where a2.paper_id = a.paper_id and a2.status = 'submitted' and a2.attempt_no = 1 and a2.student_id <> a.student_id
     group by r.question_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', qs.id, 'number', qs.num, 'section_id', qs.section_id, 'qtype', qs.qtype, 'topic', coalesce(qs.topic, ''),
      'image_url', app.image_url(qs.image_path, qs.image_id), 'text', coalesce(qs.text, ''), 'options_count', qs.options_count,
      'max_marks', qs.marks, 'neg_marks', qs.neg_marks,
      'your_answer', case when r.status in ('answered', 'answered_marked') then r.answer end,
      'your_answer_text', app.answer_text(case when r.status in ('answered', 'answered_marked') then r.answer end),
      'correct_answer', case when show_keys then qs.answer end,
      'correct_answer_text', case when show_keys then app.key_text(qs.qtype, qs.answer) end,
      'solution', case when show_keys then coalesce(qs.solution, '') else '' end,
      'status_at_submit', coalesce(r.status, 'not_visited'),
      'outcome', coalesce(r.outcome, case when qs.bonus then 'bonus' else 'unattempted' end),
      'marks', coalesce(r.marks, case when qs.bonus then qs.marks else 0 end),
      'time_ms', coalesce(r.time_ms, 0), 'visits', coalesce(r.visits, 0),
      'first_seen_ms', r.first_seen_ms, 'answered_ms', r.answered_ms, 'changes', coalesce(r.changes, 0),
      'others', case when stats.n > 0 then jsonb_build_object(
          'n', stats.n, 'correct_pct', round(100.0 * stats.c / stats.n, 2),
          'attempted_pct', round(100.0 * stats.att / stats.n, 2), 'avg_time_ms', round(stats.avg_t)) end
    ) order by qs.num), '[]'::jsonb)
    into qrows
    from qs
    left join app.responses r on r.question_id = qs.id and r.attempt_id = a.id
    left join stats on stats.question_id = qs.id;

  select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'attempt_no', h.attempt_no, 'score', app.r2(h.score), 'max_score', app.r2(h.max_score),
                                               'submitted_at', app.ms(h.submitted_at), 'time_used_ms', h.time_used_ms) order by h.attempt_no), '[]'::jsonb)
    into hist
    from app.attempts h
   where h.student_id = a.student_id and h.paper_id = a.paper_id and h.status = 'submitted';

  return jsonb_build_object(
    'attempt', jsonb_build_object('id', a.id, 'attempt_no', a.attempt_no, 'started_at', app.ms(a.started_at), 'submitted_at', app.ms(a.submitted_at),
                                  'submit_reason', a.submit_reason, 'duration_ms', a.duration_ms, 'time_used_ms', least(a.time_used_ms, a.duration_ms),
                                  'tab_switches', a.tab_switches, 'score', app.r2(a.score), 'max_score', app.r2(a.max_score)),
    'candidate', jsonb_build_object('name', st.name, 'id', st.id),
    'paper', jsonb_build_object('id', p.id, 'title', p.title, 'exam', p.exam, 'year', p.year, 'duration_min', p.duration_min,
                                'show_answers', show_keys, 'answer_key_note', p.answer_key_note, 'allow_reattempt', p.allow_reattempt,
                                'published', p.published),
    'viewer_is_owner', not p_admin,
    'sections', app.sections_json(a.paper_id),
    'summary', a.summary,
    'questions', qrows,
    'events', a.events,
    'comparison', comp,
    'history', hist);
end $$;

-- ---------------------------------------------------------------- public API: students
create or replace function public.ceed_papers() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x.j order by x.year desc nulls last, x.created_at desc), '[]'::jsonb)
    from (
      select p.year, p.created_at, jsonb_build_object(
          'id', p.id, 'title', p.title, 'exam', p.exam, 'year', p.year, 'description', p.description,
          'duration_min', p.duration_min, 'allow_reattempt', p.allow_reattempt,
          'questions', (select count(*) from app.questions q where q.paper_id = p.id),
          'max_marks', (select app.r2(coalesce(sum(q.marks), 0)) from app.questions q where q.paper_id = p.id),
          'sections', (select count(*) from app.sections s where s.paper_id = p.id and exists (select 1 from app.questions q where q.section_id = s.id))) as j
        from app.papers p
       where p.published
    ) x
$$;

create or replace function public.ceed_paper_info(p_paper uuid, p_pass text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p app.papers; secs jsonb; total int; maxm double precision;
begin
  select * into p from app.papers where id = p_paper;
  if not found or (not p.published and not app.is_admin(p_pass)) then perform app.fail('This paper is not available.'); end if;
  with qs as (
    select q.section_id, q.marks, row_number() over (order by s.position, q.position) as num
      from app.questions q join app.sections s on s.id = q.section_id where q.paper_id = p.id
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'short_name', s.short_name, 'qtype', s.qtype, 'info', s.info,
                                               'position', s.position, 'count', x.cnt, 'marks', x.marks, 'first', x.first, 'last', x.last)
                            order by s.position), '[]'::jsonb)
    into secs
    from app.sections s
    join (select section_id, count(*) as cnt, app.r2(sum(marks)) as marks, min(num) as first, max(num) as last from qs group by section_id) x
      on x.section_id = s.id;
  select count(*), app.r2(coalesce(sum(marks), 0)) into total, maxm from app.questions where paper_id = p.id;
  return jsonb_build_object(
    'paper', jsonb_build_object('id', p.id, 'title', p.title, 'exam', p.exam, 'year', p.year, 'description', p.description,
                                'instructions', p.instructions, 'duration_min', p.duration_min, 'allow_reattempt', p.allow_reattempt,
                                'timer_mode', p.timer_mode),
    'sections', secs, 'total_questions', total, 'max_marks', maxm);
end $$;

create or replace function public.ceed_start(p_paper uuid, p_name text, p_email text, p_phone text default null,
                                             p_city text default null, p_pass text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  p app.papers; sid uuid; prev int; tok text; aid uuid; open_a app.attempts;
  nm text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  em text := lower(btrim(coalesce(p_email, '')));
  ph text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_admin boolean := app.is_admin(p_pass);
begin
  select * into p from app.papers where id = p_paper;
  if not found or (not p.published and not v_admin) then perform app.fail('This paper is not available.'); end if;
  if length(nm) < 2 or length(nm) > 80 then perform app.fail('Please enter your full name.'); end if;
  if em !~ '^[^@\s<>()]+@[^@\s<>()]+\.[a-z]{2,}$' or length(em) > 200 then perform app.fail('Please enter a valid email address.'); end if;
  if length(ph) = 12 and left(ph, 2) = '91' then ph := right(ph, 10); end if;
  if ph <> '' and ph !~ '^[6-9][0-9]{9}$' then perform app.fail('Please enter a valid 10-digit mobile number (or leave it empty).'); end if;
  if not exists (select 1 from app.questions where paper_id = p.id) then perform app.fail('This paper has no questions yet.'); end if;
  if not v_admin and (select count(*) from app.attempt_tokens where created_at > now() - interval '1 minute') >= 150 then
    perform app.fail('Many students are starting right now. Please try again in a minute.');
  end if;

  insert into app.students (email, name, phone, city)
  values (em, nm, nullif(ph, ''), nullif(left(btrim(coalesce(p_city, '')), 80), ''))
  on conflict (email) do update
     set name = excluded.name,
         phone = coalesce(excluded.phone, app.students.phone),
         city = coalesce(excluded.city, app.students.city),
         last_seen_at = now()
  returning id into sid;

  if not v_admin and (select count(*) from app.attempt_tokens t join app.attempts x on x.id = t.attempt_id
                       where x.student_id = sid and t.created_at > now() - interval '10 minutes') >= 12 then
    perform app.fail('Too many tries in a short time. Please wait 10 minutes and try again.');
  end if;

  -- An unfinished attempt is resumed (also on a new device), like in the real exam.
  select * into open_a from app.attempts
   where student_id = sid and paper_id = p.id and status = 'in_progress'
   order by started_at desc limit 1 for update;
  if found then
    if app.time_used(open_a, p.timer_mode, true) >= open_a.duration_ms then
      perform app.finalize(open_a.id, 'timeout');
    else
      return jsonb_build_object('attempt_id', open_a.id, 'token', app.new_token(open_a.id),
                                'attempt_no', open_a.attempt_no, 'resumed', true);
    end if;
  end if;

  select count(*) into prev from app.attempts where student_id = sid and paper_id = p.id;
  if prev > 0 and not p.allow_reattempt and not v_admin then
    perform app.fail('You have already attempted this paper. Reattempts are not allowed for it.');
  end if;

  insert into app.attempts (student_id, paper_id, attempt_no, duration_ms, events)
  values (sid, p.id, prev + 1, p.duration_min::bigint * 60000, '[{"t":0,"type":"start"}]'::jsonb)
  returning id into aid;
  insert into app.responses (attempt_id, question_id, status)
  select aid, q.id, 'not_visited' from app.questions q where q.paper_id = p.id;
  tok := app.new_token(aid);
  return jsonb_build_object('attempt_id', aid, 'token', tok, 'attempt_no', prev + 1, 'resumed', false);
end $$;

create or replace function public.ceed_state(p_token text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare a app.attempts; p app.papers; used bigint; fresh boolean; st app.students;
begin
  a := app.attempt_for_token(p_token);
  if a.status <> 'in_progress' then return jsonb_build_object('submitted', true, 'attempt_id', a.id); end if;
  select * into p from app.papers where id = a.paper_id;
  used := app.time_used(a, p.timer_mode, true);
  if used >= a.duration_ms then
    perform app.finalize(a.id, 'timeout');
    return jsonb_build_object('submitted', true, 'attempt_id', a.id);
  end if;
  fresh := jsonb_array_length(a.events) <= 1 and a.time_used_ms = 0;
  update app.attempts
     set last_seen_at = now(), time_used_ms = used,
         events = case when fresh then events else events || jsonb_build_array(jsonb_build_object('t', used, 'type', 'resume')) end
   where id = a.id;
  select * into st from app.students where id = a.student_id;
  return jsonb_build_object(
    'attempt', jsonb_build_object('id', a.id, 'attempt_no', a.attempt_no, 'duration_ms', a.duration_ms, 'time_used_ms', used,
                                  'remaining_ms', a.duration_ms - used, 'current_qid', a.current_qid, 'tab_switches', a.tab_switches),
    'paper', jsonb_build_object('id', p.id, 'title', p.title, 'exam', p.exam, 'year', p.year, 'duration_min', p.duration_min,
                                'instructions', p.instructions, 'timer_mode', p.timer_mode),
    'sections', app.sections_json(p.id),
    'questions', (
      select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'number', q.num, 'section_id', q.section_id, 'qtype', q.qtype,
                                                   'options_count', q.options_count, 'marks', q.marks, 'neg_marks', q.neg_marks,
                                                   'partial', q.partial, 'image_url', app.image_url(q.image_path, q.image_id),
                                                   'text', coalesce(q.text, '')) order by q.num), '[]'::jsonb)
        from (select q2.*, row_number() over (order by s.position, q2.position) as num
                from app.questions q2 join app.sections s on s.id = q2.section_id where q2.paper_id = p.id) q),
    'responses', (
      select coalesce(jsonb_agg(jsonb_build_object('question_id', r.question_id, 'answer', r.answer, 'status', r.status, 'time_ms', r.time_ms,
                                                   'visits', r.visits, 'first_seen_ms', r.first_seen_ms, 'answered_ms', r.answered_ms,
                                                   'changes', r.changes)), '[]'::jsonb)
        from app.responses r where r.attempt_id = a.id),
    'candidate', jsonb_build_object('name', st.name));
end $$;

create or replace function public.ceed_sync(p_token text, p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare a app.attempts;
begin
  a := app.attempt_for_token(p_token);
  return app.do_sync(a.id, coalesce(p_payload, '{}'::jsonb));
end $$;

create or replace function public.ceed_submit(p_token text, p_payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare a app.attempts; r jsonb;
begin
  a := app.attempt_for_token(p_token);
  if a.status = 'submitted' then return jsonb_build_object('ok', true, 'attempt_id', a.id); end if;
  r := app.do_sync(a.id, coalesce(p_payload, '{}'::jsonb));
  if not coalesce((r->>'submitted')::boolean, false) then
    perform app.finalize(a.id, case when p_payload->>'reason' = 'timeout' then 'timeout' else 'manual' end);
  end if;
  return jsonb_build_object('ok', true, 'attempt_id', a.id);
end $$;

create or replace function public.ceed_result(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare a app.attempts;
begin
  a := app.attempt_for_token(p_token);
  return app.build_result(a.id, false);
end $$;

create or replace function public.ceed_my_attempts(p_tokens text[]) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'token', t.tok, 'paper_id', a.paper_id, 'title', p.title, 'attempt_no', a.attempt_no, 'status', a.status,
      'score', app.r2(a.score), 'max_score', app.r2(a.max_score), 'started_at', app.ms(a.started_at), 'submitted_at', app.ms(a.submitted_at),
      'time_used_ms', a.time_used_ms, 'duration_ms', a.duration_ms,
      'remaining_ms', greatest(0, a.duration_ms - a.time_used_ms),
      'correct', a.summary->'correct', 'wrong', a.summary->'wrong', 'unattempted', a.summary->'unattempted')
      order by a.started_at desc), '[]'::jsonb)
    from (select distinct x as tok from unnest(coalesce(p_tokens, array[]::text[])) x where length(x) between 32 and 128 limit 200) t
    join app.attempt_tokens k on k.token_hash = app.hash_token(t.tok)
    join app.attempts a on a.id = k.attempt_id
    join app.papers p on p.id = a.paper_id
$$;

create or replace function public.ceed_image(p_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select data from app.images where id = p_id
$$;

-- ---------------------------------------------------------------- public API: admin (passcode protected)
create or replace function public.ceed_admin_check(p_pass text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.check_admin(p_pass);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.ceed_admin_change_pass(p_pass text, p_new text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare salt text := replace(gen_random_uuid()::text, '-', '');
begin
  perform app.check_admin(p_pass);
  if p_new is null or length(p_new) < 8 then perform app.fail('The new passcode must have at least 8 characters.'); end if;
  insert into app.config (key, value) values ('admin_salt', salt)
    on conflict (key) do update set value = excluded.value;
  insert into app.config (key, value) values ('admin_hash', encode(sha256(convert_to(salt || p_new, 'UTF8')), 'hex'))
    on conflict (key) do update set value = excluded.value;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.ceed_admin_overview(p_pass text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  perform app.check_admin(p_pass);
  select jsonb_build_object(
    'counts', jsonb_build_object(
      'students', (select count(*) from app.students),
      'new_students_7d', (select count(*) from app.students where created_at > now() - interval '7 days'),
      'submitted', (select count(*) from app.attempts where status = 'submitted'),
      'in_progress', (select count(*) from app.attempts where status = 'in_progress'),
      'attempts_today', (select count(*) from app.attempts where started_at > date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'),
      'papers', (select count(*) from app.papers),
      'published', (select count(*) from app.papers where published)),
    'perPaper', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title,
        'attempts', (select count(*) from app.attempts a where a.paper_id = p.id and a.status = 'submitted'),
        'students', (select count(distinct a.student_id) from app.attempts a where a.paper_id = p.id and a.status = 'submitted'),
        'avg', (select app.r2(avg(a.score)) from app.attempts a where a.paper_id = p.id and a.status = 'submitted'),
        'top', (select app.r2(max(a.score)) from app.attempts a where a.paper_id = p.id and a.status = 'submitted')) order by p.title)
      from app.papers p), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(x.j order by x.started_at desc) from (
        select a.started_at, jsonb_build_object('id', a.id, 'status', a.status, 'score', app.r2(a.score), 'max_score', app.r2(a.max_score),
          'started_at', app.ms(a.started_at), 'submitted_at', app.ms(a.submitted_at), 'attempt_no', a.attempt_no, 'submit_reason', a.submit_reason,
          'name', s.name, 'email', s.email, 'phone', s.phone, 'title', p.title) as j
          from app.attempts a join app.students s on s.id = a.student_id join app.papers p on p.id = a.paper_id
         order by a.started_at desc limit 12) x), '[]'::jsonb))
    into r;
  return r;
end $$;

create or replace function public.ceed_admin_papers(p_pass text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.check_admin(p_pass);
  return coalesce((select jsonb_agg(to_jsonb(p) || jsonb_build_object(
      'question_count', (select count(*) from app.questions q where q.paper_id = p.id),
      'max_marks', (select app.r2(coalesce(sum(q.marks), 0)) from app.questions q where q.paper_id = p.id),
      'attempt_count', (select count(*) from app.attempts a where a.paper_id = p.id)) order by p.year desc nulls last, p.created_at desc)
    from app.papers p), '[]'::jsonb);
end $$;

create or replace function public.ceed_admin_paper(p_pass text, p_paper uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p app.papers;
begin
  perform app.check_admin(p_pass);
  select * into p from app.papers where id = p_paper;
  if not found then perform app.fail('Paper not found.'); end if;
  return jsonb_build_object(
    'paper', to_jsonb(p),
    'sections', coalesce((select jsonb_agg(to_jsonb(s) order by s.position) from app.sections s where s.paper_id = p.id), '[]'::jsonb),
    'questions', coalesce((
      select jsonb_agg(to_jsonb(q) - 'image_id' - 'image_path' || jsonb_build_object(
          'number', q.num, 'image_url', app.image_url(q.image_path, q.image_id), 'key_text', app.key_text(q.qtype, q.answer),
          'stats', (select jsonb_build_object('n', count(*), 'correct', count(*) filter (where r.outcome = 'correct'),
                                              'avg_time', coalesce(round(avg(r.time_ms)), 0))
                      from app.responses r join app.attempts a on a.id = r.attempt_id
                     where r.question_id = q.id and a.status = 'submitted')) order by q.num)
        from (select q2.*, row_number() over (order by s.position, q2.position) as num
                from app.questions q2 join app.sections s on s.id = q2.section_id where q2.paper_id = p.id) q), '[]'::jsonb),
    'attempt_count', (select count(*) from app.attempts a where a.paper_id = p.id));
end $$;

create or replace function public.ceed_admin_save_paper(p_pass text, p_data jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare pid uuid; t text; dur int; yr int; cur app.papers;
begin
  perform app.check_admin(p_pass);
  if p_data->>'id' is not null then
    select * into cur from app.papers where id = (p_data->>'id')::uuid;
    if not found then perform app.fail('Paper not found.'); end if;
  end if;
  t := left(btrim(coalesce(p_data->>'title', cur.title, '')), 140);
  if t = '' then perform app.fail('Paper title is required.'); end if;
  dur := coalesce(app.clamp(p_data->'duration_min', 1, 600, null), cur.duration_min, 60)::int;
  yr := case when p_data ? 'year' then app.clamp(p_data->'year', 1900, 2200, null)::int else cur.year end;
  if cur.id is null then
    insert into app.papers (title, exam, year, description, instructions, answer_key_note, duration_min, published, allow_reattempt, show_answers, timer_mode)
    values (t, left(coalesce(p_data->>'exam', 'CEED'), 40), yr, left(coalesce(p_data->>'description', ''), 2000), left(coalesce(p_data->>'instructions', ''), 10000),
            left(coalesce(p_data->>'answer_key_note', ''), 2000), dur, coalesce((p_data->>'published')::boolean, false),
            coalesce((p_data->>'allow_reattempt')::boolean, true), coalesce((p_data->>'show_answers')::boolean, true),
            case when p_data->>'timer_mode' = 'strict' then 'strict' else 'pause' end)
    returning id into pid;
    if p_data->>'template' = 'ceed' then
      insert into app.sections (paper_id, name, short_name, qtype, info, position) values
        (pid, 'Section I: NAT', 'NAT', 'NAT', 'Numerical answer type · enter the answer with the on-screen keypad', 0),
        (pid, 'Section II: MSQ', 'MSQ', 'MSQ', 'Multiple select · one or more options are correct', 1),
        (pid, 'Section III: MCQ', 'MCQ', 'MCQ', 'Multiple choice · only one option is correct', 2);
    end if;
  else
    pid := cur.id;
    update app.papers set
      title = t,
      exam = left(coalesce(p_data->>'exam', cur.exam), 40),
      year = yr,
      description = left(coalesce(p_data->>'description', cur.description), 2000),
      instructions = left(coalesce(p_data->>'instructions', cur.instructions), 10000),
      answer_key_note = left(coalesce(p_data->>'answer_key_note', cur.answer_key_note), 2000),
      duration_min = dur,
      published = coalesce((p_data->>'published')::boolean, cur.published),
      allow_reattempt = coalesce((p_data->>'allow_reattempt')::boolean, cur.allow_reattempt),
      show_answers = coalesce((p_data->>'show_answers')::boolean, cur.show_answers),
      timer_mode = case when p_data ? 'timer_mode' then case when p_data->>'timer_mode' = 'strict' then 'strict' else 'pause' end else cur.timer_mode end,
      updated_at = now()
    where id = pid;
  end if;
  return jsonb_build_object('ok', true, 'id', pid);
end $$;

create or replace function public.ceed_admin_delete_paper(p_pass text, p_paper uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare imgs uuid[];
begin
  perform app.check_admin(p_pass);
  if exists (select 1 from app.attempts where paper_id = p_paper) then
    perform app.fail('Students have already attempted this paper, so it cannot be deleted. Unpublish it instead.');
  end if;
  imgs := array(select image_id from app.questions where paper_id = p_paper and image_id is not null);
  delete from app.papers where id = p_paper;
  delete from app.images i where i.id = any(imgs) and not exists (select 1 from app.questions q where q.image_id = i.id);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.ceed_admin_save_section(p_pass text, p_data jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare sid uuid; qt text := upper(coalesce(p_data->>'qtype', 'MCQ')); nm text := left(btrim(coalesce(p_data->>'name', '')), 80);
begin
  perform app.check_admin(p_pass);
  if qt not in ('NAT', 'MSQ', 'MCQ') then perform app.fail('Section type must be NAT, MSQ or MCQ.'); end if;
  if nm = '' then perform app.fail('Section name is required.'); end if;
  if p_data->>'id' is not null then
    update app.sections set name = nm, short_name = left(coalesce(nullif(p_data->>'short_name', ''), qt), 20), qtype = qt,
                            info = left(coalesce(p_data->>'info', ''), 300)
     where id = (p_data->>'id')::uuid returning id into sid;
    if sid is null then perform app.fail('Section not found.'); end if;
  else
    if not exists (select 1 from app.papers where id = (p_data->>'paper_id')::uuid) then perform app.fail('Paper not found.'); end if;
    insert into app.sections (paper_id, name, short_name, qtype, info, position)
    values ((p_data->>'paper_id')::uuid, nm, left(coalesce(nullif(p_data->>'short_name', ''), qt), 20), qt, left(coalesce(p_data->>'info', ''), 300),
            (select coalesce(max(position), -1) + 1 from app.sections where paper_id = (p_data->>'paper_id')::uuid))
    returning id into sid;
  end if;
  return jsonb_build_object('ok', true, 'id', sid);
end $$;

create or replace function public.ceed_admin_delete_section(p_pass text, p_section uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform app.check_admin(p_pass);
  if exists (select 1 from app.questions where section_id = p_section) then perform app.fail('Delete or move the questions in this section first.'); end if;
  delete from app.sections where id = p_section;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.ceed_admin_move(p_pass text, p_kind text, p_id uuid, p_dir text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare me record; other record;
begin
  perform app.check_admin(p_pass);
  if p_kind = 'section' then
    select id, paper_id as grp, position into me from app.sections where id = p_id;
    if not found then perform app.fail('Not found.'); end if;
    if p_dir = 'up' then
      select id, position into other from app.sections where paper_id = me.grp and position < me.position order by position desc limit 1;
    else
      select id, position into other from app.sections where paper_id = me.grp and position > me.position order by position asc limit 1;
    end if;
    if found then
      update app.sections set position = other.position where id = me.id;
      update app.sections set position = me.position where id = other.id;
    end if;
  else
    select id, section_id as grp, position into me from app.questions where id = p_id;
    if not found then perform app.fail('Not found.'); end if;
    if p_dir = 'up' then
      select id, position into other from app.questions where section_id = me.grp and position < me.position order by position desc limit 1;
    else
      select id, position into other from app.questions where section_id = me.grp and position > me.position order by position asc limit 1;
    end if;
    if found then
      update app.questions set position = other.position where id = me.id;
      update app.questions set position = me.position where id = other.id;
    end if;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.ceed_admin_save_question(p_pass text, p_data jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  cur app.questions; sec app.sections; qid uuid; qt text; opts int; v_bonus boolean; ans jsonb; letters text;
  mn numeric; mx numeric; keys text[]; mk double precision; ng double precision; img uuid; pos int; img_data text;
  has_attempts boolean; k jsonb; alts jsonb; amn numeric; amx numeric; akeys text[];
begin
  perform app.check_admin(p_pass);
  if p_data->>'id' is not null then
    select * into cur from app.questions where id = (p_data->>'id')::uuid;
    if not found then perform app.fail('Question not found.'); end if;
  end if;
  select * into sec from app.sections where id = coalesce((p_data->>'section_id')::uuid, cur.section_id);
  if not found then perform app.fail('Section not found.'); end if;
  if cur.id is not null and sec.paper_id <> cur.paper_id then perform app.fail('Section belongs to another paper.'); end if;
  qt := upper(coalesce(p_data->>'qtype', cur.qtype, sec.qtype));
  if qt not in ('NAT', 'MSQ', 'MCQ') then perform app.fail('Question type must be NAT, MSQ or MCQ.'); end if;
  has_attempts := exists (select 1 from app.attempts where paper_id = sec.paper_id);
  if cur.id is not null and qt <> cur.qtype and has_attempts then
    perform app.fail('Students have attempted this paper, so the question type cannot be changed.');
  end if;
  opts := case when qt = 'NAT' then 0 else greatest(2, least(8, coalesce(app.clamp(p_data->'options_count', 2, 8, null)::int, nullif(cur.options_count, 0), 4))) end;
  v_bonus := coalesce((p_data->>'bonus')::boolean, cur.bonus, false);
  letters := substr('ABCDEFGH', 1, opts);
  ans := case when p_data ? 'answer' then p_data->'answer' else cur.answer end;
  if qt = 'NAT' then
    begin
      mn := nullif(btrim(coalesce(ans->>'min', '')), '')::numeric;
      mx := coalesce(nullif(btrim(coalesce(ans->>'max', '')), '')::numeric, mn);
    exception when others then
      perform app.fail('The correct answer must be a number.');
    end;
    if mn is null and not v_bonus then perform app.fail('Enter the correct numerical answer (or a range).'); end if;
    if mn is not null and mx < mn then perform app.fail('The "to" value of the range must be greater than or equal to the "from" value.'); end if;
    -- other accepted answers, e.g. an official key "7 OR 9"
    alts := '[]'::jsonb;
    for k in select value from jsonb_array_elements(case when jsonb_typeof(ans->'alts') = 'array' then ans->'alts' else '[]'::jsonb end) limit 10 loop
      begin
        amn := nullif(btrim(coalesce(k->>'min', '')), '')::numeric;
        amx := coalesce(nullif(btrim(coalesce(k->>'max', '')), '')::numeric, amn);
      exception when others then
        perform app.fail('Each "also accept" answer must be a number or a range like 24 to 25.5.');
      end;
      if amn is not null then
        if amx < amn then perform app.fail('In "also accept", write a range from the smaller number to the bigger one.'); end if;
        alts := alts || jsonb_build_array(jsonb_build_object('min', amn, 'max', amx));
      end if;
    end loop;
    ans := case when mn is null then null else jsonb_build_object('min', mn, 'max', mx)
             || case when jsonb_array_length(alts) > 0 then jsonb_build_object('alts', alts) else '{}'::jsonb end end;
  else
    keys := array(select distinct upper(x) from jsonb_array_elements_text(coalesce(ans->'options', '[]'::jsonb)) x
                   where length(x) = 1 and position(upper(x) in letters) > 0 order by 1);
    if coalesce(array_length(keys, 1), 0) = 0 and not v_bonus then perform app.fail('Select the correct option(s).'); end if;
    -- other accepted option sets, e.g. an official key "B or B, D"
    alts := '[]'::jsonb;
    for k in select value from jsonb_array_elements(case when jsonb_typeof(ans->'alts') = 'array' then ans->'alts' else '[]'::jsonb end) limit 10 loop
      if jsonb_typeof(k) <> 'array' then continue; end if;
      akeys := array(select distinct upper(x) from jsonb_array_elements_text(k) x where length(x) = 1 and position(upper(x) in letters) > 0 order by 1);
      if coalesce(array_length(akeys, 1), 0) > 0 and akeys is distinct from keys then alts := alts || jsonb_build_array(to_jsonb(akeys)); end if;
    end loop;
    ans := case when coalesce(array_length(keys, 1), 0) = 0 then null else jsonb_build_object('options', to_jsonb(keys))
             || case when jsonb_array_length(alts) > 0 then jsonb_build_object('alts', alts) else '{}'::jsonb end end;
  end if;
  mk := coalesce((p_data->>'marks')::double precision, cur.marks, 1);
  ng := coalesce((p_data->>'neg_marks')::double precision, cur.neg_marks, 0);
  if mk < 0 or mk > 100 then perform app.fail('Marks must be between 0 and 100.'); end if;
  if ng < 0 or ng > 100 then perform app.fail('Negative marks must be 0 or a positive number (e.g. 0.6).'); end if;

  img := cur.image_id;
  img_data := p_data->>'image_data';
  if img_data is not null and img_data <> '' then
    if img_data !~ '^data:image/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$' then perform app.fail('Please upload a PNG, JPG, WEBP or GIF screenshot.'); end if;
    if length(img_data) > 8000000 then perform app.fail('The screenshot is too large (max about 6 MB).'); end if;
    insert into app.images (data, bytes) values (img_data, length(img_data)) returning id into img;
  end if;
  if img is null and coalesce(cur.image_path, '') = '' and btrim(coalesce(p_data->>'text', cur.text, '')) = '' then
    perform app.fail('Add a screenshot of the question.');
  end if;

  if cur.id is null then
    select coalesce(max(position), -1) + 1 into pos from app.questions where section_id = sec.id;
    insert into app.questions (paper_id, section_id, position, qtype, image_id, text, options_count, answer, marks, neg_marks, partial, bonus, topic, solution)
    values (sec.paper_id, sec.id, pos, qt, img, nullif(left(coalesce(p_data->>'text', ''), 4000), ''), opts, ans, mk, ng,
            qt = 'MSQ' and coalesce((p_data->>'partial')::boolean, false), v_bonus,
            nullif(left(coalesce(p_data->>'topic', ''), 120), ''), nullif(left(coalesce(p_data->>'solution', ''), 4000), ''))
    returning id into qid;
  else
    pos := case when sec.id <> cur.section_id then (select coalesce(max(position), -1) + 1 from app.questions where section_id = sec.id) else cur.position end;
    update app.questions set
      section_id = sec.id, position = pos, qtype = qt,
      image_id = img, image_path = case when img_data is not null and img_data <> '' then null else cur.image_path end,
      text = case when p_data ? 'text' then nullif(left(coalesce(p_data->>'text', ''), 4000), '') else cur.text end,
      options_count = opts, answer = ans, marks = mk, neg_marks = ng,
      partial = qt = 'MSQ' and coalesce((p_data->>'partial')::boolean, cur.partial),
      bonus = v_bonus,
      topic = case when p_data ? 'topic' then nullif(left(coalesce(p_data->>'topic', ''), 120), '') else cur.topic end,
      solution = case when p_data ? 'solution' then nullif(left(coalesce(p_data->>'solution', ''), 4000), '') else cur.solution end,
      updated_at = now()
    where id = cur.id;
    qid := cur.id;
    if img is distinct from cur.image_id and cur.image_id is not null
       and not exists (select 1 from app.questions where image_id = cur.image_id) then
      delete from app.images where id = cur.image_id;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'id', qid);
end $$;

create or replace function public.ceed_admin_delete_question(p_pass text, p_question uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare q app.questions;
begin
  perform app.check_admin(p_pass);
  select * into q from app.questions where id = p_question;
  if not found then perform app.fail('Question not found.'); end if;
  if exists (select 1 from app.attempts where paper_id = q.paper_id) then
    perform app.fail('Students have attempted this paper, so questions cannot be deleted. You can edit it or mark it as "marks to all".');
  end if;
  delete from app.questions where id = q.id;
  if q.image_id is not null and not exists (select 1 from app.questions where image_id = q.image_id) then
    delete from app.images where id = q.image_id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.ceed_admin_reevaluate(p_pass text, p_paper uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare a record; n int := 0;
begin
  perform app.check_admin(p_pass);
  for a in select id from app.attempts where paper_id = p_paper and status = 'submitted' loop
    perform app.evaluate_attempt(a.id);
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'attempts', n);
end $$;

create or replace function public.ceed_admin_attempts(p_pass text, p_paper uuid default null, p_status text default null, p_student uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.check_admin(p_pass);
  return coalesce((
    select jsonb_agg(x.j order by x.started_at desc) from (
      select a.started_at, jsonb_build_object(
          'id', a.id, 'paper_id', a.paper_id, 'student_id', a.student_id, 'attempt_no', a.attempt_no, 'status', a.status,
          'score', app.r2(a.score), 'max_score', app.r2(a.max_score), 'started_at', app.ms(a.started_at), 'submitted_at', app.ms(a.submitted_at),
          'time_used_ms', a.time_used_ms, 'duration_ms', a.duration_ms, 'submit_reason', a.submit_reason, 'tab_switches', a.tab_switches,
          'correct', a.summary->'correct', 'wrong', a.summary->'wrong', 'partial', a.summary->'partial', 'unattempted', a.summary->'unattempted',
          'neg', a.summary->'neg', 'section_scores', (
            select coalesce(jsonb_object_agg(coalesce(nullif(s.short_name, ''), s.name), a.summary->'sections'->(s.id::text)->'score'), '{}'::jsonb)
              from app.sections s where s.paper_id = a.paper_id),
          'name', st.name, 'email', st.email, 'phone', st.phone, 'city', st.city, 'title', p.title) as j
        from app.attempts a join app.students st on st.id = a.student_id join app.papers p on p.id = a.paper_id
       where (p_paper is null or a.paper_id = p_paper)
         and (p_status is null or p_status = '' or a.status = p_status)
         and (p_student is null or a.student_id = p_student)
       order by a.started_at desc limit 5000) x), '[]'::jsonb);
end $$;

create or replace function public.ceed_admin_students(p_pass text, p_search text default '') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare q text := lower(btrim(coalesce(p_search, '')));
begin
  perform app.check_admin(p_pass);
  return coalesce((
    select jsonb_agg(x.j order by x.created_at desc) from (
      select s.created_at, jsonb_build_object('id', s.id, 'name', s.name, 'email', s.email, 'phone', s.phone, 'city', s.city,
          'created_at', app.ms(s.created_at), 'last_seen_at', app.ms(s.last_seen_at),
          'attempts', (select count(*) from app.attempts a where a.student_id = s.id),
          'submitted', (select count(*) from app.attempts a where a.student_id = s.id and a.status = 'submitted'),
          'best', (select app.r2(max(a.score)) from app.attempts a where a.student_id = s.id and a.status = 'submitted')) as j
        from app.students s
       where q = '' or lower(s.name) like '%' || q || '%' or lower(s.email) like '%' || q || '%' or coalesce(s.phone, '') like '%' || q || '%'
       order by s.created_at desc limit 2000) x), '[]'::jsonb);
end $$;

create or replace function public.ceed_admin_result(p_pass text, p_attempt uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.check_admin(p_pass);
  return app.build_result(p_attempt, true);
end $$;

create or replace function public.ceed_admin_force_submit(p_pass text, p_attempt uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform app.check_admin(p_pass);
  perform app.finalize(p_attempt, 'admin');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.ceed_admin_delete_attempt(p_pass text, p_attempt uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform app.check_admin(p_pass);
  delete from app.attempts where id = p_attempt;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- permissions
revoke all on all tables in schema app from public, anon, authenticated;
revoke all on all functions in schema app from public, anon, authenticated;
revoke all on schema app from anon, authenticated;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'ceed\_%' loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('grant execute on function %s to anon, authenticated, service_role', f.sig);
  end loop;
end $$;
