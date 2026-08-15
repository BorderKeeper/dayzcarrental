// commands.ts — the slash commands this bot answers, as Discord expects them.
//
// One definition, two consumers: scripts/register-commands.mjs POSTs these to
// Discord, and discordAdapter.ts reads the option choices so what's offered in
// the client can't drift from what the handler accepts.
//
// Previously these lived only as hand-maintained curl blobs in BOT.md, which
// meant a new option had to be edited in two places and nothing caught it when
// they disagreed.
//
// `type: 3` is Discord's STRING option type.

import { ACTION_CATALOG } from "./config";

export const SAFEHOUSE_OPS = ["add", "remove", "stage"] as const;
export type SafehouseOpName = (typeof SAFEHOUSE_OPS)[number];

// Only kinds a vote could actually approve. Offering `treasury-spend` would
// send someone down a path that is disabled by design and can never pass.
const PROPOSABLE_KINDS = ACTION_CATALOG.filter((a) => a.enabled).map((a) => a.kind);

const choice = (v: string) => ({ name: v, value: v });

export const COMMANDS = [
  {
    name: "propose",
    description: "Propose a change (goes through the governance guardrails)",
    options: [
      {
        name: "kind",
        description: "What kind of change",
        type: 3,
        required: true,
        // Choices, not free text: otherwise "add server" instead of
        // "server-add" fails and the error can only explain after the fact.
        choices: PROPOSABLE_KINDS.map(choice),
      },
      { name: "title", description: "Short title", type: 3, required: true },
      { name: "body", description: "What and why", type: 3, required: true },
    ],
  },
  {
    name: "tally",
    description: "Count the votes on a proposal and post the outcome",
    options: [
      { name: "message", description: "The vote message ID to tally", type: 3, required: true },
      { name: "channel", description: "Channel ID of the vote message (defaults to here)", type: 3, required: false },
    ],
  },
  {
    name: "safehouse",
    description: "Add, remove or stage a safehouse on a server you run",
    options: [
      { name: "op", description: "add, remove or stage", type: 3, required: true, choices: SAFEHOUSE_OPS.map(choice) },
      { name: "server", description: "Server id (see: fleet.mjs show)", type: 3, required: true },
      { name: "name", description: "Safehouse name", type: 3, required: true },
    ],
  },
  {
    name: "help",
    description: "How proposals, votes and runner-ops work",
  },
] as const;
