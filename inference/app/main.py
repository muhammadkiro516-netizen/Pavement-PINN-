"""PAVEMENT-PINN inference service (Dokumen Induk v3 D-23, milestone M1).

Run from the inference/ folder:  .venv/Scripts/python -m uvicorn app.main:app --port 8100
Express reaches it through INFERENCE_URL (default http://127.0.0.1:8100).

/v1/assess: MLET reference strains (PyMastic) for the given structure, plus (M2) a Monte Carlo
life index P10/P50/P90 for dry and wet subgrade, evaluated with the PI-surrogate on OpenVINO.
"""
from __future__ import annotations

import platform
import sys
import time
from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .mlet import METHOD, STANDARD_AXLE_TON, allowable_reps, life_index_years, mlet_field_grid, mlet_strains
from .surrogate import load_surrogate, life_monte_carlo

ENGINE_VERSION = "mlet-1.1.0"

app = FastAPI(title="PAVEMENT-PINN inference", version=ENGINE_VERSION)


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Layer(Strict):
    h_mm: float = Field(ge=20, le=600)
    E_mpa: float = Field(ge=50, le=30000)
    nu: float = Field(ge=0.15, le=0.5)
    source: str = "ASSUMED"


class Subgrade(Strict):
    cbr: float = Field(ge=1, le=50)
    state: Literal["dry", "wet"] = "dry"
    soaked_factor: float = Field(default=0.5, gt=0, le=1)
    nu: float = Field(default=0.45, ge=0.15, le=0.5)
    E_mpa: float | None = Field(default=None, ge=10, le=500)


class Load(Strict):
    # Light vehicles (motorcycle, car) are allowed: 0.05 t axle, 0.1 MPa, one tyre per axle.
    axle_t: float = Field(default=STANDARD_AXLE_TON, ge=0.05, le=30)
    q_mpa: float = Field(default=0.55, ge=0.1, le=1.5)
    tyres_per_axle: Literal[1, 2, 4] = 4
    dual_spacing_mm: float | None = Field(default=330, ge=150, le=600)


class Traffic(Strict):
    esal_day_p10: float = Field(gt=0, le=1e6)
    esal_day_p50: float = Field(gt=0, le=1e6)
    esal_day_p90: float = Field(gt=0, le=1e6)
    growth: float = Field(default=0.04, ge=0, le=0.15)
    direction_factor: float = Field(default=0.5, gt=0, le=1)
    lane_factor: float = Field(default=1.0, gt=0, le=1)

    @model_validator(mode="after")
    def ordered(self):
        if not (self.esal_day_p10 <= self.esal_day_p50 <= self.esal_day_p90):
            raise ValueError("esal_day must satisfy p10 <= p50 <= p90")
        return self


class AssessRequest(Strict):
    segment_id: str = Field(min_length=1, max_length=64)
    layers: list[Layer] = Field(min_length=1, max_length=3)
    subgrade: Subgrade
    load: Load = Load()
    traffic: Traffic | None = None
    criterion: Literal["AI", "AUS"] = "AI"
    damage_used: float = Field(default=0.0, ge=0, lt=1)
    n_mc: int = Field(default=2000, ge=0, le=20000)
    seed: int | None = None
    # Workspace (handoff U5 / F-29): object the run belongs to, and whether to return the
    # εxx/εzz/σzz field on the plane through the wheels for the heatmap.
    object_id: str | None = Field(default=None, max_length=64)
    field_grid: bool = False

    @model_validator(mode="after")
    def asphalt_thickness(self):
        if not 25 <= self.layers[0].h_mm <= 400:
            raise ValueError("asphalt layer h_mm must be between 25 and 400")
        return self


def device_info() -> dict:
    return {"kind": "CPU", "processor": platform.processor() or platform.machine(), "platform": platform.platform()}


def openvino_devices() -> tuple[str | None, list[dict]]:
    try:
        import openvino as ov
    except ImportError:
        return None, []
    core = ov.Core()
    return ov.__version__, [{"id": d, "name": core.get_property(d, "FULL_DEVICE_NAME")} for d in core.available_devices]


