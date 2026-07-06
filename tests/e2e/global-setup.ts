// Shared e2e DB constants. The actual database rebuild lives in tests/e2e/reset-db.mjs,
// which playwright.config runs as the first half of the webServer command — BEFORE
// `next dev` boots. It must not happen here: Playwright starts the webServer before
// globalSetup, so a rebuild from this hook drops the schema underneath the app's
// already-open connection pool (poisoned sockets → random "relation does not exist"
// 500s mid-suite) and leaves Next's warm data cache pointing at pre-drop state.
const HOST = "127.0.0.1:5432";
export const TEST_DB_URL = `postgres://papervine:papervine@${HOST}/papervine_test`;
