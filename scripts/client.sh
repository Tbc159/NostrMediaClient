#!/usr/bin/env bash
#
# Managing the client in development: start, stop, restart, status, logs.
#
# It takes care by itself of the two things that otherwise have to be
# remembered by hand:
#   1. Node and pnpm live under nvm and are not in a new shell's PATH
#      (the system shell still has Node 18, which is not enough for Vite 8).
#   2. The .env file sits in the monorepo's root, not in apps/web, so Nuxt has
#      to be told with --dotenv or it does not read it.
#
# Usage:
#   ./scripts/client.sh start     [port]    starts in the background
#   ./scripts/client.sh fg        [port]    starts in the foreground (Ctrl-C to leave)
#   ./scripts/client.sh stop                stops it
#   ./scripts/client.sh restart   [port]    restarts it (to re-read .env)
#   ./scripts/client.sh status              the status and the configuration served
#   ./scripts/client.sh logs                follows the log in real time
#   ./scripts/client.sh check               checks the endpoints in .env
#
# The port can also be given with the PORT variable. The default: 3000.

set -uo pipefail

RADICE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$RADICE/apps/web"
RUNDIR="$RADICE/.run"
PIDFILE="$RUNDIR/dev-server.pid"
PORTFILE="$RUNDIR/dev-server.port"
LOGFILE="$RUNDIR/dev-server.log"

PORTA="${2:-${PORT:-3000}}"

v="\033[0;32m"; r="\033[0;31m"; g="\033[0;33m"; d="\033[2m"; b="\033[1m"; z="\033[0m"
ok()   { printf "${v}✓${z} %s\n" "$1"; }
err()  { printf "${r}✗${z} %s\n" "$1"; }
avv()  { printf "${g}▲${z} %s\n" "$1"; }
nota() { printf "${d}·${z} %s\n" "$1"; }

# --- toolchain -------------------------------------------------------------

carica_toolchain() {
  if [ -s "$HOME/.nvm/nvm.sh" ]; then
    export NVM_DIR="$HOME/.nvm"
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
    nvm use 22 >/dev/null 2>&1
    hash -r 2>/dev/null || true
  fi

  if ! command -v pnpm >/dev/null 2>&1; then
    err "pnpm not found. Install nvm and Node 22, then: corepack enable"
    exit 1
  fi

  local maggiore
  maggiore="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "$maggiore" -lt 20 ]; then
    err "Node $(node -v) is too old: Vite 8 requires >= 20.19. Expecting 22."
    exit 1
  fi
}

# --- stato -----------------------------------------------------------------

