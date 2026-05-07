/**
 * voice — Web Speech API wrapper. Continuously listens, fires callbacks
 * when a recognized spell phrase is heard.
 *
 * onCast: triggered on "Incendia" (and reasonable mishearings like "in send").
 * onDismiss: triggered on "Finite" / "Extinguish" / "Stop fire" / Latin "Extinguo".
 *
 * Voice unavailability (non-Chromium browsers) reports back through onStatus
 * so the HUD can surface an error.
 */

const CAST_RE    = /(incendia|in[\s-]?send|in[\s-]?sen[\s-]?dia)/;
const DISMISS_RE = /(finite|extinguo|stop fire|extinguish)/;

export function setupVoice({ onCast, onDismiss, onStatus }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    onStatus({ kind: 'error', message: 'Voice unavailable — use Chrome' });
    return;
  }

  const rec = new SR();
  rec.continuous     = true;
  rec.interimResults = true;
  rec.lang           = 'en-US';

  let lastFire = 0, lastFin = 0;

  rec.onstart = () => onStatus({ kind: 'listening', message: '◉ Listening' });

  rec.onerror = e => {
    onStatus({ kind: 'error', message: `◎ Mic: ${e.error}` });
    if (e.error !== 'aborted') {
      setTimeout(() => { try { rec.start(); } catch (_) {} }, 1500);
    }
  };

  rec.onend = () => {
    setTimeout(() => { try { rec.start(); } catch (_) {} }, 300);
  };

  rec.onresult = event => {
    const now = Date.now();
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const t = event.results[i][0].transcript.toLowerCase();

      if (now - lastFire > 700 && CAST_RE.test(t)) {
        lastFire = now;
        onCast();
        break;
      }
      if (now - lastFin > 700 && DISMISS_RE.test(t)) {
        lastFin = now;
        onDismiss();
        break;
      }
    }
  };

  try { rec.start(); } catch (_) {}
}
