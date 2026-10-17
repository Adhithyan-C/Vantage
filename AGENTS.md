You are joining an existing project. Read this whole brief first. It is your standing instructions for every task I give you in this repository. Do not change anything until I give you a task. When you have read it, reply only with: "Brief understood", followed by any questions you have about it.

=====================
1. THE PROJECT
=====================
Vantage is a go-to-market intelligence dashboard for B2B SaaS sellers (a university software-engineering lab project). A seller describes their product and ideal customer. Vantage searches free public sources for people publicly describing the problem the product solves, ranks them, and shows the evidence behind every decision, so the AI's reasoning is transparent and checkable. It produces SIGNALS (a public post with handle, text, timestamp, engagement and a permalink), not contact details. It never sends messages. The main deliverable is a report of ranked signals with evidence and links.

Pipeline: Sources -> Scout (fetch, dedupe, normalize) -> Classifier (LLM labels intent using a rubric and verbatim quotes) -> Enricher (structured context) -> Scorer (a pure code function computes the score; the LLM never outputs the score) -> dashboard. Everything is stored in Supabase Postgres, including a decision record per agent step. Run progress is written as events to a run_events table and the web UI shows them live via Supabase Realtime.

Design rules that must never be broken:
 - Every evidence quote must be a literal substring of the stored post text.
 - Scores are computed by deterministic code, never by the LLM.
 - Agents are stateless between runs; all memory lives in Postgres.
 - Every LLM output is validated with a Zod schema before use.

Sources: Hacker News is live (free Algolia API). Reddit's unauthenticated .json endpoints were shut down in May 2026, so the Reddit adapter is NOT built and waits for official Reddit API credentials. Dev forums and a saved review-site snapshot come in a later phase.

=====================
2. STACK AND ENVIRONMENT
=====================
npm workspaces monorepo. TypeScript strict. apps/api (Node + Express, run with tsx), apps/web (Vite + React), packages/shared (Zod schemas and shared types, consumed as TypeScript source), Supabase (the backend uses the service-role key), Vitest. All dependency versions are pinned exactly (no ^ or ~). Windows, PowerShell. The repo is at C:\Users\DELL\Desktop\Vantage; ALWAYS work from that exact-case path (a lowercase path causes TypeScript casing errors).

=====================
3. SOURCE OF TRUTH
=====================
ARCHITECTURE.md in the repo root. Sections 1 to 17 are the original design, section 18 holds Phase 2 amendments, section 19 specifies Phase 3A. Later amendments will be added as new numbered sections. If ARCHITECTURE.md and a prompt of mine conflict, STOP and ask me. Never edit ARCHITECTURE.md unless a task explicitly tells you to. (It currently differs from commit 18afcc3 by 2 accepted deleted lines: the title line and the last bullet of section 18.5. That is known and fine.)

=====================
4. PROJECT STATUS (verify it yourself when asked; do not trust this blindly)
=====================
 - Phase 1 (scaffold, shared schemas, env loader, migration 0001, seed): done, commit 4cf032b.
 - Phase 2A (Hacker News adapter, Scout with dedupe, signal storage, scout CLI): done, commit 18afcc3, verified against the real database.
 - Phase 3A (run pipeline backend: runner, run records, progress events, routes POST /runs, GET /runs/:runId, GET /runs/:runId/events, GET /demo-seller, migration 0002): the code files were replaced by me and typecheck and tests pass locally (63 tests in 10 files). It may not be committed yet; check with git.
 - Next: Phase 3B (web Setup and Run screens), then Phase 4 (Classifier), 5 (Enricher, Scorer), 6 (Inbox and detail UI), 7 (Displacement, other sources), 8 (report, demo mode), 9 (optional extras), 10 (evaluation, docs, deployment). Phase 2B (Reddit) is blocked on credentials.

=====================
5. HOW YOU MUST WORK ON MY PROMPTS
=====================
 - My prompts come from another assistant that writes detailed, step-by-step specs. Treat each prompt as a precise specification. Read it fully before acting. Follow the steps in the given order. Do not skip steps, merge steps, or add extra work.
 - Stay strictly inside the files and scope the prompt names. If you believe another file needs changing, STOP and ask me instead of changing it.
 - If a step is impossible, ambiguous, or conflicts with the repo or with ARCHITECTURE.md, STOP at that step, explain, and wait for my answer. Do not improvise, and do not "solve" it by a workaround.
 - Sometimes I give you finished files (code or tests) that I placed myself. Never rewrite or "improve" those. Only fix what the compiler or tests demand, in the smallest possible way, and report it.
 - Verify with real commands. Never claim something works unless you ran it and saw the output. Show the real output.
 - Ask one clear question at a time when you need input.

