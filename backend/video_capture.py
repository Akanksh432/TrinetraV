import cv2
import threading
import time
import numpy as np

class UVCVideoStream:
    def __init__(self, src_options=[0, 1], resolution=(640, 480)):
        self.resolution = resolution
        self.stream = None
        self.device_index = None
        self.is_synthetic = False
        
        # Try to open actual camera indices
        for src in src_options:
            stream = cv2.VideoCapture(src)
            if stream.isOpened():
                # Attempt to read a frame to confirm it works
                ret, _ = stream.read()
                if ret:
                    self.stream = stream
                    self.device_index = src
                    break
                else:
                    stream.release()

        # Fallback to synthetic if no camera is available
        if self.stream is None:
            print(f"[WARN] UVC indices {src_options} unavailable. Falling back to synthetic stream.")
            self.is_synthetic = True
            self.device_index = "Synthetic"
        else:
            print(f"[INFO] UVC Camera opened on index {self.device_index}")
            self.stream.set(cv2.CAP_PROP_FRAME_WIDTH, resolution[0])
            self.stream.set(cv2.CAP_PROP_FRAME_HEIGHT, resolution[1])
            self.stream.set(cv2.CAP_PROP_BUFFERSIZE, 1)  # Minimize internal V4L2/DirectShow buffer

        self.grabbed = False
        self.frame = None
        
        if not self.is_synthetic:
            self.grabbed, self.frame = self.stream.read()
        else:
            self.frame = self._generate_synthetic_frame()
            self.grabbed = True

        self.stopped = False
        self.lock = threading.Lock()
        
        # For FPS calculation
        self.fps_frames = 0
        self.fps_start_time = time.time()
        self.current_fps = 0.0

    def start(self):
        # Start the thread to read frames from the video stream
        t = threading.Thread(target=self.update, args=())
        t.daemon = True
        t.start()
        return self

    def update(self):
        # Keep looping infinitely until the thread is stopped
        while True:
            if self.stopped:
                return

            if self.is_synthetic:
                frame = self._generate_synthetic_frame()
                time.sleep(1 / 30.0) # Simulate 30 FPS
                with self.lock:
                    self.frame = frame
                    self.grabbed = True
            else:
                grabbed, frame = self.stream.read()
                if not grabbed:
                    self.stop()
                    return
                with self.lock:
                    self.grabbed = grabbed
                    self.frame = frame
            
            # FPS tracking
            self.fps_frames += 1
            now = time.time()
            if now - self.fps_start_time > 1.0:
                with self.lock:
                    self.current_fps = self.fps_frames / (now - self.fps_start_time)
                self.fps_start_time = now
                self.fps_frames = 0

    def read(self):
        # Return the frame most recently read
        with self.lock:
            if self.frame is None:
                return self.grabbed, None
            return self.grabbed, self.frame.copy()

    def stop(self):
        # Indicate that the thread should be stopped
        self.stopped = True
        if not self.is_synthetic and self.stream:
            self.stream.release()

    def get_status(self):
        with self.lock:
            fps = self.current_fps
        return {
            "device_index": self.device_index,
            "resolution": self.resolution,
            "fps": round(fps, 1),
            "is_synthetic": self.is_synthetic
        }

    def _generate_synthetic_frame(self):
        # Generate a scrolling pattern as a synthetic frame
        img = np.zeros((self.resolution[1], self.resolution[0], 3), dtype=np.uint8)
        t = time.time()
        offset = int(t * 100) % self.resolution[0]
        
        # Draw some lines
        cv2.line(img, (offset, 0), (offset, self.resolution[1]), (0, 255, 0), 5)
        cv2.putText(img, "SYNTHETIC FEED", (50, 50), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
        cv2.putText(img, time.strftime("%H:%M:%S"), (50, 100), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
        
        return img

    def __enter__(self):
        self.start()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.stop()
