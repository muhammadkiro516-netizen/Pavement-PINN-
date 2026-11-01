# PAVEMENT-PINN: Datasets, Models, Evaluation, Physics Surrogate, Intel Tech Facts, and Inclusion Evidence (researched 2026-11-01)

Scope note: research for the Intel AI Global Impact Festival 2026 Stage 3 interview. Some primary pages (github.com/sekilab, docs.openvino.ai release notes and NPU GenAI body text, PMC, NNCF docs on GitHub, infopublik.id) were blocked or did not render in this session. Facts from those pages are listed under Gaps and were not taken from memory. Anything marked "UNVERIFIED" is prior knowledge that must be checked before it goes on a slide.

---

## 1. Road damage image datasets (detection, segmentation, depth, Indonesian coverage) and model/code licenses

### Takeaway
RDD2022 (47,420 images, 6 countries, 4 classes, CC BY-SA 4.0) is the main detection dataset. It contains no Indonesian images. Indonesian coverage comes from a Roboflow "RDD_Indonesia" set (8,397 images, CC BY 4.0, RDD-style classes in Bahasa, provenance undocumented), a 50-image Bandung out-of-distribution pothole test set (CC BY 4.0, 2026, includes wet/night conditions and shadow hard negatives), and a BRIN road-surface classification set (CC BY 4.0, 2026). For segmentation and depth, use UDTIRI (1,000 images, pixel and instance masks) and Rui Fan's stereo pothole datasets (MIT license; disparity, masks, point clouds). Ultralytics YOLO is AGPL-3.0, and Ultralytics says trained models fall under AGPL by default. RT-DETR weights on Hugging Face are Apache-2.0.

### Cited Findings

