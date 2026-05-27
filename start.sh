#!/bin/bash
# Start backend and frontend dev servers
# Backend: http://localhost:8000
# Frontend: http://localhost:8082

cd "$(dirname "$0")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

check_port() {
    if lsof -i :"$1" &>/dev/null; then
        echo -e "${RED}Error: port $1 is already in use${NC}"
        return 1
    fi
}

wait_for_backend() {
    local max_attempts=30
    local attempt=1
    echo -n "Waiting for backend to be ready"
    while [ $attempt -le $max_attempts ]; do
        if curl -sf http://localhost:8000/docs &>/dev/null; then
            echo -e "\n${GREEN}Backend ready${NC}"
            return 0
        fi
        echo -n "."
        sleep 1
        attempt=$((attempt + 1))
    done
    echo -e "\n${YELLOW}Backend did not respond after ${max_attempts}s${NC}"
    return 1
}

start_backend() {
    check_port 8000 || return 1
    (cd backend && uvicorn main:app --reload --port 8000 2>&1 | sed "s/^/[$(date '+%H:%M:%S')] /") &
    BACKEND_PID=$!
    echo -e "${GREEN}[backend]${NC} PID: $BACKEND_PID  (http://localhost:8000)"
}

start_frontend() {
    check_port 8082 || return 1
    (cd frontend && npm run dev 2>&1 | sed "s/^/[$(date '+%H:%M:%S')] /") &
    FRONTEND_PID=$!
    echo -e "${GREEN}[frontend]${NC} PID: $FRONTEND_PID  (http://localhost:8082)"
}

echo "Starting servers..."
echo ""

start_backend
BACKEND_STARTED=$?

start_frontend
FRONTEND_STARTED=$?

if [ $BACKEND_STARTED -ne 0 ] || [ $FRONTEND_STARTED -ne 0 ]; then
    echo ""
    echo -e "${RED}Failed to start servers${NC}"
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    exit 1
fi

if ! wait_for_backend; then
    echo -e "${YELLOW}Continuing anyway...${NC}"
fi

echo ""
echo "Press Ctrl+C to stop both servers"

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM
wait
