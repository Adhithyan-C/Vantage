# Vantage: ARCHITECTURE.md

This file is the single source of truth for building Vantage. Read it completely before writing any code. If something you need is not in this file, do not invent it: add it to "Open decisions" in section 16 and ask the human.

---

## 1. What Vantage is

Vantage is a go-to-market intelligence dashboard for B2B SaaS sellers. A seller describes their product and ideal customer. Vantage searches free public sources (Reddit, Hacker News, developer forums) for people publicly describing the problem the product solves, ranks them, and shows exactly why each one was surfaced.

Core idea: a transparent, evidence-backed list of buying signals, not a black-box lead score.

### 1.1 What Vantage produces

Signals, not contacts. A signal is a public post or comment containing: a handle, a community, the text, a timestamp, engagement numbers, and a permalink. Vantage does not produce names, emails, phone numbers, or companies unless a person voluntarily published them in a public profile field.

Never use the word "lead" for something with no contact info in marketing copy or UI headings. Use "signal" in the UI; "lead" is acceptable internally in code and table names.

### 1.2 Primary deliverable

A report: ranked signals, each with evidence quotes, a score breakdown, a clickable link to the original post, and competitor complaint themes. Exportable as CSV and as a printable report page. Humans contact people themselves.

### 1.3 Secondary feature (optional, behind a button)

An "Approach suggester" that shows a suggested way to respond and a draft with a "why this angle" note. It NEVER sends anything, never automates messaging, and the draft is always editable and copy-only.

### 1.4 Demo scenario

The seller in the demo is a fictional helpdesk / customer-support tool competing with Zendesk and Intercom. This is the default seed profile in `fixtures/seller-helpdesk.json` (see open decision D1).

---

## 2. Non-negotiable rules for the coding agent (anti-hallucination)

1. Do not invent APIs, endpoints, package names, versions, or config keys. Before using any external API or library, check its official documentation or the installed package's types. If you cannot verify, write `// TODO(verify): <what>` and list it in section 16.
2. Do not add features, screens, tables, or dependencies not described here. If you think one is needed, propose it in section 16 and stop.
3. Prefer boring, well-known libraries. Pin exact versions in package.json once chosen and do not change them without asking.
4. Never hard-code secrets. Only reference env var names from section 14.
5. No live network calls in tests. Use recorded fixtures in `fixtures/`.
6. Every LLM output must be validated against a Zod schema before use. Invalid output is retried at most 2 times, then recorded as a failed decision. It is never silently patched or guessed.
7. Every quote shown as evidence must be verified as a literal substring of the stored post text (section 8.3). Unverifiable quotes are dropped, never displayed.
8. The score is computed by deterministic code (section 9). The LLM never outputs the final score or a self-reported confidence number.
9. Agents are stateless between runs. All memory lives in Postgres (section 6). No hidden in-process state, no module-level caches that affect results.
10. Do not scrape pages protected by login or bot walls. Use only the public endpoints listed in section 7. Do not store full user profiles. Store the minimum fields in section 6.
11. When a requirement is ambiguous, ask. When a task is large, write a short plan first, then implement in the build order in section 15.
12. Keep functions small and typed. No `any`. No unexplained magic numbers; put tunables in `apps/api/src/config/`.
13. Never claim something works unless you ran it. After each change, state what you ran and the result.

---

## 3. System architecture

```
 Sources (free, public)                      Dashboard (React + TS)
 Reddit JSON, HN Algolia,  ----+                    ^
 dev forums, saved snapshot    |                    | reads + realtime
                               v                    |
                          [ Scout ] -----> Supabase (Postgres + Realtime)
                          [ Displacement ]   signals, decisions,
                               |             leads, themes, run_events,
                               v             feedback, suggestions
                          [ Classifier ]          ^
                               |                  |
                          [ Enricher ]            |
                               |                  |
                          [ Scorer (code) ] ------+
                               |
                          [ Approach suggester ] (optional, on demand)

                          [ Monitor ] rescans on a schedule, flags changes
```

### 3.1 Data flow (one run)

