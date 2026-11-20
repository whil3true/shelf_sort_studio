export interface AdCallbacks {
  onOpen(): void;
  onClose(shown?: boolean): void;
  onRewarded(): void;
  onError(error?: unknown): void;
  onOffline(): void;
}
export type AdKind = 'interstitial' | 'rewarded';
export interface Platform {
  readonly locale?: string;
  readonly rewardedAvailable: boolean;
  readonly paused: boolean;
  ready(): void;
  gameplay(active: boolean): void;
  onPauseChange(listener: (paused: boolean) => void): () => void;
  show(kind: AdKind, callbacks: AdCallbacks): boolean;
}

export interface YandexSdk {
  environment?: { i18n?: { lang?: string } };
  features?: { LoadingAPI?: { ready(): void }; GameplayAPI?: { start(): void; stop(): void } };
  adv?: {
    showFullscreenAdv?(options: { callbacks: AdCallbacks }): void;
    showRewardedVideo?(options: { callbacks: AdCallbacks }): void;
  };
  on?(event: 'game_api_pause' | 'game_api_resume', handler: () => void): void;
  off?(event: 'game_api_pause' | 'game_api_resume', handler: () => void): void;
}

type YandexWindow = Window & { YaGames?: { init(): Promise<YandexSdk> } };

export class WebPlatform implements Platform {
  readonly rewardedAvailable = false;
  readonly paused = false;
  ready() {}
  gameplay() {}
  onPauseChange() { return () => {}; }
  show() { return false; }
}

export class YandexPlatform implements Platform {
  private readonly sdk: YandexSdk;
  private readonly listeners = new Set<(paused: boolean) => void>();
  private sdkPaused = false;

  constructor(sdk: YandexSdk) {
    this.sdk = sdk;
    sdk.on?.('game_api_pause', this.pause);
    sdk.on?.('game_api_resume', this.resume);
  }

  get paused() { return this.sdkPaused; }
  get locale() { return this.sdk.environment?.i18n?.lang; }
  get rewardedAvailable() { return typeof this.sdk.adv?.showRewardedVideo === 'function'; }

  ready() { this.sdk.features?.LoadingAPI?.ready(); }
  gameplay(active: boolean) {
    const api = this.sdk.features?.GameplayAPI;
    if (active) api?.start();
    else api?.stop();
  }

  onPauseChange(listener: (paused: boolean) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  show(kind: AdKind, callbacks: AdCallbacks): boolean {
    const method = kind === 'rewarded' ? this.sdk.adv?.showRewardedVideo : this.sdk.adv?.showFullscreenAdv;
    if (!method) return false;
    method.call(this.sdk.adv, { callbacks });
    return true;
  }

  private pause = () => this.setPaused(true);
  private resume = () => this.setPaused(false);

  private setPaused(paused: boolean) {
    if (paused === this.sdkPaused) return;
    this.sdkPaused = paused;
    for (const listener of this.listeners) listener(paused);
  }
}

export function standaloneHost(hostname: string): boolean {
  return !hostname || hostname === 'localhost' || hostname === '0.0.0.0'
    || hostname === '[::1]' || /^127\./.test(hostname) || hostname.endsWith('.github.io');
}

function loadSdk(win: YandexWindow): Promise<boolean> {
  return new Promise(resolve => {
    const script = win.document.createElement('script');
    const finish = (loaded: boolean) => {
      win.clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
      if (!loaded) script.remove();
      resolve(loaded);
    };
    const timer = win.setTimeout(() => finish(false), 4000);
    script.src = '/sdk.js';
    script.async = true;
    script.onload = () => finish(!!win.YaGames);
    script.onerror = () => finish(false);
    win.document.head.append(script);
  });
}

export async function createPlatform(win: YandexWindow = window): Promise<Platform> {
  try {
    if (!win.YaGames && (standaloneHost(win.location.hostname) || !await loadSdk(win))) return new WebPlatform();
    if (!win.YaGames) return new WebPlatform();
    let timer: number | undefined;
    try {
      const fallback = new Promise<null>(resolve => { timer = win.setTimeout(() => resolve(null), 4500); });
      const sdk = await Promise.race([win.YaGames.init(), fallback]);
      return sdk ? new YandexPlatform(sdk) : new WebPlatform();
    } finally { win.clearTimeout(timer); }
  } catch {
    return new WebPlatform();
  }
}
