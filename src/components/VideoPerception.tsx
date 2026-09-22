'use client';

import React, { useRef, useEffect } from 'react';
import { useTelemetry } from '@/lib/TelemetryContext';

interface Obstacle {
  label: string;
  bbox: [number, number, number, number]; // [x1, y1, x2, y2]
  conf: number;
}

export default function VideoPerception() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { obstacles, isConnected } = useTelemetry();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear previous drawing pass
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Render Dynamic Obstacles Received from TelemetryContext
    if (obstacles && obstacles.length > 0) {
      obstacles.forEach((obs: Obstacle) => {
        const [x1, y1, x2, y2] = obs.bbox;
        const width = x2 - x1;
        const height = y2 - y1;

        // Bounding Box
        ctx.strokeStyle = '#ef4444'; // Red-500
        ctx.lineWidth = 2;
        ctx.strokeRect(x1, y1, width, height);

        // Label Background Tag
        ctx.fillStyle = 'rgba(239, 68, 68, 0.85)';
        const labelText = `${obs.label.toUpperCase()} ${(obs.conf * 100).toFixed(0)}%`;
        ctx.font = '11px monospace';
        const textMetrics = ctx.measureText(labelText);
        ctx.fillRect(x1, y1 > 18 ? y1 - 18 : y1, textMetrics.width + 8, 18);

        // Label Text
        ctx.fillStyle = '#ffffff';
        ctx.fillText(labelText, x1 + 4, y1 > 18 ? y1 - 4 : y1 + 13);
      });
    }
  }, [obstacles]);

  return (
    <div className="relative w-full h-[400px] bg-zinc-950 rounded-lg border border-zinc-800 overflow-hidden flex flex-col">
      <div className="absolute top-3 left-3 z-10 flex items-center gap-2 px-2.5 py-1 bg-black/60 backdrop-blur rounded border border-zinc-700/50">
        <span
          className={`h-2 w-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`}
        />
        <span className="text-xs font-mono tracking-wider text-zinc-300 uppercase">
          {isConnected ? 'LIVE TELEMETRY FEED' : 'BACKEND DISCONNECTED'}
        </span>
      </div>

      {/* Primary Video Canvas Overlay */}
      <img src="http://127.0.0.1:8000/stream-video" className="absolute top-0 left-0 w-full h-full object-contain z-0" />
      <canvas
        ref={canvasRef}
        width={640}
        height={400}
        className="absolute top-0 left-0 w-full h-full object-contain pointer-events-none z-10"
      />
    </div>
  );
}