def surrogate_info(s) -> dict | None:
    if s is None:
        return None
    return {"version": s.metrics["version"], "precision": s.precision, "device": s.device,
            "openvino_version": s.openvino_version, "test_errors": s.metrics["random_split"]}


@app.get("/v1/health")
def health() -> dict:
    ov_version, devices = openvino_devices()
    s = load_surrogate()
    return {
        "status": "ok",
        "engine_version": ENGINE_VERSION,
        "python": sys.version.split()[0],
        "mlet_method": METHOD,
        "openvino_version": ov_version,
        "available_devices": devices,
        "models_loaded": [] if s is None else [surrogate_info(s)],
        "device": device_info(),
    }


@app.post("/v1/assess")
def assess(req: AssessRequest) -> dict:
    assumptions: list[str] = []
    sg = req.subgrade
    cbr = sg.cbr * sg.soaked_factor if sg.state == "wet" else sg.cbr
    if sg.state == "wet":
        assumptions.append(f"Wet subgrade: CBR x {sg.soaked_factor} (soaked factor ASSUMED unless a soaked CBR test is entered).")
    if sg.E_mpa is not None:
        e_sub = sg.E_mpa
    else:
        e_sub = 10.0 * cbr
        assumptions.append("Subgrade modulus E = 10 x CBR MPa (Heukelom & Klomp), ASSUMED.")
    assumptions += [f"Layer {i + 1} ({layer.h_mm:g} mm) source: {layer.source}" for i, layer in enumerate(req.layers) if layer.source == "ASSUMED"]

    started = time.perf_counter()
    try:
        strains = mlet_strains(req.load.axle_t, [l.h_mm for l in req.layers], [l.E_mpa for l in req.layers] + [e_sub],
                               [l.nu for l in req.layers] + [sg.nu], q_mpa=req.load.q_mpa,
                               tyres_per_axle=req.load.tyres_per_axle, dual_spacing_mm=req.load.dual_spacing_mm)
    except (ArithmeticError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"MLET could not solve this structure: {exc}") from exc
    mlet_ms = (time.perf_counter() - started) * 1000

    nf, nd = map(float, allowable_reps(strains["et_ue"], strains["ev_ue"], req.layers[0].E_mpa, req.criterion))
    n_allow = min(nf, nd)
    life = None
    if req.traffic is not None:
        t = req.traffic
        per_year = lambda esal_day: esal_day * 365 * t.direction_factor * t.lane_factor
        # Heavier traffic gives a shorter life: P10 of life comes from P90 of traffic.
        life = {
            "p10": life_index_years(n_allow, per_year(t.esal_day_p90), t.growth, req.damage_used),
            "p50": life_index_years(n_allow, per_year(t.esal_day_p50), t.growth, req.damage_used),
            "p90": life_index_years(n_allow, per_year(t.esal_day_p10), t.growth, req.damage_used),
            "uncertainty": "TRAFFIC_ONLY",
            "label": "indikatif, bukan desain",
        }
        if req.damage_used == 0:
            assumptions.append("Damage already used = 0 (construction year unknown), ASSUMED.")
    monte_carlo = run_monte_carlo(req, sg, assumptions)
    field = None
    if req.field_grid:
        field = mlet_field_grid(req.load.axle_t, [l.h_mm for l in req.layers], [l.E_mpa for l in req.layers] + [e_sub],
                                [l.nu for l in req.layers] + [sg.nu], q_mpa=req.load.q_mpa,
                                tyres_per_axle=req.load.tyres_per_axle, dual_spacing_mm=req.load.dual_spacing_mm)

    return {
        "segment_id": req.segment_id,
        "object_id": req.object_id,
        "field": field,
        "mlet": {**strains, "method": METHOD, "elapsed_ms": round(mlet_ms, 2)},
        "subgrade_E_mpa": e_sub,
        "allowable": {"criterion": req.criterion, "nf": nf, "nd": nd, "governing": "fatigue" if nf <= nd else "rutting"},
        "life_years": life,
        "damage_used": req.damage_used,
        "monte_carlo": monte_carlo,
        "surrogate": surrogate_info(load_surrogate()) if monte_carlo and monte_carlo.get("dry") else None,
        "assumptions": assumptions,
        "status_label": "COMPUTED",
        "engine_version": ENGINE_VERSION,
        "device": device_info(),
    }


