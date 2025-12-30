/* 
  content.js:
  The core script that runs on the web pages.
  - Injects sticky notes into the DOM.
  - Handles drag-and-drop logic.
  - Manages real-time editing and resizing.
  - Loads and saves note data using chrome.storage.local.
  - FINAL: Support for floating PDF viewport-relative overlays.
*/

console.log('StickyNotes Content Script Active.');

let isPlacingNote = false;
let pendingNoteColor = '#fff740';
let pendingNoteFont = "'Segoe UI', sans-serif";
let isPdfPage = false;
let isFocusModeActive = false; // Track Focus Mode state globally

// Audio State Tracking
const activeRecorders = new Map();
const activePlayers = new Map();

// Initial Load: Render notes for the current URL
window.addEventListener('load', () => {
    checkPdfStatus();
    injectGoogleFonts();
    loadNotes();
});

// Resize / Zoom handler for PDF notes
window.addEventListener('resize', repositionPdfNotes);

function checkPdfStatus() {
    const isPdfUrl = window.location.pathname.toLowerCase().endsWith('.pdf');
    const hasPdfEmbed = document.querySelector('embed[type="application/pdf"], object[type="application/pdf"]');
    const isPdfViewer = document.querySelector('pdf-viewer') || document.body.classList.contains('pdf-viewer');

    if (isPdfUrl || hasPdfEmbed || isPdfViewer) {
        console.log('StickyNotes: PDF detected. Activating Floating Overlay Mode.');
        isPdfPage = true;
    }
}

function repositionPdfNotes() {
    if (!isPdfPage) return;
    const notes = document.querySelectorAll('.stickynote-container');
    notes.forEach(note => {
        if (note.dataset.xRatio && note.dataset.yRatio) {
            const x = parseFloat(note.dataset.xRatio) * window.innerWidth;
            const y = parseFloat(note.dataset.yRatio) * window.innerHeight;
            note.style.left = `${x}px`;
            note.style.top = `${y}px`;
        }
    });
}

function injectGoogleFonts() {
    if (document.getElementById('stickynotes-fonts')) return;
    const link = document.createElement('link');
    link.id = 'stickynotes-fonts';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Indie+Flower&family=Patrick+Hand&family=Shadows+Into+Light&display=swap';
    document.head.appendChild(link);
}

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'PING') {
        sendResponse({ status: 'PONG' });
        return true;
    }
    if (request.action === 'INIT_NOTE_PLACEMENT') {
        pendingNoteColor = request.color;
        pendingNoteFont = request.font;

        if (isPdfPage) {
            // PDF: Instant floating addition at smart default
            console.log('StickyNotes: Instantly adding floating note to PDF.');
            const noteId = Date.now();
            const x = window.innerWidth - 244;
            const y = 24;
            const xRatio = x / window.innerWidth;
            const yRatio = y / window.innerHeight;

            createStickyNote({
                id: noteId,
                x: x,
                y: y,
                color: pendingNoteColor,
                content: '',
                font: pendingNoteFont,
                isPdf: true,
                xRatio: xRatio,
                yRatio: yRatio
            });
            saveNotes();
        } else {
            isPlacingNote = true;
            document.body.style.cursor = 'crosshair';
        }
    }
    if (request.action === 'TOGGLE_FOCUS_MODE') {
        applyFocusMode(request.enabled);
    }
});

function applyFocusMode(enabled) {
    isFocusModeActive = enabled; // Sync global state
    const notes = document.querySelectorAll('.stickynote-container');
    notes.forEach(note => {
        if (enabled) {
            note.classList.add('stickynote-hidden');
        } else {
            note.classList.remove('stickynote-hidden');
        }
    });
    console.log('Focus Mode:', enabled ? 'ON' : 'OFF');
}

// Handle clicks for note placement (Normal Websites Only)
document.addEventListener('click', (e) => {
    if (!isPlacingNote || isPdfPage) return;

    // Check if we clicked on an existing note or its UI
    if (e.target.closest('.stickynote-container')) return;

    e.preventDefault();
    e.stopPropagation();

    const noteId = Date.now();

    createStickyNote({
        id: noteId,
        x: e.pageX,
        y: e.pageY,
        color: pendingNoteColor,
        content: '',
        font: pendingNoteFont,
        isPdf: false
    });

    saveNotes(); // Save after creation

    isPlacingNote = false;
    document.body.style.cursor = 'default';
}, true);

