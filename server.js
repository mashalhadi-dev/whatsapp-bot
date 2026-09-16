const express = require('express');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
const PORT = process.env.PORT || 3000;
const API_SECRET_KEY = process.env.API_SECRET_KEY || 'azzivone_secret_key_change_me';
const SETTINGS_PATH = path.join(__dirname, 'settings.json');
const DEFAULT_SETTINGS = { adminPhones: ['923001234567'] };

// Dynamic Browser Resolution Strategy
function resolveBrowserPath() {
  if (process.env.CHROME_BIN && fsSync.existsSync(process.env.CHROME_BIN)) {
    return process.env.CHROME_BIN;
  }

  const localChromePath = path.join(
    __dirname,
    'browser-data',
    'chrome',
    'win64-146.0.7680.31',
    'chrome-win64',
    'chrome.exe'
  );
  if (fsSync.existsSync(localChromePath)) {
    return localChromePath;
  }

  const systemChromePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    `C:\\Users\\${process.env.USERNAME}\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe`
  ];
  for (const chromePath of systemChromePaths) {
    if (fsSync.existsSync(chromePath)) {
      console.log(`[Browser Engine] Using System Google Chrome: ${chromePath}`);
      return chromePath;
    }
  }

  const systemEdgePaths = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  for (const edgePath of systemEdgePaths) {
    if (fsSync.existsSync(edgePath)) {
      console.log(`[Browser Engine] Using System MS Edge: ${edgePath}`);
      return edgePath;
    }
  }

  return undefined;
}

const appState = {
  status: 'Disconnected',
  qrCode: null,
  lastError: null,
  updatedAt: new Date().toISOString(),
};

let reconnectTimer = null;
let isInitializing = false;

function setStatus(status, error = null) {
  appState.status = status;
  appState.lastError = error;
  appState.updatedAt = new Date().toISOString();
}

async function ensureSettingsFile() {
  try {
    await fs.access(SETTINGS_PATH);
  } catch {
    await fs.writeFile(SETTINGS_PATH, JSON.stringify(DEFAULT_SETTINGS, null, 2), 'utf8');
  }
}

async function readSettings() {
  await ensureSettingsFile();
  try {
    const raw = await fs.readFile(SETTINGS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const adminPhones = Array.isArray(parsed.adminPhones)
      ? parsed.adminPhones.map((phone) => String(phone).trim()).filter(Boolean)
      : [];
    return { adminPhones };
  } catch (error) {
    console.error('Failed to read settings file:', error.message);
    return { adminPhones: [] };
  }
}

async function writeSettings(data) {
  await ensureSettingsFile();
  const payload = { adminPhones: Array.isArray(data.adminPhones) ? data.adminPhones : [] };
  await fs.writeFile(SETTINGS_PATH, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

function normalizePhone(rawPhone) {
  if (!rawPhone) return null;
  let digits = String(rawPhone).replace(/\D/g, '');
  if (!digits) return null;

  if (digits.startsWith('0')) {
    digits = `92${digits.slice(1)}`;
  } else if (!digits.startsWith('92')) {
    digits = `92${digits}`;
  }

  if (!/^92\d{10}$/.test(digits)) return null;
  return `${digits}@c.us`;
}

async function generateQrCodeImage(qrValue) {
  if (!qrValue) return null;
  try {
    return await QRCode.toDataURL(qrValue, {
      width: 500,
      margin: 1,
      color: { dark: '#111827', light: '#ffffff' },
    });
  } catch (error) {
    console.error('Unable to generate QR image:', error.message);
    return null;
  }
}

function formatAlertMessage({ orderId, customerName, phone, amount, items }) {
  const normalizedItems = Array.isArray(items) ? items.join(', ') : String(items || 'N/A');
  return [
    '🚨 *NEW ORDER RECEIVED - AZZIVONE* 🚨',
    `*Order ID:* #${orderId || 'N/A'}`,
    `*Customer:* ${customerName || 'N/A'}`,
    `*Phone:* ${phone || 'N/A'}`,
    `*Amount:* Rs. ${amount || '0'}`,
    `*Items:* ${normalizedItems}`,
  ].join('\n');
}

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: path.join(__dirname, '.wwebjs_auth'),
  }),
  puppeteer: {
    executablePath: resolveBrowserPath(),
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu'
    ],
  },
});

// SAFE RECONNECT LOGIC: Guarantees process cleanup before re-initializing
function scheduleReconnect() {
  if (reconnectTimer || isInitializing) return;

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    isInitializing = true;
    try {
      console.log('[Clean Cleanup] Closing existing browser instances before reconnect...');
      if (client.pupBrowser) {
        await client.pupBrowser.close().catch(() => {});
      }
      await client.destroy().catch(() => {});
      
      console.log('Attempting clean reconnect for WhatsApp client...');
      await client.initialize();
    } catch (error) {
      console.error('Reconnect failed:', error.message);
      setStatus('Disconnected', error.message);
      isInitializing = false;
      scheduleReconnect();
    }
  }, 5000);
}

client.on('qr', async (qr) => {
  setStatus('Connecting');
  appState.qrCode = await generateQrCodeImage(qr);
  qrcodeTerminal.generate(qr, { small: true });
  console.log('WhatsApp QR code generated. Scan it in the admin panel.');
});

client.on('ready', () => {
  isInitializing = false;
  setStatus('Connected');
  appState.qrCode = null;
  console.log('WhatsApp client is ready.');
});

