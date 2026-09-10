"use client";

import type { CompassStatus } from "@/lib/types";
import { formatHeading } from "@/lib/format";

type CompassBadgeProps = {
  heading: number | null;
  status: CompassStatus;
};

export function CompassBadge({ heading, status }: CompassBadgeProps) {
  const rotation = heading ?? 0;
  const muted = status === "unavailable" || status === "needs-permission" || status === "unknown";

  return (
    <div
      className={`pointer-events-none flex items-center gap-3 rounded-2xl border px-3 py-2 backdrop-blur-md ${
        muted
          ? "border-white/10 bg-black/45 text-zinc-500"
          : "border-white/15 bg-black/55 text-zinc-100"
      }`}
    >
      <div
        className="relative grid h-12 w-12 place-items-center rounded-full border border-white/15 bg-zinc-950/80"
        aria-hidden
      >
        <div
          className="absolute inset-1 transition-transform duration-150 ease-out"
          style={{ transform: `rotate(${rotation}deg)` }}
        >
          <span className="absolute left-1/2 top-0.5 -translate-x-1/2 text-[10px] font-bold text-red-500">
            N
          </span>
          <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 text-[10px] text-zinc-500">
            S
          </span>
        </div>
        <span className="h-2 w-2 rounded-full bg-sky-400 shadow-[0_0_10px_#38bdf8]" />
      </div>
      <div className="min-w-[7.5rem] leading-tight">
        {status === "available" || status === "simulated" ? (
          <>
            <p className="text-sm font-semibold tabular-nums">
              {heading != null ? formatHeading(heading) : "—"}
            </p>
            <p className="text-[11px] uppercase tracking-wide text-zinc-400">
              {status === "simulated" ? "Simulated heading" : "Device heading"}
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-zinc-400">Compass unavailable</p>
            <p className="text-[11px] text-zinc-500">
              {status === "needs-permission" ? "Needs motion permission" : "Map stays north-up"}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