function createStickyNote({ id, x, y, color, content: contentText, font, isPdf = false, xRatio = null, yRatio = null, audioBase64 = null }) {
    const container = document.createElement('div');
    container.className = 'stickynote-container';
    container.id = `note-${id}`;

    if (isPdf) {
        container.style.position = 'fixed';
        container.dataset.isPdf = 'true';

        // Use provided ratios or calculate from current x,y
        const finalXRatio = xRatio !== null ? xRatio : (x / window.innerWidth);
        const finalYRatio = yRatio !== null ? yRatio : (y / window.innerHeight);

        container.dataset.xRatio = finalXRatio;
        container.dataset.yRatio = finalYRatio;

        // Apply calculated absolute position
        container.style.left = `${finalXRatio * window.innerWidth}px`;
        container.style.top = `${finalYRatio * window.innerHeight}px`;
    } else {
        container.style.position = 'absolute';
        container.style.left = `${x}px`;
        container.style.top = `${y}px`;
        container.dataset.isPdf = 'false';
    }

    // [FIX] Only apply focus mode to restored notes, not new ones
    if (isFocusModeActive && contentText) {
        container.classList.add('stickynote-hidden');
    }

    // Color and Visibility
    container.style.backgroundColor = color;
    container.style.opacity = '1';
    container.style.visibility = 'visible';
    container.style.color = '#333';

    // Header (Draggable handle and Actions)
    const header = document.createElement('div');
    header.className = 'stickynote-header';

    // Audio UI Elements
    const recordBtn = document.createElement('button');
    recordBtn.innerText = '🎤';
    recordBtn.className = 'stickynote-audio-btn';
    recordBtn.title = 'Start Recording (max 60s)';

    const stopBtn = document.createElement('button');
    stopBtn.innerText = '⏹';
    stopBtn.className = 'stickynote-audio-btn';
    stopBtn.style.display = 'none';
    stopBtn.title = 'Stop Recording';

    const playBtn = document.createElement('button');
    playBtn.innerText = '▶️';
    playBtn.className = 'stickynote-audio-btn';
    playBtn.style.display = audioBase64 ? 'inline-block' : 'none';
    playBtn.title = 'Play Audio';

    // Store audio data in the dataset
    if (audioBase64) {
        container.dataset.audioBase64 = audioBase64;
    }

    recordBtn.onclick = (e) => {
        e.stopPropagation();
        startRecording(id, recordBtn, stopBtn, playBtn, container);
    };

    stopBtn.onclick = (e) => {
        e.stopPropagation();
        stopRecording(id);
    };

    playBtn.onclick = (e) => {
        e.stopPropagation();
        playAudio(id, container);
    };

    const deleteBtn = document.createElement('button');
    deleteBtn.innerText = '×';
    deleteBtn.className = 'stickynote-delete';
    deleteBtn.onclick = (e) => {
        e.stopPropagation();
        if (activeRecorders.has(id)) stopRecording(id);
        container.remove();
        saveNotes();
    };

    header.appendChild(recordBtn);
    header.appendChild(stopBtn);
    header.appendChild(playBtn);
    header.appendChild(deleteBtn);

    // Content Area
    const content = document.createElement('textarea');
    content.className = 'stickynote-content';
    content.placeholder = 'Type your note here...';
    content.value = contentText || '';
    content.style.fontFamily = font || "'Segoe UI', sans-serif";

    // Save on content change
    content.addEventListener('input', () => saveNotes());

    container.appendChild(header);
    container.appendChild(content);

    document.body.appendChild(container);

    makeDraggable(container, isPdf);

    if (!contentText && !audioBase64) content.focus();
}

/**
 * Audio Recording Logic
 */
