"use client";

import React, { createContext, useContext, useEffect, useState, useRef } from "react";
import { findPathAStar, Point2D } from "./pathfinding";

export type TelemetryLogEntry = {
  time: number;
  roll: number; pitch: number; yaw: number;
  leftSpeed: number; rightSpeed: number;
  x: number; y: number;
};

export type TelemetryData = {
  imu: { roll: number; pitch: number; yaw: number };
  encoders: { leftTicks: number; rightTicks: number; leftRpm: number; rightRpm: number; velocity: number };
  ultrasonic: { frontLeft: number; frontRight: number };
  ekf: { driftX: number; driftY: number; history: {x: number, y: number}[] };
  localization: { x: number; y: number; theta: number };
  motors: { leftSpeed: number; rightSpeed: number };
  navigation: {
    waypoint: Point2D | null;
    path: Point2D[];
    obstacles: Point2D[];
    status: "Clear" | "Rerouting" | "Blocked" | "Idle";
  };
  status: { 
    isEStop: boolean; 
    lastPacketTime: number; 
    isSimulating: boolean;
    failsafeReason: string | null;
    controlMode: "Auto" | "Manual";
    wifiDropped: boolean;
    muteSiren: boolean;
  };
  logs: TelemetryLogEntry[];
};

const defaultData: TelemetryData = {
  imu: { roll: 0, pitch: 0, yaw: 0 },
  encoders: { leftTicks: 0, rightTicks: 0, leftRpm: 0, rightRpm: 0, velocity: 0 },
  ultrasonic: { frontLeft: 100, frontRight: 100 },
  ekf: { driftX: 0, driftY: 0, history: [] },
  localization: { x: 10, y: 10, theta: -Math.PI / 2 }, // Pointing "UP"
  motors: { leftSpeed: 0, rightSpeed: 0 },
  navigation: { waypoint: null, path: [], obstacles: [], status: "Idle" },
  status: { isEStop: false, lastPacketTime: Date.now(), isSimulating: true, failsafeReason: null, controlMode: "Auto", wifiDropped: false, muteSiren: true },
  logs: [],
};

type TelemetryContextType = {
  data: TelemetryData;
  isConnected: boolean;
  obstacles: any[];
  toggleSimulation: () => void;
  triggerEStop: (reason?: string) => void;
  resetEStop: () => void;
  setWaypoint: (x: number, y: number) => void;
  toggleControlMode: () => void;
  toggleWifiDrop: () => void;
  exportLogs: () => void;
  toggleMuteSiren: () => void;
};

const TelemetryContext = createContext<TelemetryContextType | null>(null);

