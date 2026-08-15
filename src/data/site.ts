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

// The site's sections, in nav order. `home` is the default Rent view.
//
// Labels are NOUNS, not calls to action: "Become a Maintainer" reads fine as a
// page heading and badly as a tab, and once there were seven of them the bar
// wrapped and orphaned "Donate" onto a row of its own. The pages keep their
// inviting headings — a nav names a destination, a heading makes the pitch.
export const NAV = [
  { href: "/", label: "Rent a Car" },
  { href: "/donate-a-car", label: "Donate a Car" },
  { href: "/list-your-server", label: "List Your Server" },
  { href: "/maintainer", label: "Maintainers" },
  { href: "/runner", label: "Runners" },
  { href: "/governance", label: "Governance" },
  { href: "/donate", label: "Donate" },
] as const;
