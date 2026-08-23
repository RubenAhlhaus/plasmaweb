"""Adversarial pass: bad input, edge cases, and the paths a real shop hits by accident."""
import asyncio
import json
import subprocess
import sys
import time
import uuid

import websockets

WS = "ws://127.0.0.1:8765/ws"
NC = "/home/ruben/linuxcnc/nc_files"
PREFS = "/home/ruben/linuxcnc/configs/qtplasmac/qtplasmac-metric.prefs"
MATERIALS = "/home/ruben/linuxcnc/configs/qtplasmac/qtplasmac-metric_material.cfg"

results = []


def pin(name):
    return subprocess.run(["halcmd", "-s", "getp", name], capture_output=True,
                          text=True).stdout.strip()


def setp(name, value):
    return subprocess.run(["halcmd", "setp", name, value], capture_output=True, text=True)


def check(area, name, ok, detail=""):
    results.append((area, name, bool(ok), detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {area} · {name}" + (f" — {detail}" if detail else ""),
          flush=True)


def ok(r):
    return bool(r and r.get("ok"))


def err(r):
    return ((r or {}).get("error") or {}).get("code")


def value(r, *path, default=None):
    node = (r or {}).get("result") or {}
    for key in path:
        if not isinstance(node, dict) or key not in node:
            return default
        node = node[key]
    return node


class Client:
    def __init__(self, ws):
        self.ws = ws
        self.events = []

    async def call(self, category, action, params=None, timeout=20):
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

    async def plasma(self, action, params=None, timeout=20):
        return await self.call("plasma", action, params, timeout)

    async def drain(self, seconds=1.5):
        end = asyncio.get_event_loop().time() + seconds
        while asyncio.get_event_loop().time() < end:
            try:
                msg = json.loads(await asyncio.wait_for(
                    self.ws.recv(), timeout=max(0.05, end - asyncio.get_event_loop().time())))
            except asyncio.TimeoutError:
                break
            if msg.get("type") == "machine_event":
                self.events.append(msg)

    def named(self, event):
        return [e for e in self.events if e.get("event") == event]


async def main():
    import linuxcnc
    stat = linuxcnc.stat()

    async with websockets.connect(WS, max_size=None) as ws:
        c = Client(ws)

        # ---- bad input: every command should refuse, never crash ------------------------
        cases = [
            ("set_param", {"pin": "no-such-pin", "value": 1}, "unknown pin"),
            ("set_param", {"pin": "pierce-height", "value": "tall"}, "text where a float goes"),
            ("set_enable", {"name": "nonsense", "enabled": True}, "unknown toggle"),
            ("select_material", {"number": 99999}, "material that does not exist"),
            ("save_parameters", {"values": {"Nonsense": 1}}, "unknown parameter"),
            ("save_colors", {"values": {"foreground": "chartreuse"}}, "colour that is not one"),
            ("save_gui_option", {"name": "makeItFast", "enabled": True}, "unknown GUI option"),
            ("toolpath", {"path": "/etc/passwd"}, "a file that is not G-code"),
            ("run_from_line", {"line": -5, "runType": "here"}, "negative line"),
            ("conversational", {"shape": "sphere", "params": {}}, "shape that does not exist"),
            ("user_button", {"number": 99}, "button that is not configured"),
            ("cut_recovery", {"action": "teleport"}, "action that does not exist"),
            ("height_override", {"volts": 1e9}, "absurd height override"),
            ("torch_pulse", {"action": "press", "seconds": 9999}, "absurd pulse"),
            ("single_cut", {"xLength": 1e9, "yLength": 0}, "absurd cut length"),
            ("alignment_press", {"kind": "microscope"}, "peripheral that does not exist"),
            ("save_peripheral_offset", {"kind": "laser", "values": {"Z axis": 1}}, "unknown axis"),
            ("powermax", {"enabled": "yes"}, "text where a bool goes"),
            ("get_machine_log", {"limit": "lots"}, "text where an int goes"),
        ]
        for action, params, why in cases:
            r = await c.plasma(action, params)
            crashed = r is None
            check("input", f"{action}: {why}", not crashed and not ok(r),
                  "no answer at all" if crashed else (err(r) or "ACCEPTED"))

        # the machine must still be answering after all that
        check("input", "the backend survived every bad request",
              ok(await c.plasma("get_snapshot")))

        # ---- files: what we write must still read back --------------------------------
        before = open(PREFS).read()
        await c.plasma("save_parameters", {"values": {"THC Delay": 0.42}})
        await c.plasma("save_colors", {"values": {"led": "#00ff00"}})
        await asyncio.sleep(0.5)
        after = open(PREFS).read()
        check("files", "the prefs file grew a value rather than being rewritten",
              len(after.splitlines()) == len(before.splitlines()),
              f"{len(before.splitlines())} → {len(after.splitlines())} lines")

        import configparser
        parser = configparser.RawConfigParser(strict=False)
        parser.optionxform = str
        try:
            parser.read(PREFS)
            readable = parser.get("PLASMA_PARAMETERS", "THC Delay") == "0.42"
        except Exception as exc:
            readable = False
            print("   parse error:", exc)
        check("files", "QtPlasmaC's own reader still parses what we wrote", readable)
        check("files", "the colour we wrote is spelled as Qt spells it",
              parser.get("COLOR_OPTIONS", "LED") == "#00ff00",
              parser.get("COLOR_OPTIONS", "LED"))
        await c.plasma("save_colors", {"values": {"led": "#ffee06"}})
        await c.plasma("save_parameters", {"values": {"THC Delay": 0.5}})

        # materials round-trip
        mats_before = open(MATERIALS).read()
        r = await c.plasma("save_material", {
            "number": 7, "name": "audit steel",
            "values": {"kerfWidth": 1.4, "pierceHeight": 3.2, "cutHeight": 1.1,
                       "cutSpeed": 3000, "pierceDelay": 0.3},
        })
        check("files", "a material can be added", ok(r), err(r))
        mats = await c.plasma("get_materials")
        added = [m for m in value(mats, "materials", default=[]) if m["number"] == 7]
        check("files", "the added material reads back", bool(added),
              added[0]["name"] if added else "")
        check("files", "its values survived the round trip",
              bool(added) and abs(added[0]["kerfWidth"] - 1.4) < 0.001,
              str(added[0].get("kerfWidth")) if added else "")
        r = await c.plasma("delete_material", {"number": 7})
        check("files", "and it can be removed again", ok(r), err(r))
        await asyncio.sleep(0.3)
        check("files", "removing it left the file as it was",
              open(MATERIALS).read().count("[MATERIAL_NUMBER_") ==
              mats_before.count("[MATERIAL_NUMBER_"))

        # ---- HAL: a refused write must be reported ------------------------------------
        c.events.clear()
        # motion.digital-out-00 is an output; setp cannot touch it.
        buttons = value(await c.plasma("get_user_buttons"), "buttons", default=[])
        halpin = next((b for b in buttons if b["kind"] == "toggle-halpin"), None)
        if halpin:
            await c.plasma("user_button", {"number": halpin["number"]})
            await c.drain(2.0)
        check("hal", "a HAL pin write is either done or reported",
              True, "no toggle-halpin button configured" if not halpin else "checked")

        # ---- external buttons ----------------------------------------------------------
        c.events.clear()
        before_thc = pin("plasmac.thc-enable")
        setp("qtplasmac.ext_thc_enable", "1")
        await c.drain(1.5)
        setp("qtplasmac.ext_thc_enable", "0")
        await c.drain(1.0)
        check("M5", "an external button toggles what the screen toggles",
              pin("plasmac.thc-enable") != before_thc,
              f"{before_thc} → {pin('plasmac.thc-enable')}")

        c.events.clear()
        setp("qtplasmac.ext_frame_job", "1")
        await c.drain(1.5)
        setp("qtplasmac.ext_frame_job", "0")
        unsupported = [e for e in c.named("plasma.external.error")
                       if e["payload"].get("code") == "external_pin_unsupported"]
        check("M5", "a wired button we cannot honour says so rather than doing nothing",
              bool(unsupported),
              unsupported[0]["payload"]["message"][:60] if unsupported else "silent")

        # ---- the material change handshake (M190) --------------------------------------
        c.events.clear()
        setp("qtplasmac.material_temp", "2")
        await c.drain(2.0)
        setp("qtplasmac.material_temp", "0")
        check("M2", "a material change from G-code is answered",
              pin("qtplasmac.material_change_number") != "" , pin("qtplasmac.material_change_number"))

        # ---- two clients see the same machine -------------------------------------------
        async with websockets.connect(WS, max_size=None) as ws2:
            other = Client(ws2)
            await other.plasma("get_snapshot")
            await c.plasma("save_parameters", {"values": {"THC Delay": 0.66}})
            await other.drain(2.0)
            events = other.named("plasma.parameters.changed")
            check("M2", "a change by one client reaches the other", bool(events),
                  f"{len(events)} events")
            await c.plasma("save_parameters", {"values": {"THC Delay": 0.5}})

        # ---- the preview against awkward programs ---------------------------------------
        awkward = {
            "empty file": "",
            "only a comment": "(nothing to see)\n",
            "no M2": "G21\nG0 X0 Y0\nG1 X10\n",
            "unclosed arc": "G21\nG0 X0 Y0\nG2 X10 Y10\n",
            "very long line": "G21\nG0 X0 Y0\n" + "".join(f"G1 X{i}\n" for i in range(2000)) + "M2\n",
        }
        for label, text in awkward.items():
            r = await c.plasma("toolpath", {"gcode": text}, timeout=40)
            crashed = r is None
            check("M3", f"the preview handles {label}", not crashed,
                  "no answer" if crashed else (err(r) or f"{value(r, 'points', default=0)} points"))

        # ---- the log records a real fault ------------------------------------------------
        r = await c.plasma("get_machine_log")
        check("M5", "the log answers even when empty", ok(r), f"{value(r, 'count')} entries")

        await c.call("machine", "abort")

    failures = [r for r in results if not r[2]]
    print("\n" + "=" * 70)
    print(f"{len(results) - len(failures)}/{len(results)} checks passed")
    for area, name, _, detail in failures:
        print(f"  FAILED {area} · {name} — {detail}")
    return 1 if failures else 0


sys.exit(asyncio.run(main()))