=====================
6. MISTAKES TO AVOID (all of these happened before with other agents)
=====================
 1. NEVER edit tsconfig files and never add compiler options, baseUrl, paths, aliases (in tsconfig OR vite.config.ts), allowImportingTsExtensions, or change moduleResolution. The compiler settings are correct ("Bundler"). Hiding type errors by changing config is forbidden. If you think a config change is needed, STOP and ask me.
 2. NEVER truncate or corrupt files. Edit files with a proper patch or exact-string replacement tool, in small targeted changes. Do NOT rewrite files through PowerShell here-strings, redirection (>) or Set-Content/Out-File. Untracked files cannot be recovered from git, so a bad edit destroys work. After every edit to a file, re-read it to confirm it is intact (line count plausible, imports present, ends correctly).
 3. NEVER rename, move or delete files to get around an error (a test file was once renamed to .txt to hide a syntax error). Fix the cause or report it.
 4. NEVER silence errors with `any`, `as any`, `@ts-ignore`, `@ts-expect-error`, or by weakening or deleting a test. Never change a test to make it pass; fix the implementation, or report a spec conflict.
 5. Import shared types ONLY from '@vantage/shared' (the package root), never from '@vantage/shared/types' or by relative path into packages/. Local imports must have no .ts extension.
 6. Convert caught errors to text with `err instanceof Error ? err.message : String(err)`. Never interpolate a raw caught value like `${err}`.
 7. Zod errors use `.issues` (not `.errors`). supabase-js: `onConflict` is a string option such as 'run_id,source' (never an array, and there is no .onConflict() method); inserts that need the new id use `.insert(...).select('id').single()`.
 8. Do not run `git checkout`, `git restore`, `git stash`, `git reset`, `git clean` or `git push` unless a prompt explicitly allows that exact command. Never use `git checkout HEAD -- .`; it would wipe uncommitted work.
 9. Do not install or upgrade packages, and do not run `npm install`, unless a prompt explicitly says so. Pin versions exactly if you ever must.
 10. Never read, print, edit, create or commit .env or any secret. Never connect to the real Supabase project and never run SQL; I do that myself. Tests must never use the real network or database.
 11. For API start checks, use placeholder environment variables for that single command only (SUPABASE_URL='https://placeholder.supabase.co', the other required variables set to 'x'), and NEVER send a valid POST /runs request (it would try to write to a database). Always stop the server afterwards, free port 3001, and remove the variables you set.
 12. Do not invent APIs, options, endpoints, package names, versions or file paths. Check the installed package types or official documentation, or ask.
 13. Do not claim success from partial evidence. "Tests pass" is not enough: a syntax error can hide type errors, and Vitest does not typecheck. Always run `npm run typecheck` AND `npm test`.
 14. PowerShell only: no `&&`; keep each command on one line unless a prompt says otherwise.
 15. Never start work from a previous session's memory of what is "done". Check the repo with git status and the real files.

=====================
7. HOW TO REPORT (end every task with this, then STOP)
=====================
Write the report in this exact structure:
 1. SUMMARY: three sentences: what you did, what works, what does not.
 2. CHANGES MADE: a table with columns File | Change | Why | Lines changed. For any non-trivial edit, also show the exact before and after of the changed lines. Include files you created and files you deleted (there should be none unless the prompt told you to).
 3. COMMANDS RUN: every command with its real output (trim only long repeated output, and say so). Include typecheck, test totals, and any checks the prompt required. Never paste secrets.
 4. VERIFICATION TABLE: one row per check the prompt required: PASS, FAIL or SKIPPED, with one line of evidence. If you skip a check (for example the sandbox cannot start a server), say SKIPPED and why. Never fake output.
 5. DEVIATIONS: anything you did differently from the prompt or from ARCHITECTURE.md, and why. If none, write exactly "No deviations".
 6. ISSUES FACED: for each problem: what happened, the exact error message, what you tried (at most 2 attempts), and the current status (resolved, or stopped and waiting for me). If an issue blocked a step, say which step.
 7. UNVERIFIED / UNSURE: everything you could not check or are not certain about.
 8. GIT STATE: output of `git status --short` and `git log --oneline -3`, and the commit hash if you committed.
 9. NEXT: what the prompt said I must do manually, and your suggestion for the next step (a suggestion only; do not start it).
After the report, STOP. Do not begin the next phase or any extra work. Wait for my next instruction.

When you have read this brief, reply "Brief understood" and any questions, and wait for my first task.