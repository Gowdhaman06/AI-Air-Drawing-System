import cv2
import mediapipe as mp
from flask import Flask, Response, jsonify, request, render_template
import threading
import time

app = Flask(__name__)

# Global state
latest_landmarks = {
    "x": 0,
    "y": 0,
    "gesture": "none"
}
config = {
    "show_skeleton": False
}

frame_lock = threading.Lock()
current_frame = None

mp_hands = mp.solutions.hands
mp_drawing = mp.solutions.drawing_utils
mp_drawing_styles = mp.solutions.drawing_styles

def generate_frames():
    global current_frame, latest_landmarks
    cap = cv2.VideoCapture(0)
    
    with mp_hands.Hands(
        model_complexity=0,
        min_detection_confidence=0.7,
        min_tracking_confidence=0.7,
        max_num_hands=1) as hands:
        
        while True:
            success, image = cap.read()
            if not success:
                time.sleep(0.1)
                continue
                
            # Flip image horizontally for selfie-view display
            image = cv2.flip(image, 1)
            image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            results = hands.process(image_rgb)
            
            gesture = "none"
            idx_x, idx_y = 0, 0
            
            if results.multi_hand_landmarks:
                for hand_landmarks in results.multi_hand_landmarks:
                    # Draw skeleton if enabled
                    if config["show_skeleton"]:
                        mp_drawing.draw_landmarks(
                            image,
                            hand_landmarks,
                            mp_hands.HAND_CONNECTIONS,
                            mp_drawing_styles.get_default_hand_landmarks_style(),
                            mp_drawing_styles.get_default_hand_connections_style())
                    
                    # Detect gestures
                    lm = hand_landmarks.landmark
                    
                    # Tips
                    thumb_tip = lm[4]
                    index_tip = lm[8]
                    middle_tip = lm[12]
                    ring_tip = lm[16]
                    pinky_tip = lm[20]
                    
                    # MCPs (base of fingers)
                    thumb_mcp = lm[2]
                    index_mcp = lm[5]
                    middle_mcp = lm[9]
                    ring_mcp = lm[13]
                    pinky_mcp = lm[17]
                    
                    # Store index fingertip normalized coordinates (0 to 1)
                    idx_x = index_tip.x
                    idx_y = index_tip.y
                    
                    # Check if fingers are up (y is inverted, so smaller y means higher)
                    index_up = index_tip.y < index_mcp.y
                    middle_up = middle_tip.y < middle_mcp.y
                    ring_up = ring_tip.y < ring_mcp.y
                    pinky_up = pinky_tip.y < pinky_mcp.y
                    
                    # Thumb up - simplified heuristic: thumb tip is higher than index mcp, 
                    # and other fingers are closed
                    thumb_up = thumb_tip.y < index_mcp.y and not index_up and not middle_up and not ring_up and not pinky_up
                    
                    if thumb_up:
                        gesture = "action"
                    elif index_up and middle_up and ring_up and pinky_up:
                        gesture = "erase"
                    elif index_up and not pinky_up:
                        gesture = "draw"
            
            with frame_lock:
                latest_landmarks = {
                    "x": idx_x,
                    "y": idx_y,
                    "gesture": gesture
                }
                
                # Encode frame
                ret, buffer = cv2.imencode('.jpg', image)
                current_frame = buffer.tobytes()

        cap.release()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/video_feed')
def video_feed():
    def get_frame():
        while True:
            with frame_lock:
                if current_frame is None:
                    time.sleep(0.01)
                    continue
                frame_data = current_frame
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame_data + b'\r\n')
            time.sleep(0.03) # ~30 fps
            
    return Response(get_frame(), mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/landmarks')
def landmarks():
    with frame_lock:
        return jsonify(latest_landmarks)

@app.route('/config', methods=['POST'])
def set_config():
    data = request.json
    if 'show_skeleton' in data:
        config['show_skeleton'] = data['show_skeleton']
    return jsonify(success=True)

if __name__ == '__main__':
    t = threading.Thread(target=generate_frames, daemon=True)
    t.start()
    app.run(host='0.0.0.0', port=5000, threaded=True)
