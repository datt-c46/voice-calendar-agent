# voice-calendar-agent

An Electron application with React and TypeScript

## Kết nối voice-backend

App là client mỏng của [`voice-backend`](../voice-backend): đăng nhập Google, lịch, agent, nhận dạng giọng nói (STT) và giọng đọc (Piper TTS) đều chạy trên server. Main process giữ token (mã hóa bằng `safeStorage`), renderer không bao giờ thấy token.

1. Chạy backend (xem `../voice-backend/README.md`), mặc định ở `http://localhost:4000`.
2. Tạo `.env` từ `.env.example` nếu backend ở địa chỉ khác (`VOICE_BACKEND_URL`). App chỉ đọc các khóa `VOICE_BACKEND_*`, nên có thể xóa `GOOGLE_CLIENT_SECRET` / `GEMINI_API_KEY` cũ khỏi `.env` (và nên thu hồi chúng trên Google Cloud).
3. `pnpm dev` → bấm **Đăng nhập bằng Google** (mở trình duyệt, loopback + PKCE). Với server dev có `AUTH_DEV_LOGIN_ENABLED=true`, đặt `VOICE_BACKEND_DEV_EMAIL` để có nút **Đăng nhập dev** (dùng lịch local trên server).

Xóa/sửa lịch cần xác nhận: bấm **Xác nhận/Hủy** hoặc nói "có"/"không".

### Test

```bash
pnpm test        # unit: client backend (fake server), handler IPC, đăng nhập PKCE, TTS/streaming, tiện ích
pnpm test:e2e    # end-to-end với voice-backend THẬT (~40 giây)
```

`pnpm test:e2e` tự làm hết:
- build `../voice-backend` nếu cần (đổi bằng `VOICE_BACKEND_DIR`);
- tạo database tạm trên `postgres-test` (cổng 55433, tự `docker compose up -d postgres-test` nếu chưa chạy; đổi bằng `E2E_DATABASE_ADMIN_URL`) và xóa nó khi xong;
- chạy backend với dev login, NLU rule, TTS mock và một Gemini giả cục bộ (`GOOGLE_GEMINI_BASE_URL`);
- chạy hai bộ test:
  - `test/e2e/api.e2e.ts`: mọi kênh `window.api` qua code main thật.
  - `test/e2e/gui.e2e.ts`: mở app Electron thật, điều khiển qua DevTools protocol. Micro giả phát `/usr/share/sounds/alsa/Front_Center.wav` (đổi bằng `E2E_SPEECH_WAV`), nên chạy đủ chuỗi VAD → STT → agent → TTS.

Bộ GUI cần màn hình (DISPLAY), sẽ tự bỏ qua nếu không có. Cửa sổ app hiện lên trong lúc chạy. Dữ liệu app nằm trong thư mục tạm, không đụng profile thật.

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ pnpm install
```

### Development

```bash
$ pnpm dev
```

### Build

```bash
# For windows
$ pnpm build:win

# For macOS
$ pnpm build:mac

# For Linux
$ pnpm build:linux
```
