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
  video_stream = UVCVideoStream(src_options=[0, 1], resolution=(640, 480)).start()
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

# process_frame logic is now handled by DualPerceptionEngine

async def video_generator(enhance: bool):
    global video_stream
    global CURRENT_VIDEO_PATH
    
    cap = None
    last_video_path = None
    
    while True:
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
        else:
            # Fallback to the live UVC camera stream
            if not video_stream:
                await asyncio.sleep(0.1)
                continue
                
            grabbed, frame = video_stream.read()
            if not grabbed or frame is None:
                await asyncio.sleep(0.01)
                continue
                
        if enhance and normalizer:
            frame = normalizer.apply_clahe(frame)
            
        visualization_frame, telemetry_payload = engine.process(frame)
        
        # Broadcast telemetry
        await manager.broadcast(telemetry_payload)
        
        # Encode frame
        ret, buffer = cv2.imencode('.jpg', visualization_frame)
        if not ret:
            continue
            
        frame_bytes = buffer.tobytes()
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
               
        # Small sleep to allow other tasks to run and control framerate slightly
        await asyncio.sleep(0.01)

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
