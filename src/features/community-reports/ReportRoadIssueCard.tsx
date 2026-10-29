import { Pavi } from '../../components/brand/Pavi';
import { readPavi } from '../../components/brand/paviPrefs';
import { nearestSegment } from '../../domain/geo/nearestSegment';
import React, { useState, useEffect, useRef } from 'react';
import {
  Camera,
  Image as ImageIcon,
  MapPin,
  X,
  Sparkles,
  Check,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Info,
  RefreshCw,
  RotateCw,
  Eye,
  ArrowLeft,
  Copy,
  AlertCircle,
  Video,
  CheckCircle2,
  Sliders,
  ExternalLink,
  Zap,
  ZapOff,
  Crosshair,
  Compass
} from 'lucide-react';
import { DamageReport, DamageType, ReportMutationHandler, ReportSeverity, RoadSegment } from '../../types';
import { UserAccount } from '../authentication/demoAccounts';
import { createSessionReport, ReportCreationError } from './reportFactory';
import { settleMutation } from './reportMutations';
import { useSheetDrag } from '../../components/ui/useSheetDrag';
import { CV_DAMAGE_CLASSES } from '../../engines/computer-vision/classification/cvDamageClasses';
import type { CvAnalysis, CvJobStage, CvJobView, CvSeverityLevel } from '../../types/cv';
import { AiPhotoScan } from './AiPhotoScan';
import { LiveAiOverlay } from './LiveAiOverlay';
import { useSpeedLock, SPEED_LIMIT_KMH } from '../location/speedLock';
import { lastDeviceFix } from '../location/deviceLocation';
import { CV_STAGE_LABELS, CvClientError, checkImageInput, runCvAnalysis } from './cvClient';

/** Damage-type choice in step 3: from the model (with its taxonomy code) or picked by the reporter. */
interface DamageChoice {
  damageType: DamageType;
  label: string;
  icon: string;
  taxonomyCode: string | null;
  source: 'model' | 'user';
}

const CV_SEVERITY_TO_REPORT: Record<CvSeverityLevel, ReportSeverity | null> = { minor: 'LIGHT', moderate: 'MODERATE', severe: 'SEVERE', unknown: null };
const TAXONOMY_ICON: Record<string, string> = { POTHOLE: '🕳', ALLIGATOR_CRACK: '🐊', BLOCK_CRACK: '▦', LONGITUDINAL_CRACK: '〰', TRANSVERSE_CRACK: '〰', EDGE_CRACK: '〰', OTHER_ROAD_DAMAGE: '〰' };
const SEVERITY_ID: Record<CvSeverityLevel, string> = { minor: 'ringan', moderate: 'sedang', severe: 'parah', unknown: 'belum dapat ditentukan' };
/** Manual choices when the model gives no answer (no default is preselected). */
const MANUAL_DAMAGE_CHOICES: DamageChoice[] = Object.values(CV_DAMAGE_CLASSES).map((c) => ({ damageType: c.damageType, label: c.label, icon: c.icon, taxonomyCode: null, source: 'user' }));
/** Stages the engine runs, in order; segmenting only when a segmenter is configured. */
const PIPELINE_STAGES: CvJobStage[] = ['validating_input', 'model_loading', 'preprocessing', 'detecting', 'segmenting', 'evaluating', 'validating'];

/** Draft note from what the model actually found; no physical size or depth claims. */
export function draftNoteFromAnalysis(a: CvAnalysis): string {
  if (!a.detections.length) return '';
  const types = [...new Set(a.detections.map((d) => d.label.toLowerCase()))];
  const sev = SEVERITY_ID[a.overallSeverity ?? 'unknown'];
  return `Teridentifikasi ${types.join(', ')} pada permukaan jalan (deteksi AI, ${a.detections.length} temuan). Tingkat keparahan sementara: ${sev}. Verifikasi lapangan diperlukan untuk memastikan dimensi fisik.`;
}

export type ReportCardState =
  | 'INPUT'
  | 'CAMERA_CAPTURE'
  | 'CAMERA_CONFIRM'
  | 'PREPARING'
  | 'CV_PROCESSING'
  | 'ANALYSIS_RESULT'
  | 'SUCCESS';

export type LocationSource = 'map_pin' | 'device_gps' | 'manual';

export interface ReportLocation {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  source: LocationSource;
  address?: string;
}

interface ReportRoadIssueCardProps {
  isOpen: boolean;
  onClose: () => void;
  currentAccount: UserAccount;
  roadSegments: RoadSegment[];
  selectedSegment?: RoadSegment | null;
  onAddReport: ReportMutationHandler;
  onFocusMapLocation?: (coords: [number, number], zoomLevel?: number, reportId?: string) => void;
  initialCoordinates?: [number, number] | null;
}

/* Shared look for every step of the report sheet: solid surface, thin borders, one yellow accent. */
const SHEET =
  'w-full max-h-[90dvh] sm:max-h-[92vh] sm:max-w-lg bg-surface border-t sm:border border-white/[0.08] rounded-t-2xl sm:rounded-2xl px-5 pt-5 pb-3 sm:p-6 shadow-2xl text-slate-100 flex flex-col overflow-y-auto custom-scrollbar relative box-border';
const CARD = 'rounded-2xl border border-white/[0.08] bg-white/[0.03]';
const LABEL = 'text-sm font-medium text-slate-200';
const HINT = 'text-xs text-slate-400';
const FIELD =
  'w-full rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-400/70 transition-colors';
const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60';
const PRIMARY = `w-full h-12 rounded-2xl bg-amber-400 hover:bg-amber-300 active:bg-amber-500 disabled:opacity-60 disabled:cursor-wait text-slate-950 text-sm font-semibold flex items-center justify-center transition-colors cursor-pointer ${FOCUS}`;
const SECONDARY = `w-full h-12 rounded-2xl border border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.08] text-slate-100 text-sm font-medium flex items-center justify-center transition-colors cursor-pointer ${FOCUS}`;
const TILE = `${CARD} p-4 flex flex-col items-start gap-1 text-left hover:bg-white/[0.06] hover:border-amber-400/40 transition-colors cursor-pointer ${FOCUS}`;
const ICON_TILE = 'w-10 h-10 mb-1 rounded-xl bg-amber-400/10 text-amber-300 flex items-center justify-center text-lg shrink-0';
const ICON_BUTTON = `w-9 h-9 rounded-full text-slate-400 hover:text-white hover:bg-white/[0.06] flex items-center justify-center transition-colors cursor-pointer shrink-0 ${FOCUS}`;
const TEXT_BUTTON = `inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm text-amber-300 hover:bg-amber-400/10 transition-colors cursor-pointer ${FOCUS}`;
const NOTICE = 'rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200';
const ERROR = 'flex items-start gap-2 rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200';
const REPORT_STEPS = 3;

