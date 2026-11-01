import React, { useState, useEffect, useRef } from 'react';
import { useSheetDrag } from '../../components/ui/useSheetDrag';
import {
  X,
  MapPin,
  ThumbsUp,
  Camera,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Navigation,
  Star,
  MoreVertical,
  HelpCircle,
  Send,
  Share2,
  Bookmark,
  ChevronUp,
  ChevronDown,
  HardHat,
  FileText,
  Copy,
  Check,
  RotateCw,
  Layers,
  Clock,
  ArrowUpRight
} from 'lucide-react';
import { DamageReport, ReportReview } from '../../types';
import { CommentThread } from './CommentThread';
import { ILLUSTRATIVE_PHOTO_LABEL } from '../../data/provenance';
import { UserAccount } from '../authentication/demoAccounts';
import { BeforeAfterSlider } from '../../components/ui/BeforeAfterSlider';
import { canEditReport } from '../rbac/accessPolicy';
import { assetUrl, NO_COVERAGE_PATH, reportPhotoCaption } from '../../domain/reports/datasetImages';

export type SheetSnapPoint = 'PEEK' | 'HALF' | 'FULL';

/** Verification and handling status, as stored on the report. */
const STATUS_LABEL: Record<DamageReport['status'], string> = {
  PENDING: 'Menunggu verifikasi',
  VERIFIED_BY_ENGINEER: 'Terverifikasi',
  SCHEDULED_FOR_REPAIR: 'Dijadwalkan diperbaiki',
  REPAIRED: 'Selesai diperbaiki',
  CLOSED: 'Ditutup'
};

interface ReportDetailBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  report: DamageReport | null;
  onUpvoteReport: (reportId: string) => void;
  currentAccount: UserAccount;
  isFieldEngineer: boolean;
  onEditReport?: (updated: DamageReport) => void;
  /** Workflow panel for this report (state, evidence, role actions), rendered by the shell. */
  workflowPanel?: React.ReactNode;
  onOpenSPK?: () => void;
  onOpenEditModal?: (report: DamageReport) => void;
  reviewsMap: Record<string, ReportReview[]>;
  onAddReview: (reportId: string, review: ReportReview) => void;
  onStartNavigation?: (report: DamageReport) => void;
}

