# DJ Music StreamPlayer - Documentation

## Features

### Advertisement Track (📢)
- Upload MP3/audio file for advertisement
- Sets interval (how often to play) and duration (how long each time)
- Saved to local SQLite database automatically
- Loads automatically on next startup

### Prayer Track (🕐)
- Upload MP3/audio file for prayer
- Set prayer times (HH:MM format)
- When prayer time starts: waits for ad to complete first, then plays prayer
- After prayer: resumes main track from where it left off
- Saved to local SQLite database automatically
- Loads automatically on next startup

### Main Track
- Search YouTube or upload local files
- Auto-plays through search results
- Can be interrupted by ad or prayer

### Volume Control
- Slider to adjust volume (0-100%)
- Same volume for all tracks (main, ad, prayer)

## Database

### Local SQLite
- File: `player.db` (same folder as `gui_player.py`)
- Tables: `tracks` (ad/prayer info), `play_events` (play history)

### Vercel deployment
- Works without database (settings saved locally)
- Optional: Add Postgres for cloud storage

## How It Works

1. Set advertisement track + interval/duration
2. Set prayer track + prayer times
3. Start playing main track
4. Ad plays at set intervals
5. Prayer overrides ad when prayer time comes

## Troubleshooting

### Ad not playing?
- Make sure ad track is selected
- Set interval > 0 seconds
- Main track must be playing

### Prayer not playing?
- Make sure prayer track is selected
- Add prayer times in HH:MM format (24-hour)
- Check system time matches