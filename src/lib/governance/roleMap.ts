// roleMap.ts — parse DISCORD_ROLE_MAP (roleId -> governance Role) and say
// exactly what's wrong with it.
//
// This used to live inline in the route and swallow every failure, returning
// {}. That was the worst failure mode in the governance layer: an unset
// variable, a typo'd role id, a capitalised role name and malformed JSON all
// produced an empty map, every tally then reported "No quorum (✅0/❌0/🤷0)",
// and nothing was logged. The community reads that as "nobody cares" and drifts
// away; the founder gets no signal at all. One wrong character killed
// governance invisibly.
//
// Now every failure is named and returned, so the caller can log it and refuse
// to run a tally that is guaranteed to be meaningless.

import type { Role } from "./types";
import type { RoleMap } from "./voteTally";

export const VALID_ROLES: Role[] = ["founder", "moderator", "maintainer", "main-runner", "runner", "verified"];

export interface RoleMapResult {
  map: RoleMap;
  problems: string[];
}

export function parseRoleMap(raw: string | undefined): RoleMapResult {
  const problems: string[] = [];
  if (raw === undefined || raw.trim() === "") {
    return { map: {}, problems: ["DISCORD_ROLE_MAP is not set."] };
  }

  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    return { map: {}, problems: [`DISCORD_ROLE_MAP is not valid JSON: ${(e as Error).message}`] };
  }
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return { map: {}, problems: ['DISCORD_ROLE_MAP must be a JSON object, e.g. {"<roleId>":"verified"}.'] };
  }

  const map: RoleMap = {};
  for (const [rid, role] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof role !== "string") {
      problems.push(`Role for id '${rid}' is not a string.`);
    } else if (!(VALID_ROLES as string[]).includes(role)) {
      // Names the capitalisation trap ("Verified" vs "verified") explicitly.
      const near = VALID_ROLES.find((v) => v.toLowerCase() === role.toLowerCase());
      problems.push(
        `Unknown role '${role}' for id '${rid}'.` +
          (near ? ` Did you mean '${near}'? Role names are lower-case.` : ` Valid: ${VALID_ROLES.join(", ")}.`),
      );
    } else if (!/^\d{5,}$/.test(rid)) {
      // Discord role ids are numeric snowflakes; anything else can never match.
      problems.push(`'${rid}' is not a Discord role id (expected a numeric snowflake).`);
    } else {
      map[rid] = role as Role;
    }
  }

  if (Object.keys(map).length === 0) {
    problems.push("No usable role mappings — every vote will report 'no quorum'.");
  } else if (!Object.values(map).includes("verified")) {
    // Eligibility requires @Verified, so a map without one can never seat a voter.
    problems.push("No role is mapped to 'verified' — no ballot can ever be counted.");
  }
  return { map, problems };
}
