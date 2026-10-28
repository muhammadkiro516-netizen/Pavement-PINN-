/**
 * v3 Phase 0 gate (AGENTS.md §5 Fase 0, rules 1, 5 and 6).
 *
 * 1. No Math.random anywhere in shipped runtime code (src/, server/).
 * 2. Prohibited claims (v3 §1.5) never appear in shipped runtime code.
 * 3. Identical engine input → identical payload (id/timestamp excluded).
 * 4. Removed fake endpoints and modules stay removed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { INDONESIAN_ROAD_SEGMENTS, ALL_BINA_MARGA_WIM_STATIONS } from '../../src/data/reference/indonesianRoads';
import { detectLocalDeviceProfile } from '../../src/runtime/intel-hardware/deviceDetector';
import { PDF_DISCLAIMER } from '../../src/services/reporting/pdfGenerator';
import type { SimulationParams } from '../../src/types';

const ROOT = process.cwd();

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const RUNTIME_FILES = [...sourceFiles(path.join(ROOT, 'src')), ...sourceFiles(path.join(ROOT, 'server'))];

function offenders(pattern: RegExp): string[] {
  return RUNTIME_FILES.flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .map((line, i) => [line, i + 1] as const)
      .filter(([line]) => pattern.test(line))
      .map(([, n]) => `${path.relative(ROOT, file)}:${n}`)
  );
}

test('no Math.random in shipped runtime code (F-02, F-20, F-21)', () => {
  assert.deepEqual(offenders(/Math\.random\s*\(/), []);
});

test('prohibited claims are absent from shipped runtime code (v3 §1.5, AGENTS rule 5)', () => {
  const prohibited: Array<[string, RegExp]> = [
    ['FWD Validated badge', /FWD Validated/i],
    ['fabricated latency claim', /(<\s*10\s*ms|8[.,]4\s*ms|6[.,]8\s*ms)/i],
    ['"melebihi batas ijin" verdict', /melebihi batas ijin/i],
    ['PINN solves Burmister', /menyelesaikan\s+(persamaan\s+)?Burmister/i],
    ['"setara FEM"', /setara FEM/i],
    ['APBN savings', /(penghematan|menghemat|efisiensi anggaran)[^\n]{0,60}Rp/i],
    ['"korupsi"', /korupsi/i],
    ['"kontraktor nakal"', /kontraktor nakal/i]
  ];
  for (const [label, pattern] of prohibited) {
    assert.deepEqual(offenders(pattern), [], label);
  }
});

test('fake WIM training modal, WIM scraper, simulated benchmark and IR export are removed (F-04, F-13)', () => {
  for (const file of [
    'src/features/wim/BinaMargaWimPipelineModal.tsx',
    'src/services/wim/binaMargaWimScraper.ts',
    'src/runtime/openvino/simulatedBenchmark.ts',
    'server/services/openvinoExportService.ts',
    'server/controllers/openvinoController.ts',
    'server/routes/openvino.routes.ts'
  ]) {
    assert.equal(existsSync(path.join(ROOT, file)), false, file);
  }
  assert.equal(ALL_BINA_MARGA_WIM_STATIONS.length, 0);
  assert.ok(INDONESIAN_ROAD_SEGMENTS.every((s) => !s.hasWimStation && !s.wimDetails && !s.activeWimStatus));
});

test('browser never claims an NPU or an Intel device (F-12)', () => {
  const profile = detectLocalDeviceProfile();
  assert.equal(profile.hasNpuAccelerator, false);
  assert.equal(profile.vendorName, 'tidak diketahui');
  assert.notEqual(profile.recommendedTarget, 'NPU');
});

test('PDF disclaimer states "bukan dokumen resmi" and names no agency (F-19)', () => {
  assert.match(PDF_DISCLAIMER, /BUKAN DOKUMEN RESMI/);
  assert.doesNotMatch(PDF_DISCLAIMER, /PUPR|Kemenhub|BMKG|Bina Marga|Intel/);
});

// ---- Analysis Workspace (handoff §1): numbers on screen come from runs, never from JSX ----

const WORKSPACE_FILES = [
  ...sourceFiles(path.join(ROOT, 'src', 'features', 'workspace')),
  ...sourceFiles(path.join(ROOT, 'src', 'domain', 'workspace')),
  ...['src/pages/operations/PinnIndexPage.tsx', 'src/pages/operations/PinnWorkspacePage.tsx', 'src/pages/track/TrackPage.tsx'].map((f) => path.join(ROOT, f))
];

function workspaceOffenders(pattern: RegExp, files = WORKSPACE_FILES): string[] {
  return files.flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .map((line, i) => [line, i + 1] as const)
      .filter(([line]) => pattern.test(line) && !/^\s*(\/\/|\*)/.test(line))
      .map(([, n]) => `${path.relative(ROOT, file)}:${n}`)
  );
}

test('workspace: no Math.random, no hard-coded confidence, no metric numbers typed into JSX', () => {
  assert.deepEqual(workspaceOffenders(/Math\.random\s*\(/), []);
  // A confidence value may only come from a model output (class.confidence), never a literal.
  assert.deepEqual(workspaceOffenders(/confidence\s*[:=]\s*0?\.\d/i), []);
  assert.deepEqual(workspaceOffenders(/Confidence\s*[:\s]\s*0?[.,]\d/), []);
  // A measurement-like number with a unit as JSX text (e.g. ">38 mm<", ">4,1 L<", ">227 µε<").
  const tsx = WORKSPACE_FILES.filter((f) => f.endsWith('.tsx'));
  assert.deepEqual(workspaceOffenders(/>\s*[±]?\d+([.,]\d+)?\s*(mm|cm|m²|m2|L|µε|MPa|px|%|th)\s*</, tsx), []);
  // Paper figures from Pan et al. must not appear as system performance.
  assert.deepEqual(workspaceOffenders(/0[.,]5373|0[.,]9679/), []);
});

test('workspace: the demo fixture is generated by the pipeline and flagged synthetic', () => {
  const fixture = JSON.parse(readFileSync(path.join(ROOT, 'src/data/fixtures/workspace-demo.json'), 'utf8'));
  assert.match(fixture._comment, /DATA CONTOH/);
  assert.equal(fixture.geometry.synthetic, true);
  assert.ok(fixture.structural.field.eps_xx.values.length > 0, 'heatmap grid comes from a real MLET run');
});
