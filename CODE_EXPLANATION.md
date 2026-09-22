# Trinetra Vision - Codebase Explanation

This document provides a comprehensive overview of the Trinetra Vision project architecture, detailing both the backend and frontend components. It serves as a guide to understand the current implementation and how different parts of the system interact.

## Architecture Overview

The system is designed as a split-stack architecture:
1.  **Backend (`backend/`)**: A Python/FastAPI server responsible for heavy computer vision tasks (YOLO object detection) and streaming processed video frames and telemetry data.
2.  **Frontend (`src/`)**: A Next.js (React) application that serves as the tactical dashboard, rendering the video feed, visualizing telemetry, and simulating robot navigation state.

The two systems communicate primarily through:
-   **HTTP endpoints** for video streaming and uploading.
-   **WebSockets** for real-time telemetry data (obstacle coordinates).

---

## 1. Backend (`backend/main.py`)

The backend is built with **FastAPI** and uses **OpenCV** and **Ultralytics YOLO** for processing video streams.

### Key Components

*   **FastAPI App & CORS**: Initializes the server (`app = FastAPI(...)`) and configures CORS to allow the frontend to connect from a different origin/port.
*   **YOLO Model**: Initializes the object detection model using `model = YOLO("yolov8n.pt")`. This loads a pre-trained Nano version of YOLOv8.
*   **WebSocket Connection Manager (`ConnectionManager`)**: Handles multiple client WebSocket connections, allowing the server to broadcast telemetry data (like detected obstacles) to any connected frontend client.

### Endpoints

*   **`POST /upload-video`**: Accepts a video file upload and saves it locally as `temp_<filename>`. This file is then used as the source for the video stream.
*   **`GET /stream-video`**: Returns a `StreamingResponse` that continuously yields JPEG frames in a multipart format (MJPEG stream). This allows the frontend to simply use an `<img>` tag to display the live video.
*   **`WS /telemetry`**: A WebSocket endpoint that the frontend connects to. The backend continuously pushes JSON strings containing the detected obstacles.

### `process_frame(frame)`
This is the core computer vision function executed on every video frame:
1.  **Ground Segmentation**: Uses HSV thresholding to isolate "ground" or "road" colors. It applies morphological operations to clean the mask, finds contours, and draws a green translucent overlay over the largest ground contour.
2.  **Object Detection**: Passes the frame to the YOLO model to get bounding boxes of objects.
3.  **Coordinate Transformation**: For each detected object, it calculates the center point and maps it to relative coordinates (`x_rel`, `y_rel`) based on the camera's center.
4.  **Telemetry Payload**: Packages these relative coordinates into a dictionary (`telemetry_data["obstacles"]`) which is later broadcasted via WebSocket.

---

## 2. Frontend (`src/`)

The frontend is a modern React application built with **Next.js** and styled with **Tailwind CSS**.

### `src/app/page.tsx` (Main Dashboard Layout)
This is the main entry point for the UI. It sets up a responsive grid layout containing several "tactical panels":
*   **Left Column**: `VideoPerception` (live camera feed) and `OccupancyGrid` (2D map).
*   **Middle Column**: `WaypointNavigation`, `UltrasonicPanel`, and `TelemetryPanel`.
*   **Right Column**: `SystemDiagnostics` and `FailsafeMonitor`.

### `src/lib/TelemetryContext.tsx` (State Management & Simulation)
This file is the "brain" of the frontend. It uses React's Context API to manage and distribute the entire state of the rover across all components.

**Key Features of TelemetryContext:**
1.  **WebSocket Client**: Connects to the backend's `ws://localhost:8000/telemetry` endpoint. It receives the relative obstacle coordinates, maps them from the camera's perspective into the global 2D map coordinates based on the rover's current position and heading, and updates the local state.
2.  **Simulation Loop**: Runs a `setInterval` loop every 100ms that simulates the rover's physical state:
    *   **Manual Control**: Listens to WASD key presses to update velocity and steering.
    *   **Autonomous Mode**: If a waypoint is set, it calculates the required steering angle and velocity to reach the target using A* pathfinding.
    *   **Kinematics Simulation**: Updates the `x`, `y`, and `theta` (heading) of the rover based on velocity and steering over time (`dt`).
    *   **Sensor Simulation**: Simulates fake data for EKF (Extended Kalman Filter) drift, IMU readings, ultrasonic sensors, and wheel encoders to make the dashboard look alive.
3.  **A* Pathfinding**: Continuously recalculates the path to the waypoint, actively avoiding the real-time obstacles detected by the backend YOLO model.
4.  **Failsafe/E-Stop**: Handles emergency stop triggers, halting simulated movement and optionally triggering a browser-based audio siren.

### Components (`src/components/`)
*   **`VideoPerception.tsx`**: Connects to the backend `/stream-video` endpoint to display the live feed. Also contains the UI to upload a new video via `/upload-video`.
*   **`OccupancyGrid.tsx`**: Renders an HTML5 `<canvas>`. It draws the grid, the rover, the path, and most importantly, plots the obstacles detected by the YOLO backend onto the 2D space. You can click on this map to set navigation waypoints.
*   **`TelemetryPanel.tsx`**, **`SystemDiagnostics.tsx`**, etc.: These components primarily read data from the `TelemetryContext` and display it in stylized gauges, progress bars, and text fields to give a "mission control" feel.

---

## Data Flow Summary
1. The backend reads a video frame.
2. YOLO detects objects in the frame.
3. Backend converts bounding boxes to relative distances and sends them via WebSocket.
4. Frontend `TelemetryContext` receives the WS message and translates relative distances to global map coordinates.
5. The `OccupancyGrid` component reads these coordinates and draws red dots on the 2D map.
6. The `TelemetryContext` simulation loop runs the A* algorithm to route around these newly placed red dots.
