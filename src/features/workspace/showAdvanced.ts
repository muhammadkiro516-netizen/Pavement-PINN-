/**
 * SPEC M9 / §3: 3D damage (SfM) and Validation need a photo-sequence upload that is not built,
 * so they are hidden from the UI (roadmap). VITE_SHOW_3D=1 shows them again for development.
 */
export const SHOW_3D = import.meta.env.VITE_SHOW_3D === '1';
