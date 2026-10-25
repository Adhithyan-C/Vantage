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
 Reddit API, HN Algolia,  ----+                    ^
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
        index.ts                    # re-exports constants, schemas, types
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
  search(query: SourceQuery, ctx: AdapterContext): Promise<AdapterResult>;
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

- Reddit: unauthenticated `.json` access was shut down in May 2026 and returns HTTP 403. Use ONLY the official Reddit Data API with OAuth app credentials (host `oauth.reddit.com`). If REDDIT_CLIENT_ID or REDDIT_CLIENT_SECRET is not set, the adapter reports status `skipped`. Never try to bypass a block or use proxies. `TODO(verify)` current rate limits and terms in Reddit's documentation before implementing. Permalinks must be built from the permalink field the API returns, never guessed.
- Hacker News: use the Algolia HN search API and/or the official Firebase API. Endpoint and parameters verified in October 2026: see section 18.1. Show a small "Search by Algolia" credit in the UI (attribution is reportedly required).
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
REDDIT_CLIENT_ID               # optional until the Reddit adapter is built
REDDIT_CLIENT_SECRET           # optional until the Reddit adapter is built
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
- D11 (adopted): Displacement is implemented with a local embedding model and density clustering instead of an LLM prompt. See section 32.
- D12 (adopted): Run events are also offered over Server-Sent Events, in addition to the polling endpoint, which stays. See section 34.
- D13 (adopted): The one new runtime dependency for section 32 is `@huggingface/transformers`, pinned to an exact version and verified against its official documentation before use.

---

## 17. Ethics and compliance notes (include in the project report)

- Public data only; no login-gated or bot-protected scraping.
- Minimum data stored; no full profile collection.
- No automated messaging; the human decides whether and how to contact anyone, following each platform's rules.
- Evidence is verified against stored source text; scores are reproducible from stored inputs.

---

## 18. Amendments (added after Phase 1, October 2026)

These amendments override anything earlier in this file that conflicts with them.

### 18.1 Hacker News adapter (verified)

- Endpoint: `https://hn.algolia.com/api/v1/search_by_date` (newest first). No API key.
- Query parameters used: `query` (keyword), `tags=(story,comment)` (parentheses mean OR), `numericFilters=created_at_i>UNIX_SECONDS`, `hitsPerPage` (max 100 per request).
- Hit fields used: `objectID`, `author`, `comment_text` (comments), `title` and `story_text` (stories), `created_at`, `created_at_i`, `points`, `num_comments`, `_tags`.
- Permalink: `https://news.ycombinator.com/item?id=<objectID>`.
- Text fields contain HTML and must be converted to plain text before storing.
- Search results are capped at 1000 hits per query regardless of page. Phase 2 uses one page per keyword only.
- Show "Search by Algolia" attribution in the UI footer.

### 18.2 Reddit status

Reddit's unauthenticated `.json` endpoints return 403 since May 2026. Access requires registering an app and using the official Data API with OAuth, and new credentials may need approval. The Reddit adapter is built in a later step (Phase 2B), only after the human has working credentials. Until then Reddit is not enabled, and Reddit demo data must be clearly labeled as sample data, never presented as live.

### 18.3 Adapter types (replace the interface in section 7)

```ts
export interface SourceQuery {
  keywords: string[];
  sinceDays: number;
  maxResults: number;          // total cap per adapter call
}

export interface AdapterContext {
  fetch: typeof fetch;         // injected so tests never touch the network
  now: () => Date;
  userAgent: string;
  timeoutMs: number;
  maxRetries: number;
}

export interface AdapterResult {
  signals: RawSignal[];
  status: 'ok' | 'degraded' | 'failed' | 'skipped';
  error?: string;              // first error message, if any
}
```

### 18.4 Dedupe rule

Dedupe first by (`source`, `externalId`), then by content hash across all sources, keeping the first occurrence. Content-hash dedupe applies only when the normalized text is at least 40 characters long.

### 18.5 Extra files added by Phase 2

- `apps/api/src/utils/text.ts` (HTML to plain text)
- `apps/api/src/scripts/scout-cli.ts` (dev CLI that runs Scout from the terminal)
- Root and API `package.json` get a `scout` script
- `fixtures/hn/` holds one recorded real HN response

---

## 19. Phase 3A: run pipeline backend (added October 2026)

These rules override anything earlier that conflicts with them.

### 19.1 Shared package additions (packages/shared)

- constants.ts: add 'orchestrator' to the END of the AGENTS array.
- schemas.ts adds:

```ts
export const RunParamsSchema = z.object({
  keywords: z.array(z.string().trim().min(1).max(100)).min(1).max(10),
  sinceDays: z.number().int().min(1).max(365),
  maxResults: z.number().int().min(1).max(100),
});

export const RunCreateRequestSchema = z.object({
  seller: SellerProfileInputSchema,
  params: RunParamsSchema,
});
```

- types.ts adds:

```ts
export type RunStatus = (typeof RUN_STATUSES)[number];
export type SourceStatus = (typeof SOURCE_STATUSES)[number];
export type EventKind = (typeof EVENT_KINDS)[number];
export type AgentId = (typeof AGENTS)[number];
export type RunParams = z.infer<typeof RunParamsSchema>;
export type RunCreateRequest = z.infer<typeof RunCreateRequestSchema>;

export interface RunSourceView {
  source: SourceId;
  status: SourceStatus;
  fetchedCount: number;
  error: string | null;
}

export interface RunView {
  id: string;
  status: RunStatus;
  demo: boolean;
  params: RunParams;
  startedAt: string;
  finishedAt: string | null;
  seller: {
    productName: string;
    problemDescription: string;
    idealCustomer: string | null;
    competitors: string[];
  };
  sources: RunSourceView[];
  signalCount: number;
}

export interface RunEvent {
  id: number;
  runId: string;
  agent: AgentId;
  kind: EventKind;
  message: string;
  counts: Record<string, unknown> | null;
  createdAt: string;
}
```

### 19.2 Database

New file supabase/migrations/0002_run_events_read_policy.sql containing exactly:

```sql
create policy "anon can read run_events"
  on run_events for select to anon using (true);
```

No other tables get policies in this phase. The human runs this file in the Supabase SQL editor.

### 19.3 RunStore (apps/api/src/db/runs.ts)

All database access for runs goes through this interface. runPipeline never talks to Supabase directly.

```ts
export interface SourcePatch {
  status: SourceStatus;
  fetchedCount?: number;
  error?: string | null;
  startedAt?: string;
  finishedAt?: string;
}

export interface RunStore {
  createSellerProfile(input: SellerProfileInput): Promise<string>;
  createRun(sellerProfileId: string, params: RunParams): Promise<string>;
  getRun(runId: string): Promise<RunView | null>;
  listEvents(runId: string, afterId: number): Promise<RunEvent[]>;
  setRunStatus(runId: string, status: RunStatus, finished: boolean): Promise<void>;
  upsertRunSource(runId: string, source: SourceId, patch: SourcePatch): Promise<void>;
  addEvent(runId: string, agent: AgentId, kind: EventKind, message: string, counts?: Record<string, unknown>): Promise<void>;
  storeSignals(runId: string, signals: RawSignal[]): Promise<{ inserted: number; updated: number }>;
  failStaleRuns(): Promise<number>;
}
```

createRunStore(db: SupabaseClient): RunStore implements it with these rules:
- createSellerProfile inserts into seller_profiles (product_name, problem_description, ideal_customer or null, competitors) and returns the new id.
- createRun inserts into runs (seller_profile_id, status 'running', demo false, params) and returns the new id.
- getRun: query runs by id with maybeSingle (return null if missing); then seller_profiles by the run's seller_profile_id; then run_sources by run_id; then run_signals (select signal_id) by run_id for signalCount (the number of rows). Map snake_case to the camelCase RunView exactly as in 19.1. Sort sources by source name.
- listEvents: run_events where run_id equals runId and id greater than afterId, ordered by id ascending, limit 500, mapped to RunEvent. Convert id to a JavaScript number.
- setRunStatus: update runs set status; if finished is true also set finished_at to the current ISO time.
- upsertRunSource: upsert into run_sources with onConflict 'run_id,source'. Send only the fields present in the patch (mapped: fetchedCount to fetched_count, startedAt to started_at, finishedAt to finished_at).
- addEvent: insert into run_events (run_id, agent, kind, message, counts or null).
- storeSignals: call upsertSignals(db, signals) (which now also returns signalIds), then upsert rows { run_id, signal_id } into run_signals with onConflict 'run_id,signal_id' and ignoreDuplicates true. Return { inserted, updated }.
- failStaleRuns: update runs set status 'failed' and finished_at now where status is 'running'; return how many rows were changed.
- Any Supabase error is thrown as new Error(`Supabase error in <method>: ${error.message}`).

upsertSignals (apps/api/src/db/queries.ts) changes: it now returns { inserted, updated, signalIds } where signalIds is the ids of every signal passed in (newly inserted ones via .select('id') on the insert, plus the existing ones found by the lookup). If it is called with an empty array it returns { inserted: 0, updated: 0, signalIds: [] } and makes no database calls.

### 19.4 Progress events (apps/api/src/orchestrator/events.ts)

createEmitter(store: RunStore, runId: string) returns an object with info, progress, warning and error. Each is (agent: AgentId, message: string, counts?: Record<string, unknown>) => Promise<void>, calls store.addEvent with the matching kind, and NEVER throws: if addEvent throws, catch it and console.error the error message only.

### 19.5 runPipeline (apps/api/src/orchestrator/runPipeline.ts)

```ts
export interface PipelineDeps { store: RunStore; adapters: SourceAdapter[]; ctx: AdapterContext; }
export function computeRunStatus(reports: Array<{ status: SourceStatus }>): RunStatus;
export async function runPipeline(deps: PipelineDeps, runId: string, params: RunParams): Promise<void>;
```

computeRunStatus: if there are no reports return 'failed'. If every report is 'ok' return 'completed'. Otherwise, if any report is 'ok' or 'degraded' return 'completed_with_warnings'. Otherwise return 'failed'.

runPipeline never throws. It does this, in order:
1. Create the emitter.
2. Emit orchestrator/info "Run started" with counts { keywords: <number>, sinceDays, maxResults }.
3. If adapters is empty: emit orchestrator/error "No sources are enabled", call store.setRunStatus(runId, 'failed', true), and return.
4. For each adapter: store.upsertRunSource(runId, adapter.id, { status: 'running', startedAt: <now ISO> }).
5. Emit scout/progress `Searching ${ids.join(', ')} for ${n} keyword(s)` where ids are the adapter ids and n is the number of keywords.
6. Call runScout({ adapters, query: { keywords, sinceDays, maxResults }, ctx }).
7. For each source report: store.upsertRunSource(runId, report.source, { status: report.status, fetchedCount: report.fetched, error: report.error ?? null, finishedAt: <now ISO> }). Then emit scout/<kind> with message `${source}: ${status}, fetched ${fetched}` and, only when there is an error text, append ` (${error})`. kind is 'info' for ok, 'warning' for degraded or skipped, 'error' for failed. counts { source, status, fetched }.
8. Emit scout/progress `Removed ${fetchedTotal - afterDedupe} duplicate(s): ${afterDedupe} unique signal(s)` with counts { fetched: fetchedTotal, afterDedupe }.
9. If afterDedupe is 0: emit scout/warning "No signals found. Try different keywords or a longer time window." Otherwise call store.storeSignals(runId, result.signals) and emit scout/progress `Stored ${inserted} new and refreshed ${updated} existing signal(s)` with counts { inserted, updated }.
10. status = computeRunStatus(source reports). Call store.setRunStatus(runId, status, true). Emit orchestrator with message "Run completed" (kind info) if status is 'completed', "Run completed with warnings" (kind warning) if 'completed_with_warnings', or "Run failed: no source succeeded" (kind error) if 'failed'. counts { signals: afterDedupe }.
11. Wrap steps 4 to 10 in try/catch. On any thrown error: emit orchestrator/error `Run failed: ${message}`, then call store.setRunStatus(runId, 'failed', true) inside its own try/catch that ignores errors.

### 19.6 HTTP API (apps/api/src/routes/runs.ts)

createRunsRouter(deps: PipelineDeps): express.Router, mounted at the ROOT of the app (no /api prefix; the web dev server will proxy). Error bodies are always JSON { error: string, issues?: string[] }. Every handler is wrapped in try/catch and answers 500 { error: 'Internal error' } on an unexpected error (log the message with console.error, never the request body).

- POST /runs: validate req.body with RunCreateRequestSchema.safeParse. On failure answer 400 { error: 'Invalid request', issues: ['<path>: <message>', ...] }. On success: sellerId = store.createSellerProfile(seller), runId = store.createRun(sellerId, params); answer 202 { runId } IMMEDIATELY; then start runPipeline(deps, runId, params) WITHOUT awaiting it (add .catch that console.errors the message). If creating the profile or run throws, answer 500 { error: 'Could not create run' }.
- GET /runs/:runId: if runId does not match /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i answer 400 { error: 'Invalid run id' }. If store.getRun returns null answer 404 { error: 'Run not found' }. Otherwise 200 with the RunView.
- GET /runs/:runId/events?after=N: same runId check. `after` is optional, default 0; if present it must be a non-negative integer, otherwise 400 { error: 'Invalid after' }. Answer 200 { events: RunEvent[] } (from store.listEvents).
- GET /demo-seller: answer 200 { seller: <demo seller>, params: DEMO_RUN_PARAMS }. This has exactly the shape that POST /runs accepts.

### 19.7 Demo config (apps/api/src/config/demo.ts)

- DEMO_RUN_PARAMS = { keywords: ['zendesk alternative', 'helpdesk software'], sinceDays: 90, maxResults: 50 }.
- loadDemoSeller(): reads fixtures/seller-helpdesk.json using readFileSync with fileURLToPath(new URL('../../../../fixtures/seller-helpdesk.json', import.meta.url)), parses it with JSON.parse, validates with SellerProfileInputSchema.parse, and returns it. Do NOT use a JSON import statement.

### 19.8 Startup (apps/api/src/index.ts)

Keep the existing env loading and failure behavior. Wrap the startup in an async function main() called as main().catch(...) that prints the message and exits with code 1. In main: getEnv, createDb, createRunStore, then try { await store.failStaleRuns() } catch (log a warning with the message and CONTINUE). Then app.use(express.json()), keep GET /health, app.use(createRunsRouter({ store, adapters: getEnabledAdapters(), ctx: defaultAdapterContext() })), then listen on env.PORT.

defaultAdapterContext() is a new export of apps/api/src/sources/index.ts returning { fetch: globalThis.fetch, now: () => new Date(), userAgent: 'vantage-lab-project/0.1', timeoutMs: SOURCE_CONFIG.requestTimeoutMs, maxRetries: SOURCE_CONFIG.maxRetries }.

### 19.9 Files added or changed

packages/shared/src/{constants,schemas,types}.ts, packages/shared/test/schemas.test.ts, supabase/migrations/0002_run_events_read_policy.sql, apps/api/src/config/demo.ts, apps/api/src/sources/index.ts, apps/api/src/db/queries.ts, apps/api/src/db/runs.ts, apps/api/src/orchestrator/events.ts, apps/api/src/orchestrator/runPipeline.ts, apps/api/src/routes/runs.ts, apps/api/src/index.ts, and tests apps/api/test/runPipeline.test.ts and apps/api/test/demo.test.ts.


