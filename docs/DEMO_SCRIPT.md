# Seven-minute presentation script

Use Mode A for a presentation by default. Mode B runs the synthetic sample source through the normal database and classifier pipeline; its posts remain synthetic. The recorded fixture currently has 16 events and 30 scored signals: 10 buyer-intent, 6 competitor-complaint, 2 venting, and 12 noise.

## Pre-flight checklist

### Mode A — offline replay (recommended)

- Confirm [`fixtures/demo-run.json`](../fixtures/demo-run.json) is present.
- Set `DEMO_MODE` to `true` in `.env`; stop any API process already running in normal mode.
- Start the API with `npm run dev:api` and the web app with `npm run dev:web`. Open the local URL printed by the web server; the API listens on port 3001 by default.
- No Supabase or LLM provider connection is used by the demo API. The browser still connects to the local API through the Vite proxy.
- The selected source does not change the recorded replay. The Run page shows the recorded source and events.

### Mode B — normal run using the sample dataset

- Set `DEMO_MODE` to `false` or remove it from `.env`; stop the API and restart it after changing the setting.
- Confirm the Supabase project and database migrations are ready, and configure Groq. Start the API and web app with `npm run dev:api` and `npm run dev:web`.
- On Setup, select **Sample dataset (synthetic)** and clear **Hacker News** so the run uses only the sample source. The sample source ignores the keywords shown on the run page.
- This path needs network access, the database, and Groq. Do not describe its synthetic posts as real posts.

## Timed script

| Time | Screen and exact clicks | Presenter wording |
|---|---|---|
| 0:00–0:35 | Open the Setup page. | “Vantage finds public-post signals related to a seller’s problem. It shows the evidence and score so a person can check the result. It provides no contact details and never sends messages. I’ll use a clearly labelled synthetic dataset today.” |
| 0:35–1:15 | Click **Load demo seller**. In Mode B, check **Sample dataset (synthetic)** and uncheck **Hacker News**. Click **Start search**. | “The demo seller is Beacon Support. The sample posts are written for testing, not collected from customers, and the sample source ignores these search terms.” |
| 1:15–2:05 | On the Run page, point to **Scout**, **Classifier**, **Enricher**, and **Scorer**, then the event log. Wait for the run to finish. | “Scout fetches and normalizes the selected source. The Classifier assigns a label and proposes quotes; code validates the output and checks each quote against the post. Enricher adds structured context. Scorer computes the score in deterministic code. Displacement is displayed as not built.” |
| 2:05–2:55 | Click **View signals**. Point to the buyer-intent cards, then the competitor-complaint cards below them. In the recording, use `sample_user_06`, `sample_user_03`, `sample_user_10`, and `sample_user_12` as examples. | “The recorded run contains 10 buyer-intent and 6 competitor-complaint signals. Buyer intent is ranked before competitor complaints regardless of score. The recording fetched 36 posts but the run cap classified the newest 30.” |
| 2:55–4:05 | On the inbox, click **View signal details** for `sample_user_07`. Point to the highlighted quote in **Post text**, the **Some quotes could not be verified** note, and the **Score breakdown** table. | “This signal has a quote that did not match the stored post text, so code discarded it. The verified quote is highlighted separately. The score table shows the deterministic score components; the model does not choose the final score.” |
| 4:05–4:40 | Click **Back to inbox**. Click the **Show other signals (venting, noise)** checkbox. Point out `sample_user_32` and `sample_user_33`, both labelled noise. Click **View signal details** for `sample_user_32`, then **Accept**; return to the inbox. Open `sample_user_33`, click **Reject**, then return to the inbox. | “The other-signal toggle also makes the two prompt-injection examples visible. Both were labelled noise. Accept and Reject change the signal status; in replay mode those changes are in memory only.” |
| 4:40–5:45 | Click **View report**. Point to the sample-data banner, summary, ranked section, then click **Download CSV**. Return to the report and click **Print or save as PDF**; cancel the browser print dialog after showing it. | “The report keeps the synthetic-data warning, lists ranked signals with verified quotes and scores, and can be exported to CSV or printed. The source links and summary are not substitutes for checking the quoted evidence.” |
| 5:45–7:00 | Show the closing limitations slide or read the closing points below. | “This is a small synthetic evaluation, not proof of live accuracy. Live Hacker News searches have returned mostly vendor posts and off-topic discussions. The rubric has an ambiguous Help Scout case. Reddit, developer forums, review sites, authentication, and deployment are not implemented. We would next evaluate fresh posts labelled by someone who has not seen the prompt.” |

### Mode differences to state accurately

- **Mode A:** this is a timed replay of a previously recorded run, not a new search. Its API calls no source, model, database, or other external network service. Accept/Reject is not persisted.
- **Mode B:** this runs the sample dataset through the normal pipeline, database, and Groq. The source data is synthetic, ignores the displayed keywords, and is labelled **Sample data**. Results can differ from the recording because model output can vary.

## Fallback plan

If Mode A cannot load the fixture or the local API, stop and check the demo-mode setting and fixture path. The recorder `npm run demo:record -- --run <run-id>` requires a completed database run, so do not try to record during the presentation unless the database is ready. If the replay cannot be restored, switch to Mode B only when the database and Groq are ready. If neither path works, say the demo is unavailable; do not present invented or stale results as a live run.

## Likely questions

1. **Why synthetic data?** It makes demonstrations and evaluation repeatable without presenting invented posts as real. Synthetic posts are labelled as sample data.
2. **Why not scrape G2?** Review-site sources are not built. Vantage does not scrape login-gated or bot-protected sites, and source use must follow platform terms.
3. **How do you know the model is right?** We do not know that for every post. The synthetic evaluation scored 35 of 36 correctly in one run, but it is small and has no held-out set. A person can inspect the post and verified quotes.
4. **What if the model invents a quote?** Code checks whether the quote is a literal substring of the stored post text and discards it if it is not. `sample_user_07` demonstrates this.
5. **Does Vantage contact people?** No. It displays public-post signals and links; it has no contact details and sends no messages.
6. **What about Reddit?** The unauthenticated `.json` endpoints stopped working in May 2026. There is no Reddit adapter; official API credentials are required.
7. **What would you do next?** Evaluate 15 to 20 fresh posts labelled by someone who has not seen the prompt, then keep them held out from prompt changes.
8. **How accurate is it, and how sure are you?** On the 36-post synthetic set, one run was 97.22% (35/36). That is not a live accuracy estimate; the sample is small, written alongside the prompt, and has no held-out set.
