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

    // Initialize MediaPipe Hands
    const hands = new Hands({locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
    }});

    hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.7
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
            // Fill entire canvas while preserving aspect ratio
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
                // Since we flipped the context, drawing_utils will draw it correctly matched to the mirrored video
                drawConnectors(outCtx, landmarks, HAND_CONNECTIONS, {color: '#00FF00', lineWidth: 2});
                drawLandmarks(outCtx, landmarks, {color: '#FF0000', lineWidth: 1, radius: 2});
            }

            // Finger Tips and MCPs
            const thumb_tip = landmarks[4];
            const index_tip = landmarks[8];
            const middle_tip = landmarks[12];
            const ring_tip = landmarks[16];
            const pinky_tip = landmarks[20];
            
            const thumb_mcp = landmarks[2];
            const index_mcp = landmarks[5];
            const middle_mcp = landmarks[9];
            const ring_mcp = landmarks[13];
            const pinky_mcp = landmarks[17];

            // Heuristics (y is 0 at top, 1 at bottom)
            const index_up = index_tip.y < index_mcp.y;
            const middle_up = middle_tip.y < middle_mcp.y;
            const ring_up = ring_tip.y < ring_mcp.y;
            const pinky_up = pinky_tip.y < pinky_mcp.y;
            
            const thumb_up = thumb_tip.y < index_mcp.y && !index_up && !middle_up && !ring_up && !pinky_up;

            if (thumb_up) gesture = 'action';
            else if (index_up && middle_up && ring_up && pinky_up) gesture = 'move';
            else if (index_up && middle_up && !ring_up && !pinky_up) gesture = 'erase';
            else if (index_up && !middle_up && !ring_up && !pinky_up) gesture = 'draw';

            // Coordinates for drawing (Index finger tip)
            // Need to calculate screen position based on object-fit 'cover' scaling
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

            // x coordinate needs mirroring
            const x = 1.0 - index_tip.x;
            const y = index_tip.y;
            
            const screenX = offsetX + (x * drawWidth);
            const screenY = offsetY + (y * drawHeight);
            
            const currentPoint = { x: screenX, y: screenY };

            // Handle Action Trigger
            if (gesture === 'action' && lastGesture !== 'action' && !actionDebounce) {
                actionDebounce = true;
                saveCanvas();
                setTimeout(() => { actionDebounce = false; }, 2000);
            }

            // Handle Drawing and Erasing
            if (gesture === 'draw' || gesture === 'erase') {
                if (!isDrawing) {
                    isDrawing = true;
                    lastPoint = currentPoint;
                    previousPoint = currentPoint;
                } else {
                    setupDrawContext();
                    
                    if (gesture === 'erase') {
                        drawCtx.globalCompositeOperation = 'destination-out';
                        drawCtx.lineWidth = currentSize * 3;
                        drawCtx.shadowBlur = 0;
                    } else {
                        drawCtx.globalCompositeOperation = 'source-over';
                    }
                    
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
            } else {
                if (isDrawing) {
                    isDrawing = false;
                    drawCtx.globalCompositeOperation = 'source-over';
                    saveState();
                }
            }
        } else {
            // No hands detected
            if (isDrawing) {
                isDrawing = false;
                saveState();
            }
        }
        
        outCtx.restore();

        // Update UI
        if(gesture === 'draw') modeDisplay.textContent = 'Draw 🖌️';
        else if(gesture === 'erase') modeDisplay.textContent = 'Erase 🧽';
        else if(gesture === 'move') modeDisplay.textContent = 'Move 🖐️';
        else if(gesture === 'action') modeDisplay.textContent = 'Action 👍';
        else modeDisplay.textContent = 'Waiting...';
        
        lastGesture = gesture;
    }
});
