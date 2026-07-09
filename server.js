require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const { chromium } = require('playwright');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Session
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

// Config
const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'demo123';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'smmgen_webhook_2026_secure_key';

// In-memory storage (replace with DB later)
let createdTickets = [];

// Auth middleware
function requireLogin(req, res, next) {
  if (req.session && req.session.loggedIn) return next();
  res.redirect('/login');
}

// ==================== ROUTES ====================

app.get('/login', (req, res) => {
  if (req.session.loggedIn) return res.redirect('/dashboard');
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.loggedIn = true;
    req.session.username = username;
    return res.redirect('/dashboard');
  }
  res.render('login', { error: 'Invalid credentials. Use admin / demo123' });
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/dashboard', requireLogin, (req, res) => {
  const webhookUrl = `${req.protocol}://${req.get('host')}/webhook/create-ticket`;
  res.render('dashboard', {
    username: req.session.username,
    tickets: createdTickets.slice().reverse(),
    success: req.query.success || null,
    ticketId: req.query.ticketId || null,
    error: req.query.error || null,
    webhookUrl
  });
});

// ==================== WEBHOOK ENDPOINT (For smmgen.com) ====================
app.post('/webhook/create-ticket', async (req, res) => {
  const apiKey = req.headers['x-api-key'] || req.body.api_key;

  // Simple security
  if (apiKey !== WEBHOOK_SECRET) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const { subject, message, orderId, priority = 'Normal' } = req.body;

  if (!subject || !message) {
    return res.status(400).json({ success: false, error: 'subject and message are required' });
  }

  try {
    const result = await createTicketOnProvider({ subject, message, orderId: orderId || 'N/A', priority });

    const newTicket = {
      id: Date.now(),
      subject,
      message,
      orderId: orderId || 'N/A',
      priority,
      providerTicketId: result.providerTicketId,
      status: result.success ? 'Sent via Webhook' : 'Failed',
      createdAt: new Date().toISOString(),
      source: 'webhook',
      demoMode: result.demoMode
    };

    createdTickets.push(newTicket);

    res.json({
      success: result.success,
      providerTicketId: result.providerTicketId,
      message: result.success ? 'Ticket created on provider' : 'Failed to create ticket'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

// ==================== MANUAL CREATE ====================
app.post('/create-ticket', requireLogin, async (req, res) => {
  const { subject, message, orderId, priority } = req.body;

  if (!subject || !message) {
    return res.redirect('/dashboard?error=Subject and Message are required');
  }

  try {
    const result = await createTicketOnProvider({
      subject, message, orderId: orderId || 'N/A', priority: priority || 'Normal'
    });

    const newTicket = {
      id: Date.now(),
      subject,
      message,
      orderId: orderId || 'N/A',
      priority: priority || 'Normal',
      providerTicketId: result.providerTicketId,
      status: result.success ? 'Sent to Provider' : 'Failed',
      createdAt: new Date().toISOString(),
      source: 'manual',
      demoMode: result.demoMode
    };

    createdTickets.push(newTicket);

    const redirect = result.success 
      ? `/dashboard?success=Ticket sent to provider successfully!&ticketId=${result.providerTicketId}`
      : `/dashboard?error=Failed to create ticket on provider side`;

    res.redirect(redirect);
  } catch (error) {
    console.error(error);
    res.redirect('/dashboard?error=Automation failed. Check server logs.');
  }
});

// ==================== CORE AUTOMATION (Playwright) ====================
async function createTicketOnProvider(data) {
  const loginUrl = process.env.PROVIDER_LOGIN_URL;
  const ticketUrl = process.env.PROVIDER_TICKET_URL;
  const pUser = process.env.PROVIDER_USERNAME;
  const pPass = process.env.PROVIDER_PASSWORD;

  // DEMO MODE
  if (!loginUrl || !pUser || !pPass) {
    await new Promise(r => setTimeout(r, 900));
    return {
      success: true,
      providerTicketId: 'PRV-' + Math.floor(100000 + Math.random() * 900000),
      demoMode: true
    };
  }

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();

    // Login
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(800);

    // Try common selectors
    const userSelectors = ['input[name="username"]', 'input[type="text"]', '#username', 'input[placeholder*="user" i]'];
    const passSelectors = ['input[name="password"]', 'input[type="password"]', '#password'];

    for (const sel of userSelectors) { try { await page.fill(sel, pUser, { timeout: 2000 }); break; } catch {} }
    for (const sel of passSelectors) { try { await page.fill(sel, pPass, { timeout: 2000 }); break; } catch {} }

    await page.click('button[type="submit"], input[type="submit"], .btn-login, button:has-text("Login"), button:has-text("Sign in")');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    // Go to ticket page
    if (ticketUrl) {
      await page.goto(ticketUrl, { waitUntil: 'domcontentloaded' });
    } else {
      await page.click('a[href*="ticket"], a:has-text("Support"), a:has-text("Ticket")').catch(() => {});
    }
    await page.waitForTimeout(1200);

    // Fill form - try multiple selectors
    const subjectSel = ['input[name="subject"]', '#subject', 'input[placeholder*="subject" i]', 'input[placeholder*="title" i]'];
    const msgSel = ['textarea[name="message"]', '#message', 'textarea[placeholder*="message" i]', 'textarea'];

    for (const sel of subjectSel) { try { await page.fill(sel, data.subject, { timeout: 1500 }); break; } catch {} }
    for (const sel of msgSel) { 
      try { 
        await page.fill(sel, `Order ID: ${data.orderId}\nPriority: ${data.priority}\n\n${data.message}`, { timeout: 1500 }); 
        break; 
      } catch {} 
    }

    // Submit
    await page.click('button[type="submit"], input[type="submit"], button:has-text("Submit"), button:has-text("Create"), .btn-primary').catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1500);

    // Try to get ticket ID
    let providerTicketId = 'PRV-' + Date.now();
    try {
      const content = await page.content();
      const match = content.match(/Ticket\s*#?(\d{4,10})/i) || content.match(/#(\d{5,})/);
      if (match) providerTicketId = match[1];
    } catch {}

    await browser.close();
    return { success: true, providerTicketId, demoMode: false };

  } catch (err) {
    console.error('Playwright Error:', err.message);
    if (browser) await browser.close();
    return { success: false, providerTicketId: null, demoMode: false };
  }
}

// Health check
app.get('/health', (req, res) => res.json({ status: 'healthy', service: 'SMMGen Ticket Bridge' }));

app.listen(PORT, () => {
  console.log(`✅ SMMGen External Ticket Bridge running on port ${PORT}`);
  console.log(`Login: ${ADMIN_USER} / ${ADMIN_PASS}`);
  console.log(`Webhook URL: http://localhost:${PORT}/webhook/create-ticket (use X-API-KEY header)`);
});
