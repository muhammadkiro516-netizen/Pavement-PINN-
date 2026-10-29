"""PINN-1 (SPEC M5.2): displacement field u(r,z), w(r,z) of a layered elastic pavement under one
circular tyre load, learned from the equations of elasticity.

Non-dimensional variables (lengths / a, stresses / q, displacements * E_ref / (q a)) keep every
term O(1). One sub-network per layer; u = r * N_u(r,z) so u(0,z) = 0 exactly on the axis.

Loss = PDE residual (two axisymmetric Navier equilibrium equations, multiplied by r to avoid
the 1/r singularity) at collocation points in each layer
     + surface traction  sigma_zz = -s(r), tau_rz = 0  with a smooth tyre edge s(r)
     + interface continuity of u, w, sigma_zz, tau_rz (fully bonded)
     + data loss on a sparse set of PyMastic points (vertical displacement and strains)

Sign convention inside the network: tension positive, z positive downward.
PyMastic reports strains with compression positive; converted on the way in.
"""
from __future__ import annotations

import math
import time
from dataclasses import dataclass, field

import numpy as np
import torch
from torch import nn

from app.mlet import _pymastic

torch.set_default_dtype(torch.float64)


@dataclass
class Structure:
    h_mm: list[float]  # bound layers, top first
    E_mpa: list[float]  # one per layer incl. subgrade
    nu: list[float]
    q_mpa: float = 0.55
    wheel_kn: float = 20.016  # 8.16 t axle / 4 tyres
    a_mm: float = field(init=False)

    def __post_init__(self):
        self.a_mm = math.sqrt(self.wheel_kn * 1e3 / (math.pi * self.q_mpa))

    @property
    def interfaces(self) -> list[float]:
        """Interface depths in units of a."""
        return list(np.cumsum([h / self.a_mm for h in self.h_mm]))


def pymastic_field(st: Structure, r: list[float], z: list[float]) -> dict[str, np.ndarray]:
    """PyMastic reference at r x z (units of a). Arrays shaped (len(z), len(r)), network convention."""
    rs = _pymastic(st.q_mpa * 1000.0, list(r), list(z), [h / st.a_mm for h in st.h_mm], list(st.E_mpa), list(st.nu))
    e_ref_kpa = st.E_mpa[-1] * 1000.0
    scale = e_ref_kpa / (st.q_mpa * 1000.0)  # displacement (units of a) and strain -> non-dimensional
    return {
        "w": np.asarray(rs["Displacement_Z"]) * scale,
        "eps_rr": -np.asarray(rs["Strain_R"]) * scale,
        "eps_zz": -np.asarray(rs["Strain_Z"]) * scale,
    }


