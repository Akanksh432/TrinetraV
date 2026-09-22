import torch
import time

# Set physical core count for CPU inference (configurable)
CPU_INFERENCE_THREADS = 4
torch.set_num_threads(CPU_INFERENCE_THREADS)

from typing import Any, Dict, List, Tuple
import cv2
import numpy as np
from ultralytics import YOLO
from mapping import IPMProjector
from terrain import TerrainSegmenter
from obstacle_classes import get_profile
from tracker import CentroidTracker

class DualPerceptionEngine:
  def __init__(self, weights_path: str = 'yolov8n.pt'):
    # Load model on available device
    self.model = YOLO(weights_path)
    # Fuse conv+batchnorm layers for faster CPU inference
    self.model.fuse()
    
    # Target resolution for fast AI inference
    self.infer_width = 640
    self.infer_height = 360

    # Initialize Inverse Perspective Mapping for a 640x360 frame
    self.projector = IPMProjector(frame_size=(self.infer_width, self.infer_height))

    # Real terrain hazard segmenter (SLIC superpixels + appearance model),
    # replaces the old single adaptive-threshold hack.
    self.terrain = TerrainSegmenter()
    
    # Minimal tracking for frame-skip continuity
    self.tracker = CentroidTracker(max_disappeared=5, max_distance=60)

    # Ground corridor polygon (same trapezoid used for both hazard search
    # and the anchor "known safe ground" patch).
    self.corridor_pts = np.array(
        [
            [int(self.infer_width * 0.15), self.infer_height],
            [int(self.infer_width * 0.85), self.infer_height],
            [int(self.infer_width * 0.65), int(self.infer_height * 0.40)],
            [int(self.infer_width * 0.35), int(self.infer_height * 0.40)],
        ],
        np.int32,
    )
    self.corridor_mask = np.zeros((self.infer_height, self.infer_width), dtype=np.uint8)
    cv2.fillPoly(self.corridor_mask, [self.corridor_pts], 255)

    # Anchor patch: a thin strip of ground right in front of the rover,
    # assumed traversable (it either just drove over it or is entering it).
    self.anchor_rect = (
        int(self.infer_width * 0.35),
        int(self.infer_height * 0.90),
        int(self.infer_width * 0.65),
        self.infer_height - 1,
    )
    
    # Profiling variables
    self.profiling = {'yolo': 0, 'seg': 0, 'trk': 0, 'skip': 0, 'count': 0, 'skip_count': 0}

  def process(
      self, frame: np.ndarray, run_inference: bool = True
  ) -> Tuple[np.ndarray, Dict[str, Any]]:
    orig_h, orig_w = frame.shape[:2]

    # 1. Downscale frame for fast real-time inference
    small_frame = cv2.resize(
        frame, (self.infer_width, self.infer_height), interpolation=cv2.INTER_AREA
    )
    scale_x = orig_w / self.infer_width
    scale_y = orig_h / self.infer_height

    obstacles: List[Dict[str, Any]] = []

    if run_inference:
        # 2. Run YOLO for known dynamic/static object classes
        # Using explicit .predict for speed (avoids unbatched/full-res defaults)
        t0 = time.time()
        results = self.model.predict(
            small_frame, 
            imgsz=320, 
            conf=0.35, 
            iou=0.45, 
            verbose=False, 
            device="cpu"
        )[0]
        self.profiling['yolo'] += (time.time() - t0)
        
        raw_detections = []
        for box in results.boxes:
          cls_id = int(box.cls[0])
          label = self.model.names[cls_id]
          conf = float(box.conf[0])
          x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()

          bbox_small = [int(x1), int(y1), int(x2), int(y2)]
          metric_x, metric_y = self.projector.project_to_ground(bbox_small)
          profile = get_profile(label)

          raw_detections.append({
              'label': label,
              'conf': round(conf, 2),
              'bbox': [
                  int(x1 * scale_x),
                  int(y1 * scale_y),
                  int(x2 * scale_x),
                  int(y2 * scale_y),
              ],
              'metric_pos': [metric_x, metric_y],
              'avoid_radius_m': profile['avoid_radius_m'],
              'risk_weight': profile['risk_weight'],
              'is_dynamic': profile['is_dynamic'],
          })

        # 3. Terrain Hazard Detector
        t0 = time.time()
        hazards = self.terrain.segment(small_frame, self.corridor_mask, self.anchor_rect)
        self.profiling['seg'] += (time.time() - t0)
        
        for hz in hazards:
          metric_x, metric_y = self.projector.project_to_ground(hz['bbox'])
          profile = get_profile(hz['label'])
          rx1, ry1, rx2, ry2 = hz['bbox']

          raw_detections.append({
              'label': hz['label'],
              'conf': hz['conf'],
              'bbox': [
                  int(rx1 * scale_x),
                  int(ry1 * scale_y),
                  int(rx2 * scale_x),
                  int(ry2 * scale_y),
              ],
              'metric_pos': [metric_x, metric_y],
              'avoid_radius_m': profile['avoid_radius_m'],
              'risk_weight': profile['risk_weight'],
              'is_dynamic': profile['is_dynamic'],
          })
        
        t0 = time.time()
        obstacles = self.tracker.update(raw_detections)
        self.profiling['trk'] += (time.time() - t0)
        self.profiling['count'] += 1
        
        if self.profiling['count'] >= 10:
            p = self.profiling
            n = p['count']
            s_n = max(1, p['skip_count'])
            print(f"[PERCEPTION AI] YOLO: {p['yolo']/n*1000:.1f}ms | Seg: {p['seg']/n*1000:.1f}ms | Trk: {p['trk']/n*1000:.1f}ms | Skip: {p['skip']/s_n*1000:.1f}ms")
            self.profiling = {k: 0 for k in self.profiling}
            
    else:
        t0 = time.time()
        obstacles = self.tracker.predict_skipped_frame(inference_stride=3)
        # Ensure boxes remain integers after translation
        for obs in obstacles:
            obs['bbox'] = [int(x) for x in obs['bbox']]
        self.profiling['skip'] += (time.time() - t0)
        self.profiling['skip_count'] += 1

    # 4. Generate annotated output frame
    vis_frame = frame.copy()

    # Draw green ground corridor overlay
    corridor_pts_full = np.array(
        [
            [int(orig_w * 0.15), orig_h],
            [int(orig_w * 0.85), orig_h],
            [int(orig_w * 0.65), int(orig_h * 0.40)],
            [int(orig_w * 0.35), int(orig_h * 0.40)],
        ],
        np.int32,
    )
    overlay = vis_frame.copy()
    cv2.fillPoly(overlay, [corridor_pts_full], (0, 200, 50))
    vis_frame = cv2.addWeighted(overlay, 0.25, vis_frame, 0.75, 0)

    # Draw bounding boxes, colored by risk tier
    for obs in obstacles:
      bx1, by1, bx2, by2 = obs['bbox']
      if obs['risk_weight'] >= 4.0:
        color = (0, 0, 255)      # red: high risk
      elif obs['risk_weight'] >= 2.0:
        color = (0, 140, 255)    # orange: moderate
      else:
        color = (0, 220, 220)    # yellow: minor
      cv2.rectangle(vis_frame, (bx1, by1), (bx2, by2), color, 2)
      
      # Use track_id to show stable identity
      trk_id = obs.get('track_id', '?')
      tag = f"[{trk_id}] {obs['label'].upper()} {int(obs['conf']*100)}%"
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
