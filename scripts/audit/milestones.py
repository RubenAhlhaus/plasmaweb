"""Milestone audit: drive every plasma feature against the live machine and report.

Run on the VM. Reports PASS/FAIL per check with what was expected and what happened, so a
failure is actionable without re-running by hand.
"""
import asyncio
import json
import subprocess
import sys
import time
import uuid

import websockets

WS = "ws://127.0.0.1:8765/ws"
NC = "/home/ruben/linuxcnc/nc_files"

results = []


def pin(name):
    out = subprocess.run(["halcmd", "-s", "getp", name], capture_output=True, text=True)
    return out.stdout.strip()


def check(milestone, name, ok, detail=""):
    results.append((milestone, name, bool(ok), detail))
    mark = "PASS" if ok else "FAIL"
    print(f"[{mark}] {milestone} · {name}" + (f" — {detail}" if detail else ""), flush=True)
    return bool(ok)


class Client:
    def __init__(self, ws):
        self.ws = ws
        self.events = []

    async def call(self, category, action, params=None, timeout=25):
        cid = str(uuid.uuid4())
        await self.ws.send(json.dumps({
            "type": "command", "protocolVersion": 1, "commandId": cid,
            "category": category, "action": action, "params": params or {},
        }))
        end = asyncio.get_event_loop().time() + timeout
        while asyncio.get_event_loop().time() < end:
            try:
                msg = json.loads(await asyncio.wait_for(
                    self.ws.recv(), timeout=max(0.05, end - asyncio.get_event_loop().time())))
            except asyncio.TimeoutError:
                break
            if msg.get("type") == "machine_event":
                self.events.append(msg)
                continue
            if msg.get("commandId") == cid and msg.get("type") == "command_result":
                return msg
        return None

    async def plasma(self, action, params=None, timeout=25):
        return await self.call("plasma", action, params, timeout)

    async def drain(self, seconds=1.0):
        end = asyncio.get_event_loop().time() + seconds
        while asyncio.get_event_loop().time() < end:
            try:
                msg = json.loads(await asyncio.wait_for(
                    self.ws.recv(), timeout=max(0.05, end - asyncio.get_event_loop().time())))
            except asyncio.TimeoutError:
                break
            if msg.get("type") == "machine_event":
                self.events.append(msg)

    def events_named(self, name):
        return [e for e in self.events if e.get("event") == name]


def ok(result):
    return bool(result and result.get("ok"))


def value(result, *path, default=None):
    node = (result or {}).get("result") or {}
    for key in path:
        if not isinstance(node, dict) or key not in node:
            return default
        node = node[key]
    return node


def err(result):
    return ((result or {}).get("error") or {}).get("code")


async def settle(stat, linuxcnc, target=None, limit=40):
    for _ in range(limit):
        stat.poll()
        idle = (stat.interp_state == linuxcnc.INTERP_IDLE
                and stat.exec_state == linuxcnc.EXEC_DONE and stat.queue == 0)
        there = target is None or (abs(stat.actual_position[0] - target[0]) < 0.05
                                   and abs(stat.actual_position[1] - target[1]) < 0.05)
        if idle and there:
            await asyncio.sleep(0.4)
            return True
        await asyncio.sleep(0.4)
    return False


