import { AudioRuntime, attachAudioGestures, BrowserAudioOutput } from './audio/AudioRuntime.ts';
import { openStorage, selectLocale } from './platform/Storage.ts';
import { attachBrowserLifecycle, Lifecycle } from './platform/Lifecycle.ts';
import { createPlatform } from './platform/Platform.ts';
import { StudioScene } from './ui/StudioScene';
import { mountGame } from './ui/viewport';
import './style.css';

async function start() {
  const storage = openStorage();
  const platform = await createPlatform();
  const locale = selectLocale(storage.locale, platform.locale, navigator.language);
  const audio = new AudioRuntime(new BrowserAudioOutput(), storage.volumes);
  let scene: StudioScene | undefined;
  const lifecycle = new Lifecycle(platform, blocked => {
    audio.pauseFor('platform', blocked);
    scene?.setBlocked(blocked);
  });
  attachAudioGestures(audio);
  attachBrowserLifecycle(lifecycle);

  scene = new StudioScene(storage, locale, {
    ready: () => lifecycle.ready(),
    playing: active => lifecycle.playing(active),
    audio: event => audio.play(event),
    volumesChanged: () => audio.setVolumes(storage.volumes),
    rewardedAvailable: lifecycle.rewardedAvailable,
    interstitial: () => lifecycle.interstitial(),
    reward: () => lifecycle.reward(),
  });
  scene.setBlocked(lifecycle.blocked);
  mountGame(scene);
}

void start();