1. User submits a seller profile and starts a run. API creates a `runs` row (status `running`).
2. Orchestrator calls each enabled source adapter in parallel. Each adapter returns normalized `RawSignal` objects. Per-source status is written to `run_sources`; failures degrade gracefully (the run continues).
3. Scout dedupes (by `source` + `external_id`, then by `content_hash`), normalizes, and stores `signals` with a `text_snapshot`.
4. Displacement clusters competitor complaints into `themes` with supporting signal ids and verified quotes.
5. Classifier runs per signal, producing a labeled decision with rubric criteria and quotes. Quotes are verified in code.
6. Enricher adds structured context fields from stored data and the public profile summary where permitted (section 8.4).
7. Scorer computes the score and breakdown in code and writes `leads`.
8. At each step the orchestrator writes `run_events` rows. The dashboard subscribes via Supabase Realtime and shows live progress.
9. The run ends with status `completed`, `completed_with_warnings`, or `failed`.

### 3.2 Why this shape

- Free sources only, behind one adapter interface, so protected sources (e.g. review sites) can be added later without touching agents.
- LLMs do language work (labeling, extraction, summarizing). Code does everything that must be reproducible (scoring, verification, dedupe, ranking).

---

## 4. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React + TypeScript | Vite is the default bundler (D2) |
| Styling | Tailwind CSS with CSS variables for tokens | See section 11 |
| Backend | Node.js + TypeScript | Express or Fastify (D3). Pick one and stay consistent |
| Database | Supabase (Postgres) | Source of truth, Realtime for run progress |
| Validation | Zod | Shared schemas in `packages/shared` |
| LLM primary | Gemini 2.5 Flash | Model ID in config; `TODO(verify)` current ID in docs |
| LLM fallback | Groq (open model) | Model ID in config; `TODO(verify)` |
| Tests | Vitest | Unit + fixture tests |
| Package manager | npm workspaces (D4) | |

LLM calls go only through `apps/api/src/llm/client.ts`. No agent calls a provider SDK directly.

GPU credits are NOT part of the critical path. Do not add GPU or self-hosted model code.

---

## 5. File structure

```
vantage/
  ARCHITECTURE.md
  README.md
  .env.example
  package.json                      # npm workspaces
  tsconfig.base.json
  supabase/
    migrations/0001_init.sql
    seed.sql
  fixtures/
    seller-helpdesk.json            # demo seller profile
    reddit/*.json                   # recorded responses
    hn/*.json
    devforums/*.json
    review-snapshot.json            # saved review-site snapshot
    demo-run.json                   # cached complete run for demo mode
  packages/
    shared/
      src/
        types.ts                    # RawSignal, Decision, Lead, Theme, etc.
        schemas.ts                  # Zod schemas (LLM outputs + API)
        constants.ts                # labels, criteria ids
  apps/
    api/
      src/
        index.ts                    # server bootstrap
        config/
          env.ts                    # typed env loader (fails fast)
          scoring.ts                # weights, half-life, rubric weights
          rubric.ts                 # classifier criteria definitions
          sources.ts                # enabled sources, limits
        routes/
          runs.ts                   # POST /runs, GET /runs/:id
          leads.ts                  # GET list/detail, POST feedback
          report.ts                 # GET /runs/:id/report.csv, /report.json
          suggest.ts                # POST /leads/:id/suggest
        orchestrator/
          runPipeline.ts            # runs stages, writes run_events
          events.ts                 # emit run_events helper
        sources/
          types.ts                  # SourceAdapter interface
          reddit.ts
          hackernews.ts
          devforums.ts
          snapshot.ts               # reads fixtures/review-snapshot.json
          index.ts                  # adapter registry
        agents/
          scout.ts
          displacement.ts
          classifier.ts
          enricher.ts
          scorer.ts
          suggester.ts              # optional
          monitor.ts
        llm/
          client.ts                 # provider abstraction + fallback
          prompts/
            classifier.v1.ts
            displacement.v1.ts
            suggester.v1.ts
        verification/
          verifyQuote.ts            # substring check (section 8.3)
        scoring/
          computeScore.ts           # pure function
        db/
          client.ts
          queries.ts
        demo/
          replay.ts                 # DEMO_MODE replay of fixtures/demo-run.json
        utils/
          hash.ts
          rateLimit.ts
          time.ts
      test/
        verifyQuote.test.ts
        computeScore.test.ts
        adapters.fixture.test.ts
        classifier.schema.test.ts
    web/
      src/
        main.tsx
        app/
          App.tsx
          routes.tsx
        pages/
          SetupPage.tsx
          RunPage.tsx
          InboxPage.tsx
          SignalDetailPage.tsx
          ThemesPage.tsx
          ReportPage.tsx            # print-friendly
        components/
          PipelineProgress.tsx
          SourceHealthBadge.tsx
          SignalCard.tsx
          ScoreBreakdown.tsx
          CriteriaChecklist.tsx
          EvidenceQuote.tsx         # highlighted quote + permalink
          ReasoningTrace.tsx        # raw trace drawer
          ThemeCard.tsx
          SuggestionPanel.tsx
          EmptyState.tsx
          ErrorState.tsx
        hooks/
          useRunEvents.ts           # Supabase Realtime subscription
          useSignals.ts
        lib/
          api.ts
          supabase.ts
          format.ts
        styles/
          tokens.css
```

