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
    let isMoving = false;
    let lastPoint = null;
    let previousPoint = null;
    let moveAnchor = null; // For tracking move deltas
    
    let undoStack = [];
    let redoStack = [];
    let lastGesture = 'none';
    let actionDebounce = false;

    // Initialize Canvas Sizes
    function resizeCanvases() {
        const dataUrl = drawingCanvas.toDataURL();
        
        outputCanvas.width = window.innerWidth;
        outputCanvas.height = window.innerHeight;
        
        drawingCanvas.width = window.innerWidth;
        drawingCanvas.height = window.innerHeight;
        
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
        drawCtx.globalCompositeOperation = 'source-over';
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
        if (undoStack.length > 30) undoStack.shift();
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

    // ─── GESTURE DETECTION (Robust) ───

    function isFingerUp(landmarks, tipIdx, pipIdx) {
        // A finger is "up" if the tip is above the PIP joint (lower y = higher on screen)
        return landmarks[tipIdx].y < landmarks[pipIdx].y - 0.02;
    }

    function detectGesture(landmarks) {
        const indexUp = isFingerUp(landmarks, 8, 6);
        const middleUp = isFingerUp(landmarks, 12, 10);
        const ringUp = isFingerUp(landmarks, 16, 14);
        const pinkyUp = isFingerUp(landmarks, 20, 18);

        // Count fingers (excluding thumb for simplicity)
        let fingersUp = 0;
        if (indexUp) fingersUp++;
        if (middleUp) fingersUp++;
        if (ringUp) fingersUp++;
        if (pinkyUp) fingersUp++;

        // Thumb up gesture: thumb tip significantly above thumb MCP, all other fingers closed
        const thumbTip = landmarks[4];
        const thumbMCP = landmarks[2];
        const thumbUp = (thumbTip.y < thumbMCP.y - 0.05) && fingersUp === 0;

        if (thumbUp) {
            return 'action';
        }

        // ERASE: 3 or more fingers raised (open hand)
        if (fingersUp >= 3) {
            return 'erase';
        }

        // MOVE: exactly 2 fingers up (index + middle, peace sign)
        if (fingersUp === 2 && indexUp && middleUp) {
            return 'move';
        }

        // DRAW: only index finger up
        if (indexUp && !middleUp) {
            return 'draw';
        }

        return 'none';
    }

    // ─── CURSOR DRAWING ───

    function drawCursor(x, y, gesture) {
        outCtx.save();
        // Reset transform since we want to draw in screen space
        outCtx.setTransform(1, 0, 0, 1, 0, 0);

        if (gesture === 'draw') {
            // Small neon dot
            outCtx.beginPath();
            outCtx.arc(x, y, currentSize / 2 + 2, 0, Math.PI * 2);
            outCtx.fillStyle = currentColor;
            outCtx.shadowBlur = 20;
            outCtx.shadowColor = currentColor;
            outCtx.fill();
        } else if (gesture === 'erase') {
            // Big eraser circle
            const eraseRadius = currentSize * 3;
            outCtx.beginPath();
            outCtx.arc(x, y, eraseRadius, 0, Math.PI * 2);
            outCtx.strokeStyle = '#ff4444';
            outCtx.lineWidth = 2;
            outCtx.shadowBlur = 15;
            outCtx.shadowColor = '#ff4444';
            outCtx.stroke();
            // X inside
            outCtx.font = `${eraseRadius}px Outfit`;
            outCtx.fillStyle = '#ff4444';
            outCtx.textAlign = 'center';
            outCtx.textBaseline = 'middle';
            outCtx.fillText('✕', x, y);
        } else if (gesture === 'move') {
            // Move arrows icon
            outCtx.beginPath();
            outCtx.arc(x, y, 18, 0, Math.PI * 2);
            outCtx.strokeStyle = '#00ffff';
            outCtx.lineWidth = 2;
            outCtx.shadowBlur = 15;
            outCtx.shadowColor = '#00ffff';
            outCtx.stroke();
            outCtx.font = '20px Outfit';
            outCtx.fillStyle = '#00ffff';
            outCtx.textAlign = 'center';
            outCtx.textBaseline = 'middle';
            outCtx.fillText('✥', x, y);
        }

        outCtx.restore();
    }

    // ─── MEDIAPIPE SETUP ───

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

    const camera = new Camera(videoElement, {
        onFrame: async () => {
            await hands.send({image: videoElement});
        },
        width: 1280,
        height: 720
    });
    camera.start();

    // ─── COORDINATE CALCULATION ───

    function getScreenCoords(landmarks, results) {
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

        // Mirror x for selfie view
        const x = 1.0 - landmarks[8].x;
        const y = landmarks[8].y;
        
        return {
            x: offsetX + (x * drawWidth),
            y: offsetY + (y * drawHeight)
        };
    }

    // ─── STOP ACTIVE MODES ───

    function stopAllModes() {
        if (isDrawing || isErasing || isMoving) {
            drawCtx.globalCompositeOperation = 'source-over';
            saveState();
        }
        isDrawing = false;
        isErasing = false;
        isMoving = false;
        lastPoint = null;
        previousPoint = null;
        moveAnchor = null;
    }

    // ─── MAIN FRAME HANDLER ───

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
            let dW, dH, oX, oY;

            if (canvasAspect > videoAspect) {
                dW = outputCanvas.width;
                dH = outputCanvas.width / videoAspect;
                oX = 0;
                oY = (outputCanvas.height - dH) / 2;
            } else {
                dH = outputCanvas.height;
                dW = outputCanvas.height * videoAspect;
                oX = (outputCanvas.width - dW) / 2;
                oY = 0;
            }
            
            outCtx.drawImage(results.image, oX, oY, dW, dH);
        }

        let gesture = 'none';
        
        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            const landmarks = results.multiHandLandmarks[0];
            
            // Draw skeleton
            if (toggleSkeleton.checked) {
                drawConnectors(outCtx, landmarks, HAND_CONNECTIONS, {color: '#00FF00', lineWidth: 2});
                drawLandmarks(outCtx, landmarks, {color: '#FF0000', lineWidth: 1, radius: 3});
            }

            outCtx.restore(); // Restore before drawing cursor in screen space

            // Detect gesture
            gesture = detectGesture(landmarks);
            const coords = getScreenCoords(landmarks, results);
            const currentPoint = { x: coords.x, y: coords.y };

            // Draw cursor indicator
            drawCursor(currentPoint.x, currentPoint.y, gesture);

            // ── HANDLE ACTION (Thumb Up = Save)
            if (gesture === 'action' && lastGesture !== 'action' && !actionDebounce) {
                actionDebounce = true;
                saveCanvas();
                setTimeout(() => { actionDebounce = false; }, 2000);
            }

            // ── HANDLE DRAW
            if (gesture === 'draw') {
                if (isErasing || isMoving) stopAllModes();
                
                if (!isDrawing) {
                    isDrawing = true;
                    lastPoint = currentPoint;
                    previousPoint = currentPoint;
                } else {
                    setupDrawContext();
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
            // ── HANDLE ERASE (Open hand - wipes strokes away)
            else if (gesture === 'erase') {
                if (isDrawing || isMoving) stopAllModes();
                
                if (!isErasing) {
                    isErasing = true;
                    lastPoint = currentPoint;
                    previousPoint = currentPoint;
                } else {
                    const eraseRadius = currentSize * 3;
                    // Clear a circular area around the finger
                    drawCtx.save();
                    drawCtx.globalCompositeOperation = 'destination-out';
                    drawCtx.beginPath();
                    drawCtx.arc(currentPoint.x, currentPoint.y, eraseRadius, 0, Math.PI * 2);
                    drawCtx.fill();
                    drawCtx.restore();
                    
                    lastPoint = currentPoint;
                    previousPoint = currentPoint;
                }
            }
            // ── HANDLE MOVE (Peace sign - drags entire drawing)
            else if (gesture === 'move') {
                if (isDrawing || isErasing) stopAllModes();
                
                if (!isMoving) {
                    isMoving = true;
                    moveAnchor = currentPoint;
                } else {
                    const dx = currentPoint.x - moveAnchor.x;
                    const dy = currentPoint.y - moveAnchor.y;
                    
                    // Only move if the delta is significant (avoids jitter)
                    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
                        // Grab current canvas content
                        const imageData = drawCtx.getImageData(0, 0, drawingCanvas.width, drawingCanvas.height);
                        drawCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
                        drawCtx.putImageData(imageData, dx, dy);
                        moveAnchor = currentPoint;
                    }
                }
            }
            // ── IDLE / NO GESTURE
            else {
                stopAllModes();
            }
        } else {
            outCtx.restore();
            stopAllModes();
        }

        // Update UI mode label
        if (gesture === 'draw') modeDisplay.textContent = 'Draw 🖌️';
        else if (gesture === 'erase') modeDisplay.textContent = 'Erase 🧽';
        else if (gesture === 'move') modeDisplay.textContent = 'Move ✌️';
        else if (gesture === 'action') modeDisplay.textContent = 'Action 👍';
        else modeDisplay.textContent = 'Waiting...';
        
        lastGesture = gesture;
    }
});
