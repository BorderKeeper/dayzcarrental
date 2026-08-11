// audit.ts — append-only audit log (the code model of #governance-log and
// #runner-log in DISCORD.md). Entries can only be appended and read; there is
// no update or delete. This is what lets the community see "proposal → tally →
// founder action" and "who changed which safehouse" after the fact.

import type { AuditEntry } from "./types";

export class AuditLog {
  private entries: AuditEntry[] = [];

  append(event: string, detail: string, ctx?: { proposalId?: string; actorId?: string }): AuditEntry {
    const entry: AuditEntry = {
      seq: this.entries.length + 1,
      event,
      detail,
      proposalId: ctx?.proposalId,
      actorId: ctx?.actorId,
    };
    this.entries.push(entry);
    return entry;
  }

  // A read-only snapshot. Returns a copy so callers can't mutate history.
  all(): AuditEntry[] {
    return this.entries.map((e) => ({ ...e }));
  }

  find(predicate: (e: AuditEntry) => boolean): AuditEntry[] {
    return this.all().filter(predicate);
  }

  get size(): number {
    return this.entries.length;
  }
}
