# Katha AI Session Handoff

Copy the prompt below into a new Katha AI task.

```text
Continue work in the canonical Katha AI monorepo.

Repository
- Local path: /Users/mac16/Katha AI
- GitHub: praz-builds/rork-katha-ai-clone
- Base branch: main
- Active branch: codex/unified-katha-monorepo-reviewed
- Active PR: https://github.com/praz-builds/rork-katha-ai-clone/pull/3

Read first
- /Users/mac16/Katha AI/CLAUDE.md
- /Users/mac16/Katha AI/CODEX.md
- /Users/mac16/Katha AI/BUILD_LOG.md
- /Users/mac16/Katha AI/SESSION_HANDOFF.md
- For app work: expo/CLAUDE.md, expo/DESIGN.md, expo/BUILD_LOG.md
- For backend work: backend/CLAUDE.md, backend/ROADMAP.md, backend/build-log.md

Repository structure
- expo/: approved Expo SDK 54 app and primary product client
- backend/: Supabase migrations, Edge Functions, generation prompts, roadmap, and history
- ios-katha-ai-create-stories/ and android-katha-ai/: preserved native reference clients
- .coderabbit.yaml: mandatory automated review policy

Current state
- The approved Expo onboarding and paywall frontend is already on main through PR #1.
- PR #3 consolidates the backend into this monorepo.
- CodeRabbit's first PR #3 run failed to post inline comments and explicitly marked merge risk critical. A green completion status was not approval.
- The active branch contains remediation for service-role-only credit RPCs, credit serialization and idempotency, Adapty authorization and replay protection, disabled unverified ad rewards, disabled generic client deductions, atomic feedback rewards, and refunds when generated content cannot be persisted.
- Deno checks, lint, four Adapty unit tests, CodeRabbit schema validation, SQL parsing, all five in-memory migration applications, RPC permission checks, replay checks, concurrent balance checks, daily feedback caps, and atomic story completion passed locally.
- These backend changes are not deployed. PR #3 must remain unmerged until validation passes and CodeRabbit issues a fresh successful approval.

Mandatory workflow
- Never commit or push directly to main.
- Work on codex/<task-slug>, push the branch, and open a PR against main.
- Wait for CodeRabbit after every code push.
- Merge only when the latest CodeRabbit review completed successfully and approved, no failed or request-changes message remains, all actionable threads are resolved, validation passes, and the branch is current with main.
- Merge through GitHub only.

Immediate next actions
1. Inspect git status and PR #3 review state before editing.
2. Read the latest CodeRabbit output on PR #3 and distinguish a formal approval from a green completion status.
3. Address every actionable review finding on the feature branch and rerun focused validation.
4. Retrigger @coderabbitai full review after any code-changing push.
5. Do not merge until CodeRabbit formally approves and no failed or request-changes message remains.

Known external configuration
- Supabase project ref: iafeuxgoiknncgyjmugd
- Adapty must send the exact configured Authorization header value.
- ADAPTY_WEBHOOK_SECRET and exact Adapty product IDs require dashboard and secret verification before production enablement.
- AdMob reward credits remain intentionally disabled until server-side verification is implemented.

Do not create another Katha repo, reintroduce handoff asset dumps, alternate logos, duplicate design systems, or commit secrets, dependencies, or build output.
```