Do not create files outside this structure without asking.

---

## 6. Memory and storage

"Memory" in Vantage means persistent state in Postgres. Nothing else.

- Source of truth: Supabase Postgres.
- Agents are stateless between runs. Each agent receives explicit inputs and returns explicit outputs.
- Every agent decision is stored in `decisions` with the model, prompt version, and input hash so any result can be audited and reproduced.
- Post text is snapshotted at fetch time so evidence survives deletion at the source.
- User feedback (accept or reject) is stored in `feedback` and shown in the UI. In v1 it only changes the lead's `status`. Weight-learning from feedback is out of scope unless added to section 16.
- Caching: `signals` are unique on (`source`, `external_id`). Re-fetching the same post updates engagement numbers only; it never creates a duplicate.

### 6.1 Schema (implement exactly; changes need approval)

```sql
create table seller_profiles (
  id uuid primary key default gen_random_uuid(),
  product_name text not null,
  problem_description text not null,
  ideal_customer text,
  competitors text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table runs (
  id uuid primary key default gen_random_uuid(),
  seller_profile_id uuid not null references seller_profiles(id),
  status text not null check (status in
    ('running','completed','completed_with_warnings','failed')),
  demo boolean not null default false,
  params jsonb not null default '{}',
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table run_sources (
  run_id uuid references runs(id) on delete cascade,
  source text not null,
  status text not null check (status in
    ('pending','running','ok','degraded','failed','skipped')),
  fetched_count int not null default 0,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  primary key (run_id, source)
);

create table signals (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  external_id text not null,
  author_handle text not null,
  community text,
  url text not null,
  text_snapshot text not null,
  created_at_source timestamptz not null,
  engagement jsonb not null default '{}',
  content_hash text not null,
  removed_at_source boolean not null default false,
  fetched_at timestamptz not null default now(),
  unique (source, external_id)
);

create table run_signals (
  run_id uuid references runs(id) on delete cascade,
  signal_id uuid references signals(id) on delete cascade,
  primary key (run_id, signal_id)
);

create table decisions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs(id) on delete cascade,
  signal_id uuid references signals(id) on delete cascade,
  agent text not null,
  model text,
  prompt_version text,
  input_hash text not null,
  output jsonb not null,
  evidence jsonb not null default '[]',
  evidence_verified boolean not null default false,
  status text not null check (status in ('ok','invalid_output','error')),
  created_at timestamptz not null default now()
);

create table leads (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs(id) on delete cascade,
  signal_id uuid not null references signals(id) on delete cascade,
  label text not null,
  score int not null check (score between 0 and 100),
  score_breakdown jsonb not null,
  rank int not null,
  status text not null default 'new'
    check (status in ('new','accepted','rejected')),
  created_at timestamptz not null default now(),
  unique (run_id, signal_id)
);

create table themes (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs(id) on delete cascade,
  competitor text not null,
  title text not null,
  summary text not null,
  signal_ids uuid[] not null default '{}',
  quotes jsonb not null default '[]'
);

create table suggestions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  channel text not null,
  draft text not null,
  angle_note jsonb not null,
  created_at timestamptz not null default now()
);

create table feedback (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  action text not null check (action in ('accept','reject','reset')),
  note text,
  created_at timestamptz not null default now()
);

create table run_events (
  id bigserial primary key,
  run_id uuid not null references runs(id) on delete cascade,
  agent text not null,
  kind text not null check (kind in ('info','progress','warning','error')),
  message text not null,
  counts jsonb,
  created_at timestamptz not null default now()
);
```

