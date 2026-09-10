import { Suspense } from "react";
import { RadarDashboard } from "@/components/RadarDashboard";

export default function Home() {
  return (
    <Suspense fallback={<div className="h-dvh w-full bg-[#0b0d10]" />}>
      <RadarDashboard />
    </Suspense>
  );
}
