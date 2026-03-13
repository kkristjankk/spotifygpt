require("dotenv").config();

const client_id = process.env.SPOTIFY_CLIENT_ID?.trim();
const client_secret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
const refresh_token = process.env.SPOTIFY_REFRESH_TOKEN?.trim();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim();

let access_token = "";
let token_expiry = 0;

console.log("env loaded");

function assertEnv() {
  if (!client_id) throw new Error("SPOTIFY_CLIENT_ID missing");
  if (!client_secret) throw new Error("SPOTIFY_CLIENT_SECRET missing");
  if (!refresh_token) throw new Error("SPOTIFY_REFRESH_TOKEN missing");
}

async function refreshAccessToken() {
  assertEnv();

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization:
        "Basic " +
        Buffer.from(client_id + ":" + client_secret).toString("base64"),
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error("Token refresh failed: " + JSON.stringify(data));
  }

  access_token = data.access_token;
  token_expiry = Date.now() + Math.max((data.expires_in - 60) * 1000, 1000);

  console.log("TOKEN REFRESHED");
  return access_token;
}

async function ensureToken() {
  if (!access_token || Date.now() >= token_expiry) {
    await refreshAccessToken();
  }
}

async function api(url, options = {}, retry = true) {
  await ensureToken();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: "Bearer " + access_token,
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.status === 204) return null;

    const text = await response.text();

    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (response.status === 401 && retry) {
      console.log("API 401 -> refreshing token and retrying once");
      await refreshAccessToken();
      return api(url, options, false);
    }

    if (!response.ok) {
      throw new Error(
        `Spotify API error ${response.status}: ${
          typeof data === "string" ? data : JSON.stringify(data)
        }`
      );
    }

    return data;
  } catch (err) {
    if (retry) {
      console.log("API retry:", err.message || String(err));
      return api(url, options, false);
    }
    throw err;
  }
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

async function getMe() {
  return await api("https://api.spotify.com/v1/me");
}

async function getCurrentTrack() {
  const data = await api("https://api.spotify.com/v1/me/player/currently-playing");

  if (!data || !data.item) {
    return {
      isPlaying: false,
      message: "Praegu ei mängi midagi.",
    };
  }

  return {
    isPlaying: !!data.is_playing,
    track: data.item.name,
    artists: data.item.artists.map((a) => a.name).join(", "),
    album: data.item.album?.name || null,
    spotifyUrl: data.item.external_urls?.spotify || null,
  };
}

async function pauseMusic() {
  await api("https://api.spotify.com/v1/me/player/pause", {
    method: "PUT",
  });

  return { success: true, message: "Muusika pandi pausile." };
}

async function playMusic() {
  await api("https://api.spotify.com/v1/me/player/play", {
    method: "PUT",
  });

  return { success: true, message: "Muusika jätkub." };
}

async function playPlaylist(playlistId) {
  const cleanPlaylistId = cleanText(playlistId);

  if (!cleanPlaylistId) {
    throw new Error("playlistId missing");
  }

  await api("https://api.spotify.com/v1/me/player/play", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      context_uri: `spotify:playlist:${cleanPlaylistId}`,
    }),
  });

  return {
    success: true,
    message: "Playlist käivitati.",
    playlistId: cleanPlaylistId,
  };
}

async function playPlaylistByName(name) {
  const cleanName = cleanText(name).toLowerCase();

  if (!cleanName) {
    throw new Error("Playlist name missing");
  }

  let url = "https://api.spotify.com/v1/me/playlists?limit=50";
  let match = null;

  while (url) {
    const data = await api(url);
    const playlists = data?.items || [];

    match = playlists.find((p) =>
      cleanText(p?.name).toLowerCase().includes(cleanName)
    );

    if (match) break;

    url = data?.next || null;
  }

  if (!match) {
    return {
      success: false,
      playlistName: null,
      playlistId: null,
      url: null,
      message: `Playlisti "${name}" ei leitud.`,
    };
  }

  try {
    await playPlaylist(match.id);

    return {
      success: true,
      playlistName: match.name,
      playlistId: match.id,
      url: match.external_urls?.spotify || null,
      message: `Panin mängima playlisti "${match.name}".`,
    };
  } catch (err) {
    const errorText = String(err?.message || err);

    if (
      errorText.includes("No active device found") ||
      errorText.includes("NO_ACTIVE_DEVICE")
    ) {
      return {
        success: false,
        playlistName: match.name,
        playlistId: match.id,
        url: match.external_urls?.spotify || null,
        noActiveDevice: true,
        message:
          `Leidsin playlisti "${match.name}", aga Spotify's ei olnud aktiivset seadet. Ava Spotify äpp ja proovi uuesti.`,
      };
    }

    throw err;
  }
}

async function nextTrack() {
  await api("https://api.spotify.com/v1/me/player/next", {
    method: "POST",
  });

  return { success: true, message: "Järgmine lugu." };
}

async function previousTrack() {
  await api("https://api.spotify.com/v1/me/player/previous", {
    method: "POST",
  });

  return { success: true, message: "Eelmine lugu." };
}

