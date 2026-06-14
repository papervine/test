import Image from "next/image";
import { Wordmark } from "@/components/Wordmark";
import papervineLogo from "@/assets/papervine-logo.png";

const SIZES = {
  sm: { px: 20, text: "text-sm" },
  md: { px: 32, text: "text-lg" },
  lg: { px: 40, text: "text-2xl" },
} as const;

/**
 * The Papervine brand lockup — logo mark + wordmark — used as the top-left logo
 * across the marketing / auth / legal chrome. Wrap it in a <Link> at the call site.
 *
 * The logo is a static import, so it's served from /_next/ (excluded from the apex
 * asset-rewrite middleware that sends root *.png to the docs content handler) and
 * optimized by next/image down from the 1254² source. Set `priority` for the
 * above-the-fold header instances. The docs renderer's navbar uses the per-site
 * logo from docs.json instead, so this lives in the web app, not @papervine/renderer.
 */
export function Brand({
  size = "md",
  priority = false,
  className = "",
}: {
  size?: keyof typeof SIZES;
  priority?: boolean;
  className?: string;
}) {
  const { px, text } = SIZES[size];
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <Image
        src={papervineLogo}
        alt=""
        aria-hidden
        width={px}
        height={px}
        priority={priority}
        className="rounded-lg"
      />
      <Wordmark className={text} />
    </span>
  );
}
