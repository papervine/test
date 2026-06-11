"use client";

import { useEffect, useState } from "react";
import { partOfDay } from "@/lib/overview";

// Time-of-day must come from the reader's clock, not the server's (UTC on Vercel) —
// otherwise an evening visitor gets "Good morning". This is a server-rendered page, so
// we compute the part-of-day on mount. State starts null so SSR and the first client
// render agree ("Hello, …"); the effect then upgrades to the localized greeting.
export function Greeting({ firstName }: { firstName: string }) {
  const [part, setPart] = useState<"morning" | "afternoon" | "evening" | null>(null);
  useEffect(() => setPart(partOfDay(new Date().getHours())), []);
  return (
    <>
      {part ? `Good ${part}` : "Hello"}, {firstName}
    </>
  );
}