async function searchTrack(query) {
  const cleanQuery = cleanText(query);
  if (!cleanQuery) return null;

  const url =
    "https://api.spotify.com/v1/search?" +
    new URLSearchParams({
      q: cleanQuery,
      type: "track",
      limit: "1",
    }).toString();

  const data = await api(url);

  if (!data?.tracks?.items?.length) return null;

  return data.tracks.items[0];
}

async function createEmptyPlaylist(name, description = "Loodud SpotifyGPT assistendiga") {
  const cleanName = cleanText(name);
  if (!cleanName) {
    throw new Error("Playlist name missing");
  }

  const playlist = await api("https://api.spotify.com/v1/me/playlists", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: cleanName,
      description: cleanText(description),
      public: false,
    }),
  });

  return playlist;
}

async function addTracksToPlaylist(playlistId, uris) {
  if (!playlistId) throw new Error("playlistId missing");

  const cleanUris = Array.from(
    new Set(
      (Array.isArray(uris) ? uris : [])
        .map((u) => cleanText(u))
        .filter(Boolean)
    )
  );

  if (!cleanUris.length) {
    return { snapshot_ids: [], addedTracks: 0 };
  }

  const batchSize = 100;
  const snapshotIds = [];

  for (let i = 0; i < cleanUris.length; i += batchSize) {
    const batch = cleanUris.slice(i, i + batchSize);

    const result = await api(`https://api.spotify.com/v1/playlists/${playlistId}/items`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        uris: batch,
      }),
    });

    if (result?.snapshot_id) {
      snapshotIds.push(result.snapshot_id);
    }
  }

  return {
    snapshot_ids: snapshotIds,
    addedTracks: cleanUris.length,
  };
}

async function createPlaylistFromSearches(name, searches) {
  const queries = (Array.isArray(searches) ? searches : [])
    .map((q) => cleanText(q))
    .filter(Boolean);

  if (!cleanText(name)) {
    throw new Error("Playlist name missing");
  }

  if (!queries.length) {
    throw new Error("No track searches provided");
  }

  const uris = [];
  const foundTracks = [];
  const missingTracks = [];

  for (const q of queries) {
    const track = await searchTrack(q);

    if (track) {
      uris.push(track.uri);
      foundTracks.push({
        name: track.name,
        artists: track.artists.map((a) => a.name).join(", "),
        uri: track.uri,
      });
    } else {
      missingTracks.push(q);
    }
  }

  if (!uris.length) {
    return {
      success: false,
      message: "Ühtegi lugu ei leitud. Playlisti ei loodud.",
      name,
      url: null,
      addedTracks: 0,
      foundTracks: [],
      missingTracks,
    };
  }

  const playlist = await createEmptyPlaylist(
    name,
    "Loodud automaatselt SpotifyGPT assistendiga"
  );

  const addResult = await addTracksToPlaylist(playlist.id, uris);

  return {
    success: true,
    name: playlist.name,
    playlistId: playlist.id,
    url: playlist.external_urls?.spotify || null,
    addedTracks: addResult.addedTracks || uris.length,
    foundTracks,
    missingTracks,
  };
}

async function createPlaylist(name, tracksOrDescription = []) {
  if (Array.isArray(tracksOrDescription)) {
    return await createPlaylistFromSearches(name, tracksOrDescription);
  }

  const playlist = await createEmptyPlaylist(name, tracksOrDescription);
  return {
    success: true,
    name: playlist.name,
    playlistId: playlist.id,
    url: playlist.external_urls?.spotify || null,
    addedTracks: 0,
    foundTracks: [],
    missingTracks: [],
  };
}

async function generateAIPlaylist(prompt) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY missing");
  }

  const cleanPrompt = cleanText(prompt);
  if (!cleanPrompt) {
    throw new Error("AI playlist prompt missing");
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.8,
      messages: [
        {
          role: "system",
          content:
            "Generate exactly 15 playlist tracks for Spotify. Return only a plain text list, one item per line, in the format 'Artist - Song'. No intro, no commentary.",
        },
        {
          role: "user",
          content: cleanPrompt,
        },
      ],
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error("OpenAI error: " + JSON.stringify(data));
  }

  const text = data?.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("OpenAI returned empty playlist");
  }

  const songs = text
    .split("\n")
    .map((s) => s.replace(/^\s*[-*]?\s*\d*\.?\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 15);

  if (!songs.length) {
    throw new Error("AI generated no usable songs");
  }

  return songs;
}

async function createAIPlaylist(prompt) {
  const cleanPrompt = cleanText(prompt);
  console.log("Generating AI playlist:", cleanPrompt);

  const songs = await generateAIPlaylist(cleanPrompt);

  return await createPlaylistFromSearches(`SpotifyGPT – ${cleanPrompt}`, songs);
}

