import cv2
import time
from functools import wraps

def time_execution(func):
    """Decorator to measure and print execution time of functions."""
    @wraps(func)
    def wrapper(*args, **kwargs):
        start_time = time.perf_counter()
        result = func(*args, **kwargs)
        end_time = time.perf_counter()
        execution_time_ms = (end_time - start_time) * 1000
        # Optional: Log if it exceeds budget, e.g. 4ms
        if execution_time_ms > 4.0:
            print(f"[WARN] {func.__name__} took {execution_time_ms:.2f}ms (Budget: 4.0ms)")
        # Alternatively, could just log every time for debugging
        # print(f"[INFO] {func.__name__} took {execution_time_ms:.2f}ms")
        return result
    return wrapper

class LightingNormalizer:
    def __init__(self, clip_limit=2.5, tile_grid_size=(8, 8)):
        self.clahe = cv2.createCLAHE(clipLimit=clip_limit, tileGridSize=tile_grid_size)

    @time_execution
    def apply_clahe(self, frame):
        """
        Applies Contrast-Limited Adaptive Histogram Equalization (CLAHE) 
        specifically to the Luminance (L) channel of the LAB color space 
        to enhance dynamic range without distorting color.
        """
        if frame is None:
            return None

        # Convert the BGR image to LAB color space
        lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
        
        # Split the LAB image to L, A and B channels
        l_channel, a_channel, b_channel = cv2.split(lab)
        
        # Apply CLAHE to the L channel
        l_channel_eq = self.clahe.apply(l_channel)
        
        # Merge the CLAHE enhanced L channel with the original A and B channels
        lab_eq = cv2.merge((l_channel_eq, a_channel, b_channel))
        
        # Convert back to BGR color space
        bgr_eq = cv2.cvtColor(lab_eq, cv2.COLOR_LAB2BGR)
        
        return bgr_eq
