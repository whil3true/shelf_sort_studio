import type { AdKind, Platform } from './Platform.ts';

export interface AdResult { shown: boolean; rewarded: boolean }
const none: AdResult = { shown: false, rewarded: false };

export class Ads {
  private readonly platform: Platform;
  private readonly block: (blocked: boolean) => void;
  private readonly timeout: number;
  private running = false;

  constructor(platform: Platform, block: (blocked: boolean) => void, timeout = 90_000) {
    this.platform = platform;
    this.block = block;
    this.timeout = timeout;
  }

  show(kind: AdKind): Promise<AdResult> {
    if (this.running) return Promise.resolve(none);
    this.running = true;
    this.block(true);
    return new Promise(resolve => {
      let settled = false;
      let shown = false;
      let rewarded = false;
      const finish = (allowReward = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.running = false;
        this.block(false);
        resolve({ shown, rewarded: kind === 'rewarded' && allowReward && rewarded });
      };
      const timer = setTimeout(() => finish(), this.timeout);
      try {
        const started = this.platform.show(kind, {
          onOpen: () => { if (!settled) shown = true; },
          onRewarded: () => {
            if (!settled && kind === 'rewarded') { rewarded = true; shown = true; }
          },
          onClose: wasShown => {
            if (settled) return;
            shown ||= wasShown === true;
            finish(true);
          },
          onError: () => finish(),
          onOffline: () => finish(),
        });
        if (!started) finish();
      } catch { finish(); }
    });
  }
}