client.on('auth_failure', (message) => {
  isInitializing = false;
  setStatus('Disconnected', message || 'Authentication failed');
  appState.qrCode = null;
  console.error('WhatsApp auth failure:', message);
  scheduleReconnect();
});

client.on('disconnected', (reason) => {
  isInitializing = false;
  setStatus('Disconnected', reason || 'Connection disconnected');
  appState.qrCode = null;
  console.warn('WhatsApp disconnected:', reason || 'Unknown reason');
  scheduleReconnect();
});

client.on('message', (message) => {
  if (message.body === '!ping') {
    message.reply('pong');
  }
});

isInitializing = true;
client.initialize().catch((error) => {
  isInitializing = false;
  console.error('Failed to initialize WhatsApp client:', error.message);
  setStatus('Disconnected', error.message || 'Initialization failed');
  scheduleReconnect();
});

async function sendMessageToTarget(targetNumber, messageText) {
  const normalizedTarget = normalizePhone(targetNumber);
  if (!normalizedTarget) {
    throw new Error(`Invalid admin number format: ${targetNumber}`);
  }

  if (appState.status !== 'Connected') {
    throw new Error('WhatsApp client is not connected. Please scan QR code.');
  }

  await client.sendMessage(normalizedTarget, messageText);
  return normalizedTarget;
}

async function sendOrderAlert(payload) {
  const { adminPhones } = await readSettings();

  if (!adminPhones.length) {
    throw new Error('No target WhatsApp numbers configured.');
  }

  const messageText = formatAlertMessage(payload);

  const results = await Promise.allSettled(
    adminPhones.map((target) => sendMessageToTarget(target, messageText))
  );

  const sentNumbers = [];
  const failures = [];

  results.forEach((res, index) => {
    if (res.status === 'fulfilled') {
      sentNumbers.push(res.value);
    } else {
      failures.push({ target: adminPhones[index], error: res.reason.message });
      console.error(`Failed to send alert to ${adminPhones[index]}:`, res.reason.message);
    }
  });

  return {
    success: sentNumbers.length > 0,
    sent: sentNumbers,
    failed: failures,
    message: sentNumbers.length > 0 ? 'Order alert sent successfully.' : 'No messages were sent.',
  };
}

function verifyApiToken(req, res, next) {
  const token = req.headers['x-api-key'];
  if (token && token === API_SECRET_KEY) {
    return next();
  }
  return res.status(401).json({ success: false, message: 'Unauthorized API Access.' });
}

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.redirect('/admin');
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'whatsapp-bot',
    status: appState.status,
    updatedAt: appState.updatedAt,
  });
});

app.get('/api/whatsapp/status', (req, res) => {
  res.json({
    status: appState.status,
    qrCode: appState.qrCode,
    error: appState.lastError,
    updatedAt: appState.updatedAt,
  });
});

app.get('/api/admin/settings', async (req, res) => {
  const settings = await readSettings();
  res.json(settings);
});

app.put('/api/admin/settings', async (req, res) => {
  const incomingPhones = Array.isArray(req.body.adminPhones) ? req.body.adminPhones : [];
  const validPhones = [...new Set(
    incomingPhones
      .map((phone) => String(phone).trim())
      .filter((phone) => phone.length > 0)
      .filter((phone) => normalizePhone(phone))
  )];

  const settings = await writeSettings({ adminPhones: validPhones });
  return res.json({
    message: 'Admin numbers updated successfully.',
    settings,
  });
});

app.post('/api/test-notification', verifyApiToken, async (req, res) => {
  const { adminPhones } = await readSettings();

  if (!adminPhones.length) {
    return res.status(400).json({
      success: false,
      message: 'No admin phone numbers are configured.',
    });
  }

  const messageText = [
    '🧪 *WHATSAPP TEST NOTIFICATION* 🧪',
    '*Service:* WhatsApp automation admin test',
    '*Status:* Bot is active and running cleanly.',
  ].join('\n');

  const results = await Promise.allSettled(
    adminPhones.map((target) => sendMessageToTarget(target, messageText))
  );

  const sentNumbers = [];
  const failures = [];

  results.forEach((res, index) => {
    if (res.status === 'fulfilled') {
      sentNumbers.push(res.value);
    } else {
      failures.push({ target: adminPhones[index], error: res.reason.message });
    }
  });

  return res.json({
    success: sentNumbers.length > 0,
    sent: sentNumbers,
    failed: failures,
    message: sentNumbers.length > 0 ? 'Test notification sent.' : 'Test notification failed.',
  });
});

app.post('/api/send-order-alert', verifyApiToken, async (req, res) => {
  try {
    const { orderId, customerName, phone, amount, items } = req.body || {};

    if (!orderId || !customerName || !phone || amount === undefined || !items) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: orderId, customerName, phone, amount, items.',
      });
    }

    const result = await sendOrderAlert({ orderId, customerName, phone, amount, items });

    if (!result.success) {
      return res.status(502).json({ success: false, ...result });
    }

    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('Order alert error:', error.message);
    return res.status(500).json({
      success: false,
      message: error.message || 'Unable to send WhatsApp order alert.',
    });
  }
});

app.listen(PORT, () => {
  console.log(`WhatsApp automation service is running on http://localhost:${PORT}`);
  console.log(`Admin UI: http://localhost:${PORT}/admin`);
});