Enable Row Level Security on all tables. Auth model is open decision D5; until decided, use a single service-role backend and do not expose the service key to the browser.

### 6.2 Data minimization

Store only: handle, community, text snapshot, URL, timestamps, engagement numbers. Do not store full profile histories, follower graphs, or any private data.

---

## 7. Sources and adapters

Every source implements:

```ts
export interface SourceAdapter {
  readonly id: 'reddit' | 'hackernews' | 'devforums' | 'snapshot';
  search(query: SourceQuery, ctx: AdapterContext): Promise<RawSignal[]>;
}

export interface RawSignal {
  source: SourceAdapter['id'];
  externalId: string;
  authorHandle: string;
  community?: string;
  url: string;              // permalink to the exact post or comment
  text: string;
  createdAt: string;        // ISO 8601
  engagement: { score?: number; comments?: number };
}
```

Rules for all adapters:
- Respect rate limits; send a descriptive User-Agent; back off exponentially on HTTP 429 or 5xx; cap retries.
- Never throw out of `search`. Return what was collected and report status to the orchestrator as `ok`, `degraded`, or `failed`.
- Never invent fields. If a field is not provided by the source, leave it undefined.
- Keep all source-specific parsing inside the adapter file.

### 7.1 Per-source notes

- Reddit: use the public JSON listing and search endpoints (a `.json` suffix on public URLs). `TODO(verify)` current rate limits and terms in Reddit's documentation before implementing. Permalinks must be built from the permalink field the API returns, never guessed.
- Hacker News: use the Algolia HN search API and/or the official Firebase API. `TODO(verify)` endpoint parameters from the official docs.
- Dev forums: Stack Exchange API and GitHub issues/discussions search. `TODO(verify)` auth and rate limits from official docs.
- Snapshot: reads `fixtures/review-snapshot.json`. This stands in for review sites that need paid or protected access. Label it "Saved snapshot" in the UI.

---

## 8. Agents

All LLM agents: low temperature, structured JSON output, Zod validation, prompts versioned in `llm/prompts/`, every call logged as a `decisions` row.

### 8.1 Scout (no LLM)
Fetch via adapters, dedupe, normalize, snapshot, store. Emits counts: fetched, after dedupe.

### 8.2 Displacement (LLM, optional per run)
Input: signals mentioning a configured competitor. Output: themes (title, summary, supporting signal ids, quotes). Each quote must pass verification (8.3). Themes with no verified quotes are discarded.

### 8.3 Classifier (LLM) + quote verification

Output schema (Zod):

```ts
{
  label: 'buyer_intent' | 'competitor_complaint' | 'venting' | 'noise',
  criteria: Array<{
    id: CriterionId,            // from config/rubric.ts
    passed: boolean,
    quote: string | null        // <= 300 chars, must be verbatim
  }>,
  rationale: string             // <= 280 chars, plain language
}
```

Rubric criteria (defined in `config/rubric.ts`, each with a weight):
`states_problem`, `asks_for_recommendation`, `mentions_team_or_budget`, `shows_urgency`, `names_competitor`.

Verification (`verification/verifyQuote.ts`): normalize both strings (collapse whitespace, normalize quote characters, case-insensitive), then require the quote to be a substring of the post text. If verification fails for a criterion that passed: set `passed=false`, record `quote_unverified` in the decision output, and keep the decision visible in the raw trace. Never display an unverified quote as evidence.

Rationale text is a convenience summary. The UI must present evidence and criteria as the authoritative explanation, with rationale labeled as a summary.

### 8.4 Enricher (mostly code)
Derive structured, enumerated fields from stored data: community, recency bucket, engagement bucket, whether the text mentions team size or role keywords from a fixed list, whether a competitor from the seller profile is named. For profile context, use only a public profile summary where the source API provides it and do not store it beyond fields in section 6. No free-text LLM inference about the person's identity.

### 8.5 Scorer (code only): `scoring/computeScore.ts`

Pure function, no I/O, no LLM.

```
intent      = weighted fraction of rubric criteria passed AND verified   (0..1)
fit         = fraction of fit checks satisfied from Enricher fields       (0..1)
recency     = 0.5 ^ (ageDays / RECENCY_HALF_LIFE_DAYS)                    (0..1)
engagement  = min(1, ln(1 + comments + score/5) / ln(1 + ENGAGEMENT_CAP))

score = round(100 * (0.40*intent + 0.25*fit + 0.20*recency + 0.15*engagement))
```

