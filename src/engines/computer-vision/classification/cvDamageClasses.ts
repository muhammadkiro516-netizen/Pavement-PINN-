import { DamageType, ReportSeverity } from '../../../types';

export interface CVDamageClassInfo {
  modelClass: string;
  damageType: DamageType;
  label: string;
  icon: string;
  characteristics: string[];
  defaultSeverity: ReportSeverity;
  severityLabel: string;
  severityLevel: number; // 1 to 5 dots
  defaultConfidence: number;
  samplePhotoUrl: string;
  defaultDepthCm: number;
  defaultAreaM2: number;
  detectionBox: {
    xPercent: number;
    yPercent: number;
    widthPercent: number;
    heightPercent: number;
  };
}

export const CV_DAMAGE_CLASSES: Record<string, CVDamageClassInfo> = {
  pothole: {
    modelClass: 'pothole',
    damageType: 'POTHOLE',
    label: 'Pothole',
    icon: '🕳',
    characteristics: [
      'Localized surface hole',
      'Surface material loss',
      'Possible impact to vehicles'
    ],
    defaultSeverity: 'MODERATE',
    severityLabel: 'Moderate',
    severityLevel: 3,
    defaultConfidence: 94,
    samplePhotoUrl: 'https://images.unsplash.com/photo-1515162816999-a0c47dc192f7?auto=format&fit=crop&q=80&w=800',
    defaultDepthCm: 12,
    defaultAreaM2: 3.8,
    detectionBox: {
      xPercent: 28,
      yPercent: 32,
      widthPercent: 44,
      heightPercent: 36
    }
  },
  alligator_cracking: {
    modelClass: 'alligator_cracking',
    damageType: 'ALLIGATOR_CRACK',
    label: 'Alligator Cracking',
    icon: '🐊',
    characteristics: [
      'Interconnected cracking',
      'Network-like pattern',
      'Surface deterioration'
    ],
    defaultSeverity: 'SEVERE',
    severityLabel: 'High',
    severityLevel: 4,
    defaultConfidence: 91,
    samplePhotoUrl: 'https://images.unsplash.com/photo-1517649763962-0c623266ddc0?auto=format&fit=crop&q=80&w=800',
    defaultDepthCm: 6,
    defaultAreaM2: 5.2,
    detectionBox: {
      xPercent: 22,
      yPercent: 25,
      widthPercent: 56,
      heightPercent: 50
    }
  },
  crack: {
    modelClass: 'crack',
    damageType: 'CRACK',
    label: 'Surface Crack',
    icon: '〰',
    characteristics: [
      'Linear surface cracking',
      'Localized deterioration'
    ],
    defaultSeverity: 'LIGHT',
    severityLabel: 'Low',
    severityLevel: 2,
    defaultConfidence: 89,
    samplePhotoUrl: 'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?auto=format&fit=crop&q=80&w=800',
    defaultDepthCm: 3,
    defaultAreaM2: 2.1,
    detectionBox: {
      xPercent: 30,
      yPercent: 20,
      widthPercent: 40,
      heightPercent: 60
    }
  },
  rutting: {
    modelClass: 'rutting',
    damageType: 'RUTTING',
    label: 'Rutting',
    icon: '🛞',
    characteristics: [
      'Wheel-path deformation',
      'Surface profile change'
    ],
    defaultSeverity: 'SEVERE',
    severityLabel: 'High',
    severityLevel: 4,
    defaultConfidence: 93,
    samplePhotoUrl: 'https://images.unsplash.com/photo-1584467735871-8e85353a8413?auto=format&fit=crop&q=80&w=800',
    defaultDepthCm: 10,
    defaultAreaM2: 8.4,
    detectionBox: {
      xPercent: 18,
      yPercent: 35,
      widthPercent: 64,
      heightPercent: 35
    }
  },
  surface_damage: {
    modelClass: 'surface_damage',
    damageType: 'SURFACE_DAMAGE',
    label: 'Surface Damage',
    icon: '▧',
    characteristics: [
      'Surface deterioration',
      'Loss of surface quality'
    ],
    defaultSeverity: 'MODERATE',
    severityLabel: 'Moderate',
    severityLevel: 3,
    defaultConfidence: 87,
    samplePhotoUrl: 'https://images.unsplash.com/photo-1578916171728-46686eac8d58?auto=format&fit=crop&q=80&w=800',
    defaultDepthCm: 5,
    defaultAreaM2: 4.0,
    detectionBox: {
      xPercent: 25,
      yPercent: 30,
      widthPercent: 50,
      heightPercent: 40
    }
  },
  road_deformation: {
    modelClass: 'road_deformation',
    damageType: 'ROAD_DEFORMATION',
    label: 'Road Deformation',
    icon: '≋',
    characteristics: [
      'Road profile deformation',
      'Uneven surface'
    ],
    defaultSeverity: 'SEVERE',
    severityLabel: 'High',
    severityLevel: 4,
    defaultConfidence: 90,
    samplePhotoUrl: 'https://images.unsplash.com/photo-1617886322168-72b886573c35?auto=format&fit=crop&q=80&w=800',
    defaultDepthCm: 8,
    defaultAreaM2: 6.5,
    detectionBox: {
      xPercent: 20,
      yPercent: 28,
      widthPercent: 60,
      heightPercent: 44
    }
  },
  depression: {
    modelClass: 'depression',
    damageType: 'DEPRESSION',
    label: 'Depression',
    icon: '↓',
    characteristics: [
      'Localized surface depression',
      'Lowered road surface'
    ],
    defaultSeverity: 'MODERATE',
    severityLabel: 'Moderate',
    severityLevel: 3,
    defaultConfidence: 88,
    samplePhotoUrl: 'https://images.unsplash.com/photo-1605283176568-9b41fde3672e?auto=format&fit=crop&q=80&w=800',
    defaultDepthCm: 7,
    defaultAreaM2: 3.5,
    detectionBox: {
      xPercent: 32,
      yPercent: 35,
      widthPercent: 36,
      heightPercent: 30
    }
  },
  patching: {
    modelClass: 'patching',
    damageType: 'PATCHING',
    label: 'Patching',
    icon: '▦',
    characteristics: [
      'Previously repaired area',
      'Visible patching treatment'
    ],
    defaultSeverity: 'LIGHT',
    severityLabel: 'Low',
    severityLevel: 1,
    defaultConfidence: 95,
    samplePhotoUrl: 'https://images.unsplash.com/photo-1541888946425-d0fbb18086f6?auto=format&fit=crop&q=80&w=800',
    defaultDepthCm: 2,
    defaultAreaM2: 2.8,
    detectionBox: {
      xPercent: 24,
      yPercent: 26,
      widthPercent: 52,
      heightPercent: 48
    }
  },
  corrugation: {
    modelClass: 'corrugation',
    damageType: 'CORRUGATION',
    label: 'Corrugation',
    icon: '≈',
    characteristics: [
      'Regular transverse ripples',
      'Washboard surface'
    ],
    defaultSeverity: 'MODERATE',
    severityLabel: 'Medium',
    severityLevel: 3,
    defaultConfidence: 0,
    samplePhotoUrl: '',
    defaultDepthCm: 2,
    defaultAreaM2: 4,
    detectionBox: { xPercent: 20, yPercent: 30, widthPercent: 60, heightPercent: 45 }
  },
  subsidence: {
    modelClass: 'subsidence',
    damageType: 'SUBSIDENCE',
    label: 'Subsidence',
    icon: '⤓',
    characteristics: [
      'Road section has sunk or collapsed',
      'Possible base or drainage failure'
    ],
    defaultSeverity: 'SEVERE',
    severityLabel: 'High',
    severityLevel: 4,
    defaultConfidence: 0,
    samplePhotoUrl: '',
    defaultDepthCm: 10,
    defaultAreaM2: 6,
    detectionBox: { xPercent: 20, yPercent: 30, widthPercent: 60, heightPercent: 45 }
  },
  flooding: {
    modelClass: 'flooding',
    damageType: 'FLOODING',
    label: 'Flooding / Standing Water',
    icon: '≋',
    characteristics: [
      'Standing water covers the carriageway',
      'Hides potholes and edges; hazard for riders'
    ],
    defaultSeverity: 'SEVERE',
    severityLabel: 'High',
    severityLevel: 4,
    defaultConfidence: 0,
    samplePhotoUrl: '',
    defaultDepthCm: 0,
    defaultAreaM2: 10,
    detectionBox: { xPercent: 20, yPercent: 30, widthPercent: 60, heightPercent: 45 }
  }
};