**RDD2022 / CRDDC2022 (primary detection dataset)**
- RDD2022: 47,420 road images from Japan, India, Czech Republic, Norway, United States and China, with more than 55,000 annotated damage instances in 4 classes (longitudinal cracks, transverse cracks, alligator cracks, potholes). Arya, Maeda, Ghosh, Toshniwal, Sekimoto, arXiv:2209.08538v1, 18 Sep 2022 — [arXiv 2209.08538](https://arxiv.org/abs/2209.08538)
- The CRDDC2022 paper says the dataset is public under CC BY-SA 4.0. Download is from FigShare ("RDD2022 - The multi-national Road Damage Dataset released through CRDDC 2022", article 21431547). The challenge site is https://crddc2022.sekilab.global/ — [CRDDC2022 paper, arXiv 2211.11362](https://www.arxiv.org/pdf/2211.11362)
- A China drone subset exists, and some teams left it out of training — [arXiv 2211.11362](https://www.arxiv.org/pdf/2211.11362)
- (The sekilab GitHub repo, github.com/sekilab/RoadDamageDetector, was not reachable from this session. See Gaps.)

**Indonesian datasets**
- **RDD_Indonesia (Roboflow Universe, workspace "rdd-n1dvu")**: 8,397 images (version 2), object detection, CC BY 4.0, last updated 8 Nov 2023. Classes shown: Lubang, Retakan_Buaya, Retakan_Melintang, Retakan_Memanjang. The project has no published description of its source, so provenance is unknown — [Roboflow RDD_Indonesia](https://universe.roboflow.com/rdd-n1dvu/rdd_indonesia)
- **Bandung Pothole Image Dataset (BPID)**: 50 annotated pothole images from Bandung, West Java, by Sabdaul Ulum Jamaludin (Binus University), v1 published 12 June 2026, CC BY 4.0, DOI 10.17632/rgymy6dwdd.1. It is built as an out-of-distribution test set covering sunny, cloudy, wet/after-rain and night-time conditions, with tree shadows as hard negatives for false positives. Annotation type and resolution are not stated — [Mendeley Data BPID](https://data.mendeley.com/datasets/rgymy6dwdd/1)
- **IROSCD (Indonesia Road Surface Classification Dataset)**: BRIN (Badan Riset dan Inovasi Nasional), v1 published 27 July 2026, CC BY 4.0, DOI 10.17632/ftcrvjz92c.1. Classes are Normal Road, Damaged Road, Bumpy Road and Wet Road, captured on smartphones at urban and rural sites across Indonesia. It is for classification, not detection, and the image count is not stated — [Mendeley Data IROSCD](https://data.mendeley.com/datasets/ftcrvjz92c/1)
- Indonesian student and academic work on YOLO road-damage detection exists, for example a Telkom University thesis "Sistem pendeteksi lubang jalan berbasis YOLO", a UIN SGD study "Penerapan model YOLOv11 untuk deteksi kerusakan jalan", and "Sistem Cerdas Deteksi Kerusakan Jalan dengan Perbandingan Algoritma YOLOV8 dan SSD MobileNet" (Senatib, UDB). Their data availability was not checked — [Telkom Univ](https://openlibrary.telkomuniversity.ac.id/pustaka/files/203973/abstraksi/sistem-pendeteksi-lubang-jalan-berbasis-you-only-look-once-yolo-.pdf); [UIN SGD](https://digilib.uinsgd.ac.id/114862/); [Senatib UDB](https://ojs.udb.ac.id/Senatib/article/view/6399)

**Pothole detection datasets**
- **Chitholian "Annotated Potholes"**: 665 images, one class (potholes), created by Atikur Rahman Chitholian for an undergraduate thesis and first shared on Kaggle. The Roboflow public copy is reshuffled to 70% train / 20% valid / 10% test because the original had no validation set. The license is not stated on the Roboflow page — [Roboflow Public Pothole Dataset](https://public.roboflow.com/object-detection/pothole)

**Pothole segmentation and depth/3D datasets**
- **UDTIRI** (Tongji University, Rui Fan corresponding author; arXiv 2304.08842v3, 1 Jan 2024): 1,000 RGB images with pixel-level and instance-level labels, using VOC format for semantic and COCO format for instance segmentation. It has no depth data yet. Tasks are detection, semantic segmentation and instance segmentation. Baselines cover 14 detection, 30 semantic segmentation and 10 instance segmentation networks. YOLOv6 had the best overall detection balance, Segmenter led semantic segmentation, and Mask R-CNN led instance segmentation. Benchmark site: https://udtiri.com. Dataset license not stated — [arXiv 2304.08842v3](https://arxiv.org/html/2304.08842v3)
- **Stereo pothole datasets (Rui Fan, 2019)**: three folders, each with RGB images, disparity maps, color- and grayscale-transformed disparity, pixel-level pothole ground truth and 3D point clouds. MIT license. Cite Fan et al. 2019 (IEEE TIP, "Pothole Detection Based on Disparity Transformation and Road Surface Modeling") and Fan, Ai, Dahnoun 2018 (IEEE TIP 27(6):3025–3035). Dataset 2 frames 6, 7, 8, 13–15, 21–23 and 37–39 are excluded from evaluation — [GitHub ruirangerfan/stereo_pothole_datasets](https://www.github.com/ruirangerfan/stereo_pothole_datasets)
- A separate "Pothole-600" page exists at sites.google.com/view/pothole-600/dataset (search result only, not fetched) — [Pothole-600 site](https://sites.google.com/view/pothole-600/dataset)
- Roboflow Universe has several community pothole instance-segmentation projects, for example "Pothole_Segmentation_YOLOv8" (farzad), "Pothole Image Segmentation", "potholes yolov8" and "Potholes and Roads Instance Segmentation". Counts and licenses were not checked — [farzad/pothole_segmentation_yolov8](https://universe.roboflow.com/farzad/pothole_segmentation_yolov8); [Pothole Image Segmentation](https://universe.roboflow.com/project-uyrxf/pothole-image-segmentation-hmej6); [Potholes and Roads Instance Segmentation](https://universe.roboflow.com/road-dataset-rpv8i/potholes-and-roads-instance-segmentation-nga49)

**Crack segmentation datasets (pixel masks)**, from the Georgia Tech review by Zhang et al., arXiv:2508.10256v2, Sep 2025 — [arXiv 2508.10256](https://arxiv.org/pdf/2508.10256)
- CRACK500 (2016): 2448×3264 smartphone images, pavement at Temple University.
- DeepCrack (2019): 537 images, 544×384, asphalt and concrete.
- CFD (2016): 118 images, 320×480, Beijing urban roads.
- GAPs384 (2019): 384 images, 1920×1080, 8-bit grayscale, 1.2 mm/pixel (from GAPs).
- CrackTree200 (2012): 206 images, 600×800. CrackTree260 (2018): 260 images, 600×800.
- AEL (2016): 269 images, 68 annotated.
- Khanh11k (2019): merged from CrackTree200, CRACK500, GAPs384, CFD and AEL, at 448×448. The fetched summary gave 112,000 images, but the name suggests about 11k, so this needs checking.
- CrackSeg9k (2022): 9,255 images at 400×400, refined from ten public datasets — also [CrackSeg9k arXiv 2208.13054](https://arxiv.org/pdf/2208.13054)
- The review states no licenses for these datasets — [arXiv 2508.10256](https://arxiv.org/pdf/2508.10256)

**Detector/segmenter code and weight licenses**
- **Ultralytics**: AGPL-3.0 suits users "comfortable open-sourcing your entire project under AGPL-3.0". Compliance means publicly releasing "the complete corresponding source code for the entire derivative work", including modifications, scripts, configs and, where applicable, model weights. The Enterprise License is required for commercial products, SaaS/APIs, embedded deployment, internal business tools and custom-trained models in commercial settings. The FAQ says "All Ultralytics YOLO trained models fall under the AGPL-3.0 License by default". Enterprise covers YOLO26, earlier versions and future models; YOLO27 is on a waitlist. The listed AGPL uses include academic research, coursework, and non-profit or government research if fully disclosed — [Ultralytics License](https://ultralytics.com/license)
- **RT-DETR**: the Hugging Face model card (PekingU/rtdetr_r18vd) lists license apache-2.0. The code repo is lyuwenyu/RT-DETR. The card's AP figure of 53.1 COCO val is the R50 number from the abstract, not R18 — [HF PekingU/rtdetr_r18vd](https://huggingface.co/PekingU/rtdetr_r18vd/blob/refs%2Fpr%2F2/README.md)
- RF-DETR is listed as an "early-release" model supported on CPU/GPU in OpenVINO 2026.4 — [newreleases.io OpenVINO 2026.4.0](https://newreleases.io/project/github/openvinotoolkit/openvino/release/2026.4.0)
- **PyMastic** (layered elastic solver): Apache-2.0 — [GitHub PyMastic](https://www.github.com/Mostafa-Nakhaei/PyMastic)

### Inferences
- RDD2022 is CC BY-SA 4.0, so any re-released or relabelled dataset derived from it (for example RDD2022 plus Indonesian images) must also be released under CC BY-SA 4.0 with attribution. Whether trained weights count as "adapted material" is legally unsettled. Say "weights released openly with attribution" rather than claiming they are unencumbered.
- The RDD_Indonesia classes map one-to-one to RDD2022's four classes: Retakan_Memanjang = longitudinal, Retakan_Melintang = transverse, Retakan_Buaya = alligator, Lubang = pothole. That makes RDD2022 plus RDD_Indonesia a natural joint label space. Because RDD_Indonesia has no provenance description, check for near-duplicates of RDD2022 images (for example with perceptual hashing) before claiming "Indonesian" data, and before using it as a test set.
- BPID (50 images from Bandung, with wet and night conditions) is the best available Indonesian held-out test set. It also partly covers wet-road and water-covered potholes. Its small size means confidence intervals will be wide, so report them.
- For a student festival entry, AGPL is workable if the whole repo, including the PWA backend, is public. For a cleaner story with future government or commercial deployment in mind, an Apache-2.0 path (RT-DETR via HF transformers, exported to OpenVINO) avoids Ultralytics' commercial terms. Prepare one sentence on this: "Prototype uses YOLO under AGPL, fully open-sourced; production path is RT-DETR (Apache-2.0) to avoid licensing lock-in."
- Pothole-area estimates from a single phone photo need a scale reference. The stereo datasets (disparity and point clouds) and UDTIRI masks are the citable bases for checking area and depth estimates.

### Gaps
- Per-country image counts for RDD2022, the D00/D10/D20/D40 code-to-class mapping, the sekilab repo license, and RDD2020 details were not verified because github.com/sekilab was blocked. UNVERIFIED: the common usage is D00 = longitudinal, D10 = transverse, D20 = alligator, D40 = pothole. Confirm in the RDD2022 data article or the repo README.
- Licenses for CRACK500, DeepCrack, CFD, GAPs (GAPs is known to require a registration agreement — UNVERIFIED), Khanh11k and CrackSeg9k are not stated in the review. Check each source repo.
- Kaggle license of the Chitholian dataset not verified.
- Licenses for YOLOX, MMDetection, D-FINE, RF-DETR and OpenVINO Open Model Zoo were not fetched. UNVERIFIED: YOLOX, MMDetection and RF-DETR are believed to be Apache-2.0. Confirm on their GitHub LICENSE files.
- Not fetched: "A pothole video dataset for semantic segmentation" (Data in Brief, PMC10867608; PMC returned a CAPTCHA), "RoadDamageVision" (Mendeley ypm4h4z25c, likely Spanish/USAL) and "Multi-class Road-Surface Condition Dataset" (Mendeley c43y93xswd). Country, size and license unknown — [PMC10867608](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10867608/); [RoadDamageVision](https://data.mendeley.com/datasets/ypm4h4z25c/2); [Multi-class Road-Surface](https://data.mendeley.com/datasets/c43y93xswd/1)
- No dedicated water-covered pothole dataset was found. BPID's wet/after-rain subset and IROSCD's "Wet Road" class are the closest.

---

## 2. Evaluation protocols (detection, segmentation, area) and a reproducible protocol

### Takeaway
CRDDC2022 used F1 with a true positive defined as IoU > 0.5 and matching label, averaged over country test sets. The 2022 winner reached F1 0.770 overall (6 countries), with large country variation: India 0.583, Norway 0.595, Japan 0.789, US 0.844. UDTIRI reports AP by object size plus mIoU for detection, and IoU, F1, precision, recall and accuracy for segmentation. PAVEMENT-PINN should report both CRDDC-style F1 at a fixed confidence threshold (directly comparable) and COCO-style mAP, on location-held-out splits, including an Indonesian out-of-distribution test.

### Cited Findings
- **CRDDC2022 metric**: F1 (harmonic mean of precision and recall) for each of 5 target test cases. Final rank uses the average of the five. A prediction is correct if its box has IoU > 0.5 with ground truth and the label matches — [arXiv 2211.11362](https://www.arxiv.org/pdf/2211.11362)
- **CRDDC2022 leaderboard (F1)**: ShiYu SeaView came first on Overall 6-country (0.770), India (0.583), Japan (0.789), Norway (0.595) and United States (0.844). Runners-up overall: DongjunJeong 0.743, MDPT 0.741. Average across leaderboards: ShiYu SeaView 0.716, DongjunJeong 0.674, MDPT 0.663. The Czech Republic had no separate leaderboard — [arXiv 2211.11362](https://www.arxiv.org/pdf/2211.11362)
- **Winning approaches**: ShiYu SeaView ensembled YOLOv5, YOLOv7 and a Cascade R-CNN-style detector with a Swin Transformer backbone. DongjunJeong used a YOLOv5x P5/P6 ensemble with image patches. MDPT used YOLOv7 with augmentations, label smoothing and coordinate attention, without ensembling. Others combined YOLOv5 or YOLOv7 ensembles with MMDetection's VFNet — [arXiv 2211.11362](https://www.arxiv.org/pdf/2211.11362)
- **UDTIRI metrics**: detection uses AP by pothole size (APS, APM, APL, plus overall) and mIoU. Semantic segmentation uses IoU, F1, precision, recall and accuracy. Instance segmentation uses AP — [arXiv 2304.08842v3](https://arxiv.org/html/2304.08842v3)
- **Stereo pothole benchmark**: specific frames are excluded from evaluation, an example of a fixed, documented evaluation subset — [stereo_pothole_datasets](https://www.github.com/ruirangerfan/stereo_pothole_datasets)
- **Out-of-distribution testing**: BPID is explicitly designed as an OOD test set with condition strata (sunny, cloudy, wet, night) and hard negatives (tree shadows) for measuring false positives — [Mendeley BPID](https://data.mendeley.com/datasets/rgymy6dwdd/1)

### Inferences
Recommended reproducible protocol for the interview:
1. **Splits**: train and validate on RDD2022 (plus RDD_Indonesia after de-duplication). Report (a) in-distribution test, (b) leave-one-country-out (for example train without India, test on India), and (c) Indonesian OOD test on BPID, stratified by condition.
2. **Detection metrics**: F1 at IoU 0.5 at one fixed confidence threshold chosen on validation (CRDDC-comparable), plus mAP@0.5 and mAP@0.5:0.95 (COCO convention), per class (D00/D10/D20/D40). Include a per-condition false-positive rate for shadows.
3. **Segmentation**: per-image and dataset IoU and F1 on UDTIRI and the stereo pothole masks.
4. **Area error**: mean absolute percentage error of predicted pothole area against mask area. Only claim real-world cm² when a scale reference (stereo, or a known-size object) is available.
5. **Reproducibility**: fixed seeds (report 3 seeds with mean ± sd), committed split files with image-ID lists, pinned versions (OpenVINO, NNCF, PyTorch), one `eval.py` that regenerates every table. Report FP32 and INT8 accuracy side by side, so quantization loss is visible.
6. **Honest benchmarking line**: "Our F1 at IoU 0.5 on the RDD2022 6-country split is X, versus 0.770 for the 2022 winner's ensemble; we trade some accuracy for running on-device." Do not compare mAP to F1.

### Gaps
- No systematic review of how pothole papers report results (mAP@0.5 vs F1, area error) was fetched. Only CRDDC and UDTIRI protocols were verified.
- The official CRDDC2022 test-set ground truth is hidden (UNVERIFIED). Local results on self-made splits are not directly comparable to the leaderboard. Confirm on crddc2022.sekilab.global.

---

## 3. PINN and physics-informed pavement surrogates (novelty and citations)

### Takeaway
The most important recent paper (arXiv 2606.03210, 2026, KAIST/Georgia Tech) critically evaluates PINNs for FWD backcalculation. Vanilla PINNs failed to recover layer moduli even without noise. XPINN gave subgrade errors up to about 70% and needed about 10 h, while a differentiable FEM solved it in about 60 s with very small errors. The paper cites no prior PINN-for-pavement studies. Most "physics-informed" pavement ML in the literature is a network trained on physics-generated synthetic data (for example SEM–Transformer, 2025/2026), not a PINN with physics in the loss. PAVEMENT-PINN should describe its surrogate precisely and should not claim PINN superiority for inverse problems.

### Cited Findings
- **Choi, Moon, Ryu, "Critical evaluation of PINN for FWD inverse analysis and differentiable FEM as an alternative"** (arXiv 2606.03210, CC BY 4.0):
  - Setup: axisymmetric layered elastic (Burmister) framework, synthetic 3-layer pavement (surface 1,378 MPa, base 206 MPa, subgrade 69 MPa, ν = 0.35), 10 geophones at 0.15 m spacing, Gaussian noise 0–5 µm.
  - Vanilla PINN failed to recover moduli even without noise.
  - Noise-free XPINN needed about 4×10⁵ iterations, with errors of −1.1% (surface), +1.0% (base) and −6.9% (subgrade). DiffFEM converged in about 40 iterations with errors around 10⁻⁹.
  - At σ = 1 µm noise, DiffFEM errors were 2.7%, 1.2% and 0.05%, versus XPINN 74%, 67% and 94%.
  - XPINN subgrade error ranged from −68.8% to +70.9% across architecture sweeps.
  - Run time: DiffFEM about 60 s versus XPINN about 10 h on an RTX 5090.
  - The paper cites no PINN-for-pavement studies, no ML surrogates of MEPDG, and neither PyMastic nor KENPAVE. Its earliest NN surrogate citation is Meier and Rix (1994).
  - [arXiv 2606.03210](https://arxiv.org/html/2606.03210)
- **Wang and Zhao, "Intelligent pavement moduli back-calculation using an SEM–transformer framework"**, Frontiers in Materials 12 (online 22 Dec 2025, published 28 Jan 2026), DOI 10.3389/fmats.2025.1732297:
  - 20,592 synthetic samples generated by a spectral element method.
  - Encoder-only Transformer mapping 9 peak deflections to 3 moduli.
  - Average R² > 0.94 and MAPE < 8% across noise cases. With combined noise, base-course MAPE was 8.83%, versus BPNN 10.63%, SVR 16.38% and XGBoost 28.04%.
  - The authors say "physics-informed" only refers to SEM-generated data and the network is "unconstrained". No field FWD validation.
  - [Frontiers in Materials](https://www.frontiersin.org/journals/materials/articles/10.3389/fmats.2025.1732297/full)
- **Classic ANN backcalculation**: Meier and Rix, "Backcalculation of flexible pavement moduli from falling weight deflectometer data using artificial neural networks" (also a TRB "dynamic deflection basins" version) — [Memphis Digital Commons](https://digitalcommons.memphis.edu/facpubs/13015); [TRID 427206](https://trid.trb.org/view/427206)
- **Classical backcalculation tools** cited in the 2026 paper: MODULUS (Rohde and Scullion 1990), EVERCALC (Harichandran et al. 1993), CMA-ES (Gopalakrishnan and Manik 2010), LTPP backcalculation (Von Quintus et al. 2015) — [arXiv 2606.03210](https://arxiv.org/html/2606.03210)
- **Related NN work on layered elastic integration**: "Improved multi-layer analysis of pavement response using neural networks to optimize numerical integration" (Aston/Nottingham; Ahmed Abed) — title only, not read — [Aston Research](https://research.aston.ac.uk/en/publications/improved-multi-layer-analysis-of-pavement-response-using-neural-n/)
- **PyMastic**: Python (ported from MATLAB) multilayer elastic solver for a uniform circular load. It outputs horizontal strain, vertical stress and deflection; compression is positive. The README says it was compared with WESLEA and KENPAVE, but shows only visual KENPAVE overlays with no error metrics. Matrix-inversion method and Hankel-integral iterations are tunable. Apache-2.0. No citation paper is listed — [GitHub PyMastic](https://www.github.com/Mostafa-Nakhaei/PyMastic)

### Inferences
- **Defensible framing**: "We use a physics-informed forward surrogate. A small network is trained on PyMastic layered-elastic solutions, with physics-consistency penalties (monotonic decay of deflection with radius, interface continuity), to give instant strain and deflection estimates at the critical points for a damage-severity or remaining-life heuristic. We do not use a PINN for inverse backcalculation; the 2026 KAIST study shows PINNs are unreliable there." This turns a likely judge question into a sign of literature awareness.
- **Validation story**: compare surrogate outputs against PyMastic, and against KENPAVE for a few textbook cases. Report MAPE and R² as Wang and Zhao do, so the numbers are comparable to a published benchmark (R² > 0.94, MAPE < 8%).
- **Novelty claim (state carefully)**: "To our knowledge, combining citizen-photo damage detection with a layered-elastic surrogate on a single edge device is new." The 2026 paper found no PINN-for-pavement studies to cite, which suggests the area is sparse. It does not prove nobody has done it.

### Gaps
- No verified source was obtained for ML surrogates of MEPDG/AASHTOWare Pavement ME. Search hits were titles only (MIT DSpace 1721.1/164808; U. Twente "surrogate modelling of surface roughness for asphalt pavements"; BJRBE "An Improved Neural Network Model for Enhancing Rutting Depth Prediction") — [MIT DSpace](https://dspace.mit.edu/handle/1721.1/164808); [U. Twente](https://research.utwente.nl/en/publications/surrogate-modelling-of-surface-roughness-for-asphalt-pavements-us/); [BJRBE](https://bjrbe-journals.rtu.lv/bjrbe/article/view/bjrbe.2022-17.572)
- Transfer functions (Asphalt Institute fatigue and rutting equations, Austroads) were not retrieved. Cite them from an Austroads Guide or a textbook such as Huang's *Pavement Analysis and Design* (KENPAVE's origin) after checking.
- Springer article s42947-022-00255-x (International Journal of Pavement Research and Technology) appeared in search but was not read — [Springer](https://link.springer.com/article/10.1007/s42947-022-00255-x)
- No Indonesian-specific mechanistic design references (for example Bina Marga MDP 2017/2024) were researched.

---

## 4. Intel technology facts (2026) and how to prove Intel hardware/software use

### Takeaway
OpenVINO 2026.0 shipped on 23 Feb 2026, and the latest release found is 2026.4.1. The 2026 line integrates the NPU compiler into the plugin (no dependency on OEM driver updates), adds speculative decoding on NPU, and lists small NPU-ready LLMs such as Qwen2.5-1B-Instruct and Qwen-2.5-coder-0.5B. `openvino.runtime` was removed in 2026.0, and Python 3.10 is dropped in 2026.5. Core Ultra Series 3 (Panther Lake, CES Jan 2026) has NPU 5 at up to 50 TOPS (int8); Series 2 (Lunar Lake) is up to 48 NPU TOPS and 120 platform TOPS. PyTorch 2.15 supports XPU training and inference on Arc A/B and Core Ultra iGPUs, including Panther Lake. scikit-learn-intelex is Apache-2.0 with a claimed average 8.5x speedup.

### Cited Findings

**OpenVINO versions and features**
- OpenVINO 2026.0 released 23 Feb 2026 — [Phoronix](https://www.phoronix.com/news/Intel-OpenVINO-2026.0-Released)
  - Newly supported NPU models: MiniCPM-o-2.6, Qwen2.5-1B-Instruct, Qwen3-Embedding-0.6B, Qwen-2.5-coder-0.5B.
  - Speculative decoding on NPU in OpenVINO GenAI.
  - NPU compiler integrated into the plugin, enabling ahead-of-time and on-device compilation without depending on OEM driver updates.
  - INT4 data-aware weight compression for 3D MatMuls in MoE LLMs.
  - Word-level timestamps in GenAI transcription.
  - New CPU/GPU LLMs: GPT-OSS-20B, MiniCPM-V-4_5-8B.
- Latest release found is 2026.4.1 — [newreleases.io](https://newreleases.io/project/github/openvinotoolkit/openvino/release/2026.4.0); [NuGet OpenVINO.runtime 2026.4.1](https://www.nuget.org/packages/OpenVINO.runtime.ubuntu.26-x86_64); [Arch Linux rebuild todo 2026.4.1](https://archlinux.org/todo/openvino-202641-rebuild/)
- OpenVINO 2026.4.0 changes — [newreleases.io](https://newreleases.io/project/github/openvinotoolkit/openvino/release/2026.4.0)
  - Multi-Token Prediction speculative decoding for Gemma 4, Qwen3.5 and Qwen3.6 (CPU/GPU).
  - EAGLE-3 tree drafting for VLMs.
  - Bounded dynamic-shape support on NPU (preview, validated on ESPCN).
  - ITT profiling of NPU execution through VTune.
  - New NPU models: FLUX.2-Klein 4B, Kokoro-82M.
  - Core Ultra Series 3 visual-token support (preview) and Xe3 optimizations.
  - RF-DETR as an early-release CPU/GPU model.
  - The CPU plugin now requires AVX2; SSE is no longer supported.
- Breaking changes and deprecations — [newreleases.io](https://newreleases.io/project/github/openvinotoolkit/openvino/release/2026.4.0)
  - Python 3.10 support will be discontinued in OpenVINO 2026.5.
  - Removed in 2026.0: the `openvino.runtime` namespace (use `import openvino as ov`), NNCF `create_compressed_model()`, the NNCF TensorFlow backend, and several GenAI APIs.
  - GenAI `start_chat()`/`finish_chat()` are deprecated.
- An OpenVINO 2026 docs page "OpenVINO GenAI on NPU" exists, but its body did not render here. Its navigation references "LLM on NPU" for OpenVINO Model Server and NPU plugin batching — [OpenVINO GenAI on NPU (2026 docs)](https://docs.openvino.ai/2026/openvino-workflow-generative/inference-with-genai/inference-with-genai-on-npu.html)
- Community OpenVINO INT4 NPU exports exist, for example "Qwen2.5-VL-3B-Instruct-ov-int4-npu" and an "int4 channel-wise symmetric" export — [HF llmware Qwen2.5-VL-3B ov-int4-npu](https://huggingface.co/llmware/Qwen2.5-VL-3B-Instruct-ov-int4-npu); [HF Seed-Coder int4-cw-ov](https://huggingface.co/HarmenWessels/Seed-Coder-8B-Instruct-int4-cw-ov)

**Intel client hardware**
- **Core Ultra Series 3 (Panther Lake)** — [Wikipedia Panther Lake](https://en.wikipedia.org/wiki/Panther_Lake_(microprocessor))
  - Announced at CES, January 2026.
  - NPU 5 at up to 50 TOPS (int8); lower SKUs at 46–49 or about 15–17 TOPS.
  - Compute tile on Intel 18A.
  - SKUs include Core Ultra X9 388H, X7 358H and 5 338H.
- **Core Ultra 200V (Lunar Lake, Series 2)** — [Tom's Hardware](https://www.tomshardware.com/pc-components/cpus/intel-launches-lunar-lake-claims-arm-beating-battery-life-worlds-fastest-mobile-cpu-cores)
  - NPU up to 48 TOPS; some SKUs at the Copilot+ minimum of 40 TOPS.
  - Arc 100V iGPU XMX at 53–67 TOPS.
  - Intel claims 120 platform TOPS.
  - Systems shipped 24 Sep 2024.

**Intel-optimized frameworks**
- **PyTorch XPU (docs version 2.15)** — [PyTorch get_start_xpu 2.15](https://docs.pytorch.org/docs/2.15/notes/get_start_xpu.html)
  - Supported GPUs: Arc A-Series and B-Series, Core Ultra with Arc graphics (Meteor Lake-H, Arrow Lake-H, Lunar Lake, Panther Lake), Data Center GPU Max.
  - OS: Windows 11, Ubuntu 24.04/26.04, WSL2.
  - Install: `pip3 install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/xpu`. Check with `torch.xpu.is_available()`.
  - Training and inference, eager and `torch.compile`, and FP32/BF16/FP16/AMP are all supported.
  - `GradScaler` needs FP64, which Arc A-Series lacks, so disable it there.
- **Intel Extension for Scikit-learn (sklearnex)** — [GitHub scikit-learn-intelex](https://github.com/intel/scikit-learn-intelex)
  - Apache-2.0. Use `from sklearnex import patch_sklearn; patch_sklearn()`.
  - Claims "up to 100X" and an average 8.5x speedup "with equivalent mathematical accuracy".
  - CPU and GPU (`target_offload="gpu:0"`).
  - Python 3.11–3.15, scikit-learn 1.6–1.9.

**Access to Intel hardware**
- Intel Tiber AI Cloud offers a "learning node" quick start, free training through Learning services, and preview access to pre-release Intel hardware. The overview page lists no tiers, pricing or student credits — [Intel Tiber AI Cloud overview](https://console.cloud.intel.com/docs/about/ai_cloud_overview.html)
- An Intel Community thread titled "Request for Student Credits to Use Intel Tiber AI Cloud Platform" exists (title only, not read) — [Intel Community](https://community.intel.com/t5/Edge-Software-Catalog/Request-for-Student-Credits-to-Use-Intel-Tiber-AI-Cloud-Platform/m-p/1704149)

**Intel AI Global Impact Festival and Digital Readiness**
- Festival facts — [Intel Newsroom](https://newsroom.intel.com/artificial-intelligence/intel-recognizes-young-ai-changemakers-at-global-impact-festival)
  - Age categories 13–17 and 18+.
  - Projects judged on AI innovation, responsible technology use and social impact; winners also undergo an AI ethics audit by Intel technologists.
  - 32 countries submitted projects in the edition described.
  - Intel Digital Readiness programs have taught AI skills to more than 8 million people, through partnerships with 29 national governments and 27,000 institutions.
  - The page is undated. Award-winner countries listed: Moldova, United States, Singapore, China, India, Vietnam.
- Intel Digital Readiness program pages exist at intel.com (for example "AI for Workforce") — [Intel Digital Readiness](https://www.intel.com/content/www/us/en/corporate/artificial-intelligence/digital-readiness-home.html); [AI for Workforce](https://intel.com/digitalreadiness/aiforworkforce)

### Inferences
- **Evidence pack for judges**: a one-page "Intel proof" log, generated by one script (`env_report.py`) and committed with the results, recording:
  - OpenVINO version (`ov.get_version()`)
  - `ov.Core().available_devices`
  - `core.get_property(device, "FULL_DEVICE_NAME")` for CPU, GPU and NPU
  - NNCF and optimum-intel versions
  - `torch.xpu.get_device_name()` when using XPU
  - `benchmark_app -m model.xml -d CPU|GPU|NPU -hint latency|throughput` output (FPS and latency), saved as JSON or text
  - FP32 vs INT8 file size, accuracy and latency, all in one table
  
  The `FULL_DEVICE_NAME` property and `benchmark_app` are standard OpenVINO tools but were not re-verified on a fetched page this session.
- **LLM choice**: a 0.5B–1.5B Qwen-family model in INT4 is the safest "runs on NPU" choice, since Qwen2.5-1B-Instruct and Qwen-2.5-coder-0.5B appear in the 2026.0 NPU list. Keep a CPU/GPU fallback.
- **Version hygiene**: pin to OpenVINO 2026.4.x, use Python ≥ 3.11 (3.10 is dropped in 2026.5), use `import openvino as ov` (the old `openvino.runtime` imports break), and use `nncf.quantize` / `nncf.compress_weights` rather than the removed `create_compressed_model`.
- **Festival alignment**: the judging criteria (innovation, responsible use, social impact, ethics audit) map directly to the inclusion section (§5) and a short model card on bias, privacy and failure modes.

### Gaps
- The exact NPU GenAI requirements did not render from docs.openvino.ai, so these are UNVERIFIED and must be checked on the "OpenVINO GenAI on NPU" page before quoting:
  - INT4 symmetric, channel-wise (group_size −1) compression recommended for NPU.
  - Config keys MAX_PROMPT_LEN and MIN_RESPONSE_LEN, with defaults around 1024 and 128.
  - Export via `optimum-cli export openvino --weight-format int4 --sym --group-size -1 --ratio 1.0`.
- NNCF details were not fetched (GitHub returned an error): PTQ INT8 via `nncf.quantize` with about 300 calibration samples (UNVERIFIED), and weight-compression modes and data-aware methods (AWQ, scale estimation, GPTQ).
- Optimum Intel docs were not fetched.
- Intel AMX (Xeon 4th–6th gen) facts were not retrieved.
- Intel Tiber AI Cloud free-tier and student-credit specifics are unconfirmed. Intel's "AI PC Cloud" and university programs were not found.
- The full official list of Digital Readiness programs (AI for Youth, AI for Citizens, AI for Current/Future Workforce, etc.) was not verified, nor the date of the festival newsroom page.
- Lunar Lake per-SKU NPU TOPS (for example 200V low end vs 288V) was not tabulated.

---

## 5. Inclusion and accessibility evidence for Indonesia, plus WCAG 2.2 and lightweight PWA

### Takeaway
APJII 2025: 229.43 million Indonesians online (80.66% of 284.43 million). That leaves about 55 million offline, and the gap is regional: Java 84.69% vs Papua 69.26%. Komdigi's IMDI 2025 is only 44.53/100, with the "Pemberdayaan" (empowerment) pillar lowest at 34.42. That justifies a plain-language, low-friction PWA rather than a feature-heavy app. Motorcycles are 137.35 million of 164.14 million registered vehicles (83.6%), and Gojek alone reports about 3 million driver partners, so two-wheeler riders, who are most exposed to potholes, are the natural reporters and beneficiaries. WCAG 2.2 (Oct 2023) adds 24×24 CSS-pixel minimum targets, alternatives to dragging, and accessible authentication, all directly relevant to a one-handed photo-reporting flow.

### Cited Findings

**APJII 2025 survey** — [detik inet](https://inet.detik.com/telecommunication/d-8047759/survei-apjii-pengguna-internet-indonesia-2025-tembus-229-juta-jiwa)
- 229,428,417 internet users out of a population of 284,430,900, so penetration is 80.66%.
- Trend: 64.80% (2018), 73.70% (2020), 77.01% (2022), 78.19% (2023), 79.50% (2024), 80.66% (2025).
- Method: 8,700 respondents, multistage random sampling, proportional to size.
- Penetration by region: Java 84.69%, Kalimantan 78.72%, Sumatra 77.12%, Bali & Nusa Tenggara 76.86%, Sulawesi 71.64%, Papua 69.26%.
- Share of users by generation: Gen Z 25.54%, Millennials 25.17%, Gen Alpha 23.19%, Gen X 18.15%, Boomers 7.53%, pre-boomers 0.43%.
- Users by gender: 51.50% men, 48.50% women.
- Media headline on the same survey: "55 Juta Orang Indonesia Belum Dapat Akses Internet di 2025" — [Suara](https://www.suara.com/tekno/2025/08/06/190354/riset-apjii-55-juta-orang-indonesia-belum-dapat-akses-internet-di-2025)
- Java accounts for 58% of internet users, Maluku and Papua 3.71% — [Bisnis.com](https://teknologi.bisnis.com/read/20250806/101/1900053/kontribusi-pengguna-internet-paling-banyak-di-jawa-58-maluku-dan-papua-371)

**IMDI 2025 (Komdigi digital society index)** — [Bisnis.com](https://teknologi.bisnis.com/read/20251006/101/1917721/skor-digital-ri-imdi-capai-4453-infrastruktur-tertinggi-pemberdayaan-terendah)
- Score 44.53, up 1.19 from 43.34 in 2024; earlier 43.18 (2023) and 37.80 (2022).
- Pillars: Infrastruktur & Ekosistem 53.06 (highest), Pemberdayaan 34.42 (lowest).
- The Digital Literacy Index (ILD) was integrated into IMDI for the first time.
- Fieldwork July–August 2025, with more than 18,000 individual and 11,000 industry respondents across 38 provinces and 514 kabupaten/kota, using a method adapted from the G20 digital skills toolkit.
- Top provinces: DKI Jakarta 56.97, Bangka Belitung 52.15, Jawa Barat 52.05.
- A GoodStats headline says the digital literacy score fell even though IMDI rose (headline only, not read) — [GoodStats](https://goodstats.id/article/imdi-2025-naik-tapi-kenapa-skor-literasi-digital-masyarakat-indonesia-malah-turun-VyA7i)

**Motorcycles and ojol drivers**
- 164,136,793 registered vehicles, of which 137,350,299 are motorcycles (83.6%). Korlantas Polri data as of 29 Aug 2024 — [CNN Indonesia](https://www.cnnindonesia.com/otomotif/20241004133318-579-1151516/ju)
- Gojek driver partners (motorcycle, car and taxi) were about 3 million at end-2024 and about 3 million at end-2025, per GoTo reporting (Databoks, 12 Oct 2026) — [Databoks](https://databoks.katadata.co.id/transportasi-logistik/statistik/6acca4a56344e/jumlah-mitra-pengemudi-gojek-periode-2021-2025)

**WCAG 2.2** (released October 2023; 4.1.1 Parsing removed as obsolete) — [Deque WCAG 2.2](https://dequeuniversity.com/resources/wcag-2.2)
- 2.4.11 Focus Not Obscured (Minimum), AA
- 2.5.7 Dragging Movements, AA: a single-pointer alternative is required
- 2.5.8 Target Size (Minimum), AA: at least 24×24 CSS px
- 3.2.6 Consistent Help, A
- 3.3.7 Redundant Entry, A
- 3.3.8 Accessible Authentication (Minimum), AA: no cognitive function tests
- AAA criteria: 2.4.12, 2.4.13, 3.3.9

### Inferences
- **Design implications to state in the interview**:
  - Offline-first PWA: queue reports in IndexedDB and sync when back online, for the roughly 55 million offline people and patchy coverage outside Java.
  - Compress photos on the device to a few hundred kB before upload.
  - No-password login (OTP or anonymous reporting), to meet WCAG 3.3.8 and lower friction for low-literacy users.
  - Tap targets of 48 px or more (above the WCAG 24 px minimum), for one-handed use by riders.
  - GPS auto-fill so users never retype location (3.3.7 Redundant Entry).
  - Bahasa Indonesia microcopy at a primary-school reading level, plus voice or icon alternatives.
  - On-device LLM explains repair status in plain Bahasa.
- **Who to engage**: ojol drivers (about 3 million Gojek partners alone) are a concrete pilot partner group. They ride daily, are exposed to potholes, and are already smartphone-native.
- **Low IMDI empowerment score (34.42)**: frame the app as turning passive complainants into data contributors with visible feedback, such as "laporanmu sudah diverifikasi" ("your report has been verified").

### Gaps
- Not retrieved:
  - Smartphone ownership rate and the share of low-end or low-RAM Android devices in Indonesia.
  - Mobile data cost per GB (sources such as cable.co.uk or ITU would give this).
  - 2G/3G/4G coverage gaps by kabupaten (for example BAKTI blank-spot data).
  - Disability prevalence (BPS/Susenas) and elderly smartphone use.
  - Grab Indonesia driver count.
- The full APJII PDF (smartphone %, urban/rural split, penetration by age group) was not read; the GoodStats preview of the 131-page publication exists — [GoodStats APJII 2025 PDF](https://goodstats.id/publication/survei-penetrasi-internet-dan-perilaku-pengguna-internet-2025-7SF3g)
- No official Bahasa Indonesia plain-language guideline was found (for example a Badan Bahasa or PANRB "bahasa sederhana" guide).
- No verified source was fetched for PWA best practices (offline queue via Workbox Background Sync, image compression budgets). Cite web.dev or MDN after checking.
- The IMDI pillar scores for Keterampilan Digital and Pekerjaan, and the ILD sub-score, are not in the article read.

---

## 6. User testing: SUS, sample size, task metrics, ethical field pilot

### Takeaway
Use SUS: the average is 68 (50th percentile). On the Sauro-Lewis curved scale, 80.8 or above is A and 84.1 or above is A+; scores above about 70 are "acceptable" and below 50 "not acceptable". For problem-finding, Nielsen's model says 5 users find about 85% of problems (L = 31%). Test 3–4 per distinct user group (for example riders vs elderly residents), and use about 20 users for quantitative claims. Run several small rounds rather than one large study.

### Cited Findings
- **SUS benchmarks (Sauro, "5 Ways to Interpret a SUS Score", 19 Sep 2018)** — [MeasuringU](https://measuringu.com/interpret-sus-score/)
  - Average 68 = 50th percentile; 75 = 73rd percentile; 52 = 15th percentile.
  - Curved grades: A+ 84.1–100, A 80.8–84.0, A− 78.9–80.7, B+ 77.2–78.8, B 74.1–77.1, B− 72.6–74.0, C+ 71.1–72.5, C 65.0–71.0, C− 62.7–64.9, D 51.7–62.6, F 0–51.6.
  - Acceptability: acceptable above about 70, marginal 50–70, not acceptable below 50.
  - Adjective ratings (Bangor et al.): "Good" about 71, "OK" about 51.
  - NPS link: promoters average about 81 SUS, detractors 53 or below, R² about 0.42.
  - Benchmark built on more than 10,000 responses across hundreds of products.
- **Nielsen, "Why You Only Need to Test with 5 Users" (NN/g, 18 Mar 2000)** — [NN/g](https://nngroup.com/articles/why-you-only-need-to-test-with-5-users/)
  - Problems found = N(1 − (1 − L)ⁿ), with typical L = 31%.
  - 5 users find about 85% of problems.
  - Three 5-user rounds beat one 15-user study.
  - For 2 distinct groups, test 3–4 users per group; for 3 or more groups, at least 3 per group.
  - Quantitative studies need about 20 users.
- The original SUS literature and a validation review are in the Journal of Usability Studies (Lewis, May 2018) — [JUS Lewis 2018 PDF](https://uxpajournal.org/wp-content/uploads/sites/7/pdf/JUS_Lewis_May2018.pdf)

### Inferences
- **Pilot plan to quote**:
  - 2 rounds × 5–8 participants: about 4 ojol or motorcycle riders, 2 elderly residents, and 1–2 RT/RW or kelurahan staff, matching Nielsen's per-group guidance.
  - Tasks: (1) report a pothole offline, (2) check the status of a report, (3) ask the in-app assistant what "retak buaya" (alligator cracking) means.
  - Metrics: task success %, time-on-task (median), error count, SUS. Use an Indonesian-translated SUS and say so; the translation must be validated or cited.
  - Target: SUS of 71 or above ("Good"/acceptable), with 80.8 or above as the A-grade stretch goal.
- **Ethics (minimum practice)**:
  - Informed consent in Bahasa.
  - No faces or licence plates in stored photos: blur on device before upload.
  - Store location at report level only, not user tracking.
  - Let participants withdraw.
  - Do not have participants photograph from a moving vehicle; the reporting flow should say "berhenti dulu sebelum memotret" ("stop before taking the photo").
  - Record the pilot as a usability evaluation, not human-subjects research, unless the university requires ethics review. Check with the advisor.

### Gaps
- No validated Bahasa Indonesia SUS translation was found or cited (search needed, for example Sharfina and Santoso 2016, UNVERIFIED).
- No source was fetched on research-ethics requirements in Indonesia: UU 27/2022 Pelindungan Data Pribadi (personal data protection law, UNVERIFIED citation) and university ethics-committee rules for usability pilots.
- Benchmarks for time-on-task and task success (for example MeasuringU's 78% average completion rate, UNVERIFIED) were not fetched.
