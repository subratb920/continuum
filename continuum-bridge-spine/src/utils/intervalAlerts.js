/**
 * Interval end alerts: desktop notification + a soft chime.
 *
 * Browsers only allow the notification prompt and audio after a user
 * action, so prepareIntervalAlerts() is called from the Start Interval
 * click. After a page reload the chime may stay muted until the user
 * clicks somewhere; the notification still works if it was allowed.
 */

let audioCtx = null;

function getAudioContext() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  audioCtx = audioCtx || new AudioCtx();
  return audioCtx;
}

export function prepareIntervalAlerts() {
  try {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  } catch {
    // notifications unsupported — ignore
  }

  try {
    getAudioContext()?.resume?.();
  } catch {
    // audio unsupported — ignore
  }
}

export function playIntervalEndSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    ctx.resume?.();

    // Two gentle notes
    [660, 880].forEach((freq, i) => {
      const start = ctx.currentTime + i * 0.35;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.2, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);

      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.32);
    });
  } catch {
    // audio blocked or unsupported — ignore
  }
}

export function showIntervalEndNotification(bridgeName) {
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("Interval ended", {
        body: `${bridgeName}: time's up. Record what happened, save, and take a break.`,
        tag: "continuum-interval-end",
      });
    }
  } catch {
    // notifications unsupported — ignore
  }
}
