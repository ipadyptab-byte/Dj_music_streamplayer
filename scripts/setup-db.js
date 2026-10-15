import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

// Priority: process.env.DATABASE_URL -> data/db_config.json -> default target
let dbUrl = process.env.DATABASE_URL || 'mysql://root:Priyanka1981@@192.168.1.43:3307/djmusic';

const configPath = path.join(process.cwd(), 'data', 'db_config.json');
if (fs.existsSync(configPath)) {
  try {
    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (saved.connectionString) dbUrl = saved.connectionString;
  } catch (e) {}
}

console.log('🔄 Initializing database tables for DJ Music Streamplayer...');
console.log('📍 Target Database URL:', dbUrl.replace(/:([^@:]+)@/, ':••••••@'));

// Parse credentials
let host = '192.168.1.43';
let port = 3307;
let user = 'root';
let password = 'Priyanka1981@';
let database = 'djmusic';

try {
  const normalized = dbUrl.replace(/^mariadb:\/\//, 'mysql://');
  const u = new URL(normalized);
  host = u.hostname || host;
  port = parseInt(u.port, 10) || port;
  user = decodeURIComponent(u.username || user);
  password = decodeURIComponent(u.password || password);
  database = u.pathname.replace(/^\//, '') || database;
} catch (err) {
  console.warn('⚠️ URL parsing warning, using defaults:', err.message);
}

async function run() {
  let conn;
  try {
    console.log(`🔌 Attempting connection to MariaDB 10 at ${host}:${port} as ${user}...`);
    // Connect without database first to ensure database exists
    conn = await mysql.createConnection({
      host,
      port,
      user,
      password,
      connectTimeout: 8000
    });

    console.log('✅ Connection established! Checking database...');
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await conn.query(`USE \`${database}\``);
    console.log(`✅ Database \`${database}\` verified.`);

    console.log('📦 Creating application tables...');

    // 1. player_settings
    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`player_settings\` (
        \`key\` VARCHAR(100) NOT NULL,
        \`value\` LONGTEXT NOT NULL,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`key\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('  ✓ Table `player_settings` verified');

    // 2. audio_tracks
    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`audio_tracks\` (
        \`id\` VARCHAR(255) NOT NULL,
        \`filename\` VARCHAR(255) NOT NULL,
        \`category\` VARCHAR(50) NOT NULL,
        \`title\` VARCHAR(255) DEFAULT NULL,
        \`audio_url\` TEXT DEFAULT NULL,
        \`audio_base64\` LONGTEXT DEFAULT NULL,
        \`size\` BIGINT DEFAULT NULL,
        \`mime_type\` VARCHAR(100) DEFAULT 'audio/mpeg',
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        INDEX \`idx_audio_tracks_category\` (\`category\`),
        INDEX \`idx_audio_tracks_filename\` (\`filename\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('  ✓ Table `audio_tracks` verified');

    // 3. prayer_schedules
    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`prayer_schedules\` (
        \`id\` INT AUTO_INCREMENT NOT NULL,
        \`schedule_time\` VARCHAR(10) NOT NULL,
        \`track_title\` VARCHAR(255) DEFAULT NULL,
        \`track_url\` TEXT DEFAULT NULL,
        \`is_enabled\` TINYINT(1) DEFAULT 1,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uniq_prayer_schedule_time\` (\`schedule_time\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('  ✓ Table `prayer_schedules` verified');

    // 4. advertisement_schedules
    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`advertisement_schedules\` (
        \`id\` INT AUTO_INCREMENT NOT NULL,
        \`track_title\` VARCHAR(255) NOT NULL,
        \`track_url\` TEXT NOT NULL,
        \`interval_seconds\` INT DEFAULT 300,
        \`sequence_order\` INT DEFAULT 1,
        \`is_enabled\` TINYINT(1) DEFAULT 1,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        INDEX \`idx_advt_sequence_order\` (\`sequence_order\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('  ✓ Table `advertisement_schedules` verified');

    console.log('\n🎉 ALL 4 TABLES CREATED & INITIALIZED SUCCESSFULLY in MariaDB 10 / Synology NAS!');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Could not connect directly from this environment:', err.message);
    if (err.code === 'ETIMEDOUT') {
      console.log(`ℹ️  Note: ${host} is a private local LAN IP.`);
      console.log('   Run this command directly on your Synology NAS or any computer connected to the same local network.');
    }
    process.exit(1);
  } finally {
    if (conn) await conn.end();
  }
}

run();
