# 🚀 Synology NAS Deployment & MariaDB 10 Integration Guide

This guide explains step-by-step how to deploy **DJ Music Streamplayer** on your **Synology NAS** with persistent **MariaDB 10** storage.

---

## 📋 Your Environment Details
- **Synology NAS IP:** `192.168.1.43`
- **MariaDB 10 Port:** `3307`
- **Database Name:** `djmusic`
- **User:** `root`
- **Password:** `Priyanka1981@`
- **Full Connection URL:** `mysql://root:Priyanka1981@@192.168.1.43:3307/djmusic`
- **Streamplayer Web Port:** `3000` (`http://192.168.1.43:3000`)

---

## ⚡ Method 1: Synology Container Manager (Docker) — Recommended

*Synology DSM 7 includes "Container Manager" (formerly Docker). This is the cleanest, easiest, and most robust deployment.*

### Step 1: Prepare the Folder on your Synology NAS
1. Open **File Station** on your Synology DSM.
2. In the `docker` shared folder (e.g. `/volume1/docker/`), create a new folder named `djmusic`.
3. Inside `djmusic`, upload the following files from this project:
   - `Dockerfile`
   - `docker-compose.yml`
   - `package.json`
   - `server.js`
   - `static/` (folder and all its contents)
   - `scripts/` (folder)
   - `schema-mariadb10.sql`
4. Create two empty subfolders inside `djmusic`:
   - `data`
   - `uploads`

### Step 2: Deploy using Container Manager
1. In Synology DSM, open **Container Manager** (or **Docker** on DSM 6).
2. Go to the **Project** tab on the left sidebar.
3. Click **Create**:
   - **Project Name:** `djmusic`
   - **Path:** Browse to `/docker/djmusic`
   - **Source:** Select **"Use existing docker-compose.yml"**
4. Click **Next** -> **Next** -> **Done**.
5. Synology will automatically build the lightweight container and launch it!
6. Open your web browser on any PC or phone connected to your Wi-Fi:
   👉 **`http://192.168.1.43:3000`**

The container is set to `restart: unless-stopped`, so it will automatically boot up whenever your Synology NAS starts or restarts!

---

## 🛠️ Method 2: Native Synology Node.js (Without Docker)

If your Synology model does not support Docker:

1. Open Synology **Package Center** and install **Node.js v18** or **Node.js v20**.
2. Enable SSH in **Control Panel > Terminal & SNMP > Enable SSH service**.
3. SSH into your NAS (`ssh admin@192.168.1.43`) and navigate to your project directory:
   ```bash
   cd /volume1/web/djmusic
   npm install --omit=dev
   ```
4. Set the environment variable and start:
   ```bash
   export DATABASE_URL="mysql://root:Priyanka1981@@192.168.1.43:3307/djmusic"
   npm start
   ```
5. To keep it running permanently in the background on DSM:
   - Go to **DSM Control Panel > Task Scheduler**.
   - Create **Triggered Task > User-defined script**:
     - **Event:** Boot-up
     - **User:** root
     - **Run command:**
       ```bash
       cd /volume1/web/djmusic && export DATABASE_URL="mysql://root:Priyanka1981@@192.168.1.43:3307/djmusic" && /usr/local/bin/node server.js >> /volume1/web/djmusic/server.log 2>&1 &
       ```

---

## 🗄️ MariaDB 10 Verification & Table Creation

### Automatic Table Creation:
When the streamplayer starts up on your NAS or local network, it connects to `192.168.1.43:3307/djmusic` and automatically checks and creates all 4 tables:
1. `player_settings` (Application & prayer timing configurations)
2. `audio_tracks` (Permanent audio files and metadata)
3. `prayer_schedules` (Daily prayer times and bhajan triggers)
4. `advertisement_schedules` (Advertisement tracks & intervals)

### Manual Table Creation (via phpMyAdmin / MariaDB 10):
If you want to create the tables manually or verify them right now:
1. Open **phpMyAdmin** on your Synology NAS (or connect with HeidiSQL / DBeaver to `192.168.1.43:3307`).
2. Log in with `root` / `Priyanka1981@`.
3. Open the **SQL** tab and paste the contents of **`schema-mariadb10.sql`**, then click **Go**.
4. All 4 tables will be created immediately!

### Important Synology MariaDB 10 Settings:
1. Open **MariaDB 10** in Synology DSM.
2. Ensure **"Enable TCP/IP connection"** is **checked** and port is set to **`3307`**.
3. If connecting from another PC or Docker network, ensure `root` user can connect from any host `%`:
   ```sql
   GRANT ALL PRIVILEGES ON djmusic.* TO 'root'@'%' IDENTIFIED BY 'Priyanka1981@';
   FLUSH PRIVILEGES;
   ```

---

## 🔍 Why Did the Cloud Preview Show "ETIMEDOUT"?

`192.168.1.43` is an **RFC-1918 private Local Area Network (LAN) IP**.
It only exists within your local home/office router network.
Public cloud servers (like the Google Cloud AI Studio preview environment) are on the public Internet and cannot route into a private home LAN IP.
Once deployed directly on your Synology NAS (via Container Manager or Node.js), the app and MariaDB 10 are on the exact same network (LAN / localhost), connecting instantly in **under 2 milliseconds**!
