# Start Mmarket Store on Windows (without Docker)

This is the recommended path for local testing when Docker Desktop / WSL is unavailable. The app needs MongoDB configured as replica set `rs0`, the Express API, and the Angular frontend. Use a supported Node.js version: `22.22.3+` in Node 22 or `24.15.0+` in Node 24 (Node 24.21.0 is suitable).

## 1. Extract and verify prerequisites

Extract the ZIP, open the `mmarket-store` folder in VS Code, then open a PowerShell terminal there:

```powershell
node -v
npm -v
mongosh --version
```

Start your local MongoDB service first. Verify the existing replica set is healthy:

```powershell
mongosh "mongodb://127.0.0.1:27017/admin?replicaSet=rs0" --quiet --eval "rs.status().myState"
```

A healthy primary returns `1`. If MongoDB is not running or `rs0` is not initialized, fix that before starting the store. Do not delete or reset your existing MongoDB data.

## 2. Configure and start the backend

In terminal 1:

```powershell
cd Backend
Copy-Item .env.example .env
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
notepad .env
```

Replace `JWT_SECRET` in `Backend/.env` with the generated value. Keep the local connection string as `mongodb://127.0.0.1:27017/mean-l2?replicaSet=rs0` if that matches your local MongoDB setup. Do not share or commit `.env`.

Then run:

```powershell
npm ci
npm run check
npm run seed:catalog
npm run dev
```

Wait for the backend to report a successful MongoDB connection and that it is listening on port `3000`. The seed is designed to add missing demo products and upgrade its own existing seed products with variants; it does not perform a database reset.

Check the API from another PowerShell terminal:

```powershell
(Invoke-RestMethod 'http://localhost:3000/api/v1/product?page=1&pageSize=8').data.Count
```

A positive count means the API is returning products.

## 3. Start the Angular frontend

Open terminal 2 at the extracted repository root:

```powershell
cd Frontend
npm ci
npm start
```

Wait until Angular reports that the development server is ready, then open **http://localhost:4200** in your browser. The Angular development proxy forwards `/api` and `/socket.io` to the backend on port `3000`.

## 4. First manual test

Open the shop and check that products and images load. Then test product details and size/colour selection, create an account, log in, add a product to the cart, and exercise the COD checkout. The admin refund workflow requires an admin account and a manual refund confirmation reference. Public registration deliberately creates customer accounts only; see `SECURITY-AND-RUNBOOK.md` for local admin setup.

To stop the local processes, press `Ctrl+C` in both terminals. Do not delete the MongoDB database to stop the app.

## 5. If you prefer Docker later

The optional Docker Compose path is documented in `README.md`. It opens at `http://localhost:8080`, but it requires Docker Desktop and functioning WSL 2/virtualization. It is not required for the local development path above.

## 6. Verification status

The archive's structure checks, backend syntax/import checks, and dependency-free focused tests passed during packaging. The full backend integration suite, Angular compiler/build, Angular tests, fresh dependency audit, and real-browser workflows have **not** been certified in this environment. Run `FINAL-RELEASE-VERIFICATION.md` for the remaining validation steps. A blocked test is not a pass.
