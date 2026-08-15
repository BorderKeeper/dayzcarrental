// The sentinel server id used when someone picks "Other / not listed" and
// types their own server name.
//
// Lives here rather than in ServerSelect.tsx so server-side modules (and the
// test runner, which can't parse TSX) can import it without pulling in a
// client component.
export const CUSTOM_SERVER = "__custom";