---

## 20. Phase 3B: web Setup and Run screens (added October 2026)

These rules override anything earlier that conflicts with them.

### 20.1 Decisions

- Live progress uses polling, not Supabase Realtime. The Run page calls GET /runs/:id and GET /runs/:id/events?after=N once per second until the run is no longer 'running', then reads events once more (the final event is written just after the status changes). Realtime stays an optional later upgrade; migration 0002 stays in place.
- Routing uses hash routes with no router package: `#/` is the Setup page, `#/runs/<uuid>` is the Run page. Anything else shows "Page not found".
- The web dev server proxies `/api` to http://localhost:3001 and strips the `/api` prefix (apps/web/vite.config.ts, `server.proxy` only). The API has no `/api` prefix and no CORS. This is the only permitted change to vite.config.ts; path aliases remain forbidden.
- Styling is plain CSS with variables in src/styles/tokens.css (light and dark through prefers-color-scheme, one accent colour, semantic colours only for status). Tailwind is not used yet. No new packages were added to apps/web.
- Status is always shown as text as well as colour.

### 20.2 Files (all under apps/web)

- vite.config.ts (proxy added), src/main.tsx (imports tokens.css), src/styles/tokens.css
- src/app/App.tsx, src/app/routes.tsx
- src/lib/api.ts (fetch client for /api), src/lib/format.ts
- src/hooks/useRunEvents.ts (the polling hook)
- src/components/SourceHealthBadge.tsx, PipelineProgress.tsx, EmptyState.tsx, ErrorState.tsx
- src/pages/SetupPage.tsx, src/pages/RunPage.tsx

### 20.3 Behaviour

- Setup: product, problem, ideal customer (optional), competitors (comma list), keywords (comma list, 1 to 10), look-back days (1 to 365), max results (1 to 100). Validated in the browser with RunCreateRequestSchema from @vantage/shared, with inline field errors. "Load demo seller" fills the form from GET /demo-seller. The Sources panel is read-only (Hacker News live; Reddit, developer forums and review sites shown as unavailable). Submit calls POST /runs and navigates to the Run page.
- Run: header with status, pipeline card (Scout live, the other four stages shown as "Planned"), per-source health, a result card when finished, and the event log (`role="log"`, polite live region). Network errors show a retry button after 5 failed polls; 400 and 404 stop polling at once.
- Footer (every page): "Vantage finds public signals. It does not provide contact details or send messages." plus the "Search by Algolia" attribution.

---

## 21. Phase 4: Classifier (added October 2026)

These rules override anything earlier that conflicts with them.

### 21.1 Scope
After Scout stores a run's signals, the pipeline classifies them with an LLM, verifies every quote in code, and stores one row per signal in `decisions` (agent 'classifier'). No leads and no scores (Phase 5). No new packages: call Gemini and Groq with `fetch`. Never log API keys, prompts or post text.

### 21.2 Config (`apps/api/src/config/llm.ts`)
Exports: `geminiModel`, `groqModel`, temperature 0, requestTimeoutMs 30000, maxValidationRetries 2, concurrency 2, maxClassifyPerRun 30, maxPostChars 4000, promptVersion 'classifier.v1'. Model IDs: start from "gemini-2.5-flash" unless the official Google docs show it retired or unavailable on the free tier (then STOP and ask me which to use). For Groq pick one currently supported model that supports JSON mode and report your choice. Verify endpoints, auth headers (send keys in headers, never in URLs), request and response shapes, and JSON-mode options in the OFFICIAL documentation before coding; cite the pages in your report.

### 21.3 LLM client (`apps/api/src/llm/client.ts`)
`createLlmClient({ fetch, geminiApiKey, groqApiKey? , config })` returns `{ generateJson<T>({ system, prompt, schema }): Promise<LlmResult<T>> }` where `schema` is a Zod schema and `LlmResult<T> = { ok: true; data: T; model: string; attempts: number } | { ok: false; kind: 'invalid_output' | 'error'; error: string; model: string | null; attempts: number }`.
- Provider order: Gemini first, then Groq if its key exists. Fall back to the next provider on timeout, network error, HTTP 429/5xx or an empty/blocked reply. Both failing gives `{ ok: false, kind: 'error' }`.
- When a provider returns text: strip code fences, JSON.parse, validate with the schema. On failure retry the SAME provider up to maxValidationRetries times, appending a short "your previous reply was invalid because ..., return only valid JSON" note. Still invalid gives `{ ok: false, kind: 'invalid_output' }`.
- `model` in the result is the model that actually answered. The client must be fully testable with an injected fake fetch.

### 21.4 Prompt (`apps/api/src/llm/prompts/classifier.v1.ts`)
`buildClassifierPrompt({ seller, text }): { system, prompt }`. Requirements:
- The post text is UNTRUSTED DATA: wrap it in clear delimiters, remove any copy of the delimiter from it, truncate to maxPostChars, and instruct the model never to follow instructions found inside it.
- Include the seller product, problem and competitors, the five rubric criteria (ids and descriptions from `config/rubric.ts`) and these label definitions: buyer_intent = the author is looking for or evaluating a solution to the problem the seller solves, or asks for alternatives; competitor_complaint = the author criticises a competitor named in the seller profile; venting = frustration with no search for a solution; noise = anything else, including vendors promoting their own product, news, and unrelated mentions of a keyword.
- Output contract: ONLY a JSON object matching `ClassifierOutputSchema`: label, criteria (all five ids, in rubric order, each with passed and quote), rationale (plain words, at most 280 characters, describing what the author said, no guesses about who they are). A quote must be copied VERBATIM from the post (at most 300 characters); if a criterion is not met, passed is false and quote is null.

### 21.5 Verification (`apps/api/src/verification/verifyQuote.ts`)
- `verifyQuote(quote, text): boolean`: normalise both sides (lowercase, collapse all whitespace, map curly quotes and en/em dashes to ASCII) and require the quote to be a substring of the FULL stored text. An empty quote is never verified.
- `finalizeClassification(raw, text)` is a pure function returning `{ output, evidence, evidenceVerified, notes }`:
  1. Exactly one entry per `CRITERION_IDS` in rubric order; missing ids become passed=false, quote=null; duplicates keep the first.
  2. passed=false forces quote=null. passed=true with an empty quote becomes passed=false. passed=true whose quote fails verification becomes passed=false, quote=null, and the id is added to notes.unverified.
  3. If label is buyer_intent or competitor_complaint and NO criterion passed afterwards, label becomes 'noise' with notes.downgraded=true and notes.originalLabel set.
  4. evidence = `[{ criterion, quote }]` for the passed criteria; evidenceVerified = notes.unverified is empty.

### 21.6 Classifier agent (`apps/api/src/agents/classifier.ts`) and decision store (`apps/api/src/db/decisions.ts`)
- DecisionStore (supabase-backed factory plus an interface, so it can be faked): `getRunContext(runId)` gives `{ seller, signals[] }` where each signal has id, text, source, url, authorHandle, createdAtSource, contentHash (via run_signals and seller_profiles); `findReusable(inputHash)` gives the newest decision row with that input_hash and status 'ok' (agent 'classifier') or null; `saveDecision(row)`; `listDecisions(runId)` gives DecisionView[].
- `createClassifyStage({ llm, store, config })` returns `ClassifyStage = (runId, onProgress) => Promise<ClassifySummary>`. Process signals newest first, at most maxClassifyPerRun, with the configured concurrency (write a tiny semaphore, no package). Per signal: inputHash = hash of (promptVersion, rubric ids and weights, seller problem, sorted competitors, signal contentHash). If findReusable hits, save a copy for THIS run (same output, model and prompt_version) and count it as reused. Otherwise buildClassifierPrompt, `llm.generateJson` with `ClassifierOutputSchema`, then `finalizeClassification`, then saveDecision.
- decisions row: run_id, signal_id, agent 'classifier', model, prompt_version, input_hash, output = `{ label, criteria, rationale, notes }`, evidence, evidence_verified, status 'ok'. When the LLM returns invalid_output or error: status 'invalid_output' or 'error', output = `{}`, and the signal counts as failed. One failing signal never stops the rest.
- `ClassifySummary = { total, classified, reused, failed, labels: counts per LeadLabel, verifiedQuotes, droppedQuotes, capped: boolean }`.

### 21.7 Pipeline integration (`apps/api/src/orchestrator/runPipeline.ts`)
- PipelineDeps gets an OPTIONAL `classify?: ClassifyStage`. When absent, behaviour is exactly as before (the existing 8 runPipeline tests must pass unchanged).
- When present and afterDedupe > 0, after storing signals and before the final status: emit (agent 'classifier') progress `Classifying ${n} signal(s)` counts `{ total: n }`; if capped, warning `Classifying the newest ${max} of ${total} signals`; during the stage progress `Classified ${done} of ${n}` every 10 signals; at the end info `Classified ${classified} signal(s): ${a} buyer intent, ${b} competitor complaint, ${c} venting, ${d} noise` with counts `{ classified, reused, failed, buyer_intent, competitor_complaint, venting, noise, verifiedQuotes, droppedQuotes }`; if failed > 0 also warning `${failed} signal(s) could not be classified`.
- If the stage throws: emit classifier error `Classification failed: ${message}` (message via instanceof Error) and continue.
- Run status: unchanged, except a run that would be 'completed' becomes 'completed_with_warnings' when classification had failures or threw. Classification problems never make a run 'failed'.

### 21.8 API (`apps/api/src/routes/runs.ts`, wiring in `index.ts`)
- New `GET /runs/:runId/decisions`: same runId validation and error bodies as the other routes; answers 200 `{ decisions: DecisionView[] }` (at most 100, newest signal first). Shared type `DecisionView` in packages/shared: `{ signalId, source, url, authorHandle, createdAtSource, textPreview (first 280 chars), label, rationale, criteria: [{ id, passed, quote }], evidenceVerified, model, promptVersion, status }`. For failed rows label is null and rationale ''.
- index.ts builds the LLM client (keys from env), the decision store and the classify stage and passes `classify` into the router deps. If creating them fails, the server must still start and runs must complete without classification.

### 21.9 Web (apps/web, small)
- PipelineProgress: the Classifier stage becomes live. Badge: no classifier events yet and run running gives "Waiting"; a final "Classified ..." info event gives Completed (or "Completed with warnings" if the stage emitted a warning or error); events present but no final one gives Running; run finished with no classifier events gives "Skipped". Summary line from the last classifier info event counts: "X buyer intent · Y competitor complaint · Z venting · W noise".
- RunPage result note: "The ranked list with evidence appears here once scoring is added."

### 21.10 Files
packages/shared/src/types.ts (DecisionView), config/llm.ts, llm/client.ts, llm/prompts/classifier.v1.ts, verification/verifyQuote.ts, agents/classifier.ts, db/decisions.ts, orchestrator/runPipeline.ts, routes/runs.ts, index.ts, web PipelineProgress.tsx and RunPage.tsx, plus tests.

---

## 22. Phase 4.1: Classifier resilience, failure reasons, provider configuration, and circuit breaker

These rules amend Phase 4. Use Groq before Gemini by default because the current account returns HTTP 404 for `gemini-2.5-flash`.

### 22.1 Failure reasons

A failed `LlmResult` includes `providerErrors: Array<{ provider: 'gemini' | 'groq'; status: number | null; message: string }>` with an entry for each failed provider request attempt. Messages come from the provider error-body message field or exception text, are limited to 200 characters, redact configured API key values and every `AIza[0-9A-Za-z_-]{20,}` or `gsk_[0-9A-Za-z]+` secret, and never contain prompts or post text. Failed decision output is `{ error: { providers: providerErrors } }`, retaining status `error` or `invalid_output`. `ClassifySummary.failureReasons` counts keys `provider:status`, using `none` for a null status. Pipeline event counts include these counts. The failure warning is `${failed} signal(s) could not be classified (${reason})`, with the most frequent reason rendered as human-readable text (for example `groq HTTP 429`, `gemini HTTP 404`, or `gemini network error`). Ties are deterministic.

### 22.2 Provider fallback

Fall through to the next eligible provider in `providerOrder` on any non-2xx response, network error, timeout, empty reply, or blocked reply. If all available providers fail, return a failure containing their recorded provider errors. This supersedes narrower fallback rules in earlier sections.

### 22.3 Rate limits and configuration

For HTTP 429 and 503, retry the same provider before falling through. Allow at most two retries per provider per call. On a numeric `Retry-After`, wait seconds converted to milliseconds; otherwise wait 2000 ms then 4000 ms. Cap all waits at 20000 ms. Inject `sleep(ms)` into the client for tests. Add `rateLimitRetries: 2` and `retryAfterCapMs: 20000` to LLM configuration. Set classifier concurrency to 1 and `maxPostChars` to 2000. Reconcile retries, fallback, and failure recording.

### 22.4 Prompt v2

Set `promptVersion` to `classifier.v2`, create `apps/api/src/llm/prompts/classifier.v2.ts`, switch all relevant imports and references, move v1 prompt tests to v2, and delete `classifier.v1.ts`. Preserve the v1 prompt behavior and injection defenses. Refine label definitions: venting is frustration/complaints about customer support, helpdesk or ticketing tools, support workflows, or a seller-profile competitor; frustration about other topics (including AI debates, politics, engineering management, or general software complaints) is noise; vendors/founders/makers promoting their own product are noise even if it is a competitor or alternative; a passing competitor mention without evaluation, complaint, or request is noise; buyer intent requires looking for, comparing, or asking about tools or approaches in the seller's problem area.

### 22.5 LLM diagnostic command

Add root `npm run llm:check`, forwarding to `apps/api/src/scripts/llm-check.ts` through the API workspace script. Load the root `.env` as in `index.ts`, build the real LLM client from environment configuration, and issue exactly one tiny `{ ok: boolean }` schema request per configured provider using a prompt asking for `{"ok": true}`. Print one sanitized provider/model result per configured provider, `not configured` for absent keys, the effective provider order, and disabled providers. Never print keys, headers, prompts, post text, or unsanitized errors. Exit 1 when no provider succeeds. Add no packages.

### 22.6 Web: Scout badge

In `PipelineProgress`, Scout status is independent of the run-level page-header badge. Display `Running` until a scout event with `counts.afterDedupe` exists or the run is no longer running. After that event display `Completed`, unless a source is `degraded`, `failed`, or `skipped`, in which case show `Completed with warnings`; show `Failed` if every source failed. Keep the header badge tied to `run.status`.

### 22.7 Files and scope

Intended files: `config/llm.ts`, `llm/client.ts`, `llm/prompts/classifier.v2.ts` (delete v1), `agents/classifier.ts`, `db/decisions.ts`, `orchestrator/runPipeline.ts`, `scripts/llm-check.ts`, both root and API `package.json` (script entries only), web `PipelineProgress.tsx`, and relevant tests. Additional authorized files: `apps/api/src/config/env.ts`, `apps/api/test/env.test.ts`, and `.env.example`. No unrelated changes.

