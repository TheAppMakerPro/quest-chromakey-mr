/**
 * ChromaKey — WebGL chroma key renderer.
 * Renders a video texture onto a quad, discarding pixels near the key color.
 */
const ChromaKey = (() => {

  // ---- Shader sources (inlined to avoid fetch) ----

  const VERT_SRC = `
    attribute vec4 aPosition;
    attribute vec2 aTexCoord;
    varying vec2 vTexCoord;
    uniform mat4 uProjection;
    uniform mat4 uView;
    uniform mat4 uModel;
    void main() {
      vTexCoord = aTexCoord;
      gl_Position = uProjection * uView * uModel * aPosition;
    }
  `;

  const FRAG_SRC = `
    precision mediump float;
    uniform sampler2D uVideoTexture;
    uniform vec3 uKeyColor;
    uniform float uTolerance;
    uniform float uSmoothing;
    varying vec2 vTexCoord;
    void main() {
      vec4 texColor = texture2D(uVideoTexture, vTexCoord);
      float diff = distance(texColor.rgb, uKeyColor);
      float alpha = smoothstep(uTolerance, uTolerance + uSmoothing, diff);
      if (alpha < 0.01) discard;
      gl_FragColor = vec4(texColor.rgb, alpha);
    }
  `;

  // ---- Key color presets ----
  const KEY_COLORS = {
    green: [0.0, 1.0, 0.0],
    blue:  [0.0, 0.0, 1.0],
    black: [0.0, 0.0, 0.0]
  };

  // ---- State ----
  let gl = null;
  let program = null;
  let videoTexture = null;
  let quadVAO = null;

  // Uniform locations
  let uProjection, uView, uModel, uVideoTexture, uKeyColor, uTolerance, uSmoothing;

  // Current settings
  let currentKeyColor = KEY_COLORS.green;
  let currentTolerance = 0.35;
  let currentSmoothing = 0.10;

  /**
   * Initialize WebGL on the given canvas.
   * @param {HTMLCanvasElement} canvas
   * @param {object} [ctxAttrs] Extra context attributes (e.g. xrCompatible)
   * @returns {WebGL2RenderingContext}
   */
  function init(canvas, ctxAttrs) {
    const attrs = Object.assign({
      alpha: true,
      premultipliedAlpha: false,
      antialias: true
    }, ctxAttrs || {});

    gl = canvas.getContext('webgl2', attrs) || canvas.getContext('webgl', attrs);
    if (!gl) throw new Error('WebGL not supported');

    program = createProgram(VERT_SRC, FRAG_SRC);
    gl.useProgram(program);

    // Get uniform locations
    uProjection   = gl.getUniformLocation(program, 'uProjection');
    uView         = gl.getUniformLocation(program, 'uView');
    uModel        = gl.getUniformLocation(program, 'uModel');
    uVideoTexture = gl.getUniformLocation(program, 'uVideoTexture');
    uKeyColor     = gl.getUniformLocation(program, 'uKeyColor');
    uTolerance    = gl.getUniformLocation(program, 'uTolerance');
    uSmoothing    = gl.getUniformLocation(program, 'uSmoothing');

    // Create quad geometry
    quadVAO = createQuad();

    // Create video texture
    videoTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, videoTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // Enable alpha blending
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    return gl;
  }

  /** Compile a shader */
  function compileShader(type, src) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const err = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error('Shader compile error: ' + err);
    }
    return shader;
  }

  /** Create and link a shader program */
  function createProgram(vertSrc, fragSrc) {
    const vs = compileShader(gl.VERTEX_SHADER, vertSrc);
    const fs = compileShader(gl.FRAGMENT_SHADER, fragSrc);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, 'aPosition');
    gl.bindAttribLocation(prog, 1, 'aTexCoord');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('Program link error: ' + gl.getProgramInfoLog(prog));
    }
    return prog;
  }

  /** Create a unit quad [-1,1] with texture coords */
  function createQuad() {
    // Position (x,y,z) + TexCoord (u,v)
    const verts = new Float32Array([
      -1, -1, 0,   0, 1,
       1, -1, 0,   1, 1,
       1,  1, 0,   1, 0,
      -1, -1, 0,   0, 1,
       1,  1, 0,   1, 0,
      -1,  1, 0,   0, 0
    ]);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

    // aPosition
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    // aTexCoord
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);

    return buf;
  }

  /**
   * Upload a video frame to the texture.
   * @param {HTMLVideoElement} video
   */
  function updateTexture(video) {
    if (!gl || !videoTexture) return;
    gl.bindTexture(gl.TEXTURE_2D, videoTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
  }

  /**
   * Render the chroma-keyed quad.
   * For 2D preview: pass identity matrices.
   * For XR: pass real projection/view/model matrices.
   *
   * @param {Float32Array} projectionMatrix  4x4
   * @param {Float32Array} viewMatrix        4x4
   * @param {Float32Array} modelMatrix       4x4
   * @param {WebGLFramebuffer|null} [framebuffer]
   * @param {object} [viewport] {x, y, width, height}
   */
  function render(projectionMatrix, viewMatrix, modelMatrix, framebuffer, viewport) {
    if (!gl || !program) return;

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer || null);

    if (viewport) {
      gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
    }

    gl.useProgram(program);

    // Set matrices
    gl.uniformMatrix4fv(uProjection, false, projectionMatrix);
    gl.uniformMatrix4fv(uView, false, viewMatrix);
    gl.uniformMatrix4fv(uModel, false, modelMatrix);

    // Set chroma key params
    gl.uniform3fv(uKeyColor, currentKeyColor);
    gl.uniform1f(uTolerance, currentTolerance);
    gl.uniform1f(uSmoothing, currentSmoothing);

    // Bind video texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, videoTexture);
    gl.uniform1i(uVideoTexture, 0);

    // Bind quad and draw
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVAO);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /**
   * Convenience: render for 2D preview (identity matrices, clear canvas).
   * @param {HTMLVideoElement} video
   */
  function renderPreview(video) {
    if (!gl) return;
    const canvas = gl.canvas;
    if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    updateTexture(video);
    render(IDENTITY, IDENTITY, IDENTITY);
  }

  // ---- Setters ----

  function setKeyColor(name) {
    if (KEY_COLORS[name]) currentKeyColor = KEY_COLORS[name];
  }

  function setTolerance(val) {
    currentTolerance = parseFloat(val);
  }

  function setSmoothing(val) {
    currentSmoothing = parseFloat(val);
  }

  function getGL() { return gl; }
  function getProgram() { return program; }

  // ---- Identity matrix ----
  const IDENTITY = new Float32Array([
    1,0,0,0,
    0,1,0,0,
    0,0,1,0,
    0,0,0,1
  ]);

  return {
    init,
    updateTexture,
    render,
    renderPreview,
    setKeyColor,
    setTolerance,
    setSmoothing,
    getGL,
    getProgram,
    KEY_COLORS,
    IDENTITY
  };
})();
