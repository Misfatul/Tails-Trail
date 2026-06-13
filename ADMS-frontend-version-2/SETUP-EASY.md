# Tails Trail Easy Setup

Follow these steps once. After that, the app should open normally.

## What I already set up

- Node.js is installed on this PC.
- Project dependencies are installed in `node_modules`.
- A separate local MySQL instance for this project is prepared on port `3307`.
- The app is configured to use a dedicated local DB user automatically.

## What you still need to do

### 1. Start the app

In this folder, double-click:

```text
start-app.cmd
```

Or run this in PowerShell:

```powershell
cd "c:\Users\Administrator\Documents\7th sem project\Tail trails\ADMS-frontend-version-2"
.\start-app.cmd
```

This also starts the local MySQL server if it is not already running.

### 2. Open the website

Open this in your browser:

```text
http://localhost:8080
```

## First use inside the app

1. Log in from the first screen.
2. Demo login: `misfa@gmail.com` / `12345`.
3. The app opens the protected pet dashboard after login.
4. Use `Add pet` to create profiles.
5. Click any pet card to open its full health profile.

## If you still see `Failed to fetch`

- Make sure `start-app.cmd` is still running.
- Make sure you opened `http://localhost:8080`, not the raw `index.html` file.
- Wait a few seconds after starting so MySQL and Node both finish booting.
- If needed, start the database by itself using `start-db.cmd`.
- The frontend falls back to `http://localhost:8080/api` when opened from another local origin, but the Node backend still must be running.
