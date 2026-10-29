"""Physics-informed surrogate for layered-elastic strains: PyTorch -> OpenVINO (v3 §4.4 D2).

Adapted from docs/v3/_build/reference_code/train_pi_surrogate.py. Physics enters through
  1. dimensionless inputs/outputs: x = ln(h1/a), ln(h2/a), ln(E1/E3), ln(E2/E3), ln(d/a);
     y = ln(eps * E3 / q). Elastic similarity and linearity in q hold exactly by construction.
     (Change from the reference: ln(d/a) is added; with dual tyres the strain depends on it.)
  2. log targets, so predicted strains are always positive;
  3. a monotonicity penalty at unlabelled collocation points, only for directions that PyMastic
     itself obeys in 100 % of perturbation checks (Lampiran B.9).

Run from inference/:  .venv/Scripts/python -m training.train_pi_surrogate
Outputs go to ../models (repo root): IR files, metrics JSON and registry entry.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import time
import warnings
from multiprocessing import Pool

import numpy as np
import torch
import torch.nn as nn

FEATURES = ["ln_h1_a", "ln_h2_a", "ln_E1_E3", "ln_E2_E3", "ln_d_a"]
TARGETS = ["et", "ev"]
VERSION = "pi-surrogate-v1"


def features(P, q, h1, h2, E1, E2, E3, d):
    a = np.sqrt(P * 9.80665e3 / 4 / (np.pi * q))
    return np.stack([np.log(h1 / a), np.log(h2 / a), np.log(E1 / E3), np.log(E2 / E3), np.log(d / a)], 1).astype(np.float32)


def make_xy(data):
    X, out, k = data["X"], data["out"], float(data["k_cbr"])
    P, q, h1, h2, E1, E2, CBR, d = X.T
    _, et, ev = out.T
    E3 = k * CBR
    F = features(P, q, h1, h2, E1, E2, E3, d)
    Y = np.stack([np.log(et * 1e-6 * E3 / q), np.log(ev * 1e-6 * E3 / q)], 1).astype(np.float32)
    return F, Y


class PISurrogate(nn.Module):
    def __init__(self, fmu, fsd, ymu, ysd, n_in=5, width=64):
        super().__init__()
        for n, v in dict(fmu=fmu, fsd=fsd, ymu=ymu, ysd=ysd).items():
            self.register_buffer(n, torch.tensor(v, dtype=torch.float32))
        self.net = nn.Sequential(nn.Linear(n_in, width), nn.Tanh(), nn.Linear(width, width), nn.Tanh(),
                                 nn.Linear(width, width), nn.Tanh(), nn.Linear(width, 2))

    def forward(self, x):
        return self.net((x - self.fmu) / self.fsd) * self.ysd + self.ymu


# ---------- B.9: which monotone directions does PyMastic itself obey? ----------
PERTURB = {"ln_h1_a": 2, "ln_h2_a": 3, "ln_E1_E3": 4, "ln_E2_E3": 5, "ln_d_a": 7}  # column in raw X


def _solve(row):
    warnings.filterwarnings("ignore")
    from app.mlet import mlet_strains
    P, q, h1, h2, E1, E2, CBR, d = row
    try:
        r = mlet_strains(P, [h1, h2], [E1, E2, 10.0 * CBR], [0.35, 0.35, 0.45], q_mpa=q, dual_spacing_mm=d)
        return r["et_ue"], r["ev_ue"]
    except Exception:
        return np.nan, np.nan


def verify_signs(X, n=300, seed=1):
    """Raise each feature by 5 % in the raw input and record the sign of the strain change.
    Returns a [5, 2] matrix: -1 / +1 when 100 % consistent, 0 otherwise."""
    rng = np.random.default_rng(seed)
    base = X[rng.choice(len(X), n, replace=False)]
    rows = [base]
    for col in PERTURB.values():
        b = base.copy()
        b[:, col] *= 1.05
        rows.append(b)
    with Pool(int(os.environ.get("MLET_WORKERS", os.cpu_count()))) as pool:
        res = np.array(pool.map(_solve, list(np.concatenate(rows)), chunksize=32)).reshape(len(rows), n, 2)
    signs, report = np.zeros((len(FEATURES), 2)), {}
    for i, name in enumerate(PERTURB):
        diff = res[i + 1] - res[0]
        ok = np.isfinite(diff).all(1)
        for k, t in enumerate(TARGETS):
            pos, neg = (diff[ok, k] > 0).mean(), (diff[ok, k] < 0).mean()
            signs[i, k] = 1 if pos == 1 else -1 if neg == 1 else 0
            report[f"{name}->{t}"] = {"share_increase": round(float(pos), 4), "share_decrease": round(float(neg), 4),
                                      "constraint": int(signs[i, k])}
    return signs, report


def mono_penalty(model, x, signs):
    x = x.clone().requires_grad_(True)
    y = model(x)
    pen = 0.0
    for k in range(2):
        g = torch.autograd.grad(y[:, k].sum(), x, create_graph=True)[0]
        pen = pen + (torch.relu(-signs[:, k] * g) ** 2).mean()
    return pen


def violation_share(model, x, signs):
    x = x.clone().requires_grad_(True)
    y = model(x)
    bad = torch.zeros(len(x), dtype=torch.bool)
    for k in range(2):
        g = torch.autograd.grad(y[:, k].sum(), x, retain_graph=True)[0]
        bad |= ((signs[:, k] != 0) & (signs[:, k] * g < 0)).any(1)
    return float(bad.float().mean())


def err_stats(pred_log, true_log):
    rel = np.abs(np.exp(pred_log - true_log) - 1)
    out = {}
    for k, t in enumerate(TARGETS):
        e = rel[:, k]
        out[t] = {"mape_pct": round(float(e.mean() * 100), 3), "p95_pct": round(float(np.percentile(e, 95) * 100), 3),
                  "max_pct": round(float(e.max() * 100), 3)}
    ss_res = ((pred_log - true_log) ** 2).sum(0)
    ss_tot = ((true_log - true_log.mean(0)) ** 2).sum(0)
    for k, t in enumerate(TARGETS):
        out[t]["r2_log"] = round(float(1 - ss_res[k] / ss_tot[k]), 5)
    return out


def train(F, Y, signs, steps, lam, seed, width=64):
    torch.manual_seed(seed)
    fmu, fsd, ymu, ysd = F.mean(0), F.std(0), Y.mean(0), Y.std(0)
    model = PISurrogate(fmu, fsd, ymu, ysd, n_in=F.shape[1], width=width)
    Ft, Yt = torch.tensor(F), torch.tensor(Y)
    lo, hi = Ft.min(0).values, Ft.max(0).values
    st = torch.tensor(signs, dtype=torch.float32)
    opt = torch.optim.Adam(model.parameters(), lr=3e-3)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, steps)
    for step in range(steps):
        b = torch.randint(0, len(Ft), (1024,))
        loss = ((model(Ft[b]) - Yt[b]) ** 2).mean()
        if lam > 0:
            loss = loss + lam * mono_penalty(model, lo + (hi - lo) * torch.rand(512, F.shape[1]), st)
        opt.zero_grad()
        loss.backward()
        opt.step()
        sched.step()
    model.eval()
    return model


def predict(model, F):
    with torch.no_grad():
        return model(torch.tensor(F)).numpy()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data/mlet_dual_v1.npz")
    ap.add_argument("--out", default="../models")
    ap.add_argument("--steps", type=int, default=6000)
    ap.add_argument("--lam", type=float, default=0.1)
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args()
    np.random.seed(a.seed)
    torch.set_num_threads(os.cpu_count())
    data = np.load(a.data, allow_pickle=True)
    X = data["X"]
    F, Y = make_xy(data)

    t0 = time.time()
    signs, sign_report = verify_signs(X)
    sign_seconds = time.time() - t0

    idx = np.random.permutation(len(F))
    n_tr = int(0.8 * len(F))
    tr, te = idx[:n_tr], idx[n_tr:]

    t0 = time.time()
    model = train(F[tr], Y[tr], signs, a.steps, a.lam, a.seed)
    train_seconds = time.time() - t0
    random_split = err_stats(predict(model, F[te]), Y[te])

    # Out-of-distribution: train on CBR >= 4 and h1 <= 180 mm, test on CBR < 3 or h1 > 200 mm.
    cbr, h1 = X[:, 6], X[:, 2]
    in_box, out_box = (cbr >= 4) & (h1 <= 180), (cbr < 3) | (h1 > 200)
    ood_model = train(F[in_box], Y[in_box], signs, a.steps, a.lam, a.seed)
    ood = err_stats(predict(ood_model, F[out_box]), Y[out_box])

    # Ablation 1: same network, no monotonicity loss.
    plain = train(F[tr], Y[tr], signs, a.steps, 0.0, a.seed)
    colloc = torch.tensor(F[tr].min(0)) + torch.tensor(F[tr].max(0) - F[tr].min(0)) * torch.rand(20000, F.shape[1])
    st = torch.tensor(signs, dtype=torch.float32)

    # Ablation 2: plain MLP on raw inputs (no dimensional analysis), predicting log strain.
    raw_in = np.log(X).astype(np.float32)
    raw_out = np.log(data["out"][:, 1:]).astype(np.float32)
    raw = train(raw_in[tr], raw_out[tr], np.zeros((raw_in.shape[1], 2)), a.steps, 0.0, a.seed)
    raw_split = err_stats(predict(raw, raw_in[te]), raw_out[te])
    # Similarity: multiply every modulus by 3 -> strains must divide by exactly 3.
    Xs = X[te].copy()
    Xs[:, 4] *= 3; Xs[:, 5] *= 3; Xs[:, 6] *= 3
    r1 = np.exp(predict(raw, raw_in[te]))
    r3 = np.exp(predict(raw, np.log(Xs).astype(np.float32)))
    raw_similarity_err = float(np.abs(r1 / r3 / 3 - 1).max() * 100)

    # Ablation 3: Intel Extension for Scikit-learn baseline (random forest on raw inputs), timed.
    from sklearn.ensemble import RandomForestRegressor as StockRF
    t0 = time.time(); StockRF(n_estimators=100, n_jobs=-1, random_state=0).fit(raw_in[tr], raw_out[tr]); stock_s = time.time() - t0
    from sklearnex.ensemble import RandomForestRegressor as PatchedRF
    t0 = time.time(); rf = PatchedRF(n_estimators=100, n_jobs=-1, random_state=0).fit(raw_in[tr], raw_out[tr]); patched_s = time.time() - t0
    rf_split = err_stats(rf.predict(raw_in[te]), raw_out[te])

    os.makedirs(a.out, exist_ok=True)
    stem = os.path.join(a.out, VERSION)
    torch.save(model.state_dict(), stem + ".pt")

    # ---- OpenVINO export: FP32, FP16 weights, INT8 (NNCF post-training quantisation) ----
    import nncf
    import openvino as ov
    ov_model = ov.convert_model(model, example_input=torch.zeros(8, 5), input=[ov.PartialShape([-1, 5])])
    ov.save_model(ov_model, stem + "_fp32.xml", compress_to_fp16=False)
    ov.save_model(ov_model, stem + "_fp16.xml")
    calib = nncf.Dataset([F[tr][i:i + 64] for i in range(0, 64 * 50, 64)])
    ov.save_model(nncf.quantize(ov_model, calib, subset_size=50 * 64), stem + "_int8.xml", compress_to_fp16=False)
    core = ov.Core()
    torch_test = predict(model, F[te])
    precision = {}
    for p in ("fp32", "fp16", "int8"):
        y = core.compile_model(stem + f"_{p}.xml", "CPU")(F[te])[0]
        dev = np.abs(np.exp(y - torch_test) - 1)
        precision[p] = {"max_dev_vs_torch_pct": round(float(dev.max() * 100), 4), "vs_mlet": err_stats(y, Y[te])}

    def sha(path):
        return hashlib.sha256(open(path, "rb").read()).hexdigest()

    metrics = {
        "version": VERSION,
        "trained_from": "PyMastic MLET (dual tyres), " + os.path.basename(a.data),
        "features": FEATURES, "targets": "ln(strain * E3 / q) for et, ev",
        "n_train": int(n_tr), "n_test": int(len(te)), "steps": a.steps, "lambda_mono": a.lam, "seed": a.seed,
        "device": {"train": "cpu", "cpu": platform.processor(), "torch": torch.__version__,
                   "xpu_available": bool(hasattr(torch, "xpu") and torch.xpu.is_available())},
        "train_seconds": round(train_seconds, 1),
        "sign_check": {"n_points": 300, "step": "+5 %", "seconds": round(sign_seconds, 1), "result": sign_report},
        "random_split": random_split,
        "ood": {"train": "CBR >= 4 and h1 <= 180 mm", "test": "CBR < 3 or h1 > 200 mm",
                "n_train": int(in_box.sum()), "n_test": int(out_box.sum()), "errors": ood},
        "monotonic_violation_share": {"pi_surrogate": violation_share(model, colloc, st),
                                      "same_net_without_mono_loss": violation_share(plain, colloc, st)},
        "ablation": {
            "plain_mlp_raw_inputs": {"errors": raw_split, "similarity_max_err_pct": round(raw_similarity_err, 3)},
            "pi_surrogate_similarity_max_err_pct": 0.0,
            "random_forest_raw_inputs": {"errors": rf_split, "fit_seconds_stock_sklearn": round(stock_s, 2),
                                         "fit_seconds_sklearnex": round(patched_s, 2)},
        },
        "domain": {"fmin": F[tr].min(0).tolist(), "fmax": F[tr].max(0).tolist()},
        "openvino": {"version": ov.__version__, "nncf": nncf.__version__, "precision": precision},
        "files": {p: {"xml": f"{VERSION}_{p}.xml", "bin_sha256": sha(stem + f"_{p}.bin")} for p in ("fp32", "fp16", "int8")},
        "created": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    with open(stem + "_metrics.json", "w") as f:
        json.dump(metrics, f, indent=2)
    print(json.dumps({k: metrics[k] for k in ("random_split", "ood", "monotonic_violation_share", "ablation", "train_seconds")}, indent=1))
    print(json.dumps(metrics["openvino"]["precision"], indent=1))
    print(json.dumps(sign_report))


if __name__ == "__main__":
    main()
