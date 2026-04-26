# Genie AI Website Builder

This project has two apps:
- `client` (React + Vite)
- `server` (Node.js + Express + Prisma)

## Prerequisites
- Node.js 20+
- npm
- PostgreSQL database (Neon or any Postgres provider)

## 1) Environment Variables

### Client (`client/.env`)
Create `client/.env` with:

```env
VITE_BASEURL=http://localhost:3000
```

For production/deployed frontend, use your Render backend URL:

```env
VITE_BASEURL=https://genie-ai-website-builder.onrender.com
```

### Server (`server/.env`)
Create `server/.env` with these keys:

```env
TRUSTED_ORIGINS=http://localhost:5173,http://localhost:3000
DATABASE_URL=postgresql://<username>:<password>@<host>/<db>?sslmode=require
BETTER_AUTH_SECRET=replace_with_strong_random_secret
BETTER_AUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
NODE_ENV=development
AI_API_KEY=your_ai_api_key
OPENAI_API_KEY=your_openai_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret
```

### Production notes (Render)
In Render server environment variables:
- `TRUSTED_ORIGINS`: add your frontend URL(s) (and localhost if needed)
- `BETTER_AUTH_URL`: `https://genie-ai-website-builder.onrender.com`
- `NODE_ENV`: `production`
- `DATABASE_URL` and all API keys/secrets must be set

## 2) Install Dependencies
From project root:

```bash
cd client
npm install

cd ../server
npm install
```

## 3) Start Project (Local)

### Start backend
```bash
cd server
npm run dev
```
Backend runs on `http://localhost:3000`.

### Start frontend
Open another terminal:

```bash
cd client
npm run dev
```
Frontend runs on `http://localhost:5173`.

## 4) Build Commands

### Client build
```bash
cd client
npm run build
```

### Server build
```bash
cd server
npm run build
```

## 5) API Routes (Server)
Main routes:
- `GET /` health check
- `/api/auth/*` auth routes
- `/api/user/*` user routes
- `/api/project/*` project routes

## 6) Security
- Never commit real `.env` secrets.
- Keep `.env` local and use deployment environment variables in Render.
- Rotate keys immediately if a secret is exposed.
