# GUARDRAILS.md — how this repo protects itself

This repository is maintained largely by an **AI maintainer** taking direction from **Discord
volunteers**, with a **human founder as the sole merge authority**. Because instructions arrive from
untrusted places (Discord, PR comments, issues), the guardrails are **deterministic** — they run
regardless of what the AI is talked into.

## The layers (defense in depth)

1. **Deterministic hooks** — `.claude/hooks/guard.js`, registered as `PreToolUse` in
   `.claude/settings.json`. Runs before every `Edit/Write/MultiEdit` and `Bash` call, **in the main
   session and every sub-agent**. The model **cannot disable it** (the `.claude/` directory is
   itself locked). It denies:
   - edits/writes to **locked files** (below),
   - shell commands that would edit locked files another way (`sed -i`, `tee`, `>`, `mv`, `rm`…),
   - dangerous shell (`rm -rf`, fork bombs, `curl … | sh`, raw disk writes),
   - unsafe git (push to `main`/`master`, force-push, history rewrite).
2. **Permission rules** — `permissions.deny` in `.claude/settings.json` hard-blocks reads/writes of
   secrets and writes to locked files. **Deny rules take precedence over everything**, so this is a
   backstop even if the hook script had a bug. `permissions.ask` forces a prompt on push/commit/PR
   merge/publish.
3. **Documented policy / steering** — `CLAUDE.md` (AI charter + untrusted-input trust model),
   `COMPLIANCE.md` (locked money/EULA rules), and the two skills below.
4. **Human merge gate** — feature branch → PR → **founder merges**. Maintainers refine intent by
   talking to the AI on the PR.

## Locked files (AI cannot edit; founder edits by hand)

- `COMPLIANCE.md`, `CLAUDE.md`, `GUARDRAILS.md`
- `.claude/**` (settings, hooks, skills — the AI can't disable its own guardrails)
- `.github/**` (CI), any `.env*` (secrets)
- `package.json`, `package-lock.json`, `next.config.js`, `tsconfig.json`

Reading these is fine; **modifying** them is blocked. To change one, the AI writes a **proposal** in
the PR (see the `propose-change` skill) and the founder applies it.

## Skills

- **`compliance-check`** — run before finishing any change touching pricing/payments/donations/
  deposits/disclaimer. Fails the change if it breaks `COMPLIANCE.md`.
- **`propose-change`** — the safe workflow: branch + PR for normal changes; a written proposal for
  anything touching a locked file.

## For the human founder: how to make a locked change / bypass a guardrail

The guardrails bind the **AI in normal sessions**. As the founder you can:

- **Edit locked files directly** in your own editor / a plain `git` workflow outside an AI session —
  the hooks only run inside Claude Code tool calls.
- If you must change a locked file *from within* a Claude Code session, launch it with elevated
  permissions (e.g. run Claude Code with `--dangerously-skip-permissions` **only when you, the
  founder, are driving** and understand the change). Do not do this for volunteer/AI-autonomous runs.
- After changing `.claude/hooks/guard.js` or `settings.json`, re-run the hook tests (see
  `GUARDRAILS.md` history / the test commands in the PR that introduced them) to confirm blocks
  still fire.

## Testing the hook

Pipe a sample event into the guard and confirm it denies:

```bash
echo '{"tool_name":"Edit","tool_input":{"file_path":"COMPLIANCE.md"}}' | node .claude/hooks/guard.js
# → prints a permissionDecision:"deny" JSON object
echo '{"tool_name":"Edit","tool_input":{"file_path":"src/app/page.tsx"}}' | node .claude/hooks/guard.js
# → no output (allowed)
```

## Server-side branch protection (live)

`main` is protected by a GitHub **repository ruleset** (`protect-main`, active, no bypass actors):

- **Changes must be made through a pull request** — direct pushes to `main` are rejected server-side
  (verified: `GH013: ... Changes must be made through a pull request`).
- **No force-pushes** (`non_fast_forward`) and **no branch deletion** (`deletion`).
- `required_approving_review_count: 0` — the founder can merge their own PR without a second
  approver, but nothing can bypass the PR requirement (`current_user_can_bypass: never`).

This is the server-side backstop to the local `guard.js` hook: even if the hook were bypassed, GitHub
still refuses a direct push to `main`. Manage it at
<https://github.com/BorderKeeper/dayzcarrental/rules> or via
`gh api repos/BorderKeeper/dayzcarrental/rulesets`.

> Note: the repo was made **public** to enable rulesets on a free plan (a private repo would need
> GitHub Pro). It contains no secrets.

## Deliberately deferred (see ROADMAP.md)

Required **status checks** (a CI build gate on PRs), **signed/verified commits**, **CODEOWNERS**, and
the structured `@`-command PR-conversation protocol between maintainers and the AI are **later roadmap
items**, not built yet.
