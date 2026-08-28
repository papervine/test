import { Badge } from "@/components/ui/badge";
import { envBadge, resolveDeployEnv } from "@/lib/env";

// Corner marker so it's obvious at a glance you're NOT looking at production:
// "preview · branch" (violet) on a Vercel preview deploy, which is the environment that
// looks exactly like prod. Nothing in production, and nothing locally — see `envBadge`.
// Mounted globally in the root layout, so it shows on every surface (docs, auth,
// dashboard); fixed top-right and pointer-events-none so it can never intercept a click,
// though it can still SIT ON one: top-right is where the editor keeps Publish.
// Server component — reads env vars at request time.
export function EnvBadge() {
  const badge = envBadge(
    resolveDeployEnv(process.env.VERCEL_ENV, process.env.NODE_ENV),
  );
  if (!badge) return null;

  const branch = process.env.VERCEL_GIT_COMMIT_REF;
  const label =
    badge.variant === "preview" && branch
      ? `${badge.label} · ${branch}`
      : badge.label;

  return (
    <div
      className="pointer-events-none fixed right-3 top-3 z-50"
      aria-hidden
    >
      <Badge variant={badge.variant} className="uppercase tracking-wide">
        {label}
      </Badge>
    </div>
  );
}
