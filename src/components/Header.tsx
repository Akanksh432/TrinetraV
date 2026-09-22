"use client";

import React, { useEffect, useState } from "react";
import { Activity, Power, Wifi, ShieldAlert, Download } from "lucide-react";
import { useTelemetry } from "@/lib/TelemetryContext";

export default function Header() {
  const { data, triggerEStop, resetEStop, exportLogs } = useTelemetry();
  const [missionTime, setMissionTime] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setMissionTime((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (secs: number) => {
    const h = Math.floor(secs / 3600).toString().padStart(2, "0");
    const m = Math.floor((secs % 3600) / 60).toString().padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${h}:${m}:${s}`;
  };

  return (
    <header className="flex flex-col xl:flex-row items-center justify-between border-b border-tactical-border pb-4 gap-4">
      <div className="flex items-center gap-4">
        <Activity className="text-emerald-500 w-8 h-8 animate-pulse" />
        <div>
          <h1 className="text-2xl font-bold tracking-wider text-zinc-100 flex items-center gap-2">
            TRINETRA <span className="text-emerald-500 font-mono text-xl">GCS</span>
          </h1>
          <div className="text-xs font-mono text-zinc-500 tracking-widest uppercase">
            Team Trinetra Innovators | SIH26126
          </div>
        </div>
      </div>
      
      <div className="flex items-center gap-4 xl:gap-6 text-sm font-mono text-zinc-400 bg-tactical-panel px-4 py-2 rounded border border-tactical-border flex-wrap justify-center">
        <div className="flex flex-col">
          <span className="text-[10px] text-zinc-500">MISSION TIME</span>
          <span className="text-lg text-emerald-400 tactical-glow-emerald">{formatTime(missionTime)}</span>
        </div>
        
        <div className="hidden sm:block h-8 w-px bg-zinc-700"></div>
        
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-xs">
            <Wifi className={`w-3 h-3 ${data.status.wifiDropped ? 'text-red-500 animate-ping' : 'text-emerald-500'}`} />
            <span>5.8GHz FPV ANALOG LINK</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className={`w-2 h-2 rounded-full ${data.status.wifiDropped ? 'bg-red-500' : 'bg-emerald-500 animate-pulse'}`}></span>
            <span>UDP TELEMETRY: {data.status.wifiDropped ? 'LOST' : 'OK'}</span>
          </div>
        </div>
        
        <div className="hidden sm:block h-8 w-px bg-zinc-700"></div>
        
        <button 
          onClick={exportLogs}
          className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 rounded flex items-center gap-2 transition-colors text-xs"
        >
          <Download className="w-3 h-3" /> EXPORT LOG
        </button>

        {data.status.isEStop ? (
          <button 
            onClick={resetEStop}
            className="px-3 py-1 bg-amber-600/20 text-amber-500 border border-amber-500/50 hover:bg-amber-600/40 rounded flex items-center gap-2 transition-colors text-xs"
          >
            <Power className="w-4 h-4" /> RESET
          </button>
        ) : (
          <button 
            onClick={() => triggerEStop("Header Button")}
            className="px-3 py-1 bg-red-600/20 text-red-500 border border-red-500/50 hover:bg-red-600/40 rounded flex items-center gap-2 transition-colors text-xs font-bold"
          >
            <ShieldAlert className="w-4 h-4" /> E-STOP
          </button>
        )}
      </div>
    </header>
  );
}
