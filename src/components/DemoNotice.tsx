// Small reusable banner reminding visitors this is a non-functional mockup.
export default function DemoNotice({ children }: { children?: React.ReactNode }) {
  return (
    <div className="notice notice--demo" role="note">
      <strong>Early days.</strong>{" "}
      {/* This used to say "forms don't send anything", which stopped being true
          once the rent, donate-a-car and list-your-server forms started
          recording what people tell us. A notice that overstates how inert the
          site is fails in the same direction as the old /donate one. */}
      {children ??
        "Renting isn't automated yet — tell us what you're after and a runner gets in touch. No payment is taken on this site; rentals are paid in-game, to a person."}
    </div>
  );
}
