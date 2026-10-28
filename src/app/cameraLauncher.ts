import { createContext, useContext } from 'react';

/** Opens the photo report (the shell's camera button); pages use it for "Lapor sekarang". */
export const CameraLauncherContext = createContext<() => void>(() => undefined);

export function useCameraLauncher(): () => void {
  return useContext(CameraLauncherContext);
}
