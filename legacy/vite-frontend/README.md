# Legacy Vite frontend (not built)

An earlier React + Vite + React Router implementation of the farmer UI,
preserved here for reference. It is **not** part of the build.

Why it was set aside:
- It targets Vite; the project's frontend is Next.js 14 (App Router).
- It imports `axios` and `react-router-dom`, which are not dependencies.
- It predates the current API contract (ObjectId ids, `{ success, data }`
  envelope, the unified `/api/dashboard/:farmId` endpoint).

The active frontend lives in `frontend/src/app` and `frontend/src/components`.
Useful ideas carried over: the crop-suggestions screen is tracked as future scope.
