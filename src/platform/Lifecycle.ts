import { Ads } from './Ads.ts';
import type { Platform } from './Platform.ts';

export const INTERSTITIAL_COOLDOWN = 90_000;
type Pause = 'sdk' | 'ad' | 'hidden' | 'unfocused' | 'page';

export class Lifecycle {
  private readonly platform: Platform;
  private readonly onBlocked: (blocked: boolean) => void;
  private readonly now: () => number;
  private readonly reasons = new Set<Pause>();
  private readonly ads: Ads;
  private lastInterstitial = Infinity;
  private readySent = false;
  private wantsPlay = false;
  private gameplayActive = false;

  constructor(platform: Platform, onBlocked: (blocked: boolean) => void, now = () => performance.now()) {
    this.platform = platform;
    this.onBlocked = onBlocked;
    this.now = now;
    this.ads = new Ads(platform, active => this.pauseFor('ad', active));
    platform.onPauseChange(paused => this.pauseFor('sdk', paused));
    this.pauseFor('sdk', platform.paused);
  }

  get rewardedAvailable() { return this.platform.rewardedAvailable; }
  get blocked() { return this.reasons.size > 0; }

  ready(): void {
    if (this.readySent) return;
    this.readySent = true;
    this.lastInterstitial = this.now();
    try { this.platform.ready(); } catch { /* Platform failures must not disable gameplay. */ }
    this.syncGameplay();
  }

  playing(active: boolean) {
    this.wantsPlay = active;
    this.syncGameplay();
  }

  pauseFor(reason: Pause, paused: boolean) {
    const previous = this.blocked;
    if (paused) this.reasons.add(reason);
    else this.reasons.delete(reason);
    if (previous !== this.blocked) {
      this.syncGameplay();
      this.onBlocked(this.blocked);
    }
  }

  async interstitial(): Promise<void> {
    if (!this.readySent || this.blocked || this.now() - this.lastInterstitial < INTERSTITIAL_COOLDOWN) return;
    const result = await this.ads.show('interstitial');
    if (result.shown) this.lastInterstitial = this.now();
  }

  async reward(): Promise<boolean> {
    if (!this.readySent || this.blocked || !this.rewardedAvailable) return false;
    return (await this.ads.show('rewarded')).rewarded;
  }

  private syncGameplay() {
    const active = this.readySent && this.wantsPlay && !this.blocked;
    if (active === this.gameplayActive) return;
    this.gameplayActive = active;
    try { this.platform.gameplay(active); } catch { /* The local session remains available. */ }
  }
}

export function attachBrowserLifecycle(lifecycle: Lifecycle, unlockAudio: () => void) {
  let pageGone = false;
  const focus = () => lifecycle.pauseFor('unfocused', false);
  const visibility = () => {
    // Android can report the page visible again without a matching focus event.
    if (!document.hidden) focus();
    lifecycle.pauseFor('hidden', document.hidden);
  };
  const hide = () => { pageGone = true; lifecycle.pauseFor('page', true); };
  const show = () => { pageGone = false; visibility(); lifecycle.pauseFor('page', false); };
  const blur = () => lifecycle.pauseFor('unfocused', true);
  const gesture = (event: Event) => {
    if (!event.isTrusted || pageGone || document.hidden || (event instanceof MouseEvent && event.button !== 0)) return;
    focus();
    unlockAudio();
  };
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', hide);
  window.addEventListener('pageshow', show);
  window.addEventListener('blur', blur);
  window.addEventListener('focus', focus);
  // Capture before Phaser handles input. A touch release can supply activation.
  for (const event of ['pointerdown', 'pointerup', 'touchend', 'keydown']) {
    window.addEventListener(event, gesture, { capture: true, passive: true });
  }
  visibility();
}
