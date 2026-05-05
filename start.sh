#!/bin/bash
# Start backend and frontend dev servers

cd "$(dirname "$0")"

# Backend
(cd backend && uvicorn main:app --reload --port 8000) &
BACKEND_PID=$!

# Frontend
(cd frontend && npm run dev) &
FRONTEND_PID=$!

echo "Backend PID: $BACKEND_PID  (http://localhost:8000)"
echo "Frontend PID: $FRONTEND_PID  (http://localhost:5173)"
echo ""
echo "Press Ctrl+C to stop both servers"

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM
wait
