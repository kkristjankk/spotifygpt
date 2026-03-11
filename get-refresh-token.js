async function refreshAccessToken() {
  console.log("Refreshing Spotify access token...");

  const authBase64 = Buffer.from(client_id + ":" + client_secret).toString("base64");
  console.log("Basic auth exists:", !!authBase64, "length:", authBase64.length);

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + authBase64,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh_token,
    }),
  });

  const data = await response.json();

  console.log("Spotify token status:", response.status);
  console.log("Spotify token response:", data);

  if (!response.ok) {
    throw new Error("Tokeni uuendamine ebaõnnestus: " + JSON.stringify(data));
  }

  access_token = data.access_token;
  return access_token;
}