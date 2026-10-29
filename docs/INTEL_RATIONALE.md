# Mengapa memilih perangkat lunak dan perangkat keras Intel (SPEC §5)

1. **Satu runtime untuk CPU, iGPU dan NPU (OpenVINO).** Deteksi kerusakan, segmentasi retak, CLIP dan surrogate PINN memakai format IR yang sama, sehingga model yang diuji di laptop berjalan sama di server Xeon dan di laptop lapangan Core Ultra. Di laptop AMD kami, runtime CPU yang sama sudah berjalan: deteksi ±20 ms (INT8), surrogate 15,6 µs per struktur (`measurements/pinn2.json`).
2. **Akurasi terkendali saat dikompresi (NNCF).** INT8 dipakai hanya bila kecocokannya dengan FP32 tercatat (`int8Agreement`). Bobot CLIP dikompresi INT8 agar muat di perangkat kecil.
3. **Model bahasa lokal (OpenVINO GenAI).** Draf usulan penanganan dibuat tanpa mengirim data warga atau data instansi ke layanan luar, dan tetap bisa dipakai saat internet kantor dinas terbatas. Di Core Ultra, NPU menjalankannya tanpa membebani CPU yang dipakai deteksi.
4. **Monte Carlo fisika secara real time.** Diagnosis PINN-2 mengevaluasi 2.000 struktur per ruas; surrogate OpenVINO ±2.100× lebih cepat dari solver PyMastic. Di Xeon dengan **Intel AMX**, pelatihan surrogate/PINN-1 (bf16) dan layanan multi-instansi bisa berjalan di satu server.
5. **Program Intel Digital Readiness.** AI Global Impact Festival termasuk program Intel Digital Readiness; materi yang diikuti tim dicatat di `docs/evidence/intel_program.md`.

Batasan yang kami akui: belum ada pengukuran di perangkat keras Intel. Hasil iGPU AMD (crash di LLM) bukan ukuran kinerja Intel GPU.
