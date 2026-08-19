# Linux test VM — running the sim without SSH

The plasma work is verified against `sim/qtplasmac` on a Debian 13 arm64 UTM VM
(`LinuxCNC`, user `ruben`, LinuxCNC `1:2.9.4-2+deb13u1`, XFCE on `:0`).

## Reaching the VM

`sshd` runs inside the VM on `0.0.0.0:22` and the VM answers on `192.168.64.2`, but
**host → guest IP traffic is blocked on this Mac**: macOS grants Local Network access per
app, and the terminal's host app (Cursor) does not have it. Symptom: `ping`/`nc` to
`192.168.64.2` fail from the host while the guest can reach `192.168.64.1` fine. Enable
*System Settings → Privacy & Security → Local Network* for the terminal app to get `ssh`,
`scp` and browser access to the guest.

Until then use the **UTM guest agent**, which needs no network at all:

```bash
UTM=/Applications/UTM.app/Contents/MacOS/utmctl

# run a script (as root, output via a file — see note below)
printf 'halcmd show pin plasmac\n' | "$UTM" exec LinuxCNC --hide --input --cmd /bin/bash

# copy files (stdin → guest, guest → stdout)
"$UTM" file push LinuxCNC /tmp/payload.tgz < payload.tgz
"$UTM" file pull LinuxCNC /tmp/verify.out
```

Guest-agent quirks worth knowing:

- `--cmd` takes **one** program path with no arguments. Repeating `--cmd` passes the flag
  itself to the program. Pipe the script into `/bin/bash` with `--input` instead; `/bin/sh`
  (dash) rejects the argv the agent builds.
- The call returns only when the program exits, and long or slow commands come back empty.
  Anything that takes more than a few seconds must be detached in the guest
  (`nohup setsid … > /tmp/x.out 2>&1 &`) and its output pulled with `file pull` afterwards.
- Python output must be unbuffered (`python3 -u`), otherwise a killed process loses it.
- `file push`/`pull` are binary-safe (verified by `sha256sum` on both sides), so a tarball
  is the practical way to deploy the repo.

## Deploying and running the sim

```bash
# host: build, pack, push
npm run build
tar czf payload.tgz --exclude node_modules --exclude venv --exclude __pycache__ \
    backend bin dist resources
"$UTM" file push LinuxCNC /tmp/payload.tgz < payload.tgz
```

In the guest (once):

```bash
apt-get install -y curl imagemagick xdotool python3-venv
install -d -o ruben -g ruben /home/ruben/plasma-web-interface
tar xzf /tmp/payload.tgz -C /home/ruben/plasma-web-interface
python3 -m venv --system-site-packages /home/ruben/plasma-web-interface/venv
/home/ruben/plasma-web-interface/venv/bin/pip install fastapi "uvicorn[standard]" pydantic
ln -sf /home/ruben/plasma-web-interface/bin/plasmacweb /usr/local/bin/plasmacweb

# the UI reads /lcncgui-config.json from the served root; install.sh normally does this
cp /home/ruben/plasma-web-interface/resources/lcncgui-config.production.json \
   /home/ruben/plasma-web-interface/dist/lcncgui-config.json

# sim config: the sample configs ship with the linuxcnc doc package
cp -r /usr/share/doc/linuxcnc/examples/sample-configs/sim/qtplasmac \
      /home/ruben/linuxcnc/configs/qtplasmac
cd /home/ruben/linuxcnc/configs/qtplasmac
sed 's|^DISPLAY  *= .*|DISPLAY                 = plasmacweb|' \
    qtplasmac_s_metric.ini > plasmacweb_metric.ini
```

`--system-site-packages` matters: `hal` and `linuxcnc` are Debian packages, so the venv has
to see them. The screen formats are `qtplasmac_l_*` (16:9), `qtplasmac_p_*` (9:16) and
`qtplasmac_s_*` (4:3) — there is no plain `qtplasmac_metric.ini`.

Start it as the desktop user:

```bash
sudo -u ruben -H DISPLAY=:0 XAUTHORITY=/home/ruben/.Xauthority \
     XDG_RUNTIME_DIR=/run/user/1000 nohup setsid \
     bash -c 'cd /home/ruben/linuxcnc/configs/qtplasmac && linuxcnc plasmacweb_metric.ini' \
     > /tmp/lcnc.log 2>&1 &
```

`bin/lcncgui` then serves the UI on `127.0.0.1:8765` and opens `firefox-esr -kiosk` on the
VM desktop. Startup failures land in `/tmp/linuxcnc.debug.*` (a `wish` error window also
appears on the VM display and blocks the run until dismissed). Without
`dist/lcncgui-config.json` the page renders *"Configuration not found (HTTP 404)"* instead
of the UI.

Screenshots of the guest desktop, useful as evidence when the host cannot reach the VM:

```bash
"$UTM" exec LinuxCNC --hide --input --cmd /bin/bash <<'EOS'
DISPLAY=:0 XAUTHORITY=/home/ruben/.Xauthority import -window root /tmp/screen.png
EOS
"$UTM" file pull LinuxCNC /tmp/screen.png > screen.png
```

## Sim estop

The sim's estop chain is `estop_or.out → estop_not → iocontrol.0.emc-enable-in`, and
`estop_or.in0` is driven by the **`qtplasmac_sim` panel**
(`/usr/share/qtvcp/panels/qtplasmac_sim/qtplasmac_sim_handler.py`), which starts with estop
engaged. Until that panel's estop button is released — or `halcmd setp estop_or.in0 0` is
run — `machine.set_task_state`/`machine.power` legitimately fail with
`estop_reset_rejected`. That is sim behaviour, not a backend bug.

## Driving the backend from inside the guest

There is no HTTP route for motion; commands go over the WebSocket. A verification script
connects to `ws://127.0.0.1:8765/ws` and sends command envelopes:

```python
{"type": "command", "protocolVersion": 1, "commandId": "<uuid>",
 "category": "motion", "action": "home", "params": {"joint": -1}}
```

`motion.jog` takes `{jointMode, index, velocity, mode, distance}` — **`distance` must be
positive and the sign of `velocity` sets the direction**; a negative distance is rejected
with `invalid_params`.
