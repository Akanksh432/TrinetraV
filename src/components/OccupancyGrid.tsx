"use client";

import React, { useEffect, useRef } from "react";
import { useTelemetry } from "@/lib/TelemetryContext";
import { Map, MapPin } from "lucide-react";

export default function OccupancyGrid() {
  const { data, setWaypoint } = useTelemetry();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Simulation uses a 20x20 meter grid -> 40x40 cells (0.5m resolution)
    const WORLD_SIZE_M = 20; 
    const GRID_CELLS = 40;
    const PIXELS_PER_METER = canvas.width / WORLD_SIZE_M;
    const PIXELS_PER_CELL = canvas.width / GRID_CELLS;

    const draw = () => {
      const { width, height } = canvas;
      
      // Clear
      ctx.fillStyle = "#09090b"; // dark tactical bg
      ctx.fillRect(0, 0, width, height);

      // Draw Grid Lines
      ctx.strokeStyle = "rgba(39, 39, 42, 0.5)"; // subtle zinc-800
      ctx.lineWidth = 1;
      for (let i = 0; i <= GRID_CELLS; i++) {
        const pos = i * PIXELS_PER_CELL;
        ctx.beginPath();
        ctx.moveTo(pos, 0);
        ctx.lineTo(pos, height);
        ctx.stroke();
        
        ctx.beginPath();
        ctx.moveTo(0, pos);
        ctx.lineTo(width, pos);
        ctx.stroke();
      }

      // Draw Obstacles (red/orange hash pattern simulation)
      ctx.fillStyle = "rgba(239, 68, 68, 0.4)"; // red
      ctx.strokeStyle = "rgba(245, 158, 11, 0.8)"; // amber border
      
      data.navigation.obstacles.forEach(obs => {
        const px = obs.x * PIXELS_PER_CELL;
        const py = obs.y * PIXELS_PER_CELL;
        ctx.fillRect(px, py, PIXELS_PER_CELL, PIXELS_PER_CELL);
        ctx.strokeRect(px, py, PIXELS_PER_CELL, PIXELS_PER_CELL);
      });

      // Draw Traversed Trail (cyan dots) - simple simulation here just showing a small tail
      // In a real app we'd save historical points. For now, draw a short trail behind rover.
      ctx.fillStyle = "rgba(6, 182, 212, 0.5)";
      for (let i = 1; i < 5; i++) {
        const trailX = data.localization.x - Math.cos(data.localization.theta) * (i * 0.5);
        const trailY = data.localization.y - Math.sin(data.localization.theta) * (i * 0.5);
        ctx.beginPath();
        ctx.arc(trailX * PIXELS_PER_METER, trailY * PIXELS_PER_METER, 2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Draw A* Path (Glowing Emerald Spline)
      if (data.navigation.path.length > 0) {
        ctx.strokeStyle = "rgba(16, 185, 129, 0.8)"; // Emerald
        ctx.lineWidth = 3;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.shadowColor = "rgba(16, 185, 129, 0.8)";
        ctx.shadowBlur = 10;
        
        ctx.beginPath();
        data.navigation.path.forEach((pt, index) => {
          // Center of the cell
          const px = pt.x * PIXELS_PER_CELL + PIXELS_PER_CELL / 2;
          const py = pt.y * PIXELS_PER_CELL + PIXELS_PER_CELL / 2;
          if (index === 0) {
            ctx.moveTo(px, py);
          } else {
            ctx.lineTo(px, py);
          }
        });
        ctx.stroke();
        ctx.shadowBlur = 0; // reset
      }

      // Draw Waypoint
      if (data.navigation.waypoint) {
        const wx = data.navigation.waypoint.x * PIXELS_PER_METER;
        const wy = data.navigation.waypoint.y * PIXELS_PER_METER;
        
        ctx.fillStyle = "#10b981";
        ctx.beginPath();
        ctx.arc(wx, wy, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();
        
        // Target crosshairs
        ctx.strokeStyle = "rgba(16, 185, 129, 0.5)";
        ctx.beginPath();
        ctx.moveTo(wx - 10, wy); ctx.lineTo(wx + 10, wy);
        ctx.moveTo(wx, wy - 10); ctx.lineTo(wx, wy + 10);
        ctx.stroke();
      }

      // Draw Rover
      const rx = data.localization.x * PIXELS_PER_METER;
      const ry = data.localization.y * PIXELS_PER_METER;
      
      ctx.save();
      ctx.translate(rx, ry);
      ctx.rotate(data.localization.theta); // radians

      // Rover Body
      ctx.fillStyle = "#3b82f6"; // blue
      ctx.fillRect(-8, -6, 16, 12);
      
      // Direction Indicator
      ctx.fillStyle = "#60a5fa";
      ctx.beginPath();
      ctx.moveTo(8, -6);
      ctx.lineTo(14, 0);
      ctx.lineTo(8, 6);
      ctx.fill();

      ctx.restore();
      
      // Draw Ultrasonic Cones (simulated based on values)
      const drawCone = (offsetY: number, distance: number, angleOffset: number) => {
        ctx.save();
        ctx.translate(rx, ry);
        ctx.rotate(data.localization.theta + angleOffset);
        
        const distPx = (distance / 100) * PIXELS_PER_METER; // cm to m to px
        ctx.fillStyle = distance < 30 ? "rgba(239, 68, 68, 0.2)" : "rgba(245, 158, 11, 0.2)";
        ctx.beginPath();
        ctx.moveTo(0, offsetY);
        ctx.arc(0, offsetY, Math.min(distPx, 100), -Math.PI/6, Math.PI/6);
        ctx.lineTo(0, offsetY);
        ctx.fill();
        ctx.restore();
      };
      
      drawCone(-4, data.ultrasonic.frontLeft, -0.2);
      drawCone(4, data.ultrasonic.frontRight, 0.2);
    };

    let animationId: number;
    const renderLoop = () => {
      draw();
      animationId = requestAnimationFrame(renderLoop);
    };
    renderLoop();

    return () => cancelAnimationFrame(animationId);
  }, [data]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    
    const WORLD_SIZE_M = 20;
    const PIXELS_PER_METER = canvas.width / WORLD_SIZE_M;
    
    setWaypoint(x / PIXELS_PER_METER, y / PIXELS_PER_METER);
  };

  return (
    <div className="flex flex-col h-full w-full">
      <div className="flex items-center justify-between p-3 border-b border-tactical-border bg-black/40">
        <h2 className="text-sm font-bold flex items-center gap-2 text-zinc-300 tracking-widest">
          <Map className="w-4 h-4 text-blue-500" />
          A* OCCUPANCY GRID
        </h2>
        {data.navigation.waypoint && (
          <div className="text-xs font-mono text-zinc-400 flex items-center gap-1">
            <MapPin className="w-3 h-3 text-emerald-500" />
            TARGET: [{data.navigation.waypoint.x.toFixed(1)}, {data.navigation.waypoint.y.toFixed(1)}]
          </div>
        )}
      </div>
      <div className="flex-1 p-4 flex items-center justify-center bg-zinc-950">
        <div className="relative w-full max-w-[400px] aspect-square rounded overflow-hidden border border-zinc-800">
          <canvas
            ref={canvasRef}
            width={400}
            height={400}
            onClick={handleCanvasClick}
            className="w-full h-full cursor-crosshair bg-tactical-bg"
          />
        </div>
      </div>
    </div>
  );
}
