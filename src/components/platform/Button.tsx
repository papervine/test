import Link from "next/link";

// Platform action — the blue→violet gradient (`primary`) or quiet outline (`ghost`),
// shared by auth + app so every button matches the landing. Use <Button> for form
// actions and <ButtonLink> for navigation.
type Variant = "primary" | "ghost";
type Size = "sm" | "md";

const VARIANT: Record<Variant, string> = {
  primary: "db-cta text-white",
  ghost: "db-ring text-[var(--fg)]",
};
const SIZE: Record<Size, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
};

function classes(
  variant: Variant,
  size: Size,
  full: boolean,
  className: string,
) {
  return [
    "inline-flex items-center justify-center gap-2 rounded-lg font-medium",
    VARIANT[variant],
    SIZE[size],
    full ? "w-full" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

type StyleProps = {
  variant?: Variant;
  size?: Size;
  full?: boolean;
  className?: string;
};

export function Button({
  variant = "primary",
  size = "md",
  full = false,
  className = "",
  ...props
}: StyleProps & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={classes(variant, size, full, className)} {...props} />
  );
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  full = false,
  className = "",
  href,
  external = false,
  children,
}: StyleProps & {
  href: string;
  external?: boolean;
  children: React.ReactNode;
}) {
  const cls = classes(variant, size, full, className);
  return external ? (
    <a href={href} className={cls}>
      {children}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}
