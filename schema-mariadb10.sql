-- ================================================================
-- MariaDB 10 / MySQL Schema for Synology NAS / Network Drive
-- DJ Music Streamplayer Database Setup
-- Target Database: djmusic
-- Port: 3307 (Synology MariaDB 10 default) or 3306
-- ================================================================

-- Step 1: Create Database if it does not already exist
CREATE DATABASE IF NOT EXISTS `djmusic`
    DEFAULT CHARACTER SET utf8mb4
    DEFAULT COLLATE utf8mb4_unicode_ci;

USE `djmusic`;

-- ----------------------------------------------------------------
-- 1. Player Settings Table
-- Stores all player configurations, prayer timings, intervals,
-- volume levels, and PC sync states as persistent JSON key-values.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `player_settings` (
    `key` VARCHAR(100) NOT NULL,
    `value` LONGTEXT NOT NULL,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------
-- 2. Audio Tracks Table
-- Stores uploaded audio tracks with metadata and permanent base64 / blob
-- data so audio files survive container restarts and never get lost.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `audio_tracks` (
    `id` VARCHAR(255) NOT NULL,
    `filename` VARCHAR(255) NOT NULL,
    `category` VARCHAR(50) NOT NULL COMMENT 'prayer, advt, or general',
    `title` VARCHAR(255) DEFAULT NULL,
    `audio_url` TEXT DEFAULT NULL,
    `audio_base64` LONGTEXT DEFAULT NULL,
    `size` BIGINT DEFAULT NULL,
    `mime_type` VARCHAR(100) DEFAULT 'audio/mpeg',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    INDEX `idx_audio_tracks_category` (`category`),
    INDEX `idx_audio_tracks_filename` (`filename`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------
-- 3. Prayer Schedules Table
-- Stores daily prayer schedules (e.g. 08:00, 12:00, 18:30) and
-- associates specific bhajan / prayer audio tracks to exact times.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `prayer_schedules` (
    `id` INT AUTO_INCREMENT NOT NULL,
    `schedule_time` VARCHAR(10) NOT NULL COMMENT 'HH:MM in 24-hr format',
    `track_title` VARCHAR(255) DEFAULT NULL,
    `track_url` TEXT DEFAULT NULL,
    `is_enabled` TINYINT(1) DEFAULT 1,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uniq_prayer_schedule_time` (`schedule_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------
-- 4. Advertisement Schedules Table
-- Stores ordered advertisement sequence and custom interval settings.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `advertisement_schedules` (
    `id` INT AUTO_INCREMENT NOT NULL,
    `track_title` VARCHAR(255) NOT NULL,
    `track_url` TEXT NOT NULL,
    `interval_seconds` INT DEFAULT 300,
    `sequence_order` INT DEFAULT 1,
    `is_enabled` TINYINT(1) DEFAULT 1,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    INDEX `idx_advt_sequence_order` (`sequence_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------
-- Step 5: (Optional) Grant privileges if connecting from another device
-- In Synology MariaDB 10, run this if accessing from another LAN IP:
-- GRANT ALL PRIVILEGES ON djmusic.* TO 'root'@'%' IDENTIFIED BY 'Priyanka1981@';
-- FLUSH PRIVILEGES;
-- ----------------------------------------------------------------
