# Piper TTS Models Directory

Đặt các file model Piper (`.onnx` và `.onnx.json`) vào thư mục này để Voice Calendar Agent tự động nhận diện và sử dụng.

### Các Voice Model tiếng Việt được đề xuất cho Piper:

1. **VIVOS (x_low / low / medium)** - Giọng đọc tiếng Việt tự nhiên và cực nhẹ:
   - `vi_VN-vivos-x_low.onnx` + `vi_VN-vivos-x_low.onnx.json`
2. **25Hours (low / medium)** - Giọng đọc tiếng Việt 25 giờ:
   - `vi_VN-25hours-low.onnx` + `vi_VN-25hours-low.onnx.json`

### Tải từ HuggingFace hoặc GitHub Releases:
- HuggingFace repository: `https://huggingface.co/rhasspy/piper-voices/tree/main/vi/vi_VN`
- Piper official releases: `https://github.com/rhasspy/piper/releases`

### Binary Piper:
- Đặt file thực thi `piper.exe` vào thư mục `resources/piper/piper.exe` hoặc chỉ định đường dẫn qua biến `PIPER_BINARY_PATH` trong file `.env`.