def run_monte_carlo(req: AssessRequest, sg: Subgrade, assumptions: list[str]) -> dict | None:
    """Dry and wet Monte Carlo with the PI-surrogate, or a stated reason why not."""
    if req.n_mc == 0:
        return None
    if req.traffic is None:
        return {"status": "NO_TRAFFIC", "message": "Monte Carlo needs the traffic range (ESAL/day P10-P90)."}
    if len(req.layers) != 2 or req.load.dual_spacing_mm is None or req.load.tyres_per_axle != 4             or [l.nu for l in req.layers] + [sg.nu] != [0.35, 0.35, 0.45] or sg.E_mpa is not None:
        return {"status": "OUTSIDE_SURROGATE_SCOPE",
                "message": "The surrogate covers 2 bound layers on a CBR subgrade, dual tyres, nu 0.35/0.35/0.45."}
    s = load_surrogate()
    if s is None:
        return {"status": "MODEL_UNAVAILABLE", "message": "No trained surrogate in models/."}
    t = req.traffic
    per_year = tuple(e * 365 * t.direction_factor * t.lane_factor for e in (t.esal_day_p10, t.esal_day_p50, t.esal_day_p90))
    common = dict(segment_id=req.segment_id, seed=req.seed, n=req.n_mc, h1=req.layers[0].h_mm, h2=req.layers[1].h_mm,
                  E1=req.layers[0].E_mpa, E2=req.layers[1].E_mpa, cbr=sg.cbr, soaked_factor=sg.soaked_factor,
                  axle_t=req.load.axle_t, q=req.load.q_mpa, d=req.load.dual_spacing_mm, esal_year=per_year,
                  growth=t.growth, damage_used=req.damage_used, criterion=req.criterion)
    started = time.perf_counter()
    dry = life_monte_carlo(s, wet=False, **common)
    wet = life_monte_carlo(s, wet=True, **common)
    assumptions.append("Monte Carlo spreads (ASSUMED): h1 sd 10 mm, h2 sd 20 mm, E1 CV 25 %, E2 CV 30 %, CBR CV 35 %, ESAL triangular P10-P90.")
    return {"status": "COMPUTED" if dry["status"] == wet["status"] == "COMPUTED" else "PARTIAL",
            "dry": dry, "wet": wet, "elapsed_ms": round((time.perf_counter() - started) * 1000, 1),
            "label": "indikatif, bukan desain"}


# ---------------------------------------------------------------- Computer Vision (road damage)
from fastapi import Request  # noqa: E402
from starlette.concurrency import run_in_threadpool  # noqa: E402

from .cv import engine as cv_engine, jobs as cv_jobs, video as cv_video  # noqa: E402

CV_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}


def _cv_error(exc: "cv_engine.CvError") -> HTTPException:
    status = {"INVALID_IMAGE": 422, "INVALID_VIDEO": 422, "IMAGE_UNUSABLE": 422, "BUSY": 429}.get(exc.code, 503)
    return HTTPException(status_code=status, detail={"code": exc.code, "message": exc.message})


@app.get("/v1/cv/health")
def cv_health() -> dict:
    return cv_engine.runtime_info()