pid_vivo() {
  [ -f "$PIDFILE" ] || return 1
  local pid; pid="$(cat "$PIDFILE" 2>/dev/null)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

porta_registrata() {
  cat "$PORTFILE" 2>/dev/null || echo "$PORTA"
}

risponde() {
  curl -sf -o /dev/null -m 3 "http://localhost:$1/" 2>/dev/null
}

# --- comandi ---------------------------------------------------------------

# The monorepo's packages are imported from their `dist`, which is not in git:
# after a change of branch or a pull it is the old one, and Vite fails to
# import an export that does not exist yet. The symptom is a blank page **with
# no errors in the server's log**, because the error happens in the browser: an
# hour wasted the first time, never again from the second.
compila_pacchetti() {
  nota "building the monorepo's packages…"
  if ( cd "$RADICE" && pnpm build:packages > "$RUNDIR/build-packages.log" 2>&1 ); then
    ok "packages up to date"
  else
    err "building the packages failed. The last lines:"
    tail -20 "$RUNDIR/build-packages.log"
    return 1
  fi
}

avvia() {
  carica_toolchain
  mkdir -p "$RUNDIR"

  if pid_vivo; then
    local p; p="$(porta_registrata)"
    avv "already running (PID $(cat "$PIDFILE"), port $p)"
    nota "use 'restart' to restart it, 'stop' to stop it"
    return 0
  fi

  if risponde "$PORTA"; then
    err "port $PORTA is already taken by another process"
    nota "free it with: fuser -k -n tcp $PORTA    or use another port"
    return 1
  fi

  if [ ! -f "$RADICE/.env" ]; then
    avv ".env is missing: creating it from .env.example"
    cp "$RADICE/.env.example" "$RADICE/.env"
  fi

  compila_pacchetti || return 1

  printf "starting on port %s…\n" "$PORTA"

  # setsid detaches the process into a group of its own and </dev/null takes
  # the terminal's stdin away from it: without those two things the command
  # does not give control back to the shell, because the child keeps its
  # descriptors open. The separate group also serves 'stop', which terminates
  # the whole tree.
  local lanciatore="nohup"
  command -v setsid >/dev/null 2>&1 && lanciatore="setsid"

  ( cd "$APP" && $lanciatore npx nuxt dev --port "$PORTA" --dotenv ../../.env \
      < /dev/null > "$LOGFILE" 2>&1 & echo $! > "$PIDFILE" )
  echo "$PORTA" > "$PORTFILE"

  for _ in $(seq 1 90); do
    risponde "$PORTA" && break
    if ! pid_vivo; then
      err "the process died during start-up. The last lines of the log:"
      tail -20 "$LOGFILE"
      rm -f "$PIDFILE" "$PORTFILE"
      return 1
    fi
    sleep 1
  done

  if risponde "$PORTA"; then
    ok "up on http://localhost:$PORTA"
    nota "endpoint diagnostics: http://localhost:$PORTA/diagnostica"
    nota "logs: ./scripts/client.sh logs"
  else
    err "started but not answering within 90s. The log:"
    tail -20 "$LOGFILE"
    return 1
  fi
}

primo_piano() {
  carica_toolchain
  mkdir -p "$RUNDIR"
  if [ ! -f "$RADICE/.env" ]; then cp "$RADICE/.env.example" "$RADICE/.env"; fi
  compila_pacchetti || return 1
  nota "foreground on port $PORTA — Ctrl-C to leave"
  cd "$APP" && exec npx nuxt dev --port "$PORTA" --dotenv ../../.env
}

ferma() {
  local fermato=0

  if pid_vivo; then
    local pid; pid="$(cat "$PIDFILE")"
    # The npx process spawns children: the whole group is terminated,
    # otherwise nuxt stays alive and goes on holding the port.
    kill -TERM -"$(ps -o pgid= "$pid" | tr -d ' ')" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
    for _ in $(seq 1 10); do pid_vivo || break; sleep 0.5; done
    pid_vivo && kill -9 "$pid" 2>/dev/null
    fermato=1
  fi

  # A safety net: whatever is still holding the port has to be closed, even
  # when the PID file has been lost (a reboot, a manual kill).
  local p; p="$(porta_registrata)"
  if risponde "$p"; then
    fuser -k -n tcp "$p" >/dev/null 2>&1 && fermato=1
    sleep 1
  fi

  rm -f "$PIDFILE" "$PORTFILE"
  [ "$fermato" = 1 ] && ok "stopped" || nota "it was not running"
}

stato() {
  local p; p="$(porta_registrata)"

  if pid_vivo && risponde "$p"; then
    ok "running — PID $(cat "$PIDFILE"), http://localhost:$p"
  elif pid_vivo; then
    avv "the process is alive (PID $(cat "$PIDFILE")) but not answering on port $p"
  elif risponde "$p"; then
    avv "something answers on port $p but it was not started by this script"
  else
    nota "not running"
  fi

  echo
  printf "${b}The configuration in .env${z}\n"
  if [ -f "$RADICE/.env" ]; then
    grep -E '^NUXT_PUBLIC' "$RADICE/.env" | while IFS='=' read -r chiave valore; do
      printf "  %-38s %s\n" "${chiave#NUXT_PUBLIC_}" "$(echo "$valore" | tr -d '"')"
    done
  else
    err ".env is missing (copy it from .env.example)"
  fi

  echo
  nota "the server reads .env at start-up only: after a change it needs 'restart'"
}

# --- dispatch --------------------------------------------------------------

case "${1:-status}" in
  start)   avvia ;;
  fg)      primo_piano ;;
  stop)    ferma ;;
  restart) ferma; echo; avvia ;;
  status)  stato ;;
  logs)    [ -f "$LOGFILE" ] && tail -f "$LOGFILE" || err "no log: the server has never been started" ;;
  check)   carica_toolchain; cd "$RADICE" && pnpm check:endpoints ;;
  *)
    sed -n '3,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 1 ;;
esac
