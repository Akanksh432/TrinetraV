/**
 * Dynamic Window Approach (DWA) local planner.
 *
 * A* (pathfinding.ts) gives a global sequence of grid waypoints. DWA sits
 * underneath it as the reactive layer: every control cycle it samples the
 * set of (v, omega) velocity commands actually reachable from the rover's
 * current speed given its acceleration limits (the "dynamic window"),
 * forward-simulates each candidate for a short horizon, throws out any that
 * would collide, and scores the survivors on heading-to-goal, obstacle
 * clearance, and forward speed. This is what makes avoidance "seamless"
 * (per the original success metric) instead of the previous behavior of
 * recomputing a brand new A* grid path every 100ms.
 *
 * Units: meters, radians, seconds -- everything here operates in world
 * frame, matching TelemetryData.localization and the metric obstacle
 * positions produced by the backend's IPM projector.
 */

export type Pose2D = { x: number; y: number; theta: number };

export type DwaObstacle = {
  x: number;
  y: number;
  avoidRadiusM: number;
  riskWeight: number;
};

export type DwaConfig = {
  maxSpeed: number;        // m/s
  minSpeed: number;        // m/s (reverse)
  maxYawRate: number;      // rad/s
  maxAccel: number;        // m/s^2
  maxYawAccel: number;     // rad/s^2
  velocityResolution: number;
  yawRateResolution: number;
  dt: number;              // simulation step, s
  predictTime: number;     // forward-simulation horizon, s
  robotRadiusM: number;    // rover footprint radius for collision checks
  headingWeight: number;
  clearanceWeight: number;
  velocityWeight: number;
};

export const DEFAULT_DWA_CONFIG: DwaConfig = {
  maxSpeed: 1.5,
  minSpeed: -0.4,
  maxYawRate: 2.2,
  maxAccel: 1.2,
  maxYawAccel: 3.5,
  velocityResolution: 0.05,
  yawRateResolution: 0.1,
  dt: 0.1,
  predictTime: 1.6,
  robotRadiusM: 0.28,
  headingWeight: 1.4,
  clearanceWeight: 1.8,
  velocityWeight: 0.6,
};

export type DwaResult = {
  v: number;
  omega: number;
  blocked: boolean; // true if every sampled trajectory collided (rover should hold position)
  trajectory: Pose2D[]; // best trajectory, for optional visualization
};

function simulateTrajectory(
  start: Pose2D,
  v: number,
  omega: number,
  cfg: DwaConfig
): Pose2D[] {
  const traj: Pose2D[] = [start];
  let { x, y, theta } = start;
  const steps = Math.max(1, Math.round(cfg.predictTime / cfg.dt));
  for (let i = 0; i < steps; i++) {
    theta += omega * cfg.dt;
    x += v * Math.cos(theta) * cfg.dt;
    y += v * Math.sin(theta) * cfg.dt;
    traj.push({ x, y, theta });
  }
  return traj;
}

/** Minimum clearance (signed: negative means collision) along a trajectory. */
function trajectoryClearance(traj: Pose2D[], obstacles: DwaObstacle[], cfg: DwaConfig): number {
  if (obstacles.length === 0) return Infinity;
  let minClearance = Infinity;
  for (const p of traj) {
    for (const obs of obstacles) {
      const d = Math.hypot(p.x - obs.x, p.y - obs.y);
      // Effective clearance shrinks faster for high-risk classes (people,
      // vehicles) by inflating their footprint with riskWeight.
      const requiredClearance = cfg.robotRadiusM + obs.avoidRadiusM * Math.max(1, obs.riskWeight * 0.4);
      const clearance = d - requiredClearance;
      if (clearance < minClearance) minClearance = clearance;
    }
  }
  return minClearance;
}

/**
 * Compute the next (v, omega) command.
 *
 * pose:        current EKF-estimated rover pose (world frame).
 * currentV/currentOmega: the command actually applied last cycle (needed to
 *              build the dynamic window from acceleration limits).
 * goal:        next target point in world frame -- normally the next A*
 *              waypoint a short distance ahead, not necessarily the final
 *              destination.
 * obstacles:   world-frame obstacles with per-class avoid radius/risk
 *              weight (see backend/obstacle_classes.py -- keep these in
 *              sync).
 */
export function computeDwaCommand(
  pose: Pose2D,
  currentV: number,
  currentOmega: number,
  goal: { x: number; y: number },
  obstacles: DwaObstacle[],
  cfg: DwaConfig = DEFAULT_DWA_CONFIG
): DwaResult {
  // Dynamic window: what's reachable in one control period given accel limits,
  // intersected with the rover's absolute speed limits.
  const vLow = Math.max(cfg.minSpeed, currentV - cfg.maxAccel * cfg.dt);
  const vHigh = Math.min(cfg.maxSpeed, currentV + cfg.maxAccel * cfg.dt);
  const wLow = Math.max(-cfg.maxYawRate, currentOmega - cfg.maxYawAccel * cfg.dt);
  const wHigh = Math.min(cfg.maxYawRate, currentOmega + cfg.maxYawAccel * cfg.dt);

  let bestScore = -Infinity;
  let best: DwaResult = { v: 0, omega: 0, blocked: true, trajectory: [pose] };
  let anyFeasible = false;

  for (let v = vLow; v <= vHigh + 1e-9; v += cfg.velocityResolution) {
    for (let omega = wLow; omega <= wHigh + 1e-9; omega += cfg.yawRateResolution) {
      const traj = simulateTrajectory(pose, v, omega, cfg);
      const clearance = trajectoryClearance(traj, obstacles, cfg);
      if (clearance < 0) continue; // collision course, discard

      anyFeasible = true;
      const endPose = traj[traj.length - 1];
      const angleToGoal = Math.atan2(goal.y - endPose.y, goal.x - endPose.x);
      let headingError = Math.abs(angleToGoal - endPose.theta);
      while (headingError > Math.PI) headingError -= 2 * Math.PI;
      headingError = Math.abs(headingError);
      const headingScore = Math.PI - headingError; // higher is better

      // Cap clearance's contribution so a very open field doesn't just
      // reward "drive in a straight line regardless of goal".
      const clearanceScore = Math.min(clearance, 2.0);
      const velocityScore = v; // prefer forward progress over crawling/reversing

      const score =
        cfg.headingWeight * headingScore +
        cfg.clearanceWeight * clearanceScore +
        cfg.velocityWeight * velocityScore;

      if (score > bestScore) {
        bestScore = score;
        best = { v, omega, blocked: false, trajectory: traj };
      }
    }
  }

  if (!anyFeasible) {
    // Every sampled trajectory collides -- hold position rather than guess.
    return { v: 0, omega: 0, blocked: true, trajectory: [pose] };
  }

  return best;
}
