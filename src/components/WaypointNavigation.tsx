"use client";

import React from "react";
import { useTelemetry } from "@/lib/TelemetryContext";
import { Navigation, Route, AlertCircle } from "lucide-react";

export default function WaypointNavigation() {
  const { data } = useTelemetry();
  const { waypoint, status, path } = data.navigation;
  
  // Calculate distance
  const dist = waypoint 
    ? Math.hypot(waypoint.x - data.localization.x, waypoint.y - data.localization.y) 
    : 0;
    
  // Calculate heading error
  let headingError = 0;
  if (waypoint) {
    const dx = waypoint.x - data.localization.x;
    const dy = waypoint.y - data.localization.y;
    const desiredTheta = Math.atan2(dy, dx);
    headingError = (desiredTheta - data.localization.theta) * (180 / Math.PI);
    
    // Normalize to -180 to 180
    while (headingError > 180) headingError -= 360;
    while (headingError < -180) headingError += 360;
  }

  return (
    <div className="flex flex-col h-full w-full">
      <div className="flex items-center justify-between p-3 border-b border-tactical-border bg-black/40">
        <h2 className="text-sm font-bold flex items-center gap-2 text-zinc-300 tracking-widest">
          <Navigation className="w-4 h-4 text-emerald-500" />
          WAYPOINT NAV
        </h2>
      </div>
      
      <div className="flex-1 p-4 flex flex-col gap-4">
        {/* Status Indicator */}
        <div className="flex items-center justify-between bg-zinc-900/50 p-3 rounded border border-zinc-800">
          <span className="text-xs font-bold text-zinc-500 tracking-widest">A* PLANNER STATUS</span>
          <div className="flex items-center gap-2 font-mono text-sm">
            {status === "Clear" && <><Route className="w-4 h-4 text-emerald-500"/> <span className="text-emerald-500">CLEAR</span></>}
            {status === "Blocked" && <><AlertCircle className="w-4 h-4 text-red-500"/> <span className="text-red-500">BLOCKED</span></>}
            {status === "Rerouting" && <><Route className="w-4 h-4 text-amber-500"/> <span className="text-amber-500">REROUTING...</span></>}
            {status === "Idle" && <span className="text-zinc-500">IDLE - NO TARGET</span>}
          </div>
        </div>

        {/* Telemetry Metrics */}
        <div className="grid grid-cols-2 gap-4 flex-1">
          <div className="border border-zinc-800 bg-zinc-900/30 rounded p-3 flex flex-col items-center justify-center relative">
            <div className="absolute top-2 left-2 text-[10px] text-zinc-500 font-mono">TARGET [X, Y]</div>
            <div className="text-xl font-mono mt-4 text-emerald-400">
              {waypoint ? `${waypoint.x.toFixed(1)}, ${waypoint.y.toFixed(1)}` : "---, ---"}
            </div>
          </div>
          
          <div className="border border-zinc-800 bg-zinc-900/30 rounded p-3 flex flex-col items-center justify-center relative">
            <div className="absolute top-2 left-2 text-[10px] text-zinc-500 font-mono">DISTANCE</div>
            <div className="text-2xl font-mono mt-2 text-emerald-400">
              {waypoint ? dist.toFixed(2) : "0.00"}
            </div>
            <div className="text-[10px] text-zinc-500 mt-1">meters</div>
          </div>
          
          <div className="border border-zinc-800 bg-zinc-900/30 rounded p-3 flex flex-col items-center justify-center relative">
            <div className="absolute top-2 left-2 text-[10px] text-zinc-500 font-mono">HEADING ERROR</div>
            <div className={`text-2xl font-mono mt-2 ${Math.abs(headingError) > 20 ? 'text-amber-500' : 'text-emerald-400'}`}>
              {waypoint ? headingError.toFixed(1) : "0.0"}
            </div>
            <div className="text-[10px] text-zinc-500 mt-1">degrees</div>
          </div>
          
          <div className="border border-zinc-800 bg-zinc-900/30 rounded p-3 flex flex-col items-center justify-center relative">
            <div className="absolute top-2 left-2 text-[10px] text-zinc-500 font-mono">PATH LENGTH</div>
            <div className="text-2xl font-mono mt-2 text-cyan-400">
              {path.length > 0 ? (path.length * 0.5).toFixed(1) : "0.0"}
            </div>
            <div className="text-[10px] text-zinc-500 mt-1">meters</div>
          </div>
        </div>
      </div>
    </div>
  );
}
