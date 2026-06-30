// ==============================================
// script.js - Main JavaScript for Navigation App
// Uses:
//   - SpeechRecognition API  (Voice Input)
//   - SpeechSynthesis API    (Voice Output / TTS)
//   - getUserMedia API       (Webcam for obstacle check)
// ==============================================


// ---- VOICE OUTPUT (Text-to-Speech) ----
// This function converts text to spoken audio using the browser

function speak(text) {
    // Cancel any ongoing speech before speaking new text
    window.speechSynthesis.cancel();

    // Create a new speech utterance (the speech object)
    const utterance = new SpeechSynthesisUtterance(text);

    // Settings for the voice
    utterance.rate   = 0.9;   // Speed (0.1 = slow, 2 = fast)
    utterance.pitch  = 1.0;   // Pitch (0 = low, 2 = high)
    utterance.volume = 1.0;   // Volume (0 = silent, 1 = max)

    // Speak the text
    window.speechSynthesis.speak(utterance);
}


// ---- UPDATE STATUS BOX ----
// Updates the big status display box at the top of the page

function updateStatus(message) {
    const statusEl = document.getElementById('status-text');
    statusEl.textContent = message;
}


// ============================================
// FEATURE 1: NAVIGATION CONTROLS
// Handles button clicks for Forward/Left/Right/Stop
// ============================================

// Map of directions to responses
const navResponses = {
    forward: "Moving forward. Path ahead.",
    left:    "Turning left.",
    right:   "Turning right.",
    stop:    "Stopping. You are now stationary."
};

function navigate(direction) {
    // Get the response text for this direction
    const message = navResponses[direction] || "Unknown command.";

    // Show message on screen
    updateStatus("🧭 " + message);

    // Speak the message out loud
    speak(message);
}


// ============================================
// FEATURE 2: OBSTACLE DETECTION WITH CAMERA + PIXEL ANALYSIS
//
// How it works (no AI models, pure JavaScript):
//   1. Open webcam (getUserMedia)
//   2. Let camera warm up for 800ms
//   3. Capture FRAME 1 → pixel brightness data (baseline)
//   4. Wait 1500ms
//   5. Capture FRAME 2 → pixel brightness data (current)
//   6. Divide each frame into LEFT / CENTER / RIGHT thirds
//   7. Sum the absolute brightness difference per section
//   8. Highest-activity section = obstacle location
//   9. If total activity is below threshold → Path is clear
//  10. Speak & display result; only speak if result changed
// ============================================

// Stores the webcam stream so we can stop it later
let cameraStream = null;

// Stores the last spoken result to avoid repeating the same message
let lastObstacleResult = '';


// -----------------------------------------------
// HELPER: captureFrame
// Draws the current video frame onto the hidden
// canvas and returns raw pixel brightness array.
// -----------------------------------------------
function captureFrame(videoEl, canvas) {
    const ctx = canvas.getContext('2d');

    // Match canvas size to the actual video dimensions
    // (falls back to 320x240 if video not ready yet)
    canvas.width  = videoEl.videoWidth  || 320;
    canvas.height = videoEl.videoHeight || 240;

    // Draw the current video frame onto the canvas
    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

    // Read all pixel data: each pixel has 4 values (R, G, B, A)
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // Convert to a simple brightness array (one value per pixel)
    // Brightness = average of R, G, B channels (0–255)
    const pixels = imageData.data;         // raw RGBA array
    const brightness = new Float32Array(canvas.width * canvas.height);

    for (let i = 0; i < brightness.length; i++) {
        const r = pixels[i * 4];           // Red channel
        const g = pixels[i * 4 + 1];      // Green channel
        const b = pixels[i * 4 + 2];      // Blue channel
        brightness[i] = (r + g + b) / 3;  // Average brightness
    }

    return brightness;  // Return one brightness value per pixel
}


// -----------------------------------------------
// HELPER: analyzeActivity
// Compares two brightness frames.
// Divides the frame into 3 vertical sections and
// returns the total activity (change) in each.
// -----------------------------------------------
function analyzeActivity(frame1, frame2, width, height) {
    // Width of each third section (in pixels)
    const thirdW = Math.floor(width / 3);

    // Accumulators for each section
    let actLeft   = 0;
    let actCenter = 0;
    let actRight  = 0;

    // Loop through every pixel (row by row, column by column)
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx  = y * width + x;                         // pixel index
            const diff = Math.abs(frame1[idx] - frame2[idx]);  // brightness change

            // Add to the correct section based on x position
            if (x < thirdW) {
                actLeft += diff;           // Left third
            } else if (x < thirdW * 2) {
                actCenter += diff;         // Center third
            } else {
                actRight += diff;          // Right third
            }
        }
    }

    return { left: actLeft, center: actCenter, right: actRight };
}


