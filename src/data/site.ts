// Central place for brand strings and placeholder external links.
// Swap these for the real URLs when they exist.

export const SITE = {
  name: "DayzCarRental.com",
  tagline: "Community car rentals for DayZ survivors — since 2026",
  // Placeholder links — replace before launch.
  discordInvite: "https://discord.gg/your-invite-here",
  paypalDonate: "https://www.paypal.com/donate/?hosted_button_id=REPLACE_ME",
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
