require("dotenv").config();

const clientId = process.env.SPOTIFY_CLIENT_ID;

const scope = [
  "user-read-currently-playing",
  "user-read-playback-state",
  "user-modify-playback-state",
  "playlist-modify-private",
  "playlist-modify-public"
].join(" ");

const url =
  "https://accounts.spotify.com/authorize?" +
  new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: "http://127.0.0.1:8888/callback",
    scope
  }).toString();

console.log(url);