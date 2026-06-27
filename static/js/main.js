document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const videoElement = document.getElementById('input_video');
    const outputCanvas = document.getElementById('output_canvas');
    const outCtx = outputCanvas.getContext('2d');
    
    const drawingCanvas = document.getElementById('drawing-canvas');
    const drawCtx = drawingCanvas.getContext('2d', { willReadFrequently: true });
    
    // UI Elements
    const modeDisplay = document.getElementById('current-mode');
    const colorBtns = document.querySelectorAll('.color-btn');
    const sizeSlider = document.getElementById('brush-size');
    const sizeVal = document.getElementById('size-val');
    const toggleCamera = document.getElementById('toggle-camera');
    const toggleSkeleton = document.getElementById('toggle-skeleton');
    
    // State
    let currentColor = '#ff2a2a';
    let currentSize = 5;
    let isDrawing = false;
    let isErasing = false;
    let lastPoint = null;
    let previousPoint = null;
    
    let undoStack = [];
    let redoStack = [];
    let lastGesture = 'none';
    let actionDebounce = false;

    // Initialize Canvas Sizes
    function resizeCanvases() {
        const dataUrl = drawingCanvas.toDataURL(); // Save drawing
        
        outputCanvas.width = window.innerWidth;
        outputCanvas.height = window.innerHeight;
        
        drawingCanvas.width = window.innerWidth;
        drawingCanvas.height = window.innerHeight;
        
        // Restore drawing
        const img = new Image();
        img.onload = () => { drawCtx.drawImage(img, 0, 0); };
        img.src = dataUrl;
        
        if (undoStack.length === 0) saveState();
    }
    
    window.addEventListener('resize', resizeCanvases);
    resizeCanvases();

    function setupDrawContext() {
        drawCtx.lineCap = 'round';
        drawCtx.lineJoin = 'round';
        drawCtx.lineWidth = currentSize;
        drawCtx.strokeStyle = currentColor;
        drawCtx.shadowBlur = 15;
        drawCtx.shadowColor = currentColor;
    }

    // UI Listeners
    colorBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            colorBtns.forEach(b => {
                b.classList.remove('active');
                b.style.boxShadow = 'none';
            });
            btn.classList.add('active');
            currentColor = btn.dataset.color;
            btn.style.boxShadow = `0 0 15px ${currentColor}`;
        });
    });

    sizeSlider.addEventListener('input', (e) => {
        currentSize = parseInt(e.target.value);
        sizeVal.textContent = currentSize;
    });

    document.getElementById('btn-undo').addEventListener('click', undo);
    document.getElementById('btn-redo').addEventListener('click', redo);
    document.getElementById('btn-clear').addEventListener('click', clearCanvas);
    document.getElementById('btn-save').addEventListener('click', saveCanvas);

    // Canvas History
    function saveState() {
        undoStack.push(drawingCanvas.toDataURL());
        if (undoStack.length > 20) undoStack.shift();
        redoStack = [];
    }

    function undo() {
        if (undoStack.length > 1) {
            redoStack.push(undoStack.pop());
            restoreState(undoStack[undoStack.length - 1]);
        } else if (undoStack.length === 1) {
            redoStack.push(undoStack.pop());
            drawCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
        }
    }

    function redo() {
        if (redoStack.length > 0) {
            const state = redoStack.pop();
            undoStack.push(state);
            restoreState(state);
        }
    }

    function restoreState(dataUrl) {
        const img = new Image();
        img.onload = () => {
            drawCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
            drawCtx.drawImage(img, 0, 0);
        };
        img.src = dataUrl;
    }

    function clearCanvas() {
        drawCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
        saveState();
    }

    function saveCanvas() {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = drawingCanvas.width;
        tempCanvas.height = drawingCanvas.height;
        const tCtx = tempCanvas.getContext('2d');
        
        tCtx.fillStyle = '#0f0f13';
        tCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        tCtx.drawImage(drawingCanvas, 0, 0);

        const link = document.createElement('a');
        link.download = 'ai-air-drawing.png';
        link.href = tempCanvas.toDataURL('image/png');
        link.click();
    }

    // Helper: check if a finger is extended
    function isFingerUp(landmarks, tipIdx, pipIdx) {
        return landmarks[tipIdx].y < landmarks[pipIdx].y;
    }

    function isThumbUp(landmarks) {
        // For right hand: thumb tip x > thumb ip x (pointing right/up)
        // For left hand it's the opposite — but since we mirror the video, 
        // we use a simpler heuristic: thumb tip is significantly above thumb IP
        const thumbTip = landmarks[4];
        const thumbIP = landmarks[3];
        const thumbMCP = landmarks[2];
        // Thumb is up if the tip is above its IP joint
        return thumbTip.y < thumbIP.y && thumbTip.y < thumbMCP.y;
    }

    function countFingersUp(landmarks) {
        let count = 0;
        if (isFingerUp(landmarks, 8, 6)) count++;   // Index
        if (isFingerUp(landmarks, 12, 10)) count++;  // Middle
        if (isFingerUp(landmarks, 16, 14)) count++;  // Ring
        if (isFingerUp(landmarks, 20, 18)) count++;  // Pinky
        return count;
    }

    function detectGesture(landmarks) {
        const indexUp = isFingerUp(landmarks, 8, 6);
        const middleUp = isFingerUp(landmarks, 12, 10);
        const ringUp = isFingerUp(landmarks, 16, 14);
        const pinkyUp = isFingerUp(landmarks, 20, 18);
        const thumbUp = isThumbUp(landmarks);

        const fingersUp = countFingersUp(landmarks);

        // Thumb up gesture: thumb extended, all other fingers closed
        if (thumbUp && fingersUp === 0) {
            return 'action';
        }

        // Erase: 3 or more fingers up (open hand / spread fingers)
        if (fingersUp >= 3) {
            return 'erase';
        }

        // Move: exactly 2 fingers up (index + middle like a peace sign)
        if (fingersUp === 2 && indexUp && middleUp) {
            return 'move';
        }

        // Draw: only index finger up
        if (indexUp && fingersUp === 1) {
            return 'draw';
        }

        return 'none';
    }

    // Initialize MediaPipe Hands
    const hands = new Hands({locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
    }});

    hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.6,
        minTrackingConfidence: 0.6
    });

    hands.onResults(onResults);

    // Setup Camera
    const camera = new Camera(videoElement, {
        onFrame: async () => {
            await hands.send({image: videoElement});
        },
        width: 1280,
        height: 720
    });
    camera.start();

    // Frame Processing
    function onResults(results) {
        outCtx.save();
        outCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
        
        // Mirror the image
        outCtx.translate(outputCanvas.width, 0);
        outCtx.scale(-1, 1);
        
        // Draw camera feed
        if (toggleCamera.checked) {
            const videoAspect = results.image.width / results.image.height;
            const canvasAspect = outputCanvas.width / outputCanvas.height;
            let drawWidth, drawHeight, offsetX, offsetY;

            if (canvasAspect > videoAspect) {
                drawWidth = outputCanvas.width;
                drawHeight = outputCanvas.width / videoAspect;
                offsetX = 0;
                offsetY = (outputCanvas.height - drawHeight) / 2;
            } else {
                drawHeight = outputCanvas.height;
                drawWidth = outputCanvas.height * videoAspect;
                offsetX = (outputCanvas.width - drawWidth) / 2;
                offsetY = 0;
            }
            
            outCtx.drawImage(results.image, offsetX, offsetY, drawWidth, drawHeight);
        }

        // Process landmarks
        let gesture = 'none';
        
        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            const landmarks = results.multiHandLandmarks[0];
            
            // Draw skeleton
            if (toggleSkeleton.checked) {
                drawConnectors(outCtx, landmarks, HAND_CONNECTIONS, {color: '#00FF00', lineWidth: 2});
                drawLandmarks(outCtx, landmarks, {color: '#FF0000', lineWidth: 1, radius: 3});
            }

            // Detect gesture using robust helper
            gesture = detectGesture(landmarks);

            // Calculate screen coordinates from index fingertip
            const videoAspect = results.image.width / results.image.height;
            const canvasAspect = outputCanvas.width / outputCanvas.height;
            let drawWidth, drawHeight, offsetX, offsetY;

            if (canvasAspect > videoAspect) {
                drawWidth = outputCanvas.width;
                drawHeight = outputCanvas.width / videoAspect;
                offsetX = 0;
                offsetY = (outputCanvas.height - drawHeight) / 2;
            } else {
                drawHeight = outputCanvas.height;
                drawWidth = outputCanvas.height * videoAspect;
                offsetX = (outputCanvas.width - drawWidth) / 2;
                offsetY = 0;
            }

            // Mirror x coordinate
            const x = 1.0 - landmarks[8].x;
            const y = landmarks[8].y;
            
            const screenX = offsetX + (x * drawWidth);
            const screenY = offsetY + (y * drawHeight);
            
            const currentPoint = { x: screenX, y: screenY };

            // Handle Action Trigger (thumb up = save)
            if (gesture === 'action' && lastGesture !== 'action' && !actionDebounce) {
                actionDebounce = true;
                saveCanvas();
                setTimeout(() => { actionDebounce = false; }, 2000);
            }

            // Handle Drawing
            if (gesture === 'draw') {
                if (!isDrawing) {
                    isDrawing = true;
                    isErasing = false;
                    lastPoint = currentPoint;
                    previousPoint = currentPoint;
                } else {
                    setupDrawContext();
                    drawCtx.globalCompositeOperation = 'source-over';
                    
                    drawCtx.beginPath();
                    const midPoint = {
                        x: (lastPoint.x + currentPoint.x) / 2,
                        y: (lastPoint.y + currentPoint.y) / 2
                    };
                    drawCtx.moveTo(previousPoint.x, previousPoint.y);
                    drawCtx.quadraticCurveTo(lastPoint.x, lastPoint.y, midPoint.x, midPoint.y);
                    drawCtx.stroke();

                    previousPoint = midPoint;
                    lastPoint = currentPoint;
                }
            }
            // Handle Erasing
            else if (gesture === 'erase') {
                if (!isErasing) {
                    isErasing = true;
                    isDrawing = false;
                    lastPoint = currentPoint;
                    previousPoint = currentPoint;
                } else {
                    drawCtx.globalCompositeOperation = 'destination-out';
                    drawCtx.lineCap = 'round';
                    drawCtx.lineJoin = 'round';
                    drawCtx.lineWidth = currentSize * 5; // Large eraser
                    drawCtx.shadowBlur = 0;
                    
                    drawCtx.beginPath();
                    const midPoint = {
                        x: (lastPoint.x + currentPoint.x) / 2,
                        y: (lastPoint.y + currentPoint.y) / 2
                    };
                    drawCtx.moveTo(previousPoint.x, previousPoint.y);
                    drawCtx.quadraticCurveTo(lastPoint.x, lastPoint.y, midPoint.x, midPoint.y);
                    drawCtx.stroke();

                    previousPoint = midPoint;
                    lastPoint = currentPoint;
                }
            }
            // Move or other gestures — stop drawing/erasing
            else {
                if (isDrawing || isErasing) {
                    isDrawing = false;
                    isErasing = false;
                    drawCtx.globalCompositeOperation = 'source-over';
                    saveState();
                }
                lastPoint = null;
                previousPoint = null;
            }
        } else {
            // No hands detected — stop everything
            if (isDrawing || isErasing) {
                isDrawing = false;
                isErasing = false;
                drawCtx.globalCompositeOperation = 'source-over';
                saveState();
            }
            lastPoint = null;
            previousPoint = null;
        }
        
        outCtx.restore();

        // Update UI mode label
        if (gesture === 'draw') modeDisplay.textContent = 'Draw 🖌️';
        else if (gesture === 'erase') modeDisplay.textContent = 'Erase 🧽';
        else if (gesture === 'move') modeDisplay.textContent = 'Move ✌️';
        else if (gesture === 'action') modeDisplay.textContent = 'Action 👍';
        else modeDisplay.textContent = 'Waiting...';
        
        lastGesture = gesture;
    }
});
