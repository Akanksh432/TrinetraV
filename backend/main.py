import asyncio
import json
import os
from typing import List
from contextlib import asynccontextmanager

import cv2
import numpy as np
from fastapi import FastAPI, UploadFile, File, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

from video_capture import UVCVideoStream
from preprocessor import LightingNormalizer
from perception import DualPerceptionEngine

video_stream = None
normalizer = None
engine = None
CURRENT_VIDEO_PATH = None
import time

class ConnectionManager:
  def __init__(self):
    self.active_connections: List[WebSocket] = []

  async def connect(self, websocket: WebSocket):
    await websocket.accept()
    self.active_connections.append(websocket)

  def disconnect(self, websocket: WebSocket):
    if websocket in self.active_connections:
      self.active_connections.remove(websocket)

  async def broadcast(self, message: dict):
    payload = json.dumps(message)
    for connection in list(self.active_connections):
      try:
        await connection.send_text(payload)
      except Exception:
        self.disconnect(connection)

manager = ConnectionManager()

@asynccontextmanager
async def lifespan(app: FastAPI):
  global video_stream, normalizer, engine
  print("[SYSTEM] Starting Trinetra Vision Backend on http://127.0.0.1:8000")
  video_stream = UVCVideoStream(src_options=[0, 1], resolution=(320, 240)).start()
  normalizer = LightingNormalizer()
  engine = DualPerceptionEngine()
  yield
  print("[SYSTEM] Shutting down Trinetra Vision Backend")
  if video_stream:
      video_stream.stop()

app = FastAPI(title="Trinetra Vision API", lifespan=lifespan)

# Setup CORS to allow Next.js on port 3000
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health_check():
  return {"status": "online", "port": 8000}

@app.websocket("/telemetry")
async def websocket_telemetry(websocket: WebSocket):
  await manager.connect(websocket)
  try:
    while True:
      # Keep-alive receive loop
      await websocket.receive_text()
  except WebSocketDisconnect:
    manager.disconnect(websocket)

@app.post("/upload-video")
async def upload_video(file: UploadFile = File(...)):
    global CURRENT_VIDEO_PATH
    file_path = f"temp_{file.filename}"
    with open(file_path, "wb") as buffer:
        content = await file.read()
        buffer.write(content)
    
    CURRENT_VIDEO_PATH = file_path
    return {"message": "Video uploaded successfully", "filename": file.filename}

# Helper to determine if CLAHE is needed based on brightness/contrast
def needs_clahe(frame):
    gray = cv2.cvtColor(cv2.resize(frame, (64, 48)), cv2.COLOR_BGR2GRAY)
    mean, std = cv2.meanStdDev(gray)
    if mean[0][0] < 80 or mean[0][0] > 170 or std[0][0] < 30:
        return True
    return False

async def video_generator(enhance: bool):
    global video_stream
    global CURRENT_VIDEO_PATH
    
    cap = None
    last_video_path = None
    
    INFER_EVERY_N_FRAMES = 3
    frame_count = 0
    
    clahe_cache = False
    clahe_frame_count = 0
    
    last_log_time = time.time()
    perf_stats = {"capture": [], "infer": [], "encode": []}
    
    while True:
        t0 = time.time()
        
        # Check if user uploaded a new video
        if CURRENT_VIDEO_PATH and CURRENT_VIDEO_PATH != last_video_path:
            if cap:
                cap.release()
            if os.path.exists(CURRENT_VIDEO_PATH):
                cap = cv2.VideoCapture(CURRENT_VIDEO_PATH)
                last_video_path = CURRENT_VIDEO_PATH
            else:
                cap = None
                last_video_path = CURRENT_VIDEO_PATH
                
        # Read from uploaded video if available
        if cap and cap.isOpened():
            grabbed, frame = cap.read()
            if not grabbed:
                # Loop the uploaded video
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                continue
            frame = cv2.resize(frame, (320, 240))
        else:
            # Fallback to the live UVC camera stream
            if not video_stream:
                await asyncio.sleep(0.1)
                continue
                
            grabbed, frame = video_stream.read()
            if not grabbed or frame is None:
                await asyncio.sleep(0.01)
                continue
                
        t1 = time.time()
        perf_stats["capture"].append((t1 - t0) * 1000)
        
        if enhance and normalizer:
            if clahe_frame_count % 10 == 0:
                clahe_cache = needs_clahe(frame)
            clahe_frame_count += 1
            
            if clahe_cache:
                # Apply CLAHE in thread to avoid blocking asyncio loop
                frame = await asyncio.to_thread(normalizer.apply_clahe, frame)
                
        # Inference with frame skipping handled by Perception Engine tracker
        run_infer = (frame_count % INFER_EVERY_N_FRAMES == 0)
        vis_frame, telemetry_payload = await asyncio.to_thread(engine.process, frame, run_infer)
            
        frame_count += 1
        
        t2 = time.time()
        perf_stats["infer"].append((t2 - t1) * 1000)
        
        # Broadcast telemetry (non-blocking)
        asyncio.create_task(manager.broadcast(telemetry_payload))
        
        # Encode frame
        # Upscale back to 640x480 for the frontend browser
        display_frame = cv2.resize(vis_frame, (640, 480))
        # Run imencode in thread as well for max decoupling, or synchronous since it's fast
        ret, buffer = await asyncio.to_thread(cv2.imencode, '.jpg', display_frame)
        if not ret:
            continue
            
        frame_bytes = buffer.tobytes()
        
        t3 = time.time()
        perf_stats["encode"].append((t3 - t2) * 1000)
        
        # Performance logging
        if t3 - last_log_time >= 2.0:
            avg_cap = sum(perf_stats["capture"]) / max(1, len(perf_stats["capture"]))
            avg_inf = sum(perf_stats["infer"]) / max(1, len(perf_stats["infer"]))
            avg_enc = sum(perf_stats["encode"]) / max(1, len(perf_stats["encode"]))
            total_fps = len(perf_stats["capture"]) / (t3 - last_log_time)
            
            print(f"[PERF] FPS: {total_fps:.1f} | Cap: {avg_cap:.1f}ms | Infer: {avg_inf:.1f}ms | Enc: {avg_enc:.1f}ms")
            
            perf_stats = {"capture": [], "infer": [], "encode": []}
            last_log_time = t3
            
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
               
        # Small sleep to allow other tasks to run and control framerate slightly
        await asyncio.sleep(0.005)

@app.get("/stream-video")
async def stream_video(enhance: bool = False):
    return StreamingResponse(video_generator(enhance), media_type="multipart/x-mixed-replace; boundary=frame")

@app.get("/camera/status")
async def camera_status():
    global video_stream
    if video_stream:
        return video_stream.get_status()
    return {"status": "not initialized"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