@app.post("/v1/cv/analyze-image")
async def cv_analyze_image(request: Request) -> dict:
    """Synchronous analysis of raw image bytes (Content-Type image/jpeg|png|webp)."""
    if request.headers.get("content-type", "").split(";")[0] not in CV_IMAGE_TYPES:
        raise HTTPException(status_code=415, detail={"code": "UNSUPPORTED_TYPE", "message": "Send JPEG, PNG or WebP bytes."})
    data = await request.body()
    try:
        return await run_in_threadpool(cv_engine.analyze_image, data)
    except cv_engine.CvError as exc:
        raise _cv_error(exc) from exc


LIVE_MAX_BYTES = 300_000


@app.post("/v1/cv/live")
async def cv_live(request: Request) -> dict:
    """Camera preview frame (JPEG <= 300 KB): detector + scene only, never queued (429 BUSY)."""
    if request.headers.get("content-type", "").split(";")[0] != "image/jpeg":
        raise HTTPException(status_code=415, detail={"code": "UNSUPPORTED_TYPE", "message": "Send a JPEG frame."})
    data = await request.body()
    if len(data) > LIVE_MAX_BYTES:
        raise HTTPException(status_code=413, detail={"code": "TOO_LARGE", "message": "Live frames must be at most 300 KB."})
    try:
        return await run_in_threadpool(cv_engine.analyze_live, data)
    except cv_engine.CvError as exc:
        raise _cv_error(exc) from exc


@app.post("/v1/cv/jobs", status_code=202)
async def cv_submit_job(request: Request) -> dict:
    if request.headers.get("content-type", "").split(";")[0] not in CV_IMAGE_TYPES:
        raise HTTPException(status_code=415, detail={"code": "UNSUPPORTED_TYPE", "message": "Send JPEG, PNG or WebP bytes."})
    data = await request.body()
    try:
        cv_engine.decode_image(data)  # reject bad input before queueing
    except cv_engine.CvError as exc:
        raise _cv_error(exc) from exc
    return cv_jobs.submit(data)


@app.get("/v1/cv/jobs/{job_id}")
def cv_get_job(job_id: str) -> dict:
    job = cv_jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Unknown CV job."})
    return job


@app.post("/v1/cv/analyze-video")
async def cv_analyze_video(request: Request, fps: float = 1.0) -> dict:
    if not 0.1 <= fps <= 10:
        raise HTTPException(status_code=422, detail={"code": "VALIDATION", "message": "fps must be between 0.1 and 10."})
    try:
        return cv_video.analyze_video(await request.body(), fps=fps)
    except cv_engine.CvError as exc:
        raise _cv_error(exc) from exc


# ---- Geometry (handoff U4): T1 availability and T4–T5 reruns on a stored depth grid ----------

from geometry import StageBlocked  # noqa: E402
from geometry.pipeline import requantify  # noqa: E402
from geometry.sfm import sfm_available  # noqa: E402


class RequantifyRequest(Strict):
    object_id: str = Field(min_length=1, max_length=64)
    unit: Literal["mm", "relative"]
    cell_size: float = Field(gt=0, le=1000)
    depth: list[list[float | None]] = Field(min_length=3, max_length=1024)
    contour: list[tuple[float, float]] | None = None
    plane_rms: float | None = Field(default=None, ge=0)
    scale_uncertainty_mm: float | None = Field(default=None, ge=0)
    refit_plane: bool = False


@app.get("/v1/geometry/health")
def geometry_health() -> dict:
    tools = sfm_available()
    return {"status": "ok", "sfm": tools, "t1_status": "available" if tools["colmap"] else "blocked",
            "t1_reason": None if tools["colmap"] else "COLMAP tidak terpasang di server inference"}


@app.post("/v1/geometry/requantify")
def geometry_requantify(req: RequantifyRequest) -> dict:
    try:
        out = requantify(req.depth, req.cell_size, req.contour, metric=req.unit == "mm",
                         plane_rms=req.plane_rms, scale_uncertainty_mm=req.scale_uncertainty_mm, refit_plane=req.refit_plane)
    except StageBlocked as exc:
        raise HTTPException(status_code=409, detail={"code": exc.code, "reason": exc.reason}) from exc
    out.pop("depth_grid", None)
    return {"object_id": req.object_id, **out, "method": "geometry.requantify (deficit integration)"}