/** Same header on every step: optional back, title + step count, optional close. */
const SheetHeader: React.FC<{ step: number; title: string; subtitle: string; onBack?: () => void; onClose?: () => void }> = ({
  step,
  title,
  subtitle,
  onBack,
  onClose
}) => (
  <div data-sheet-grab className="space-y-3 touch-none sm:touch-auto">
    <div className="mx-auto h-1 w-10 rounded-full bg-white/15 sm:hidden" aria-hidden="true" />
    <div className="flex items-start gap-2">
      {onBack && (
        <button type="button" onClick={onBack} className={`${ICON_BUTTON} -ml-2`} title="Kembali" aria-label="Kembali">
          <ArrowLeft className="w-5 h-5" />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs text-amber-300">
          Langkah {step} dari {REPORT_STEPS}
        </p>
        <h3 className="text-lg font-semibold text-white leading-tight">{title}</h3>
        <p className={`${HINT} mt-1`}>{subtitle}</p>
      </div>
      {onClose && (
        <button type="button" onClick={onClose} className={`${ICON_BUTTON} -mr-2`} title="Tutup" aria-label="Tutup">
          <X className="w-5 h-5" />
        </button>
      )}
    </div>
    <div className="flex gap-2" aria-hidden="true">
      {Array.from({ length: REPORT_STEPS }, (_, i) => (
        <span key={i} className={`h-1 flex-1 rounded-full ${i < step ? 'bg-amber-400' : 'bg-white/10'}`} />
      ))}
    </div>
  </div>
);


export const ReportRoadIssueCard: React.FC<ReportRoadIssueCardProps> = ({
  isOpen,
  onClose,
  currentAccount,
  roadSegments,
  selectedSegment,
  onAddReport,
  onFocusMapLocation,
  initialCoordinates
}) => {
  // Main State Machine
  const [currentState, setCurrentState] = useState<ReportCardState>('INPUT');

  // Input Fields
  const [notes, setNotes] = useState<string>('');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [imageFileName, setImageFileName] = useState<string>('road_photo.jpg');

  // Camera Live Video Stream State
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  // Live AI aiming help: on by default so people see the AI work before they shoot, except when the
  // phone asks to save data (Data Saver / 2G). The choice is remembered per device.
  const [assist, setAssist] = useState<boolean>(() => {
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    const saveData = !!conn?.saveData || conn?.effectiveType === '2g' || conn?.effectiveType === 'slow-2g';
    try {
      const stored = localStorage.getItem('pp-aim-assist');
      return stored === null ? !saveData : stored === '1';
    } catch {
      return !saveData;
    }
  });
  const toggleAssist = () =>
    setAssist((v) => {
      try {
        localStorage.setItem('pp-aim-assist', v ? '0' : '1');
      } catch {
        /* preference not stored */
      }
      return !v;
    });
  const [cameraFacing, setCameraFacing] = useState<'environment' | 'user'>('environment');
  const [flashMode, setFlashMode] = useState<'OFF' | 'AUTO' | 'ON'>('AUTO');
  const [isShutterFlashing, setIsShutterFlashing] = useState<boolean>(false);
  const [isCameraFlipping, setIsCameraFlipping] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  /** Camera page: dark until the browser grants access; no stand-in photo is ever shown. */
  const [cameraPermission, setCameraPermission] = useState<'REQUESTING' | 'GRANTED' | 'DENIED' | 'UNSUPPORTED'>('REQUESTING');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  // File Input Ref
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Swipe the sheet down to close it (header, or the content when scrolled to the top).
  const { sheetRef, sheetProps } = useSheetDrag({
    mode: 'translate',
    onClose: () => {
      stopCameraStream();
      onClose();
    },
    maxWidth: 639
  });

  // Single Source of Truth for Report Location (Pin-First Architecture)
  const initialPoint = initialCoordinates || selectedSegment?.coordinates || [-6.2150, 106.8220];
  const [reportLocation, setReportLocation] = useState<ReportLocation>(() => ({
    latitude: initialPoint[0],
    longitude: initialPoint[1],
    source: 'map_pin',
    address: selectedSegment ? `${selectedSegment.name}, ${selectedSegment.province}` : undefined
  }));

  const coordinates: [number, number] = [reportLocation.latitude, reportLocation.longitude];
  const locationName = reportLocation.address || '';
  const locationSource = reportLocation.source;
  const gpsAccuracy = reportLocation.accuracyMeters ?? null;

  const [isGpsLoading, setIsGpsLoading] = useState<boolean>(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  const nearest = (point: [number, number]) => nearestSegment(roadSegments, point);
  const labelFor = (point: [number, number]) => {
    const seg = nearest(point);
    return seg ? `${seg.name}, ${seg.province}` : `Koordinat ${point[0].toFixed(4)}, ${point[1].toFixed(4)}`;
  };

  const geocodeAbortRef = useRef<AbortController | null>(null);

  // Background reverse geocoding to refine street address without altering coordinates
  const performReverseGeocode = (point: [number, number]) => {
    if (geocodeAbortRef.current) {
      geocodeAbortRef.current.abort();
    }
    const controller = new AbortController();
    geocodeAbortRef.current = controller;

    const timeoutId = setTimeout(() => controller.abort(), 4000);

    fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${point[0]}&lon=${point[1]}&zoom=18&addressdetails=1`,
      {
        headers: { 'Accept-Language': 'id,en' },
        signal: controller.signal
      }
    )
      .then((res) => {
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error('Geocoding response not ok');
        return res.json();
      })
      .then((data) => {
        if (data && data.address) {
          const a = data.address;
          const road = a.road || a.pedestrian || a.street || a.highway || a.neighbourhood || data.name;
          const sub = a.suburb || a.village || a.town || a.city_district || a.county;
          const city = a.city || a.regency || a.state;
          const parts = [road, sub, city].filter(Boolean);
          if (parts.length > 0) {
            setReportLocation((prev) => ({
              ...prev,
              address: parts.join(', ')
            }));
            return;
          }
        }
        setReportLocation((prev) => ({
          ...prev,
          address: prev.address || labelFor(point)
        }));
      })
      .catch(() => {
        // Fallback to nearest segment on offline / timeout / abort
        setReportLocation((prev) => ({
          ...prev,
          address: prev.address || labelFor(point)
        }));
      });
  };

  // Validation Error
  const [validationError, setValidationError] = useState<string | null>(null);

  // CV job (server-reported stages) and its stored analysis
  const [cvJob, setCvJob] = useState<CvJobView | null>(null);
  const [cvAnalysis, setCvAnalysis] = useState<CvAnalysis | null>(null);
  const [cvError, setCvError] = useState<{ code: string; message: string } | null>(null);
  const [showOverlay, setShowOverlay] = useState<boolean>(true);
  const [selectedFinding, setSelectedFinding] = useState<number>(0);
  const cvRunRef = useRef<{ key: string; image: string; abort: AbortController } | null>(null);

  // Step 3 choices; the model output stays in cvAnalysis untouched
  const [damageChoice, setDamageChoice] = useState<DamageChoice | null>(null);
  const [customSeverity, setCustomSeverity] = useState<ReportSeverity | null>(null);
  const modelSeverity: ReportSeverity | null = cvAnalysis ? CV_SEVERITY_TO_REPORT[cvAnalysis.overallSeverity ?? 'unknown'] : null;
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [showTechnicalAnalysis, setShowTechnicalAnalysis] = useState<boolean>(false);

  // Success Created Report
  const [createdReportId, setCreatedReportId] = useState<string>('');
  // Submission waits for the workflow store; success is shown only after it saved the report.
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [savedState, setSavedState] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<boolean>(false);

  const lastGpsPointRef = useRef<[number, number] | null>(null);
  const prevIsOpenRef = useRef<boolean>(isOpen);

  // GPS first: a report is filed where the reporter stands, so the position is taken from the
  // device as soon as the form opens (the pin below is only shown until the fix arrives).
  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      if (currentState === 'SUCCESS') {
        handleReset();
      }
      lastGpsPointRef.current = null;
      handleDetectGps();
      const targetPin = initialCoordinates || selectedSegment?.coordinates;
      if (targetPin) {
        const initialAddr = selectedSegment ? `${selectedSegment.name}, ${selectedSegment.province}` : labelFor(targetPin);
        setReportLocation({
          latitude: targetPin[0],
          longitude: targetPin[1],
          source: 'map_pin',
          address: initialAddr
        });
        setGpsError(null);
        performReverseGeocode(targetPin);
      }
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen]);

  // Synchronize when initialCoordinates or selectedSegment changes (e.g. user moved pin on map)
  useEffect(() => {
    if (!isOpen) return;

    if (initialCoordinates) {
      // Check if this coordinate update was caused by GPS calibration
      const isFromGps =
        lastGpsPointRef.current &&
        Math.abs(initialCoordinates[0] - lastGpsPointRef.current[0]) < 1e-5 &&
        Math.abs(initialCoordinates[1] - lastGpsPointRef.current[1]) < 1e-5;

      if (!isFromGps) {
        lastGpsPointRef.current = null;
        setReportLocation({
          latitude: initialCoordinates[0],
          longitude: initialCoordinates[1],
          source: 'map_pin',
          address: labelFor(initialCoordinates)
        });
        setGpsError(null);
        performReverseGeocode(initialCoordinates);
      }
    } else if (selectedSegment) {
      lastGpsPointRef.current = null;
      setReportLocation({
        latitude: selectedSegment.coordinates[0],
        longitude: selectedSegment.coordinates[1],
        source: 'map_pin',
        address: `${selectedSegment.name}, ${selectedSegment.province}`
      });
      setGpsError(null);
      performReverseGeocode(selectedSegment.coordinates);
    }
  }, [initialCoordinates, selectedSegment]);

  // Explicit GPS calibration when user clicks "Perbarui GPS"
  const handleDetectGps = () => {
    if (isGpsLoading) return;
    setGpsError(null);

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsError('Perangkat atau browser Anda tidak mendukung Geolocation.');
      return;
    }

    setIsGpsLoading(true);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsGpsLoading(false);
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const acc = pos.coords.accuracy;

        // Strict coordinates validation (-90 to 90, -180 to 180, not NaN)
        if (
          typeof lat !== 'number' ||
          typeof lng !== 'number' ||
          isNaN(lat) ||
          isNaN(lng) ||
          lat < -90 ||
          lat > 90 ||
          lng < -180 ||
          lng > 180
        ) {
          setGpsError('Koordinat GPS yang diterima tidak valid.');
          return;
        }

        const newPoint: [number, number] = [Number(lat.toFixed(6)), Number(lng.toFixed(6))];
        lastGpsPointRef.current = newPoint;

        setReportLocation({
          latitude: newPoint[0],
          longitude: newPoint[1],
          accuracyMeters: acc,
          source: 'device_gps',
          address: labelFor(newPoint)
        });

        // Synchronize marker on the map so map pin moves simultaneously
        onFocusMapLocation?.(newPoint, 17);

        // Perform reverse geocoding on the calibrated coordinates
        performReverseGeocode(newPoint);
      },
      (err) => {
        setIsGpsLoading(false);
        let message = 'Gagal mengambil lokasi GPS.';
        if (err.code === err.PERMISSION_DENIED) {
          message = 'Izin lokasi ditolak. Periksa pengaturan browser Anda.';
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          message = 'Sinyal GPS perangkat tidak tersedia saat ini.';
        } else if (err.code === err.TIMEOUT) {
          message = 'Waktu permintaan GPS habis. Coba lagi di area terbuka.';
        }
        setGpsError(message);
        setTimeout(() => setGpsError(null), 5000);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );
  };

  // Stop camera stream & cancel in-flight geocode requests when component closes or unmounts
  useEffect(() => {
    return () => {
      stopCameraStream();
      if (geocodeAbortRef.current) {
        geocodeAbortRef.current.abort();
      }
    };
  }, []);

  const stopCameraStream = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    setIsCameraActive(false);
  };

  // Open Full-screen Camera Page
  /** Ask for the camera (the browser shows its permission prompt) and start the stream. */
  const requestCameraStream = async (facing: 'environment' | 'user') => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraPermission('UNSUPPORTED');
      setIsCameraActive(false);
      return;
    }
    setCameraPermission('REQUESTING');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } }
      });
      mediaStreamRef.current = stream;
      setCameraPermission('GRANTED');
      setIsCameraActive(true);
    } catch (err) {
      console.warn('Camera not available:', err);
      setCameraPermission('DENIED');
      setIsCameraActive(false);
    }
  };

  // Open Full-screen Camera Page: dark page, permission prompt, then live camera
  const handleOpenFullscreenCamera = async () => {
    setValidationError(null);
    setCameraError(null);
    setCurrentState('CAMERA_CAPTURE');
    await requestCameraStream(cameraFacing);
  };

  // Attach the stream once the <video> element is on screen.
  useEffect(() => {
    const video = videoRef.current;
    if (currentState === 'CAMERA_CAPTURE' && isCameraActive && video && mediaStreamRef.current) {
      video.srcObject = mediaStreamRef.current;
      video.play().catch(() => undefined);
    }
  }, [currentState, isCameraActive]);

  // If access was blocked and the user allows it later in the browser, open the camera right away.
  useEffect(() => {
    if (currentState !== 'CAMERA_CAPTURE' || cameraPermission !== 'DENIED' || !navigator.permissions?.query) return;
    let status: PermissionStatus | null = null;
    const onChange = () => {
      if (status?.state === 'granted') requestCameraStream(cameraFacing);
    };
    navigator.permissions
      .query({ name: 'camera' as PermissionName })
      .then((st) => {
        status = st;
        st.addEventListener('change', onChange);
      })
      .catch(() => undefined);
    return () => status?.removeEventListener('change', onChange);
  }, [currentState, cameraPermission, cameraFacing]);

  // Switch / Flip Front & Back Camera
  const handleFlipCamera = async () => {
    setIsCameraFlipping(true);
    setTimeout(() => setIsCameraFlipping(false), 500);

    const nextFacing = cameraFacing === 'environment' ? 'user' : 'environment';
    setCameraFacing(nextFacing);

    stopCameraStream();
    await requestCameraStream(nextFacing);
  };

  // Toggle Flash Mode
  const handleToggleFlash = () => {
    if (flashMode === 'AUTO') setFlashMode('ON');
    else if (flashMode === 'ON') setFlashMode('OFF');
    else setFlashMode('AUTO');
  };

  // Capture photo from live camera or high-res road snapshot -> Now prompts confirmation
  const speed = useSpeedLock(isCameraActive && currentState === 'CAMERA_CAPTURE');

  const handleCapturePhoto = () => {
    // SPEC 0.6: never while moving faster than the limit.
    if (speed.locked) return;
    // Only a real camera frame can become evidence; there is no stand-in photo.
    const video = videoRef.current;
    if (!video || !isCameraActive || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const capturedUrl = canvas.toDataURL('image/jpeg', 0.92);

    // Trigger shutter screen flash animation
    setIsShutterFlashing(true);
    setTimeout(() => setIsShutterFlashing(false), 180);

    setSelectedImage(capturedUrl);
    setImageFileName(`road_capture_${Date.now().toString().slice(-4)}.jpg`);
    stopCameraStream();
    setValidationError(null);

    // Show Confirmation Screen before proceeding to AI processing
    setTimeout(() => {
      setCurrentState('CAMERA_CONFIRM');
    }, 200);
  };

  // User confirms captured photo -> proceed to AI Processing
  const handleConfirmCapturedPhoto = () => {
    startAiProcessing();
  };

  // User retakes photo -> back to camera capture
  const handleRetakeCapturedPhoto = () => {
    setSelectedImage(null);
    handleOpenFullscreenCamera();
  };

  /** Fill step 3 from a finished analysis: model type, model severity, draft note. */
  const applyAnalysis = (a: CvAnalysis) => {
    setCvAnalysis(a);
    setSelectedFinding(0);
    setShowOverlay(Boolean(a.overlayUrl));
    setCustomSeverity(null);
    setDamageChoice(
      a.primary
        ? { damageType: a.primary.damageType as DamageType, label: a.primary.label, icon: TAXONOMY_ICON[a.primary.taxonomyCode] ?? '•', taxonomyCode: a.primary.taxonomyCode, source: 'model' }
        : null
    );
    const draft = draftNoteFromAnalysis(a);
    if (draft) setNotes((prev) => (prev.trim() ? prev : draft));
  };

  // Run the real CV job; the step 2 view follows the stages the server reports.
  const startAiProcessing = async () => {
    if (!selectedImage) return;
    // Same photo again (retry, back-and-forth): reuse the key so the server returns the same job.
    const prev = cvRunRef.current;
    if (prev && prev.image === selectedImage && cvAnalysis) {
      setCurrentState('ANALYSIS_RESULT');
      return;
    }
    prev?.abort.abort();
    const key = prev && prev.image === selectedImage ? prev.key : crypto.randomUUID();
    const abort = new AbortController();
    cvRunRef.current = { key, image: selectedImage, abort };
    setCvJob(null);
    setCvAnalysis(null);
    setCvError(null);
    setCurrentState('CV_PROCESSING');
    try {
      const job = await runCvAnalysis(selectedImage, key, setCvJob, abort.signal);
      if (abort.signal.aborted) return;
      const analysis = job.analysis!;
      if (analysis.status === 'failed') {
        setCvError({ code: analysis.failure?.code ?? 'ANALYSIS_FAILED', message: analysis.failure?.message ?? 'Analisis gagal.' });
        return;
      }
      applyAnalysis(analysis);
      setCurrentState('ANALYSIS_RESULT');
    } catch (error) {
      if (abort.signal.aborted) return;
      const e = error instanceof CvClientError ? error : new CvClientError('NETWORK', 'Server analisis tidak dapat dihubungi.');
      setCvError({ code: e.code, message: e.message });
    }
  };

  // Inference failed or skipped: continue with a manual report (no AI result attached).
  const continueWithoutAi = () => {
    setCvAnalysis(null);
    setDamageChoice(MANUAL_DAMAGE_CHOICES.find((c) => c.damageType === 'POTHOLE') ?? MANUAL_DAMAGE_CHOICES[0]);
    setCustomSeverity((prev) => prev || 'MODERATE');
    setCurrentState('ANALYSIS_RESULT');
  };

  // Handle image file selection from gallery: validate, then show the preview in step 1.
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    if (file.size === 0) {
      setValidationError('File foto kosong.');
      input.value = '';
      return;
    }
    setImageFileName(file.name);
    // Phone photos are often > 5 MB or HEIC; decode whatever the browser can read, then
    // re-encode as JPEG (long side <= 1920 px) so the CV service always gets a valid input.
    const url = URL.createObjectURL(file);
    const probe = new Image();
    probe.onload = () => {
      URL.revokeObjectURL(url);
      input.value = '';
      if (currentState !== 'INPUT') setCurrentState('INPUT');
      const w = probe.naturalWidth;
      const h = probe.naturalHeight;
      if (Math.min(w, h) < 160) {
        setValidationError(`Resolusi foto terlalu kecil (${w}×${h}); minimal 160 px pada sisi pendek.`);
        return;
      }
      const k = Math.min(1, 1920 / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * k);
      canvas.height = Math.round(h * k);
      canvas.getContext('2d')!.drawImage(probe, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      const invalid = checkImageInput('image/jpeg', Math.ceil((dataUrl.length - 23) * 0.75));
      if (invalid) {
        setValidationError(invalid);
        return;
      }
      setSelectedImage(dataUrl);
      setValidationError(null);
      stopCameraStream();
    };
    probe.onerror = () => {
      URL.revokeObjectURL(url);
      input.value = '';
      setValidationError('Format foto tidak dapat dibaca browser ini. Gunakan JPEG/PNG atau ambil langsung dengan kamera.');
      if (currentState !== 'INPUT') setCurrentState('INPUT');
    };
    probe.src = url;
  };

  // Reset form
  const handleReset = () => {
    stopCameraStream();
    cvRunRef.current?.abort.abort();
    cvRunRef.current = null;
    setCurrentState('INPUT');
    setNotes('');
    setSelectedImage(null);
    setValidationError(null);
    setCvJob(null);
    setCvAnalysis(null);
    setCvError(null);
    setDamageChoice(null);
    setCustomSeverity(null);
    setShowTechnicalAnalysis(false);
  };

  // Trigger Validation and Advance to CV Processing from manual input
  const handleContinue = () => {
    const lat = reportLocation.latitude;
    const lng = reportLocation.longitude;
    if (
      typeof lat !== 'number' ||
      typeof lng !== 'number' ||
      isNaN(lat) ||
      isNaN(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      setValidationError('Koordinat lokasi tidak valid.');
      return;
    }
    if (!locationName.trim()) {
      setValidationError('Mohon masukkan detail lokasi kerusakan jalan.');
      return;
    }
    if (!selectedImage) {
      setValidationError('Mohon ambil foto atau unggah gambar kerusakan.');
      return;
    }
    setValidationError(null);
    startAiProcessing();
  };

  // Preview on Map
  const handleViewOnMap = () => {
    if (onFocusMapLocation) {
      onFocusMapLocation(coordinates, 15);
    }
  };

  // Submit Final Report
  const handleSubmitReport = async () => {
    if (isSubmitting) return;

    const lat = reportLocation.latitude;
    const lng = reportLocation.longitude;
    if (
      typeof lat !== 'number' ||
      typeof lng !== 'number' ||
      isNaN(lat) ||
      isNaN(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      setSubmitError('Koordinat lokasi laporan tidak valid.');
      return;
    }

    // A report is filed where the reporter stands: only a fresh GPS fix is accepted, never a
    // pin moved on the map or a typed address.
    const gps = lastGpsPointRef.current ?? lastDeviceFix(2 * 60_000)?.coordinates ?? null;
    if (!gps) {
      setSubmitError('Laporan harus dikirim dari lokasi kerusakan. Izinkan akses lokasi (GPS), lalu coba lagi.');
      handleDetectGps();
      return;
    }
    const finalCoordinates: [number, number] = gps;
    const targetSeg = nearest(finalCoordinates) ?? roadSegments[0];

    const chosenSeverity = customSeverity || modelSeverity;
    if (!damageChoice) {
      setSubmitError('Pilih jenis kerusakan terlebih dahulu.');
      return;
    }
    if (!chosenSeverity) {
      setSubmitError('Pilih tingkat keparahan terlebih dahulu.');
      return;
    }
    if (!selectedImage) {
      setSubmitError('Foto kerusakan belum ada.');
      return;
    }
    const effectiveSeverity: ReportSeverity = chosenSeverity;
    const attachedAnalysis = cvAnalysis && cvAnalysis.status !== 'failed' ? cvAnalysis : null;

    let newReport: DamageReport;
    try {
      newReport = createSessionReport({
      reporterName: currentAccount.name,
      reporterRole: currentAccount.role === 'PUBLIC_REPORTER' ? 'Public Reporter' : 'Citizen User',
      reporterAvatar: currentAccount.avatarUrl,
      timestamp: new Date().toLocaleString('id-ID', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }),
      segmentId: targetSeg.id,
      // A typed place name is the reporter's own words; otherwise the road the GPS point is on.
      segmentName: (locationSource === 'manual' && locationName.split(',')[0].trim()) || targetSeg.name,
      corridor: targetSeg.corridor || 'Koridor Jalan Nasional',
      province: targetSeg.province || 'Jawa Barat',
      coordinates: finalCoordinates,
      damageType: damageChoice.damageType,
      damageTypeLabel: damageChoice.label,
      severity: effectiveSeverity,
      // Physical size and depth are not measured from a photo (cvAssessment.measurements
      // says not_estimable); 0 means "not measured", never a model estimate.
      estimatedDepthCm: 0,
      estimatedAreaM2: 0,
      photoUrl: selectedImage,
      description: notes.trim() || `Laporan kerusakan jalan (${damageChoice.label}) dari warga.`,
      upvotesCount: 1,
      userUpvoted: true,
      // The server replaces this with the stored analysis when cvAnalysisId verifies;
      // confidence sent from here is always discarded.
      aiAnalysis: {
        class: damageChoice.taxonomyCode ?? damageChoice.damageType,
        label: damageChoice.label,
        icon: damageChoice.icon,
        confidence: null,
        modelStatus: 'NOT_CLASSIFIED',
        severity: effectiveSeverity.toLowerCase(),
        characteristics: []
      },
      ...(attachedAnalysis ? { cvAnalysisId: attachedAnalysis.analysisId } : {})
      }, currentAccount);
    } catch (error) {
      if (error instanceof ReportCreationError) {
        alert(error.message);
        return;
      }
      throw error;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    const outcome = await settleMutation(onAddReport(newReport), newReport);
    setIsSubmitting(false);
    if (outcome.ok === false) {
      setSubmitError((outcome as { error: string }).error);
      return;
    }
    const saved = (outcome as { report: DamageReport }).report;
    setCreatedReportId(saved.id);
    setSavedState(saved.workflowState ?? null);
    setCurrentState('SUCCESS');
  };

  // Copy report ID
  const handleCopyReportId = () => {
    navigator.clipboard.writeText(createdReportId);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  if (!isOpen) return null;

  // Derive location title and subtitle cleanly
  const locationParts = locationName.split(',');
  const mainRoadName = locationParts[0]?.trim() || selectedSegment?.name || 'Lokasi laporan';
  const subLocationName =
    locationParts.slice(1).join(',').trim() ||
    (selectedSegment ? `${selectedSegment.corridor}, ${selectedSegment.province}` : `${coordinates[0].toFixed(4)}, ${coordinates[1].toFixed(4)}`);

  const effectiveSeverity: ReportSeverity | null = customSeverity || modelSeverity;
  const processingStageText = cvJob ? CV_STAGE_LABELS[cvJob.stage] ?? cvJob.stage : 'Memeriksa foto...';
  const progressPercent = 65;

  return (
    <>
      {/* File Input for Gallery Pick */}
      <input
        id="citizen-report-file-input"
        data-testid="report-photo-input"
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileUpload}
        className="hidden"
      />

      {/* ========================================================================= */}
      {/* FULLSCREEN CAMERA CAPTURE PAGE (EXACT MATCH WITH USER REFERENCE IMAGE 2)   */}
      {/* ========================================================================= */}
      {currentState === 'CAMERA_CAPTURE' ? (
        <div className="fixed inset-0 z-[2000] bg-black flex flex-col justify-between overflow-hidden select-none animate-in fade-in duration-200">
          {/* Shutter Screen Flash Animation Overlay */}
          {isShutterFlashing && (
            <div className="absolute inset-0 bg-white z-[2100] pointer-events-none transition-opacity duration-150" />
          )}

          {/* Live camera feed on a dark page; nothing else is shown until access is granted */}
          <div className="absolute inset-0 w-full h-full overflow-hidden z-0 bg-canvas">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover ${isCameraActive ? '' : 'hidden'}`}
            />

            {/* What the AI sees, live, before the photo is taken */}
            <LiveAiOverlay video={videoRef.current} active={assist && !speed.locked && isCameraActive && currentState === 'CAMERA_CAPTURE'} />
          </div>

          {isCameraActive && currentState === 'CAMERA_CAPTURE' && (
            <button type="button" onClick={toggleAssist} className={`absolute left-1/2 top-20 z-30 -translate-x-1/2 rounded-full px-4 py-2 text-xs font-bold backdrop-blur ${assist ? 'bg-[#FFD60A] text-[#0B0D10]' : 'bg-black/55 text-white'}`}>
              {assist ? 'AI live: aktif (ketuk untuk hemat kuota)' : 'AI live: mati — ketuk untuk menyalakan'}
            </button>
          )}

          {speed.locked && isCameraActive && currentState === 'CAMERA_CAPTURE' && (
            <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-2 bg-black/80 px-8 text-center text-white" role="alert">
              <p className="text-lg font-extrabold">Berhenti dulu untuk melapor</p>
              <p className="text-sm text-white/70">Kamera terkunci saat bergerak lebih dari {SPEED_LIMIT_KMH} km/jam ({Math.round(speed.kmh ?? 0)} km/jam). Menepilah dengan aman, lalu potret.</p>
            </div>
          )}

          {/* Permission state on the dark page (no stand-in image) */}
          {!isCameraActive && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 px-8 text-center" role="status">
              <span className="w-12 h-12 rounded-2xl bg-amber-400/10 text-amber-300 flex items-center justify-center">
                <Camera className="w-6 h-6" />
              </span>
              {cameraPermission === 'REQUESTING' ? (
                <>
                  <p className="text-sm font-medium text-white">Meminta izin kamera…</p>
                  <p className="text-xs text-slate-400">Pilih “Izinkan” pada pesan browser untuk membuka kamera.</p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium text-white">
                    {cameraPermission === 'UNSUPPORTED' ? 'Kamera tidak didukung di browser ini' : 'Akses kamera belum diizinkan'}
                  </p>
                  <p className="text-xs text-slate-400">
                    {cameraPermission === 'UNSUPPORTED'
                      ? 'Pilih foto dari galeri sebagai gantinya.'
                      : 'Izinkan kamera di pengaturan browser; kamera akan langsung terbuka. Atau pilih foto dari galeri.'}
                  </p>
                  <div className="flex gap-2 pt-1">
                    {cameraPermission === 'DENIED' && (
                      <button
                        type="button"
                        onClick={() => requestCameraStream(cameraFacing)}
                        className="h-10 px-4 rounded-full bg-amber-400 hover:bg-amber-300 text-slate-950 text-sm font-semibold cursor-pointer"
                      >
                        Coba lagi
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="h-10 px-4 rounded-full border border-white/15 bg-white/[0.04] hover:bg-white/[0.08] text-white text-sm font-medium cursor-pointer"
                    >
                      Pilih dari galeri
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* TOP BAR OVERLAY: < Chevron Left, "Report Road Issue", Flash / AI Toggle */}
          <div className="relative z-30 pt-safe pt-4 px-4 sm:px-6 flex items-center justify-between">
            {/* Back Button */}
            <button
              type="button"
              onClick={() => {
                stopCameraStream();
                setCurrentState('INPUT');
              }}
              className="w-10 h-10 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60 active:scale-95 transition-all cursor-pointer border border-white/10"
              title="Back"
            >
              <ChevronLeft className="w-6 h-6 text-white stroke-[2.5]" />
            </button>

            {/* Title */}
            <h2 className="text-base sm:text-lg font-bold text-white tracking-tight drop-shadow-md text-center">
              Lapor jalan rusak
            </h2>

            {/* Flash / Mode Toggle */}
            <button
              type="button"
              onClick={handleToggleFlash}
              className="w-10 h-10 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60 active:scale-95 transition-all cursor-pointer border border-white/10"
              title={`Flash Mode: ${flashMode}`}
            >
              {flashMode === 'ON' ? (
                <Zap className="w-5 h-5 fill-amber-300 text-amber-300" />
              ) : flashMode === 'AUTO' ? (
                <Sparkles className="w-5 h-5 text-amber-300" />
              ) : (
                <ZapOff className="w-5 h-5 text-white/80" />
              )}
            </button>
          </div>

          {/* BOTTOM CONTROLS OVERLAY: Shutter Controls + Floating Location Card */}
          <div className="relative z-30 pb-safe pb-6 px-4 sm:px-6 flex flex-col items-center gap-4 from-black/85 via-black/40 pt-12">
            {/* 1. Shutter Control Row: Gallery (Left) - Shutter (Center) - Flip (Right) */}
            <div className="w-full max-w-sm flex items-center justify-between px-6 sm:px-10">
              {/* Left: Gallery / Pick Image Button */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-12 h-12 rounded-full bg-black/50 border border-white/20 text-white flex items-center justify-center hover:bg-black/70 active:scale-95 transition-all cursor-pointer shadow-lg"
                title="Pilih dari Galeri"
              >
                <ImageIcon className="w-5 h-5 text-white" />
              </button>

              {/* Center: Camera Shutter Button */}
              <button
                type="button"
                onClick={handleCapturePhoto}
                disabled={!isCameraActive}
                className="w-20 h-20 rounded-full border-4 border-white/90 flex items-center justify-center p-1 cursor-pointer active:scale-90 transition-transform shadow-2xl group disabled:opacity-30 disabled:cursor-not-allowed"
                title="Ambil Foto Kerusakan Jalan"
              >
                <div className="w-full h-full bg-white rounded-full transition-all group-hover:scale-95 group-active:scale-90 shadow-md" />
              </button>

              {/* Right: Flip Camera Button */}
              <button
                type="button"
                onClick={handleFlipCamera}
                className="w-12 h-12 rounded-full bg-black/50 border border-white/20 text-white flex items-center justify-center hover:bg-black/70 active:scale-95 transition-all cursor-pointer shadow-lg"
                title="Balik Kamera"
              >
                <RotateCw
                  className={`w-5 h-5 text-white transition-transform duration-500 ${
                    isCameraFlipping ? 'rotate-180' : ''
                  }`}
                />
              </button>
            </div>

            {/* 2. Floating Location Pill (Exact match with Reference Image 2) */}
            <div className="w-full max-w-md bg-black/65 border border-white/15 rounded-2xl px-4 py-3 flex items-center justify-between shadow-2xl text-left">
              {/* Left Pin Icon */}
              <div className="w-9 h-9 rounded-full bg-white/10 text-white flex items-center justify-center shrink-0 border border-white/10">
                <MapPin className="w-4 h-4 text-amber-400" />
              </div>

              {/* Center Road Name & Subtitle */}
              <div className="min-w-0 flex-1 px-3">
                <h4 className="text-sm font-bold text-white leading-tight truncate">
                  {mainRoadName}
                </h4>
                <p className="text-xs text-white/70 leading-tight mt-1 truncate">
                  {subLocationName}
                </p>
              </div>

              {/* Right GPS Crosshair Button */}
              <button
                type="button"
                onClick={handleDetectGps}
                disabled={isGpsLoading}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center shrink-0 active:scale-95 transition-all cursor-pointer disabled:opacity-60"
                aria-label="Perbarui GPS"
              >
                <Crosshair
                  className={`w-4 h-4 ${
                    isGpsLoading ? 'animate-spin text-amber-300' : 'text-white'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>
      ) : currentState === 'CAMERA_CONFIRM' ? (
        /* ========================================================================= */
        /* FULLSCREEN PHOTO CONFIRMATION PAGE (Retake / Capture Ulang VS Lanjutkan)   */
        /* ========================================================================= */
        <div className="fixed inset-0 z-[2000] bg-black flex flex-col justify-between overflow-hidden select-none animate-in fade-in duration-200">
          {/* Captured Road Photo Fullscreen View */}
          <div className="absolute inset-0 w-full h-full overflow-hidden z-0 bg-slate-950 flex items-center justify-center">
            <img
              src={selectedImage || CV_DAMAGE_CLASSES.pothole.samplePhotoUrl}
              alt="Hasil Tangkapan Kamera"
              className="w-full h-full object-cover"
            />
            {/* Subtle Gradient Overlay for Top and Bottom readability */}
            <div className="absolute inset-0 from-black/60 to-black/85 pointer-events-none" />
          </div>

          {/* TOP BAR: Back Button & Confirmation Status */}
          <div className="relative z-30 pt-safe pt-4 px-4 sm:px-6 flex items-center justify-between">
            <button
              type="button"
              onClick={handleRetakeCapturedPhoto}
              className="w-10 h-10 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 active:scale-95 transition-all cursor-pointer border border-white/15"
              title="Capture Ulang"
            >
              <ChevronLeft className="w-6 h-6 text-white stroke-[2.5]" />
            </button>

            <div className="text-center">
              <h2 className="text-sm sm:text-base font-semibold text-white tracking-tight drop-shadow-md">
                Konfirmasi Foto
              </h2>
              <p className="text-xs sm:text-xs text-slate-300 font-medium drop-shadow">
                Pastikan kerusakan terlihat jelas
              </p>
            </div>

            <div className="w-10 h-10 rounded-full bg-amber-400 text-slate-950 flex items-center justify-center">
              <Check className="w-5 h-5 stroke-[2.5]" />
            </div>
          </div>

          {/* BOTTOM BAR: Location Badge & 2 Action Buttons (Capture Ulang vs Lanjutkan) */}
          <div className="relative z-30 pb-safe pb-6 px-4 sm:px-6 flex flex-col items-center gap-3 from-black/90 via-black/60 pt-8">
            {/* Location preview badge */}
            <div className="w-full max-w-md bg-black/60 border border-white/15 rounded-2xl px-4 py-3 flex items-center space-x-3 text-left">
              <MapPin className="w-4 h-4 text-amber-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-white truncate leading-tight">{mainRoadName}</p>
                <p className="text-xs text-slate-300 truncate leading-tight mt-1">{subLocationName}</p>
              </div>
            </div>

            {/* 2 Big Action Buttons: Capture Ulang & Lanjutkan Proses */}
            <div className="w-full max-w-md grid grid-cols-2 gap-3">
              {/* Retake Button */}
              <button
                type="button"
                onClick={handleRetakeCapturedPhoto}
                className="h-12 px-4 rounded-2xl bg-black/40 hover:bg-black/55 text-white font-medium text-sm flex items-center justify-center gap-2 border border-white/20 transition-colors cursor-pointer"
              >
                <RotateCw className="w-4 h-4 text-white" />
                <span>Ulangi</span>
              </button>

              {/* Confirm / Continue Button */}
              <button
                type="button"
                onClick={handleConfirmCapturedPhoto}
                className="h-12 px-4 rounded-2xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <span>Lanjutkan</span>
                <ChevronRight className="w-4 h-4 stroke-[3]" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* ========================================================================= */
        /* BOTTOM SHEET (INPUT, PREPARING, CV_PROCESSING, REVIEW, SUCCESS)            */
        /* One calm style for every step: solid surface, thin borders, yellow accent  */
        /* ========================================================================= */
        <div className="fixed inset-0 z-[1500] bg-black/50 flex flex-col justify-end sm:items-center sm:justify-center p-0 sm:p-4 overflow-y-auto animate-in fade-in duration-200">
          {/* Backdrop click closes the sheet */}
          <div
            className="fixed inset-0 -z-10 cursor-pointer"
            onClick={() => {
              stopCameraStream();
              onClose();
            }}
          />

          <div ref={sheetRef as React.RefObject<HTMLDivElement>} {...sheetProps} data-sheet-scroll className={SHEET}>
            {/* ========================================================================= */}
            {/* STEP 1: INPUT REPORT (notes, photo, location)                             */}
            {/* ========================================================================= */}
            {currentState === 'INPUT' && (
              <div className="space-y-5 animate-in fade-in duration-200 flex-1 flex flex-col justify-between">
                <div className="space-y-5">
                  <SheetHeader
                    step={1}
                    title="Lapor jalan rusak"
                    subtitle="Foto, lokasi, dan catatan singkat"
                    onClose={() => {
                      stopCameraStream();
                      onClose();
                    }}
                  />

                  {/* 1. Notes */}
                  <div className="space-y-2">
                    <label htmlFor="report-notes" className="flex items-center justify-between">
                      <span className={LABEL}>Catatan</span>
                      <span className={HINT}>Opsional</span>
                    </label>
                    <textarea
                      id="report-notes"
                      rows={2}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Contoh: lubang cukup dalam di lajur kiri"
                      className={`${FIELD} resize-none`}
                    />
                  </div>

                  {/* 2. Evidence photo */}
                  <div className="space-y-2">
                    <p className={LABEL}>Foto kerusakan</p>

                    {selectedImage ? (
                      <div className={`${CARD} overflow-hidden`}>
                        <img src={selectedImage} alt="Foto kerusakan yang dipilih" className="w-full h-40 sm:h-48 object-cover" />
                        <div className="flex items-center justify-between gap-2 px-4 py-3">
                          <span className="flex items-center gap-2 min-w-0 text-sm text-slate-200">
                            <Check className="w-4 h-4 text-amber-400 shrink-0" />
                            <span className="truncate">{imageFileName}</span>
                          </span>
                          <div className="flex items-center gap-1 shrink-0">
                            <button type="button" onClick={handleOpenFullscreenCamera} className={TEXT_BUTTON}>
                              Ulangi
                            </button>
                            <button type="button" onClick={() => fileInputRef.current?.click()} className={TEXT_BUTTON}>
                              Galeri
                            </button>
                            <button type="button" onClick={() => setSelectedImage(null)} className={ICON_BUTTON} title="Hapus foto" aria-label="Hapus foto">
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-3">
                          <button type="button" onClick={handleOpenFullscreenCamera} className={TILE}>
                            <span className={ICON_TILE}>
                              <Camera className="w-5 h-5" />
                            </span>
                            <span className="text-sm font-medium text-white">Ambil foto</span>
                            <span className={HINT}>Kamera perangkat</span>
                          </button>
                          <button type="button" onClick={() => fileInputRef.current?.click()} className={TILE}>
                            <span className={ICON_TILE}>
                              <ImageIcon className="w-5 h-5" />
                            </span>
                            <span className="text-sm font-medium text-white">Pilih gambar</span>
                            <span className={HINT}>Dari galeri</span>
                          </button>
                        </div>

                      </div>
                    )}

                    {cameraError && <p className={NOTICE}>{cameraError}</p>}
                  </div>

                  {/* 3. Location */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label htmlFor="report-location" className={LABEL}>Lokasi</label>
                      <button
                        type="button"
                        onClick={handleDetectGps}
                        disabled={isGpsLoading}
                        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-amber-300 bg-amber-400/10 border border-amber-400/30 hover:bg-amber-400/20 active:scale-95 transition-all cursor-pointer disabled:opacity-60 disabled:cursor-wait"
                        aria-label="Perbarui lokasi menggunakan GPS"
                      >
                        <Crosshair className={`w-3.5 h-3.5 shrink-0 ${isGpsLoading ? 'animate-spin text-amber-300' : 'text-amber-400'}`} />
                        <span>{isGpsLoading ? 'Mencari GPS…' : 'Perbarui GPS'}</span>
                      </button>
                    </div>

                    {gpsError && (
                      <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300 animate-in fade-in">
                        <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                        <span>{gpsError}</span>
                      </div>
                    )}

                    <div className={`${CARD} flex items-center gap-3 px-4 py-3`}>
                      <MapPin className="w-5 h-5 text-amber-400 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <input
                          id="report-location"
                          type="text"
                          value={locationName}
                          onChange={(e) => {
                            setReportLocation((prev) => ({
                              ...prev,
                              address: e.target.value,
                              source: 'manual'
                            }));
                          }}
                          placeholder="Nama jalan atau patokan"
                          className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
                        />
                        <p className={`${HINT} font-mono mt-0.5 text-xs text-slate-400`}>
                          {coordinates[0].toFixed(4)}, {coordinates[1].toFixed(4)} ·{' '}
                          <span className={locationSource === 'device_gps' ? 'text-amber-400/90 font-sans' : 'font-sans'}>
                            {isGpsLoading
                              ? 'mencari GPS…'
                              : locationSource === 'device_gps'
                              ? `GPS aktif${gpsAccuracy ? ` (±${Math.round(gpsAccuracy)}m)` : ''}`
                              : locationSource === 'manual'
                              ? 'alamat manual'
                              : 'lokasi pin'}
                          </span>
                        </p>
                      </div>
                    </div>
                  </div>

                  {validationError && (
                    <p role="alert" className={ERROR}>
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{validationError}</span>
                    </p>
                  )}
                </div>

                <div className="pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
                  <button type="button" onClick={handleContinue} className={PRIMARY}>
                    Lanjutkan
                  </button>
                </div>
              </div>
            )}

            {/* ========================================================================= */}
            {/* STEP 2: PREPARING & PHOTO CHECK                                            */}
            {/* ========================================================================= */}
            {(currentState === 'PREPARING' || currentState === 'CV_PROCESSING') && (
              <div className="space-y-6 animate-in fade-in duration-200 flex-1 flex flex-col justify-between">
                <div className="space-y-4">
                  <SheetHeader
                    step={2}
                    title={cvError ? 'Pemeriksaan Foto' : 'Memeriksa foto'}
                    subtitle={cvError ? 'AI sedang tidak aktif, Anda tetap bisa melapor' : 'Biasanya hanya beberapa detik'}
                    onBack={() => setCurrentState('INPUT')}
                  />

                  {cvError ? (
                    <div className="space-y-3">
                      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 space-y-1.5 text-xs text-amber-200">
                        <div className="flex items-center gap-2 font-bold text-amber-300">
                          <AlertCircle className="w-4 h-4 shrink-0" />
                          <span>AI sedang tidak aktif</span>
                        </div>
                        <p className="text-slate-300 leading-relaxed text-[11px]">
                          Foto Anda tetap tersimpan. Pilih sendiri jenis kerusakannya, petugas akan memeriksanya.
                        </p>
                      </div>
                      <button
                        type="button"
                        id="btn-continue-manual-report"
                        onClick={continueWithoutAi}
                        className={PRIMARY}
                      >
                        Lanjut isi sendiri
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {selectedImage && <AiPhotoScan src={selectedImage} scanning />}
                      {/* Pavi analyses: the real pipeline stages reported by the server, in order. */}
                      <div className={`${CARD} flex items-center gap-4 p-4`}>
                        <Pavi size={64} mood="scan" helmet={readPavi().helmet} vest={readPavi().vest} />
                        <ol className="min-w-0 flex-1 space-y-1 text-xs">
                          {(() => {
                            const keys: string[] = (Object.keys(CV_STAGE_LABELS) as Array<keyof typeof CV_STAGE_LABELS>).filter((k) => k !== 'queued');
                            const stages = keys.map((k) => CV_STAGE_LABELS[k as keyof typeof CV_STAGE_LABELS]);
                            const at = Math.max(0, cvJob ? keys.indexOf(cvJob.stage) : 0);
                            return stages.map((label, i) => (
                              <li key={label} className={`flex items-center gap-2 transition-colors ${i < at ? 'text-[#2BD67B]' : i === at ? 'font-bold text-[#FFD60A]' : 'text-white/35'}`}>
                                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${i < at ? 'bg-[#2BD67B]' : i === at ? 'animate-pulse bg-[#FFD60A]' : 'bg-white/20'}`} />
                                {label}
                              </li>
                            ));
                          })()}
                        </ol>
                      </div>
                      <div className={`${CARD} p-4 space-y-3`}>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-slate-200 truncate pr-3">{processingStageText}</span>
                          <span className="font-mono text-slate-300">{progressPercent}%</span>
                        </div>
                        <div
                          className="w-full h-2 bg-white/[0.06] rounded-full overflow-hidden"
                          role="progressbar"
                          aria-valuenow={progressPercent}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        >
                          <div className="h-full rounded-full bg-amber-400 transition-all duration-300 ease-out" style={{ width: `${progressPercent}%` }} />
                        </div>
                        <p className={`${HINT} truncate`}>{imageFileName}</p>
                      </div>
                      <button
                        type="button"
                        id="btn-skip-ai-analysis"
                        onClick={continueWithoutAi}
                        className="w-full py-2 px-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-medium transition-colors cursor-pointer"
                      >
                        Lewati, isi sendiri
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ========================================================================= */}
            {/* STEP 3: REVIEW & SUBMIT                                                    */}
            {/* ========================================================================= */}
            {currentState === 'ANALYSIS_RESULT' && (
              <div className="space-y-5 animate-in fade-in duration-200 flex-1 flex flex-col justify-between">
                <div className="space-y-5">
                  <SheetHeader
                    step={3}
                    title="Periksa laporan"
                    subtitle="Pastikan jenis dan lokasinya benar"
                    onBack={() => setCurrentState('INPUT')}
                    onClose={() => {
                      stopCameraStream();
                      onClose();
                    }}
                  />

                  {selectedImage && <AiPhotoScan src={selectedImage} analysis={cvAnalysis} />}

                  {/* Damage type */}
                  <div className="space-y-2">
                    <label htmlFor="damage-type-select" className={LABEL}>Jenis kerusakan</label>
                    <div className={`${CARD} p-3 space-y-2.5`}>
                      <div className="flex items-center gap-3">
                        <span className={ICON_TILE} aria-hidden="true">{damageChoice?.icon ?? '🕳'}</span>
                        <div className="min-w-0 flex-1">
                          <select
                            id="damage-type-select"
                            value={damageChoice?.damageType ?? 'POTHOLE'}
                            onChange={(e) => {
                              const picked = MANUAL_DAMAGE_CHOICES.find((c) => c.damageType === e.target.value);
                              if (picked) setDamageChoice(picked);
                            }}
                            className="w-full bg-[#111318] border border-white/10 rounded-xl px-3 py-2 text-sm text-white font-medium focus:border-amber-400 focus:outline-none cursor-pointer"
                          >
                            {MANUAL_DAMAGE_CHOICES.map((choice) => (
                              <option key={choice.damageType} value={choice.damageType}>
                                {choice.icon} {choice.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <p className={`${HINT} text-[11px]`}>
                        {cvAnalysis?.primary ? 'Dideteksi otomatis oleh model AI' : 'Konfirmasi jenis kerusakan sebelum dikirim'}
                      </p>
                    </div>
                  </div>

                  {/* Severity */}
                  <div className="space-y-2">
                    <p className={LABEL}>Tingkat keparahan</p>
                    <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Tingkat keparahan">
                      {([
                        ['LIGHT', 'Ringan'],
                        ['MODERATE', 'Sedang'],
                        ['CRITICAL', 'Parah']
                      ] as const).map(([value, label]) => {
                        const active = value === 'CRITICAL' ? effectiveSeverity === 'CRITICAL' || effectiveSeverity === 'SEVERE' : effectiveSeverity === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            onClick={() => setCustomSeverity(value)}
                            className={`h-11 rounded-2xl text-sm transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 ${
                              active ? 'bg-amber-400 text-slate-950 font-semibold' : 'border border-white/[0.08] bg-white/[0.03] text-slate-300 hover:bg-white/[0.06]'
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Location */}
                  <div className="space-y-2">
                    <p className={LABEL}>Lokasi</p>
                    <button type="button" onClick={handleViewOnMap} className={`${CARD} w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.06] transition-colors cursor-pointer`}>
                      <MapPin className="w-5 h-5 text-amber-400 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-white truncate">{mainRoadName}</span>
                        <span className={`${HINT} block truncate`}>
                          {locationName || `${coordinates[0].toFixed(4)}, ${coordinates[1].toFixed(4)}`}
                        </span>
                      </span>
                      <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                    </button>
                  </div>

                  {/* Notes */}
                  <div className="space-y-2">
                    <label htmlFor="report-notes-review" className="flex items-center justify-between">
                      <span className={LABEL}>Catatan</span>
                      <span className={HINT}>Opsional</span>
                    </label>
                    <textarea
                      id="report-notes-review"
                      rows={2}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Contoh: lubang besar, memengaruhi lajur kiri"
                      className={`${FIELD} resize-none`}
                    />
                  </div>
                </div>

                <div className="pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] space-y-3">
                  <button type="button" onClick={handleSubmitReport} disabled={isSubmitting} aria-busy={isSubmitting} className={PRIMARY}>
                    {isSubmitting ? 'Mengirim laporan…' : 'Kirim laporan'}
                  </button>
                  {submitError && (
                    <p role="alert" className={ERROR}>
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>Laporan belum tersimpan: {submitError}</span>
                    </p>
                  )}
                  <p className={`${HINT} text-center`}>Laporan diperiksa petugas sebelum ditindaklanjuti.</p>
                </div>
              </div>
            )}

            {/* ========================================================================= */}
            {/* STEP 4: SUBMITTED                                                          */}
            {/* ========================================================================= */}
            {currentState === 'SUCCESS' && (
              <div className="space-y-5 animate-in fade-in duration-200 flex-1 flex flex-col justify-between">
                <div className="space-y-5">
                  <div className="pt-2 text-center space-y-3">
                    <span className="w-12 h-12 rounded-full bg-amber-400 text-slate-950 flex items-center justify-center mx-auto">
                      <Check className="w-6 h-6 stroke-[2.5]" />
                    </span>
                    <div className="space-y-1">
                      <h3 className="text-lg font-semibold text-white">Laporan berhasil dikirim</h3>
                      <p className="text-sm text-slate-400">Terima kasih. Laporan Anda sudah ada di peta.</p>
                    </div>
                  </div>

                  <div className={`${CARD} divide-y divide-white/[0.06]`}>
                    <div className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className={HINT}>Kode laporan</p>
                        <p className="text-sm font-mono text-amber-300 truncate">{createdReportId}</p>
                      </div>
                      <button type="button" onClick={handleCopyReportId} className={TEXT_BUTTON}>
                        {copiedId ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                        <span>{copiedId ? 'Tersalin' : 'Salin'}</span>
                      </button>
                    </div>
                    <div className="px-4 py-3">
                      <p className={HINT}>Lokasi</p>
                      <p className="text-sm text-white truncate">{mainRoadName}</p>
                      <p className={`${HINT} font-mono`}>
                        {coordinates[0].toFixed(4)}, {coordinates[1].toFixed(4)}
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className={HINT}>Jenis</p>
                        <p className="text-sm text-white truncate">{damageChoice?.label ?? '-'}</p>
                      </div>
                      <span className="rounded-full border border-amber-400/40 px-3 py-1 text-xs text-amber-300 shrink-0">
                        {savedState === 'NEEDS_REVIEW' ? 'Menunggu peninjauan M.O' : savedState === 'VERIFIED' ? 'Diterima, menunggu penugasan M.O' : 'Terkirim'}
                      </span>
                    </div>
                  </div>

                  {savedState === 'NEEDS_REVIEW' && (
                    <p className={`${HINT} text-center`}>
                      Klasifikasi foto masih DEMO, jadi petugas memeriksa laporan ini sebelum ditindaklanjuti.
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
                  <button
                    type="button"
                    onClick={() => {
                      if (onFocusMapLocation) {
                        onFocusMapLocation(coordinates, 17, createdReportId);
                      }
                      handleReset();
                      onClose();
                    }}
                    className={SECONDARY}
                  >
                    Selesai
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (onFocusMapLocation) {
                        onFocusMapLocation(coordinates, 17, createdReportId);
                      }
                      handleReset();
                      onClose();
                    }}
                    className={PRIMARY}
                  >
                    Lihat di peta
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};