async function startRecording(noteId, recordBtn, stopBtn, playBtn, container) {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        const audioChunks = [];

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) audioChunks.push(event.data);
        };

        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            const reader = new FileReader();
            reader.readAsDataURL(audioBlob);
            reader.onloadend = () => {
                const base64 = reader.result;
                container.dataset.audioBase64 = base64;
                playBtn.style.display = 'inline-block';
                saveNotes();
            };

            // Cleanup stream
            stream.getTracks().forEach(track => track.stop());

            // UI Reset
            recordBtn.style.display = 'inline-block';
            stopBtn.style.display = 'none';
            recordBtn.classList.remove('recording');
        };

        mediaRecorder.start();
        activeRecorders.set(noteId, mediaRecorder);

        // UI Update
        recordBtn.style.display = 'none';
        stopBtn.style.display = 'inline-block';
        recordBtn.classList.add('recording');

        // Auto-stop after 60 seconds
        setTimeout(() => {
            if (activeRecorders.has(noteId)) {
                stopRecording(noteId);
            }
        }, 60000);

    } catch (err) {
        console.warn('StickyNotes: Microphone access denied or MediaRecorder error.', err);
    }
}

function stopRecording(noteId) {
    const recorder = activeRecorders.get(noteId);
    if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
        activeRecorders.delete(noteId);
    }
}

function playAudio(noteId, container) {
    const base64 = container.dataset.audioBase64;
    if (!base64) return;

    // Stop existing playback for this note if any
    if (activePlayers.has(noteId)) {
        activePlayers.get(noteId).pause();
    }

    const audio = new Audio(base64);
    audio.play();
    activePlayers.set(noteId, audio);

    audio.onended = () => activePlayers.delete(noteId);
}

/**
 * Drag-and-Drop Implementation
 */
function makeDraggable(element, isPdf = false) {
    const handle = element.querySelector('.stickynote-header');
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

    handle.onmousedown = dragMouseDown;

    function dragMouseDown(e) {
        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;

        document.onmouseup = closeDragElement;
        document.onmousemove = elementDrag;

        element.style.cursor = 'grabbing';
        handle.style.cursor = 'grabbing';
    }

    function elementDrag(e) {
        e.preventDefault();
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;

        let newTop = element.offsetTop - pos2;
        let newLeft = element.offsetLeft - pos1;

        if (isPdf) {
            newTop = Math.max(0, Math.min(newTop, window.innerHeight - element.offsetHeight));
            newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - element.offsetWidth));
        }

        element.style.top = newTop + "px";
        element.style.left = newLeft + "px";
    }

    function closeDragElement() {
        document.onmouseup = null;
        document.onmousemove = null;

        element.style.cursor = 'default';
        handle.style.cursor = 'grab';

        if (isPdf) {
            const left = parseFloat(element.style.left);
            const top = parseFloat(element.style.top);
            element.dataset.xRatio = left / window.innerWidth;
            element.dataset.yRatio = top / window.innerHeight;
        }

        saveNotes();
    }
}

/**
 * Persistent Storage Logic
 */
async function saveNotes() {
    const currentUrl = window.location.href;
    const notes = [];

    const noteElements = document.querySelectorAll('.stickynote-container');
    noteElements.forEach((el) => {
        const textarea = el.querySelector('textarea');
        const isPdf = el.dataset.isPdf === 'true';

        notes.push({
            id: el.id.replace('note-', ''),
            x: parseInt(el.style.left) || 0,
            y: parseInt(el.style.top) || 0,
            xRatio: el.dataset.xRatio ? parseFloat(el.dataset.xRatio) : null,
            yRatio: el.dataset.yRatio ? parseFloat(el.dataset.yRatio) : null,
            isPdf: isPdf,
            color: el.style.backgroundColor,
            content: textarea.value,
            font: textarea.style.fontFamily,
            audioBase64: el.dataset.audioBase64 || null
        });
    });

    const data = {};
    data[currentUrl] = notes;

    await chrome.storage.local.set(data);
    console.log('Notes saved for:', currentUrl);
}

async function loadNotes() {
    const currentUrl = window.location.href;
    const data = await chrome.storage.local.get([currentUrl, 'focusMode']);

    if (data[currentUrl]) {
        data[currentUrl].forEach(note => {
            createStickyNote({
                id: note.id,
                x: note.x,
                y: note.y,
                color: note.color,
                content: note.content,
                font: note.font,
                isPdf: note.isPdf,
                xRatio: note.xRatio,
                yRatio: note.yRatio,
                audioBase64: note.audioBase64 || null
            });
        });
        console.log('Notes restored for:', currentUrl);
    }

    // Apply Focus Mode immediately if enabled
    if (data.focusMode) {
        applyFocusMode(true);
    }
}
