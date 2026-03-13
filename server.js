const express = require("express");
const {
  getCurrentTrack,
  pauseMusic,
  playMusic,
  nextTrack,
  previousTrack,
  createPlaylistFromSearches,
  createPlaylist,
  createAIPlaylist,
  createAIPlaylistAndPlay,
  playPlaylistByName,
  recommendFromTaste
} = require("./spotify");

const app = express();
app.use(express.json({ limit: "1mb" }));

function sendError(res, status, error) {
  return res.status(status).json({
    success: false,
    error: String(error)
  });
}

app.get("/", (req, res) => {
  res.json({ success: true, message: "SpotifyGPT API töötab." });
});

app.get("/authorize", (req, res) => {
  const scopes = [
    "user-read-playback-state",
    "user-modify-playback-state",
    "playlist-read-private",
    "playlist-read-collaborative",
    "playlist-modify-private",
    "playlist-modify-public",
    "user-library-read",
    "user-top-read"
  ];

  const params = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID,
    response_type: "code",
    redirect_uri: "https://spotifygpt.onrender.com/callback",
    scope: scopes.join(" ")
  });

  return res.redirect(
    `https://accounts.spotify.com/authorize?${params.toString()}`
  );
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
            process.env.SPOTIFY_CLIENT_ID +
              ":" +
              process.env.SPOTIFY_CLIENT_SECRET
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
    return res.json(result);
  } catch (err) {
    console.error("POST /spotify/pause error:", err);
    return sendError(res, 500, err);
  }
});

app.post("/spotify/play", async (req, res) => {
  try {
    const result = await playMusic();
    return res.json(result);
  } catch (err) {
    console.error("POST /spotify/play error:", err);
    return sendError(res, 500, err);
  }
});

app.post("/spotify/next", async (req, res) => {
  try {
    const result = await nextTrack();
    return res.json(result);
  } catch (err) {
    console.error("POST /spotify/next error:", err);
    return sendError(res, 500, err);
  }
});

app.post("/spotify/previous", async (req, res) => {
  try {
    const result = await previousTrack();
    return res.json(result);
  } catch (err) {
    console.error("POST /spotify/previous error:", err);
    return sendError(res, 500, err);
  }
});

app.get("/spotify/current", async (req, res) => {
  try {
    const data = await getCurrentTrack();
    return res.json({ success: true, data });
  } catch (err) {
    console.error("GET /spotify/current error:", err);
    return sendError(res, 500, err);
  }
});

/* ------------ UUS ENDPOINT ------------ */

app.get("/spotify/taste", async (req, res) => {
  try {
    const result = await recommendFromTaste();

    return res.json({
      success: true,
      ...result
    });
  } catch (err) {
    console.error("GET /spotify/taste error:", err);
    return sendError(res, 500, err);
  }
});

/* -------------------------------------- */

app.post("/spotify/playlist", async (req, res) => {
  try {
    console.log("POST /spotify/playlist body:", req.body);

    const { name, tracks } = req.body || {};
    const { playlistName, searches } = req.body || {};

    const finalName =
      typeof name === "string" && name.trim()
        ? name.trim()
        : typeof playlistName === "string" && playlistName.trim()
        ? playlistName.trim()
        : "";

    const finalTracks = Array.isArray(tracks)
      ? tracks
      : Array.isArray(searches)
      ? searches
      : [];

    const cleanedTracks = finalTracks
      .map((t) => String(t || "").trim())
      .filter(Boolean);

    if (!finalName) {
      return res.status(400).json({
        success: false,
        error: "Puudub playlisti nimi."
      });
    }

    if (!cleanedTracks.length) {
      return res.status(400).json({
        success: false,
        error: "Puudub lugude nimekiri."
      });
    }

    let result;

    if (typeof createPlaylist === "function") {
      result = await createPlaylist(finalName, cleanedTracks);

      return res.json({
        success: true,
        playlistName: result.name || finalName,
        playlistUrl: result.url || result.playlistUrl || null,
        addedTracks:
          typeof result.addedTracks === "number"
            ? result.addedTracks
            : cleanedTracks.length,
        foundTracks: result.foundTracks || [],
        missingTracks: result.missingTracks || []
      });
    }

    result = await createPlaylistFromSearches(finalName, cleanedTracks);

    return res.json({
      success: !!result.success,
      playlistName: result.name || result.playlistName || finalName,
      playlistUrl: result.url || result.playlistUrl || null,
      addedTracks:
        typeof result.addedTracks === "number"
          ? result.addedTracks
          : typeof result.tracksAdded === "number"
          ? result.tracksAdded
          : 0,
      foundTracks: result.foundTracks || [],
      missingTracks: result.missingTracks || [],
      message: result.message || null
    });
  } catch (err) {
    console.error("POST /spotify/playlist error:", err);
    return sendError(res, 500, err);
  }
});

app.use((req, res) => {
  return res.status(404).json({
    success: false,
    error: `Route not found: ${req.method} ${req.originalUrl}`
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server töötab pordil ${PORT}`);
});