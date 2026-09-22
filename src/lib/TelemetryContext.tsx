"use client";

import React, { createContext, useContext, useEffect, useState, useRef } from "react";
import { findPathAStar, Point2D, PlannerObstacle } from "./pathfinding";
import { EKFLocalizer } from "./ekf";
import { computeDwaCommand, DwaObstacle, DEFAULT_DWA_CONFIG } from "./dwa";

// Meters-per-grid-cell used everywhere obstacles/pose are converted between
// world (meters) and planner-grid (cells) coordinates. Kept in one place so
// pathfinding.ts, dwa.ts, and this file never drift apart.
const GRID_RESOLUTION_M = 0.5;

// World-frame obstacle carrying the semantic metadata from
// backend/obstacle_classes.py, used by both A* (grid dilation) and DWA
// (clearance scoring).
type WorldObstacle = { x: number; y: number; label: string; avoidRadiusM: number; riskWeight: number; isDynamic: boolean };

function gaussianNoise(stdDev: number): number {
  // Box-Muller transform for approximately-normal sensor noise.
  const u1 = Math.max(Math.random(), 1e-9);
  const u2 = Math.random();
  return stdDev * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

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
  ekf: { driftX: number; driftY: number; history: {x: number, y: number}[]; positionStdM: number };
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
  ekf: { driftX: 0, driftY: 0, history: [], positionStdM: 0 },
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
  
  // Real-time backend obstacle data, with semantic class metadata attached
  // (label/avoidRadiusM/riskWeight/isDynamic from backend/obstacle_classes.py)
  const backendObstaclesRef = useRef<WorldObstacle[]>([]);

  // Canonical EKF localizer (real predict/update filter -- see ekf.ts).
  // This IS the rover's pose estimate; there is no ground-truth GPS to
  // compare against, which is the point of a GPS-denied filter. We also
  // track a noise-free `trueTheta/trueX/trueY` purely so the *simulation*
  // has something physically consistent to integrate before the EKF's
  // sensor noise is applied on top -- this stands in for "the physical
  // rover" until real encoder/IMU hardware replaces it.
  const ekfRef = useRef<EKFLocalizer>((() => {
    const ekf = new EKFLocalizer();
    ekf.state = [defaultData.localization.x, defaultData.localization.y, defaultData.localization.theta];
    return ekf;
  })());
  const groundTruthRef = useRef({ x: defaultData.localization.x, y: defaultData.localization.y, theta: defaultData.localization.theta });
  const lastCommandRef = useRef({ v: 0, omega: 0 });
  const tickCountRef = useRef(0);

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

            // Map obstacles using the backend's real IPM metric projection
            // (metric_pos = [distance_right_m, distance_forward_m] from
            // mapping.py's IPMProjector), not a guessed pixel-to-meter
            // ratio. Rotate into world frame using the EKF's current pose
            // estimate (the only pose estimate we have -- no GPS).
            const currentPose = ekfRef.current.pose();

            const mappedObstacles: WorldObstacle[] = payload.obstacles
              .filter((obs: any) => Array.isArray(obs.metric_pos))
              .map((obs: any) => {
                const distRight = obs.metric_pos[0];
                const distForward = obs.metric_pos[1];

                const dx = distForward * Math.cos(currentPose.theta) - distRight * Math.sin(currentPose.theta);
                const dy = distForward * Math.sin(currentPose.theta) + distRight * Math.cos(currentPose.theta);

                return {
                  x: currentPose.x + dx,
                  y: currentPose.y + dy,
                  label: obs.label ?? "unknown",
                  avoidRadiusM: obs.avoid_radius_m ?? 0.35,
                  riskWeight: obs.risk_weight ?? 1.0,
                  isDynamic: obs.is_dynamic ?? false,
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
        const dt = 0.1;
        tickCountRef.current += 1;

        // Current pose is the EKF's estimate -- this is the only "position"
        // the rest of the pipeline (A*, DWA, rendering) is allowed to see.
        const currentPose = ekfRef.current.pose();

        let velocity = 0;
        let omega = 0; // rad/s, replaces the old ad-hoc "steer" scalar
        let navStatus = prev.navigation.status;
        let newPath: Point2D[] = prev.navigation.path;

        // Obstacles in world frame, carrying semantic class metadata used by
        // both A* (grid dilation) and DWA (clearance scoring/weighting).
        const worldObstacles = backendObstaclesRef.current;

        if (prev.status.controlMode === "Manual") {
          if (keys.current["w"]) velocity = 1.5;
          if (keys.current["s"]) velocity = -1.5;
          if (keys.current["a"]) omega = -1.0;
          if (keys.current["d"]) omega = 1.0;
        } else if (prev.navigation.waypoint) {
          // 1. Global plan: A* over a coarse grid, obstacles dilated by
          // their semantic avoid radius (a 'person' pushes the path much
          // further away than a 'rock/obstacle' -- see obstacle_classes.py).
          const startGrid = { x: Math.floor(currentPose.x / GRID_RESOLUTION_M), y: Math.floor(currentPose.y / GRID_RESOLUTION_M) };
          const endGrid = { x: Math.floor(prev.navigation.waypoint.x / GRID_RESOLUTION_M), y: Math.floor(prev.navigation.waypoint.y / GRID_RESOLUTION_M) };
          const gridObstacles: PlannerObstacle[] = worldObstacles.map(o => ({
            x: o.x / GRID_RESOLUTION_M,
            y: o.y / GRID_RESOLUTION_M,
            radiusCells: o.avoidRadiusM / GRID_RESOLUTION_M,
          }));
          const path = findPathAStar(40, gridObstacles, startGrid, endGrid);

          const distToGoal = Math.hypot(prev.navigation.waypoint.x - currentPose.x, prev.navigation.waypoint.y - currentPose.y);

          if (distToGoal < 0.4) {
            navStatus = "Clear";
            newPath = [];
          } else if (path) {
            newPath = path;
            navStatus = "Clear";

            // 2. Local plan: DWA picks the next (v, omega) that makes
            // progress toward the next global waypoint while staying clear
            // of every obstacle's semantic footprint -- this is the
            // reactive layer A* alone doesn't provide.
            const lookahead = path.length > 2 ? path[2] : path[path.length - 1];
            const goalWorld = {
              x: lookahead.x * GRID_RESOLUTION_M + GRID_RESOLUTION_M / 2,
              y: lookahead.y * GRID_RESOLUTION_M + GRID_RESOLUTION_M / 2,
            };
            const dwaObstacles: DwaObstacle[] = worldObstacles.map(o => ({
              x: o.x,
              y: o.y,
              avoidRadiusM: o.avoidRadiusM,
              riskWeight: o.riskWeight,
            }));

            const command = computeDwaCommand(
              currentPose,
              lastCommandRef.current.v,
              lastCommandRef.current.omega,
              goalWorld,
              dwaObstacles,
              DEFAULT_DWA_CONFIG
            );

            if (command.blocked) {
              navStatus = "Blocked";
              velocity = 0;
              omega = 0;
            } else {
              velocity = command.v;
              omega = command.omega;
            }
          } else {
            navStatus = "Blocked";
            velocity = 0;
            omega = 0;
            newPath = [];
          }
        }

        lastCommandRef.current = { v: velocity, omega };

        // --- Ground truth vs. EKF estimate -------------------------------
        // groundTruthRef stands in for "the physical rover" until real
        // encoder/IMU hardware exists: it integrates the *commanded*
        // velocity/omega with no noise. The EKF only ever sees noisy
        // versions of that command (simulating real wheel-slip + gyro
        // noise), so it drifts from ground truth between corrections --
        // exactly like it would with real hardware.
        const gt = groundTruthRef.current;
        const newGtTheta = gt.theta + omega * dt;
        const newGt = {
          x: Math.max(1, Math.min(19, gt.x + velocity * Math.cos(newGtTheta) * dt)),
          y: Math.max(1, Math.min(19, gt.y + velocity * Math.sin(newGtTheta) * dt)),
          theta: newGtTheta,
        };
        groundTruthRef.current = newGt;

        // Simulated wheel-encoder + gyro noise fed into the EKF's predict step.
        const vNoisy = velocity * (1 + gaussianNoise(0.03));
        const omegaNoisy = omega * (1 + gaussianNoise(0.05)) + gaussianNoise(0.01);
        ekfRef.current.predict(vNoisy, omegaNoisy, dt);

        // Simulated absolute-heading IMU correction (~once per second),
        // standing in for a real MPU6050 AHRS fix until hardware is wired in.
        if (tickCountRef.current % 10 === 0) {
          ekfRef.current.updateHeading(newGt.theta + gaussianNoise(0.03));
        }

        // Clamp the EKF's own position estimate to the arena bounds so a
        // drifting filter can't wander the rendered pose off-canvas.
        ekfRef.current.state[0] = Math.max(1, Math.min(19, ekfRef.current.state[0]));
        ekfRef.current.state[1] = Math.max(1, Math.min(19, ekfRef.current.state[1]));

        const estimatedPose = ekfRef.current.pose();
        const newX = estimatedPose.x;
        const newY = estimatedPose.y;
        const newTheta = estimatedPose.theta;

        const fl = 50 + Math.sin(t * 1.5) * 40 + Math.random() * 5;
        const fr = 50 + Math.cos(t * 1.2) * 40 + Math.random() * 5;

        // ekf history/drift now reflects the *real* filter: how far the
        // estimate has actually diverged from ground truth, and the
        // filter's own reported uncertainty (position_std, from its
        // covariance), rather than an unconditioned random walk.
        const driftX = newX - newGt.x;
        const driftY = newY - newGt.y;
        const newHistory = [...prev.ekf.history, { x: newX, y: newY }].slice(-50);

        const leftSpeed = velocity - omega * 0.5;
        const rightSpeed = velocity + omega * 0.5;

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
          ekf: { driftX, driftY, history: newHistory, positionStdM: estimatedPose.positionStdM },
          localization: { x: newX, y: newY, theta: newTheta },
          motors: { leftSpeed, rightSpeed },
          navigation: { ...prev.navigation, path: newPath, obstacles: worldObstacles.map(o => ({ x: o.x, y: o.y })), status: navStatus },
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