async function createAIPlaylistAndPlay(prompt) {
  const cleanPrompt = cleanText(prompt);

  if (!cleanPrompt) {
    throw new Error("AI DJ prompt missing");
  }

  console.log("Generating AI DJ playlist:", cleanPrompt);

  const result = await createAIPlaylist(cleanPrompt);

  if (!result?.success) {
    return {
      ...result,
      playbackStarted: false,
    };
  }

  if (!result?.playlistId) {
    throw new Error("Playlist loodi, aga playlistId puudub");
  }

  try {
    await playPlaylist(result.playlistId);

    return {
      success: true,
      name: result.name || `SpotifyGPT – ${cleanPrompt}`,
      playlistId: result.playlistId,
      url: result.url || null,
      addedTracks:
        typeof result.addedTracks === "number" ? result.addedTracks : 0,
      foundTracks: result.foundTracks || [],
      missingTracks: result.missingTracks || [],
      playbackStarted: true,
      message: "AI DJ playlist loodi ja pandi mängima.",
    };
  } catch (err) {
    const errorText = String(err?.message || err);

    if (
      errorText.includes("No active device found") ||
      errorText.includes("NO_ACTIVE_DEVICE")
    ) {
      return {
        success: true,
        name: result.name || `SpotifyGPT – ${cleanPrompt}`,
        playlistId: result.playlistId,
        url: result.url || null,
        addedTracks:
          typeof result.addedTracks === "number" ? result.addedTracks : 0,
        foundTracks: result.foundTracks || [],
        missingTracks: result.missingTracks || [],
        playbackStarted: false,
        message:
          "Playlist loodi edukalt, aga Spotify's ei olnud aktiivset seadet. Ava Spotify äpp mõnes seadmes ja proovi uuesti.",
      };
    }

    throw err;
  }
}

/* -------------------- TASTE ANALYSIS -------------------- */

async function getMySavedTracks(limit = 50) {
  const finalLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
  let url = `https://api.spotify.com/v1/me/tracks?limit=${Math.min(finalLimit, 50)}`;
  const items = [];

  while (url && items.length < finalLimit) {
    const data = await api(url);
    const batch = Array.isArray(data?.items) ? data.items : [];
    items.push(...batch);
    url = data?.next || null;

    if (items.length >= finalLimit) break;
  }

  return items.slice(0, finalLimit).map((item) => ({
    addedAt: item.added_at,
    id: item.track?.id || null,
    name: item.track?.name || null,
    artists: (item.track?.artists || []).map((a) => a.name),
    artistIds: (item.track?.artists || []).map((a) => a.id).filter(Boolean),
    album: item.track?.album?.name || null,
    spotifyUrl: item.track?.external_urls?.spotify || null,
  }));
}

async function getMyPlaylists(limit = 50) {
  const finalLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
  let url = `https://api.spotify.com/v1/me/playlists?limit=${Math.min(finalLimit, 50)}`;
  const playlists = [];

  while (url && playlists.length < finalLimit) {
    const data = await api(url);
    const batch = Array.isArray(data?.items) ? data.items : [];
    playlists.push(...batch);
    url = data?.next || null;

    if (playlists.length >= finalLimit) break;
  }

  return playlists.slice(0, finalLimit).map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description || "",
    owner: p.owner?.display_name || null,
    totalTracks: p.tracks?.total || 0,
    spotifyUrl: p.external_urls?.spotify || null,
  }));
}

async function getPlaylistTracks(playlistId, limit = 100) {
  const cleanPlaylistId = cleanText(playlistId);
  if (!cleanPlaylistId) {
    throw new Error("playlistId missing");
  }

  const finalLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
  let url =
    `https://api.spotify.com/v1/playlists/${cleanPlaylistId}/tracks?limit=${Math.min(finalLimit, 100)}`;
  const items = [];

  while (url && items.length < finalLimit) {
    const data = await api(url);
    const batch = Array.isArray(data?.items) ? data.items : [];
    items.push(...batch);
    url = data?.next || null;

    if (items.length >= finalLimit) break;
  }

  return items
    .slice(0, finalLimit)
    .map((item) => item?.track)
    .filter(Boolean)
    .map((track) => ({
      id: track.id || null,
      name: track.name || null,
      artists: (track.artists || []).map((a) => a.name),
      artistIds: (track.artists || []).map((a) => a.id).filter(Boolean),
      album: track.album?.name || null,
      spotifyUrl: track.external_urls?.spotify || null,
    }));
}

function buildTasteProfile({ savedTracks = [], playlistTracks = [] }) {
  const allTracks = [...savedTracks, ...playlistTracks];

  const artistCount = new Map();
  const trackCount = new Map();

  for (const track of allTracks) {
    const artistNames = Array.isArray(track?.artists) ? track.artists : [];
    for (const artist of artistNames) {
      artistCount.set(artist, (artistCount.get(artist) || 0) + 1);
    }

    const key = `${artistNames.join(", ")} - ${track?.name || "Unknown track"}`;
    trackCount.set(key, (trackCount.get(key) || 0) + 1);
  }

  const topArtists = [...artistCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([name, count]) => ({ name, count }));

  const topTracks = [...trackCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([name, count]) => ({ name, count }));

  return {
    totalTracksAnalyzed: allTracks.length,
    topArtists,
    topTracks,
  };
}

