# Premier League Auction Simulation

This contains everything you need to run your app locally.

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:
   ```bash
   npm install
2. Run the app:

   ```bash
   npm run dev
## First-Time Database Initialization & Persistent Admin Code

The active Admin Code is stored exclusively as a salted scrypt hash inside the persistent database (`auction_database.json`). `ADMIN_DEFAULT_CODE` is only used during explicit first-time initialization:

1. Configure `ADMIN_DEFAULT_CODE` (and `ADMIN_CODE_CHANGE_PASSWORD`) in your environment.
2. Initialize the persistent database once:
   ```bash
   npm run init-db
   ```
   (This refuses to overwrite an already-initialized database.)
3. Start the app:
   ```bash
   npm run dev
   ```
   Or in production:
   ```bash
   npm run build && npm start
   ```

If the persistent database loses its Admin Code hash, recover access explicitly while keeping existing team/auction data intact:
```bash
npm run recover-admin -- --code NEWADMINCODE
```

## Persistent Storage on Render

`render.yaml` mounts a persistent disk at `/var/data` and sets `DATA_DIR=/var/data`. On first deploy, run `npm run init-db` in the Render Shell after setting `ADMIN_DEFAULT_CODE`. The server refuses to start on Render if persistent storage is unconfigured or unavailable, and will never silently recreate `ADMIN_DEFAULT_CODE` if the database is missing.

