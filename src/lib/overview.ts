// Pure helpers for the Site Overview home page (SPEC §10.3). Kept out of the page
// component so they're unit-testable with no DB/headers/cookies dependency.

export function partOfDay(hour: number): "morning" | "afternoon" | "evening" {
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

// The Activity feed's Live/Previews toggle maps onto `deployment.target`. Anything
// but the explicit "previews" param is the default Live view, so a stale/garbage
// query param degrades to Live rather than an empty feed.
export function parseFeedTarget(param: string | undefined): "live" | "preview" {
  return param === "previews" ? "preview" : "live";
}