async function recommendFromTaste({
  savedTracksLimit = 50,
  playlistsLimit = 8,
  tracksPerPlaylist = 30,
  stylePrompt = "",
} = {}) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY missing");
  }

  const cleanStyle = cleanText(stylePrompt);
  const savedTracks = await getMySavedTracks(savedTracksLimit);
  const playlists = await getMyPlaylists(playlistsLimit);

  const playlistTracks = [];
  for (const playlist of playlists) {
    try {
      const tracks = await getPlaylistTracks(playlist.id, tracksPerPlaylist);
      playlistTracks.push(...tracks);
    } catch (err) {
      console.log(
        `Skipping playlist ${playlist.name || playlist.id}:`,
        err.message || String(err)
      );
    }
  }

  const tasteProfile = buildTasteProfile({
    savedTracks,
    playlistTracks,
  });

  const prompt = `
User music taste summary:
- Analyzed tracks: ${tasteProfile.totalTracksAnalyzed}
- Top artists: ${tasteProfile.topArtists.map((a) => `${a.name} (${a.count})`).join(", ")}
- Top tracks: ${tasteProfile.topTracks.slice(0, 10).map((t) => `${t.name} (${t.count})`).join(", ")}

${cleanStyle ? `Additional instruction: keep the recommendations within this style or mood: ${cleanStyle}` : ""}

Task:
1. Describe the user's taste in 4-6 short bullet points.
2. Recommend 10 similar artists.
3. Recommend 15 songs in a similar style.
4. Keep recommendations discoverable but still close to the user's taste.
5. ${cleanStyle ? "Respect the requested style/mood while staying close to the user's taste." : "Stay close to the user's taste."}

Return JSON in this exact shape:
{
  "summary": ["..."],
  "artists": ["Artist 1", "Artist 2"],
  "tracks": ["Artist - Song", "Artist - Song"]
}
`.trim();

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.7,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You are a music recommendation assistant. Return only valid JSON.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error("OpenAI error: " + JSON.stringify(data));
  }

  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned empty recommendation content");
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("OpenAI returned invalid JSON: " + content);
  }

  return {
    tasteProfile,
    summary: Array.isArray(parsed.summary) ? parsed.summary : [],
    artists: Array.isArray(parsed.artists) ? parsed.artists : [],
    tracks: Array.isArray(parsed.tracks) ? parsed.tracks : [],
    sampledPlaylists: playlists.map((p) => ({
      id: p.id,
      name: p.name,
      totalTracks: p.totalTracks,
      spotifyUrl: p.spotifyUrl,
    })),
    savedTracksSampled: savedTracks.length,
    playlistTracksSampled: playlistTracks.length,
    stylePrompt: cleanStyle || null,
  };
}

async function createTastePlaylist(stylePrompt = "") {
  const cleanStyle = cleanText(stylePrompt);

  console.log("Analyzing taste and generating playlist...");

  const rec = await recommendFromTaste({
    stylePrompt: cleanStyle,
  });

  if (!rec?.tracks?.length) {
    throw new Error("AI ei tagastanud ühtegi lugu.");
  }

  const playlistName = cleanStyle
    ? `SpotifyGPT – Your Taste (${cleanStyle})`
    : "SpotifyGPT – Your Taste";

  const result = await createPlaylistFromSearches(
    playlistName,
    rec.tracks
  );

  return {
    success: true,
    playlistName: result.name,
    playlistUrl: result.url,
    playlistId: result.playlistId,
    addedTracks: result.addedTracks,
    foundTracks: result.foundTracks || [],
    missingTracks: result.missingTracks || [],
    recommendedArtists: rec.artists,
    tasteSummary: rec.summary,
    stylePrompt: cleanStyle || null,
  };
}