export const TelemetryProvider = ({ children }: { children: React.ReactNode }) => {
  const [data, setData] = useState<TelemetryData>(defaultData);
  const [isConnected, setIsConnected] = useState(false);
  const [obstacles, setObstacles] = useState<any[]>([]);
  const dataRef = useRef(data);
  const loopRef = useRef<number | null>(null);
  
  // Real-time backend obstacle data
  const backendObstaclesRef = useRef<Point2D[]>([]);

  // Manual input state
  const keys = useRef<{ [key: string]: boolean }>({});

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  // Keyboard Listeners for WASD
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { keys.current[e.key.toLowerCase()] = true; };
    const handleKeyUp = (e: KeyboardEvent) => { keys.current[e.key.toLowerCase()] = false; };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // WebSocket Connection for Real Data
  useEffect(() => {
    let ws: WebSocket;
    let reconnectTimer: number;

    const connectWS = () => {
      ws = new WebSocket("ws://127.0.0.1:8000/telemetry");
      
      ws.onopen = () => {
        console.log("WebSocket connected to backend.");
        setIsConnected(true);
      };
      
      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          // Update lastPacketTime on every valid message (if wifi is not dropped)
          if (!dataRef.current.status.wifiDropped) {
            setData((prev) => ({
              ...prev,
              status: { ...prev.status, lastPacketTime: Date.now() }
            }));
          }

          if (payload.obstacles && Array.isArray(payload.obstacles)) {
            setObstacles(payload.obstacles);
            
            // Map the obstacles from relative pixel coords to world grid coords
            // Assume rover is at data.localization, theta is heading
            // rel_x is horizontal pixel offset, rel_y is vertical

            // Let's use a simple linear map: 100 px = 1 meter
            const currentLoc = dataRef.current.localization;
            
            const mappedObstacles: Point2D[] = payload.obstacles.map((obs: any) => {
              const distForward = (obs.y_rel / 100) + 5; // Base 5 meters ahead + pixel offset
              const distRight = (obs.x_rel / 100);

              // Rotate by rover's theta to place globally
              const dx = distForward * Math.cos(currentLoc.theta) - distRight * Math.sin(currentLoc.theta);
              const dy = distForward * Math.sin(currentLoc.theta) + distRight * Math.cos(currentLoc.theta);

              return {
                x: currentLoc.x + dx,
                y: currentLoc.y + dy
              };
            });

            backendObstaclesRef.current = mappedObstacles;
          }
        } catch (e) {
          console.error("Failed to parse WS data", e);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        console.log("WebSocket disconnected. Retrying in 2s...");
        reconnectTimer = window.setTimeout(connectWS, 2000);
      };
      
      ws.onerror = (err) => {
        setIsConnected(false);
        console.warn("WebSocket Connection Failed. (Backend might not be running)");
        ws.close();
      };
    };

    connectWS();

    return () => {
      clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, []); // Connect once on mount

  const triggerEStop = (reason?: string) => {
    setData((prev) => ({
      ...prev,
      motors: { leftSpeed: 0, rightSpeed: 0 },
      status: { ...prev.status, isEStop: true, failsafeReason: reason || "Manual Override" },
    }));
  };

  const resetEStop = () => {
    setData((prev) => ({
      ...prev,
      status: { ...prev.status, isEStop: false, failsafeReason: null, wifiDropped: false, lastPacketTime: Date.now() },
    }));
  };

  const toggleSimulation = () => {
    setData((prev) => ({ ...prev, status: { ...prev.status, isSimulating: !prev.status.isSimulating } }));
  };

  const toggleControlMode = () => {
    setData((prev) => ({ ...prev, status: { ...prev.status, controlMode: prev.status.controlMode === "Auto" ? "Manual" : "Auto" } }));
  };

  const toggleWifiDrop = () => {
    setData((prev) => ({ ...prev, status: { ...prev.status, wifiDropped: !prev.status.wifiDropped } }));
  };

  const toggleMuteSiren = () => {
    setData((prev) => ({ ...prev, status: { ...prev.status, muteSiren: !prev.status.muteSiren } }));
  };

  const setWaypoint = (x: number, y: number) => {
    if (data.status.controlMode === "Manual") return;
    setData((prev) => ({ ...prev, navigation: { ...prev.navigation, waypoint: { x, y } } }));
  };

  const exportLogs = () => {
    const csvContent = "data:text/csv;charset=utf-8," 
      + "Time,X,Y,Roll,Pitch,Yaw,LeftSpeed,RightSpeed\n"
      + dataRef.current.logs.map(e => 
          `${e.time},${e.x.toFixed(2)},${e.y.toFixed(2)},${e.roll.toFixed(2)},${e.pitch.toFixed(2)},${e.yaw.toFixed(2)},${e.leftSpeed.toFixed(2)},${e.rightSpeed.toFixed(2)}`
        ).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `trinetra_telemetry_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Audio Alarm logic
  useEffect(() => {
    let audioCtx: AudioContext | null = null;
    let osc: OscillatorNode | null = null;

    if (data.status.isEStop && !data.status.muteSiren) {
      try {
        audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        osc.type = "square";
        osc.frequency.setValueAtTime(800, audioCtx.currentTime);
        osc.frequency.linearRampToValueAtTime(1200, audioCtx.currentTime + 0.5);
        osc.frequency.linearRampToValueAtTime(800, audioCtx.currentTime + 1.0);
        
        gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
        
        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        osc.start();
        
        const loopOsc = setInterval(() => {
          if (osc && audioCtx) {
            osc.frequency.setValueAtTime(800, audioCtx.currentTime);
            osc.frequency.linearRampToValueAtTime(1200, audioCtx.currentTime + 0.5);
            osc.frequency.linearRampToValueAtTime(800, audioCtx.currentTime + 1.0);
          }
        }, 1000);

        return () => {
          clearInterval(loopOsc);
          osc?.stop();
          audioCtx?.close();
        };
      } catch (e) {
        console.warn("Audio not allowed or supported yet.", e);
      }
    }
    
    return () => {
      osc?.stop();
      audioCtx?.close();
    }
  }, [data.status.isEStop]);

  // Simulation Loop for Odometry & A* Re-routing (using backend obstacles)
  useEffect(() => {
    loopRef.current = window.setInterval(() => {
      setData((prev) => {
        if (prev.status.isEStop) {
          // If e-stop, don't move, just keep state
          return prev;
        }

        const t = Date.now() / 1000;
        
        let velocity = 0;
        let steer = 0;
        let newX = prev.localization.x;
        let newY = prev.localization.y;
        let newTheta = prev.localization.theta;

        if (prev.status.controlMode === "Manual") {
          if (keys.current["w"]) velocity = 1.5;
          if (keys.current["s"]) velocity = -1.5;
          if (keys.current["a"]) steer = -1.0;
          if (keys.current["d"]) steer = 1.0;
        } else {
          // Auto
          if (prev.navigation.waypoint && prev.navigation.path.length > 1) {
            const nextTarget = prev.navigation.path[1];
            const targetX = nextTarget.x * 0.5 + 0.25;
            const targetY = nextTarget.y * 0.5 + 0.25;
            const dx = targetX - prev.localization.x;
            const dy = targetY - prev.localization.y;
            const desiredTheta = Math.atan2(dy, dx);
            
            let angleDiff = desiredTheta - prev.localization.theta;
            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
            while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

            steer = angleDiff * 2.0; 
            velocity = Math.abs(angleDiff) > 0.5 ? 0.5 : 1.2;
            
            const distToGoal = Math.hypot(prev.navigation.waypoint.x - prev.localization.x, prev.navigation.waypoint.y - prev.localization.y);
            if (distToGoal < 0.5) { velocity = 0; steer = 0; }
          } else if (!prev.navigation.waypoint) {
            velocity = 0;
            steer = 0;
          }
        }

        const dt = 0.1;
        newTheta += steer * dt;
        newX += velocity * Math.cos(newTheta) * dt;
        newY += velocity * Math.sin(newTheta) * dt;

        newX = Math.max(1, Math.min(19, newX));
        newY = Math.max(1, Math.min(19, newY));

        const fl = 50 + Math.sin(t * 1.5) * 40 + Math.random() * 5;
        const fr = 50 + Math.cos(t * 1.2) * 40 + Math.random() * 5;

        // Take obstacles exclusively from backend now (plus static boundaries if any, we can omit for now to see pure dynamic)
        const allObstacles = [...backendObstaclesRef.current];

        let newPath: Point2D[] = prev.navigation.path;
        let navStatus = prev.navigation.status;
        
        if (prev.status.controlMode === "Auto" && prev.navigation.waypoint) {
          const startGrid = { x: Math.floor(newX * 2), y: Math.floor(newY * 2) };
          const endGrid = { x: Math.floor(prev.navigation.waypoint.x * 2), y: Math.floor(prev.navigation.waypoint.y * 2) };
          // Run A* continuously to dynamically avoid the real obstacles sent by the backend WS
          const path = findPathAStar(40, allObstacles, startGrid, endGrid);
          if (path) {
            newPath = path;
            navStatus = "Clear";
          } else {
            navStatus = "Blocked";
            velocity = 0; 
            newPath = [];
          }
        }

        // EKF Drift Simulation
        const driftX = prev.ekf.driftX + (Math.random() - 0.5) * 0.05;
        const driftY = prev.ekf.driftY + (Math.random() - 0.5) * 0.05;
        const newHistory = [...prev.ekf.history, {x: driftX, y: driftY}].slice(-50); 

        const leftSpeed = velocity - steer * 0.5;
        const rightSpeed = velocity + steer * 0.5;

        const newLogEntry = {
          time: Date.now(), roll: Math.sin(t * 2) * 2, pitch: Math.cos(t * 1.5) * 3, yaw: (newTheta * 180) / Math.PI,
          leftSpeed, rightSpeed, x: newX, y: newY
        };
        const newLogs = [...prev.logs, newLogEntry].slice(-500); 

        return {
          ...prev,
          imu: { roll: Math.sin(t * 2) * 2, pitch: Math.cos(t * 1.5) * 3, yaw: (newTheta * 180) / Math.PI },
          encoders: { leftTicks: prev.encoders.leftTicks + Math.abs(leftSpeed*10), rightTicks: prev.encoders.rightTicks + Math.abs(rightSpeed*10), leftRpm: leftSpeed * 60, rightRpm: rightSpeed * 60, velocity },
          ultrasonic: { frontLeft: fl, frontRight: fr },
          ekf: { driftX, driftY, history: newHistory },
          localization: { x: newX, y: newY, theta: newTheta },
          motors: { leftSpeed, rightSpeed },
          navigation: { ...prev.navigation, path: newPath, obstacles: allObstacles, status: navStatus },
          logs: newLogs
        };
      });
    }, 100);

    return () => {
      if (loopRef.current) clearInterval(loopRef.current);
    };
  }, []);

  return (
    <TelemetryContext.Provider value={{ data, isConnected, obstacles, toggleSimulation, triggerEStop, resetEStop, setWaypoint, toggleControlMode, toggleWifiDrop, exportLogs, toggleMuteSiren }}>
      {children}
    </TelemetryContext.Provider>
  );
};

export const useTelemetry = () => {
  const context = useContext(TelemetryContext);
  if (!context) throw new Error("useTelemetry must be used within TelemetryProvider");
  return context;
};
