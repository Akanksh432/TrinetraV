/**
 * Extended Kalman Filter for GPS-denied differential-drive localization.
 *
 * This is a direct TypeScript port of backend/localization.py's EKFLocalizer,
 * kept as the single canonical filter for the live dashboard simulation
 * (TelemetryContext.tsx) since that's currently where the rover's pose is
 * actually integrated frame-to-frame.
 *
 * It replaces the old `driftX/driftY = prev + (Math.random()-0.5)*0.05`
 * placeholder with a real predict/update filter:
 *   - predict(v, omega, dt): propagate [x, y, theta] from wheel-encoder
 *     velocity + IMU gyro yaw rate (the "dead reckoning" step).
 *   - updateHeading(imuYaw): correct accumulated gyro drift using an
 *     absolute IMU heading estimate (accelerometer/magnetometer AHRS).
 *     There is no GPS input anywhere in this filter -- that's the point.
 *
 * Until real encoder/IMU hardware is wired in over UDP, this filter is
 * driven by the same commanded (v, omega) used to move the simulated rover,
 * with injected sensor noise standing in for real hardware noise. The
 * filter math itself does not change when real sensors replace the
 * simulated ones -- only the values fed into predict()/updateHeading() do.
 */

export type Pose2D = { x: number; y: number; theta: number };

function wrapAngle(a: number): number {
  return ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
}

// 3x3 matrix helpers (kept local/minimal rather than pulling in a full
// linear-algebra dependency for a 3-state filter).
type Mat3 = [[number, number, number], [number, number, number], [number, number, number]];

function matMul3(a: Mat3, b: Mat3): Mat3 {
  const r: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) r[i][j] += a[i][k] * b[k][j];
  return r as Mat3;
}

function transpose3(a: Mat3): Mat3 {
  const r: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[j][i] = a[i][j];
  return r as Mat3;
}

export class EKFLocalizer {
  state: [number, number, number] = [0, 0, 0]; // x, y, theta
  P: Mat3 = [
    [0.05, 0, 0],
    [0, 0.05, 0],
    [0, 0, 0.05],
  ];

  // Process noise (position/heading uncertainty growth per second)
  qXY = 0.02;
  qTheta = 0.01;
  // Measurement noise for the IMU absolute-heading correction
  rTheta = 0.05;

  /** Propagate state using the differential-drive motion model. */
  predict(v: number, omega: number, dt: number) {
    const [x, y, theta] = this.state;

    const newX = x + v * Math.cos(theta) * dt;
    const newY = y + v * Math.sin(theta) * dt;
    const newTheta = wrapAngle(theta + omega * dt);
    this.state = [newX, newY, newTheta];

    const F: Mat3 = [
      [1, 0, -v * Math.sin(theta) * dt],
      [0, 1, v * Math.cos(theta) * dt],
      [0, 0, 1],
    ];

    const FP = matMul3(F, this.P);
    const FPFt = matMul3(FP, transpose3(F));
    const Q: Mat3 = [
      [this.qXY * dt, 0, 0],
      [0, this.qXY * dt, 0],
      [0, 0, this.qTheta * dt],
    ];
    this.P = [
      [FPFt[0][0] + Q[0][0], FPFt[0][1], FPFt[0][2]],
      [FPFt[1][0], FPFt[1][1] + Q[1][1], FPFt[1][2]],
      [FPFt[2][0], FPFt[2][1], FPFt[2][2] + Q[2][2]],
    ];
  }

  /** Correct accumulated gyro drift using an absolute IMU heading (radians). */
  updateHeading(imuYaw: number, rTheta = this.rTheta) {
    // H = [0, 0, 1] -> innovation covariance S is scalar: P[2][2] + r
    const S = this.P[2][2] + rTheta;
    // Kalman gain K = P * H^T / S -> column vector (P[0][2], P[1][2], P[2][2]) / S
    const K = [this.P[0][2] / S, this.P[1][2] / S, this.P[2][2] / S];

    const innovation = wrapAngle(imuYaw - this.state[2]);

    this.state = [
      this.state[0] + K[0] * innovation,
      this.state[1] + K[1] * innovation,
      wrapAngle(this.state[2] + K[2] * innovation),
    ];

    // P = (I - K H) P  ==  P minus K times row 2 of P
    const row2 = this.P[2];
    this.P = [
      [this.P[0][0] - K[0] * row2[0], this.P[0][1] - K[0] * row2[1], this.P[0][2] - K[0] * row2[2]],
      [this.P[1][0] - K[1] * row2[0], this.P[1][1] - K[1] * row2[1], this.P[1][2] - K[1] * row2[2]],
      [this.P[2][0] - K[2] * row2[0], this.P[2][1] - K[2] * row2[1], this.P[2][2] - K[2] * row2[2]],
    ];
  }

  pose(): Pose2D & { positionStdM: number } {
    const [x, y, theta] = this.state;
    const positionStdM = Math.sqrt(Math.max(this.P[0][0] + this.P[1][1], 0));
    return { x, y, theta, positionStdM };
  }
}