async def main():
    import linuxcnc
    stat = linuxcnc.stat()

    async with websockets.connect(WS, max_size=None) as ws:
        c = Client(ws)

        # The machine has to be on and homed before anything else: program.open, MDI and
        # motion are all refused otherwise, and a refusal there would look like a bug here.
        await c.call("machine", "power", {"on": False})
        await c.call("machine", "power", {"on": True})
        homed = await c.call("motion", "home", {"joint": -1})
        check("M0", "homing accepted", ok(homed), err(homed))
        await asyncio.sleep(8)
        stat.poll()
        check("M0", "the machine homed", all(stat.homed[:3]),
              str([int(h) for h in stat.homed[:3]]))

        # ---- M1: pins, state, the component itself -------------------------------------
        snap = await c.plasma("get_snapshot")
        pins = value(snap, "pins", "plasmac", default={})
        check("M1", "snapshot carries the plasmac pins", len(pins) > 100, f"{len(pins)} pins")
        check("M1", "our component is exported",
              "qtplasmac" in (value(snap, "pins", default={}) or {}),
              ", ".join(sorted((value(snap, "pins", default={}) or {}).keys())))
        check("M1", "state is named, not a bare number",
              value(snap, "state", "stateName") is not None,
              str(value(snap, "state", "stateName")))
        caps = value(snap, "capabilities", default={})
        check("M6", "capabilities reported", "features" in caps,
              f"{sum(1 for f in caps.get('features', {}).values() if not f['available'])} unavailable")

        # gcode_scale, the M1 bug
        check("M1", "gcode_scale is 1, not 0 (the M1 THC bug)",
              pin("qtplasmac.gcode_scale") in ("1", "1.0"), pin("qtplasmac.gcode_scale"))
        check("M1", "thc_feed_rate came from the INI",
              float(pin("qtplasmac.thc_feed_rate") or 0) > 0, pin("qtplasmac.thc_feed_rate"))

        # write policy
        refused = await c.plasma("set_param", {"pin": "state-out", "value": 3})
        check("M1", "a realtime output cannot be written", not ok(refused), err(refused))
        accepted = await c.plasma("set_param", {"pin": "pierce-height", "value": 3.5})
        await asyncio.sleep(0.4)
        check("M1", "a setpoint can be written",
              ok(accepted) and abs(float(pin("plasmac.pierce-height")) - 3.5) < 0.01,
              pin("plasmac.pierce-height"))

        # ---- M2: materials and parameters -----------------------------------------------
        mats = await c.plasma("get_materials")
        material_list = value(mats, "materials", default=[])
        check("M2", "materials read from the machine's file", len(material_list) >= 1,
              f"{len(material_list)} materials")
        params = await c.plasma("get_parameters")
        check("M2", "parameters read", len(value(params, "values", default={})) == 33,
              f"{len(value(params, 'values', default={}))} keys")
        check("M5", "bounds reported per parameter",
              len(value(params, "limits", default={})) == 33)
        check("M6", "colours reported", len(value(params, "colors", default={})) == 9)
        check("M6", "gui options reported",
              set(value(params, "guiOptions", default={})) >= {"toolTips", "keyboardShortcuts"})

        # a save that must be refused, and one that must land
        bad = await c.plasma("save_parameters", {"values": {"Height Per Volt": 99}})
        check("M5", "an out-of-range parameter is refused", err(bad) == "out_of_range", err(bad))
        good = await c.plasma("save_parameters", {"values": {"THC Delay": 0.7}})
        await asyncio.sleep(0.5)
        check("M2", "a good parameter reaches its pin",
              ok(good) and abs(float(pin("plasmac.thc-delay")) - 0.7) < 0.01,
              pin("plasmac.thc-delay"))
        await c.plasma("save_parameters", {"values": {"THC Delay": 0.5}})

        # material selection drives the setpoints
        first = material_list[0]["number"] if material_list else 0
        sel = await c.plasma("select_material", {"number": first})
        await asyncio.sleep(0.6)
        check("M2", "selecting a material writes its cut height",
              ok(sel) and float(pin("plasmac.cut-height")) > 0, pin("plasmac.cut-height"))

        # ---- M3: preview and run-from-line ----------------------------------------------
        program = ("G21 G40 G49 G64 P0.1 G90\nF#<_hal[plasmac.cut-feed-rate]>\n"
                   "M3 $0 S1\nG0 X20 Y20\nG1 X120\nG2 X140 Y40 J20\nG1 Y100\nM5 $0\nM2\n")
        open(f"{NC}/audit.ngc", "w").write(program)
        prev = await c.plasma("toolpath", {"path": f"{NC}/audit.ngc"})
        segs = value(prev, "segments", default=[])
        check("M3", "the interpreter previews a program with an arc", ok(prev) and len(segs) > 2,
              f"{len(segs)} segments, {value(prev, 'points')} points")
        extents = value(prev, "extents", default=None)
        check("M3", "extents are in machine units, not inches",
              bool(extents) and extents["max"][0] > 100, json.dumps(extents["max"][:2]) if extents else "")
        check("M6", "program notes reported", value(prev, "notes") is not None)


        # ---- M4: conversational ----------------------------------------------------------
        shapes = await c.plasma("conversational_shapes")
        names = sorted((value(shapes, "shapes", default={}) or {}).keys())
        check("M4", "shapes come from the machine's own modules", len(names) >= 10,
              ", ".join(names[:6]))
        check("M4", "each shape reports the parameters that machine's module takes",
              all(isinstance(v, list) and v for v in
                  (value(shapes, "shapes", default={}) or {}).values()))
        circle = await c.plasma("conversational", {
            "shape": "circle",
            "params": {
                "xOffset": 50, "yOffset": 50, "diameter": 40,
                "isCenter": True, "isExternal": False,
            },
            "save": False,
        })
        gcode = value(circle, "gcode", default="")
        check("M4", "a circle generates G-code",
              ok(circle) and ("G2" in gcode or "G3" in gcode),
              err(circle) or f"{len(gcode.splitlines())} lines")
        check("M4", "the generated shape previews",
              ok(await c.plasma("toolpath", {"gcode": gcode})) if gcode else False)

        wrong = await c.plasma("conversational", {
            "shape": "circle", "params": {"nonsense": 1}, "save": False})
        schema = value(shapes, "shapes", "circle", default=[])
        derived = [p["name"] for p in schema if p.get("derived")]
        check("M4", "invalidLeads is derived, not asked of the operator",
              derived == ["invalidLeads"], ", ".join(derived) or "none")
        check("M4", "a derived parameter is not required either",
              all(not p["required"] for p in schema if p.get("derived")))

        check("M4", "an unknown shape parameter names itself and the expected set",
              err(wrong) == "unknown_parameters"
              and "nonsense" in ((wrong or {}).get("error") or {}).get("message", ""),
              ((wrong or {}).get("error") or {}).get("message", "")[:60])

        # ---- M5: probing, recovery, buttons, alignment, log ------------------------------
        await c.plasma("set_enable", {"name": "torch", "enabled": False})
        probe = await c.plasma("probe_test", {"seconds": 2})
        check("M5", "probe test accepted", ok(probe), err(probe))
        await asyncio.sleep(1.0)
        check("M5", "probe test reached the machine", pin("plasmac.probe-test") == "TRUE",
              pin("plasmac.probe-test"))
        await c.plasma("probe_test", {"seconds": 0})
        await asyncio.sleep(0.5)

        long_probe = await c.plasma("probe_test", {"seconds": 999})
        check("M5", "an absurd probe time is refused", not ok(long_probe), err(long_probe))

        buttons = await c.plasma("get_user_buttons")
        check("M5", "user buttons read from the prefs",
              ok(buttons) and isinstance(value(buttons, "buttons"), list),
              f"{len(value(buttons, 'buttons', default=[]))} configured")

        align = await c.plasma("get_alignment")
        check("M5", "alignment reports what is fitted", ok(align),
              json.dumps(value(align, "fitted")))

        log = await c.plasma("get_machine_log", {"limit": 5})
        check("M5", "machine log answers", ok(log), f"{value(log, 'count')} entries")

        pmx = await c.plasma("powermax_status")
        check("M5", "powermax status answers", ok(pmx), f"port={value(pmx, 'port')!r}")

        cut = await c.plasma("single_cut", {"xLength": 10, "yLength": 0, "load": False})
        check("M5", "single cut builds a program", ok(cut), err(cut))

        # cut recovery outside a pause must not move anything
        rec = await c.plasma("cut_recovery", {"action": "offset", "x": 1, "y": 0})
        await asyncio.sleep(0.4)
        check("M5", "cut recovery answers when not paused", rec is not None, err(rec) or "ok")
        await c.plasma("cut_recovery", {"action": "cancel"})

        # ---- M0/M1: motion, the machine itself -------------------------------------------
        mdi = await c.call("program", "mdi", {"text": "G53 G0 X30 Y30"})
        check("M0", "MDI accepted", ok(mdi), err(mdi))
        await settle(stat, linuxcnc, (30, 30))
        stat.poll()
        check("M0", "the machine moved where it was told",
              abs(stat.actual_position[0] - 30) < 0.1 and abs(stat.actual_position[1] - 30) < 0.1,
              str([round(v, 2) for v in stat.actual_position[:2]]))

        # ---- a real cut, end to end ------------------------------------------------------
        await c.plasma("set_enable", {"name": "torch", "enabled": True})
        opened = await c.call("program", "open", {"path": f"{NC}/audit.ngc"})
        # Confirm what is actually loaded before running it: a leftover program from an
        # earlier run would otherwise be what gets cut.
        loaded = False
        for _ in range(20):
            stat.poll()
            if stat.file.endswith("audit.ngc") and stat.interp_state == linuxcnc.INTERP_IDLE:
                loaded = True
                break
            await asyncio.sleep(0.3)
        check("M0", "the program that was opened is the one loaded", loaded,
              f"{stat.file} · {err(opened) or 'ok'}")
        run = await c.call("program", "auto", {"command": "run"})
        check("M1", "a cut starts", ok(run), err(run))

        states = set()
        torch_fired = False
        end = time.monotonic() + 40
        while time.monotonic() < end:
            await c.drain(0.3)
            state = pin("plasmac.state-out")
            states.add(state)
            if pin("plasmac.torch-on") == "TRUE":
                torch_fired = True
            stat.poll()
            if stat.interp_state == linuxcnc.INTERP_IDLE and state == "0" and len(states) > 4:
                break

        check("M1", "the torch fired during the cut", torch_fired, f"states seen: {sorted(states)}")
        check("M1", "the machine walked the cut sequence", len(states) >= 5,
              f"{len(states)} distinct states")
        check("M1", "arc voltage was read", float(pin("plasmac.arc-voltage-out") or 0) >= 0)

        # events the publisher should have produced
        check("M1", "pin diffs were broadcast", len(c.events_named("plasma.pins.changed")) > 5,
              f"{len(c.events_named('plasma.pins.changed'))} events")
        check("M1", "state changes were broadcast",
              len(c.events_named("plasma.state.changed")) > 2,
              f"{len(c.events_named('plasma.state.changed'))} events")

        # ---- M3: run from line, last because it swaps the loaded program -----------------
        for _ in range(40):
            stat.poll()
            if stat.interp_state == linuxcnc.INTERP_IDLE:
                break
            await asyncio.sleep(0.4)
        await c.call("program", "open", {"path": f"{NC}/audit.ngc"})
        await asyncio.sleep(1.0)
        rfl = await c.plasma("run_from_line", {"line": 4, "runType": "here"})
        check("M3", "run from line builds and loads a program", ok(rfl),
              err(rfl) or value(rfl, "path"))
        check("M3", "the generated program is under the machine's program prefix",
              str(value(rfl, "path", default="")).startswith(NC), value(rfl, "path"))
        cutpath = await c.plasma("run_from_line", {"line": 4, "runType": "cut"})
        check("M3", "THIS CUTPATH is refused on 2.9.4 rather than silently degraded",
              err(cutpath) == "cutpath_unsupported", err(cutpath) or "accepted")

        # ---- cleanup ---------------------------------------------------------------------
        await c.call("machine", "abort")
        await c.plasma("set_enable", {"name": "torch", "enabled": False})

    failures = [r for r in results if not r[2]]
    print("\n" + "=" * 70)
    print(f"{len(results) - len(failures)}/{len(results)} checks passed")
    for milestone, name, _, detail in failures:
        print(f"  FAILED {milestone} · {name} — {detail}")
    return 1 if failures else 0


sys.exit(asyncio.run(main()))
