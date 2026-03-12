const express = require("express");
const {
  getCurrentTrack,
  pauseMusic,
  playMusic,
  nextTrack,
  previousTrack,
  createPlaylistFromSearches,
  createPlaylist
} = require("./spotify");

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ success: true, message: "SpotifyGPT API töötab." });
});

app.get("/callback", async (req, res) => {
  const code = req.query.code;

  if (!code) {
    return res.status(400).send("Missing code");
  }

  try {
    const params = new URLSearchParams();
    params.append("grant_type", "authorization_code");
    params.append("code", code);
    params.append("redirect_uri", "https://spotifygpt.onrender.com/callback");

    const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization:
          "Basic " +
          Buffer.from(
            process.env.SPOTIFY_CLIENT_ID + ":" + process.env.SPOTIFY_CLIENT_SECRET
          ).toString("base64")
      },
      body: params.toString()
    });

    const data = await tokenRes.json();

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(`
      <h2>Spotify token response</h2>
      <pre>${JSON.stringify(data, null, 2)}</pre>
      <p>Kopeeri siit <b>refresh_token</b> ja pane see oma Render env variablitesse.</p>
    `);
  } catch (err) {
    return res.status(500).send(String(err));
  }
});

app.post("/spotify/pause", async (req, res) => {
  try {
    const result = await pauseMusic();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.post("/spotify/play", async (req, res) => {
  try {
    const result = await playMusic();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.post("/spotify/next", async (req, res) => {
  try {
    const result = await nextTrack();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.post("/spotify/previous", async (req, res) => {
  try {
    const result = await previousTrack();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.get("/spotify/current", async (req, res) => {
  try {
    const data = await getCurrentTrack();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.post("/spotify/playlist", async (req, res) => {
  try {
    const { name, tracks } = req.body;
    const { playlistName, searches } = req.body;

    const finalName = name || playlistName;
    const finalTracks = Array.isArray(tracks) ? tracks : searches;

    if (!finalName || !Array.isArray(finalTracks) || finalTracks.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Puudub playlisti nimi või lugude nimekiri. Kasuta kas 'name' + 'tracks' või 'playlistName' + 'searches'."
      });
    }

    let result;

    if (typeof createPlaylist === "function") {
      result = await createPlaylist(finalName, finalTracks);

      return res.json({
        success: true,
        playlistName: result.name || finalName,
        playlistUrl: result.url || result.playlistUrl || null,
        addedTracks:
          typeof result.addedTracks === "number"
            ? result.addedTracks
            : Array.isArray(finalTracks)
            ? finalTracks.length
            : 0
      });
    }

    result = await createPlaylistFromSearches(finalName, finalTracks);
    return res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server töötab pordil ${PORT}`);
});