Weights, half-life (default 14 days) and engagement cap (default 40) live in `config/scoring.ts`. `score_breakdown` stores each component value, its weight, and its contribution. Add golden tests with fixed inputs and expected outputs.

Confidence shown in the UI is derived in code from the share of passed criteria whose quotes verified. It is never taken from the model.

Signals with label `noise` or `venting` are stored but excluded from the ranked list by default (toggle in UI).

### 8.6 Approach suggester (optional, LLM, on demand)
Triggered only by the "Suggest an approach" button. Input: the signal, verified evidence, the seller profile, and any matching theme. Output: recommended channel, an editable draft, and an `angle_note` that cites which quote and theme were used.
Hard constraints in the prompt and in post-validation:
- Channel recommendations: public reply for Reddit and HN; email only if the person published one publicly; otherwise "no direct channel".
- Draft must not claim features absent from the seller profile.
- Draft must lead with the person's stated problem, not a pitch.
- The system never sends messages. There is no send code path anywhere.

### 8.7 Monitor (no LLM)
Scheduled rescan using the same pipeline. Writes a diff: new signals, signals removed at source, score changes. Shown in a "Changes" panel. Scheduling mechanism is open decision D6.

---

## 9. LLM client contract (`llm/client.ts`)

- Single function: `generateJson<T>(opts: { prompt, schema, model?, temperature }) => Promise<Result<T>>`.
- Tries primary provider; on provider error or rate limit falls back to the secondary; records which model served the request.
- Validates with the provided Zod schema; up to 2 retries with the validation error appended to the prompt; then returns an `invalid_output` result.
- Never logs secrets or full prompts at info level.
- Respect free-tier rate limits with a queue and concurrency cap from `config/sources.ts` or an LLM config file.

---

## 10. API surface (v1)

| Method | Path | Purpose |
|---|---|---|
| POST | /runs | create seller profile + start run |
| GET | /runs/:id | run status, per-source health |
| GET | /runs/:id/leads | ranked signals (filters: label, status, min score) |
| GET | /leads/:id | detail with decisions, evidence, breakdown |
| POST | /leads/:id/feedback | accept / reject / reset |
| POST | /leads/:id/suggest | generate approach suggestion |
| GET | /runs/:id/themes | competitor themes |
| GET | /runs/:id/report.csv | CSV export |
| GET | /runs/:id/report.json | JSON export |

The printable report is a web page (`ReportPage.tsx`) with a print stylesheet so the browser can save it as PDF. (Export format is open decision D7.)

---

## 11. UI / UX specification

### 11.1 Principles
- Transparency first: every number and label can be traced to evidence in at most two clicks.
- Progressive disclosure: card (score + one-line why) then detail (criteria, evidence, breakdown) then raw trace drawer.
- Visibility of system status: live per-agent progress with counts; per-source health badges.
- Restraint: one accent color, one type scale, no decorative charts, generous whitespace.
- Honest language: "signal", not "lead"; "summary" for LLM rationale; "computed" for scores.

### 11.2 Design tokens (`styles/tokens.css`, adjustable via D8)
- Font: Inter (system sans fallback). Sizes: 12, 14, 16, 20, 28. Weights: 400 and 500 only.
- Neutral surface and border scale plus one accent. Semantic colors (success, warning, danger) used only for status, never for decoration.
- Radius 8px for controls, 12px for cards. Spacing scale of 4px multiples.
- Support light and dark via CSS variables. Meet WCAG AA contrast. Never convey meaning by color alone; pair with text or icon.

### 11.3 Screens

