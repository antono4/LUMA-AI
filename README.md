# LUMA-AI ✨

Chat assistant dengan backend Python (FastAPI + OpenHands SDK) dan antarmuka React.

- **Coba langsung:** https://antono4.github.io/LUMA-AI/ — pratinjau statis, balasan contoh.
- Untuk mengobrol dengan model sungguhan, jalankan backend secara lokal (lihat di bawah).

## ✨ Fitur

- 💬 Antarmuka chat dengan streaming balasan (SSE)
- 🗂️ Riwayat percakapan tersimpan (SQLite)
- 🛑 Kontrol percakapan: stop, pause, resume
- 📁 Daftar berkas di workspace percakapan
- 🧪 Mode demo otomatis saat backend tidak tersedia

## 🛠️ Teknologi

| Bagian | Teknologi |
| --- | --- |
| Frontend | React 18, TypeScript, Vite, Tailwind CSS |
| Backend | Python, FastAPI, SQLAlchemy, SQLite |
| Agen | OpenHands SDK |
| Streaming | Server-Sent Events (SSE) |

## 🚀 Menjalankan secara lokal

Butuh dua terminal.

**1. Backend**

```bash
cd backend
pip install -r requirements.txt
export LLM_MODEL=gpt-4o
export OPENAI_API_KEY=sk-...
python main.py
```

Backend berjalan di `http://localhost:8000`. Cek dengan `curl localhost:8000/health`.

Variabel lingkungan yang dikenali:

| Variabel | Default | Keterangan |
| --- | --- | --- |
| `LLM_MODEL` | `gpt-4o` | Nama model, boleh berprefix provider (mis. `openai/gpt-4o`) |
| `OPENAI_API_KEY` | – | Kunci API; alias `LLM_API_KEY` juga diterima |
| `LLM_BASE_URL` | – | Endpoint alternatif yang kompatibel OpenAI |

**2. Frontend**

```bash
cd frontend
npm install
npm run dev
```

Buka `http://localhost:3000`. Vite mem-proxy `/api` dan `/health` ke backend.

## 🌐 Pratinjau statis (GitHub Pages)

Situs di GitHub Pages hanya menyajikan berkas statis, jadi tidak ada backend.
Bundel dibangun dengan mode demo:

```bash
cd frontend
npm install
VITE_DEMO_MODE=true npm run build:pages   # hasil ke ../docs
```

GitHub Pages menyajikan dari root repositori, jadi salin juga ke root:

```bash
cp -r frontend/dist/assets/* assets/
cp frontend/dist/index.html index.html
```

Dalam mode demo, antarmuka tetap bisa dipakai dan balasan berasal dari data contoh di
dalam browser. Banner oranye menandai bahwa model tidak dipanggil.

## 📁 Struktur proyek

```
LUMA-AI/
├── backend/
│   ├── main.py            # REST + SSE API
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.tsx        # UI chat
│   │   ├── lib/api.ts     # Klien REST + parser SSE
│   │   ├── lib/demo.ts    # Backend contoh untuk mode statis
│   │   └── types/
│   └── vite.config.ts
├── assets/                # Bundel yang disajikan Pages (root)
├── docs/                  # Salinan bundel yang sama
└── index.html
```

## 🔌 API

| Metode | Path | Keterangan |
| --- | --- | --- |
| `GET` | `/health` | Status layanan |
| `GET` | `/api/conversations` | Daftar percakapan |
| `POST` | `/api/conversations` | Buat percakapan |
| `GET` | `/api/conversations/{id}` | Detail percakapan |
| `DELETE` | `/api/conversations/{id}` | Hapus percakapan |
| `POST` | `/api/conversations/{id}/messages` | Kirim pesan, balas via SSE |
| `POST` | `/api/conversations/{id}/stop` | Hentikan proses |
| `POST` | `/api/conversations/{id}/pause` | Jeda proses |
| `POST` | `/api/conversations/{id}/resume` | Lanjutkan proses |
| `GET` | `/api/conversations/{id}/files` | Berkas di workspace |

Balasan `POST /messages` berupa SSE dengan tiga jenis event:

```
event: message_start
data: {"id": "...", "role": "assistant"}

event: content
data: {"content": "...", "kind": "message", "tool": ""}

event: message_end
data: {"id": "..."}
```

Jika proses gagal, server mengirim `event: error` berisi `{"error": "..."}`.

## 👤 Author

**Antono4**
- GitHub: [@antono4](https://github.com/antono4)

## 📄 License

Open source, tersedia di bawah [MIT License](LICENSE).
