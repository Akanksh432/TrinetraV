import cv2
import numpy as np

class IPMProjector:
    def __init__(self, camera_height=1.0, tilt_angle=15.0, frame_size=(640, 480)):
        self.camera_height = camera_height
        self.tilt_angle = tilt_angle
        self.frame_w, self.frame_h = frame_size
        
        # Define src_points (trapezoid in the camera image) representing a flat patch of ground
        # Assuming the camera points forward and downward at 15 degrees.
        # We pick a trapezoid in the lower half of the image.
        self.src_points = np.float32([
            [self.frame_w * 0.3, self.frame_h * 0.5],    # Top-left of ground patch
            [self.frame_w * 0.7, self.frame_h * 0.5],    # Top-right of ground patch
            [self.frame_w, self.frame_h],                # Bottom-right of camera view
            [0, self.frame_h]                            # Bottom-left of camera view
        ])
        
        # Define dst_points (rectangle representing that same patch of ground in a top-down metric grid)
        # Mapping to a 10m x 10m grid. Using 40 pixels per meter -> 400x400 grid.
        self.grid_size = 400
        self.pixels_per_meter = 40
        self.dst_points = np.float32([
            [0, 0],                               # Top-left (10m ahead, 5m left)
            [self.grid_size, 0],                  # Top-right (10m ahead, 5m right)
            [self.grid_size, self.grid_size],     # Bottom-right (0m ahead, 5m right)
            [0, self.grid_size]                   # Bottom-left (0m ahead, 5m left)
        ])
        
        # Compute the perspective transformation matrix (Homography)
        self.H = cv2.getPerspectiveTransform(self.src_points, self.dst_points)
        
        # Maintain a lightweight 2D NumPy array representing a 10m x 10m grid in front of the rover
        self.occupancy_grid = np.zeros((self.grid_size, self.grid_size), dtype=np.uint8)
        
    def project_to_ground(self, bbox):
        """
        Extracts the bottom-center point of a YOLO bounding box and applies
        the homography matrix to get metric (X, Y) distances.
        """
        x1, y1, x2, y2 = bbox
        
        # Extract bottom-center point of the YOLO bounding box
        u = (x1 + x2) / 2.0
        v = float(y2)
        
        # Apply the perspective transformation matrix
        pt_img = np.array([[[u, v]]], dtype=np.float32)
        pt_ground = cv2.perspectiveTransform(pt_img, self.H)
        
        grid_x, grid_y = pt_ground[0][0]
        
        # Mark occupancy grid
        gx, gy = int(grid_x), int(grid_y)
        if 0 <= gx < self.grid_size and 0 <= gy < self.grid_size:
            self.occupancy_grid[gy, gx] = 1
            
        # Convert grid pixels to metric distance in meters
        # Grid bottom (y = 400) is 0m ahead. Grid top (y = 0) is 10m ahead.
        distance_y_meters = (self.grid_size - grid_y) / self.pixels_per_meter
        
        # Grid center (x = 200) is 0m right. Grid right (x = 400) is 5m right.
        distance_x_meters = (grid_x - (self.grid_size / 2)) / self.pixels_per_meter
        
        return round(float(distance_x_meters), 2), round(float(distance_y_meters), 2)
