/**
 * VideoPlayer — manages HTML5 video loading and playback.
 */
const VideoPlayer = (() => {

  let video = null;
  let isReady = false;
  let onReady = null;
  let onError = null;

  /** Create the hidden <video> element */
  function create() {
    video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.playsInline = true;
    video.loop = true;
    video.muted = false;
    video.preload = 'auto';
    video.style.display = 'none';
    document.body.appendChild(video);

    video.addEventListener('canplay', () => {
      isReady = true;
      if (onReady) onReady();
    });

    video.addEventListener('error', () => {
      isReady = false;
      const err = video.error;
      let msg = 'Failed to load video.';
      if (err) {
        switch (err.code) {
          case MediaError.MEDIA_ERR_ABORTED: msg = 'Video load was aborted.'; break;
          case MediaError.MEDIA_ERR_NETWORK: msg = 'Network error loading video.'; break;
          case MediaError.MEDIA_ERR_DECODE: msg = 'Video format not supported.'; break;
          case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED: msg = 'Video URL not supported or blocked by CORS.'; break;
        }
      }
      if (onError) onError(msg);
    });

    return video;
  }

  /**
   * Load a video from URL.
   * @param {string} url
   * @returns {Promise<HTMLVideoElement>}
   */
  function load(url) {
    return new Promise((resolve, reject) => {
      if (!video) create();
      isReady = false;

      onReady = () => resolve(video);
      onError = (msg) => reject(new Error(msg));

      video.src = url;
      video.load();
    });
  }

  function play() {
    if (video) return video.play().catch(() => {});
  }

  function pause() {
    if (video) video.pause();
  }

  function togglePlayPause() {
    if (!video) return false;
    if (video.paused) {
      play();
      return true; // now playing
    } else {
      pause();
      return false; // now paused
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
