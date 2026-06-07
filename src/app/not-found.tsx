import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center px-8 py-32 text-center">
      <p className="text-sm font-semibold text-primary">404</p>
      <h1 className="mt-2 text-2xl font-bold text-zinc-900 dark:text-zinc-100">Page not found</h1>
      <p className="mt-2 text-zinc-500">That page doesn’t exist in this docs site.</p>
      <Link href="/" className="mt-6 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white">
        Back home
      </Link>
    </div>
  );
}