async function createDiscoverPlaylist(stylePrompt = "") {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY missing");
  }

  const cleanStyle = cleanText(stylePrompt);

  console.log("Analyzing taste and generating discover playlist...");

  const savedTracks = await getMySavedTracks(60);
  const playlists = await getMyPlaylists(10);

  const playlistTracks = [];
  for (const playlist of playlists) {
    try {
      const tracks = await getPlaylistTracks(playlist.id, 30);
      playlistTracks.push(...tracks);
    } catch (err) {
      console.log(
        `Skipping playlist ${playlist.name || playlist.id}:`,
        err.message || String(err)
      );
    }
  }

  const tasteProfile = buildTasteProfile({
    savedTracks,
    playlistTracks,
  });

  const topArtistNames = tasteProfile.topArtists.map((a) => a.name);
  const topTrackNames = tasteProfile.topTracks.map((t) => t.name);

  const prompt = `
User music taste summary:
- Analyzed tracks: ${tasteProfile.totalTracksAnalyzed}
- Top artists: ${topArtistNames.join(", ")}
- Top tracks: ${topTrackNames.slice(0, 12).join(", ")}

${cleanStyle ? `Requested style/mood: ${cleanStyle}` : ""}

Task:
1. Recommend 15 songs for a "discover weekly" style playlist.
2. Stay close to the user's taste, but avoid the most obvious mainstream picks.
3. Prefer slightly less-known or adjacent artists.
4. Avoid repeating the user's top tracks.
5. Avoid recommending tracks by the user's most repeated top artists unless truly necessary.
6. Keep it cohesive and Spotify-searchable.
7. ${cleanStyle ? "Respect the requested style/mood." : "No extra style constraint."}

Return JSON in this exact shape:
{
  "summary": ["..."],
  "artists": ["Artist 1", "Artist 2"],
  "tracks": ["Artist - Song", "Artist - Song"]
}
`.trim();

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.8,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a music discovery assistant. Return only valid JSON.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error("OpenAI error: " + JSON.stringify(data));
  }

  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned empty discovery content");
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("OpenAI returned invalid JSON: " + content);
  }

  const tracks = Array.isArray(parsed.tracks) ? parsed.tracks : [];
  const artists = Array.isArray(parsed.artists) ? parsed.artists : [];
  const summary = Array.isArray(parsed.summary) ? parsed.summary : [];

  if (!tracks.length) {
    throw new Error("AI ei tagastanud ühtegi discover-lugu.");
  }

  const playlistName = cleanStyle
    ? `SpotifyGPT – Discover (${cleanStyle})`
    : "SpotifyGPT – Discover";

  const result = await createPlaylistFromSearches(playlistName, tracks);

  return {
    success: true,
    playlistName: result.name,
    playlistUrl: result.url,
    playlistId: result.playlistId,
    addedTracks: result.addedTracks,
    foundTracks: result.foundTracks || [],
    missingTracks: result.missingTracks || [],
    recommendedArtists: artists,
    discoverSummary: summary,
    stylePrompt: cleanStyle || null,
  };
}

/* -------------------- VOICE COMMANDS -------------------- */

function extractStyleFromPrompt(prompt) {
  const text = cleanText(prompt);

  let result = text
    .replace(/^play\s+/i, "")
    .replace(/^pane\s+/i, "")
    .replace(/^make me\s+/i, "")
    .replace(/^create\s+/i, "")
    .replace(/^tee mulle\s+/i, "")
    .replace(/^loo mulle\s+/i, "")
    .replace(/^generate\s+/i, "")
    .replace(/\bplaylist\b/gi, "")
    .replace(/\bmu playlist\b/gi, "")
    .replace(/\bmy playlist\b/gi, "")
    .replace(/\bplease\b/gi, "")
    .trim();

  return cleanText(result);
}

function extractPlaylistNameFromPrompt(prompt) {
  const text = cleanText(prompt);

  const quotedMatch = text.match(/["“](.+?)["”]/);
  if (quotedMatch?.[1]) {
    return cleanText(quotedMatch[1]);
  }

  let result = text
    .replace(/^play\s+/i, "")
    .replace(/^pane mängima\s+/i, "")
    .replace(/^käivita\s+/i, "")
    .replace(/^start\s+/i, "")
    .replace(/\bmy\b/gi, "")
    .replace(/\bmu\b/gi, "")
    .replace(/\bplaylist\b/gi, "")
    .trim();

  return cleanText(result);
}

function isNoActiveDeviceError(err) {
  const errorText = String(err?.message || err || "");
  return (
    errorText.includes("No active device found") ||
    errorText.includes("NO_ACTIVE_DEVICE")
  );
}

function buildNoActiveDeviceResponse(action, extra = {}) {
  return {
    success: false,
    action,
    noActiveDevice: true,
    message:
      "Spotify's ei olnud aktiivset seadet. Ava Spotify äpp telefonis või arvutis ja proovi uuesti.",
    ...extra
  };
}