/**
 * Rapid classifier helper that evaluates image hints, filenames, or random selection
 */
export function analyzeImageDamageClass(imageSource?: string): CVDamageClassInfo {
  if (!imageSource) return CV_DAMAGE_CLASSES.pothole;

  const lower = imageSource.toLowerCase();
  if (lower.includes('alligator') || lower.includes('retak') || lower.includes('517649763962')) {
    return CV_DAMAGE_CLASSES.alligator_cracking;
  }
  if (lower.includes('rutting') || lower.includes('alur') || lower.includes('584467735871')) {
    return CV_DAMAGE_CLASSES.rutting;
  }
  if (lower.includes('crack') || lower.includes('544620347')) {
    return CV_DAMAGE_CLASSES.crack;
  }
  if (lower.includes('patch') || lower.includes('541888946425')) {
    return CV_DAMAGE_CLASSES.patching;
  }
  if (lower.includes('deformation') || lower.includes('gelombang') || lower.includes('617886322168')) {
    return CV_DAMAGE_CLASSES.road_deformation;
  }
  if (lower.includes('depression') || lower.includes('ambles') || lower.includes('605283176568')) {
    return CV_DAMAGE_CLASSES.depression;
  }
  if (lower.includes('surface') || lower.includes('578916171728')) {
    return CV_DAMAGE_CLASSES.surface_damage;
  }

  // Default to pothole
  return CV_DAMAGE_CLASSES.pothole;
}
