"use client";

import type { PeerInfo } from "./broadcast-provider";

/** Compact "who else is editing this page" indicator — a colored avatar per remote peer. */
export function PresenceDots({ peers }: { peers: PeerInfo[] }) {
  if (peers.length === 0) return null;
  return (
    <span className="flex items-center -space-x-1.5" title={`${peers.length} editing`}>
      {peers.slice(0, 4).map((p) => (
        <span
          key={p.clientId}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-white text-[10px] font-semibold text-white dark:border-neutral-900"
          style={{ backgroundColor: p.color }}
          title={p.name}
        >
          {p.name.charAt(0)}
        </span>
      ))}
      {peers.length > 4 && (
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-white bg-neutral-500 text-[10px] font-semibold text-white dark:border-neutral-900">
          +{peers.length - 4}
        </span>
      )}
    </span>
  );
}
