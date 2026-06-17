import { ArticleSkeleton } from "@/components/docs/ArticleSkeleton";

// Instant feedback while the article segment renders: the persistent shell (navbar +
// sidebar) stays put and only this skeleton swaps in.
export default function TenantDocsLoading() {
  return <ArticleSkeleton />;
}
