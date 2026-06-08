// Shared E2E constants. Plain module (not a test/setup file) so specs can import it
// without Playwright's "test file should not import test file" guard.
export const TEST_USER = {
  name: "Test User",
  email: "test@docbot.test",
  password: "e2e-password-123",
  org: "Test Org",
};
