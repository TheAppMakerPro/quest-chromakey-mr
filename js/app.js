/**
 * App — main entry point. Handles initialization, 2D preview loop, and WebXR session.
 */
const App = (() => {

  let xrSession = null;
  let xrRefSpace = null;
  let xrGLLayer = null;
  let previewAnimId = null;
  let isXR = false;

  // ---- Matrix helpers (minimal, no library) ----

  function mat4Perspective(fovy, aspect, near, far) {
    const f = 1.0 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0
    ]);
  }

  function mat4Translate(x, y, z) {
    return new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      x, y, z, 1
    ]);
  }

  function mat4Scale(sx, sy, sz) {
    return new Float32Array([
      sx, 0,  0,  0,
      0,  sy, 0,  0,
      0,  0,  sz, 0,
      0,  0,  0,  1
    ]);
  }

  function mat4Multiply(a, b) {
    const out = new Float32Array(16);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        out[j * 4 + i] =
          a[i] * b[j * 4] +
          a[4 + i] * b[j * 4 + 1] +
          a[8 + i] * b[j * 4 + 2] +
          a[12 + i] * b[j * 4 + 3];
      }
    }
    return out;
  }

  // ---- Initialization ----

  function init() {
    UIController.init();

    // Init chroma key on preview canvas
    const previewCanvas = document.getElementById('preview-canvas');
    ChromaKey.init(previewCanvas);

    // Start 2D preview loop
    startPreviewLoop();

    // Check WebXR support
    if (navigator.xr) {
      navigator.xr.isSessionSupported('immersive-ar').then((supported) => {
        if (!supported) {
          document.getElementById('enter-mr-btn').title = 'WebXR AR not supported on this device';
        }
      });
    } else {
      document.getElementById('enter-mr-btn').title = 'WebXR not available — use Meta Quest Browser';
    }

    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  // ---- 2D Preview Loop ----

  function startPreviewLoop() {
    function loop() {
      if (isXR) return; // stop 2D loop during XR
      const video = VideoPlayer.getVideo();
      if (video && VideoPlayer.getReady() && !video.paused) {
        ChromaKey.renderPreview(video);
      }
      previewAnimId = requestAnimationFrame(loop);
    }
    loop();
  }

  // ---- WebXR ----

  async function startXR() {
    if (!navigator.xr) {
      UIController.setStatus('WebXR not available. Use Meta Quest Browser.', 'error');
      return;
    }

    try {
      const supported = await navigator.xr.isSessionSupported('immersive-ar');
      if (!supported) {
        UIController.setStatus('Immersive AR not supported on this device.', 'error');
        return;
      }

      const overlayRoot = document.getElementById('xr-overlay');

      xrSession = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['local'],
        optionalFeatures: ['dom-overlay'],
        domOverlay: { root: overlayRoot }
      });

      isXR = true;
      if (previewAnimId) cancelAnimationFrame(previewAnimId);

      // Setup XR GL context
      const xrCanvas = document.getElementById('xr-canvas');
      const gl = ChromaKey.init(xrCanvas, { xrCompatible: true });

      xrGLLayer = new XRWebGLLayer(xrSession, gl);
      xrSession.updateRenderState({ baseLayer: xrGLLayer });

      xrRefSpace = await xrSession.requestReferenceSpace('local');

      // Show overlay, hide main UI
      UIController.showXROverlay(true);

      // Start XR render loop
      xrSession.requestAnimationFrame(xrRenderLoop);

      // Handle session end
      xrSession.addEventListener('end', onXREnd);

      // Make sure video is playing
      VideoPlayer.play();

    } catch (err) {
      UIController.setStatus('Failed to start XR: ' + err.message, 'error');
      isXR = false;
    }
  }

  function xrRenderLoop(time, frame) {
    if (!xrSession || !frame) return;
    xrSession.requestAnimationFrame(xrRenderLoop);

    const gl = ChromaKey.getGL();
    const pose = frame.getViewerPose(xrRefSpace);
    if (!pose) return;

    gl.bindFramebuffer(gl.FRAMEBUFFER, xrGLLayer.framebuffer);
    gl.clearColor(0, 0, 0, 0); // transparent = passthrough
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Update video texture
    const video = VideoPlayer.getVideo();
    if (video && !video.paused) {
      ChromaKey.updateTexture(video);
    }

    // Render for each XR view (typically 2 for stereo)
    for (const view of pose.views) {
      const vp = xrGLLayer.getViewport(view);
      gl.viewport(vp.x, vp.y, vp.width, vp.height);

      const projectionMatrix = view.projectionMatrix;
      const viewMatrix = view.transform.inverse.matrix;

      // Build model matrix: position the quad in space
      const dist = UIController.getScreenDistance();
      const scale = UIController.getScreenScale();
      const offX = UIController.getScreenOffsetX();
      const offY = UIController.getScreenOffsetY();

      // Video aspect ratio
      let aspect = 16 / 9;
      if (video && video.videoWidth && video.videoHeight) {
        aspect = video.videoWidth / video.videoHeight;
      }

      const halfWidth = scale * aspect * 0.5;
      const halfHeight = scale * 0.5;

      const translateMat = mat4Translate(offX, offY, -dist);
      const scaleMat = mat4Scale(halfWidth, halfHeight, 1);
      const modelMatrix = mat4Multiply(translateMat, scaleMat);

      ChromaKey.render(projectionMatrix, viewMatrix, modelMatrix, xrGLLayer.framebuffer, vp);
    }
  }

  function onXREnd() {
    isXR = false;
    xrSession = null;
    UIController.showXROverlay(false);

    // Re-init preview on 2D canvas
    const previewCanvas = document.getElementById('preview-canvas');
    ChromaKey.init(previewCanvas);
    startPreviewLoop();

    UIController.setStatus('Exited MR mode.', '');
  }

  async function endXR() {
    if (xrSession) {
      await xrSession.end();
    }
  }

  // ---- Start ----
  document.addEventListener('DOMContentLoaded', init);

  return {
    startXR,
    endXR
  };
})();
