/**
 * The sound an agent makes when it wants you back.
 *
 * Synthesised rather than shipped as audio files: three short two-note figures
 * weigh nothing, need no decode, and can be tuned by editing numbers. The
 * shapes are deliberately plain — a struck-bell decay on a sine, an octave
 * below a phone alert — because this fires while the user is doing something
 * else and a melody would be worse than a tone.
 *
 * Tone selection is pure and lives apart from the WebAudio call, so the rules
 * (which event wins a batch, what it sounds like) are testable without an
 * AudioContext.
 *
 * @module attentionChime
 */
import type { AgentAttentionEvent } from "./agentAttentionNotifications";

export interface ChimeNote {
  /** Hz. */
  readonly frequency: number;
  /** Seconds from the start of the figure. */
  readonly startOffset: number;
  readonly duration: number;
}

export interface Chime {
  readonly kind: AgentAttentionEvent["kind"];
  readonly notes: readonly ChimeNote[];
}

/** Peak gain of a single note. Low: this plays unbidden, over whatever the
    user is actually listening to. */
const NOTE_GAIN = 0.06;
const NOTE_DURATION = 0.18;

/**
 * A rising fifth for work that landed, a flat repeated knock for work that
 * wants a decision, and a falling minor third for work that broke. Rising and
 * falling carry the news on their own; nobody has to learn the mapping.
 */
const CHIMES: Readonly<Record<AgentAttentionEvent["kind"], Chime>> = {
  "turn-completed": {
    kind: "turn-completed",
    notes: [
      { frequency: 659.25, startOffset: 0, duration: NOTE_DURATION },
      { frequency: 987.77, startOffset: 0.1, duration: NOTE_DURATION },
    ],
  },
  "needs-approval": {
    kind: "needs-approval",
    notes: [
      { frequency: 523.25, startOffset: 0, duration: NOTE_DURATION },
      { frequency: 523.25, startOffset: 0.16, duration: NOTE_DURATION },
    ],
  },
  "turn-failed": {
    kind: "turn-failed",
    notes: [
      { frequency: 440, startOffset: 0, duration: NOTE_DURATION },
      { frequency: 349.23, startOffset: 0.11, duration: NOTE_DURATION * 1.4 },
    ],
  },
};

/** What the settings switch plays when it is turned on: the one a user hears
    most, so the preview is representative rather than alarming. */
export const AGENT_SOUND_PREVIEW_CHIME: Chime = CHIMES["turn-completed"];

/**
 * Which event in a batch gets to make a noise. Approval outranks failure
 * outranks completion, matching the notification copy's own priority — and a
 * batch plays once however large it is, because a fan-out settling should not
 * sound like a slot machine.
 */
export function selectChime(events: readonly AgentAttentionEvent[]): Chime | null {
  if (events.length === 0) return null;
  if (events.some((event) => event.kind === "needs-approval")) return CHIMES["needs-approval"];
  if (events.some((event) => event.kind === "turn-failed")) return CHIMES["turn-failed"];
  if (events.some((event) => event.kind === "turn-completed")) return CHIMES["turn-completed"];
  return null;
}

interface WindowWithLegacyAudioContext extends Window {
  webkitAudioContext?: typeof AudioContext;
}

let context: AudioContext | null = null;

function resolveContext(): AudioContext | null {
  if (context !== null) return context;
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ?? (window as WindowWithLegacyAudioContext).webkitAudioContext ?? null;
  if (Ctor === null) return null;
  try {
    context = new Ctor();
    return context;
  } catch {
    return null;
  }
}

/**
 * Plays a figure, or does nothing at all.
 *
 * Every failure here is silent by design: no audio device, a context the
 * browser refuses to start without a user gesture, an autoplay policy. None of
 * those are worth an error in a path whose entire job is a courtesy sound.
 */
export function playChime(chime: Chime): void {
  const audio = resolveContext();
  if (audio === null) return;

  // Suspended is the normal state for a context created before the user has
  // interacted; resuming is a promise that may reject, and that is fine.
  if (audio.state === "suspended") {
    void audio.resume().catch(() => {});
  }

  try {
    const startedAt = audio.currentTime;
    for (const note of chime.notes) {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const noteStart = startedAt + note.startOffset;
      const noteEnd = noteStart + note.duration;

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(note.frequency, noteStart);
      // Struck, not switched on: an instant attack and an exponential decay to
      // near-silence. Ramping to exactly 0 is undefined for exponential ramps.
      gain.gain.setValueAtTime(0, noteStart);
      gain.gain.linearRampToValueAtTime(NOTE_GAIN, noteStart + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);

      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start(noteStart);
      oscillator.stop(noteEnd);
    }
  } catch {
    // See above: a courtesy sound never breaks the notifier.
  }
}

/** Plays whatever a batch of attention events has earned, if anything. */
export function playAttentionChime(events: readonly AgentAttentionEvent[]): void {
  const chime = selectChime(events);
  if (chime !== null) playChime(chime);
}
