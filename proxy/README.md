# EAR3301 "Live Assistant" — Render proxy

This tiny server keeps your **Anthropic API key secret**. The book is a public file on
GitHub Pages, so the key can never live in the HTML — every model call goes through here.

## Deploy on Render (free)

1. Put this `proxy/` folder in its own GitHub repo (e.g. `gomaaarchitect-coder/ear3301-proxy`),
   or push the whole IED-Book repo and point Render at the `proxy` root directory.
2. Go to <https://render.com> → **New → Web Service** → connect the repo.
3. Settings:
   - **Root Directory**: `proxy` (only if you pushed the whole IED-Book repo)
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. **Environment variables** (Render → your service → Environment):
   | Key | Value |
   |---|---|
   | `ANTHROPIC_API_KEY` | your real Anthropic key (starts with `sk-ant-...`) |
   | `ALLOWED_ORIGIN` | `https://gomaaarchitect-coder.github.io` (no trailing slash) |
   | `MODEL` | `claude-sonnet-4-6` |
5. Deploy. Render gives you a URL like `https://ear3301-proxy.onrender.com`.
6. Open `index.html`, find `const ASSISTANT_PROXY_URL =` near the top of the script,
   and paste your Render URL (no trailing slash).

## Test it
Visit the Render URL in a browser — you should see
`EAR3301 Live Assistant proxy is running.`

## Cost protection (shared key)
Because all students share your key, the proxy rate-limits each IP to
**12 requests/min and 250/day**. Adjust `PER_MIN` / `PER_DAY` in `server.js`.
Also set a monthly spend limit in the Anthropic Console.

## Note on Render free tier
Free services sleep after inactivity, so the **first** message after a quiet period
can take ~30s to wake the server. Subsequent messages are fast. Upgrade to a paid
instance if you want it always-on.
