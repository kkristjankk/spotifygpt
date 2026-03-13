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
} = {}) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY missing");
  }

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

Task:
1. Describe the user's taste in 4-6 short bullet points.
2. Recommend 10 similar artists.
3. Recommend 15 songs in a similar style.
4. Keep recommendations discoverable but still close to the user's taste.

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
  };
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
    console.log(await recommendFromTaste());
    return;
  }

  await showHelp();
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
  refreshAccessToken,
  api,
};

if (require.main === module) {
  main().catch((err) => {
    console.error("Viga:", err);
    process.exit(1);
  });
}