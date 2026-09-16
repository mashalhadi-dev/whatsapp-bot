# WhatsApp Automation Microservice

A production-ready Node.js Express service for WhatsApp automation using `whatsapp-web.js` with a local admin UI, settings persistence, and order-alert delivery.

## Features

- Express server with `/admin` dashboard
- Live WhatsApp connection lifecycle status
- Dynamic QR code rendering
- Local `settings.json` management for admin phone numbers
- Test notification endpoint and order alert endpoint
- LocalAuth persistence across restarts
- Puppeteer browser configuration for sandbox-safe execution
- Render-compatible Dockerfile

## Local Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Install the browser required by Puppeteer:
   ```bash
   npx puppeteer browsers install chrome --path ./browser-data
   ```
3. Start the app:
   ```bash
   npm start
   ```
4. Open:
   - http://localhost:3000/admin
   - http://localhost:3000/api/health

## Configuration

The admin phone list is stored in `settings.json`.

Example:
```json
{
  "adminPhones": ["923001234567", "923004567890"]
}
```

## API

### POST /api/send-order-alert

Request body:
```json
{
  "orderId": "1001",
  "customerName": "Ali Khan",
  "phone": "923001234567",
  "amount": 2500,
  "items": ["Shirt", "Jeans"]
}
```

### GET /api/whatsapp/status

Returns connection state and QR payload.

### PUT /api/admin/settings

Updates configured admin numbers.

## Docker / Render

The project includes a Dockerfile compatible with Render deployment. Build and deploy using the Dockerfile included in the project root.

## Notes

- WhatsApp Web requires a Chrome/Chromium browser to be available.
- The app uses `LocalAuth`, which keeps the WhatsApp session on disk in `.wwebjs_auth`.
- The connection is resilient and will re-attempt initialization when a session is interrupted.
