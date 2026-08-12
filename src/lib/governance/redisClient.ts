// redisClient.ts — a tiny, dependency-free Redis client over the RESP wire
// protocol, using Node's built-in net/tls sockets.
//
// Why not `npm install redis`? package.json is a LOCKED file (GUARDRAILS.md) —
// the AI maintainer cannot add dependencies. So, matching the rest of this
// project (raw fetch for HTTP APIs, node:crypto for Ed25519), we speak Redis
// directly. We only need a handful of commands for the budget store
// (GET / SET..NX / INCRBY / DECRBY), so a minimal RESP client is ~all we need.
//
// Connection comes from REDIS_URL (redis:// plain TCP or rediss:// TLS). One
// short-lived connection per command batch — fine for a serverless webhook that
// does a couple of commands per invocation; no long-lived pool to leak across
// cold starts.

import net from "node:net";
import tls from "node:tls";

export interface RedisTarget {
  host: string;
  port: number;
  username?: string;
  password?: string;
  tls: boolean;
}

// Parse a redis://[user:pass@]host:port (or rediss://) URL.
export function parseRedisUrl(url: string): RedisTarget {
  const u = new URL(url);
  if (u.protocol !== "redis:" && u.protocol !== "rediss:") {
    throw new Error(`Unsupported Redis URL scheme '${u.protocol}' (want redis:// or rediss://).`);
  }
  return {
    host: u.hostname,
    port: u.port ? Number.parseInt(u.port, 10) : 6379,
    username: decodeURIComponent(u.username || "") || undefined,
    password: decodeURIComponent(u.password || "") || undefined,
    tls: u.protocol === "rediss:",
  };
}

// Encode a command as a RESP array of bulk strings.
function encodeCommand(args: (string | number)[]): string {
  let out = `*${args.length}\r\n`;
  for (const a of args) {
    const s = String(a);
    out += `$${Buffer.byteLength(s)}\r\n${s}\r\n`;
  }
  return out;
}

// Minimal RESP reply parser. Handles the reply types our commands return:
//   +OK        simple string   -> string
//   -ERR ...   error           -> throws
//   :123       integer         -> number
//   $-1        null bulk       -> null
//   $3\r\nfoo  bulk string     -> string
// Returns { value, consumed } or null if more bytes are needed.
type Reply = string | number | null | Reply[];
function parseReply(buf: Buffer, offset: number): { value: Reply; next: number } | null {
  if (offset >= buf.length) return null;
  const type = String.fromCharCode(buf[offset]);
  const lineEnd = buf.indexOf("\r\n", offset);
  if (lineEnd === -1) return null; // incomplete line
  const line = buf.toString("utf8", offset + 1, lineEnd);
  const afterLine = lineEnd + 2;

  switch (type) {
    case "+":
      return { value: line, next: afterLine };
    case "-":
      throw new Error(`Redis error: ${line}`);
    case ":":
      return { value: Number.parseInt(line, 10), next: afterLine };
    case "$": {
      const len = Number.parseInt(line, 10);
      if (len === -1) return { value: null, next: afterLine };
      const dataEnd = afterLine + len;
      if (dataEnd + 2 > buf.length) return null; // bulk body not fully arrived
      return { value: buf.toString("utf8", afterLine, dataEnd), next: dataEnd + 2 };
    }
    case "*": {
      // Array (e.g. SMEMBERS). Parse `count` elements recursively.
      const count = Number.parseInt(line, 10);
      if (count === -1) return { value: null, next: afterLine };
      const items: Reply[] = [];
      let pos = afterLine;
      for (let i = 0; i < count; i++) {
        const el = parseReply(buf, pos);
        if (!el) return null; // array not fully arrived yet
        items.push(el.value);
        pos = el.next;
      }
      return { value: items, next: pos };
    }
    default:
      throw new Error(`Unsupported RESP reply type '${type}'.`);
  }
}

// A socket factory so tests can inject a fake duplex stream instead of a real
// TCP connection.
export type SocketFactory = (target: RedisTarget) => NodeJS.ReadWriteStream & {
  once(ev: string, cb: (...a: any[]) => void): any;
  on(ev: string, cb: (...a: any[]) => void): any;
  write(data: string): any;
  end(): any;
  destroy?(): void;
};

function defaultSocket(target: RedisTarget): any {
  return target.tls
    ? tls.connect({ host: target.host, port: target.port, servername: target.host })
    : net.connect({ host: target.host, port: target.port });
}

// Run a sequence of commands on one connection, in order, returning each reply.
// AUTHs first if the URL carries credentials. Closes the socket when done.
export async function redisPipeline(
  url: string,
  commands: (string | number)[][],
  opts: { socketFactory?: SocketFactory; timeoutMs?: number } = {},
): Promise<Reply[]> {
  const target = parseRedisUrl(url);
  const makeSocket = opts.socketFactory ?? defaultSocket;
  const timeoutMs = opts.timeoutMs ?? 5000;

  // Prepend AUTH if credentials are present (redis 6+ takes user + pass; older
  // takes just pass — we send the ACL form when a username other than the
  // default is set, else the single-arg form).
  const seq: (string | number)[][] = [];
  if (target.password) {
    if (target.username && target.username !== "default") {
      seq.push(["AUTH", target.username, target.password]);
    } else if (target.username === "default") {
      seq.push(["AUTH", "default", target.password]);
    } else {
      seq.push(["AUTH", target.password]);
    }
  }
  seq.push(...commands);

  return new Promise<Reply[]>((resolve, reject) => {
    const socket = makeSocket(target);
    let buf = Buffer.alloc(0);
    const replies: Reply[] = [];
    let settled = false;

    const timer = setTimeout(() => finish(new Error("Redis timeout")), timeoutMs);

    function finish(err?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.end();
      } catch {
        /* ignore */
      }
      if (err) reject(err);
      else resolve(replies);
    }

    socket.once("error", (e: Error) => finish(e));
    socket.once("connect", () => {
      socket.write(seq.map(encodeCommand).join(""));
    });
    // TLS sockets emit 'secureConnect' rather than 'connect'.
    socket.once("secureConnect", () => {
      socket.write(seq.map(encodeCommand).join(""));
    });

    socket.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      try {
        // Parse as many complete replies as are buffered.
        let offset = 0;
        while (replies.length < seq.length) {
          const parsed = parseReply(buf, offset);
          if (!parsed) break; // need more bytes
          replies.push(parsed.value);
          offset = parsed.next;
        }
        buf = buf.subarray(offset);
        if (replies.length >= seq.length) {
          // Drop the AUTH reply(s) so callers see only their command results.
          const authCount = seq.length - commands.length;
          resolveClean(replies.slice(authCount));
        }
      } catch (e) {
        finish(e as Error);
      }
    });

    function resolveClean(commandReplies: Reply[]) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.end();
      } catch {
        /* ignore */
      }
      resolve(commandReplies);
    }
  });
}