### 22.8 Provider order, model overrides, and circuit breaker

Default/exported `providerOrder` is Groq then Gemini. Optional `LLM_PROVIDER_ORDER` accepts comma-separated `groq` and `gemini`; drop unknowns and use the default if no valid names remain. Skip providers without keys. The same effective order governs the client, retries/fallback, diagnostic, and tests. Optional non-empty `GEMINI_MODEL` and `GROQ_MODEL` override configured model IDs; empty values are unset. Extend the environment schema and `.env.example` with `GEMINI_MODEL=`, `GROQ_MODEL=`, and `LLM_PROVIDER_ORDER=`; selected models must be used in provider requests.

For HTTP 404, 401, or 403, disable that provider for the client/process lifetime; later calls skip it. Log one warning per trip, exactly `LLM provider <name> disabled after HTTP <status>`, containing no sensitive content. Do not trip on 429, 5xx, timeout, or network errors. A breaker status must not be retried as rate limiting; continue to the next provider. When all providers are disabled, return `{ ok: false, kind: 'error' }` with stored provider errors. Expose disabled-provider state to the diagnostic without secrets.

### 22.9 Tests

Use injected fakes only: no real network/database or module mocks. Verify default/reversed/invalid provider order, model overrides in actual requests, missing-key skipping, empty env values, and order parsing. Verify 404/401/403 trip breakers, later calls make no further request to disabled providers, each trip warns once with the exact safe text, and 429/503/500/network/timeout do not trip. Verify continuing enabled providers and all-disabled errors with provider errors.

Client tests cover 403 and network fallback, numeric and fallback retry delays, three 429 attempts then fallback, 20-second cap, sanitized error messages including echoed configured and regex-matched keys, one error per failed request with correct status, 429/503 retry before fallback, other non-2xx no retry, empty/blocked fallback, and model/order/key behavior. Classifier tests verify failure output `{ error: { providers } }`, status, mixed `failureReasons`, and absence of prompt/post text. Pipeline tests verify most-frequent reason formatting, HTTP/null reason rendering, event counts, deterministic ties, and updated warning text. Prompt tests verify v2, refined labels, preserved injection defenses and delimiters, and all imports use v2. Environment tests cover the three optional variables, overrides, empty values, unknown names, and default fallback. Scout badge tests cover running/completed/warnings/all-failed states and preserve the header run badge.

---

## 23. Phase 5: Enricher and Scorer (added October 2026)

These rules override earlier sections where they conflict.

### 23.1 Scope
After classification, the pipeline enriches and scores every signal of the run that has an 'ok' classifier decision, stores one row per signal in `leads` (existing table: run_id, signal_id, label, score int 0..100, score_breakdown jsonb, rank int, status default 'new', unique (run_id, signal_id)), and exposes them through a new API route. No LLM calls in this phase. Scoring is plain deterministic code. No new packages and no migration.

### 23.2 Config
- config/scoring.ts: RECENCY_HALF_LIFE_DAYS becomes 30 (override of the earlier 14: HN threads stay relevant longer). SCORE_WEIGHTS and ENGAGEMENT_CAP stay as they are.
- New config/enrich.ts exports PURCHASE_TERMS = ['price','pricing','cost','expensive','cheaper','budget','switch','switching','migrate','migrating','alternative','alternatives','recommend','recommendation','looking for','evaluating','replace','replacing','subscription','per seat'] and TEAM_TERMS = ['our team','my team','small team','startup','founder','co-founder','cto','ceo','support team','we are a','we have','employees','solo','indie','our customers','our users','our company'].

### 23.3 Enricher (apps/api/src/agents/enricher.ts, pure function, no I/O)
`enrichSignal({ text, source, community, createdAtSource, engagement, competitors, now }): Enrichment`.
Enrichment = { ageDays: number (never negative, rounded to 1 decimal), commentCount: number (0 if missing), upvotes: number (0 if missing), source, community: string | null, competitorsMentioned: string[], purchaseTermsFound: string[], teamTermsFound: string[], fit: { competitorMentioned: boolean, purchaseLanguage: boolean, teamOrRoleContext: boolean } }.
- Matching is case-insensitive on the stored post text. A competitor is mentioned when its name appears as a whole word (escape regex characters; use word boundaries). Term lists use plain substring matching on the lowercased text. Keep list order, no duplicates.
- fit.competitorMentioned = competitorsMentioned is non-empty; fit.purchaseLanguage = purchaseTermsFound non-empty; fit.teamOrRoleContext = teamTermsFound non-empty.
- Add the type Enrichment to packages/shared.

### 23.4 Scorer (apps/api/src/scoring/computeScore.ts, pure function, no I/O) and agents/scorer.ts
`computeScore({ passedCriteria: CriterionId[], enrichment, rubric, weights, halfLifeDays, engagementCap }): ScoreBreakdown`:
- intent = sum of rubric weights of passedCriteria divided by the sum of all rubric weights (0..1).
- fit = (number of true values in enrichment.fit) / 3.
- recency = 0.5 ^ (ageDays / halfLifeDays).
- engagement = min(1, ln(1 + commentCount + upvotes / 5) / ln(1 + engagementCap)).
- components in this order: intent, fit, recency, engagement; each { name, value (full precision), weight (from SCORE_WEIGHTS), contribution = 100 * weight * value rounded to 2 decimals }.
- total = Math.round(100 * (sum of weight * value)) computed from the UNROUNDED values, clamped 0..100. Return { components, total } matching ScoreBreakdownSchema.
`computeConfidence(passedCount, unverifiedCount): number | null` = passedCount / (passedCount + unverifiedCount), or null when both are 0. unverifiedCount comes from the decision's output.notes.unverified (array length, 0 if missing).
`rankLeads(items)` sorts by label tier (buyer_intent 0, competitor_complaint 1, venting 2, noise 3), then score descending, then createdAtSource descending, then signalId; returns the items with rank 1..n. This tier-first ordering means noise and venting can never outrank a buyer.

Golden test values (assert these; use toBeCloseTo with 2 decimals for contributions and exact equality for totals):
 - Case A: passed = states_problem, asks_for_recommendation, names_competitor; fit = { competitorMentioned: true, purchaseLanguage: true, teamOrRoleContext: false }; ageDays 30; commentCount 3; upvotes 7. Expect intent value 0.70 (contribution 28.00), fit 0.6667 (16.67), recency 0.5 (10.00), engagement 0.4541 (6.81), total 61.
 - Case B: nothing passed, all fit false, ageDays 0, commentCount 0, upvotes 0. Expect contributions 0, 0, 20.00, 0 and total 20.
 - Case C: commentCount 100, upvotes 0: engagement value is exactly 1 (capped), contribution 15.00.
 - Case D: ageDays 60 gives recency 0.25.
 - computeConfidence(2, 1) = 0.6667 (toBeCloseTo), computeConfidence(0, 0) = null, computeConfidence(3, 0) = 1.

### 23.5 Lead store and score stage
- apps/api/src/db/leads.ts: interface LeadStore plus a supabase-backed factory (so it can be faked): `getScoringContext(runId)` returns { seller (productName, problemDescription, competitors), items } where each item = { signal: id, text, source, community, url, authorHandle, createdAtSource, engagement }, plus the classifier decision for THIS run with status 'ok' (output with label, criteria, rationale, notes; evidence_verified); `saveLeads(runId, rows)`; `listLeads(runId, includeAll)` returning LeadView[].
- saveLeads upserts on (run_id, signal_id) (onConflict string 'run_id,signal_id') with columns run_id, signal_id, label, score, score_breakdown, rank. It must NOT send `status`, so an existing lead keeps its status on re-scoring. score_breakdown is stored as { components, total, confidence, enrichment }.
- `createScoreStage({ store, now?, config? })` returns `ScoreStage = (runId) => Promise<ScoreSummary>` where ScoreSummary = { scored: number, ranked: number, topScore: number | null } (ranked = leads labelled buyer_intent or competitor_complaint; topScore = the highest score among those, else null). It loads the context, enriches and scores each item (passedCriteria = criteria with passed true), ranks all items, saves them. No items gives { 0, 0, null } and saves nothing.
- Types in packages/shared: LeadView = { leadId, signalId, rank, label, score, confidence: number | null, status: 'new' | 'accepted' | 'rejected', source, url, authorHandle, community: string | null, createdAtSource, textPreview (first 280 chars), rationale, criteria: [{ id, passed, quote: string | null }], evidenceVerified, breakdown: ScoreBreakdown, enrichment: Enrichment }.

### 23.6 Pipeline integration (apps/api/src/orchestrator/runPipeline.ts)
- PipelineDeps gets an OPTIONAL `score?: ScoreStage`. Without it behaviour is exactly as before (all existing tests pass unchanged).
- It runs only when classification ran and (classified + reused) > 0, after the classifier events and before the final status. Events, in order: agent 'enricher' progress `Enriching ${n} classified signal(s)` with counts { total: n } where n = classified + reused; then the stage runs; then enricher info `Enriched ${scored} signal(s)` with counts { enriched: scored }; scorer progress `Scoring ${scored} signal(s)` with counts { total: scored }; scorer info `Scored ${scored} signal(s): ${ranked} in the ranked list` with counts { scored, ranked, topScore }; when ranked is 0 also a scorer warning `No buyer intent or competitor complaint signals in this run`.
- If the stage throws: scorer error `Scoring failed: ${message}` (message via instanceof Error) and continue. Run status: a run that would be 'completed' becomes 'completed_with_warnings' only when the stage threw. Having zero ranked signals does not change the status.

### 23.7 API (routes/runs.ts, wiring in index.ts)
- `GET /runs/:runId/leads?include=all`: same runId validation and error bodies as the other routes. `include` is optional; the only valid value is 'all', anything else gives 400 { error: 'Invalid include' }. Default returns only labels buyer_intent and competitor_complaint; include=all returns every label. Ordered by rank ascending, at most 100. Answer 200 { leads: LeadView[] }.
- index.ts builds the lead store and score stage and passes `score` into the router deps. If creating them fails the server must still start and runs must complete without scoring.

### 23.8 Web (small)
- PipelineProgress: Enricher and Scorer become live stages with the same badge rules as the Classifier (no events and run running: Waiting; final info event: Completed (Completed with warnings if that stage emitted a warning or error); events but no final: Running; run finished with no events for that stage: Skipped). Summary lines: Enricher shows "N enriched"; Scorer shows "N scored Â· M in the ranked list" from the last scorer info event counts. Update the existing stage tests accordingly.
- RunPage result note becomes: "The ranked list with evidence is the next screen to be built."

### 23.9 Files
packages/shared/src/types.ts, config/scoring.ts, config/enrich.ts, agents/enricher.ts, scoring/computeScore.ts, agents/scorer.ts, db/leads.ts, orchestrator/runPipeline.ts, routes/runs.ts, index.ts, web PipelineProgress.tsx and RunPage.tsx, plus tests.

---

## 24. Phase 6: Inbox and Signal detail (added October 2026)

These rules override earlier sections where they conflict.

### 24.1 Scope and decisions
- No LLM calls, no migration, no new packages. The score is shown ONLY for ranked labels (buyer_intent, competitor_complaint). For venting and noise the UI shows the label and the text "Not ranked" and never a numeric score or score breakdown (a noise post can score above 0 because of recency and engagement; showing it would mislead). The stored data is unchanged.
- The word for a result is "signal" in all UI text. Never write "lead" in user-visible text.

### 24.2 Shared (packages/shared)
- FeedbackRequestSchema = z.object({ action: z.enum(FEEDBACK_ACTIONS) }); types FeedbackRequest, EvidenceSpan = { criterion: CriterionId; quote: string; start: number; end: number } (offsets into the full post text, end exclusive), DecisionTrace = { model: string | null; promptVersion: string | null; createdAt: string; status: string; output: Record<string, unknown> }, LeadDetail = { lead: LeadView; runId: string; text: string; evidence: EvidenceSpan[]; discardedQuotes: number; trace: DecisionTrace }.

