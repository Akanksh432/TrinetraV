import numpy as np

class CentroidTracker:
    def __init__(self, max_disappeared=5, max_distance=50):
        self.next_object_id = 0
        self.objects = {}  # id -> object dict
        self.disappeared = {}
        self.max_disappeared = max_disappeared
        self.max_distance = max_distance

    def _get_centroid(self, bbox):
        return (bbox[0] + bbox[2]) / 2.0, (bbox[1] + bbox[3]) / 2.0

    def update(self, new_detections):
        if len(new_detections) == 0:
            for obj_id in list(self.disappeared.keys()):
                self.disappeared[obj_id] += 1
                if self.disappeared[obj_id] > self.max_disappeared:
                    self.deregister(obj_id)
            return list(self.objects.values())

        input_centroids = np.zeros((len(new_detections), 2))
        for i, det in enumerate(new_detections):
            input_centroids[i] = self._get_centroid(det['bbox'])

        if len(self.objects) == 0:
            for i, det in enumerate(new_detections):
                self.register(det, input_centroids[i])
            return list(self.objects.values())

        object_ids = list(self.objects.keys())
        object_centroids = np.array([self.objects[obj_id]['centroid'] for obj_id in object_ids])

        D = np.linalg.norm(object_centroids[:, np.newaxis] - input_centroids, axis=2)

        rows = D.min(axis=1).argsort()
        cols = D.argmin(axis=1)[rows]

        used_rows = set()
        used_cols = set()

        for row, col in zip(rows, cols):
            if row in used_rows or col in used_cols:
                continue

            if D[row, col] > self.max_distance:
                continue

            obj_id = object_ids[row]
            det = new_detections[col].copy()
            det['track_id'] = obj_id
            
            # Compute velocity (per inference step)
            prev_cx, prev_cy = self.objects[obj_id]['centroid']
            curr_cx, curr_cy = input_centroids[col]
            det['velocity'] = (curr_cx - prev_cx, curr_cy - prev_cy)
            det['centroid'] = (curr_cx, curr_cy)
            
            self.objects[obj_id] = det
            self.disappeared[obj_id] = 0

            used_rows.add(row)
            used_cols.add(col)

        unused_rows = set(range(D.shape[0])).difference(used_rows)
        unused_cols = set(range(D.shape[1])).difference(used_cols)

        for row in unused_rows:
            obj_id = object_ids[row]
            self.disappeared[obj_id] += 1
            if self.disappeared[obj_id] > self.max_disappeared:
                self.deregister(obj_id)

        for col in unused_cols:
            self.register(new_detections[col], input_centroids[col])

        return list(self.objects.values())

    def predict_skipped_frame(self, inference_stride=3):
        # Translate boxes forward by velocity / inference_stride
        # This gives a smooth interpolation across skipped frames.
        for obj_id, det in self.objects.items():
            vx, vy = det.get('velocity', (0.0, 0.0))
            dx = vx / inference_stride
            dy = vy / inference_stride
            
            cx, cy = det['centroid']
            det['centroid'] = (cx + dx, cy + dy)
            
            x1, y1, x2, y2 = det['bbox']
            det['bbox'] = [x1 + dx, y1 + dy, x2 + dx, y2 + dy]
            
        return list(self.objects.values())

    def register(self, det, centroid):
        det_copy = det.copy()
        det_copy['track_id'] = self.next_object_id
        det_copy['centroid'] = centroid
        det_copy['velocity'] = (0.0, 0.0)
        self.objects[self.next_object_id] = det_copy
        self.disappeared[self.next_object_id] = 0
        self.next_object_id += 1

    def deregister(self, obj_id):
        del self.objects[obj_id]
        del self.disappeared[obj_id]
