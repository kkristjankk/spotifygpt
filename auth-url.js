require("dotenv").config();

const clientId = process.env.SPOTIFY_CLIENT_ID;

const url =
  "https://accounts.spotify.com/authorize?" +
  new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: "http://127.0.0.1:8888/callback",
    scope: [
      "user-read-playback-state",
      "user-modify-playback-state",
      "playlist-modify-private",
      "playlist-modify-public"
    ].join(" ")
  }).toString();

console.log(url);