export const ReportDetailBottomSheet: React.FC<ReportDetailBottomSheetProps> = ({
  isOpen,
  onClose,
  report,
  onUpvoteReport,
  currentAccount,
  isFieldEngineer,
  onEditReport,
  workflowPanel,
  onOpenSPK,
  onOpenEditModal,
  reviewsMap,
  onAddReview,
  onStartNavigation
}) => {
  // Snap position: 'HALF' (half-expanded ~50% screen) or 'FULL' (fully-expanded 88% screen)
  const [snapPoint, setSnapPoint] = useState<SheetSnapPoint>('HALF');
  const [isSaved, setIsSaved] = useState<boolean>(false);
  const [copiedLocation, setCopiedLocation] = useState<boolean>(false);
  const [isEntering, setIsEntering] = useState<boolean>(true);
  const [isClosing, setIsClosing] = useState<boolean>(false);


  const closeRef = useRef<() => void>(() => undefined);
  // Shared drag: the card follows the finger and settles on PEEK / HALF / FULL (or closes).
  const { sheetRef, sheetProps } = useSheetDrag<SheetSnapPoint>({
    mode: 'height',
    snaps: () => {
      const vh = window.innerHeight;
      return [
        { key: 'PEEK', height: 116 },
        { key: 'HALF', height: Math.min(460, Math.max(360, vh * 0.48)) },
        { key: 'FULL', height: vh * 0.9 }
      ];
    },
    onSnap: (next) => {
      if (next !== 'FULL' && scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
      setSnapPoint(next);
    },
    onClose: () => closeRef.current(),
    maxWidth: 639
  });
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  // Trigger smooth scroll-up animation when sheet is opened or report changes
  useEffect(() => {
    if (isOpen) {
      setIsClosing(false);
      setSnapPoint('HALF');
      
      // Start from bottom translateY(100%), then smoothly scroll up into view
      setIsEntering(true);
      const rafId = requestAnimationFrame(() => {
        const timer = setTimeout(() => {
          setIsEntering(false);
        }, 30);
        return () => clearTimeout(timer);
      });
      return () => cancelAnimationFrame(rafId);
    }
  }, [isOpen, report?.id]);

  if (!isOpen || !report) return null;

  const handleClose = () => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
      setIsEntering(false);
      setSnapPoint('HALF');
    }, 320);
  };
  closeRef.current = handleClose;

  const handleCopyLocation = () => {
    const textToCopy = `${report.segmentName}, ${report.province} (${report.coordinates[0].toFixed(5)}, ${report.coordinates[1].toFixed(5)})`;
    navigator.clipboard.writeText(textToCopy);
    setCopiedLocation(true);
    setTimeout(() => setCopiedLocation(false), 2000);
  };


  const toggleSnapPoint = () => {
    setSnapPoint((prev) => {
      const next = prev === 'HALF' ? 'FULL' : 'HALF';
      if (next === 'HALF' && scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = 0;
      }
      return next;
    });
  };

  // Unified click handler on card surface: expands to 90% height when in HALF state
  const handleCardSurfaceClick = (e: React.MouseEvent) => {
    if (snapPoint === 'FULL') return;
    const target = e.target as HTMLElement;
    // Do not trigger expand if clicking directly on an interactive button or control
    const isInteractive = target.closest('button, a, input, textarea, select, [role="button"], [data-interactive="true"]');
    if (isInteractive) return;
    setSnapPoint(snapPoint === 'PEEK' ? 'HALF' : 'FULL');
  };

  const isRepaired = report.status === 'REPAIRED';

  return (
    <>
      {/* Mobile Backdrop & Background Gesture Capture Layer (No blur under dark background) */}
      <div
        onClick={handleClose}
        className={`fixed inset-0 z-30 transition-all duration-300 sm:hidden cursor-pointer ${
          isClosing
            ? 'opacity-0 pointer-events-none'
            : snapPoint === 'PEEK'
            ? 'opacity-0 pointer-events-none'
            : snapPoint === 'FULL'
            ? 'bg-black/60 opacity-100 pointer-events-auto'
            : 'bg-black/25 opacity-100 pointer-events-auto'
        }`}
        title="Geser atau klik background ke bawah untuk menutup"
      />

      {/* ========================================================================= */}
      {/* DRAGGABLE BOTTOM SHEET CARD CONTAINER (90% Height on Expand, No blur)    */}
      {/* ========================================================================= */}
      <div
        ref={sheetRef as React.RefObject<HTMLDivElement>}
        {...sheetProps}
        onClick={handleCardSurfaceClick}
        style={{
          transform: isClosing || isEntering
            ? 'translateY(100%)'
            : 'translateY(0px)',
          opacity: isClosing ? 0 : 1
        }}
        className={`fixed sm:absolute z-40 sm:z-30 bg-[#0B1220] border-t sm:border border-[#202B3B] rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-100 box-border inset-x-0 bottom-0 select-none will-change-transform ${
          isClosing
            ? 'transition-all duration-320 ease-[cubic-bezier(0.32,0,0.67,0)]'
            : 'transition-all duration-400 ease-[cubic-bezier(0.16,1,0.3,1)]'
        } ${
          /* Responsive sizing: on desktop (>=640px/sm:), panel occupies comfortable right side (460-480px) */
          snapPoint === 'PEEK'
            ? 'h-[116px] left-2! right-2! bottom-[calc(env(safe-area-inset-bottom)+88px)]! rounded-2xl! cursor-pointer sm:h-auto sm:left-auto! sm:top-3 sm:right-3! sm:bottom-auto! sm:w-[460px] lg:w-[480px] sm:rounded-2xl!'
            : snapPoint === 'HALF'
            ? 'h-[52vh] min-h-[380px] max-h-[500px] cursor-pointer sm:cursor-auto sm:h-[calc(100%-1.75rem)] sm:max-h-[calc(100dvh-5.5rem)] sm:top-3 sm:right-3 sm:bottom-4 sm:w-[460px] lg:w-[480px] sm:max-w-[calc(100vw-32px)] sm:inset-x-auto sm:left-auto'
            : 'h-[90vh] max-h-[90dvh] sm:h-[calc(100%-1.75rem)] sm:max-h-[calc(100dvh-5.5rem)] sm:top-3 sm:right-3 sm:bottom-4 sm:w-[460px] lg:w-[480px] sm:max-w-[calc(100vw-32px)] sm:inset-x-auto sm:left-auto'
        }`}
      >
        {/* DRAG HANDLE BAR (TOUCH & POINTER GRAB ZONE) */}
        <div
          data-sheet-grab
          onClick={toggleSnapPoint}
          className="touch-none sm:touch-auto w-full pt-3 pb-1 flex flex-col items-center justify-center cursor-grab active:cursor-grabbing hover:bg-white/5 transition-colors shrink-0"
        >
          {/* Visual Pill Indicator */}
          <div className="w-14 h-2 bg-white/40 hover:bg-amber-400 rounded-full transition-all duration-200" />
          <div className="flex items-center justify-center gap-1 text-xs font-bold text-slate-400 mt-1">
            <span>{snapPoint === 'PEEK' ? 'Ketuk untuk membuka detail' : snapPoint === 'HALF' ? 'Ketuk / Tarik Ke Atas Untuk Detail Penuh (90%)' : 'Tarik Ke Bawah Untuk Perkecil'}</span>
            {snapPoint === 'HALF' ? (
              <ChevronUp className="w-3 h-3 text-amber-400" />
            ) : (
              <ChevronDown className="w-3 h-3 text-amber-400" />
            )}
          </div>
        </div>

        {/* STICKY HEADER ZONE (AVATAR, TITLE, CLOSE BUTTON) */}
        <div
          data-sheet-grab
          className="touch-none sm:touch-auto px-4 pt-1 pb-3 border-b border-white/10 flex items-center justify-between gap-3 shrink-0"
        >
          <div className="flex items-center space-x-3 min-w-0 flex-1">
            {/* Circular Thumbnail Avatar */}
            <div className="relative shrink-0">
              <img
                src={report.photoUrl}
                alt={report.damageTypeLabel}
                className="w-12 h-12 rounded-2xl object-cover border-2 border-amber-400 shadow-md "
                onError={(e) => {
                  // Honest placeholder, never a stock photo standing in for evidence
                  (e.target as HTMLImageElement).src = assetUrl(NO_COVERAGE_PATH, import.meta.env.BASE_URL);
                }}
              />
              <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-slate-900 border border-white/30 flex items-center justify-center text-xs">
                📍
              </div>
            </div>

            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-sm sm:text-base text-white truncate leading-tight">
                {report.damageTypeLabel}
              </h3>
              <p className="text-xs text-slate-300 truncate font-medium mt-1">
                {report.segmentName}
              </p>
              <div className="flex items-center gap-2 text-xs mt-1 text-slate-400 font-medium truncate">
                <span className={`font-bold ${isRepaired ? 'text-emerald-400' : report.status === 'PENDING' ? 'text-rose-400' : 'text-sky-300'}`}>
                  {STATUS_LABEL[report.status]}
                </span>
                <span>&bull;</span>
                <span className="font-mono text-amber-300">{report.severity}</span>
                <span>&bull;</span>
                <span className="truncate font-mono">{report.id}</span>
              </div>
            </div>
          </div>

          {/* Quick Action Controls: Expand Toggle + Circular Close Button */}
          <div className="flex items-center space-x-2 shrink-0">
            <button
              onClick={toggleSnapPoint}
              className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 text-slate-200 flex items-center justify-center transition-all cursor-pointer"
              title={snapPoint === 'HALF' ? 'Expand Sheet' : 'Collapse Sheet'}
            >
              {snapPoint === 'HALF' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            <button
              onClick={handleClose}
              className="w-8 h-8 rounded-full bg-[#272b38] hover:bg-[#343a4c] active:scale-95 text-slate-300 hover:text-white flex items-center justify-center transition-all cursor-pointer"
              title="Tutup Card"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* INNER SCROLLABLE CONTENT (ACTIVE WHEN EXPANDED OR INSIDE CARD)             */}
        {/* ========================================================================= */}
        <div
          ref={scrollContainerRef}
          data-sheet-scroll
          className="flex-1 overflow-y-auto px-4 py-3 space-y-4 custom-scrollbar select-text overscroll-contain"
        >
          {/* 1. FOTO KERUSAKAN & ESTIMASI PELAPOR (HERO) */}
          <div className="space-y-2">
            <BeforeAfterSlider
              before={report.photoUrl}
              after={report.repairDetails?.afterPhotoUrl}
              beforeAlt="Foto sebelum perbaikan (laporan warga)"
              afterAlt="Foto sesudah perbaikan (bukti F.E)"
              afterBadge={
                report.repairDetails?.afterPhotoUrl
                  ? report.repairDetails.verified === true
                    ? '✓ Terverifikasi M.O'
                    : 'Menunggu verifikasi M.O'
                  : null
              }
              emptyAfterText="Belum ada foto sesudah. Foto muncul setelah petugas lapangan mengirim bukti perbaikan dan M.O memverifikasinya."
            />
            <p className="text-xs text-amber-300/90 leading-relaxed">
              {reportPhotoCaption(report, ILLUSTRATIVE_PHOTO_LABEL.id)}
            </p>
            <div className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2 text-xs text-slate-300">
              <span className="text-[#A6A8AE]">Estimasi pelapor:</span>
              <span className="font-mono font-bold text-slate-100">
                {report.estimatedDepthCm} cm · {report.estimatedAreaM2} m²
              </span>
            </div>
          </div>

          {/* 2. QUICK ACTIONS: DUKUNG LAPORAN & RUTE NAVIGASI */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => onUpvoteReport(report.id)}
              className={`py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center space-x-2 transition-all cursor-pointer ${
                report.userUpvoted
                  ? 'bg-[#FFD60A] text-[#0B0D10] border-[#FFD60A] shadow-md font-bold'
                  : 'bg-white/5 hover:bg-white/10 text-white border-white/10'
              }`}
            >
              <ThumbsUp className="w-3.5 h-3.5" />
              <span>{report.userUpvoted ? 'Anda juga melihat ini' : 'Saya juga melihat ini'}</span>
              <span className="font-mono text-xs opacity-80">({report.upvotesCount})</span>
            </button>

            {onStartNavigation ? (
              <button
                type="button"
                onClick={() => onStartNavigation(report)}
                className="py-2 px-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white border border-sky-400/30 text-xs font-semibold flex items-center justify-center space-x-2 transition-all cursor-pointer truncate shadow-sm active:scale-95"
                title="Mulai Panduan Rute Navigasi Langsung"
              >
                <Navigation className="w-3.5 h-3.5 text-sky-200 shrink-0" />
                <span className="truncate">Arahkan</span>
              </button>
            ) : (
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${report.coordinates[0]},${report.coordinates[1]}`}
                target="_blank"
                rel="noopener noreferrer"
                className="py-2 px-3 rounded-xl bg-white/5 hover:bg-white/10 text-white border border-white/10 text-xs font-semibold flex items-center justify-center space-x-2 transition-all cursor-pointer truncate shadow-sm"
              >
                <Navigation className="w-3.5 h-3.5 text-[#FFD60A] shrink-0" />
                <span className="truncate">Arahkan</span>
              </a>
            )}
          </div>

          {/* 3. WORKFLOW PANEL: DETAIL LAPORAN + TABS (A. Laporan & Bukti, B. Analisis, C. Tindakan) */}
          {workflowPanel}

          {/* 4. KOMENTAR (real, server-stored) */}
          <CommentThread
            reportId={report.id}
            canWrite={currentAccount.role !== 'PUBLIC_VIEWER'}
            isStaff={currentAccount.role === 'FIELD_ENGINEER' || currentAccount.role === 'OPERATIONS_MANAGER'}
          />

          {/* Citizen Reporter Edit Button */}
          {canEditReport(currentAccount, report) && onOpenEditModal && (
            <button
              onClick={() => onOpenEditModal(report)}
              className="w-full py-2 rounded-xl bg-amber-400/15 hover:bg-amber-400/25 border border-amber-400/30 text-amber-300 font-bold text-xs flex items-center justify-center space-x-2 transition-all cursor-pointer"
            >
              <span>✏️ Edit Laporan Ini</span>
            </button>
          )}

          {isFieldEngineer && onOpenSPK && (
            <button
              type="button"
              onClick={onOpenSPK}
              className="w-full py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 text-xs font-semibold flex items-center justify-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70"
            >
              <HardHat className="w-4 h-4 text-amber-400" />
              <span>Buka tugas inspeksi saya</span>
            </button>
          )}

          {/* Secondary Footer Icons: Share, Save, Upvote */}
          <div className="grid grid-cols-3 gap-2 pt-1 border-t border-white/10">
            <button
              onClick={() => {
                if (navigator.share) {
                  navigator.share({
                    title: report.damageTypeLabel,
                    text: `Laporan Kerusakan: ${report.segmentName}`
                  });
                } else {
                  alert('Link laporan disalin ke clipboard.');
                }
              }}
              className="py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-xs font-bold flex items-center justify-center space-x-1 cursor-pointer truncate"
            >
              <Share2 className="w-4 h-4 shrink-0" />
              <span>Share</span>
            </button>

            <button
              onClick={() => setIsSaved(!isSaved)}
              className={`py-2 rounded-xl border text-xs font-bold flex items-center justify-center space-x-1 cursor-pointer transition-all truncate ${
                isSaved
                  ? 'bg-amber-400/20 text-amber-300 border-amber-400/40'
                  : 'bg-white/5 hover:bg-white/10 border-white/10 text-slate-300'
              }`}
            >
              <Bookmark className="w-4 h-4 shrink-0" />
              <span>{isSaved ? 'Diikuti' : 'Ikuti'}</span>
            </button>

            <button
              onClick={() => onUpvoteReport(report.id)}
              className={`py-2 rounded-xl border text-xs font-bold flex items-center justify-center space-x-1 cursor-pointer transition-all truncate ${
                report.userUpvoted
                  ? 'bg-[#FFD60A] text-[#0B0D10] border-[#FFD60A] font-semibold'
                  : 'bg-white/5 hover:bg-white/10 border-white/10 text-slate-300'
              }`}
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{report.userUpvoted ? 'Didukung' : 'Dukung'}</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
