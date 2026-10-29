/**
 * 3D Damage tab: the stored depth grid as a surface mesh / point cloud coloured by depth,
 * a draggable section plane and the A–A' profile (reference plane + shaded deficit).
 * Lazy-loaded so three.js only downloads when the tab opens.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Area, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useWsT } from '../i18n';
import { useWorkspace, type LayerKey } from '../WorkspaceContext';
import { ColorLegend, StatusBadge, turbo } from '../components/shared';
import { NoSequenceCard } from './OverviewTab';
import { deepestIndex, sectionProfile } from '../../../domain/workspace/section';
import type { SurfaceGrid } from '../../../domain/workspace/types';

const LAYERS: Array<[LayerKey, string]> = [
  ['mesh', 'Surface Mesh'],
  ['cloud', 'Point Cloud'],
  ['elevation', 'Elevation'],
  ['depth', 'Depth'],
  ['contour', 'Contour'],
  ['section', "Cross-section A–A'"]
];

function maxDepth(g: SurfaceGrid) {
  let m = 0;
  for (const row of g.depth) for (const d of row) if (d !== null && d > m) m = d;
  return m;
}

/** Vertical exaggeration so a 40 mm deep hole is visible on an 800 mm patch. */
const EXAGGERATION = 4;

function buildGeometry(g: SurfaceGrid, colorBy: 'depth' | 'elevation') {
  const geo = new THREE.BufferGeometry();
  const pos: number[] = [];
  const col: number[] = [];
  const dmax = maxDepth(g) || 1;
  const w = g.cols * g.cellSize;
  const h = g.rows * g.cellSize;
  const c = new THREE.Color();
  for (let r = 0; r < g.rows; r++) {
    for (let k = 0; k < g.cols; k++) {
      const d = g.depth[r][k];
      pos.push((k + 0.5) * g.cellSize - w / 2, -(d ?? 0) * EXAGGERATION, (r + 0.5) * g.cellSize - h / 2);
      const t = d === null ? 0 : colorBy === 'depth' ? Math.max(0, d) / dmax : 1 - (Math.max(0, d) / dmax);
      c.setStyle(d === null ? 'rgb(60,60,60)' : turbo(colorBy === 'depth' ? 0.15 + 0.85 * t : t));
      col.push(c.r, c.g, c.b);
    }
  }
  const idx: number[] = [];
  for (let r = 0; r < g.rows - 1; r++) {
    for (let k = 0; k < g.cols - 1; k++) {
      const a = r * g.cols + k;
      if ([a, a + 1, a + g.cols, a + g.cols + 1].some((i) => g.depth[Math.floor(i / g.cols)][i % g.cols] === null)) continue;
      idx.push(a, a + g.cols, a + 1, a + 1, a + g.cols, a + g.cols + 1);
    }
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

const Controls: React.FC<{ resetKey: number }> = ({ resetKey }) => {
  const { camera, gl } = useThree();
  const ref = useRef<OrbitControls | null>(null);
  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement);
    c.enableDamping = true;
    ref.current = c;
    let raf = 0;
    const loop = () => {
      c.update();
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      c.dispose();
    };
  }, [camera, gl]);
  useEffect(() => {
    camera.position.set(520, 420, 620);
    camera.lookAt(0, 0, 0);
    ref.current?.target.set(0, 0, 0);
  }, [resetKey, camera]);
  return null;
};

const Scene: React.FC<{ g: SurfaceGrid; sectionRow: number; resetKey: number }> = ({ g, sectionRow, resetKey }) => {
  const { layers } = useWorkspace();
  const colorBy = layers.elevation && !layers.depth ? 'elevation' : 'depth';
  const geo = useMemo(() => buildGeometry(g, colorBy), [g, colorBy]);
  const w = g.cols * g.cellSize;
  const h = g.rows * g.cellSize;
  const contour = useMemo(() => {
    const pts = g.contour.map(([x, y]) => new THREE.Vector3(x - w / 2, 0.5, y - h / 2));
    if (pts.length) pts.push(pts[0].clone());
    return new THREE.BufferGeometry().setFromPoints(pts);
  }, [g, w, h]);
  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[300, 600, 200]} intensity={0.8} />
      {layers.mesh && (
        <mesh geometry={geo}>
          <meshStandardMaterial vertexColors side={THREE.DoubleSide} />
        </mesh>
      )}
      {layers.cloud && (
        <points geometry={geo}>
          <pointsMaterial vertexColors size={3} sizeAttenuation={false} />
        </points>
      )}
      {layers.contour && (
        <lineLoop geometry={contour}>
          <lineBasicMaterial color="#FFD60A" />
        </lineLoop>
      )}
      {layers.section && (
        <mesh position={[0, -40, (sectionRow + 0.5) * g.cellSize - h / 2]}>
          <planeGeometry args={[w, 260]} />
          <meshBasicMaterial color="#38BDF8" transparent opacity={0.18} side={THREE.DoubleSide} />
        </mesh>
      )}
      <gridHelper args={[Math.max(w, h), 8, '#2A3646', '#1A2430']} position={[0, 1, 0]} />
      <Controls resetKey={resetKey} />
    </>
  );
};

