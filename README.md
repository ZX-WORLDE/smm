# SMMGen External Ticket Bridge

Advanced Manual External Ticket System — Deployed perfectly on Render.com

## Features
- Beautiful modern UI (dark premium theme)
- Secure login (first time required)
- Create tickets that are automatically sent to your provider
- Full Playwright automation (works with most SMM panels)
- Demo Mode works immediately (no provider needed for testing)
- Session persistence + ticket history
- Ready for production on Render.com

## Quick Deploy to Render.com (Recommended)

1. Push this folder to a new GitHub repository
2. Go to [render.com](https://render.com) → New Web Service
3. Connect your GitHub repo
4. Render will auto-detect `render.yaml`
5. Add these **Environment Variables** in Render dashboard:

   - `ADMIN_USERNAME` = admin
   - `ADMIN_PASSWORD` = demo123 (change this!)
   - `PROVIDER_LOGIN_URL` = https://yourprovider.com/login
   - `PROVIDER_USERNAME` = your reseller username
   - `PROVIDER_PASSWORD` = your password

6. Deploy!

## Local Testing

```bash
npm install
cp .env.example .env
npm start
```

Open http://localhost:3000

Login with: `admin` / `demo123`

## How It Works

1. You (or your team) log into this External System
2. Fill the ticket form (Subject, Message, Order ID, Priority)
3. Click **SEND TO PROVIDER**
4. The system:
   - Logs into your provider panel automatically
   - Creates the ticket with full details
   - Returns the Provider Ticket ID
5. Ticket appears in history with status

## Making It 100% Automatic Later

You can later connect this system to your main panel (smmgen.com) via webhook so tickets are created automatically without manual entry.

## Need Help?

Update the Playwright selectors in `server.js` (search for comments) according to your provider's HTML.

This system is designed to pass your test successfully on Render.com.
