# 🛒 ShopList Local Server

A lightweight, self-hosted shopping list web app powered by Node.js, Express, and an embedded SQLite database. Designed to run inside Docker and deploy effortlessly via **Portainer**.

---

## 🌟 Key Features

- 🐳 **Portainer & Docker Ready** — Easy stack deployment with automatic health checks
- 💾 **Persistent SQLite Volume** — Lists and items survive container updates and restarts
- ⚡ **Real-Time Device Sync** — Server-Sent Events (SSE) instantly update all connected devices
- ✏️ **Add & Edit Items** — Full inline editing of name, quantity, unit, and price
- 📱 **Mobile First & PWA** — Dark/light UI designed for mobile shopping at the store
- 📤 **Export & Import** — Copy to clipboard, download JSON, or import a backup
- 🔄 **Schema Migrations** — Versioned database migrations applied safely on every startup

---

## 🚀 Portainer Deployment

### Prerequisites
The image must exist locally on your Docker host **before** deploying via Portainer Stacks (Portainer does not build images).

```bash
# On your Docker host — clone and build
git clone https://github.com/your-user/shoplist.git
cd shoplist
docker build -t shoplist:latest .
```

> If your Portainer is on a **remote server**, push to a registry instead:
> ```bash
> docker build -t yourusername/shoplist:latest .
> docker push yourusername/shoplist:latest
> ```
> Then replace `image: shoplist:latest` with `image: yourusername/shoplist:latest` in the compose below.

---

### Option A — Portainer Stacks Web Editor (Recommended)

1. Open Portainer → **Stacks** → **+ Add stack**
2. Name it: `shoplist`
3. Select **Web editor** and paste:

```yaml
version: '3.8'

services:
  shoplist:
    image: shoplist:latest
    container_name: shoplist
    restart: unless-stopped
    init: true
    ports:
      - "7821:7821"
    environment:
      - PORT=7821
      - NODE_ENV=production
      - DATABASE_DIR=/app/data
      - DATABASE_PATH=/app/data/shopping.db
    volumes:
      - shoplist_data:/app/data
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:7821/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

volumes:
  shoplist_data:
    driver: local
    name: shoplist_data
```

4. Click **Deploy the stack**
5. Access at `http://<your-server-ip>:7821` ✅

---

### Option B — Portainer Git Repository

1. Open Portainer → **Stacks** → **+ Add stack**
2. Select **Repository**
3. Enter your repo URL and set **Compose path** to `docker-compose.yml`
4. Optionally enable **GitOps updates** for auto-redeploy on push
5. Click **Deploy the stack**

---

### Updating After Code Changes

```bash
# Rebuild the image on your Docker host
docker build -t shoplist:latest .
```

Then in Portainer:
**Stacks → shoplist → Update the stack → Re-pull image and redeploy**

> Schema migrations run automatically on startup — no manual DB steps needed.

---

## 💻 Local Development

### Run with Docker Compose
```bash
docker-compose up -d --build
```

### Run with Node directly
```bash
npm install
npm start
```

Server available at `http://localhost:7821`

---

## 🛠️ Environment Variables

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `7821` | Port the Express server listens on |
| `NODE_ENV` | `production` | Node environment |
| `DATABASE_DIR` | `/app/data` | Directory where SQLite DB file lives |
| `DATABASE_PATH` | `/app/data/shopping.db` | Full path to the SQLite DB file |

---

## 🗄️ Database & Migrations

The app uses **versioned migrations** (`db.js`). On every startup it:

1. Creates the `schema_migrations` table if it doesn't exist
2. Checks the current schema version
3. Applies any pending migrations in order, each in a transaction
4. Seeds default categories and a sample list on a fresh database

**To add a schema change**, append to the `migrations` array in `db.js`:

```js
{
  version: 2,
  description: 'Add tags column to items',
  up: `ALTER TABLE items ADD COLUMN tags TEXT DEFAULT ''`
},
```

Deploy → runs once automatically on next startup.

---

## 📂 Project Structure

```
.
├── Dockerfile              # Multi-stage production container build
├── docker-compose.yml      # Portainer / Docker Compose stack config
├── server.js               # Express REST API & SSE real-time broadcaster
├── db.js                   # SQLite init, versioned migrations & seed data
├── public/
│   ├── index.html          # App shell & modals
│   ├── app.js              # Client-side logic (add, edit, check, import/export)
│   ├── styles.css          # Minimalist dark/light design system
│   └── manifest.json       # PWA manifest
└── README.md
```

---

## 📡 API Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Health check (used by Docker & Portainer) |
| `GET` | `/api/lists` | Get all active lists |
| `POST` | `/api/lists` | Create a new list |
| `PUT` | `/api/lists/:id` | Update list name/icon/color |
| `DELETE` | `/api/lists/:id` | Archive a list |
| `GET` | `/api/lists/:id/items` | Get items for a list |
| `POST` | `/api/lists/:id/items` | Add item (auto-increments qty if duplicate) |
| `PATCH` | `/api/items/:id` | Edit item (name, qty, unit, price, checked) |
| `DELETE` | `/api/items/:id` | Delete item |
| `GET` | `/api/events` | SSE stream for real-time updates |