### 24.3 API
- verification/verifyQuote.ts: export `normalizeWithMap(text): { normalized: string; map: number[] }` using EXACTLY the same normalisation as verifyQuote (lowercase, collapse whitespace runs to one space, curly quotes and en/em dashes to ASCII, trim) where map[i] is the index in the ORIGINAL text of normalized character i. Refactor verifyQuote to use it without changing its behaviour (existing tests must pass unchanged). Export `findEvidenceSpans(text, evidence: Array<{ criterion; quote }>): EvidenceSpan[]`: for each quote find it in the normalized text (first occurrence) and convert to original offsets: start = map[idx], end = map[idx + normalizedQuoteLength - 1] + 1; skip quotes that are not found; return spans sorted by start.
- db/leads.ts (LeadStore, plus the fake-able interface): add `getLeadDetail(leadId): Promise<LeadDetail | null>` (joins leads, signals.text_snapshot and the classifier decision of that lead's run and signal; discardedQuotes = length of decision output.notes.unverified, 0 if missing; evidence offsets via findEvidenceSpans over the criteria with passed true; trace from the decision row), `setLeadStatus(leadId, status): Promise<boolean>` (false when no row matched) and `addFeedback(leadId, action): Promise<void>` (insert into the existing `feedback` table: lead_id, action).
- New routes/leads.ts exporting createLeadsRouter(deps); mount it in index.ts like the runs router. UUID validation and error bodies like the other routes (400 { error: 'Invalid lead id' }, 404 { error: 'Lead not found' }, 500 { error: 'Internal error' } with the message logged via instanceof Error).
  - `GET /leads/:leadId` answers 200 { detail: LeadDetail }.
  - `POST /leads/:leadId/feedback` validates the body with FeedbackRequestSchema (400 { error: 'Invalid request', issues } using `.issues`), maps accept to 'accepted', reject to 'rejected', reset to 'new', calls setLeadStatus (false gives 404), then addFeedback, and answers 200 { status }.
- If creating these fails at startup the server must still start.

### 24.4 Web routes (apps/web/src/app/routes.tsx)
Add `{ name: 'signals', runId }` for `#/runs/<uuid>/signals` and `{ name: 'signal', runId, leadId }` for `#/runs/<uuid>/signals/<uuid>`. Existing routes keep working; parseHash stays pure and tested. RunPage shows a primary button "View signals" (link to the signals route) once the run is no longer running and signalCount > 0.

### 24.5 Inbox page (pages/InboxPage.tsx, components/SignalCard.tsx, lib/inbox.ts)
- Loads GET /runs/:runId/leads?include=all once (api.ts gets getLeads and getLeadDetail and sendFeedback). Page header: product name from getRun, run id short, counts: "N buying signals, M other signals".
- Default view lists only buyer_intent and competitor_complaint signals in rank order. A toggle "Show other signals (venting, noise)" adds the rest below them. Filters: label (All, Buyer intent, Competitor complaint, Venting, Noise), status (All, New, Accepted, Rejected), minimum score (number; applies only to ranked labels). The filter and sort logic lives in lib/inbox.ts as pure, tested functions.
- Card: rank, label badge (text, not colour only), score badge only for ranked labels else the text "Not ranked", confidence as "Evidence check: X%" when not null, source and community, @handle, age ("34 days ago" via a pure formatAge), the model's one-line summary (rationale), a link "Open original post" (target _blank, rel noopener noreferrer), and a link to the detail page. Rejected cards are dimmed with a "Rejected" text badge; accepted show "Accepted".
- States: loading; error with retry (ErrorState); no signals at all ("No signals were scored for this run yet"); none in the default view while others exist ("No buying signals in this run. N other signals were classified as venting or noise." plus a button that turns the toggle on).

### 24.6 Signal detail page (pages/SignalDetailPage.tsx, components/EvidenceQuote.tsx, CriteriaChecklist.tsx, ScoreBreakdown.tsx, ReasoningTrace.tsx, lib/evidence.ts)
- Back link to the inbox. Header: label badge, "Rank N" and the score ONLY for ranked labels, status badge, @handle, source, community, age, and "Open original post". A short note near it: "Vantage shows public posts only. It does not provide contact details or send messages."
- Post text with each evidence span wrapped in <mark> (title and aria-label = the criterion name). lib/evidence.ts exports a pure `segmentText(text, spans)` returning ordered { text, highlighted, criterion? } segments, merging overlapping spans and ignoring invalid offsets (negative, past the end, start >= end). Preserve line breaks (white-space: pre-wrap).
- "Summary (written by the model)": the rationale, visibly distinct from evidence. Under it, when discardedQuotes > 0: "N quote(s) from the model could not be found in the post and were discarded."
- CriteriaChecklist: all five criteria with "Passed" or "Not passed" as text and the verified quote when passed. ScoreBreakdown (ranked labels only): a table of component, value (percent), weight, points, and the total; the total equals the stored score. For other labels show "Not ranked: this signal was not classified as a buying signal, so it is not scored."
- A facts panel from enrichment: competitors mentioned, purchase terms found, team terms found, age in days, comments, upvotes.
- Buttons Accept, Reject, Reset call the feedback endpoint (disabled while pending, error shown with ErrorState, status badge updates on success; the inbox reflects it after a reload).
- ReasoningTrace: a native <details> element "Raw trace" with model, prompt version, timestamp, status and the output JSON pretty-printed in a <pre>.
- States: loading, error with retry, 404 shows "Signal not found".

### 24.7 Styling and accessibility
Plain CSS added to src/styles/tokens.css using the existing variables (no new libraries, no Tailwind). Keyboard reachable controls with visible focus, labels on every control, never colour alone, `prefers-reduced-motion` respected, works down to 360px width.

### 24.8 Files
API: verification/verifyQuote.ts, db/leads.ts, routes/leads.ts, index.ts, packages/shared (types.ts, schemas.ts). Web: app/routes.tsx, app/App.tsx, lib/api.ts, lib/format.ts (formatAge, label text), lib/inbox.ts, lib/evidence.ts, pages/InboxPage.tsx, pages/SignalDetailPage.tsx, pages/RunPage.tsx, components/SignalCard.tsx, EvidenceQuote.tsx, CriteriaChecklist.tsx, ScoreBreakdown.tsx, ReasoningTrace.tsx, styles/tokens.css, plus tests.

## 25. Phase 6.1 fixes

The classifier's `classified` count includes reused decisions, so enricher progress uses that count directly and scoring runs only when it is greater than zero. Rank badges appear only for buyer-intent and competitor-complaint signals, and the no-ranked-signals scorer event is informational so the stage completes normally. Signal cards show “Quotes verified” at full confidence, “Some quotes could not be verified” below full confidence, and no verification wording when confidence is unavailable.

---

## 26. Phase 7A: sample dataset source, source selection, evaluation (added October 2026)

These rules override earlier sections where they conflict.

### 26.1 Decision and honesty rules
Live Hacker News search returns almost no real buyers for B2B tools, so a SYNTHETIC labelled dataset (`fixtures/sample-signals.json`, written by the human) is added as source `snapshot`. It is for demos and evaluation only. Every place that shows a snapshot signal must say it is sample data, and it must never look like a real post: no “Open original post” link, a visible “Sample data” badge, and the source name “Sample dataset (synthetic)”. No LLM calls in the adapter. No new packages, no migration.

### 26.2 Shared
- `RunParamsSchema` gains an optional `sources: z.array(z.enum(SOURCE_IDS)).min(1).optional()` (existing tests and demo params stay valid). Everything that infers `RunParams` picks it up.
- `SampleDatasetSchema` (shared, exported): `{ synthetic: z.literal(true), description: string, expectedCounts: record of numbers, items: array of { id: string, authorHandle: string, community: string, text: string (min 20), daysAgo: int >= 0, engagement: { score: number, comments: number }, expectedLabel: enum LEAD_LABELS, note: string } }`. Type `SampleDataset`.

### 26.3 Adapter (`apps/api/src/sources/snapshot.ts`)
`createSnapshotAdapter({ readFile?, path? })` returns a `SourceAdapter` with id `snapshot`. It reads `fixtures/sample-signals.json` with `readFileSync` via `fileURLToPath(new URL(...))` like `config/demo.ts` does (injectable for tests), validates with `SampleDatasetSchema`, and returns up to `query.maxResults` items in file order as `RawSignal`: source `snapshot`, externalId = item.id, authorHandle, community, url = `sample://signal/${id}`, text, createdAt = (`ctx.now()` minus daysAgo days) as ISO string, engagement. It ignores keywords and sinceDays (document this in a comment). A missing or invalid file gives `{ signals: [], status: 'failed', error: <message via instanceof Error> }`; never throws. Register it in `sources/index.ts` under `snapshot` and set `SOURCE_CONFIG.enabled.snapshot` to true.

### 26.4 Source selection (`routes/runs.ts`, `orchestrator/runPipeline.ts`)
- `POST /runs`: when `params.sources` is present, every id must belong to a registered adapter (use the adapter list in deps). Otherwise answer `400 { error: 'Invalid request', issues: ['params.sources: <id> is not available'] }`.
- `runPipeline`: adapters used for a run are `params.sources ? adapters.filter(a => params.sources.includes(a.id)) : adapters.filter(a => a.id !== 'snapshot')`. Without `sources`, a run behaves as before (sample data is never included by default). If the filtered list is empty, use the existing “No sources are enabled” path. All existing pipeline tests pass unchanged.

### 26.5 Web: honesty and selection
- `lib/format.ts`: `SOURCE_LABEL.snapshot` becomes “Sample dataset (synthetic)”.
- `SetupPage`: the Sources panel has real controls: a checked, enabled checkbox “Hacker News” (live); an unchecked checkbox “Sample dataset (synthetic)” with the hint “Labelled test posts written for Vantage. They are not real posts and ignore your keywords.” Reddit, Developer forums and Review sites stay as read-only “Unavailable” rows. The request sends `params.sources` as the checked ids; at least one must be checked (inline error otherwise). “Load demo seller” does not change the checkboxes.
- `SignalCard` and the signal detail header show a “Sample data” badge for source `snapshot` and replace “Open original post” with the plain text “Sample post (not a real link)”. The detail page also shows a one-line note: “This is a synthetic sample post written for testing.” RunPage's source list uses the new label.
- Update or add component tests accordingly (badge present for snapshot, absent for Hacker News; link absent for snapshot; setup request includes sources).

### 26.6 Evaluation script
- Pure metrics in `apps/api/src/evaluation/metrics.ts`: `confusionMatrix(pairs: Array<{ expected: LeadLabel; predicted: LeadLabel }>)` returns counts[expected][predicted] for all four labels; `perLabelStats(matrix)` returns precision, recall and support per label (0 when the denominator is 0, never NaN); `accuracy(pairs)`.
- Script `apps/api/src/scripts/eval-sample.ts`, npm scripts `eval:sample` in `apps/api/package.json` and root `package.json` (same style as `scout`; these two script entries are the only package.json changes allowed). Options via `node:util` `parseArgs`: `--limit N` (default 36). It loads the repo-root `.env` like `llm-check.ts` does, builds the LLM client from env (`config/llm.ts`), loads the sample dataset and demo seller (`loadDemoSeller`), and for each item (sequentially) builds the classifier prompt (current prompt version), calls the client with `ClassifierOutputSchema`, then `finalizeClassification` against the item's text. It never touches the database. Print one line per item: id, expected, predicted (or FAILED with sanitized reason), a mark, and “quote-check: ok” or “quote-check: N discarded”. Then print accuracy, the 4x4 confusion matrix, per-label precision, recall and support, counts of failed items and discarded quotes, and predicted labels of injection items s32 and s33 with an explicit line stating whether either was labelled buyer_intent. Failed items are excluded from the matrix and reported separately. Exit code 1 when more than half the items failed. Never print keys, prompts or full post text.

### 26.7 Files
Shared: `packages/shared` (`schemas.ts`, `types.ts`). API: `sources/snapshot.ts`, `sources/index.ts`, `config/sources.ts`, `routes/runs.ts`, `orchestrator/runPipeline.ts`, `evaluation/metrics.ts`, `scripts/eval-sample.ts`, `apps/api/package.json` and root `package.json` (script entries only). Web: `lib/format.ts`, `pages/SetupPage.tsx`, `pages/SignalDetailPage.tsx`, `components/SignalCard.tsx`, plus tests. `fixtures/sample-signals.json` is not to be edited.

---

## 27. Phase 8A: report page and export (added October 2026)

These rules override earlier sections where they conflict.

### 27.1 Scope and rules
No LLM calls, no migration, no new packages. The user-visible word is "signal", never "lead". Sample data is always disclosed (section 26). Nothing in the report may suggest that Vantage provides contact details or sends messages.

### 27.2 Shared types (packages/shared)
ReportView = { generatedAt: string; run: RunView; summary: { signalsFound: number; buyingSignals: number; byLabel: Record<LeadLabel, number>; sampleData: boolean }; method: { weights: Record<'intent' | 'fit' | 'recency' | 'engagement', number>; recencyHalfLifeDays: number; promptVersion: string }; signals: LeadView[] }. `signals` holds every scored signal of the run in rank order. buyingSignals counts buyer_intent and competitor_complaint. sampleData is true when any signal or run source is 'snapshot'.

### 27.3 CSV (apps/api/src/report/csv.ts, pure functions)
`toCsv(rows: Array<Array<string | number | null>>): string`:
- Fields containing a comma, double quote, CR or LF are wrapped in double quotes with inner quotes doubled; line endings are CRLF; the output starts with a UTF-8 BOM (\uFEFF); null becomes an empty field; numbers are written as is.
- Spreadsheet formula injection defence: a STRING cell whose first character is =, +, -, @, tab or carriage return is prefixed with a single quote (') before quoting. Numbers and null are never altered.
`buildReportCsv(report: ReportView, includeAll: boolean): string` returns the header row exactly: rank, label, score, confidence_percent, status, source, community, author, posted_at, age_days, link, summary, evidence_quotes, criteria_passed, competitors_mentioned, purchase_terms, team_terms, comments, upvotes, data_origin, post_preview. Rows follow rank order. Only buyer_intent and competitor_complaint signals unless includeAll. For labels that are not ranked, rank, score and confidence_percent are empty. confidence_percent is the integer percent or empty when null. link is the original post URL for real sources and EMPTY for source 'snapshot'. data_origin is "live" or "sample (synthetic)". evidence_quotes joins the quotes of passed criteria with " | ". criteria_passed joins criterion ids with ";". The three term columns join with ";". post_preview is the stored text preview.

### 27.4 Endpoints (apps/api/src/routes/report.ts, mounted in index.ts; the server must still start if creating them fails)
Same runId validation and error bodies as the other routes. `GET /runs/:runId/report.json` returns 404 { error: 'Run not found' } when missing; 409 { error: 'Run is still running' } while status is 'running'; otherwise 200 ReportView (run from the run store, signals from the lead store with include all). `method.weights` comes from SCORE_WEIGHTS, recencyHalfLifeDays from config/scoring.ts, promptVersion from config/llm.ts. `GET /runs/:runId/report.csv?include=all` has the same 400, 404 and 409 behaviour; `include` is optional and the only valid value is 'all' (anything else 400 { error: 'Invalid include' }). Success is 200 with Content-Type "text/csv; charset=utf-8" and Content-Disposition `attachment; filename="vantage-report-<first 8 chars of run id>.csv"`, body from buildReportCsv. Build the report with one shared function `buildReport(runStore, leadStore, runId)` returning ReportView | 'not_found' | 'running'.

### 27.5 Web (apps/web)
Add route `{ name: 'report', runId }` for `#/runs/<uuid>/report` (parseHash stays pure and tested), "View report" buttons on the Inbox header and RunPage next to "View signals" after the run is finished with signals. Add `getReport(runId)` for `/api/runs/<id>/report.json`; CSV links are `/api/runs/<id>/report.csv` and `/api/runs/<id>/report.csv?include=all`.

ReportPage order: (1) header "Signal report: <product name>", generated time, short run id, search terms and window, source list with Sample label where relevant; show the banner "This report includes synthetic sample data written for testing. Those signals are not real posts." when `summary.sampleData` is true. (2) Summary numbers for signals found, buying signals, counts per label. (3) "Ranked signals": buyer_intent and competitor_complaint in rank order with rank, label, score, "Quotes verified" / "Some quotes could not be verified", source, community, @handle, age, original link (plain "Sample post (not a real link)" for snapshot), "Summary (written by the model)", verified evidence quotes with criterion names, a compact score table (component, points, total), and a facts line (competitors mentioned, purchase terms). If none, show EmptyState "No buying signals in this run" with a sentence saying others were classified as venting or noise. (4) "Other signals": compact table of label, source, handle, age, summary, with "Not ranked" instead of a score. (5) "How to read this report": quotes were checked in code against stored post text; summary is model-written and is not evidence; score combines intent, fit, recency and engagement with `method.weights` rendered as percentages and the recency half-life; Vantage shows public posts only and does not provide contact details or send messages. (6) Buttons "Download CSV", "Download CSV with all signals", "Print or save as PDF" (`window.print()`), "Back to signals".

States: loading, ErrorState with retry, running message "The report is available when the run has finished", and 404 "Run not found". Add a print block in tokens.css hiding app header, footer, nav, buttons and button-styled links; use white background, black text, 11pt; `break-inside: avoid` on signal cards and tables; show external URLs after links only in report container; keep the sample banner visible. No new libraries.

### 27.6 Files
packages/shared (types.ts), report/csv.ts, routes/report.ts, index.ts, web: app/routes.tsx, app/App.tsx, lib/api.ts, pages/ReportPage.tsx, pages/InboxPage.tsx, pages/RunPage.tsx, styles/tokens.css, plus tests. Do not touch fixtures.

---

## 28. Phase 8B: demo replay mode (added October 2026)

These rules override earlier sections where they conflict.

### 28.1 Purpose and honesty
With DEMO_MODE=true the API serves a previously recorded run from fixtures/demo-run.json. It makes no Supabase, LLM, Hacker News or other network calls. POST /runs replays the recording instead of searching. Every page shows a banner saying so, including when printed. The recording is real output of an earlier run (it may contain sample data, which stays labelled as such). Replay must never be presented as a live run. No new packages, no migration.

### 28.2 Fixture schema (apps/api/src/demo/schema.ts, Zod)
DemoRunSchema = { version: literal 1, recordedAt: ISO string, note: string, run: RunView-shaped object, events: Array<{ id, agent, kind, message, counts (record or null), createdAt, offsetMs: int >= 0 }>, leads: LeadView-shaped array (every label, recorded order), details: record of leadId to LeadDetail-shaped object }. Build it from small Zod schemas that mirror the shared types, reusing the constants (LEAD_LABELS, AGENTS, EVENT_KINDS, RUN_STATUSES, SOURCE_STATUSES, SOURCE_IDS, CRITERION_IDS). A refinement requires every lead id to have an entry in details. The inferred output types must be assignable to the shared RunView, RunEvent, LeadView and LeadDetail (add compile-time assignment checks in the tests).

### 28.3 Recording script
apps/api/src/scripts/demo-record.ts with npm scripts "demo:record" in apps/api/package.json and the root package.json (same style as "scout"; these two script entries are the only package.json changes allowed). Options via node:util parseArgs: --run <uuid> (required, validated with the UUID pattern used elsewhere), --out (default fixtures/demo-run.json relative to the repo root). It loads the repo-root .env like the other scripts, builds the database client and stores (createRunStore, createLeadStore), refuses with a clear message when the run is not found or its status is 'running', reads the run (getRun), ALL events (loop listEvents with after = last id until it returns none), all leads (listLeads(runId, true)) and the detail of each lead (getLeadDetail), then builds the fixture with a pure exported function `buildDemoFixture(input)`: offsetMs = max(0, Date.parse(event.createdAt) - Date.parse(run.startedAt)); events sorted by id; note = `Recorded from run ${first 8 chars of run id}`. It validates with DemoRunSchema, writes pretty-printed JSON with a trailing newline, and prints counts (events, leads, details). Never print keys.

### 28.4 Replay (apps/api/src/demo/replay.ts)
`createReplay({ fixture, now?: () => number, maxTotalMs?: number }): { runStore: RunStore; leadStore: LeadStore }` (the existing interfaces from db/runs.ts and db/leads.ts). Replay never touches the network or a database.
- Clock: replayStart is null until runStore.createRun is called; calling createRun again restarts it. totalMs = (largest event offsetMs) + 1500. scale = totalMs > maxTotalMs (default 30000) ? maxTotalMs / totalMs : 1. An event is visible when offsetMs * scale <= elapsed; the run is finished when elapsed >= totalMs * scale. While replayStart is null (a recorded run URL opened directly) behave as finished.
- runStore: createSellerProfile returns a fixed placeholder uuid; createRun(sellerProfileId, params) (re)starts the clock and returns the recorded run id; getRun(runId) returns null for any other id, otherwise the recorded RunView with status 'running' until finished and then the recorded status, startedAt = replayStart as ISO, finishedAt only when finished, signalCount 0 and sources shown as status 'running' with fetchedCount 0 until finished, then the recorded values; listEvents(runId, afterId) returns the visible events with id greater than afterId (createdAt rewritten to replayStart plus the scaled offset); setRunStatus, upsertRunSource and addEvent are no-ops; storeSignals returns { inserted: 0, updated: 0 }; failStaleRuns returns 0.
- leadStore: listLeads(runId, includeAll) from the fixture leads (default only buyer_intent and competitor_complaint) and getLeadDetail(leadId) from details, both honouring in-memory status changes; setLeadStatus and addFeedback only update an in-memory status map (nothing is persisted; setLeadStatus returns false for an unknown lead); getScoringContext and saveLeads throw new Error('Not available in demo mode'). A run id other than the recorded one gives an empty list or null.

### 28.5 Wiring
- PipelineDeps gets optional `runner?: (deps: PipelineDeps, runId: string, params: RunParams) => Promise<void>` and optional `demoMode?: boolean`. POST /runs in routes/runs.ts calls `(deps.runner ?? runPipeline)(deps, runId, params)`; when demoMode is true it skips the params.sources availability check. Without these fields behaviour is exactly as before (all existing tests pass unchanged).
- index.ts: when env.DEMO_MODE is true, read and validate fixtures/demo-run.json (readFileSync via fileURLToPath like config/demo.ts). If it is missing or invalid print "Demo mode needs fixtures/demo-run.json. Record one with: npm run demo:record -- --run <run id>" plus the validation message and exit with code 1. Otherwise build the replay and use its stores for the runs, leads and report routers with adapters [], demoMode true and a runner that does nothing. In demo mode do not create the Supabase client, the LLM client, the classify stage or the score stage, do not mount the decisions route and skip failStaleRuns. When DEMO_MODE is false everything is unchanged. `GET /health` answers { status: 'ok', demo: boolean }.

### 28.6 Web
- api.ts: getHealth() returning { status, demo }. A new component DemoBanner, rendered at the top of App above the header, appears only when demo is true: "Demo mode: you are viewing a recorded run. No live search or AI calls are being made." (role="status"). If the health call fails, show nothing and no error.
- The banner stays visible when printing (styles in tokens.css).
- ReportPage "How to read this report" gains one sentence: "Buying-intent signals are listed before competitor complaints; within each group, signals are ordered by score."

### 28.7 Files
apps/api/src/demo/schema.ts, demo/replay.ts, scripts/demo-record.ts, orchestrator/runPipeline.ts (PipelineDeps), routes/runs.ts, index.ts, apps/api/package.json and root package.json (script entries only), web lib/api.ts, components/DemoBanner.tsx, app/App.tsx, pages/ReportPage.tsx, styles/tokens.css, plus tests. Do not create or edit fixtures/demo-run.json (the human records it).

---

## 29. Phase 7B: Stack Exchange source (added October 2026)

These rules override earlier sections where they conflict.

### 29.1 Scope and decisions
New live source id 'stackexchange', label "Stack Exchange", using the official Stack Exchange API v2.3 (host api.stackexchange.com). No scraping, no new packages, no migration (signals.source is free text). Each question (title plus body) becomes one RawSignal. Answers and comments are out of scope. Default site: softwarerecs (Software Recommendations).

### 29.2 Verify before coding
Check the OFFICIAL documentation (api.stackexchange.com/docs) for: the /search/advanced endpoint and its parameters (q, site, sort, order, fromdate, pagesize, page, filter, key), the built-in "withbody" filter, the response fields you use (items[].question_id, title, body, link, creation_date, score, answer_count, owner.display_name, plus quota_remaining, quota_max, has_more, backoff, and the error fields error_id, error_name, error_message), gzip responses, and the key and quota rules. If any assumption below differs from the documentation, STOP and report the difference before coding.

### 29.3 Adapter (apps/api/src/sources/stackexchange.ts)
`createStackExchangeAdapter({ key?, sites?, sleep? })` returns a SourceAdapter with id 'stackexchange'. Defaults: key from env STACKEXCHANGE_KEY (optional), sites from env STACKEXCHANGE_SITES (optional comma list; each must match /^[a-z0-9.]+$/; invalid entries are dropped; empty gives ['softwarerecs']; at most 3 sites), sleep = setTimeout promise (injectable for tests).
- search(query, ctx): if no keywords return { signals: [], status: 'skipped', error: 'No keywords provided' }. For each site, then each keyword (in order), make ONE request with fetchWithRetry (headers: User-Agent from ctx, Accept application/json) to /2.3/search/advanced with q=<keyword>, site=<site>, sort=relevance, order=desc, fromdate=<unix seconds of now minus sinceDays>, pagesize=min(maxResults, 100), page=1, filter=withbody, and key=<key> only when configured. (The Stack Exchange app key is a public application identifier that the API requires as a query parameter; this is the one allowed exception to "keys never go in URLs". Never log the URL with the key.)
- Mapping (pure exported function mapQuestion(item, site)): skip items without question_id, link or a non-empty owner.display_name; authorHandle = htmlToText(owner.display_name); community = site; url = item.link; text = htmlToText(title) + two newlines + htmlToText(body) (title only when the body is empty); createdAt = ISO string of creation_date * 1000; engagement { score: item.score, comments: item.answer_count }; externalId = `${site}:${question_id}`; skip texts shorter than 20 characters; validate every signal with RawSignalSchema.safeParse and drop failures.
- Dedupe by externalId across keywords and sites; stop when query.maxResults signals are collected.
- Quota and backoff: after every response read `backoff` (seconds): if present wait exactly that many seconds with the injected sleep before the next request. If backoff is larger than 60 seconds, do not wait; stop sending requests for this run, keep what you have, and set status 'degraded' with error `Stack Exchange asked for a ${backoff}s backoff; stopped early`. If quota_remaining is below 10 stop sending requests, keep what you have, and set status 'degraded' with error `Stack Exchange quota nearly used (${quota_remaining} left)`.
Backoff clarification: wait the full interval up to 60 seconds; for larger intervals, stop requests for this run and return degraded.
- Errors: a non-2xx response, a JSON body with error_id, or a body that is not an object with an items array counts as a failed request (first message kept, never including the key). Status rules as in the Hacker News adapter: no failed requests gives 'ok', some failed gives 'degraded', all failed gives 'failed'. Never throw out of search().
- Register it in sources/index.ts (ADAPTERS and the enabled config: SOURCE_CONFIG.enabled.stackexchange = true). Runs without `params.sources` keep their current behaviour of using every registered adapter except 'snapshot'; so, with this change, the default includes Stack Exchange.

### 29.4 Shared and config
- packages/shared constants: add 'stackexchange' to SOURCE_IDS (at the end). Update everything that is typed on SourceId (labels, records) so the typecheck passes.
- config/env.ts: add optional STACKEXCHANGE_SITES (empty string means unset). .env.example gets `STACKEXCHANGE_SITES=` after the STACKEXCHANGE_KEY line.

### 29.5 Dev CLI
apps/api/src/scripts/scout-cli.ts gains an option `--sources <comma list of source ids>` (validated against the registered adapters; unknown id prints an error and exits 1). Without it, behaviour is unchanged.

### 29.6 Web
- lib/format.ts: SOURCE_LABEL.stackexchange = 'Stack Exchange'.
- SetupPage Sources panel: add a checkbox "Stack Exchange (Software Recommendations)" checked by default, hint "Questions where people ask for software recommendations." The request's params.sources lists the checked ids (HN and Stack Exchange both default to checked).
- Footer: add one line, shown on every page: "Stack Exchange posts are shared under CC BY-SA; each signal links to its source." Before using this wording verify the license terms on Stack Exchange's own site (the licence and attribution requirements) and adjust the sentence to be accurate.
- Signals from 'stackexchange' show "Open original post" like Hacker News ones (real link, no sample badge).

### 29.7 Files
sources/stackexchange.ts, sources/index.ts, config/sources.ts, config/env.ts, scripts/scout-cli.ts, .env.example, packages/shared constants and anything the typecheck requires, web lib/format.ts, SetupPage.tsx, App.tsx (footer), README.md and docs/LIMITATIONS_AND_ETHICS.md (documentation updates, Step 6), plus tests.

---

---

## 30. Phase 7C: request log and provenance (added October 2026)

These rules override earlier sections where they conflict.

### 30.1 Scope
Record every outbound DATA request made by a source adapter during a run (not LLM calls), and show where each signal came from and which requests failed. No new packages. No secrets, keys or full URLs are ever stored or shown.

### 30.2 Database (human runs it)
New file supabase/migrations/0003_source_requests.sql:

```sql
create table source_requests (
  id bigserial primary key,
  run_id uuid not null references runs(id) on delete cascade,
  source text not null,
  label text not null,
  status text not null check (status in ('ok','failed','skipped')),
  http_status int,
  duration_ms int not null default 0,
  items_returned int not null default 0,
  error text,
  quota_remaining int,
  created_at timestamptz not null default now()
);
create index source_requests_run_id_idx on source_requests (run_id);
alter table source_requests enable row level security;
```

### 30.3 Shared and adapter context
- packages/shared: type RequestRecord = { source: SourceId; label: string; status: 'ok' | 'failed' | 'skipped'; httpStatus: number | null; durationMs: number; itemsReturned: number; error: string | null; quotaRemaining: number | null } and SourceRequestView = RequestRecord & { id: number; createdAt: string }.
- AdapterContext (sources/types.ts) gains optional `onRequest?: (record: RequestRecord) => void`. Every adapter calls it EXACTLY once per outbound request or fixture read: hackernews (label = the keyword), stackexchange (label = `${site}: ${keyword}`), snapshot (label 'fixture file', itemsReturned = items served). durationMs is measured with ctx.now() before and after the request (never negative); itemsReturned is the number of RAW items in the response before filtering; httpStatus is null for network errors and for the snapshot; quotaRemaining only where the API reports it (Stack Exchange), else null. A failed request has status 'failed' and a sanitized error. Adapters keep their existing return values and statuses; when `onRequest` is absent nothing changes.
- New pure util utils/redact.ts: `sanitizeRequestError(message: string): string` removes every `key=...`, `api_key=...`, `token=...`, `access_token=...` and `Authorization: ...` fragment, strips query strings from any URL (keep scheme, host and path), redacts tokens that look like AIza..., gsk_... or long hex or base64 strings, collapses whitespace and truncates to 200 characters. All error texts stored in a RequestRecord pass through it.

### 30.4 Storage and pipeline
- RunStore (db/runs.ts) gains `saveSourceRequests(runId, records): Promise<void>` (one batch insert; no-op for an empty list) and `listSourceRequests(runId): Promise<SourceRequestView[]>` (ordered by id, at most 200). Update the supabase store, the replay store and every fake store in the tests.
- runPipeline: pass `ctx = { ...deps.ctx, onRequest }` to runScout, where onRequest pushes into an array (keep at most 200 records). After runScout returns, call store.saveSourceRequests; if it throws, emit a scout warning `Could not save the request log` and continue (it never changes the run status). Existing events and tests are unchanged.

### 30.5 API
- `GET /runs/:runId/requests` (routes/runs.ts): same runId validation and error bodies as the other routes; 404 { error: 'Run not found' } when the run does not exist; 200 { requests: SourceRequestView[] }.
- ReportView gains `summary.bySource: Record<string, number>` (signals per source among the scored signals of the run) and `sources: Array<{ source: SourceId; requestsOk: number; requestsFailed: number; itemsReturned: number; signalsKept: number; errors: string[] }>` built from the request log (errors = distinct sanitized messages, at most 5 per source). buildReport reads runStore.listSourceRequests. Update ReportView, the JSON endpoint and every test that builds a report.

### 30.6 Demo recording and replay
- demo/schema.ts: the recorded fixture gets an optional `requests` array (default [] when absent) of SourceRequestView-shaped objects, so the existing fixtures/demo-run.json stays valid. scripts/demo-record.ts reads listSourceRequests and stores them. demo/replay.ts serves them from listSourceRequests, revealing each request when the replay clock passes the Scout stage (simple rule: show all requests once any Scout event is visible).

### 30.7 Web
- lib/api.ts: getRequests(runId). hooks/useRunEvents.ts also fetches the request log on each poll tick (and once more at the final drain) and returns it.
- New component SourceActivity (components/SourceActivity.tsx), shown on the Run page between the Pipeline card and the Result card, title "Source activity": one row per source with source label, "requests ok / failed", items returned, average duration in ms, latest quota remaining (when present) and signals kept (when the run is finished and the count is known from the request log; otherwise omit). Below it a native <details> "Request log" listing every request: source, label, status as TEXT (OK, Failed, Skipped), HTTP status, duration, items, and the sanitized error. Empty state: "No requests recorded for this run."
- Inbox: a "Source" filter (All plus one option per source present, with counts) implemented as a pure function in lib/inbox.ts that composes with the existing filters.
- ReportPage: new section "Data sources" after the summary: a table with the `sources` data (requests ok, failed, items returned, signals kept) and any errors listed under the table; the CSV is unchanged (it already has a source column).
- Styles in tokens.css using the existing variables.

### 30.8 Files
supabase/migrations/0003_source_requests.sql, packages/shared types, utils/redact.ts, sources/*.ts (hackernews, stackexchange, snapshot, types), db/runs.ts, orchestrator/runPipeline.ts, routes/runs.ts, routes/report.ts, demo/schema.ts, demo/replay.ts, scripts/demo-record.ts, web lib/api.ts, hooks/useRunEvents.ts, lib/inbox.ts, components/SourceActivity.tsx, pages/RunPage.tsx, pages/InboxPage.tsx, pages/ReportPage.tsx, styles/tokens.css, plus tests. Do not edit fixtures/demo-run.json or fixtures/sample-signals.json.

---

## 31. Phase 7D: Hacker News coverage and classification priority (added October 2026)

These rules override earlier sections where they conflict.

### 31.1 Problem observed in a live run
A run with 10 keywords and maxResults 50 searched only the FIRST keyword on Hacker News, because that keyword alone filled the cap and the loop stopped; the other nine were never requested. The request log showed one request, taking about 20 seconds because of a timeout and a retry.

### 31.2 Hacker News adapter (apps/api/src/sources/hackernews.ts)
- Every keyword is searched. perKeywordLimit = min(100, max(5, ceil(maxResults / keywords.length))).
- Two requests per keyword: (a) an "Ask" request with tags=ask_hn and hitsPerPage = min(20, perKeywordLimit); (b) the existing request with tags=(story,comment) and hitsPerPage = perKeywordLimit. Verify the ask_hn tag against the official Algolia HN documentation (hn.algolia.com/api) before coding; if the documentation does not support it, STOP and report.
- Requests run with at most 3 in flight (a small promise-based limiter: reuse the classifier's semaphore if it is exported, otherwise add utils/concurrency.ts without changing the classifier). Results are collected per request and merged afterwards, so the output order is deterministic and independent of timing.
- Merge order: all Ask results first, round-robin across keywords in keyword order (the first result of every keyword, then the second of every keyword, and so on), then the normal results in the same round-robin order. Dedupe by externalId (first occurrence wins) and apply the maxResults cap LAST, after merging.
- Request log (ctx.onRequest, section 30): label = the keyword for the normal request and `${keyword} (Ask HN)` for the Ask request; one onRequest call per request as before.
- Status rules, error handling, mapHit, text cleaning and the fixture-based behaviour stay as they are. Existing adapter tests must be updated to the new request pattern but keep their meaning.

### 31.3 Classification priority
- The classify stage receives the run's keywords: `ClassifyStage = (runId, onProgress, options?: { keywords?: string[] })`; runPipeline passes `{ keywords: params.keywords }`. Without options behaviour is unchanged (existing tests pass untouched).
- When keywords are given, the signals are ordered by: (1) the number of distinct query terms found in the post text, descending; (2) createdAtSource, newest first; (3) signal id. Query terms are the lowercase words of all keywords with at least 4 characters, minus the stop words in a new constant QUERY_STOPWORDS in config/enrich.ts (need, looking, best, with, that, this, from, your, have, what, tool, tools, software, solution, solutions). Matching is a case-insensitive substring test on the stored text. The cap and the "newest N of M" warning wording are unchanged apart from this ordering.
- config/llm.ts: maxClassifyPerRun becomes 40.

### 31.4 Web
Setup page: the Keywords hint becomes "Use 2 to 5 short, specific phrases. Long lists dilute the results."

### 31.5 Files
sources/hackernews.ts, utils/concurrency.ts (only if needed), agents/classifier.ts, orchestrator/runPipeline.ts, config/enrich.ts, config/llm.ts, web SetupPage.tsx, README.md and docs/LIMITATIONS_AND_ETHICS.md (one sentence each, Step 6), plus tests.

## Phase map for sections 32 to 35

| Phase | Section | Feature | Status when written |
|---|---|---|---|
| 9A | 32 | Displacement agent with local embeddings, Themes page | to build |
| 9B | 33 | Critic agent (adversarial evidence review) | built, awaiting review and commit |
| 9C | 34 | Live pipeline trace (SSE plus graph) | to build |
| 9D | 35 | Competitor co-mention graph | to build |

Run order of stages after Phase 9A: Scout, Classifier, Critic, Enricher, Scorer, Displacement. Displacement runs last because it needs labelled, scored signals. This supersedes the order shown in sections 3 and 3.1.

---

## 32. Phase 9A: Displacement agent with local embeddings (added October 2026)

These rules override earlier sections where they conflict.

### 32.1 Decision and overrides
- Section 8.2 describes Displacement as an LLM agent. It is built instead as a code-only agent: a small local text-embedding model turns each complaint post into a vector, a density clustering algorithm groups similar posts, and plain code writes the theme title and summary. Reasons: it is free, reproducible, needs no extra LLM calls, and its output can be checked by anyone.
- No LLM calls. No migration: the existing `themes` table (section 6.1) is used exactly as defined. Theme titles and summaries are produced by code and never by a model.
- Overrides: (a) the sentence "Do not add GPU or self-hosted model code" in section 4 becomes "CPU-only local embedding inference for the Displacement agent is allowed; no GPU code". (b) The lazily loaded embedding model is a performance cache and does not affect results, so it does not violate section 2 rule 9. (c) `llm/prompts/displacement.v1.ts` from section 5 is NOT created. (d) Section 8.2's rule stays: a theme with no verified quotes is discarded.
- One new dependency: `@huggingface/transformers`, added to `apps/api/package.json` only, pinned to an exact version (no ^ or ~). No other package is added. DBSCAN is written in this repo (32.5).
- Honesty note for docs and UI: the first call downloads the model files (about 25 MB for the quantized model) from the Hugging Face Hub and caches them on disk. After that it runs offline. This is the only network access this agent ever makes, and tests never trigger it.

### 32.2 Verify before coding
Check the OFFICIAL Transformers.js documentation and the installed package types for: the `pipeline('feature-extraction', modelId, options)` call, the `dtype` option (expected value 'q8'), the call options `{ pooling: 'mean', normalize: true }`, converting the output tensor to a plain `number[][]`, and the `env.cacheDir` setting. If anything differs from this section, STOP and report the difference before coding.

### 32.3 Config (apps/api/src/config/displacement.ts, new file)
Exports: EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2'; EMBEDDING_DTYPE = 'q8'; MODEL_CACHE_DIR = '.cache/transformers' (relative to the repo root); EMBED_BATCH_SIZE = 16; MAX_EMBED_CHARS = 1000; DBSCAN_EPS = 0.45 (cosine distance); DBSCAN_MIN_PTS = 2 (counts the point itself); MIN_SIGNALS_PER_COMPETITOR = 3; MAX_TERMS_PER_THEME = 6; TITLE_TERMS = 3; STAGE_TIMEOUT_MS = 120000; THEME_STOPWORDS = ['the','and','for','that','this','with','have','from','they','will','would','there','their','what','about','which','when','your','been','were','more','than','just','like','also','into','only','very','much','some','them','then','these','those','such','because','being','does','doing','dont','cant','its','are','was','but','not','you','our','out','can','get','got','all','any','has','had','how','why','who','use','using','used','one','too','still','even','really','thing','things','way','make','makes','don','isn','doesn','didn','wasn','won']. The eps and minPts defaults were chosen before measurement; only the human tunes them.
- `.env.example` and `config/env.ts` gain optional `ENABLE_DISPLACEMENT` (literal 'true' or 'false', default true), parsed exactly like `ENABLE_CRITIC` in section 33.
- `.gitignore` gains the line `.cache/`.

### 32.4 Embedding (apps/api/src/agents/displacement.ts, new file)
`embedTexts(texts: string[]): Promise<number[][]>`:
- Lazily creates the feature-extraction pipeline on the first call (module-level promise, never at server startup, never in demo mode). Sets the cache directory from MODEL_CACHE_DIR before loading.
- Cleans each text with the existing `utils/text.ts` helper, truncates to MAX_EMBED_CHARS, embeds in batches of EMBED_BATCH_SIZE with mean pooling and normalisation, and returns one unit-length vector per input, in input order. An empty input list returns [].
- The type `Embedder = (texts: string[]) => Promise<number[][]>` is exported so tests inject a fake.

### 32.5 DBSCAN (apps/api/src/utils/dbscan.ts, new file, pure)
`dbscan(points: number[][], eps: number, minPts: number): number[]` returns one label per point: cluster ids 0, 1, 2 in order of discovery, or -1 for noise. Distance is cosine distance for unit vectors: 1 minus the dot product, clamped to the range 0 to 2. Algorithm, with no randomness:
1. labels start as "unvisited" for every point.
2. For i from 0 to n-1 in order: skip visited points. region(i) = every index j (including i) with distance(i, j) <= eps. If region(i) has fewer than minPts members, label i as noise and continue.
3. Otherwise label i with the next cluster id and expand: walk a queue seeded with region(i) minus i. For each queued point q: if q is labelled noise, relabel it with the cluster id (border point) and continue; if q is already labelled, continue; otherwise label q with the cluster id, compute region(q), and if it has at least minPts members append its members to the queue.
Same input always gives the same output.

### 32.6 Clustering and theme assembly (agents/displacement.ts)
Types (add to packages/shared/src/types.ts):
- `ThemeQuote = { signalId: string; criterion: CriterionId; quote: string }`
- `ThemeView = { id: string; runId: string; competitor: string; title: string; summary: string; quotes: ThemeQuote[]; members: Array<{ signalId: string; leadId: string | null }>; sampleData: boolean }`

`ThemeInput = { signalId: string; source: SourceId; text: string; competitorsMentioned: string[]; evidence: Array<{ criterion: CriterionId; quote: string }> }` (API-internal type in db/themes.ts).
`ThemeDraft = { competitor: string; title: string; summary: string; signalIds: string[]; quotes: ThemeQuote[] }`.

`buildThemeDrafts(inputs: ThemeInput[], embed: Embedder): Promise<{ drafts: ThemeDraft[]; complaintSignals: number; competitors: number; skippedCompetitors: string[] }>`:
1. complaintSignals = inputs.length. Sort inputs by signalId ascending (deterministic, independent of rank).
2. Primary competitor of a signal = the first entry of competitorsMentioned. Signals with an empty list are ignored (they count in complaintSignals only).
3. Group by primary competitor, keeping the competitor spelling from the seller profile. A group smaller than MIN_SIGNALS_PER_COMPETITOR is skipped and its competitor name is added to skippedCompetitors. `competitors` = number of groups that were clustered.
4. For each group: embed the texts, run `dbscan(vectors, DBSCAN_EPS, DBSCAN_MIN_PTS)`. Noise points join no theme.
5. For each cluster build a draft:
   - quotes: for each member in signalId order, the evidence entry with criterion 'names_competitor' if present, else the first evidence entry; members without any evidence contribute no quote. If a cluster ends with zero quotes it is discarded.
   - terms: tokenise each member text as lowercase, apostrophes removed, matching /[a-z][a-z0-9]{2,}/g, dropping THEME_STOPWORDS and the words of every competitor name in the run. memberDf = number of member texts containing the term; keep terms with memberDf >= 2. groupDf = number of texts in the whole competitor group containing the term. idf = ln((groupSize + 1) / (groupDf + 1)) + 1. score = memberDf * idf. Sort by score descending then term ascending and keep MAX_TERMS_PER_THEME.
   - title = `${competitor}: ${first TITLE_TERMS terms joined with ", "}`; with no terms the title is `${competitor}: shared complaint`.
   - summary = `${memberCount} signal(s) complaining about ${competitor}` followed by `, mentioning: ${terms joined with ", "}.` when there are terms, or `.` when there are none.
   - signalIds = member ids sorted ascending.
6. drafts are ordered by member count descending, then competitor, then title.
The TF and term functions are exported pure functions.

### 32.7 Theme store (apps/api/src/db/themes.ts, new file)
```ts
export interface ThemeStore {
  getThemeInputs(runId: string): Promise<ThemeInput[]>;
  saveThemes(runId: string, drafts: ThemeDraft[]): Promise<void>;
  listThemes(runId: string): Promise<ThemeView[]>;
}
```
`createThemeStore(db: SupabaseClient): ThemeStore`:
- getThemeInputs: leads of the run with label 'competitor_complaint'; for each, signals.text_snapshot and signals.source; competitorsMentioned from leads.score_breakdown.enrichment.competitorsMentioned (empty array if missing); evidence from the classifier decision of THIS run and signal with status 'ok' (agent 'classifier'), taking the criteria with passed true and a non-null quote.
- saveThemes: delete the existing themes rows of the run, then insert one row per draft (run_id, competitor, title, summary, signal_ids, quotes). An empty list only deletes.
- listThemes: read the run's themes, join leads (run_id and signal_id) to resolve each member's leadId (null if no lead), join signals to set sampleData true when any member's source is 'snapshot'. Order by member count descending, then competitor, then title.
- Supabase errors throw `new Error(\`Supabase error in <method>: ${error.message}\`)`.

### 32.8 Stage and pipeline (agents/displacement.ts, orchestrator/runPipeline.ts, index.ts)
- `createDisplaceStage({ store, embed, config? })` returns `DisplaceStage = (runId: string) => Promise<DisplaceSummary>` with `DisplaceSummary = { complaintSignals: number; competitors: number; skippedCompetitors: string[]; themeCount: number }`. It calls getThemeInputs, buildThemeDrafts, saveThemes, and enforces STAGE_TIMEOUT_MS with Promise.race (a timeout throws `new Error('Displacement timed out')`).
- PipelineDeps gains optional `displace?: DisplaceStage`, `enableDisplacement?: boolean` and `themes?: ThemeStore`. Without them behaviour is exactly as before; all existing tests pass unchanged.
- It runs only when `deps.displace` exists, `enableDisplacement !== false`, and scoring produced `scored > 0`, after the scorer events and before the final status. Events (agent 'displacement'): progress `Clustering competitor complaints`; then, after the stage, one of: info `Found ${themeCount} theme(s) from ${complaintSignals} complaint signal(s)` with counts { complaintSignals, competitors, skipped: skippedCompetitors.length, themeCount } when themeCount > 0; info `No competitor complaint signals to cluster` with counts { complaintSignals: 0 } when complaintSignals is 0; warning `No competitor themes found (${complaintSignals} complaint signal(s); at least ${MIN_SIGNALS_PER_COMPETITOR} per competitor are needed)` with the same counts when themeCount is 0 and complaintSignals > 0.
- If the stage throws: displacement error `Displacement failed: ${message}` (message via instanceof Error), continue. A run that would be 'completed' becomes 'completed_with_warnings' only when the stage threw.
- index.ts builds the theme store and the stage (embedder = `embedTexts`) unless DEMO_MODE; if creation fails the server still starts and runs complete without Displacement. `'displacement'` already exists in AGENTS (section 11.3); if it is missing, append it at the end.

### 32.9 API and demo
- `GET /runs/:runId/themes`: same runId validation and error bodies as the other routes; 404 { error: 'Run not found' } when the run does not exist; 200 { themes: ThemeView[] } (empty array when no theme store is configured).
- DemoRunSchema (demo/schema.ts) gains an optional `themes` array (default []) of ThemeView-shaped objects, so the existing fixtures/demo-run.json stays valid. `scripts/demo-record.ts` reads `listThemes` and stores them. `demo/replay.ts` provides a theme store whose `listThemes` serves the fixture themes once any displacement event is visible (or when the run is finished); its `getThemeInputs` and `saveThemes` throw `new Error('Not available in demo mode')`. In demo mode `index.ts` passes this store as `themes`. Do not edit fixtures/demo-run.json (the human re-records it).

### 32.10 Diagnostic script
`apps/api/src/scripts/embed-check.ts`, npm script `embed:check` in `apps/api/package.json` and root `package.json` (script entries only, same style as `llm:check`). It calls `embedTexts` once with four fixed sentences (two similar complaints about slow ticket search, one about unrelated pricing, one about unrelated billing), prints the model id, dtype, vector length (384 expected), the cosine similarity of the similar pair and of one unrelated pair, and the load time in ms. Exit 1 on any error. It may download the model on first use; say so in its output. Print nothing else.

### 32.11 Web
- `components/ThemeCard.tsx`: competitor name, title, summary, member count ("N signals"), up to three evidence quotes with the criterion name, each linking to the member's signal detail page when its leadId is not null, a "Sample data" badge when sampleData is true. Under the list: "Theme labels are keyword summaries computed by code from local text embeddings. They are not written by an AI model and are not proof of intent."
- `pages/ThemesPage.tsx` and route `{ name: 'themes', runId }` for `#/runs/<uuid>/themes` (parseHash stays pure and tested). States: loading, ErrorState with retry, EmptyState "No competitor themes in this run" with the sentence "Themes need at least 3 complaint signals about the same competitor." A "View themes" button appears next to "View signals" on RunPage and on the Inbox header once the run is finished with signals.
- `ReportPage`: new section "Competitor themes" between "Ranked signals" and "Other signals", using ThemeCard. If loading themes fails, show an inline ErrorState inside that section only; the rest of the report still renders. Hidden entirely when the list is empty.
- `lib/api.ts`: getThemes(runId).
- `PipelineProgress`: the Displacement stage becomes live with the same badge rules as the Classifier. The final event is one whose message starts with "Found ", "No competitor" or "Displacement failed". Summary line from the final info event: "N themes".

### 32.12 Tests
Offline only. Never load the real model: inject a fake `Embedder`.
- dbscan: hand-built unit vectors with known neighbourhoods; asserts exact labels for a two-cluster case, a noise point, a border point, minPts counting the point itself, and determinism (same input twice).
- term scoring and title/summary strings against fixed texts with exact expected output.
- buildThemeDrafts with a fake embedder returning fixed vectors: grouping by primary competitor, skipping a group of two, discarding a cluster with no quotes, ignoring a signal with no competitor.
- theme store with a fake Supabase client or fake store as the existing store tests do: delete-then-insert, ordering, leadId and sampleData resolution.
- runPipeline: stage absent (unchanged), stage present with each event branch, stage throws (error event, status completed_with_warnings), `enableDisplacement: false`.
- route tests for GET /runs/:runId/themes (400, 404, 200 empty, 200 with themes); demo schema accepts a fixture without `themes`; ThemeCard, ThemesPage states, parseHash for the new route.

### 32.13 Files
`config/displacement.ts`, `config/env.ts`, `.env.example`, `.gitignore`, `utils/dbscan.ts`, `agents/displacement.ts`, `db/themes.ts`, `scripts/embed-check.ts`, `orchestrator/runPipeline.ts`, `routes/runs.ts`, `index.ts`, `demo/schema.ts`, `demo/replay.ts`, `scripts/demo-record.ts`, `apps/api/package.json` and root `package.json` (the one dependency and the `embed:check` script entries only), `packages/shared/src/types.ts`, web `app/routes.tsx`, `app/App.tsx`, `lib/api.ts`, `components/ThemeCard.tsx`, `components/PipelineProgress.tsx`, `pages/ThemesPage.tsx`, `pages/ReportPage.tsx`, `pages/RunPage.tsx`, `pages/InboxPage.tsx`, `styles/tokens.css`, README.md and docs/LIMITATIONS_AND_ETHICS.md (one paragraph each, see 32.14), plus tests.

### 32.14 Documentation text
Add this paragraph to docs/LIMITATIONS_AND_ETHICS.md: "Competitor themes are produced by clustering text embeddings from a small local model. Cluster membership and the keyword labels are computed by code, not written by an AI model. Clusters can group posts that only look similar, and a theme is a prompt for a human to read the posts, not evidence of buying intent." Add to README.md: the `embed:check` command, the first-run model download, and the `ENABLE_DISPLACEMENT` setting.

---

## 33. Phase 9B: Critic agent, adversarial evidence review (accepted, built October 2026)

This section records the accepted specification and the decisions made while building it. These rules override earlier sections where they conflict.

### 33.1 Purpose and integrity rule
After the classifier labels a signal and its quotes are verified in code, a second LLM call with a different prompt reviews that reasoning and looks for its weakest point. The result is a trust review shown next to the signal. It is a second opinion for the human reader. It NEVER changes the label, the score, the rank, the confidence value or any evidence, and the scorer never reads it.

### 33.2 Provider rule (clarified)
The critic uses the SAME `llm` client instance as the classifier, created once in `index.ts`. There is no Groq-only client, no per-call provider option and no change to provider selection in `llm/client.ts`. Provider order, retries, fallback and the circuit breaker of sections 21.3, 22.2, 22.3 and 22.8 apply unchanged.

### 33.3 Specification
- Config (config/llm.ts): `maxCriticPerRun = 15`, `criticPromptVersion = 'critic.v1'`, `enableCritic = true`, overridable by optional env `ENABLE_CRITIC` (literal 'true' or 'false', default true) in config/env.ts and `.env.example`.
- Schema (packages/shared/src/schemas.ts): `CriticOutputSchema = z.object({ verdict: z.enum(['supported','weak','unsupported']), issues: z.array(z.string().max(200)).max(3), trustScore: z.number().min(0).max(1) })`. Type `CriticOutput`. `'critic'` is appended to AGENTS.
- Prompt (llm/prompts/critic.v1.ts): `buildCriticPrompt({ label, rationale, criteria, text })`. Skeptical-auditor framing, not asked to reclassify. Post text is untrusted data with the same delimiter handling as classifier.v2.
- Agent (agents/critic.ts): `createCriticStage({ llm, store, config })` returns `CriticStage = (runId) => Promise<CriticSummary>`, `CriticSummary = { reviewed: number; failed: number }`. Candidates are the run's latest valid 'ok' classifier decisions, ranked by number of passed criteria descending then signal id, capped at maxCriticPerRun. Each result is saved as a `decisions` row with agent 'critic', prompt_version 'critic.v1', input_hash of (criticPromptVersion, classifier decision id), output = CriticOutput, status 'ok'; an invalid or failed review is saved with status 'invalid_output' or 'error' and output {} and never blocks the run.
- Pipeline: after classification and before enrichment, only when `deps.critic` exists, `deps.enableCritic !== false` and classified > 0. Events (agent 'critic'): progress `Reviewing ${n} signal(s)` counts { total: n } where n = min(classified, maxCriticPerRun); info `Reviewed ${reviewed} signal(s)` counts { reviewed, failed }; warning `${failed} review(s) could not be completed` when failed > 0; error `Critic review failed: ${message}` when the stage throws. A run that would be 'completed' becomes 'completed_with_warnings' when the stage threw or any review failed.
- API: `GET /leads/:leadId` returns `LeadDetail.criticTrace: DecisionTrace | null` (null when no critic decision exists). No new endpoint. Classifier-only queries (reuse, decision lists) filter on agent 'classifier'.
- Web: on the signal detail page header, next to the label, rank, score and status badges, a "Trust review" chip: "Trust review: supported", "Trust review: weak" or "Trust review: unsupported" (issues expandable for weak and unsupported), a plain "Trust review unavailable" when the critic decision failed, nothing when criticTrace is null. The detail page has no confidence wording; none was added.

### 33.4 Files (as built)
`.env.example`, `config/env.ts`, `config/llm.ts`, `db/decisions.ts`, `db/leads.ts`, `index.ts`, `orchestrator/runPipeline.ts`, `agents/critic.ts`, `llm/prompts/critic.v1.ts`, `packages/shared/src/{constants,schemas,types}.ts`, web `pages/SignalDetailPage.tsx`, plus tests.

### 33.5 Known gaps (not part of this phase)
- The Run page stage list (`PipelineProgress`) does not show a Critic stage. Section 34 shows it in the live graph.
- Live provider behaviour was not exercised against real Groq during the build; the human checks it with one real run and the `llm:check` command.
- Documentation text to add to docs/LIMITATIONS_AND_ETHICS.md in a later documentation task: "The trust review is a second model's opinion of the first model's reasoning. It can be wrong in both directions and never changes a signal's label or score."

---

## 34. Phase 9C: live pipeline trace (added October 2026)

These rules override earlier sections where they conflict.

### 34.1 Decision
Run events are also delivered over Server-Sent Events. The polling endpoint `GET /runs/:runId/events?after=N` (section 19.6) stays unchanged and remains the fallback. Run state and the request log keep polling every 1000 ms exactly as in sections 20.1 and 30.7; only the event feed gains a stream. No new packages. No migration. This works in demo mode too, because the stream reads the same store the polling endpoint reads.

Honest note for docs: the server reads the store every `SSE_TICK_MS` milliseconds and pushes new events down one open connection; this is not a database push. The benefit is a single connection, ordered delivery and a faster progress display.

### 34.2 Config (apps/api/src/config/stream.ts, new file)
`SSE_TICK_MS = 300`, `SSE_HEARTBEAT_MS = 15000`, `SSE_MAX_MS = 600000`.

### 34.3 Endpoint (apps/api/src/routes/runs.ts)
`GET /runs/:runId/events/stream?after=N`:
- Same runId validation as the other routes: invalid id gives 400 { error: 'Invalid run id' } and an unknown run gives 404 { error: 'Run not found' }, both as normal JSON before any stream headers. `after` is optional (default 0) and must be a non-negative integer, else 400 { error: 'Invalid after' }. A `Last-Event-ID` request header, when it is a non-negative integer, is used if larger than `after`.
- Headers: Content-Type `text/event-stream`, Cache-Control `no-cache, no-transform`, Connection `keep-alive`, X-Accel-Buffering `no`; call `res.flushHeaders()`.
- Each event is sent as `id: <event id>`, `event: run_event`, `data: <JSON RunEvent>` followed by a blank line.
- Every SSE_TICK_MS: if a previous tick is still running skip this one; read `store.listEvents(runId, lastId)` and send new events in id order; then read `store.getRun(runId)`. When the run is null or its status is not 'running': read events once more and send them, then send `event: done` with `data: {"status":"<run status>"}` and end the response.
- Every SSE_HEARTBEAT_MS write the comment line `: keepalive`. After SSE_MAX_MS end the response without a done frame (the browser reconnects with Last-Event-ID).
- On a store error: log the message via instanceof Error, send `event: fatal` with `data: {}` and end the response (the client falls back to polling).
- On request close, stop all timers. No timer may outlive its response.

### 34.4 Client hook (apps/web/src/hooks/useRunEvents.ts)
Keep the hook's name and return shape unchanged; RunPage must not need to know which transport is active. If the existing structure makes that impossible, STOP and ask.
- When `EventSource` exists, open `/api/runs/<id>/events/stream?after=<last id>` and add each `run_event` frame to the same events state, ignoring ids already present. While the stream is healthy, the polling loop does not request events (it still polls the run and the request log). On `done`, close the stream and perform the same final drain as today.
- Fall back to the existing event polling when `EventSource` is undefined, on a `fatal` frame, or after 3 consecutive errors without a received frame. Close the stream in the effect cleanup (React StrictMode runs effects twice in development).

### 34.5 Stage state (apps/web/src/lib/stages.ts, new file, pure)
`stageStatus(agent, events, runStatus): { state: 'waiting' | 'running' | 'completed' | 'completed_with_warnings' | 'failed' | 'skipped'; label: string; summary: string | null; durationMs: number | null }`. Labels are exactly "Waiting", "Running", "Completed", "Completed with warnings", "Failed", "Skipped". `PipelineProgress` is NOT changed by this phase and keeps its own logic.
Stages in execution order: scout, classifier, critic, enricher, scorer, displacement. Events of agent 'orchestrator' are ignored.
- A final event of a stage is its first event of kind 'info' or 'warning' whose message starts with the prefix in this table: classifier "Classified "; critic "Reviewed "; enricher "Enriched "; scorer "Scored "; displacement "Found ", "No competitor".
- Generic rule for classifier, critic, enricher, scorer, displacement: (1) a final event exists: completed, or completed_with_warnings if any event of that stage has kind 'warning' or 'error'; (2) no final event but events exist: running while runStatus is 'running'; otherwise failed if any event is of kind 'error', else completed_with_warnings; (3) no events: waiting while runStatus is 'running', otherwise skipped.
- Scout follows section 22.6: running until an event with counts.afterDedupe exists or the run is no longer running; then completed, or completed_with_warnings if any scout event with counts.status is 'degraded', 'failed' or 'skipped'; failed if every scout event that has counts.status has status 'failed'; waiting or skipped when there are no scout events (same rule as (3)).
- summary comes from the final event counts: scout `${afterDedupe} signals`; classifier `${classified} classified`; critic `${reviewed} reviewed`; enricher `${enriched} enriched`; scorer `${ranked} ranked`; displacement `${themeCount} themes`, or `no complaints` when complaintSignals is 0. null when no final event.
- durationMs = time from the stage's first event createdAt to its final event createdAt; null when there is no final event.

### 34.6 Graph component (apps/web/src/components/PipelineGraph.tsx, new file)
Plain SVG, no library. Six nodes in a row in the order of 34.5, each 130 wide with 24 between nodes (viewBox width 900), joined by arrows. Each node shows its name, state label, summary and duration ("3.2 s", one decimal) when known. The state is shown as text as well as colour. A running node pulses; an edge is drawn as active when its source node is completed and its target is running. All animation is disabled under `prefers-reduced-motion`. The SVG has `role="img"` and an aria-label that lists every stage with its state. The container scrolls horizontally on narrow screens (min width 900) and the existing PipelineProgress list stays as the accessible text version. Rendered on RunPage above PipelineProgress in a card titled "Live pipeline". Styles use existing variables in tokens.css.

### 34.7 Tests
- Stream route: a test server started on an ephemeral port with a fake RunStore; read the stream with fetch and assert the exact frames (`id`, `event`, `data`), `after` and `Last-Event-ID` handling, the `done` frame and that the response ends, 400 and 404 JSON bodies, a store error giving a `fatal` frame, and that timers stop after the client aborts (use the injectable clock or small intervals).
- stages.ts: a table of events and runStatus values for every rule in 34.5 including scout edge cases and durations.
- PipelineGraph: renders all six stages, state text, aria-label, no animation class under reduced motion (check the class or attribute the component sets).
- Hook: with a fake EventSource, events are merged without duplicates; fallback to polling on `fatal`, on three errors, and when EventSource is undefined.

### 34.8 Files
`config/stream.ts`, `routes/runs.ts`, web `hooks/useRunEvents.ts`, `lib/stages.ts`, `components/PipelineGraph.tsx`, `pages/RunPage.tsx`, `styles/tokens.css`, plus tests.

---

## 35. Phase 9D: competitor co-mention graph (added October 2026)

These rules override earlier sections where they conflict.

### 35.1 Scope
No LLM calls, no migration, no new packages. The graph shows which competitors are mentioned together in the run's buying signals. It uses data the Enricher already stores (`enrichment.competitorsMentioned`, section 23.3).

### 35.2 Shared type
`CompetitorGraphView = { nodes: Array<{ competitor: string; mentionCount: number }>; edges: Array<{ a: string; b: string; weight: number }>; signalCount: number; sampleData: boolean }`.

### 35.3 Pure function (apps/api/src/report/competitorGraph.ts, new file)
`buildCompetitorGraph(leads: LeadView[]): CompetitorGraphView`:
- Only leads labelled buyer_intent or competitor_complaint are used; signalCount is their number. Other labels are ignored (vendor promotion in noise posts would distort the graph).
- Each lead contributes its distinct `enrichment.competitorsMentioned` names. mentionCount of a competitor = number of used leads that mention it. Every competitor mentioned at least once is a node.
- For every pair of distinct competitors in the same lead, the edge has a = the smaller name and b = the larger name by plain string comparison (`a < b`), and its weight is the number of used leads that mention both.
- Nodes are sorted by mentionCount descending then name; edges by weight descending, then a, then b. At most 12 nodes are returned (the top 12) and only edges between returned nodes.
- sampleData is true when any used lead has source 'snapshot'.

### 35.4 Endpoint (apps/api/src/routes/report.ts)
`GET /runs/:runId/competitor-graph`: same runId validation and error bodies; 404 { error: 'Run not found' }; 409 { error: 'Run is still running' } while the run is running; 200 { graph: CompetitorGraphView } built from `leadStore.listLeads(runId, true)`. Works in demo mode through the replay lead store.

### 35.5 Layout (apps/web/src/lib/graphLayout.ts, new file, pure)
`layoutCircle(graph, size)` returns node positions and edge widths with no randomness: node i of n sits at angle -PI/2 + 2*PI*i/n on a circle of radius 0.38 * size around the centre (size/2, size/2); node radius = 14 + 22 * (mentionCount / maxMentionCount); edge stroke width = 1 + 5 * (weight / maxWeight). All numbers rounded to one decimal. With one node the node sits at the centre. A circular layout is used on purpose: runs have at most a handful of competitors, so a force simulation would add a dependency and no information.

### 35.6 Component and pages
- `components/CompetitorGraph.tsx`: SVG of size 360 with node circles (competitor name beside each, mention count inside or beside), edge lines labelled with their weight when weight > 1, `role="img"` with an aria-label summarising the strongest pair, and a native `<details>` "Show as table" listing every pair and weight and every node count. A "Sample data" badge when sampleData is true. A caption: "Counts are signals that mention each competitor. A line means the same signal mentions both."
- States: fewer than 2 nodes: EmptyState "Not enough competitor mentions" with the sentence "This view needs at least two competitors mentioned in buying signals."; two or more nodes but no edges: the nodes plus the sentence "No signal mentions two competitors together in this run."
- Shown on `ThemesPage` below the themes and on `ReportPage` in a section "Competitor co-mentions" after "Competitor themes". A fetch failure shows an inline ErrorState in that section only. `lib/api.ts`: getCompetitorGraph(runId).

### 35.7 Tests
`buildCompetitorGraph`: fixed leads with exact nodes, edges, ordering, the 12-node cap, label filtering, duplicate names within one lead, sampleData. `layoutCircle`: exact positions for 1, 2 and 3 nodes. Route: 400, 404, 409, 200. Component: states, table alternative, badge.

### 35.8 Files
`packages/shared/src/types.ts`, `report/competitorGraph.ts`, `routes/report.ts`, web `lib/api.ts`, `lib/graphLayout.ts`, `components/CompetitorGraph.tsx`, `pages/ThemesPage.tsx`, `pages/ReportPage.tsx`, `styles/tokens.css`, plus tests.

## 36. Phase 10: visual redesign

The web app uses a light-only, white-and-blue design system documented in `docs/DESIGN.md`, with a slim top navigation bar, a centered content column, accessible text-first badges, and restrained CSS motion. This phase changes presentation only: routes, behavior, data and API contracts remain unchanged; all motion respects `prefers-reduced-motion`, and report print styles remain supported.

## 37. Phase 11: explainable pipeline and signal trace

### 37.1 Scope and data-model facts
This phase replaces the duplicate RunPage pipeline views with one keyboard-accessible six-stage journey and adds a per-signal trace. It is additive: no migration, new package, fixture edit or change to existing pipeline behavior. The current data model stores collected posts through `run_signals`/`signals`, classifier and critic decisions in `decisions`, and enrichment plus deterministic score/rank in `leads.score_breakdown`/`leads`. There is no separate persisted Enricher or Scorer decision row; the trace projects those fields from the lead row. A theme stores its member IDs, generated title/summary and verified quotes, but recurring terms are represented by the deterministic title/summary text. A missing output is reported as unavailable unless an event or row records why the stage did not run.

### 37.2 Run signals endpoint
`GET /runs/:runId/signals?limit=50&offset=0` validates the UUID and paging values (limit 1–100, offset non-negative integer), returns 400 for invalid input, 404 for an unknown run and otherwise `{ signals: SignalRunSummary[], total: number }`. It pages every `run_signals` row, including signals with no classifier decision, in collected order. Each summary contains `signalId`, `leadId: string | null`, `source`, `authorHandle`, `url`, `textPreview`, `createdAtSource`, `label: LeadLabel | null`, `score: number | null`, and `stages: Record<SignalJourneyStage, SignalStageStatus>`. Each stage status is `completed | not_run | failed | not_available` with an optional evidence-based reason. It contains no inferred label or score.

### 37.3 Per-signal trace endpoint
`GET /runs/:runId/signals/:signalId/trace` returns 400 for an invalid run or signal UUID, 404 when the run or its signal membership is absent, and otherwise `{ journey: SignalJourney }`. `SignalJourney` contains the summary fields above, the full stored post text, and seven ordered entries: `scout`, `classifier`, `critic`, `enricher`, `scorer`, `displacement`, `outcome`. The first six are pipeline stages in execution order; `outcome` is a summary entry and never appears in the pipeline graph or stage tabs. Every entry has `status`, `reason: string | null`, and `output: Record<string, unknown> | null`. Scout output is the stored source/post metadata; classifier output is the validated recorded label, criteria, rationale, verified quote state, model and prompt version; critic output is the recorded verdict, issues and trust score with model and prompt version; Enricher output is the stored `Enrichment`; Scorer output is the stored score, breakdown components, weights and rank (rank is null for non-ranked labels). Displacement is derived only from recorded theme membership and run events: a member shows theme title, competitor and other-member count with a theme link; a competitor complaint in no theme is completed with the note `Not placed in a theme: it either did not cluster with similar complaints or its competitor had fewer than 3 complaint signals`; a non-complaint is `not_run` with reason `Only competitor complaints are clustered`; disabled, absent or failed runs use the recorded skip/failure reason. An unexecuted stage records a `Displacement skipped: ...` info event with the reason in its counts. Demo replay uses themes in the fixture. Outcome states whether the signal is included in ranked results (with rank and score) or excluded with the recorded reason, and adds a second line when the signal is also a theme member. Unavailable model fields remain null. An entry is `not_run` only when run events/decision rows record that it was skipped, capped or disabled; otherwise missing stage data is `not_available`. Invalid-output and error decision rows are `failed` and retain their recorded status/reason.

### 37.4 RunPage explainability
The Run page shows a five-count funnel (collected, classified, buying signals, ranked, themes) only from stored signals, decision summaries, leads and displacement event counts. Drop explanations come from recorded cap/source/status events and stored labels. One six-stage interactive pipeline replaces both the graph and duplicate list; the tablist supports arrow-key navigation and each stage shows its purpose, state text and dot, recorded input/output counts and duration. Its detail panel uses recorded stage outputs; absent fields say `Not recorded for this run`. Critic is explicitly an advisory second opinion that never changes a label or score; it shows the available verdict spread and issues without suggesting corrections. Displacement describes local embeddings and DBSCAN, shows themes/member posts/terms and recorded skipped competitors, and never suggests generated opportunities. A Walk through follows one selected collected signal in six pipeline steps from Scout to Displacement, then a final Result step shows its Outcome entry. The Run page timeline and signal detail Journey use the same seven-entry order. Next/Back, arrow keys and optional auto-play change only the selected view.

### 37.5 Zero-result and diagnostics behavior
Run outcomes distinguish no source results, source-specific empty results, classifier cap or warnings, stage failures, collected but unranked signals, and no ranked signals. Wording never treats an empty result as evidence of no demand. Actions link to the collected posts, new search keywords and classifier decisions where those records exist. Event log, request log and source activity remain available in a collapsed Diagnostics disclosure.

### 37.6 Demo replay
The endpoints work in replay mode. `DemoRunSchema` gains optional `collectedSignals` and `journeys` fields so older recordings remain valid; the recorder fills them from the same stores as live mode. Replay only returns fields present in the fixture and otherwise reports unavailable data. `fixtures/demo-run.json` is not edited.

### 37.7 Tests and files
Tests cover paging and all-collected membership, trace stage states and output projection, demo schema/replay with and without optional trace data, keyboard stage selection, funnel/drop calculations, zero-result messages, stage panels, and the timeline. Files are limited to the RunPage pipeline/timeline UI, shared trace types, API signal/trace routes and stores, demo schema/replay/recorder, their tests, and this architecture amendment.

## 38. Phase 12: signal discovery

### 38.1 Audit findings
Run `a9b70233` is reported to have collected 27 mostly irrelevant posts, returned zero Stack Exchange items, and taken about two minutes. The source code explains likely causes, but the old request log cannot prove the exact query or response: `source_requests` stores only source, label, status, HTTP status, duration, item count, error and quota. The run's raw request URLs and response items were not available for direct inspection, so the following source diagnosis separates code facts from the run evidence supplied with the task.

Hacker News currently calls Algolia `search_by_date`, which prioritizes newest matches rather than relevance. It searches each raw keyword without phrase quoting, includes `(story,comment)` results, separately issues `ask_hn` searches, and round-robins the first-page hits. Broad token matches and the mixture of comment and Ask HN results can therefore dominate; the adapter also requests only page one. `RunParamsSchema` caps lookback at 365 days, which excludes older threads. The report that the three named HN threads are relevant is supplied evaluation evidence, not a result verified against the old run's request log.

Stack Exchange currently selects up to three sites from `STACKEXCHANGE_SITES`, but falls back to only `softwarerecs`; it does not include `softwareengineering` by default. It sends each raw keyword as `q`, restricts results by `fromdate`, and requests only page one. A zero-item successful response is distinct from a request error in the adapter, but the persisted request log lacks the response wrapper's error fields and exact query. Thus zero items alone cannot establish whether the TraceLite run had no matches or a request/query problem. The two supplied Software Recommendations titles and the Software Engineering title are evaluation targets, not old-log observations.

The current HN request count scales as two requests per keyword and uses concurrency three. Stack Exchange serially requests each configured site/keyword pair. Each adapter uses retry/timeout behavior; classifier calls also run with concurrency one. This creates a plausible latency path through repeated requests and sequential provider calls, but the two-minute run cannot be attributed to one stage without its recorded per-request durations.

### 38.2 Phase 12A: retrieval precision, recall and speed
Generate deterministic, validated, deduplicated search variants from the seller profile across problem, competitor dissatisfaction, feature request, operational pain, budget, workaround, switching and indirect-intent categories. Adapt query syntax per source, cap variants per source through configuration, and record sanitized endpoint/parameters plus a short response summary for every request. Hacker News uses relevance-ranked Algolia phrase queries with relevant item-type filters and bounded pagination. Stack Exchange searches the Software Recommendations and Software Engineering sites by relevance, paginates within API limits, and records success with no matches separately from failed, rate-limited and unsupported-query outcomes. Research lookback adds two- and three-year choices; existing score recency weighting is unchanged.

Before classification, compare collected posts to the seller's problem and keywords with the existing local embedding model. Record each similarity score and threshold, retain excluded posts in the signal list and journey, and send only eligible top-N items to classification. Classifier concurrency remains bounded and existing retry/backoff behavior stays in force; emit progress when waiting on a rate limit. `npm run eval:recall -- fixtures/eval/trace-lite-recall.json` accepts expected titles or URLs and reports retrieval, profile similarity and label; the operator runs it with network access, a local embedding model cache, and provider credentials for labels. Tests inject fake fetch and embedding providers and never load the model or call external services.

Persisted request endpoint/parameters and response summaries require additive nullable fields on `source_requests`; migration `supabase/migrations/0004_retrieval_request_details.sql` adds `outcome`, `request` and `response_summary`. Do not execute it in the application task; the operator applies it before using the expanded request-log endpoint. Existing rows and demo recordings without these fields remain valid and display unavailable query details.

### 38.3 Phase 12B: additional sources
Add new public sources such as GitHub, DEV and Product Hunt only in 12B. They are outside 12A and do not change its source adapters.

### 38.4 Phase 12C: richer classification and ranking
After retrieval and labels are established, 12C may add structured classification and ranking changes. It is outside 12A; the current score formula, recency weighting and scoring behavior stay unchanged.

### 38.5 API assumptions verified
The HN Algolia API and help pages document query syntax (including quoted phrases), tags with parenthesized OR, result pages and hit summaries; `/search` is used for relevance-oriented search while `/search_by_date` is date-oriented. The Stack Exchange `/search/advanced` documentation specifies `q` as free-form text with an undocumented matching algorithm, supports `title`, `body` and `sort=relevance`, and uses one `site` per request. Paging starts at 1, permits page sizes up to 100, and the v2.3 overview caps anonymous page numbers at 25. Stack Exchange error details are returned in wrapper fields such as `error_id`, `error_name` and `error_message`; when `backoff` is present, clients must wait the stated number of seconds before calling that method again. These documented contracts do not guarantee that any particular expected thread remains indexed or is returned for a generated query.

References: [HN Algolia API](https://hn.algolia.com/api), [HN search help](https://hn.algolia.com/help), [Stack Exchange advanced search](https://api.stackexchange.com/docs/advanced-search), [paging](https://api.stackexchange.com/docs/paging), [error handling](https://api.stackexchange.com/docs/error-handling), and [throttles/backoff](https://api.stackexchange.com/docs/throttle).
