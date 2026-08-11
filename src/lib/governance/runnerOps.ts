// runnerOps.ts — the runner-ops side channel (DISCORD.md §5b).
//
// Routine per-server safehouse admin runs HERE, separate from the community
// vote flow, so runners aren't blocked on quorum for day-to-day work:
//   * a @Main Runner for a given server can add/remove/stage safehouses on
//     THEIR server directly (announced + logged),
//   * a regular @Runner can only PROPOSE a change; a main runner (or the
//     founder) applies it,
//   * conflicts between runners are resolved by the server's main runner —
//     the "main runner tag gates who edits that server's safehouse list"
//     (ROADMAP.md Phase 2).
//
// Anything that changes committed site DATA (src/data/safehouses.ts) still
// becomes a feature branch → PR the founder merges. This module decides the
// INTENT (who is allowed to change what, and how a dispute lands); it emits a
// queued PR request rather than writing files.

import type { Member } from "./types";
import { AuditLog } from "./audit";

export type SafehouseOp = "add" | "remove" | "stage";

export interface SafehouseRequest {
  requesterId: string;
  serverId: string;
  op: SafehouseOp;
  safehouseName: string;
}

export type RunnerActionResult =
  | { status: "applied"; queued: "queue-runner-ops"; by: string; detail: string }
  | { status: "proposed"; needsApprovalBy: "main-runner"; detail: string }
  | { status: "denied"; detail: string };

// Is this member the main runner for this specific server?
// Main-runner authority is per-server (ROADMAP.md: "the main runner tag gates
// who edits that server's safehouse list"). The `assignments` map is the single
// source of truth: serverId -> member ids who lead that server. This covers
// both DISCORD.md §2 options — one global @Main Runner role + per-server
// assignment, or one role per server — without leaking server ids into the
// typed Role union. Holding the @main-runner role alone is not enough; you must
// be assigned to *this* server.
export function isMainRunnerFor(m: Member | undefined, serverId: string, assignments: Map<string, string[]>): boolean {
  if (!m) return false;
  if (m.roles.includes("founder")) return true; // founder can always act
  if (!m.roles.includes("main-runner")) return false;
  return (assignments.get(serverId) ?? []).includes(m.id);
}

export class RunnerOps {
  private members: Map<string, Member>;
  // serverId -> list of member ids who are the main runner(s) for it
  private mainRunnerAssignments: Map<string, string[]>;
  private log: AuditLog;

  constructor(members: Map<string, Member>, mainRunnerAssignments: Map<string, string[]>, log: AuditLog) {
    this.members = members;
    this.mainRunnerAssignments = mainRunnerAssignments;
    this.log = log;
  }

  private isRunner(m: Member | undefined): boolean {
    return !!m && (m.roles.includes("runner") || m.roles.includes("main-runner") || m.roles.includes("founder"));
  }

  // A runner submits a safehouse change. Main runner for the server → applied
  // (queued as a runner-ops PR). Regular runner → proposed, pending a main
  // runner. Non-runner → denied.
  submit(req: SafehouseRequest): RunnerActionResult {
    const m = this.members.get(req.requesterId);
    if (!this.isRunner(m)) {
      this.log.append("runner-op-denied", `${req.requesterId} is not a runner`, { actorId: req.requesterId });
      return { status: "denied", detail: "Only verified runners can act in runner-ops." };
    }
    if (isMainRunnerFor(m, req.serverId, this.mainRunnerAssignments)) {
      const detail = `Main runner ${m!.handle} ${req.op} '${req.safehouseName}' on ${req.serverId}`;
      this.log.append("safehouse-change-applied", detail, { actorId: req.requesterId });
      return { status: "applied", queued: "queue-runner-ops", by: m!.handle, detail };
    }
    const detail = `Runner ${m!.handle} proposes ${req.op} '${req.safehouseName}' on ${req.serverId}; awaiting main runner`;
    this.log.append("safehouse-change-proposed", detail, { actorId: req.requesterId });
    return { status: "proposed", needsApprovalBy: "main-runner", detail };
  }

  // Resolve a dispute between two runners over the same safehouse on a server.
  // The main runner for THAT server decides — this is the deterministic
  // conflict-resolution rule that lets the community settle it without founder
  // aid. Returns the winning request or a clear "needs a main runner" if none
  // is assigned (which is the one case that escalates).
  resolveDispute(
    serverId: string,
    resolverId: string,
    chosen: SafehouseRequest,
    rejected: SafehouseRequest,
  ): RunnerActionResult {
    const resolver = this.members.get(resolverId);
    if (!isMainRunnerFor(resolver, serverId, this.mainRunnerAssignments)) {
      this.log.append(
        "dispute-escalated",
        `No main runner authority for ${serverId}; ${resolverId} cannot resolve — escalate to founder`,
        { actorId: resolverId },
      );
      return {
        status: "denied",
        detail: `Only the main runner for ${serverId} can resolve this dispute. Escalating.`,
      };
    }
    const detail = `Main runner ${resolver!.handle} resolved dispute on ${serverId}: chose '${chosen.safehouseName}' (${chosen.op}) over '${rejected.safehouseName}'`;
    this.log.append("dispute-resolved", detail, { actorId: resolverId });
    return { status: "applied", queued: "queue-runner-ops", by: resolver!.handle, detail };
  }
}
