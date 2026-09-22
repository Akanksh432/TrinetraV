"""
Extended Kalman Filter for GPS-denied differential-drive localization.

State vector:  x = [x, y, theta]            (meters, meters, radians)
Control input: u = [v, omega]               (m/s from wheel encoders,
                                              rad/s from IMU gyro)
Measurement:   z = [theta_imu]              (absolute heading from IMU
                                              accelerometer/magnetometer,
                                              used only to correct gyro
                                              yaw drift -- there is no GPS)

This is the real motion model used for GPS-denied dead reckoning: predict
from wheel odometry + gyro, correct heading drift with the IMU's absolute
orientation estimate. It intentionally does NOT depend on any external
reference (no GPS, no visual landmarks) -- that's the point of this filter.

Wire-up: once the ESP32 is sending real encoder tick counts + MPU6050
readings over UDP, call `predict(v, omega, dt)` every control cycle with the
decoded values and `update_heading(imu_yaw, r)` whenever a fresh IMU sample
arrives. Until then this class can be driven with simulated inputs (see
`ekf.ts` for the browser-side twin used by the live dashboard) -- the
algorithm itself does not change when the inputs go from simulated to real.
"""

from dataclasses import dataclass, field
import numpy as np


def _wrap_angle(a: float) -> float:
    return (a + np.pi) % (2 * np.pi) - np.pi


@dataclass
class EKFLocalizer:
    # State: x, y, theta
    state: np.ndarray = field(default_factory=lambda: np.zeros(3))
    # Covariance
    P: np.ndarray = field(default_factory=lambda: np.eye(3) * 0.05)

    # Process noise (uncertainty growth per second from wheel slip / gyro bias)
    q_xy: float = 0.02      # m^2/s of position process noise
    q_theta: float = 0.01   # rad^2/s of heading process noise

    # Measurement noise for the IMU absolute-heading correction
    r_theta: float = 0.05   # rad^2

    def predict(self, v: float, omega: float, dt: float) -> None:
        """Propagate state using the differential-drive motion model."""
        x, y, theta = self.state

        new_x = x + v * np.cos(theta) * dt
        new_y = y + v * np.sin(theta) * dt
        new_theta = _wrap_angle(theta + omega * dt)
        self.state = np.array([new_x, new_y, new_theta])

        # Jacobian of the motion model w.r.t. state
        F = np.array([
            [1, 0, -v * np.sin(theta) * dt],
            [0, 1,  v * np.cos(theta) * dt],
            [0, 0, 1],
        ])

        Q = np.diag([self.q_xy * dt, self.q_xy * dt, self.q_theta * dt])
        self.P = F @ self.P @ F.T + Q

    def update_heading(self, imu_yaw: float, r_theta: float | None = None) -> None:
        """Correct accumulated gyro drift using an absolute IMU heading."""
        r = self.r_theta if r_theta is None else r_theta

        H = np.array([[0, 0, 1]])
        z = imu_yaw
        y_hat = _wrap_angle(z - self.state[2])  # innovation

        S = H @ self.P @ H.T + r
        K = self.P @ H.T @ np.linalg.inv(S)  # Kalman gain (3x1)

        self.state = self.state + (K.flatten() * y_hat)
        self.state[2] = _wrap_angle(self.state[2])
        self.P = (np.eye(3) - K @ H) @ self.P

    def pose(self) -> dict:
        x, y, theta = self.state
        drift_std = float(np.sqrt(self.P[0, 0] + self.P[1, 1]))
        return {
            "x": round(float(x), 4),
            "y": round(float(y), 4),
            "theta": round(float(theta), 5),
            "position_std_m": round(drift_std, 4),
        }
