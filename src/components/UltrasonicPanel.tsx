"use client";

import React from "react";
import { useTelemetry } from "@/lib/TelemetryContext";
import { Radio } from "lucide-react";

export default function UltrasonicPanel() {
  const { data } = useTelemetry();
  
  const renderRadar = (dist: number, label: string) => {
    const isDanger = dist < 30;
    const maxDist = 100; // max vis dist cm
    const pct = Math.max(0, Math.min(100, (dist / maxDist) * 100));
    
    return (
      <div className={`relative flex flex-col items-center justify-center p-4 border rounded ${isDanger ? 'border-red-500/50 bg-red-950/20' : 'border-zinc-800 bg-zinc-900/30'}`}>
        <div className="text-xs text-zinc-500 mb-2 font-mono tracking-widest">{label}</div>
        
        {/* Simple Radar Arc Viz */}
        <div className="relative w-32 h-16 overflow-hidden flex items-end justify-center">
          {/* Arcs */}
          <div className="absolute w-48 h-48 rounded-full border border-zinc-700/50"></div>
          <div className="absolute w-32 h-32 rounded-full border border-zinc-700/50"></div>
          <div className="absolute w-16 h-16 rounded-full border border-zinc-700/50"></div>
          
          {/* Reading Indicator */}
          <div 
            className={`absolute w-full h-full rounded-full transition-all duration-100 ${isDanger ? 'bg-red-500/30' : 'bg-emerald-500/30'}`}
            style={{
              transform: `scale(${pct / 100})`,
              transformOrigin: "center bottom"
            }}
          ></div>
        </div>
        
        <div className={`text-2xl font-mono mt-3 ${isDanger ? 'text-red-400 tactical-glow-red animate-pulse' : 'text-emerald-400'}`}>
          {dist.toFixed(0)} <span className="text-xs text-zinc-500">cm</span>
        </div>
        
        {isDanger && <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-red-500 animate-ping"></div>}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full w-full">
      <div className="flex items-center justify-between p-3 border-b border-tactical-border bg-black/40">
        <h2 className="text-sm font-bold flex items-center gap-2 text-zinc-300 tracking-widest">
          <Radio className="w-4 h-4 text-emerald-500" />
          ULTRASONIC RADAR
        </h2>
      </div>
      <div className="flex-1 p-4 grid grid-cols-2 gap-4">
        {renderRadar(data.ultrasonic.frontLeft, "FRONT-LEFT")}
        {renderRadar(data.ultrasonic.frontRight, "FRONT-RIGHT")}
      </div>
    </div>
  );
}