const DamageTab: React.FC = () => {
  const t = useWsT();
  const { workspace: w, activeObject: o, layers, toggleLayer, sectionIndex, setSection } = useWorkspace();
  const [resetKey, setResetKey] = React.useState(0);
  const surface = w?.surfaces.find((s) => s.objectId === o?.objectId) ?? null;
  // Camera re-centres whenever the active object changes (the "fly to object" of spec/02).
  useEffect(() => setResetKey((k) => k + 1), [o?.objectId]);
  if (!w || !o) return null;
  if (!surface) return <NoSequenceCard reason={`${o.objectId}: ${t('no3d')}. ${o.measurements.depthMaxMm.reasonUnavailable ?? ''}`} />;

  const metric = surface.unit === 'mm' && o.quality.scaleStatus === 'valid';
  const row = sectionIndex ?? deepestIndex(surface)?.row ?? 0;
  const profile = sectionProfile(surface, 'x', row);
  const dmax = maxDepth(surface);
  const data = profile ? profile.positions.map((x, i) => ({ x: Math.round(x), z: profile.depth[i] === null ? null : -(profile.depth[i] as number), ref: 0 })) : [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {LAYERS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => (k === 'depth' || k === 'elevation' ? toggleLayer(k, ['depth', 'elevation']) : toggleLayer(k))} className={`rounded-md px-2.5 py-1 text-[12px] ${layers[k] ? 'bg-[#1D4573] text-white' : 'bg-[#16202C] text-[#C9D4E3]'}`}>
            {label}
          </button>
        ))}
        <button type="button" onClick={() => setResetKey((x) => x + 1)} className="rounded-md bg-[#16202C] px-2.5 py-1 text-[12px] text-[#C9D4E3]">⟲ {t('resetCamera')}</button>
        {surface.synthetic && <StatusBadge tone="violet">DATA CONTOH · kontur dari deteksi, kedalaman sintetis</StatusBadge>}
      </div>
      {!metric && <div className="rounded-lg border border-[#5C4512] bg-[#3A2C0B] px-3 py-2 text-[12px] text-[#F5C451]" data-testid="relative-banner">{t('relativeGeometry')}</div>}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div>
          <div className="h-[360px] w-full overflow-hidden rounded-xl bg-[#0B121A]" data-testid="viewer-3d">
            <Canvas gl={{ preserveDrawingBuffer: true }} camera={{ fov: 40, near: 1, far: 5000, position: [520, 420, 620] }}>
              <Scene g={surface} sectionRow={row} resetKey={resetKey} />
            </Canvas>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <ColorLegend unit={metric ? 'mm' : 'relatif'} min={0} max={Math.round(dmax * 10) / 10} scale="turbo" label={t('legendDepth')} />
            <span className="text-[11px] text-[#6B7A90]">Skala vertikal ×{EXAGGERATION}</span>
          </div>
        </div>
        <div>
          <div className="mb-1 text-[12px] text-[#C9D4E3]">{t('sectionTitle')} melalui {o.objectId}</div>
          <div className="h-56" data-testid="section-chart">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -6 }}>
                <XAxis dataKey="x" tick={{ fill: '#8B9BB0', fontSize: 10 }} label={{ value: metric ? 'posisi (mm)' : 'posisi (relatif)', fill: '#8B9BB0', fontSize: 10, position: 'insideBottom', offset: -2 }} />
                <YAxis tick={{ fill: '#8B9BB0', fontSize: 10 }} unit={metric ? '' : ''} />
                <Tooltip contentStyle={{ background: '#0B121A', border: '1px solid #273244', fontSize: 12 }} />
                <ReferenceLine y={0} stroke="#6EE7A8" strokeDasharray="5 4" />
                <Area dataKey="z" stroke="#38BDF8" fill="#7C2D12" fillOpacity={0.7} isAnimationActive={false} connectNulls={false} />
                <Line dataKey="ref" stroke="transparent" dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <label className="mt-2 block text-[11px] text-[#9AA8BC]">
            Geser bidang potong (baris {row + 1}/{surface.rows})
            <input type="range" min={0} max={surface.rows - 1} value={row} onChange={(e) => setSection('x', Number(e.target.value))} className="w-full accent-[#FFD60A]" data-testid="section-slider" />
          </label>
          <p className="mt-1 text-[11px] text-[#8B9BB0]">Garis hijau: bidang referensi RANSAC (d = 0). Area berarsir: defisit di bawah bidang. {metric ? 'Satuan mm.' : 'Tanpa skala metrik.'}</p>
        </div>
      </div>
    </div>
  );
};

export default DamageTab;