from geometry.pipeline import crack_from_grid  # noqa: E402


class CrackRequest(Strict):
    object_id: str = Field(min_length=1, max_length=64)
    unit: Literal["mm", "relative"]
    cell_size: float = Field(gt=0, le=1000)
    depth: list[list[float | None]] = Field(min_length=3, max_length=2048)
    plane_rms: float | None = Field(default=None, ge=0)


@app.post("/v1/geometry/crack")
def geometry_crack(req: CrackRequest) -> dict:
    """Pan et al. (2023) one-stage crack detection + quantification on a stored depth grid."""
    out = crack_from_grid(req.depth, req.cell_size, metric=req.unit == "mm", plane_rms=req.plane_rms)
    return {"object_id": req.object_id, **out, "method": "geometry.crack_from_grid (Pan et al. 2023, eq. 13–15)"}


# ----------------------------------------------------------------- structural decision (PINN/MLET)
from . import decide as decide_mod  # noqa: E402
from .mlet import mlet_strains as _mlet_strains  # noqa: E402


class DecideLayer(Strict):
    h_mm: float = Field(ge=25, le=600)
    E_mpa: float = Field(ge=50, le=30000)
    nu: float = Field(default=0.35, ge=0.15, le=0.5)


class DecideSubgrade(Strict):
    cbr: float = Field(ge=1, le=50)
    soaked_factor: float = Field(default=0.5, gt=0, le=1)


class Distress(Strict):
    source: Literal["INSPECTION", "PHOTO"] = "INSPECTION"
    alligator_pct: float = Field(default=0, ge=0, le=100)
    transverse_pct: float = Field(default=0, ge=0, le=100)
    severity: Literal["LOW", "MEDIUM", "HIGH"] = "LOW"


class DecideRequest(Strict):
    segment_id: str = Field(min_length=1, max_length=64)
    layers: list[DecideLayer] = Field(min_length=1, max_length=2)
    subgrade: DecideSubgrade
    distress: Distress | None = None
    counts: dict[str, float] | None = None
    esal_day: float | None = Field(default=None, gt=0, le=1e6)
    odol_share: float = Field(default=0.3, ge=0, le=1)
    growth: float = Field(default=0.04, ge=0, le=0.15)
    direction_factor: float = Field(default=0.5, gt=0, le=1)
    lane_factor: float = Field(default=1.0, gt=0, le=1)
    wet_months: float = Field(default=6, ge=0, le=12)
    target_years: float = Field(default=10, ge=1, le=40)
    criterion: Literal["AI", "AUS"] = "AI"
    axle_t: float = Field(default=8.16, ge=1, le=30)
    odol_axle_t: float = Field(default=13.0, ge=1, le=40)
    odol_tyre_mpa: float = Field(default=0.70, ge=0.4, le=1.2)

    @model_validator(mode="after")
    def known_classes(self):
        if self.counts:
            unknown = [k for k in self.counts if k not in decide_mod.VEHICLES["classes"]]
            if unknown:
                raise ValueError(f"unknown vehicle classes: {unknown}")
            if any(v < 0 or v > 200000 for v in self.counts.values()):
                raise ValueError("vehicle counts must be 0-200000 per day")
        return self


@app.get("/v1/decide/vehicle-classes")
def decide_vehicle_classes() -> dict:
    return decide_mod.VEHICLES


