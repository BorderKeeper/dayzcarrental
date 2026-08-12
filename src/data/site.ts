// Central place for brand strings and placeholder external links.
// Swap these for the real URLs when they exist.

export const SITE = {
  name: "DayzCarRental.com",
  tagline: "Community car rentals for DayZ survivors — since 2026",
  // Placeholder links — replace before launch.
  discordInvite: "https://discord.gg/FGWmPeyeTJ",
  // LIVE PayPal payment link (real money). NEXT_PUBLIC_PAYPAL_DONATE_URL can
  // override this (e.g. point at a sandbox link for testing).
  paypalDonate: "https://www.paypal.com/ncp/payment/WE95V8M8MRPG4",
  // Contact shown in the retro footer.
  contactEmail: "ops@dayzcarrental.com",
};

// The five site functions, in nav order. `home` is the default Rent view.
export const NAV = [
  { href: "/", label: "Rent a Car" },
  { href: "/donate-a-car", label: "Donate a Car" },
  { href: "/maintainer", label: "Become a Maintainer" },
  { href: "/runner", label: "Become a Runner" },
  { href: "/donate", label: "Donate" },
] as const;