// -----------------------------------------------
// HELPER: decideDirection
// Takes activity scores and returns a human-readable
// direction message.
//
// Threshold logic:
//   - Pixels per section = (width/3) * height
//   - If average diff per pixel > 10 → obstacle
//   - Otherwise → path is clear
// -----------------------------------------------
function decideDirection(activity, width, height) {
    const pixelsPerSection = Math.floor(width / 3) * height;

    // Average brightness change per pixel in each section (0–255 scale)
    const avgLeft   = activity.left   / pixelsPerSection;
    const avgCenter = activity.center / pixelsPerSection;
    const avgRight  = activity.right  / pixelsPerSection;

    // Minimum average change per pixel to count as "activity" (obstacle)
    // A value of 10 means: pixels changed by ≥10/255 brightness on average
    const THRESHOLD = 10;

    // Find the section with the highest activity
    const maxActivity = Math.max(avgLeft, avgCenter, avgRight);

    // If nothing moved much at all → clear path
    if (maxActivity < THRESHOLD) {
        return 'Path is clear. Safe to move forward.';
    }

    // Otherwise, report which section had the most movement
    if (maxActivity === avgLeft) {
        return 'Obstacle detected on the left. Move to the right.';
    } else if (maxActivity === avgRight) {
        return 'Obstacle detected on the right. Move to the left.';
    } else {
        return 'Obstacle detected ahead in the center. Move carefully to the left or right.';
    }
}


// -----------------------------------------------
// MAIN: checkObstacle
// Called when the user clicks "Check Obstacle".
// Orchestrates the full camera → analyze → speak flow.
// -----------------------------------------------
function checkObstacle() {
    const btn        = document.getElementById('btn-obstacle');
    const container  = document.getElementById('camera-container');
    const videoEl    = document.getElementById('camera-feed');
    const canvas     = document.getElementById('analysis-canvas');
    const obstacleEl = document.getElementById('obstacle-result');

    // Step 1: Disable button to prevent double-clicks
    btn.disabled    = true;
    btn.textContent = '⏳ Scanning...';

    updateStatus('📷 Opening camera for obstacle check...');
    speak('Opening camera. Scanning for obstacles.');

    // Step 2: Request webcam access
    navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        .then(function(stream) {

            cameraStream = stream;
            videoEl.srcObject = stream;
            container.style.display = 'block';
            updateStatus('📷 Camera open. Analysing surroundings...');

            // Step 3: Wait 800ms for camera to warm up, then capture baseline frame
            setTimeout(function() {
                const frame1 = captureFrame(videoEl, canvas);
                const w      = canvas.width;
                const h      = canvas.height;

                updateStatus('📷 Baseline captured. Checking for movement...');

                // Step 4: Wait 1500ms more, then capture the comparison frame
                setTimeout(function() {
                    const frame2   = captureFrame(videoEl, canvas);

                    // Step 5: Analyse the difference between the two frames
                    const activity = analyzeActivity(frame1, frame2, w, h);

                    // Step 6: Decide direction based on which section changed most
                    const result   = decideDirection(activity, w, h);

                    // Step 7: Show result on screen
                    obstacleEl.textContent = result;
                    obstacleEl.classList.add('active');
                    updateStatus('⚠️ ' + result);

                    // Step 8: Speak result ONLY if it changed from the last one
                    // This prevents repeating the same message every scan
                    if (result !== lastObstacleResult) {
                        speak(result);
                        lastObstacleResult = result;  // Save for next comparison
                    }

                    // Step 9: Stop camera automatically after delivering result
                    stopCamera();

                }, 1500);   // 1.5 second gap between the two frames

            }, 800);        // 0.8 second warm-up before first frame

        })
        .catch(function(error) {
            // Handle common camera errors gracefully
            let errMsg = 'Camera not available. ';

            if (error.name === 'NotAllowedError') {
                errMsg += 'Please allow camera permission in your browser.';
            } else if (error.name === 'NotFoundError') {
                errMsg += 'No camera found on this device.';
            } else {
                errMsg += 'Error: ' + error.message;
            }

            obstacleEl.textContent = errMsg;
            updateStatus('❌ ' + errMsg);
            speak(errMsg);

            resetObstacleBtn();
        });
}


// -----------------------------------------------
// HELPER: stopCamera
// Stops all camera tracks and hides the video feed.
// -----------------------------------------------
function stopCamera() {
    if (cameraStream) {
        // Stop each track (turns off the webcam indicator light)
        cameraStream.getTracks().forEach(function(track) {
            track.stop();
        });
        cameraStream = null;
    }

    // Hide the video container
    const container = document.getElementById('camera-container');
    const videoEl   = document.getElementById('camera-feed');
    container.style.display = 'none';
    videoEl.srcObject = null;  // Detach stream from the video element

    resetObstacleBtn();
}


