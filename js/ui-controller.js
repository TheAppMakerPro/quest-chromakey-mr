/**
 * UIController — manages all 2D and XR overlay UI interactions.
 */
const UIController = (() => {

  // ---- State ----
  let currentColor = 'green';
  let tolerance = 0.35;
  let smoothing = 0.10;
  let screenDistance = 2.0;
  let screenScale = 1.0;
  let screenOffsetX = 0;   // horizontal offset in meters
  let screenOffsetY = 1.5; // vertical position in meters (eye height)

  // Move/resize step sizes
  const MOVE_STEP = 0.15;     // meters per tap
  const DEPTH_STEP = 0.3;     // meters per tap
  const SCALE_STEP = 0.15;    // scale increment per tap

  // ---- DOM refs ----
  const $ = (id) => document.getElementById(id);

  let elements = {};

  function init() {
    elements = {
      videoUrl:       $('video-url'),
      loadBtn:        $('load-btn'),
      statusBar:      $('status-bar'),
      previewMsg:     $('preview-msg'),
      videoControls:  $('video-controls'),
      playPauseBtn:   $('play-pause-btn'),
      restartBtn:     $('restart-btn'),
      toleranceSlider:  $('tolerance-slider'),
      toleranceValue:   $('tolerance-value'),
      smoothingSlider:  $('smoothing-slider'),
      smoothingValue:   $('smoothing-value'),
      distanceSlider:   $('distance-slider'),
      distanceValue:    $('distance-value'),
      scaleSlider:      $('scale-slider'),
      scaleValue:       $('scale-value'),
      enterMrBtn:       $('enter-mr-btn'),
      // XR overlay
      xrOverlay:          $('xr-overlay'),
      xrPlayPause:        $('xr-play-pause'),
      xrColorToggle:      $('xr-color-toggle'),
      xrToleranceSlider:  $('xr-tolerance-slider'),
      xrToleranceValue:   $('xr-tolerance-value'),
      xrExitBtn:          $('xr-exit-btn'),
      xrSizeLabel:        $('xr-size-label'),
      xrSmaller:          $('xr-smaller'),
      xrBigger:           $('xr-bigger')
    };

    bindEvents();
    checkUrlParam();
  }

  function bindEvents() {
    // Load video
    elements.loadBtn.addEventListener('click', handleLoadVideo);
    elements.videoUrl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleLoadVideo();
    });

    // Color buttons
    document.querySelectorAll('.color-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        setActiveColor(btn.dataset.color);
      });
    });

    // Tolerance slider
    elements.toleranceSlider.addEventListener('input', (e) => {
      tolerance = parseFloat(e.target.value);
      elements.toleranceValue.textContent = tolerance.toFixed(2);
      ChromaKey.setTolerance(tolerance);
    });

    // Smoothing slider
    elements.smoothingSlider.addEventListener('input', (e) => {
      smoothing = parseFloat(e.target.value);
      elements.smoothingValue.textContent = smoothing.toFixed(2);
      ChromaKey.setSmoothing(smoothing);
    });

    // Distance slider
    elements.distanceSlider.addEventListener('input', (e) => {
      screenDistance = parseFloat(e.target.value);
      elements.distanceValue.textContent = screenDistance.toFixed(1) + 'm';
    });

    // Scale slider
    elements.scaleSlider.addEventListener('input', (e) => {
      screenScale = parseFloat(e.target.value);
      elements.scaleValue.textContent = screenScale.toFixed(1) + 'x';
      updateSizeLabel();
    });

    // Video controls
    elements.playPauseBtn.addEventListener('click', () => {
      const playing = VideoPlayer.togglePlayPause();
      elements.playPauseBtn.textContent = playing ? 'Pause' : 'Play';
    });

    elements.restartBtn.addEventListener('click', () => {
      VideoPlayer.restart();
      elements.playPauseBtn.textContent = 'Pause';
    });

    // Enter MR
    elements.enterMrBtn.addEventListener('click', () => {
      if (typeof App !== 'undefined' && App.startXR) App.startXR();
    });

    // ---- XR overlay: Move buttons ----
    document.querySelectorAll('[data-move]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const dir = btn.dataset.move;
        switch (dir) {
          case 'left':    screenOffsetX -= MOVE_STEP; break;
          case 'right':   screenOffsetX += MOVE_STEP; break;
          case 'up':      screenOffsetY += MOVE_STEP; break;
          case 'down':    screenOffsetY -= MOVE_STEP; break;
          case 'closer':  screenDistance = Math.max(0.3, screenDistance - DEPTH_STEP); break;
          case 'farther': screenDistance = Math.min(10, screenDistance + DEPTH_STEP); break;
        }
      });
    });

    // ---- XR overlay: Resize buttons ----
    elements.xrSmaller.addEventListener('click', () => {
      screenScale = Math.max(0.2, screenScale - SCALE_STEP);
      updateSizeLabel();
    });

    elements.xrBigger.addEventListener('click', () => {
      screenScale = Math.min(5, screenScale + SCALE_STEP);
      updateSizeLabel();
    });

    // ---- XR overlay: Playback ----
    elements.xrPlayPause.addEventListener('click', () => {
      const playing = VideoPlayer.togglePlayPause();
      elements.xrPlayPause.textContent = playing ? 'Pause' : 'Play';
      elements.playPauseBtn.textContent = playing ? 'Pause' : 'Play';
    });

    elements.xrColorToggle.addEventListener('click', () => {
      const colors = ['green', 'blue', 'black'];
      const idx = (colors.indexOf(currentColor) + 1) % colors.length;
      setActiveColor(colors[idx]);
      elements.xrColorToggle.textContent = colors[idx].charAt(0).toUpperCase() + colors[idx].slice(1);
    });

    elements.xrToleranceSlider.addEventListener('input', (e) => {
      tolerance = parseFloat(e.target.value);
      elements.xrToleranceValue.textContent = tolerance.toFixed(2);
      elements.toleranceSlider.value = tolerance;
      elements.toleranceValue.textContent = tolerance.toFixed(2);
      ChromaKey.setTolerance(tolerance);
    });

    // ---- XR overlay: Quit ----
    elements.xrExitBtn.addEventListener('click', () => {
      if (typeof App !== 'undefined' && App.endXR) App.endXR();
    });
  }

  function updateSizeLabel() {
    if (elements.xrSizeLabel) {
      elements.xrSizeLabel.textContent = screenScale.toFixed(1) + 'x';
    }
    if (elements.scaleSlider) {
      elements.scaleSlider.value = screenScale;
    }
    if (elements.scaleValue) {
      elements.scaleValue.textContent = screenScale.toFixed(1) + 'x';
    }
  }

  /** Check for ?video= URL param and auto-load */
  function checkUrlParam() {
    const params = new URLSearchParams(window.location.search);
    const videoUrl = params.get('video');
    if (videoUrl) {
      elements.videoUrl.value = videoUrl;
      handleLoadVideo();
    }
  }

  /** Handle loading a video from the URL input */
  async function handleLoadVideo() {
    const url = elements.videoUrl.value.trim();
    if (!url) {
      setStatus('Please enter a video URL.', 'error');
      return;
    }

    setStatus('Loading video...', '');
    elements.loadBtn.disabled = true;

    try {
      await VideoPlayer.load(url);
      setStatus('Video loaded!', 'success');
      elements.previewMsg.style.display = 'none';
      elements.videoControls.style.display = 'flex';
      elements.enterMrBtn.disabled = false;
      VideoPlayer.play();
      elements.playPauseBtn.textContent = 'Pause';
    } catch (err) {
      setStatus(err.message, 'error');
      elements.enterMrBtn.disabled = true;
    } finally {
      elements.loadBtn.disabled = false;
    }
  }

  function setActiveColor(color) {
    currentColor = color;
    ChromaKey.setKeyColor(color);
    document.querySelectorAll('.color-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.color === color);
    });
    // Update default tolerance for black
    if (color === 'black' && tolerance > 0.2) {
      tolerance = 0.15;
      elements.toleranceSlider.value = tolerance;
      elements.toleranceValue.textContent = tolerance.toFixed(2);
      elements.xrToleranceSlider.value = tolerance;
      elements.xrToleranceValue.textContent = tolerance.toFixed(2);
      ChromaKey.setTolerance(tolerance);
    }
  }

  function setStatus(msg, type) {
    elements.statusBar.textContent = msg;
    elements.statusBar.className = 'status-bar' + (type ? ' ' + type : '');
  }

  function showXROverlay(visible) {
    elements.xrOverlay.classList.toggle('visible', visible);
    document.getElementById('main-ui').style.display = visible ? 'none' : 'block';
  }

  function getScreenDistance() { return screenDistance; }
  function getScreenScale() { return screenScale; }
  function getScreenOffsetX() { return screenOffsetX; }
  function getScreenOffsetY() { return screenOffsetY; }
  function getCurrentColor() { return currentColor; }

  return {
    init,
    setStatus,
    showXROverlay,
    getScreenDistance,
    getScreenScale,
    getScreenOffsetX,
    getScreenOffsetY,
    getCurrentColor
  };
})();
