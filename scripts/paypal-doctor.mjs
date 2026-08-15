// scripts/paypal-doctor.mjs — work out why the PayPal webhook has never fired.
//
// FOLLOWUPS.md records the symptom: live donations only ever arrived via the
// nightly reconciler, and PayPal's Webhook Events log stayed empty. It also
// names the two suspects — PAYPAL_WEBHOOK_ID not matching the real webhook, or
// PAYPAL_CLIENT_ID belonging to a different app than the one owning it — and
// notes that one API call answers both. This is that call, plus the other ways
// this setup can silently do nothing.
//
// Read-only. It creates nothing, changes nothing, and prints no secrets.
//
//   PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... PAYPAL_WEBHOOK_ID=... \
//     node scripts/paypal-doctor.mjs
//
// PowerShell:
//   $env:PAYPAL_CLIENT_ID="..."; $env:PAYPAL_CLIENT_SECRET="..."; $env:PAYPAL_WEBHOOK_ID="..."
//   node scripts/paypal-doctor.mjs
//
// PAYPAL_ENV defaults to "live"; set "sandbox" to check the sandbox app.
// Pass the deployed webhook URL to also check PayPal is pointed at it:
//   node scripts/paypal-doctor.mjs https://dayzcarrental.com/api/paypal

// Duplicated rather than imported so this runs from a bare checkout with no TS
// loader. A test in donations.test.ts asserts it matches the handler's list —
// a doctor checking for the wrong events would clear a webhook that credits
// nothing, which is worse than having no doctor.
const CREDIT_TYPES = ["PAYMENT.CAPTURE.COMPLETED", "PAYMENT.SALE.COMPLETED"];

const ok = (s) => console.log(`  ok   ${s}`);
const warn = (s) => console.log(` warn  ${s}`);
const note = (s) => console.log(`       ${s}`);

let failures = 0;
const fail = (s) => {
  failures++;
  console.log(` FAIL  ${s}`);
};

