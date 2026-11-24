import { accountChangedEvent, accountChangedKey, accountPhotoChangedEvent, accountPhotoChangedKey } from '@playsport/shared';
export function notifyAccountChange(photoOnly = false) {
  globalThis.dispatchEvent(new globalThis.Event(photoOnly ? accountPhotoChangedEvent : accountChangedEvent));
  globalThis.localStorage.setItem(photoOnly ? accountPhotoChangedKey : accountChangedKey, globalThis.crypto.randomUUID());
}
