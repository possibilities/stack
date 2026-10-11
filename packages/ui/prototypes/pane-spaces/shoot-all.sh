#!/bin/sh
# PROTOTYPE — re-capture every screenshot referenced by DESIGN.md (needs serve.mjs running).
set -eu
cd "$(dirname "$0")"
for s in hud inbox signal fleet workers roles accounts browse content brain scrape proc source system lab; do ./shoot.sh a-$s "variant=A&space=$s" >/dev/null; done
for pair in hud:3 inbox:3 signal:3 fleet:3 workers:2 roles:3 accounts:2 browse:3 content:3 brain:3 scrape:2 proc:3 source:3 system:3 lab:2; do
  s=${pair%:*}; n=${pair#*:}; i=1
  while [ "$i" -lt "$n" ]; do ./shoot.sh p-$s-$i "variant=A&space=$s&preset=$i" >/dev/null; i=$((i + 1)); done
done
for s in hud fleet system proc; do ./shoot.sh b-$s "variant=B&space=$s" >/dev/null; done
for s in hud fleet system source; do ./shoot.sh c-$s "variant=C&space=$s" >/dev/null; done
./shoot.sh a-overview "variant=A&space=hud&overlay=overview" >/dev/null
./shoot.sh a-drawer "variant=A&space=hud&drawer=inspect&pin=1" >/dev/null
./shoot.sh a-palette "variant=A&space=fleet&overlay=palette" >/dev/null
./shoot.sh a-help "variant=A&space=fleet&overlay=help" >/dev/null
./shoot.sh a-fleet-zoom "variant=A&space=fleet&zoom=chat" >/dev/null
./shoot.sh a-remote "variant=A&space=hud&remote=view&drawer=reference" >/dev/null
./shoot.sh a-hud-dark "variant=A&space=hud&theme=dark" >/dev/null
./shoot.sh a-fleet-dark "variant=A&space=fleet&theme=dark" >/dev/null
./shoot.sh a-source-dark "variant=A&space=source&theme=dark" >/dev/null
./shoot.sh b-proc-leader "variant=B&space=proc&leader=1&panenums=1" >/dev/null
echo "captured $(ls shots | wc -l | tr -d ' ') files"