async function main() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  const env = (process.env.PAYPAL_ENV ?? "live").toLowerCase();
  const expectedUrl = process.argv[2];
  const base = env === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";

  const missing = [
    ["PAYPAL_CLIENT_ID", clientId],
    ["PAYPAL_CLIENT_SECRET", clientSecret],
  ].filter(([, v]) => !v);
  if (missing.length > 0) {
    console.error(`Missing: ${missing.map(([k]) => k).join(", ")}. See DEPLOY.md section 5.`);
    return 1;
  }

  console.log(`PayPal environment: ${env}  (${base})\n`);

  // --- 1. do the credentials work, and for which app? -----------------------
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const tokenRes = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: { authorization: `Basic ${auth}`, "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!tokenRes.ok) {
    fail(`credentials rejected (HTTP ${tokenRes.status}). ${(await tokenRes.text()).slice(0, 200)}`);
    if (tokenRes.status === 401) {
      note(`→ the client id/secret are wrong for ${env}. A sandbox key against live`);
      note(`  (or the reverse) fails exactly like this — check PAYPAL_ENV.`);
    }
    return 1;
  }
  const token = (await tokenRes.json()).access_token;
  ok(`credentials authenticate against ${env}`);

  const api = async (path) => {
    const res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  // --- 2. which webhooks does THIS app own? ---------------------------------
  // The heart of it. A webhook created under a different app is invisible here,
  // and that is indistinguishable from having no webhook at all.
  const list = await api("/v1/notifications/webhooks");
  if (list.status !== 200) {
    fail(`could not list webhooks (HTTP ${list.status}). ${JSON.stringify(list.body).slice(0, 200)}`);
    return 1;
  }
  const webhooks = list.body?.webhooks ?? [];
  ok(`this app owns ${webhooks.length} webhook(s)`);
  for (const w of webhooks) {
    note(`${w.id}  ${w.url}`);
    note(`events: ${(w.event_types ?? []).map((e) => e.name).join(", ") || "(none)"}`);
  }
  if (webhooks.length === 0) {
    fail("this app owns no webhooks at all — nothing will ever POST to /api/paypal.");
    note("→ either create one in the dashboard under THIS app, or the webhook you created");
    note("  belongs to a different app and PAYPAL_CLIENT_ID points at the wrong one.");
  }

  // --- 3. does PAYPAL_WEBHOOK_ID name one of them? --------------------------
  // Signature verification binds to this id. A mismatch doesn't stop delivery —
  // it makes every delivery fail verification and 401, which looks like silence.
  if (!webhookId) {
    fail("PAYPAL_WEBHOOK_ID is not set — every delivery would fail verification and credit nothing.");
  } else if (webhooks.some((w) => w.id === webhookId)) {
    ok("PAYPAL_WEBHOOK_ID matches a webhook owned by this app");
  } else {
    fail(`PAYPAL_WEBHOOK_ID (${webhookId}) is not owned by this app.`);
    note("→ the most likely cause. Set it to one of the ids listed above, or point");
    note("  PAYPAL_CLIENT_ID at the app that owns that webhook.");
  }

  // --- 4. subscribed to the events we actually credit? ----------------------
  const target = webhooks.find((w) => w.id === webhookId) ?? webhooks[0];
  if (target) {
    const names = new Set((target.event_types ?? []).map((e) => e.name));
    const absent = names.has("*") ? [] : CREDIT_TYPES.filter((t) => !names.has(t));
    if (absent.length === 0) {
      ok(`subscribed to the events we credit (${CREDIT_TYPES.join(", ")})`);
    } else {
      fail(`not subscribed to: ${absent.join(", ")}`);
      note("→ PayPal would deliver other events we ignore, so the log looks alive while");
      note("  the balance never moves. Add these in the dashboard.");
    }

    // --- 5. is PayPal pointed at the deployment? ----------------------------
    if (expectedUrl) {
      if (target.url === expectedUrl) ok(`notification URL matches ${expectedUrl}`);
      else fail(`notification URL is ${target.url}, expected ${expectedUrl}`);
    } else {
      warn(`notification URL is ${target.url} — pass your live URL as an argument to check it`);
    }
    if (target.url?.startsWith("http://")) {
      fail("notification URL is http:// — PayPal requires https and will not deliver.");
    }
  }

  // --- 6. what has PayPal actually tried to send? ---------------------------
  // The decisive evidence. An empty log means delivery was never attempted;
  // entries with a non-SUCCESS status mean it was attempted and we rejected it.
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 19) + "Z";
  const events = await api(`/v1/notifications/webhooks-events?page_size=20&start_time=${since}`);
  if (events.status === 200) {
    const items = events.body?.events ?? [];
    if (items.length === 0) {
      warn("no delivery attempts in the last 30 days — PayPal has never tried to reach us.");
      note("→ consistent with the webhook belonging to another app, or simply no donations.");
    } else {
      ok(`${items.length} delivery attempt(s) in the last 30 days:`);
      for (const e of items.slice(0, 10)) {
        note(`${e.create_time}  ${e.event_type}  status=${e.status ?? "?"}`);
      }
      const failed = items.filter((e) => e.status && e.status !== "SUCCESS");
      if (failed.length > 0) {
        warn(`${failed.length} attempt(s) did not succeed — the endpoint rejected them.`);
        note("→ if PAYPAL_WEBHOOK_ID is wrong, verification fails and we answer 401.");
      }
    }
  } else {
    warn(`could not read the delivery log (HTTP ${events.status}) — not fatal.`);
  }

  console.log(
    failures === 0
      ? "\nNothing wrong found. If donations still only arrive via the reconciler, capture a\ndelivery attempt in the Vercel logs for /api/paypal and compare against the checks above."
      : `\n${failures} problem(s) found — fix the FAIL lines, redeploy, and make a small test donation.`,
  );
  return failures === 0 ? 0 : 1;
}

// Set the exit code and let the process end naturally. Calling process.exit()
// while an undici socket is still open aborts Node with a libuv assertion on
// Windows (UV_HANDLE_CLOSING in async.c): the diagnostic prints correctly and
// then the tool appears to crash — a poor look for something whose whole job is
// telling you what's wrong.
process.exitCode = await main();
