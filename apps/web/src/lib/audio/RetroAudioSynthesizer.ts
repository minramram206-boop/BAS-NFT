/**
 * Tiny 8-bit sound synthesizer built on the Web Audio API.
 * No audio files are shipped: every effect is generated on demand.
 */

export type RetroSound = 'click' | 'train' | 'mint' | 'switch';

interface ToneStep {
  /** Oscillator frequency in hertz. */
  frequency: number;
  /** Start offset in seconds, relative to the beginning of the effect. */
  offset?: number;
  /** Tone length in seconds. */
  duration: number;
  /** Peak gain, 0..1. */
  gain: number;
  type?: OscillatorType;
  /** Optional frequency sweep target, applied exponentially over the tone. */
  sweepTo?: number;
}

const SOUND_RECIPES: Record<RetroSound, readonly ToneStep[]> = {
  click: [{ frequency: 640, sweepTo: 220, duration: 0.05, gain: 0.12, type: 'square' }],
  train: [440, 554, 659, 880].map((frequency, index) => ({
    frequency,
    offset: index * 0.05,
    duration: 0.08,
    gain: 0.15,
    type: 'triangle',
  })),
  mint: [523.25, 659.25, 783.99, 1046.5].map((frequency, index) => ({
    frequency,
    offset: index * 0.08,
    duration: 0.22,
    gain: 0.12,
    type: 'square',
  })),
  switch: [{ frequency: 300, sweepTo: 800, duration: 0.1, gain: 0.1, type: 'sine' }],
};

type AudioContextWindow = Window & { webkitAudioContext?: typeof AudioContext };

export class RetroAudioSynthesizer {
  private context: AudioContext | null = null;

  /** Master switch, mirrored by the store so the UI can render the state. */
  public enabled = true;

  /** Create the audio context lazily: browsers require a user gesture first. */
  private ensureContext(): AudioContext | null {
    if (this.context) return this.context;
    if (typeof window === 'undefined') return null;

    const Ctor = window.AudioContext ?? (window as AudioContextWindow).webkitAudioContext;
    if (!Ctor) return null;

    this.context = new Ctor();
    return this.context;
  }

  /** Play one effect. Silently does nothing when disabled or unsupported. */
  play(sound: RetroSound): void {
    if (!this.enabled) return;

    const context = this.ensureContext();
    if (!context) return;
    if (context.state === 'suspended') void context.resume();

    const startedAt = context.currentTime;
    for (const step of SOUND_RECIPES[sound]) {
      this.playStep(context, step, startedAt);
    }
  }

  private playStep(context: AudioContext, step: ToneStep, startedAt: number): void {
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();
    const start = startedAt + (step.offset ?? 0);
    const end = start + step.duration;

    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    oscillator.type = step.type ?? 'square';
    oscillator.frequency.setValueAtTime(step.frequency, start);
    if (step.sweepTo) {
      oscillator.frequency.exponentialRampToValueAtTime(step.sweepTo, end);
    }

    gainNode.gain.setValueAtTime(step.gain, start);
    gainNode.gain.linearRampToValueAtTime(0.01, end);

    oscillator.start(start);
    oscillator.stop(end);
  }
}

/** Process-wide singleton so every component shares one audio context. */
export const retroAudio = new RetroAudioSynthesizer();
