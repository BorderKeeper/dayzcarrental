// Small reusable banner reminding visitors this is a non-functional mockup.
export default function DemoNotice({ children }: { children?: React.ReactNode }) {
  return (
    <div className="notice notice--demo" role="note">
      <strong>Mockup preview.</strong>{" "}
      {children ??
        "Nothing here is live yet — forms don't send anything and no payment is taken. We're gauging interest and recruiting the crew."}
    </div>
  );
}