// -----------------------------------------------
// HELPER: resetObstacleBtn
// Re-enables the Check Obstacle button after scanning.
// -----------------------------------------------
function resetObstacleBtn() {
    const btn       = document.getElementById('btn-obstacle');
    btn.disabled    = false;
    btn.textContent = '🔍 Check Obstacle';
}




// ============================================
// FEATURE 3: EMERGENCY BUTTON
// Sends a simulated help alert
// ============================================

function sendEmergency() {
    const message = "Emergency alert sent! Help is on the way. Please stay calm.";

    // Show in emergency result area
    const emergencyEl = document.getElementById('emergency-result');
    emergencyEl.textContent = message;
    emergencyEl.classList.add('active');
    emergencyEl.style.color = '#ff6b6b';  // Red color for emergency

    // Update status box
    updateStatus("🚨 " + message);

    // Speak the emergency message
    speak(message);
}


// ============================================
// FEATURE 4: VOICE INPUT (Speech Recognition)
// Listens to the user's voice and processes commands
// ============================================

// Track if we are currently listening
let isListening = false;

// Create the SpeechRecognition object
// webkit prefix needed for some browsers (like Chrome)
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

// Check if browser supports speech recognition
let recognition = null;

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous    = false;   // Stop after one result
    recognition.interimResults = false;  // Only final results
    recognition.lang          = 'en-US'; // Language

    // ---- When a voice result is received ----
    recognition.onresult = function(event) {
        // Get the transcript (what the user said)
        const transcript = event.results[0][0].transcript.toLowerCase().trim();

        // Show what was heard
        const voiceEl = document.getElementById('voice-result');
        voiceEl.textContent = 'You said: "' + transcript + '"';
        voiceEl.classList.add('active');

        // Process the voice command
        processVoiceCommand(transcript);

        // Stop listening after getting a result
        stopListening();
    };

    // ---- When recognition ends ----
    recognition.onend = function() {
        stopListening();
    };

    // ---- If there's an error ----
    recognition.onerror = function(event) {
        const voiceEl = document.getElementById('voice-result');

        if (event.error === 'not-allowed') {
            voiceEl.textContent = 'Microphone access denied. Please allow microphone.';
        } else if (event.error === 'no-speech') {
            voiceEl.textContent = 'No speech detected. Please try again.';
        } else {
            voiceEl.textContent = 'Error: ' + event.error;
        }

        stopListening();
    };

} else {
    // Browser does not support Speech Recognition
    console.warn("Speech Recognition not supported in this browser.");
}


// ---- Process voice command ----
// Maps what the user says to an action

function processVoiceCommand(command) {
    // Check the command and call the right function
    if (command.includes('start') || command.includes('forward') || command.includes('go')) {
        navigate('forward');

    } else if (command.includes('left')) {
        navigate('left');

    } else if (command.includes('right')) {
        navigate('right');

    } else if (command.includes('stop') || command.includes('halt')) {
        navigate('stop');

    } else if (command.includes('help') || command.includes('emergency')) {
        sendEmergency();

    } else if (command.includes('obstacle') || command.includes('check')) {
        checkObstacle();

    } else {
        // Unknown command
        const msg = "Command not recognized. Please say start, stop, left, right, or help.";
        updateStatus("❓ " + msg);
        speak(msg);
    }
}


// ---- Toggle microphone on/off ----

function toggleVoice() {
    if (isListening) {
        stopListening();
    } else {
        startListening();
    }
}


// ---- Start listening ----

function startListening() {
    // If browser doesn't support it, show error
    if (!recognition) {
        alert("Sorry, your browser does not support voice input. Please use Chrome.");
        return;
    }

    isListening = true;

    // Update button to show "listening" state
    const btn = document.getElementById('btn-voice');
    btn.textContent = '🔴 Listening... (Click to Stop)';
    btn.classList.add('btn-listening');

    // Update status
    updateStatus("🎤 Listening... Please speak your command.");

    // Start recognition
    recognition.start();
}


// ---- Stop listening ----

function stopListening() {
    if (!recognition) return;

    isListening = false;

    // Restore button to original state
    const btn = document.getElementById('btn-voice');
    btn.textContent = '🎙️ Start Listening';
    btn.classList.remove('btn-listening');

    // Stop recognition (safe to call even if already stopped)
    try { recognition.stop(); } catch(e) {}
}


// ============================================
// STARTUP - Greet user when page loads
// ============================================

window.addEventListener('load', function() {
    // Small delay so browser is ready
    setTimeout(function() {
        const welcomeMsg = "Welcome to AI Navigation Assistant. Press a button or speak a command.";
        speak(welcomeMsg);
    }, 1000);
});
