# Evaluation

## Method

The classifier evaluation uses the labelled synthetic records in [`fixtures/sample-signals.json`](../fixtures/sample-signals.json). The script sends each post through the configured classifier, compares its label with the expected label, and reports accuracy, a confusion matrix, and per-label precision and recall. The reported run used model `openai/gpt-oss-20b` through Groq and prompt version `classifier.v2` (`apps/api/src/config/llm.ts`).

This is a single run over a small synthetic dataset, not a measurement of general performance on public posts.

## Dataset and hard cases

The set contains 36 synthetic posts: 10 buyer intent, 5 competitor complaint, 5 venting, and 16 noise. It includes vendor promotions, passing competitor mentions, job posts, frustration unrelated to customer support, and two prompt-injection posts (`s32` and `s33`). Both injection posts were labelled noise and neither was labelled buyer intent.

The dataset and prompt rules were written by the same people. The results below are from one run; there is no held-out set yet.

## Reproduction

Run `npm run eval:sample`. It uses `fixtures/sample-signals.json` and the current configured model and prompt. To reproduce the stated result, use the evaluation setup recorded above; model output may be nondeterministic across providers or runs.

## Results

Accuracy was **97.22% (35 of 36)**. Failed items: **0 of 36**. Discarded quotes: **0**.

Confusion matrix (rows are expected labels; columns are predicted labels):

| Expected \ Predicted | buyer_intent | competitor_complaint | venting | noise |
|---|---:|---:|---:|---:|
| buyer_intent | 10 | 0 | 0 | 0 |
| competitor_complaint | 0 | 5 | 0 | 0 |
| venting | 0 | 1 | 4 | 0 |
| noise | 0 | 0 | 0 | 16 |

| Label | Precision | Recall | Support |
|---|---:|---:|---:|
| buyer_intent | 1.000 | 1.000 | 10 |
| competitor_complaint | 0.833 | 1.000 | 5 |
| venting | 1.000 | 0.800 | 5 |
| noise | 1.000 | 1.000 | 16 |

The sole error was `s16`: a complaint about Help Scout, expected as venting and predicted as competitor complaint. Help Scout is a real helpdesk competitor but was not in the seller's competitor list, so the label is arguably ambiguous. The prompt and label were not changed after seeing this result because doing so would tune against the test set.

## Informal live Hacker News observations

These are informal observations, not a benchmark. For the helpdesk demo seller, one run classified 14 posts as 0 buyer intent, 0 competitor complaint, 1 venting, and 13 noise; another classified 9 as 0, 0, 1, and 8. An exact-phrase query for “datadog too expensive” matched 1 post in the entire Hacker News index. Unquoted queries matched loosely and returned mostly noise. These observations suggest Hacker News has few posts from people shopping for B2B tools.

## Findings from the sample-data inbox

- `sample_user_10`, comparing Help Scout, Front, and Freshdesk, scored 42, the lowest among buyer-intent signals. The model did not treat comparing named tools as a recommendation request; this is a rubric gap.
- Some model-written summaries for `sample_user_01` and `sample_user_03` mention urgency that is not stated in their posts. The UI labels summaries as model-written and shows verified quotes separately.
- `sample_user_07` showed “Some quotes could not be verified”; code discarded a quote the model made up.
- Ranking places buyer-intent signals before competitor complaints regardless of score.

## Threats to validity

The dataset is small and synthetic; the same people wrote the prompt rules and dataset; the result is from one run; and there is no held-out set. The ambiguous Help Scout case also shows that label boundaries depend on the rubric. Live Hacker News observations are informal and should not be treated as accuracy results. Model outputs can vary across providers and runs.

## Next steps for a stronger evaluation

- Collect 15 to 20 fresh posts labelled by someone who has not seen the prompt.
- Keep those records held out from prompt and rubric changes.
- Report repeat runs and separate evaluation results from informal source observations.
- Review disagreements and revise the rubric only against new evaluation data.
