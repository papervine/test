import Link from "next/link";
import { Button as UIButton } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Platform action — a thin wrapper over the shadcn <Button> primitive that keeps the
// auth/app call sites' API (`full` for a block button, plus a navigation <ButtonLink>).
// The blue→violet gradient (`primary`) and quiet outline (`ghost`) come from the shared
// primitive, so every button matches the landing. Use <Button> for form actions and
// <ButtonLink> for navigation.
type Variant = "primary" | "ghost";
type Size = "sm" | "md";

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
  className,
  ...props
}: StyleProps & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <UIButton
      variant={variant}
      size={size}
      className={cn(full && "w-full", className)}
      {...props}
    />
  );
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  full = false,
  className,
  href,
  external = false,
  children,
}: StyleProps & {
  href: string;
  external?: boolean;
  children: React.ReactNode;
}) {
  return (
    <UIButton
      asChild
      variant={variant}
      size={size}
      className={cn(full && "w-full", className)}
    >
      {external ? (
        <a href={href}>{children}</a>
      ) : (
        <Link href={href}>{children}</Link>
      )}
    </UIButton>
  );
}
