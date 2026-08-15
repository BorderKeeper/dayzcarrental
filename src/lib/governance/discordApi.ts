// discordApi.ts — thin authenticated Discord REST helpers for the vote flow.
//
// `/tally` needs to read a proposal's reactions and each reactor's roles, and
// to post messages. Those are authenticated calls (bot token), done over raw
// `fetch` (no SDK dependency — package.json is locked). The bot token comes
// from the environment and is NEVER in the repo (CLAUDE.md rule 2).
//
// The transport is injectable so the whole vote pipeline is unit-testable with
// a stubbed Discord, exactly like the AI client.

// Reuse the injectable transport type from aiClient (identical shape); avoids a
// duplicate `FetchLike` export from the barrel.
import type { FetchLike } from "./aiClient";

const API = "https://discord.com/api/v10";

// The three emoji the vote uses. URL-encoded for the reactions endpoint.
export const VOTE_EMOJI = { approve: "✅", reject: "❌", abstain: "🤷" } as const;

export interface DiscordMessage {
  id: string;
  channel_id: string;
  content: string;
  embeds?: { title?: string; description?: string; fields?: { name: string; value: string }[] }[];
  reactions?: { emoji: { name: string | null }; count: number }[];
}

export interface DiscordUser {
  id: string;
  username?: string;
  bot?: boolean;
}

export class DiscordApiClient {
  private token: string;
  private fetchImpl: FetchLike;

  constructor(opts: { token: string; fetchImpl?: FetchLike }) {
    if (!opts.token) throw new Error("Missing Discord bot token (set DISCORD_BOT_TOKEN; never commit it).");
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>);
  }

  private headers(): Record<string, string> {
    return { authorization: `Bot ${this.token}`, "content-type": "application/json" };
  }

  private async get(path: string): Promise<any> {
    const res = await this.fetchImpl(`${API}${path}`, { method: "GET", headers: this.headers() });
    if (!res.ok) throw new Error(`Discord GET ${path} failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  }

  // Fetch a single message (to read back the proposal embed + reaction counts).
  getMessage(channelId: string, messageId: string): Promise<DiscordMessage> {
    return this.get(`/channels/${channelId}/messages/${messageId}`);
  }

  // Users who reacted with a given emoji. Discord paginates (max 100/page);
  // we follow `after` until a short page. Bots are filtered by the caller.
  async getReactionUsers(channelId: string, messageId: string, emoji: string): Promise<DiscordUser[]> {
    const enc = encodeURIComponent(emoji);
    const out: DiscordUser[] = [];
    let after = "";
    for (let guard = 0; guard < 50; guard++) {
      const q = `?limit=100${after ? `&after=${after}` : ""}`;
      const page: DiscordUser[] = await this.get(`/channels/${channelId}/messages/${messageId}/reactions/${enc}${q}`);
      out.push(...page);
      if (page.length < 100) break;
      after = page[page.length - 1].id;
    }
    return out;
  }

  // A guild member's role IDs (for mapping to governance roles).
  async getGuildMemberRoleIds(guildId: string, userId: string): Promise<string[]> {
    const member = await this.get(`/guilds/${guildId}/members/${userId}`);
    return Array.isArray(member?.roles) ? member.roles : [];
  }

  // Grant a role. Used by the #verify button to hand out @Verified.
  //
  // Needs the bot to hold Manage Roles AND to sit ABOVE the target role in the
  // guild's role list — Discord refuses otherwise, with a 403 that says nothing
  // about ordering. The caller turns that into a message a human can act on.
  async addGuildMemberRole(guildId: string, userId: string, roleId: string): Promise<void> {
    const res = await this.fetchImpl(`${API}/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
      method: "PUT",
      headers: this.headers(),
    });
    // 204 on success, and also on re-adding a role the member already has.
    if (!res.ok) {
      throw new Error(`Discord add role failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
  }

  // Post a message to a channel (the public vote post, and the outcome post).
  // `components` carries interactive rows — the verify button lives here.
  async createMessage(
    channelId: string,
    body: { content?: string; embeds?: any[]; components?: any[] },
  ): Promise<DiscordMessage> {
    const res = await this.fetchImpl(`${API}/channels/${channelId}/messages`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Discord POST message failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  }

  // Seed the three vote reactions on the freshly-posted vote message so voters
  // just click. Best-effort: a failed reaction is logged by the caller, not fatal.
  async addReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
    const enc = encodeURIComponent(emoji);
    const res = await this.fetchImpl(
      `${API}/channels/${channelId}/messages/${messageId}/reactions/${enc}/@me`,
      { method: "PUT", headers: this.headers() },
    );
    if (!res.ok) throw new Error(`Discord add reaction failed ${res.status}`);
  }

  // Edit the original (deferred) interaction response. This is how a slow
  // command (/tally) delivers its result after the initial "thinking…" ack:
  // respond type 5 immediately, then PATCH the message here. Uses the
  // interaction token (a short-lived per-interaction credential, not the bot
  // token) — no bot-token auth header needed for this endpoint.
  async editOriginalInteractionResponse(
    applicationId: string,
    interactionToken: string,
    body: { content?: string; embeds?: any[] },
  ): Promise<void> {
    const res = await this.fetchImpl(
      `${API}/webhooks/${applicationId}/${interactionToken}/messages/@original`,
      { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    );
    if (!res.ok) throw new Error(`Discord edit interaction response failed ${res.status}`);
  }
}
