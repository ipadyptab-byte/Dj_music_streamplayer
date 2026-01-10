# replit.md

## Overview

This is a web-based music search and streaming application that allows users to search for music on YouTube and play audio directly in the browser. The application uses a Python Flask backend to interface with YouTube via yt-dlp for searching and extracting audio streams, paired with a simple HTML/CSS/JavaScript frontend for the user interface.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Backend Architecture
- **Framework**: Flask (Python) serves as the web server
- **Static File Serving**: Flask serves the frontend from a `static` folder
- **YouTube Integration**: Uses yt-dlp library for two core functions:
  - Searching YouTube for music (returns top 5 results with metadata)
  - Extracting direct audio URLs from YouTube videos for streaming

### Frontend Architecture
- **Single Page Application**: Minimal HTML/CSS/JavaScript without frameworks
- **Design Pattern**: Direct DOM manipulation for UI updates
- **Audio Playback**: Uses native HTML5 `<audio>` element
- **Styling**: Dark theme with inline CSS (Spotify-inspired aesthetic)

### API Structure
- `GET /` - Serves the main HTML page
- `GET /api/search?q={query}` - Searches YouTube and returns JSON array of results with id, title, thumbnail, and URL
- Audio URL extraction endpoint (implementation in progress)

### Data Flow
1. User enters search query in frontend
2. Frontend calls `/api/search` endpoint
3. Backend uses yt-dlp to search YouTube
4. Results returned as JSON to frontend
5. User selects track, frontend requests audio URL
6. Backend extracts direct audio stream URL
7. Frontend plays audio via HTML5 audio element

## External Dependencies

### Python Libraries
- **Flask**: Web framework for serving the application and API endpoints
- **yt-dlp**: YouTube video/audio extraction and search functionality (fork of youtube-dl with active maintenance)

### External Services
- **YouTube**: Source for all music search and audio streaming (accessed via yt-dlp, no API key required)

### Notes for Development
- No database is currently used; the application is stateless
- Audio streams are fetched on-demand and not cached
- The application relies on yt-dlp's ability to extract direct audio URLs, which may require updates if YouTube changes its infrastructure