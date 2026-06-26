document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('drawing-canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const video = document.getElementById('video-feed');
    
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

    // Initialize Canvas Size
    function resizeCanvas() {
        // Save current canvas content
        const dataUrl = canvas.toDataURL();
        
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        
        // Restore content
        const img = new Image();
        img.onload = () => {
            ctx.drawImage(img, 0, 0);
        };
        img.src = dataUrl;
        
        if(undoStack.length === 0) {
            saveState(); // Initial blank state
        }
    }
    
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    // Setup Canvas context styles
    function setupContext() {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = currentSize;
        ctx.strokeStyle = currentColor;
        ctx.shadowBlur = 15;
        ctx.shadowColor = currentColor;
    }

    // UI Event Listeners
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

    toggleCamera.addEventListener('change', (e) => {
        video.style.opacity = e.target.checked ? '1' : '0';
    });

    toggleSkeleton.addEventListener('change', (e) => {
        fetch('/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ show_skeleton: e.target.checked })
        });
    });

    document.getElementById('btn-undo').addEventListener('click', undo);
    document.getElementById('btn-redo').addEventListener('click', redo);
    document.getElementById('btn-clear').addEventListener('click', clearCanvas);
    document.getElementById('btn-save').addEventListener('click', saveCanvas);

    // Canvas History
    function saveState() {
        undoStack.push(canvas.toDataURL());
        if (undoStack.length > 20) undoStack.shift(); // Max 20 history
        redoStack = []; // Clear redo stack on new action
    }

    function undo() {
        if (undoStack.length > 1) {
            redoStack.push(undoStack.pop());
            restoreState(undoStack[undoStack.length - 1]);
        } else if (undoStack.length === 1) {
            redoStack.push(undoStack.pop());
            ctx.clearRect(0, 0, canvas.width, canvas.height);
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
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);
        };
        img.src = dataUrl;
    }

    function clearCanvas() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        saveState();
    }

    function saveCanvas() {
        // Create a temporary canvas with a black background to save
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tCtx = tempCanvas.getContext('2d');
        
        tCtx.fillStyle = '#0f0f13';
        tCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        tCtx.drawImage(canvas, 0, 0);

        const link = document.createElement('a');
        link.download = 'ai-air-drawing.png';
        link.href = tempCanvas.toDataURL('image/png');
        link.click();
    }

    // Polling Loop
    async function fetchLandmarks() {
        try {
            const res = await fetch('/landmarks');
            const data = await res.json();
            handleLandmarks(data);
        } catch (e) {
            // Ignore errors
        }
        requestAnimationFrame(fetchLandmarks);
    }

    function handleLandmarks(data) {
        const { x, y, gesture } = data;
        
        // Convert normalized coords to screen space
        // Note: x is flipped in video feed usually, but we handle it assuming backend already flipped the frame
        const screenX = x * canvas.width;
        const screenY = y * canvas.height;
        const currentPoint = { x: screenX, y: screenY };

        // Update Mode Display
        if(gesture === 'draw') modeDisplay.textContent = 'Draw 🖌️';
        else if(gesture === 'erase') modeDisplay.textContent = 'Move/Erase 🖐️';
        else if(gesture === 'action') modeDisplay.textContent = 'Action 👍';
        else modeDisplay.textContent = 'Waiting...';

        // Action Trigger
        if (gesture === 'action' && lastGesture !== 'action' && !actionDebounce) {
            actionDebounce = true;
            saveCanvas();
            setTimeout(() => { actionDebounce = false; }, 2000); // debounce 2s
        }

        // Draw Logic
        if (gesture === 'draw') {
            if (!isDrawing) {
                isDrawing = true;
                lastPoint = currentPoint;
                previousPoint = currentPoint;
            } else {
                setupContext();
                ctx.beginPath();
                
                // Quadratic bezier for smoothness
                const midPoint = {
                    x: (lastPoint.x + currentPoint.x) / 2,
                    y: (lastPoint.y + currentPoint.y) / 2
                };
                
                ctx.moveTo(previousPoint.x, previousPoint.y);
                ctx.quadraticCurveTo(lastPoint.x, lastPoint.y, midPoint.x, midPoint.y);
                ctx.stroke();

                previousPoint = midPoint;
                lastPoint = currentPoint;
            }
        } else {
            if (isDrawing) {
                isDrawing = false;
                saveState();
            }
        }

        lastGesture = gesture;
    }

    // Start Polling
    fetchLandmarks();
});
