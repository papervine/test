import { ResetPasswordForm } from "./reset-password-form";

// Landing page for an emailed reset link. Better Auth validates the token at
// /api/auth/reset-password/:token and redirects here with `?token=` — or `?error=INVALID_TOKEN`
// when it's expired or already spent.
//
// The token is read HERE rather than from `window` in the form (the pattern the other auth
// pages use for `?invite=`/`?error=`): a client-side read can't decide which state to render
// until after hydration, so the page would server-render empty and flash. `force-dynamic`
// because it reads searchParams per request.
//
// Unlike /forgot-password this stays available even with email unconfigured: a link minted
// while a provider WAS configured must still work.
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  return <ResetPasswordForm token={token ?? null} invalid={Boolean(error) || !token} />;
}
