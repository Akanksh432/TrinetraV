"use client";

import React, { useEffect, useState } from "react";
import { useTelemetry } from "@/lib/TelemetryContext";
import { AlertTriangle, Power, Zap, WifiOff, Gamepad2, Volume2, VolumeX } from "lucide-react";

export default function FailsafeMonitor() {
  const { data, triggerEStop, resetEStop, toggleControlMode, toggleWifiDrop, toggleMuteSiren } = useTelemetry();
  const [countdown, setCountdown] = useState(400);

  // Watchdog Countdown Simulation
  useEffect(() => {
    let animationId: number;
    const updateCountdown = () => {
      const now = Date.now();
      const diff = now - data.status.lastPacketTime;
      const remaining = Math.max(0, 400 - diff);
      setCountdown(remaining);
      
      if (remaining === 0 && !data.status.isEStop && data.status.isSimulating) {
        triggerEStop("Watchdog Timeout (>400ms)");
      }
      
      animationId = requestAnimationFrame(updateCountdown);
    };
    
    updateCountdown();
    return () => cancelAnimationFrame(animationId);
  }, [data.status.lastPacketTime, data.status.isEStop, data.status.isSimulating, triggerEStop]);

  return (
    <div className="flex flex-col h-full w-full">
      <div className="flex items-center justify-between p-3 border-b border-tactical-border bg-black/40">
        <h2 className="text-sm font-bold flex items-center gap-2 text-zinc-300 tracking-widest">
          <Zap className="w-4 h-4 text-amber-500" />
          ACTUATION & FAILSAFE
        </h2>
        
        {/* Watchdog indicator */}
        <div className="flex items-center gap-2 text-xs font-mono">
          <span className="text-zinc-500">WDOG:</span>
          <span className={`${countdown > 200 ? 'text-emerald-500' : 'text-red-500'} w-12 text-right`}>
            {countdown.toFixed(0)}ms
          </span>
        </div>
      </div>

      <div className="flex-1 p-4 flex flex-col gap-4">
        
        {/* E-Stop Alert Banner */}
        {data.status.isEStop && (
          <div className="bg-red-950/50 border border-red-500 rounded p-3 flex flex-col items-center justify-center animate-pulse">
            <div className="flex items-center gap-2 text-red-500 font-bold tracking-widest mb-1">
              <AlertTriangle className="w-5 h-5" />
              FAILSAFE ACTIVE
            </div>
            <div className="text-xs font-mono text-red-300">
              REASON: {data.status.failsafeReason}
            </div>
            <div className="text-sm font-bold font-mono text-red-400 mt-1 tactical-glow-red">
              FAILSAFE: MOTORS HALTED
            </div>
          </div>
        )}

        {/* Actuation Display */}
        <div className="grid grid-cols-2 gap-4 flex-1">
          <div className="border border-zinc-800 bg-zinc-900/30 rounded p-3 flex flex-col items-center justify-center relative overflow-hidden">
            <div className="absolute top-2 left-2 text-xs text-zinc-500 font-mono">V_L</div>
            <div className={`text-3xl font-mono mt-2 ${data.status.isEStop ? 'text-zinc-600' : 'text-emerald-400 tactical-glow-emerald'}`}>
              {data.motors.leftSpeed.toFixed(2)}
            </div>
            <div className="text-xs text-zinc-500 mt-1">PWM</div>
          </div>
          
          <div className="border border-zinc-800 bg-zinc-900/30 rounded p-3 flex flex-col items-center justify-center relative overflow-hidden">
            <div className="absolute top-2 left-2 text-xs text-zinc-500 font-mono">V_R</div>
            <div className={`text-3xl font-mono mt-2 ${data.status.isEStop ? 'text-zinc-600' : 'text-emerald-400 tactical-glow-emerald'}`}>
              {data.motors.rightSpeed.toFixed(2)}
            </div>
            <div className="text-xs text-zinc-500 mt-1">PWM</div>
          </div>
        </div>

        {/* Control Buttons */}
        <div className="grid grid-cols-2 gap-3 mt-auto">
          {data.status.isEStop ? (
            <button 
              onClick={resetEStop}
              className="col-span-2 py-3 bg-amber-600 hover:bg-amber-500 text-black font-bold tracking-widest rounded flex items-center justify-center gap-2 transition-colors"
            >
              <Power className="w-4 h-4" /> MANUAL OVERRIDE (RESET)
            </button>
          ) : (
            <button 
              onClick={() => triggerEStop("User Triggered")}
              className="col-span-2 py-3 bg-red-600 hover:bg-red-500 text-white font-bold tracking-widest rounded flex items-center justify-center gap-2 transition-colors"
            >
              <AlertTriangle className="w-4 h-4" /> E-STOP
            </button>
          )}

          <button 
            onClick={toggleControlMode}
            className={`col-span-1 py-2 border border-zinc-700 font-bold text-[10px] tracking-widest rounded flex flex-col items-center justify-center gap-1 transition-colors ${data.status.controlMode === 'Manual' ? 'bg-amber-600/20 text-amber-500 border-amber-500/50' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'}`}
          >
            <Gamepad2 className="w-4 h-4" />
            {data.status.controlMode === 'Manual' ? 'WASD ACTIVE' : 'MANUAL OVERRIDE'}
          </button>
          
          <button 
            onClick={toggleWifiDrop}
            className={`col-span-1 py-2 border border-zinc-700 font-bold text-[10px] tracking-widest rounded flex flex-col items-center justify-center gap-1 transition-colors ${data.status.wifiDropped ? 'bg-red-600/20 text-red-500 border-red-500/50 animate-pulse' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'}`}
          >
            <WifiOff className="w-4 h-4" />
            {data.status.wifiDropped ? 'RECONNECT WI-FI' : 'SIM. WI-FI DROP'}
          </button>

          <button 
            onClick={toggleMuteSiren}
            className={`col-span-2 py-2 border border-zinc-700 font-bold text-[10px] tracking-widest rounded flex items-center justify-center gap-2 transition-colors ${data.status.muteSiren ? 'bg-zinc-800/50 text-zinc-500' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'}`}
          >
            {data.status.muteSiren ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            {data.status.muteSiren ? 'SIREN MUTED' : 'MUTE SIREN'}
          </button>
        </div>
      </div>
    </div>
  );
}
