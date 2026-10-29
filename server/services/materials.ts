import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../runtime/repoRoot";

export interface MaterialRecord {
  id: string;
  name: string;
  group: string;
  minThicknessCm: number | null;
}

const FILE = path.join(REPO_ROOT, "config", "materials.json");

/** SPEC M6.1 catalogue (config/materials.json), with its source and label. Read once. */
export const MATERIAL_CATALOGUE: { source: string; label: string; materials: MaterialRecord[] } = fs.existsSync(FILE)
  ? JSON.parse(fs.readFileSync(FILE, "utf8"))
  : { source: "", label: "ASUMSI", materials: [] };

export function materialById(id: string): MaterialRecord | undefined {
  return MATERIAL_CATALOGUE.materials.find((m) => m.id === id);
}
