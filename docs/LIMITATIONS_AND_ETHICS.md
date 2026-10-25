# Limitations and ethics

## Data and privacy

Vantage is designed around public posts and stores the minimum fields used by its pipeline: public handle, community, text snapshot, URL, timestamps, and engagement. It does not collect contact details, send messages, or scrape login-gated or bot-protected pages. Source use must follow applicable platform terms; a platform-terms compliance audit has not been performed (not verified).

Hacker News search uses the free Algolia API and the app footer displays “Search by Algolia.” Stack Exchange search uses the official API and currently collects questions only, not answers or comments. Public user contributions use applicable CC BY-SA terms, which vary by contribution date; the UI shows the author and links each signal to its original post for attribution. The unauthenticated daily API quota is 300 requests, and a free application key increases the default quota to 10,000 requests per day. Actual Stack Exchange result volume for a given seller is unverified until checked in a live run. Reddit's unauthenticated `.json` endpoints stopped working in May 2026; there is no Reddit adapter, and access requires official API credentials. Developer-forum and review-site sources are not built.

The backend uses a Supabase service-role key. The current database policy configuration includes one anonymous read policy on `run_events`; broader authentication and row-level-security policies are not implemented.

## Transparency and safety design

- Vantage surfaces public-post signals, not contact records, and never sends messages.
- Every displayed evidence quote is checked in code as a literal substring of the stored post text. Unverifiable quotes are discarded.
- Scores are computed by deterministic code using weights, a recency half-life, and an engagement cap from `apps/api/src/config/scoring.ts`; a model does not output the score.
- Post text is untrusted input. The classifier prompt uses delimiters, validates model output against a schema, and verifies quotes before showing them.
- Decision records store the model, prompt version, and input hash.
- Synthetic data is labelled “Sample data” and is never given a real-post link.
- Demo replay serves a recorded run without source, model, or database calls and displays a persistent demo banner.

## Known limitations

- The classifier can mislabel ambiguous posts, and model-written summaries can state details that are not present in the post. The evidence display is separate from the summary so it can be checked.
- Model outputs can be nondeterministic across providers. Provider free tiers can impose rate limits; the client retries rate limits and can disable a provider for the rest of the process after HTTP 404, 401, or 403.
- The per-run classifier cap is **30** signals (`maxClassifyPerRun` in `apps/api/src/config/llm.ts`). When a run contains more, the newest 30 are classified.
- Hacker News has few people shopping for B2B tools in the informal observations recorded in [the evaluation](EVALUATION.md). Searches can return vendor posts and off-topic discussions.
- The evaluation covers 36 synthetic posts and one run, with no held-out set. Its accuracy does not establish performance on live posts.
- The current sample-data inbox and demo fixture contain synthetic posts. They are suitable for a labelled demonstration, not evidence of market demand.

## Not implemented

The Reddit adapter, developer-forum adapter, review-site source, approach suggester, Monitor, authentication, broader row-level-security policies, deployment, a browser accessibility audit, and load testing are not implemented.

## Misuse risks and limits

Scores and labels can be mistaken for certainty, and summaries can overstate evidence. The interface exposes evidence and deterministic score components so a person can inspect the basis of a result; the labels and scores should still be treated as decision support, not proof of intent. The system is limited to public posts and does not supply personal contact details or automate outreach. Synthetic records remain visibly labelled and are not linked as real posts.

Competitor themes are produced by clustering text embeddings from a small local model. Cluster membership and the keyword labels are computed by code, not written by an AI model. Clusters can group posts that only look similar, and a theme is a prompt for a human to read the posts, not evidence of buying intent.

Hacker News searches each keyword with separate Ask HN and story/comment requests, then combines results across keywords.