async function handleVoiceCommand(prompt) {
  const rawPrompt = cleanText(prompt);
  const input = rawPrompt.toLowerCase();

  if (!input) {
    return {
      success: false,
      action: "unknown",
      message: "Käsk puudub."
    };
  }

  try {
    if (
      /(mis lugu mängib|what('?s| is) playing|current track|currently playing)/i.test(
        input
      )
    ) {
      const data = await getCurrentTrack();
      return {
        success: true,
        action: "current",
        message: data?.message
          ? data.message
          : `Praegu mängib: ${data.artists} – ${data.track}`,
        data
      };
    }

    if (/(pause|pane pausile|stop music|stop playback|peata muusika)/i.test(input)) {
      const result = await pauseMusic();
      return {
        success: true,
        action: "pause",
        message: result.message
      };
    }

    if (/(next|skip|järgmine|edasi järgmise loo juurde)/i.test(input)) {
      const result = await nextTrack();
      return {
        success: true,
        action: "next",
        message: result.message
      };
    }

    if (/(previous|go back|eelmine|tagasi eelmise loo juurde)/i.test(input)) {
      const result = await previousTrack();
      return {
        success: true,
        action: "previous",
        message: result.message
      };
    }

    if (
      /(play my|play playlist|pane playlist|käivita playlist|mängi playlisti)/i.test(
        input
      )
    ) {
      const playlistName = extractPlaylistNameFromPrompt(rawPrompt);

      if (!playlistName) {
        return {
          success: false,
          action: "play_playlist_by_name",
          message: "Playlisti nime ei õnnestunud tuvastada."
        };
      }

      const result = await playPlaylistByName(playlistName);

      return {
        success: !!result.success,
        action: "play_playlist_by_name",
        playlistName: result.playlistName || null,
        playlistUrl: result.url || null,
        playlistId: result.playlistId || null,
        noActiveDevice: !!result.noActiveDevice,
        message: result.message
      };
    }

    if (
      /(play something like|play music like|play songs like|music like|songs like|something like)/i.test(
        input
      )
    ) {
      const artist = rawPrompt
        .replace(/^play something like\s+/i, "")
        .replace(/^play music like\s+/i, "")
        .replace(/^play songs like\s+/i, "")
        .replace(/^music like\s+/i, "")
        .replace(/^songs like\s+/i, "")
        .replace(/^something like\s+/i, "")
        .trim();

      if (!artist) {
        return {
          success: false,
          action: "similar_artist_playlist",
          message: "Artisti nime ei õnnestunud tuvastada."
        };
      }

      const result = await createSimilarArtistPlaylist(artist);

      let playbackStarted = false;
      let message = `Lõin playlisti artisti "${artist}" sarnase muusika põhjal.`;

      if (result?.id) {
        try {
          await playPlaylist(result.id);
          playbackStarted = true;
          message = `Lõin ja panin mängima playlisti artisti "${artist}" sarnase muusika põhjal.`;
        } catch (playErr) {
          if (isNoActiveDeviceError(playErr)) {
            return {
              success: true,
              action: "similar_artist_playlist",
              playlistName: result.name || null,
              playlistUrl: result.url || null,
              playlistId: result.id || null,
              addedTracks: result.addedTracks || 0,
              playbackStarted: false,
              noActiveDevice: true,
              message:
                "Playlist loodi, aga Spotify's ei olnud aktiivset seadet. Ava Spotify äpp ja proovi uuesti."
            };
          }
          throw playErr;
        }
      }

      return {
        success: true,
        action: "similar_artist_playlist",
        playlistName: result.name || null,
        playlistUrl: result.url || null,
        playlistId: result.id || null,
        addedTracks: result.addedTracks || 0,
        playbackStarted,
        message
      };
    }

    if (
      /(my taste|mu maitse|based on my taste|minu maitse põhjal)/i.test(input) &&
      /(play|mängi|tee|create|make|loo)/i.test(input)
    ) {
      const style = extractStyleFromPrompt(rawPrompt)
        .replace(/\bbased on my taste\b/gi, "")
        .replace(/\bmy taste\b/gi, "")
        .replace(/\bminu maitse põhjal\b/gi, "")
        .replace(/\bmu maitse\b/gi, "")
        .trim();

      const result = await createTastePlaylist(style);

      let playbackStarted = false;
      let message =
        style
          ? `Lõin taste-playlisti stiilis "${style}".`
          : "Lõin sinu maitse põhjal playlisti.";

      if (result?.playlistId) {
        try {
          await playPlaylist(result.playlistId);
          playbackStarted = true;
          message =
            style
              ? `Lõin ja panin mängima sinu maitse põhjal playlisti stiilis "${style}".`
              : "Lõin ja panin mängima sinu maitse põhjal playlisti.";
        } catch (playErr) {
          if (isNoActiveDeviceError(playErr)) {
            return {
              success: true,
              action: "taste_playlist",
              playlistName: result.playlistName || null,
              playlistUrl: result.playlistUrl || null,
              playlistId: result.playlistId || null,
              addedTracks: result.addedTracks || 0,
              foundTracks: result.foundTracks || [],
              missingTracks: result.missingTracks || [],
              playbackStarted: false,
              noActiveDevice: true,
              message:
                "Playlist loodi, aga Spotify's ei olnud aktiivset seadet. Ava Spotify äpp ja proovi uuesti."
            };
          }
          throw playErr;
        }
      }

      return {
        success: true,
        action: "taste_playlist",
        playlistName: result.playlistName || null,
        playlistUrl: result.playlistUrl || null,
        playlistId: result.playlistId || null,
        addedTracks: result.addedTracks || 0,
        foundTracks: result.foundTracks || [],
        missingTracks: result.missingTracks || [],
        playbackStarted,
        message
      };
    }

    if (
      /(recommend|soovita|recommendation|soovitus)/i.test(input) &&
      /(my taste|mu maitse|based on my taste|minu maitse põhjal)/i.test(input)
    ) {
      const style = extractStyleFromPrompt(rawPrompt)
        .replace(/\bbased on my taste\b/gi, "")
        .replace(/\bmy taste\b/gi, "")
        .replace(/\bminu maitse põhjal\b/gi, "")
        .replace(/\bmu maitse\b/gi, "")
        .trim();

      const result = await recommendFromTaste({
        stylePrompt: style
      });

      return {
        success: true,
        action: "taste_recommendation",
        message:
          style
            ? `Leidsin soovitusi sinu maitse põhjal stiilis "${style}".`
            : "Leidsin soovitusi sinu maitse põhjal.",
        data: result
      };
    }

    if (
      /(create and play|make and play|generate and play|tee ja pane mängima|loo ja pane mängima)/i.test(
        input
      )
    ) {
      const promptText = extractStyleFromPrompt(rawPrompt) || rawPrompt;
      const result = await createAIPlaylistAndPlay(promptText);

      return {
        success: !!result.success,
        action: "ai_dj",
        playlistName: result.name || null,
        playlistUrl: result.url || null,
        playlistId: result.playlistId || null,
        addedTracks: result.addedTracks || 0,
        foundTracks: result.foundTracks || [],
        missingTracks: result.missingTracks || [],
        playbackStarted: !!result.playbackStarted,
        message: result.message || "AI DJ playlist valmis."
      };
    }

    if (
      /(discover|avasta|something new|midagi uut|discover weekly)/i.test(input) &&
      /(play|mängi|tee|create|make|loo|generate)/i.test(input)
    ) {
      const style = extractStyleFromPrompt(rawPrompt)
        .replace(/^me\b/gi, "")
        .replace(/\bdiscover weekly\b/gi, "")
        .replace(/\bsomething new\b/gi, "")
        .replace(/\bmidagi uut\b/gi, "")
        .replace(/\bdiscover\b/gi, "")
        .replace(/\bavasta\b/gi, "")
        .trim();

      const result = await createDiscoverPlaylist(style);

      let playbackStarted = false;
      let message =
        style
          ? `Lõin discover-playlisti stiilis "${style}".`
          : "Lõin sulle discover-playlisti.";

      if (result?.playlistId) {
        try {
          await playPlaylist(result.playlistId);
          playbackStarted = true;
          message =
            style
              ? `Lõin ja panin mängima discover-playlisti stiilis "${style}".`
              : "Lõin ja panin mängima discover-playlisti.";
        } catch (playErr) {
          if (isNoActiveDeviceError(playErr)) {
            return {
              success: true,
              action: "discover_playlist",
              playlistName: result.playlistName || null,
              playlistUrl: result.playlistUrl || null,
              playlistId: result.playlistId || null,
              addedTracks: result.addedTracks || 0,
              foundTracks: result.foundTracks || [],
              missingTracks: result.missingTracks || [],
              playbackStarted: false,
              noActiveDevice: true,
              message:
                "Discover-playlist loodi, aga Spotify's ei olnud aktiivset seadet. Ava Spotify äpp ja proovi uuesti."
            };
          }
          throw playErr;
        }
      }

      return {
        success: true,
        action: "discover_playlist",
        playlistName: result.playlistName || null,
        playlistUrl: result.playlistUrl || null,
        playlistId: result.playlistId || null,
        addedTracks: result.addedTracks || 0,
        foundTracks: result.foundTracks || [],
        missingTracks: result.missingTracks || [],
        playbackStarted,
        message
      };
    }

    if (
      /^(play|mängi|pane mängima)\s+.+/i.test(input) &&
      !/(playlist|lugu|song|track)/i.test(input)
    ) {
      const promptText = extractStyleFromPrompt(rawPrompt) || rawPrompt;
      const result = await createAIPlaylistAndPlay(promptText);

      return {
        success: !!result.success,
        action: "ai_dj",
        playlistName: result.name || null,
        playlistUrl: result.url || null,
        playlistId: result.playlistId || null,
        addedTracks: result.addedTracks || 0,
        foundTracks: result.foundTracks || [],
        missingTracks: result.missingTracks || [],
        playbackStarted: !!result.playbackStarted,
        message: result.message || "AI DJ playlist valmis."
      };
    }

    if (
      /(create|make|generate|tee|loo)/i.test(input) &&
      /(playlist|mix|miks|list)/i.test(input)
    ) {
      const promptText = extractStyleFromPrompt(rawPrompt) || rawPrompt;
      const result = await createAIPlaylist(promptText);

      return {
        success: !!result.success,
        action: "create_ai_playlist",
        playlistName: result.name || null,
        playlistUrl: result.url || null,
        playlistId: result.playlistId || null,
        addedTracks: result.addedTracks || 0,
        foundTracks: result.foundTracks || [],
        missingTracks: result.missingTracks || [],
        message: `Playlist "${result.name || promptText}" on loodud.`
      };
    }

    if (/(resume|continue|play|jätka|pane käima|käivita muusika)/i.test(input)) {
      const result = await playMusic();
      return {
        success: true,
        action: "play",
        message: result.message
      };
    }

    return {
      success: false,
      action: "unknown",
      message: "Ma ei saanud käsust aru."
    };
  } catch (err) {
    if (isNoActiveDeviceError(err)) {
      return buildNoActiveDeviceResponse("voice");
    }

    return {
      success: false,
      action: "error",
      message: String(err?.message || err)
    };
  }
}

async function showHelp() {
  console.log(`
Kasutus:

node spotify.js me
node spotify.js current
node spotify.js play
node spotify.js pause
node spotify.js next
node spotify.js prev

Playlist:
node spotify.js playlist "Chill õhtu" "The Weeknd Blinding Lights" "Dua Lipa Levitating" "Daft Punk Get Lucky"

AI Playlist:
node spotify.js ai "90s eurodance"

AI DJ:
node spotify.js ai-dj "90s eurodance"

Taste analysis:
node spotify.js taste
node spotify.js taste "melodic house"

Taste playlist:
node spotify.js taste-playlist
node spotify.js taste-playlist "melodic house"

Discover playlist:
node spotify.js discover
node spotify.js discover "melodic house"
`);
}

async function main() {
  const command = process.argv[2];

  if (!command) {
    await showHelp();
    return;
  }

  if (command === "me") {
    console.log(await getMe());
    return;
  }

  if (command === "current") {
    console.log(await getCurrentTrack());
    return;
  }

  if (command === "play") {
    console.log(await playMusic());
    return;
  }

  if (command === "pause") {
    console.log(await pauseMusic());
    return;
  }

  if (command === "next") {
    console.log(await nextTrack());
    return;
  }

  if (command === "prev") {
    console.log(await previousTrack());
    return;
  }

  if (command === "playlist") {
    const playlistName = process.argv[3];
    const searches = process.argv.slice(4);

    if (!playlistName || searches.length === 0) {
      console.log('Näide: node spotify.js playlist "Chill õhtu" "The Weeknd Blinding Lights" "Dua Lipa Levitating"');
      return;
    }

    console.log(await createPlaylistFromSearches(playlistName, searches));
    return;
  }

  if (command === "ai") {
    const prompt = process.argv.slice(3).join(" ");

    if (!prompt) {
      console.log('Näide: node spotify.js ai "90s eurodance"');
      return;
    }

    console.log(await createAIPlaylist(prompt));
    return;
  }

  if (command === "ai-dj") {
    const prompt = process.argv.slice(3).join(" ");

    if (!prompt) {
      console.log('Näide: node spotify.js ai-dj "90s eurodance"');
      return;
    }

    console.log(await createAIPlaylistAndPlay(prompt));
    return;
  }

  if (command === "taste") {
    const style = process.argv.slice(3).join(" ");
    console.log(await recommendFromTaste({ stylePrompt: style }));
    return;
  }

  if (command === "taste-playlist") {
    const style = process.argv.slice(3).join(" ");
    console.log(await createTastePlaylist(style));
    return;
  }

  if (command === "discover") {
    const style = process.argv.slice(3).join(" ");
    console.log(await createDiscoverPlaylist(style));
    return;
  }

  await showHelp();
}

async function createSimilarArtistPlaylist(artistName) {
  const search = await api(
    "https://api.spotify.com/v1/search?q=" +
      encodeURIComponent(artistName) +
      "&type=artist&limit=1"
  );

  const artist = search?.artists?.items?.[0];

  if (!artist) {
    throw new Error("Artist not found");
  }

  const related = await api(
    "https://api.spotify.com/v1/artists/" +
      artist.id +
      "/related-artists"
  );

  const artists = related?.artists?.slice(0, 10) || [];
  const uris = [];

  for (const a of artists) {
    const top = await api(
      "https://api.spotify.com/v1/artists/" +
        a.id +
        "/top-tracks?market=US"
    );

    if (top?.tracks?.length) {
      uris.push(top.tracks[0].uri);
    }
  }

  if (!uris.length) {
    throw new Error("No tracks found for similar artists");
  }

  const playlist = await createEmptyPlaylist(
    `SpotifyGPT – Similar to ${artistName}`,
    `Artists similar to ${artistName}`
  );

  const addResult = await addTracksToPlaylist(playlist.id, uris);

  return {
    name: playlist.name,
    id: playlist.id,
    url: playlist.external_urls?.spotify || null,
    addedTracks: addResult.addedTracks || uris.length
  };
}

module.exports = {
  getMe,
  getCurrentTrack,
  pauseMusic,
  playMusic,
  playPlaylist,
  playPlaylistByName,
  nextTrack,
  previousTrack,
  searchTrack,
  createPlaylist,
  addTracksToPlaylist,
  createPlaylistFromSearches,
  createAIPlaylist,
  createAIPlaylistAndPlay,
  getMySavedTracks,
  getMyPlaylists,
  getPlaylistTracks,
  buildTasteProfile,
  recommendFromTaste,
  createTastePlaylist,
  createDiscoverPlaylist,
  handleVoiceCommand,
  refreshAccessToken,
  createSimilarArtistPlaylist,
  api,
};

if (require.main === module) {
  main().catch((err) => {
    console.error("Viga:", err);
    process.exit(1);
  });
}
