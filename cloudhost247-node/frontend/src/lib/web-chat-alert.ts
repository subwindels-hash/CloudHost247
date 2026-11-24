/**
 * Staff-side alert for the built-in live chat: a two-tone "ding-dong" chime (repeated) via the
 * Web Audio API plus a screen-reader-visible toast handled by the caller.
 *
 * No audio asset is loaded; the chime is synthesized, so it works offline and cannot be blocked
 * by a missing file. Browsers that require a prior user gesture decode the AudioContext lazily —
 * the first click anywhere on the page satisfies that; if it still cannot start, the toast and
 * the unread badges carry the signal instead.
 */

const SOUND_KEY = 'ch247_live_chat_sound_v1';

let audioContext: AudioContext | null = null;

export function liveChatSoundEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setLiveChatSoundEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.removeItem(SOUND_KEY);
    else localStorage.setItem(SOUND_KEY, '0');
  } catch {
    /* storage unavailable — the choice just will not persist */
  }
}

function tone(ctx: AudioContext, frequency: number, start: number, duration: number, peak = 0.22) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, start);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(peak, start + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.05);
}

/** Three repeats of a two-tone chime — audible across a room without screeching. */
export function playEscalationRing(): boolean {
  try {
    type AudioCtor = typeof AudioContext;
    const Ctor: AudioCtor | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
    if (!Ctor) return false;
    audioContext ??= new Ctor();
    if (audioContext.state === 'suspended') {
      void audioContext.resume();
    }
    const now = audioContext.currentTime + 0.02;
    for (let i = 0; i < 3; i++) {
      tone(audioContext, 880, now + i * 0.85, 0.3);
      tone(audioContext, 659.25, now + i * 0.85 + 0.32, 0.4);
    }
    return true;
  } catch {
    return false;
  }
}

/* --- Desktop (browser) notifications ------------------------------------------------------
   Opt-in on top of the chime. This app is the operator's own console, so a desktop banner is the
   same escalation signal in a bigger surface: useful when the console tab is not visible.
   Disabled by default — enabling requires the browser's permission prompt, so the toggle asks
   first and sends a test notification on success. Fires only while the console tab is hidden;
   while the operator is looking at the console, the ring and the in-page toast carry the signal. */

const DESKTOP_KEY = 'ch247_live_chat_desktop_v1';

export type DesktopAlertState = 'unsupported' | 'enabled' | 'denied';

export function desktopAlertsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function desktopAlertsEnabled(): boolean {
  try {
    return localStorage.getItem(DESKTOP_KEY) === '1';
  } catch {
    return false;
  }
}

export async function enableDesktopAlerts(): Promise<DesktopAlertState> {
  if (!desktopAlertsSupported()) return 'unsupported';
  let permission = Notification.permission;
  if (permission === 'default') {
    try {
      permission = await Notification.requestPermission();
    } catch {
      permission = Notification.permission;
    }
  }
  try {
    if (permission === 'granted') {
      localStorage.setItem(DESKTOP_KEY, '1');
      return 'enabled';
    }
    localStorage.removeItem(DESKTOP_KEY);
  } catch {
    /* storage unavailable — enabling still works for this tab */
  }
  return 'denied'; // prompt dismissed or blocked — the UI shows how to allow notifications
}

export function disableDesktopAlerts(): void {
  try {
    localStorage.removeItem(DESKTOP_KEY);
  } catch {
    /* nothing to persist */
  }
}

/** Show a desktop notification for a fresh escalation. No-op unless enabled, permitted and supported. */
export function notifyEscalation(title: string, body: string, tag: string): boolean {
  if (!desktopAlertsSupported() || !desktopAlertsEnabled()) return false;
  if (Notification.permission !== 'granted') return false;
  try {
    const notification = new Notification(title, {
      body,
      tag,
      icon: '/media/cloudhost247/brand/icon-mark.svg',
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
    return true;
  } catch {
    return false;
  }
}
