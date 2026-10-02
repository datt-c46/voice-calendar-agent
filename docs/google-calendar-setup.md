# Google Calendar OAuth 2.0 Setup Guide

This guide walks you through configuring **Google Calendar API** credentials for the Voice Calendar Agent desktop application.

---

## 1. Overview of Authentication Architecture

The Voice Calendar Agent uses the standard **Google OAuth 2.0 for Desktop Applications** (RFC 8252 BCP):

- **Local Loopback Callback**: A temporary local HTTP server listens strictly on `http://127.0.0.1:<ephemeral-port>/oauth2callback`.
- **System Browser**: The user authenticates in their default system browser (Google blocks embedded webviews for OAuth).
- **CSRF Protection**: Every authentication request generates a cryptographically random 32-byte `state` parameter verified upon callback.
- **Server Lifecycle**: The callback server closes immediately upon receiving the authorization code, with a strict 120-second timeout.
- **Encrypted Storage**: OAuth refresh and access tokens are encrypted on disk via Electron's native `safeStorage` (Windows DPAPI / macOS Keychain) under `userData/auth_tokens.bin`. Tokens are **never** exposed to the React renderer or logged to the console.
- **Automatic Fallback**: If credentials are missing, the application automatically runs in **Mock Calendar Mode**.

---

## 2. Google Cloud Project Setup

### Step 1: Create a Project in Google Cloud Console

1. Navigate to the [Google Cloud Console](https://console.cloud.google.com/).
2. Click **Select a project** > **New Project**.
3. Name your project (e.g., `Voice-Calendar-Agent`) and click **Create**.

### Step 2: Enable the Google Calendar API

1. Open the [API Library](https://console.cloud.google.com/apis/library).
2. Search for **Google Calendar API**.
3. Click **Enable**.

---

## 3. Configure OAuth Consent Screen

1. In the sidebar, go to **APIs & Services** > **OAuth consent screen**.
2. Select **External** user type and click **Create**.
3. Fill in the App Information:
   - **App name**: `Voice Calendar Agent`
   - **User support email**: Your email address
   - **Developer contact information**: Your email address
4. Click **Save and Continue**.
5. Under **Scopes**:
   - Click **Add or Remove Scopes**.
   - Add the following scopes:
     - `https://www.googleapis.com/auth/calendar`
     - `https://www.googleapis.com/auth/calendar.events`
     - `https://www.googleapis.com/auth/userinfo.email`
   - Click **Update** and then **Save and Continue**.
6. Under **Test Users**:
   - Click **+ Add Users**.
   - Enter your personal Google email address (the account whose calendar you want to test with).
   - Click **Add** and then **Save and Continue**.

---

## 4. Create Desktop OAuth 2.0 Credentials

1. Go to **APIs & Services** > **Credentials**.
2. Click **+ Create Credentials** > **OAuth client ID**.
3. In the **Application type** dropdown, select **Desktop app**.
4. Name the client (e.g., `Voice Calendar Agent Desktop`).
5. Click **Create**.
6. A dialog will show your **Client ID** and **Client Secret**.

---

## 5. Configure Local Environment Variables

1. Copy `.env.example` to `.env` in the root of the project:
   ```bash
   cp .env.example .env
   ```
2. Open `.env` and fill in your values (do NOT prefix with `VITE_`):
   ```env
   GOOGLE_CLIENT_ID=your-client-id-here.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-your-client-secret-here
   ```
3. Verify `.env` is ignored by git (already specified in `.gitignore`). **Never commit your `.env` file.**

---

## 6. Running the Application

1. Install dependencies:
   ```bash
   pnpm install
   ```
2. Start the development app:
   ```bash
   pnpm run dev
   ```

---

## 7. Connecting Google Calendar

1. Launch the app. The header will display:
   ```
   [📅 Connect Google Calendar]
   ```
2. Click **Connect Google Calendar**.
3. Your default web browser will open Google's OAuth consent page.
4. Log in with the **Test User** email address added in Step 3.
5. If you see the "Google hasn't verified this app" warning, click **Advanced** > **Go to Voice Calendar Agent (unsafe)**.
6. Grant permissions to view and edit calendar events.
7. Upon consent, the browser redirects to the local loopback server (`http://127.0.0.1:<port>/oauth2callback`).
8. The browser tab displays:
   > "✅ Kết nối Google Calendar thành công!"
9. The Electron app header immediately updates:
   ```
   🟢 Google: user@gmail.com   [Disconnect]
   ```
   and the calendar mode badge switches to `GOOGLE (X events)`.

---

## 8. Disconnecting Google Calendar

1. Click the `[Disconnect]` link in the header next to your email.
2. The stored tokens in `auth_tokens.bin` are securely purged from disk.
3. The application dynamically falls back to **Mock Calendar Mode**.

---

## 9. Mock Mode (Zero-Config Fallback)

If:

- `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` is missing in `.env`, or
- You launch the app offline without an internet connection, or
- You disconnect your Google account:

The application **automatically defaults to Mock Mode**:

- Seeded with realistic sample events for today and tomorrow.
- All CRUD operations (`LIST_EVENTS`, `CREATE_EVENT`, `UPDATE_EVENT`, `DELETE_EVENT`) continue to function in-memory without error.

---

## 10. Security Notes

- **Secrets Isolation**: Client secrets and tokens reside solely within Electron's Node.js Main process. The React renderer only receives `AuthStatusDTO` (`{ isAuthenticated: boolean, userEmail: string | null }`).
- **Loopback Port Binding**: The ephemeral callback server binds exclusively to `127.0.0.1`, preventing access from other machines on your local network.
- **State Validation**: Mitigates Cross-Site Request Forgery (CSRF).
- **Token Encryption**: Stored tokens are encrypted using OS-level credentials (`DPAPI` on Windows, `Keychain` on macOS).
