/**
 * VideoPlayer — manages HTML5 video loading and playback.
 * Handles CORS automatically:
 *   1. Try direct load with crossOrigin (fastest, works if server sends CORS headers)
 *   2. If blocked, fetch video through a CORS proxy as a blob URL
 */
const VideoPlayer = (() => {

  let video = null;
  let isReady = false;
  let currentBlobUrl = null; // track blob URLs to revoke later

  // CORS proxies to try in order (fallback chain)
  const CORS_PROXIES = [
    'https://corsproxy.io/?url=',
    'https://api.allorigins.win/raw?url='
  ];

  /** Create the hidden <video> element */
  function create() {
    if (video) return video;
    video = document.createElement('video');
    video.playsInline = true;
    video.loop = true;
    video.muted = false;
    video.preload = 'auto';
    video.style.display = 'none';
    document.body.appendChild(video);
    return video;
  }

  /**
   * Load a video from URL.
   * Tries direct CORS first, then falls back to proxy.
   * @param {string} url
   * @param {function} [onStatus] - optional status callback
   * @returns {Promise<HTMLVideoElement>}
   */
  async function load(url, onStatus) {
    if (!video) create();
    cleanup();
    isReady = false;

    // Step 1: Try direct load with crossOrigin
    if (onStatus) onStatus('Loading video...');
    try {
      await loadDirect(url, true);
      return video;
    } catch (e) {
      // Direct CORS failed
    }

    // Step 2: Try direct load WITHOUT crossOrigin — video plays but
    // we can't use it as WebGL texture. Skip this and go to proxy.

    // Step 3: Try CORS proxies
    for (var i = 0; i < CORS_PROXIES.length; i++) {
      var proxy = CORS_PROXIES[i];
      if (onStatus) onStatus('Bypassing CORS (proxy ' + (i + 1) + ')...');
      try {
        var blobUrl = await fetchAsBlob(proxy + encodeURIComponent(url));
        await loadDirect(blobUrl, true);
        return video;
      } catch (e) {
        // This proxy failed, try next
      }
    }

    // Step 4: Last resort — load without crossOrigin so at least it plays.
    // WebGL texture reads will fail (tainted canvas) but user can still see the video.
    if (onStatus) onStatus('Loading without CORS (preview only)...');
    try {
      await loadDirect(url, false);
      return video;
    } catch (e) {
      throw new Error('Could not load video. Check the URL and try a direct .mp4 link.');
    }
  }

  /**
   * Load a URL into the video element directly.
   * @param {string} url
   * @param {boolean} withCors - set crossOrigin='anonymous' or not
   * @returns {Promise}
   */
  function loadDirect(url, withCors) {
    return new Promise(function(resolve, reject) {
      // Set or remove crossOrigin BEFORE setting src
      if (withCors) {
        video.crossOrigin = 'anonymous';
      } else {
        video.removeAttribute('crossOrigin');
      }

      function onCanPlay() {
        cleanup_listeners();
        isReady = true;
        resolve(video);
      }

      function onError() {
        cleanup_listeners();
        isReady = false;
        var err = video.error;
        var msg = 'Failed to load video.';
        if (err) {
          switch (err.code) {
            case MediaError.MEDIA_ERR_ABORTED: msg = 'Video load aborted.'; break;
            case MediaError.MEDIA_ERR_NETWORK: msg = 'Network error.'; break;
            case MediaError.MEDIA_ERR_DECODE: msg = 'Format not supported.'; break;
            case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED: msg = 'URL not supported or CORS blocked.'; break;
          }
        }
        reject(new Error(msg));
      }

      function cleanup_listeners() {
        video.removeEventListener('canplay', onCanPlay);
        video.removeEventListener('error', onError);
      }

      // Timeout — if nothing happens in 10 seconds, fail
      var timer = setTimeout(function() {
        cleanup_listeners();
        reject(new Error('Video load timed out.'));
      }, 10000);

      video.addEventListener('canplay', function() {
        clearTimeout(timer);
        onCanPlay();
      });
      video.addEventListener('error', function() {
        clearTimeout(timer);
        onError();
      });

      video.src = url;
      video.load();
    });
  }

  /**
   * Fetch a URL as a blob and return a blob URL.
   * This bypasses CORS because the fetch goes through a proxy that adds headers.
   * @param {string} url
   * @returns {Promise<string>} blob URL
   */
  function fetchAsBlob(url) {
    return fetch(url)
      .then(function(res) {
        if (!res.ok) throw new Error('Proxy returned ' + res.status);
        return res.blob();
      })
      .then(function(blob) {
        if (blob.size < 1000) throw new Error('Response too small, likely an error page');
        currentBlobUrl = URL.createObjectURL(blob);
        return currentBlobUrl;
      });
  }

  /** Clean up previous blob URLs to free memory */
  function cleanup() {
    if (currentBlobUrl) {
      URL.revokeObjectURL(currentBlobUrl);
      currentBlobUrl = null;
    }
  }

  function play() {
    if (video) return video.play().catch(function() {});
  }

  function pause() {
    if (video) video.pause();
  }

  function togglePlayPause() {
    if (!video) return false;
    if (video.paused) {
      play();
      return true;
    } else {
      pause();
      return false;
    }
  }

  function restart() {
    if (video) {
      video.currentTime = 0;
      play();
    }
  }

  function isPlaying() {
    return video && !video.paused;
  }

  function getVideo() {
    return video;
  }

  function getReady() {
    return isReady;
  }

  return {
    create,
    load,
    play,
    pause,
    togglePlayPause,
    restart,
    isPlaying,
    getVideo,
    getReady
  };
})();