@app.post("/v1/decide")
async def decide(req: DecideRequest) -> dict:
    t = time.perf_counter()
    try:
        out = await run_in_threadpool(decide_mod.decide, req.model_dump(), _mlet_strains)
    except (ValueError, ArithmeticError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    out["engine"] = {"solver": METHOD, "elapsed_ms": round((time.perf_counter() - t) * 1000, 1)}
    return out


# ------------------------------------------------------------------ PINN-2 diagnosis (SPEC M5.1)
import numpy as _np  # noqa: E402

from . import diagnose as diagnose_mod  # noqa: E402
from .surrogate import features as _sur_features  # noqa: E402

DIAG_MAX_EXACT = 120  # samples solved with PyMastic when outside the surrogate domain


def _strain_batch(h1, h2, E1, E2, E3, axle_t, q, d):
    """Surrogate inside its domain; PyMastic for the rest (capped). Reports what was used."""
    n = len(h1)
    s = load_surrogate()
    et, ev = _np.full(n, _np.nan), _np.full(n, _np.nan)
    inside = _np.zeros(n, bool)
    if s is not None:
        F = _sur_features(_np.full(n, axle_t), _np.full(n, q), h1, h2, E1, E2, E3, _np.full(n, d))
        inside = s.in_domain(F)
        if inside.any():
            Y = s.predict(F[inside])
            et[inside] = _np.exp(Y[:, 0]) * q / E3[inside] * 1e6
            ev[inside] = _np.exp(Y[:, 1]) * q / E3[inside] * 1e6
    out = _np.flatnonzero(~inside)
    if len(out) > n // 4:
        raise ValueError(f"{len(out)} of {n} samples are outside the surrogate domain; enter measured layers (project data or core).")
    exact, dropped = out[:DIAG_MAX_EXACT], out[DIAG_MAX_EXACT:]
    for i in exact:
        r = mlet_strains(axle_t, [float(h1[i]), float(h2[i])], [float(E1[i]), float(E2[i]), float(E3[i])], [0.35, 0.35, 0.45], q_mpa=q, dual_spacing_mm=d, allow_compressive_et=True)
        et[i], ev[i] = max(r["et_ue"], 1e-3), r["ev_ue"]
    # Samples beyond the exact-solve budget stay NaN: diagnose() gives them zero weight and reports the share.
    return et, ev, {"surrogate": int(inside.sum()), "pymastic": int(len(exact)), "dropped_out_of_domain": int(len(dropped)), "device": getattr(s, "device", None), "openvino": getattr(s, "openvino_version", None)}


class DiagnosePrior(Strict):
    h1: float = Field(gt=10, le=500)
    h2: float = Field(gt=20, le=1000)
    E1: float = Field(gt=200, le=20000)
    E2: float = Field(gt=20, le=3000)
    cbr: float = Field(gt=0.5, le=60)


class DiagnoseObservations(Strict):
    alligator: bool | None = None
    years_since_overlay: float | None = Field(default=None, ge=0, le=60)
    repairs_observed: int = Field(default=0, ge=0, le=10000)
    repairs_failed_90d: int = Field(default=0, ge=0, le=10000)
    odol_share: float | None = Field(default=None, ge=0, le=1)


class DiagnoseRequest(Strict):
    segment_id: str = Field(min_length=1, max_length=64)
    road_class: Literal["NASIONAL", "TOL", "PROVINSI", "KOTA", "KABUPATEN"] = "KABUPATEN"
    prior: DiagnosePrior | None = None
    esal_year: float = Field(gt=0, le=1e8)
    growth: float = Field(default=0.035, ge=0, le=0.15)
    wet_months: int = Field(default=5, ge=0, le=12)
    axle_t: float = Field(default=8.16, ge=1, le=30)
    q_mpa: float = Field(default=0.55, ge=0.3, le=1.2)
    dual_spacing_mm: float = Field(default=330, ge=0, le=600)
    criterion: Literal["AI", "AUS"] = "AI"
    observations: DiagnoseObservations | None = None
    n: int = Field(default=2000, ge=200, le=5000)


@app.post("/v1/diagnose")
async def diagnose(req: DiagnoseRequest) -> dict:
    t = time.perf_counter()
    try:
        out = await run_in_threadpool(diagnose_mod.diagnose, req.model_dump(), _strain_batch)
    except (ValueError, ArithmeticError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    out["elapsed_ms"] = round((time.perf_counter() - t) * 1000, 1)
    return out
