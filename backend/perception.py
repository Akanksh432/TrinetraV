from typing import Any, Dict, List, Tuple
import cv2
import numpy as np
from ultralytics import YOLO
from mapping import IPMProjector

class DualPerceptionEngine:
  def __init__(self, weights_path: str = 'yolov8n.pt'):
    # Load model on available device
    self.model = YOLO(weights_path)
    # Target resolution for fast AI inference
    self.infer_width = 640
    self.infer_height = 360
    
    # Initialize Inverse Perspective Mapping for a 640x360 frame
    self.projector = IPMProjector(frame_size=(self.infer_width, self.infer_height))

  def process(
      self, frame: np.ndarray
  ) -> Tuple[np.ndarray, Dict[str, Any]]:
    orig_h, orig_w = frame.shape[:2]

    # 1. Downscale frame for fast real-time inference
    small_frame = cv2.resize(
        frame, (self.infer_width, self.infer_height), interpolation=cv2.INTER_AREA
    )
    scale_x = orig_w / self.infer_width
    scale_y = orig_h / self.infer_height

    obstacles: List[Dict[str, Any]] = []

    # 2. Run YOLO for any standard dynamic obstacles
    results = self.model(small_frame, conf=0.45, verbose=False)[0]
    for box in results.boxes:
      cls_id = int(box.cls[0])
      label = self.model.names[cls_id]
      conf = float(box.conf[0])
      x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()

      bbox_small = [int(x1), int(y1), int(x2), int(y2)]
      metric_x, metric_y = self.projector.project_to_ground(bbox_small)

      obstacles.append({
          'label': label,
          'conf': round(conf, 2),
          'bbox': [
              int(x1 * scale_x),
              int(y1 * scale_y),
              int(x2 * scale_x),
              int(y2 * scale_y),
          ],
          'metric_pos': [metric_x, metric_y]
      })

    # 3. Terrain Hazard Detector (Detects Rocks, Ditches, and Boulders)
    # Extracts high-contrast anomalies inside the lower ground region
    gray = cv2.cvtColor(small_frame, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (7, 7), 0)

    # Focus strictly on ground corridor (bottom 65% of screen)
    ground_mask = np.zeros_like(gray)
    pts = np.array(
        [
            [int(self.infer_width * 0.15), self.infer_height],
            [int(self.infer_width * 0.85), self.infer_height],
            [int(self.infer_width * 0.65), int(self.infer_height * 0.40)],
            [int(self.infer_width * 0.35), int(self.infer_height * 0.40)],
        ],
        np.int32,
    )
    cv2.fillPoly(ground_mask, [pts], 255)

    # Adaptive contrast threshold to spot rocks and terrain edges
    adaptive_thresh = cv2.adaptiveThreshold(
        blurred,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        21,
        6,
    )
    terrain_hazards = cv2.bitwise_and(
        adaptive_thresh, adaptive_thresh, mask=ground_mask
    )

    # Morphological cleanup to group rock contours
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    cleaned_hazards = cv2.morphologyEx(terrain_hazards, cv2.MORPH_CLOSE, kernel)

    contours, _ = cv2.findContours(
        cleaned_hazards, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )

    for cnt in contours:
      area = cv2.contourArea(cnt)
      # Filter noise: only accept solid obstacles with realistic pixel area
      if 250 < area < 15000:
        rx, ry, rw, rh = cv2.boundingRect(cnt)
        
        bbox_small = [rx, ry, rx + rw, ry + rh]
        metric_x, metric_y = self.projector.project_to_ground(bbox_small)
        
        # Avoid duplicating existing YOLO detections
        obstacles.append({
            'label': 'rock/obstacle',
            'conf': round(min(area / 1200.0, 0.95), 2),
            'bbox': [
                int(rx * scale_x),
                int(ry * scale_y),
                int((rx + rw) * scale_x),
                int((ry + rh) * scale_y),
            ],
            'metric_pos': [metric_x, metric_y]
        })

    # 4. Generate annotated output frame
    vis_frame = frame.copy()

    # Draw green ground corridor overlay
    corridor_pts = np.array(
        [
            [int(orig_w * 0.15), orig_h],
            [int(orig_w * 0.85), orig_h],
            [int(orig_w * 0.65), int(orig_h * 0.40)],
            [int(orig_w * 0.35), int(orig_h * 0.40)],
        ],
        np.int32,
    )
    overlay = vis_frame.copy()
    cv2.fillPoly(overlay, [corridor_pts], (0, 200, 50))
    vis_frame = cv2.addWeighted(overlay, 0.25, vis_frame, 0.75, 0)

    # Draw bounding boxes
    for obs in obstacles:
      bx1, by1, bx2, by2 = obs['bbox']
      color = (0, 0, 255) if 'rock' in obs['label'] else (255, 100, 0)
      cv2.rectangle(vis_frame, (bx1, by1), (bx2, by2), color, 2)
      tag = f"{obs['label'].upper()} {int(obs['conf']*100)}%"
      cv2.putText(
          vis_frame,
          tag,
          (bx1, max(by1 - 8, 15)),
          cv2.FONT_HERSHEY_SIMPLEX,
          0.5,
          color,
          2,
      )

    return vis_frame, {"obstacles": obstacles}
