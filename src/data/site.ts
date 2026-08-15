// Central place for brand strings and external links.
//
// These are LIVE links, not placeholders — check with the founder before
// changing one. An expired Discord invite silently closes the only door into
// the community, so the invite must be created with "Expire after: Never" and
// "Max uses: No limit".

export const SITE = {
  name: "DayzCarRental.com",
  tagline: "Community car rentals for DayZ survivors — since 2026",
  // LIVE, non-expiring Discord invite.
  discordInvite: "https://discord.gg/aRANqAyFvY",
  // LIVE PayPal payment link — this charges REAL MONEY. Do not treat it as a
  // placeholder. NEXT_PUBLIC_PAYPAL_DONATE_URL can override it (e.g. point at
  // a PayPal sandbox link for testing).
  paypalDonate: "https://www.paypal.com/ncp/payment/WE95V8M8MRPG4",
  // Contact shown in the retro footer.
  contactEmail: "ops@dayzcarrental.com",
};

// The five site functions, in nav order. `home` is the default Rent view.
export const NAV = [
  { href: "/", label: "Rent a Car" },
  { href: "/donate-a-car", label: "Donate a Car" },
  { href: "/list-your-server", label: "List Your Server" },
  { href: "/maintainer", label: "Become a Maintainer" },
  { href: "/runner", label: "Become a Runner" },
  { href: "/governance", label: "How Governance Works" },
  { href: "/donate", label: "Donate" },
] as const;
