# TradeCircle Website Deployment

This project is a website served by Node.js + Express (not GitHub Pages static-only).

## 1) Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

## 2) Create MongoDB Atlas Database

1. Create a free cluster.
2. Create a DB user and password.
3. Allow your app network access (for first setup you can allow `0.0.0.0/0`).
4. Copy the connection string and replace credentials.

## 3) Deploy on Render

1. Create a new Web Service from your GitHub repo.
2. Use:
   - Build Command: `npm install`
   - Start Command: `npm start`
3. Add environment variables:
   - `MONGO_URI` = your Atlas URI
   - `JWT_SECRET` = strong random secret
   - `NODE_ENV` = `production`
   - `CORS_ORIGIN` (optional, only if serving frontend from another domain)
   - `CLOUDINARY_CLOUD_NAME` = your Cloudinary cloud name
   - `CLOUDINARY_API_KEY` = your Cloudinary API key
   - `CLOUDINARY_API_SECRET` = your Cloudinary API secret
   - `CLOUDINARY_FOLDER` (optional) = e.g. `tradecircle`

This repo includes `render.yaml`, so Render can auto-detect the settings.

## 4) Verify

- Home page: `https://<your-service>.onrender.com/`
- Health: `https://<your-service>.onrender.com/health`

## Notes

- `.env` is ignored by git. Keep secrets out of GitHub.
- On Render, local `uploads/` files are not persistent. Cloudinary vars above make image URLs persistent across sleep/redeploy.
- If Git is not installed on Windows:
  - `winget install --id Git.Git -e --source winget`
