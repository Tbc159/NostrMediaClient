#!/usr/bin/env bash
#
# Gestione del client in sviluppo: start, stop, restart, status, log.
#
# Si occupa da solo delle due cose che altrimenti vanno ricordate a mano:
#   1. Node e pnpm vivono sotto nvm e non sono nel PATH di una shell nuova
#      (la shell di sistema ha ancora Node 18, che non basta a Vite 8).
#   2. Il file .env sta nella radice del monorepo, non in apps/web, quindi
#      Nuxt va istruito con --dotenv o non lo legge.
#
# Uso:
#   ./scripts/client.sh start     [porta]   avvia in background
#   ./scripts/client.sh fg        [porta]   avvia in primo piano (Ctrl-C per uscire)
#   ./scripts/client.sh stop                ferma
#   ./scripts/client.sh restart   [porta]   riavvia (per rileggere .env)
#   ./scripts/client.sh status              stato e configurazione servita
#   ./scripts/client.sh logs                segue il log in tempo reale
#   ./scripts/client.sh check               verifica gli endpoint di .env
#
# La porta si puo' dare anche con la variabile PORT. Default: 3000.

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
    err "pnpm non trovato. Installa nvm e Node 22, poi: corepack enable"
    exit 1
  fi

  local maggiore
  maggiore="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "$maggiore" -lt 20 ]; then
    err "Node $(node -v) troppo vecchio: Vite 8 richiede >= 20.19. Attesa la 22."
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

avvia() {
  carica_toolchain
  mkdir -p "$RUNDIR"

  if pid_vivo; then
    local p; p="$(porta_registrata)"
    avv "gia' in esecuzione (PID $(cat "$PIDFILE"), porta $p)"
    nota "usa 'restart' per riavviarlo, 'stop' per fermarlo"
    return 0
  fi

  if risponde "$PORTA"; then
    err "la porta $PORTA e' gia' occupata da un altro processo"
    nota "liberala con: fuser -k -n tcp $PORTA    oppure usa un'altra porta"
    return 1
  fi

  if [ ! -f "$RADICE/.env" ]; then
    avv "manca .env: lo creo da .env.example"
    cp "$RADICE/.env.example" "$RADICE/.env"
  fi

  printf "avvio sulla porta %s…\n" "$PORTA"

  # setsid stacca il processo in un gruppo suo e </dev/null gli toglie lo
  # stdin del terminale: senza queste due cose il comando non restituisce il
  # controllo alla shell, perche' il figlio ne tiene aperti i descrittori.
  # Il gruppo separato serve anche a 'stop', che termina l'intero albero.
  local lanciatore="nohup"
  command -v setsid >/dev/null 2>&1 && lanciatore="setsid"

  ( cd "$APP" && $lanciatore npx nuxt dev --port "$PORTA" --dotenv ../../.env \
      < /dev/null > "$LOGFILE" 2>&1 & echo $! > "$PIDFILE" )
  echo "$PORTA" > "$PORTFILE"

  for _ in $(seq 1 90); do
    risponde "$PORTA" && break
    if ! pid_vivo; then
      err "il processo e' morto durante l'avvio. Ultime righe del log:"
      tail -20 "$LOGFILE"
      rm -f "$PIDFILE" "$PORTFILE"
      return 1
    fi
    sleep 1
  done

  if risponde "$PORTA"; then
    ok "attivo su http://localhost:$PORTA"
    nota "diagnostica endpoint: http://localhost:$PORTA/diagnostica"
    nota "log: ./scripts/client.sh logs"
  else
    err "avviato ma non risponde entro 90s. Log:"
    tail -20 "$LOGFILE"
    return 1
  fi
}

primo_piano() {
  carica_toolchain
  if [ ! -f "$RADICE/.env" ]; then cp "$RADICE/.env.example" "$RADICE/.env"; fi
  nota "primo piano sulla porta $PORTA — Ctrl-C per uscire"
  cd "$APP" && exec npx nuxt dev --port "$PORTA" --dotenv ../../.env
}

ferma() {
  local fermato=0

  if pid_vivo; then
    local pid; pid="$(cat "$PIDFILE")"
    # Il processo npx genera figli: si termina l'intero gruppo, altrimenti
    # nuxt resta vivo e continua a tenere occupata la porta.
    kill -TERM -"$(ps -o pgid= "$pid" | tr -d ' ')" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
    for _ in $(seq 1 10); do pid_vivo || break; sleep 0.5; done
    pid_vivo && kill -9 "$pid" 2>/dev/null
    fermato=1
  fi

  # Rete di sicurezza: qualunque cosa tenga ancora la porta va chiusa,
  # anche se il PID file si e' perso (riavvio della macchina, kill manuale).
  local p; p="$(porta_registrata)"
  if risponde "$p"; then
    fuser -k -n tcp "$p" >/dev/null 2>&1 && fermato=1
    sleep 1
  fi

  rm -f "$PIDFILE" "$PORTFILE"
  [ "$fermato" = 1 ] && ok "fermato" || nota "non era in esecuzione"
}

stato() {
  local p; p="$(porta_registrata)"

  if pid_vivo && risponde "$p"; then
    ok "in esecuzione — PID $(cat "$PIDFILE"), http://localhost:$p"
  elif pid_vivo; then
    avv "processo vivo (PID $(cat "$PIDFILE")) ma non risponde sulla porta $p"
  elif risponde "$p"; then
    avv "qualcosa risponde sulla porta $p ma non e' stato avviato da questo script"
  else
    nota "non in esecuzione"
  fi

  echo
  printf "${b}Configurazione in .env${z}\n"
  if [ -f "$RADICE/.env" ]; then
    grep -E '^NUXT_PUBLIC' "$RADICE/.env" | while IFS='=' read -r chiave valore; do
      printf "  %-38s %s\n" "${chiave#NUXT_PUBLIC_}" "$(echo "$valore" | tr -d '"')"
    done
  else
    err "manca .env (copialo da .env.example)"
  fi

  echo
  nota "il server legge .env solo all'avvio: dopo una modifica serve 'restart'"
}

# --- dispatch --------------------------------------------------------------

case "${1:-status}" in
  start)   avvia ;;
  fg)      primo_piano ;;
  stop)    ferma ;;
  restart) ferma; echo; avvia ;;
  status)  stato ;;
  logs)    [ -f "$LOGFILE" ] && tail -f "$LOGFILE" || err "nessun log: il server non e' mai stato avviato" ;;
  check)   carica_toolchain; cd "$RADICE" && pnpm check:endpoints ;;
  *)
    sed -n '3,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 1 ;;
esac
