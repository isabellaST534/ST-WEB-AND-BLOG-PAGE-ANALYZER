# Page Analyzer (Netlify)

1. Push this folder to a GitHub repo, then in Netlify: Add new site > Import from Git. (CLI alternative: `netlify deploy --prod`.)
2. Get a free key at https://openrouter.ai/keys (no card needed).
3. Site configuration > Environment variables, add:
   - AI_API_KEY = your key (required)
   - ACCESS_CODE = any code you choose (optional, recommended so strangers cannot use your key)
   - AI_MODEL = optional. Preferred model ids to try first; only used if they are currently free. By default the tool auto-discovers free models and never uses paid ones.
   - AI_BASE_URL = any OpenAI-compatible endpoint (optional), e.g. a hosted open model of your own.
   Note: the AI runs in a Netlify background function and saves results with Netlify Blobs (no setup needed). The repo root needs package.json.
4. Redeploy. Open the site, enter a URL and keywords, click Analyze.
