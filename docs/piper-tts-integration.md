# Piper Neural Text-to-Speech (TTS) Integration Guide

Tài liệu hướng dẫn kiến trúc và cách cấu hình mô hình Piper TTS trong hệ thống Voice Calendar Agent.

---

## 1. Tổng quan Kiến trúc Piper TTS

```
[Agent Orchestrator / Streaming Response]
                 │
                 ▼
[TextToSpeechService / TTSQueue]
                 │
                 ├── Provider Abstraction (ITextToSpeechProvider)
                 │         ├── PiperTtsProvider (Local Neural TTS)
                 │         ├── WebSpeechTtsProvider (Chromium Native)
                 │         └── MockTtsProvider (CI / Offline Tests)
                 ▼
     [PiperTtsProvider (Renderer)]
                 │
                 │ IPC (tts:piper:synthesize)
                 ▼
     [PiperTtsManager (Main Process)]
                 │
                 ├── 1. Tự động quét Model (.onnx, .onnx.json) trong `resources/models/piper/`
                 ├── 2. Thực thi CLI piper.exe / Python piper hoặc Web Audio stream
                 └── 3. Trả về WAV Base64 payload
                 ▼
     [HTML5 Audio / Web Audio Output]
```

---

## 2. Cấu hình Model Piper Tiếng Việt

Voice Calendar Agent đã tích hợp sẵn hỗ trợ các mô hình Piper tiếng Việt:

1. **`vi_VN-vivos-x_low`** (Khuyên dùng - Nhẹ, tốc độ phản hồi cao).
2. **`vi_VN-25hours-low`** / **`vi_VN-25hours-medium`** (Chất lượng giọng đọc tốt).

### Vị trí đặt file model:
- Đặt các file `.onnx` và `.onnx.json` vào thư mục:
  ```
  resources/models/piper/
  ├── vi_VN-vivos-x_low.onnx
  └── vi_VN-vivos-x_low.onnx.json
  ```

---

## 3. Cấu hình biến môi trường (`.env`)

Bạn có thể tùy chỉnh đường dẫn binary và model Piper qua file `.env`:

```ini
# Đường dẫn file thực thi piper (nếu có)
PIPER_BINARY_PATH=resources/piper/piper.exe

# Hoặc chỉ định trực tiếp file model & config
PIPER_MODEL_PATH=resources/models/piper/vi_VN-vivos-x_low.onnx
PIPER_CONFIG_PATH=resources/models/piper/vi_VN-vivos-x_low.onnx.json

# Hoặc thư mục chứa danh sách các model
PIPER_MODEL_DIR=resources/models/piper
```

---

## 4. Kiểm thử tích hợp

Chạy test suite cho Piper TTS:

```bash
npx tsx test/milestone3_3_piper_tts.test.ts
```
