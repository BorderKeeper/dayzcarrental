// githubDispatch.ts — fire a GitHub `repository_dispatch` event so an approved
// vote triggers the AI feature-builder workflow (.github/workflows/ai-build.yml,
// applied by the founder per the propose-change flow).
//
// This is how the serverless bot hands a long, build-capable job off to CI:
// the /api/discord function can't check out the repo or run a build, so on an
// APPROVED /tally it POSTs a repository_dispatch with the proposal payload, and
// GitHub Actions does the real work (checkout → AI builder → npm build → PR).
//
// Auth is a GitHub token with repo scope, from the environment
// (GITHUB_DISPATCH_TOKEN) — NEVER in the repo (CLAUDE.md rule 2). Raw fetch, no
// dependency. Transport injected for tests.

import type { FetchLike } from "./aiClient";

export interface DispatchDeps {
  token: string;
  owner: string; // e.g. "BorderKeeper"
  repo: string; // e.g. "dayzcarrental"
  fetchImpl?: FetchLike;
}

// The payload the workflow receives (client_payload). Kept small and text-only;
// the workflow passes it to the builder as the approved proposal.
export interface BuildDispatchPayload {
  proposalId: string;
  title: string;
  actionKind: string;
  body: string;
}

// POST /repos/{owner}/{repo}/dispatches with event_type "ai-build". Returns
// true on the GitHub 204 No Content. Any failure returns false (the caller
// logs it to the vote channel; it never throws into the request path).
export async function dispatchAiBuild(payload: BuildDispatchPayload, deps: DispatchDeps): Promise<boolean> {
  const fetchImpl: FetchLike =
    deps.fetchImpl ?? ((url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>);
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${deps.owner}/${deps.repo}/dispatches`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${deps.token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "user-agent": "dayzcarrental-ai-maintainer",
      },
      body: JSON.stringify({ event_type: "ai-build", client_payload: payload }),
    });
    return res.ok; // GitHub returns 204 on success
  } catch {
    return false;
  }
}
