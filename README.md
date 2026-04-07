# 🎉 Summer Fest 2026 – Ticketing System

**Production-ready event ticketing system for VIT Bhopal**  
Handles 5000+ attendees with anti-forgery QR tickets, admin dashboard, and gate scanner.

---

## 📁 Project Structure

```
summerfest/
├── server.js                   # Express app entry point
├── db.js                       # SQLite schema + connection
├── package.json
├── .env.example                # Copy to .env and configure
│
├── middleware/
│   └── auth.js                 # JWT bearer token middleware
│
├── routes/
│   ├── admin.js                # /api/admin/* (stats, export, logs)
│   ├── users.js                # /api/users/* (CRUD, approve, reject)
│   ├── tickets.js              # /api/tickets/* (generate, resend, download)
│   └── verify.js               # /api/verify/:token, /api/check-in/:id
│
├── services/
│   ├── ticketService.js        # Orchestrates ticket generation pipeline
│   ├── pdfGenerator.js         # Puppeteer HTML→PDF with QR
│   └── emailService.js         # Nodemailer with batching + retry
│
├── scripts/
│   ├── setup.js                # First-time admin account creation
│   ├── importCSV.js            # Bulk import from Google Sheets CSV
│   └── seedDummy.js            # 20 test users for development
│
├── public/
│   ├── admin/index.html        # Full admin SPA dashboard
│   └── scanner/index.html      # Entry gate QR scanner
│
├── uploads/                    # Payment screenshots (auto-created)
└── tickets/                    # Generated PDF tickets (auto-created)
```

---

## 🚀 Quick Start

### 1. Prerequisites
- Node.js 18+
- npm

### 2. Install dependencies
```bash
cd summerfest
npm install
```

### 3. Configure environment
```bash
cp .env.example .env
# Edit .env with your values (see configuration section below)
```

**Minimum required `.env` values:**
```env
JWT_SECRET=your-64-char-random-secret-here
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-gmail-app-password
```

Generate a strong JWT secret:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 4. Create admin account
```bash
node scripts/setup.js
# Enter username and password when prompted
```

### 5. (Optional) Load test data
```bash
node scripts/seedDummy.js
```

### 6. Start the server
```bash
npm start
# Development with auto-reload:
npm run dev
```

### 7. Open the apps
- **Admin Dashboard:** http://localhost:3000/
- **Entry Gate Scanner:** http://localhost:3000/scanner

---

## 📥 Importing Registrations

### From Google Sheets / CSV

Export your Google Form responses as CSV (File → Download → CSV).

Expected CSV columns (case-insensitive):
```
Name, Email, Phone, Registration ID, UTR ID
```
or Google Form defaults like:
```
Timestamp, Full Name, Email Address, Phone Number, UTR ID, Registration ID
```

Import command:
```bash
node scripts/importCSV.js path/to/registrations.csv
```

The importer will:
- Skip duplicate emails
- Flag duplicate UTRs as `suspicious`
- Report stats on completion

---

## ⚙️ Configuration Reference

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Server port (default: 3000) | No |
| `JWT_SECRET` | 64-char secret for signing tokens | **Yes** |
| `SMTP_HOST` | Email server (default: smtp.gmail.com) | No |
| `SMTP_PORT` | Email port (default: 587) | No |
| `SMTP_USER` | Gmail address | **Yes** |
| `SMTP_PASS` | Gmail App Password | **Yes** |
| `DB_PATH` | SQLite file path | No |
| `UPLOAD_DIR` | Screenshot storage path | No |
| `TICKET_DIR` | PDF ticket storage path | No |
| `EVENT_NAME` | Event name on tickets | No |
| `EVENT_DATE` | Date string on tickets | No |
| `EVENT_TIME` | Time range on tickets | No |
| `EVENT_VENUE` | Venue on tickets | No |

### Setting up Gmail SMTP
1. Go to Google Account → Security → 2-Step Verification (must be ON)
2. Go to App Passwords → Create app password for "Mail"
3. Use that 16-char password as `SMTP_PASS`

---

## 🔌 API Reference

### Authentication
All `/api/*` endpoints (except `/api/admin/login` and `/api/check-in/*`) require:
```
Authorization: Bearer <token>
```

### Admin
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/admin/login` | Get auth token |
| GET | `/api/admin/stats` | Dashboard statistics |
| GET | `/api/admin/export/users` | Download users CSV |
| GET | `/api/admin/export/checkins` | Download check-in CSV |
| GET | `/api/admin/logs` | Paginated scan logs |

### Users
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/users` | List users (search/filter/paginate) |
| GET | `/api/users/:id` | Single user detail |
| POST | `/api/users` | Create user (with screenshot upload) |
| PATCH | `/api/users/:id/approve` | Approve → generates + emails ticket |
| PATCH | `/api/users/:id/reject` | Reject user |
| PATCH | `/api/users/:id/suspicious` | Flag as suspicious |
| POST | `/api/users/bulk-approve` | Bulk approve `{ ids: [1,2,3] }` |