class LayerNet(nn.Module):
    def __init__(self, width: int = 48, depth: int = 3):
        super().__init__()
        layers: list[nn.Module] = [nn.Linear(2, width), nn.Tanh()]
        for _ in range(depth - 1):
            layers += [nn.Linear(width, width), nn.Tanh()]
        layers.append(nn.Linear(width, 2))
        self.net = nn.Sequential(*layers)

    def forward(self, r: torch.Tensor, z: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        o = self.net(torch.cat([r, z], 1))
        return r * o[:, :1], o[:, 1:]


class Pinn1(nn.Module):
    def __init__(self, st: Structure, R: float = 10.0, depth_below: float = 10.0, inverse: bool = False):
        super().__init__()
        self.st, self.R = st, R
        self.bounds = [0.0, *st.interfaces, st.interfaces[-1] + depth_below]
        self.nets = nn.ModuleList([LayerNet() for _ in st.E_mpa])
        e_hat = np.array(st.E_mpa) / st.E_mpa[-1]
        # Inverse mode: log-moduli of the bound layers are trainable; the subgrade is the reference.
        self.log_e = nn.Parameter(torch.tensor(np.log(e_hat)), requires_grad=inverse)
        self.nu = torch.tensor(st.nu)

    def e_hat(self) -> torch.Tensor:
        return torch.exp(self.log_e)

    def fields(self, k: int, r: torch.Tensor, z: torch.Tensor) -> dict[str, torch.Tensor]:
        u, w = self.nets[k](r, z)
        g = lambda y, x: torch.autograd.grad(y, x, torch.ones_like(y), create_graph=True)[0]
        u_r, u_z, w_r, w_z = g(u, r), g(u, z), g(w, r), g(w, z)
        e_rr, e_tt, e_zz, g_rz = u_r, u / torch.clamp(r, min=1e-6), w_z, u_z + w_r
        E, nu = self.e_hat()[k], self.nu[k]
        lam, mu = E * nu / ((1 + nu) * (1 - 2 * nu)), E / (2 * (1 + nu))
        tr = e_rr + e_tt + e_zz
        return {"u": u, "w": w, "e_rr": e_rr, "e_zz": e_zz, "s_rr": lam * tr + 2 * mu * e_rr, "s_tt": lam * tr + 2 * mu * e_tt, "s_zz": lam * tr + 2 * mu * e_zz, "t_rz": mu * g_rz}

    def layer_of(self, z: float) -> int:
        for k in range(len(self.bounds) - 1):
            if z <= self.bounds[k + 1]:
                return k
        return len(self.bounds) - 2


def _pts(n, r0, r1, z0, z1, rng):
    r = torch.tensor(rng.uniform(r0, r1, (n, 1)), requires_grad=True)
    z = torch.tensor(rng.uniform(z0, z1, (n, 1)), requires_grad=True)
    return r, z


def _const(vals) -> tuple[torch.Tensor, torch.Tensor]:
    a = np.asarray(vals, dtype=float).reshape(-1, 1)
    return torch.tensor(a, requires_grad=True)


def tyre(r: torch.Tensor, edge: float = 0.05) -> torch.Tensor:
    return torch.sigmoid((1.0 - r) / edge)


def train(model: Pinn1, data: dict, *, iters: int = 4000, physics: bool = True, n_col: int = 600, seed: int = 0, lr: float = 2e-3, log_every: int = 0) -> dict:
    """data: {'r','z' (1-D arrays), 'w','eps_rr','eps_zz' (same length) | None per key}."""
    rng = np.random.default_rng(seed)
    torch.manual_seed(seed)
    params = [p for p in model.parameters() if p.requires_grad]
    opt = torch.optim.Adam(params, lr=lr)
    sched = torch.optim.lr_scheduler.StepLR(opt, step_size=max(1, iters // 3), gamma=0.3)
    nL = len(model.nets)
    hist = []
    t0 = time.perf_counter()
    for it in range(iters):
        if it % 250 == 0:
            cols = [_pts(n_col // nL + 50, 1e-3, model.R, model.bounds[k], model.bounds[k + 1], rng) for k in range(nL)]
            rs = _const(np.concatenate([rng.uniform(0, 3, 150), rng.uniform(3, model.R, 50)]))
            zs = torch.zeros_like(rs, requires_grad=True)
            ifs = []
            for k in range(nL - 1):
                ri = _const(rng.uniform(1e-3, model.R, 120))
                ifs.append((k, ri, torch.full_like(ri, model.bounds[k + 1], requires_grad=True)))
        loss_pde = torch.zeros(())
        if physics:
            for k, (r, z) in enumerate(cols):
                f = model.fields(k, r, z)
                g = lambda y, x: torch.autograd.grad(y, x, torch.ones_like(y), create_graph=True)[0]
                eq1 = r * g(f["s_rr"], r) + r * g(f["t_rz"], z) + f["s_rr"] - f["s_tt"]
                eq2 = r * g(f["t_rz"], r) + r * g(f["s_zz"], z) + f["t_rz"]
                loss_pde = loss_pde + (eq1 ** 2).mean() + (eq2 ** 2).mean()
            top = model.fields(0, rs, zs)
            loss_bc = ((top["s_zz"] + tyre(rs)) ** 2).mean() + (top["t_rz"] ** 2).mean()
            loss_if = torch.zeros(())
            for k, ri, zi in ifs:
                a, b = model.fields(k, ri, zi), model.fields(k + 1, ri, zi)
                loss_if = loss_if + sum(((a[x] - b[x]) ** 2).mean() for x in ("u", "w", "s_zz", "t_rz"))
        else:
            loss_bc = loss_if = torch.zeros(())
        loss_data = torch.zeros(())
        for k in range(nL):
            idx = [i for i, zz in enumerate(data["z"]) if model.layer_of(zz) == k]
            if not idx:
                continue
            r = _const(np.asarray(data["r"])[idx])
            z = _const(np.asarray(data["z"])[idx])
            f = model.fields(k, r, z)
            for key, fk in (("w", "w"), ("eps_rr", "e_rr"), ("eps_zz", "e_zz")):
                if data.get(key) is not None:
                    target = torch.tensor(np.asarray(data[key])[idx]).reshape(-1, 1)
                    loss_data = loss_data + ((f[fk] - target) ** 2).mean()
        loss = loss_pde + 10 * loss_bc + 10 * loss_if + 10 * loss_data
        opt.zero_grad()
        loss.backward()
        opt.step()
        sched.step()
        if log_every and it % log_every == 0:
            hist.append({"iter": it, **{k: float(v.detach()) for k, v in (("loss", loss), ("pde", loss_pde), ("bc", loss_bc), ("interface", loss_if), ("data", loss_data))}})
    return {"seconds": round(time.perf_counter() - t0, 1), "iters": iters, "final_loss": float(loss.detach()), "history": hist}


def predict(model: Pinn1, r: list[float], z: list[float]) -> dict[str, np.ndarray]:
    """Non-dimensional w, eps_rr, eps_zz and the PDE residual magnitude on the grid r x z."""
    out = {k: np.zeros((len(z), len(r))) for k in ("w", "eps_rr", "eps_zz", "residual")}
    for i, zz in enumerate(z):
        k = model.layer_of(zz)
        rr = _const(r)
        zt = torch.full_like(rr, zz, requires_grad=True)
        f = model.fields(k, rr, zt)
        g = lambda y, x: torch.autograd.grad(y, x, torch.ones_like(y), create_graph=True)[0]
        eq1 = rr * g(f["s_rr"], rr) + rr * g(f["t_rz"], zt) + f["s_rr"] - f["s_tt"]
        eq2 = rr * g(f["t_rz"], rr) + rr * g(f["s_zz"], zt) + f["t_rz"]
        out["w"][i] = f["w"].detach().numpy().ravel()
        out["eps_rr"][i] = f["e_rr"].detach().numpy().ravel()
        out["eps_zz"][i] = f["e_zz"].detach().numpy().ravel()
        out["residual"][i] = torch.sqrt(eq1 ** 2 + eq2 ** 2).detach().numpy().ravel()
    return out


def rel_l2(pred: np.ndarray, ref: np.ndarray) -> float:
    m = np.isfinite(ref)
    return float(np.linalg.norm(pred[m] - ref[m]) / max(np.linalg.norm(ref[m]), 1e-12))
