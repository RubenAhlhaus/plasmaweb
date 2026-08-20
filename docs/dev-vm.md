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

**Update (2026-08-20): the permission is granted, so ssh works.** A dedicated key lives at
`~/.ssh/linuxcnc_vm` (authorized for `ruben` on the VM), and the backend binds
`127.0.0.1:8765` inside the guest by design, so reach it through a tunnel rather than
changing the machine's config:

```bash
ssh -i ~/.ssh/linuxcnc_vm ruben@192.168.64.2                      # shell, halcmd, logs
ssh -i ~/.ssh/linuxcnc_vm -N -L 8765:127.0.0.1:8765 ruben@192.168.64.2 &   # UI on the host
```

With that tunnel up, the Playwright MCP drives the real UI headlessly at kiosk size
(1280x800) against the running machine.

The **UTM guest agent** below still works and needs no network at all — useful when the
VM's desktop session is locked or the network is down:

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

## Making the sim actually cut

The plasma parameters plasmac needs live in QtPlasmaC's prefs file, which the web UI does not
write yet (M2). On a fresh HAL session they are all zero, and zero is not benign: with
`arc-max-starts` at 0 plasmac pauses the program with *"no arc detected after 0 start
attempts"* the moment it tries to fire, and with `pid-p-gain` at 0 the THC computes no
correction, so the torch height never moves and the up/down LEDs never light. Set them once
per session, before running a program:

```bash
halcmd setp estop_or.in0 0        # release the sim panel's estop
for kv in "cut-feed-rate 4000" "cut-height 1.0" "pierce-height 3.0" "pierce-delay 0.1" \
          "arc-ok-high 250" "arc-ok-low 60" "arc-fail-delay 3" "arc-max-starts 3" \
          "arc-voltage-scale 1" "arc-voltage-offset 0" "cut-volts 100" "mode 0" \
          "thc-enable 1" "thc-delay 0.5" "thc-threshold 1" "height-per-volt 0.1" \
          "pid-p-gain 10" "pid-i-gain 0" "pid-d-gain 0" \
          "probe-feed-rate 300" "probe-start-height 25" "float-switch-travel 1.5" \
          "safe-height 10" "setup-feed-rate 3000" "skip-ihs-distance 0" \
          "kerf-width 1.5" "cornerlock-threshold 90" "voidlock-slope 500"; do
    halcmd setp plasmac.$kv
done
```

`cut-volts 100` matches what `sim-torch` produces, so the THC hovers instead of driving the
torch to the top limit (at `cut-volts 122` it runs out of travel and plasmac pauses the
program with *"top limit reached while THC moving up"* — correct behaviour, wrong parameter).

`nc_files/metric_line.ngc` is the cut to run: `G0 X10 Y10`, `M3 $0 S1`, `G1 X590`, `M5 $0`.
Load it from the UI's PROGRAM screen, switch to the plasma screen, turn TORCH ENABLE on and
press CYCLE START. Watch it from the host with the tunnel up, or from HAL:

```bash
watch -n0.2 'halcmd -s show pin plasmac.state-out plasmac.torch-on plasmac.thc-active \
    plasmac.target-volts plasmac.arc-voltage-in'
```

Restarting the backend means restarting LinuxCNC (the backend *is* the DISPLAY). `halrun -U`
then `pkill -x linuxcncsvr` clears the session; a restart that overlaps the old one hangs on
*"Waiting for other session to finish exiting…lockfile still not removed"* and gives up, so
check nothing is left running before starting again. `pkill -f <pattern>` over ssh is a trap
here: the pattern matches the `bash -c` line running it, so the shell kills itself before the
rest of the command runs — match on something narrower (`pkill -x linuxcncsvr`).
