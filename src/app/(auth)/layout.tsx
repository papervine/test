// Minimal centered shell for login/signup — no docs chrome, no app rail.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-950 px-4 text-neutral-100">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
