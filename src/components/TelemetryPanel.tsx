"use client";

import React from "react";
import { useTelemetry } from "@/lib/TelemetryContext";
import { Cpu, Activity, Gauge } from "lucide-react";

export default function TelemetryPanel() {
  const { data } = useTelemetry();

  return (
    <div className="flex flex-col h-full w-full">
      <div className="flex items-center justify-between p-3 border-b border-tactical-border bg-black/40">
        <h2 className="text-sm font-bold flex items-center gap-2 text-zinc-300 tracking-widest">
          <Activity className="w-4 h-4 text-cyan-500" />
          TELEMETRY & SENSORS
        </h2>
      </div>
      <div className="flex-1 p-4 overflow-y-auto custom-scrollbar flex flex-col gap-6">
        
        {/* 3D Horizon Gauge (IMU) */}
        <div>
          <h3 className="text-xs font-bold text-zinc-500 mb-3 flex items-center gap-2">
            <Cpu className="w-3 h-3" /> MPU6050 ATTITUDE
          </h3>
          <div className="flex gap-4 items-center">
            {/* CSS Artificial Horizon */}
            <div className="w-24 h-24 rounded-full border-4 border-zinc-700 overflow-hidden relative bg-blue-900">
              <div 
                className="absolute w-[200%] h-[200%] bg-amber-900/80 -left-1/2"
                style={{ 
                  transform: `translateY(${50 + data.imu.pitch}%) rotate(${data.imu.roll}deg)`,
                  transformOrigin: "center top",
                  transition: "transform 0.1s linear"
                }}
              ></div>
              {/* Crosshair */}
              <div className="absolute top-1/2 left-1/2 w-8 h-[2px] bg-emerald-500 -translate-x-1/2 -translate-y-1/2"></div>
              <div className="absolute top-1/2 left-1/2 w-[2px] h-4 bg-emerald-500 -translate-x-1/2 -translate-y-1/2"></div>
            </div>
            
            <div className="flex-1 flex flex-col gap-2 font-mono text-sm">
              <div className="flex justify-between bg-zinc-900 px-2 py-1 rounded">
                <span className="text-zinc-500">PITCH</span>
                <span className="text-cyan-400">{data.imu.pitch.toFixed(1)}°</span>
              </div>
              <div className="flex justify-between bg-zinc-900 px-2 py-1 rounded">
                <span className="text-zinc-500">ROLL</span>
                <span className="text-cyan-400">{data.imu.roll.toFixed(1)}°</span>
              </div>
              <div className="flex justify-between bg-zinc-900 px-2 py-1 rounded">
                <span className="text-zinc-500">YAW</span>
                <span className="text-emerald-400">{(data.imu.yaw % 360).toFixed(1)}°</span>
              </div>
            </div>
          </div>
        </div>

        {/* Wheel Odometry */}
        <div>
          <h3 className="text-xs font-bold text-zinc-500 mb-3 flex items-center gap-2">
            <Gauge className="w-3 h-3" /> WHEEL ODOMETRY
          </h3>
          <div className="grid grid-cols-2 gap-2 font-mono text-xs">
            <div className="bg-zinc-900/50 p-2 rounded border border-zinc-800 flex flex-col items-center">
              <span className="text-zinc-500 mb-1">LEFT RPM</span>
              <span className="text-lg text-emerald-400">{data.encoders.leftRpm.toFixed(0)}</span>
            </div>
            <div className="bg-zinc-900/50 p-2 rounded border border-zinc-800 flex flex-col items-center">
              <span className="text-zinc-500 mb-1">RIGHT RPM</span>
              <span className="text-lg text-emerald-400">{data.encoders.rightRpm.toFixed(0)}</span>
            </div>
            <div className="bg-zinc-900/50 p-2 rounded border border-zinc-800 flex flex-col items-center">
              <span className="text-zinc-500 mb-1">LEFT TICKS</span>
              <span className="text-zinc-300">{data.encoders.leftTicks.toFixed(0)}</span>
            </div>
            <div className="bg-zinc-900/50 p-2 rounded border border-zinc-800 flex flex-col items-center">
              <span className="text-zinc-500 mb-1">RIGHT TICKS</span>
              <span className="text-zinc-300">{data.encoders.rightTicks.toFixed(0)}</span>
            </div>
          </div>
        </div>

        {/* EKF Sensor Fusion Widget */}
        <div>
          <h3 className="text-xs font-bold text-zinc-500 mb-3 flex items-center gap-2">
            <Activity className="w-3 h-3" /> EKF DRIFT ERROR (X,Y)
          </h3>
          <div className="relative w-full h-32 bg-zinc-900/50 rounded border border-zinc-800 overflow-hidden">
            {/* Grid background */}
            <div className="absolute inset-0 grid-bg opacity-50"></div>
            {/* Center crosshair */}
            <div className="absolute top-1/2 left-0 w-full h-[1px] bg-zinc-700"></div>
            <div className="absolute top-0 left-1/2 w-[1px] h-full bg-zinc-700"></div>
            
            {/* Scatter Plot Line */}
            <svg className="absolute inset-0 w-full h-full overflow-visible" viewBox="-2 -2 4 4" preserveAspectRatio="none">
              <polyline 
                fill="none" 
                stroke="#f59e0b" 
                strokeWidth="0.05"
                points={data.ekf.history.map(pt => `${pt.x},${pt.y}`).join(' ')}
              />
              <circle cx={data.ekf.driftX} cy={data.ekf.driftY} r="0.1" fill="#ef4444" className="animate-pulse" />
            </svg>
            
            <div className="absolute bottom-1 right-2 text-[10px] font-mono text-amber-500">
              [{data.ekf.driftX.toFixed(2)}, {data.ekf.driftY.toFixed(2)}]
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