1. Setup (`SetupPage`): product name, problem description, ideal customer, competitors (chips), source toggles (with "Saved snapshot" labeled), "Load demo seller" button. Inline validation.
2. Run (`RunPage`): `PipelineProgress` shows each stage (Scout, Displacement, Classifier, Enricher, Scorer) with state and counts, plus `SourceHealthBadge` per source. Live event log underneath. Partial failure shows a warning, not a dead end.
3. Inbox (`InboxPage`): ranked `SignalCard` list. Card shows: score, label badge, source and community, handle, age, one-line summary, and a link icon to the original post. Filters: label, status, min score. Toggle to show noise and venting.
4. Signal detail (`SignalDetailPage`):
   - Original post text with evidence spans highlighted, and an "Open original" link (`target="_blank"`, `rel="noopener noreferrer"`). If `removed_at_source`, show the snapshot with a "removed at source" notice.
   - `CriteriaChecklist`: each criterion pass/fail with its verified quote.
   - `ScoreBreakdown`: each component, weight, and contribution; total equals the displayed score.
   - Accept / Reject buttons.
   - "Suggest an approach" button revealing `SuggestionPanel` (channel, editable draft, angle note, copy button). No send button.
   - "Raw trace" drawer (`ReasoningTrace`): model, prompt version, timestamps, validated JSON.
5. Themes (`ThemesPage`): competitor complaint themes with verified quotes and links to source posts.
6. Report (`ReportPage`): print-friendly summary of the ranked signals, evidence, breakdowns, and themes. Buttons: Download CSV, Print.

### 11.4 Required states
Every data view must implement loading, empty, error, partial-failure, and rate-limited states using `EmptyState` and `ErrorState`. No blank screens.

### 11.5 Copy rules
- Say "Signal" and "Evidence". Say "Suggested approach", never "auto-outreach".
- Always show a short note near contact-related UI: "Vantage finds public signals. It does not provide contact details or send messages."

---

## 12. Demo mode

- `DEMO_MODE=true` loads `fixtures/demo-run.json` and replays `run_events` with realistic timing so the progress screen animates.
- A live run on a small query must be possible, but the cached replay is the fallback. The UI shows a subtle "Demo data" badge whenever replay is active. Never present replayed data as live.

---

## 13. Error handling and degradation

- A failing source marks `degraded` or `failed` and the run continues. If at least one source succeeded, final status is `completed_with_warnings`.
- LLM failure on a signal records an `invalid_output` or `error` decision and skips that signal; counts of skipped signals are shown in the run summary.
- All user-facing errors have a plain-language message and a retry action where sensible.

---

## 14. Environment variables (names only; never commit values)

```
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY      # backend only
GEMINI_API_KEY
GROQ_API_KEY
REDDIT_USER_AGENT
STACKEXCHANGE_KEY              # optional, TODO(verify)
GITHUB_TOKEN                   # optional, TODO(verify)
DEMO_MODE
PORT
```

`config/env.ts` validates these at startup with Zod and fails fast with a clear message.

---

## 15. Build order (incremental, stop after each step for review)

1. Repo scaffold, shared types and schemas, env loader, Supabase migration, seed.
2. Reddit + HN adapters with fixtures and tests; Scout with dedupe and snapshot; store signals.
3. Orchestrator with `run_events` and Realtime; Run page progress UI.
4. Classifier with rubric, Zod validation, `verifyQuote` (with tests); decisions stored.
5. Enricher and Scorer with golden tests; leads stored.
6. Inbox and Signal detail UI with evidence highlighting, breakdown, trace drawer, accept/reject.
7. Displacement and Themes page; dev-forum and snapshot adapters.
8. Report page, CSV export, demo mode replay.
9. Approach suggester (optional), Monitor (optional).

Definition of done per step: it runs, relevant tests pass, you report exactly what you ran, and no new file or dependency appears outside this document.

---

## 16. Open decisions (ask the human; do not decide silently)

- D1: Confirm helpdesk tool as the demo seller.
- D2: Vite as bundler.
- D3: Express vs Fastify.
- D4: npm workspaces vs another monorepo tool.
- D5: Auth model and RLS policies (single-user demo vs Supabase Auth).
- D6: Monitor scheduling (cron on host vs Supabase scheduled function).
- D7: Report export formats (CSV + printable page by default; PDF generation server-side only if requested).
- D8: Final visual identity (colors, logo).
- D9: Exact current model IDs for Gemini and Groq (verify in provider docs).
- D10: Any additional sources.

---

## 17. Ethics and compliance notes (include in the project report)

- Public data only; no login-gated or bot-protected scraping.
- Minimum data stored; no full profile collection.
- No automated messaging; the human decides whether and how to contact anyone, following each platform's rules.
- Evidence is verified against stored source text; scores are reproducible from stored inputs.
