"use client";

import React, { useEffect, useState } from "react";
import { Server, Wifi, Activity } from "lucide-react";

export default function SystemDiagnostics() {
  const [latency, setLatency] = useState({
    video: 24,
    ai: 18,
    planning: 10,
    udp: 5
  });

  const [rssi, setRssi] = useState(85);

  useEffect(() => {
    const timer = setInterval(() => {
      setLatency(prev => ({
        video: 20 + Math.random() * 5,
        ai: 15 + Math.random() * 5,
        planning: 8 + Math.random() * 4,
        udp: 4 + Math.random() * 2
      }));
      setRssi(prev => {
        const val = prev + (Math.random() - 0.5) * 5;
        return Math.max(40, Math.min(100, val));
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex flex-col h-full w-full">
      <div className="flex items-center justify-between p-3 border-b border-tactical-border bg-black/40">
        <h2 className="text-sm font-bold flex items-center gap-2 text-zinc-300 tracking-widest">
          <Server className="w-4 h-4 text-purple-500" />
          SYSTEM DIAGNOSTICS
        </h2>
      </div>
      <div className="flex-1 p-4 flex flex-col gap-6">
        
        {/* RSSI Gauge */}
        <div>
          <h3 className="text-xs font-bold text-zinc-500 mb-3 flex items-center gap-2">
            <Wifi className="w-3 h-3" /> 5.8GHz SIGNAL HEALTH
          </h3>
          <div className="flex items-center gap-4">
            <div className="text-2xl font-mono text-emerald-400 tactical-glow-emerald w-16 text-right">
              {rssi.toFixed(0)}%
            </div>
            <div className="flex-1 h-3 bg-zinc-800 rounded-full overflow-hidden flex">
              <div 
                className="h-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${rssi}%` }}
              ></div>
            </div>
          </div>
        </div>

        {/* Latency Counters */}
        <div>
          <h3 className="text-xs font-bold text-zinc-500 mb-3 flex items-center gap-2">
            <Activity className="w-3 h-3" /> LATENCY PIPELINE
          </h3>
          <div className="space-y-2 font-mono text-sm">
            <div className="flex justify-between items-center bg-zinc-900/50 px-2 py-1 rounded border border-zinc-800">
              <span className="text-zinc-400">VIDEO INGEST</span>
              <span className="text-emerald-400">{latency.video.toFixed(1)} ms</span>
            </div>
            <div className="flex justify-between items-center bg-zinc-900/50 px-2 py-1 rounded border border-zinc-800">
              <span className="text-zinc-400">AI INFERENCE</span>
              <span className="text-emerald-400">{latency.ai.toFixed(1)} ms</span>
            </div>
            <div className="flex justify-between items-center bg-zinc-900/50 px-2 py-1 rounded border border-zinc-800">
              <span className="text-zinc-400">PLANNING CYCLE</span>
              <span className="text-emerald-400">{latency.planning.toFixed(1)} ms</span>
            </div>
            <div className="flex justify-between items-center bg-zinc-900/50 px-2 py-1 rounded border border-zinc-800">
              <span className="text-zinc-400">UDP LOOPBACK</span>
              <span className="text-emerald-400">{latency.udp.toFixed(1)} ms</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
