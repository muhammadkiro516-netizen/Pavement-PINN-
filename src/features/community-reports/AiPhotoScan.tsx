/**
 * The report photo while the AI works: a scan line sweeps it, then the detector's real boxes
 * are drawn over the damage with their label and confidence (never invented: no analysis,
 * no boxes). The image keeps its own aspect ratio so box percentages land on the pixels.
 */
import React from 'react';
import type { CvAnalysis } from '../../types/cv';

export const AiPhotoScan: React.FC<{ src: string; scanning?: boolean; analysis?: CvAnalysis | null }> = ({ src, scanning = false, analysis = null }) => {
  const w = analysis?.image.width ?? 1;
  const h = analysis?.image.height ?? 1;
  return (
    <div className="relative overflow-hidden rounded-3xl bg-[#0E1B2C]">
      <img src={src} alt="Foto kerusakan jalan" className="block h-auto max-h-[46vh] w-full object-contain" />
      {scanning && (
        <>
          <div className="pp-scanline" />
          <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-[#FFFFFF]/90 px-3 py-1.5 text-xs font-extrabold text-[#0E1B2C]">
            <span className="pp-dot h-2 w-2 rounded-full bg-[#1463FF]" /> AI sedang memeriksa foto
          </div>
        </>
      )}
      {!scanning &&
        analysis?.detections.map((d, i) => (
          <div
            key={i}
            className="pp-box absolute rounded-xl border-[3px] border-[#FF6B2C] bg-[#FF6B2C]/10"
            style={{
              left: `${(d.bbox[0] / w) * 100}%`,
              top: `${(d.bbox[1] / h) * 100}%`,
              width: `${((d.bbox[2] - d.bbox[0]) / w) * 100}%`,
              height: `${((d.bbox[3] - d.bbox[1]) / h) * 100}%`,
              animationDelay: `${i * 150}ms`
            }}
          >
            <span className="pp-pop absolute -top-8 left-0 whitespace-nowrap rounded-full bg-[#FF6B2C] px-2.5 py-1 text-[11px] font-extrabold text-[#FFFFFF]">
              {d.label.replace(/\s*\(.*\)/, '')} · {Math.round(d.confidence * 100)}%
            </span>
          </div>
        ))}
    </div>
  );
};
