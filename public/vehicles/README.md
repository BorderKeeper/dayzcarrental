# Vehicle images

The `.svg` files here are **original artwork made for this project**. They are
simple side-profile drawings, one per vehicle, sharing the site's palette.

Referenced from `src/data/vehicles.ts`:

- `sarka-120.svg` — compact sedan
- `olga-24.svg` — boxy compact hatchback
- `gunter-2.svg` — sport hatchback
- `ada-4x4.svg` — offroad 4x4
- `m3s-truck.svg` — heavy cargo truck

If a file is missing the card falls back to a labelled box, so the site still
works.

## Why drawings and not screenshots

This directory used to hold `.webp` photos taken from the DayZ wiki on Fandom.
That was a loose end in a project whose whole posture is careful non-commercial
compliance: the underlying images are Bohemia Interactive's, the wiki adds its
own licence terms on top, and we were redistributing them from our own domain
with no attribution and no permission we could point to.

Drawing our own removes the question rather than arguing it. There's no licence
to comply with, nothing to attribute, and no risk that a takedown quietly breaks
the fleet listing.

## Contributing a real photo

Screenshots are welcome and would look better than these drawings — with one
condition: **it has to be your own screenshot**, taken by you in-game.

- Don't take images from the wiki, Steam, YouTube, or another server's site.
  That's the exact problem this replaced.
- By opening a PR with a screenshot you're confirming you took it and you're
  happy for it to be used here.
- Keep the filename, use `.webp` or `.jpg`, roughly 4:3 or wider, and update the
  `image` path in `src/data/vehicles.ts` to match the new extension.
- A survivor standing next to the car gives a sense of scale and looks far more
  like the game than a clean studio shot would.

Bohemia's fan-content position is generous toward non-commercial projects like
this one, but that generosity covers *your* screenshots of the game — not
someone else's images lifted from another site.
