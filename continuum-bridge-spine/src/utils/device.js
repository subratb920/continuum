import { isMobileDevice } from "./deviceFolder";

/**
 * A phone or tablet (whatever its browser can do: Chrome on Android can pick
 * folders). There, projects are never made on the device: Continuum creates
 * them on its own server and keeps them in the user's GitHub (or they're
 * imported from GitHub), and they're worked on in a workspace.
 */
export function onPhone() {
  return isMobileDevice();
}
