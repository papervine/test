// Article-column skeleton shown (via loading.tsx) while a docs page's article segment
// renders. The persistent shell stays put, so navigation feels immediate instead of
// blocking on the server render. Shared by the /sites and custom-domain loading states.
export function ArticleSkeleton() {
  return (
    <div className="flex items-start gap-10 px-8 py-10" aria-busy="true" aria-label="Loading page">
      <div className="min-w-0 flex-1 animate-pulse space-y-4">
        <div className="h-3 w-24 rounded bg-zinc-100 dark:bg-white/10" />
        <div className="h-8 w-2/3 rounded bg-zinc-200 dark:bg-white/10" />
        <div className="h-4 w-5/6 rounded bg-zinc-100 dark:bg-white/5" />
        <div className="mt-8 space-y-3">
          <div className="h-4 w-full rounded bg-zinc-100 dark:bg-white/5" />
          <div className="h-4 w-11/12 rounded bg-zinc-100 dark:bg-white/5" />
          <div className="h-4 w-4/5 rounded bg-zinc-100 dark:bg-white/5" />
          <div className="h-40 w-full rounded-lg bg-zinc-100 dark:bg-white/5" />
          <div className="h-4 w-10/12 rounded bg-zinc-100 dark:bg-white/5" />
          <div className="h-4 w-3/4 rounded bg-zinc-100 dark:bg-white/5" />
        </div>
      </div>
      <div className="hidden w-56 shrink-0 animate-pulse space-y-3 lg:block">
        <div className="h-3 w-20 rounded bg-zinc-100 dark:bg-white/10" />
        <div className="h-3 w-32 rounded bg-zinc-100 dark:bg-white/5" />
        <div className="h-3 w-28 rounded bg-zinc-100 dark:bg-white/5" />
      </div>
    </div>
  );
}