### Tickets
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tickets` | List all tickets |
| GET | `/api/tickets/:id` | Single ticket |
| POST | `/api/tickets/generate` | Manually generate `{ user_id }` |
| POST | `/api/tickets/resend` | Resend email `{ ticket_id }` |
| GET | `/api/tickets/:uuid/download` | Download PDF |

### Verification (Gate)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/verify/:token` | Check QR token (read-only) |
| POST | `/api/check-in/:ticket_id` | Mark as used (atomic) |
| GET | `/api/search-ticket?q=...` | Manual name/email/UUID lookup |

---

## 🔐 Security Architecture

### QR Code Signing
Each ticket's QR contains a **JWT** signed with `HS256` using your `JWT_SECRET`:
```json
{
  "ticket_uuid": "SF26-A3F7C2B1",
  "user_id": 42,
  "name": "Arjun Sharma",
  "email": "arjun@vit.ac.in",
  "event": "SF26",
  "iss": "summerfest-ticketing",
  "exp": 1744300800
}
```

**Anti-forgery guarantees:**
- ✅ JWT signature cannot be forged without `JWT_SECRET`
- ✅ Any edited PDF/screenshot produces invalid signature
- ✅ `POST /check-in` uses a **SQLite transaction** – concurrent scanner race conditions are impossible
- ✅ Once used, `is_used=1` is permanent and immediately visible to all scanners
- ✅ Multiple scanner devices all hit the same backend DB

### Why screenshots fail:
A screenshot of a QR still contains the same token. The **one-time-use** check catches this:
- First scan: VALID → marked used
- Second scan (screenshot): ALREADY_USED → denied

---

## 📧 Email Delivery at Scale

The email service uses:
- **Connection pooling** (5 simultaneous SMTP connections)
- **Rate limiting** (5 emails/second max)
- **Exponential backoff retry** (3 attempts: 2s, 4s, 8s)
- **Batch processing** for bulk sends (chunks of 10 with 2s gap)

For 5000 emails at 5/sec → ~17 minutes. Run overnight or use SendGrid for faster delivery.

### Using SendGrid instead of Gmail
Replace the transporter in `services/emailService.js`:
```js
const transporter = nodemailer.createTransport({
  host: 'smtp.sendgrid.net',
  port: 587,
  auth: { user: 'apikey', pass: process.env.SENDGRID_API_KEY }
});
```

---

## 🖥 Deployment

### Option A: Railway (Recommended, free tier)
1. Push code to GitHub
2. Connect repo on [railway.app](https://railway.app)
3. Set environment variables in Railway dashboard
4. Railway auto-deploys on push

**Note:** SQLite file is ephemeral on Railway. For production:
- Use Railway's PostgreSQL addon, OR
- Mount a persistent volume

### Option B: VPS (Ubuntu)
```bash
# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Clone and setup
git clone <your-repo> /opt/summerfest
cd /opt/summerfest
npm install --production
cp .env.example .env
# Edit .env
node scripts/setup.js

# Run with PM2
npm install -g pm2
pm2 start server.js --name summerfest
pm2 startup && pm2 save

# Nginx reverse proxy
sudo apt install nginx
# Configure /etc/nginx/sites-available/summerfest:
# server { listen 80; server_name yourdomain.com; location / { proxy_pass http://localhost:3000; } }
sudo nginx -t && sudo systemctl reload nginx
```

### Option C: Render
1. New Web Service → connect GitHub repo
2. Build command: `npm install`
3. Start command: `npm start`
4. Add all env vars
5. Add a Disk (for SQLite persistence) mounted at `/opt/render/project/src`

---

## 🧪 Testing Workflow

```bash
# 1. Seed dummy users
node scripts/seedDummy.js

# 2. Start server
npm run dev

# 3. Login to admin dashboard
# http://localhost:3000/ → admin / <your-password>

# 4. View pending users → approve a few
# Tickets will generate and emails will attempt to send
# (configure .env SMTP or email sending will fail/log error)

# 5. Test gate scanner
# http://localhost:3000/scanner
# Use Manual Lookup to find an approved user → Admit

# 6. Try scanning same ticket again → ALREADY USED
```

---

## 📊 Duplicate UTR Handling

When two registrations share the same UTR ID:
- Both are automatically set to `suspicious` status
- Highlighted in the admin UI with a ⚠ DUP UTR badge
- Admin must manually investigate and approve/reject each
- Ticket is NOT auto-generated until admin explicitly approves

---

## 🎨 Customizing the Ticket Design

Edit `services/pdfGenerator.js` → `buildTicketHTML()` function.

To add your event poster:
1. Place poster image in `public/poster.jpg`
2. In `buildTicketHTML`, add to CSS:
   ```css
   .left::before { background-image: url('/public/poster.jpg'); ... }
   ```
   Or embed as base64:
   ```js
   const posterB64 = fs.readFileSync('./public/poster.jpg').toString('base64');
   // Use: `data:image/jpeg;base64,${posterB64}` in HTML
   ```

---

## ⚠️ Operational Checklist (Event Day)

- [ ] Server running and accessible
- [ ] Admin can login and see all approved users
- [ ] Test QR scan with a dummy ticket
- [ ] Download offline CSV backup of all approved users
- [ ] Charge all scanner devices
- [ ] Distribute scanner URL and login to gate staff
- [ ] Test manual lookup works without QR
- [ ] Keep offline CSV as absolute fallback

---

*Built for Summer Fest 2026 · VIT Bhopal · © 2026*
