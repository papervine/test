// Shared E2E constants. Plain module (not a test/setup file) so specs can import it
// without Playwright's "test file should not import test file" guard.
export const TEST_USER = {
  name: "Test User",
  email: "test@papervine.test",
  password: "e2e-password-123",
  org: "Test Org",
};

// E2E_PORT mirrors playwright.config's PORT (3210). The app host (baseURL) serves the
// control plane; the apex serves tenant docs.
export const E2E_PORT = 3210;

// The org's slug = slugify(org name). The control plane is URL-scoped (SPEC §10), so
// per-site pages live at /:org/:site/… on the app host — specs target their own site by
// URL (deterministic, no shared active-site cookie). baseURL is the app host, so these
// are relative.
export const ORG_SLUG = "test-org";
export const sitePath = (siteSlug: string, sub = "") =>
  `/${ORG_SLUG}/${siteSlug}${sub ? `/${sub}` : ""}`;

// Tenant docs serve on the apex (path mode /sites/{slug}), not the app host — the
// tenant-render spec addresses them absolutely since baseURL points at the app host.
export const APEX_ORIGIN = `http://127.0.0.1:${E2E_PORT}`;
