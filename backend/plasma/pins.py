"""HAL pin tables for the plasma layer — GENERATED, do not edit by hand.

Regenerate with ``scripts/gen_plasma_pins.py`` after bumping the reference tree.

Sources (reference/linuxcnc @ v2.9.10-5116-g0bb86dd667):
  * src/hal/components/plasmac.comp                    194 pins
  * lib/hallib/*.hal + configs/sim/qtplasmac/*          32 HAL-netted pins
  * share/qtvcp/screens/qtplasmac/qtplasmac_handler.py 91 own-component pins

The write policy is the safety boundary from BUILD_PLAN.md expressed as data:

  SETPOINT      plasmac in-pin the GUI owns (a parameter or a one-shot request) — writable
  HAL_DRIVEN    plasmac in-pin wired in HAL (motion, halui, debounce, hardware) — read-only
  DEPRECATED    plasmac in-pin upstream marks dead — read-only
  REALTIME_OUT  plasmac out-pin produced by the realtime component — read-only
  EXTERNAL_IN   pin on our own ``qtplasmac`` component driven from outside — read-only
  OWNED_ACK     input on our own component that the GUI answers with (material change
                handshake, cut type) — writable
  OWNED_OUT     pin on our own ``qtplasmac`` component — we drive it

Only SETPOINT, OWNED_ACK and OWNED_OUT are writable. ``is_writable`` is the single check the
HAL bridge makes; nothing else may bypass it.

Pin sets differ between LinuxCNC releases (2.9.4 ships 127 plasmac in-pins, the 2.10
reference 144), so callers must treat a missing pin as absent rather than fatal — see
``missing_pins``.
"""

from __future__ import annotations

from typing import Dict, Iterable, List, NamedTuple, Tuple

#: Component name of the realtime plasma controller.
PLASMAC_COMPONENT = "plasmac"
#: Component name we export ourselves — same name QtPlasmaC uses, so existing
#: ``*_connections.hal`` files and external control panels keep working.
QTPLASMAC_COMPONENT = "qtplasmac"

SETPOINT = "setpoint"
HAL_DRIVEN = "hal_driven"
REALTIME_OUT = "realtime_out"
DEPRECATED = "deprecated"
EXTERNAL_IN = "external_in"
OWNED_ACK = "owned_ack"
OWNED_OUT = "owned_out"

WRITABLE_POLICIES = frozenset({SETPOINT, OWNED_ACK, OWNED_OUT})


class PlasmaPin(NamedTuple):
    """One HAL pin. ``name`` carries no component prefix; use :func:`hal_name`."""

    name: str
    type: str
    direction: str
    policy: str
    doc: str = ""


#: ``plasmac.*`` — 103 setpoints, 41 HAL-driven/deprecated,
#: 50 realtime outputs.
PLASMAC_PINS: Tuple[PlasmaPin, ...] = (
    PlasmaPin("adaptive-feed", "float", "out", REALTIME_OUT, "for reverse-run, connect to motion.adaptive-feed"),
    PlasmaPin("arc-fail-delay", "float", "in", SETPOINT, "arc start failure timeout (seconds)"),
    PlasmaPin("arc-lost-delay", "float", "in", SETPOINT, "arc lost delay during a cut (seconds)"),
    PlasmaPin("arc-max-starts", "s32", "in", SETPOINT, "maximum attempts at starting the arc"),
    PlasmaPin("arc-ok-high", "float", "in", SETPOINT, "maximum voltage level for Arc OK signal [mode 0] (volts)"),
    PlasmaPin("arc-ok-in", "bit", "in", HAL_DRIVEN, "external arc ok input signal [mode 1 & mode 2]"),
    PlasmaPin("arc-ok-low", "float", "in", SETPOINT, "minimum voltage level for Arc OK signal [mode 0] (volts)"),
    PlasmaPin("arc-ok-out", "bit", "out", REALTIME_OUT, "arc ok output"),
    PlasmaPin("arc-voltage-in", "float", "in", HAL_DRIVEN, "arc voltage input [mode 0 & mode 1] see Notes above"),
    PlasmaPin("arc-voltage-offset", "float", "in", SETPOINT, "offset to set arc voltage to 0 at 0 volts"),
    PlasmaPin("arc-voltage-out", "float", "out", REALTIME_OUT, "arc voltage output [mode 0 & mode 1]"),
    PlasmaPin("arc-voltage-scale", "float", "in", SETPOINT, "scale to convert arc_voltage input to actual volts"),
    PlasmaPin("axis-x-max-limit", "float", "in", HAL_DRIVEN, "axis x maximum limit, connect to ini.x.max-limit"),
    PlasmaPin("axis-x-min-limit", "float", "in", HAL_DRIVEN, "axis x minimum limit, connect to ini.x.min-limit"),
    PlasmaPin("axis-x-position", "float", "in", HAL_DRIVEN, "current x axis position, connect to axis.x.pos-cmd"),
    PlasmaPin("axis-y-max-limit", "float", "in", HAL_DRIVEN, "axis y maximum limit, connect to ini.y.max-limit"),
    PlasmaPin("axis-y-min-limit", "float", "in", HAL_DRIVEN, "axis y minimum limit, connect to ini.y.min-limit"),
    PlasmaPin("axis-y-position", "float", "in", HAL_DRIVEN, "current y axis position, connect to axis.y.pos-cmd"),
    PlasmaPin("axis-z-max-limit", "float", "in", HAL_DRIVEN, "axis z maximum limit, connect to ini.z.max-limit"),
    PlasmaPin("axis-z-min-limit", "float", "in", HAL_DRIVEN, "axis z minimum limit, connect to ini.z.min-limit"),
    PlasmaPin("axis-z-position", "float", "in", HAL_DRIVEN, "current z axis position, connect to joint.N.pos-fb"),
    PlasmaPin("breakaway", "bit", "in", HAL_DRIVEN, "torch breakaway switch (optional, see float_switch)"),
    PlasmaPin("consumable-change", "bit", "in", SETPOINT, "change consumables in torch"),
    PlasmaPin("consumable-changing", "bit", "out", REALTIME_OUT, "consumables are being changed"),
    PlasmaPin("cornerlock-enable", "bit", "in", SETPOINT, "enable corner lock"),
    PlasmaPin("cornerlock-is-locked", "bit", "out", REALTIME_OUT, "corner locked indicator"),
    PlasmaPin("cornerlock-threshold", "float", "in", SETPOINT, "corner lock threshold (% of requested feed rate), speeds below this disable THC"),
    PlasmaPin("creep-speed", "float", "in", SETPOINT, "ramp creep or intermediate speed. Comes after gouge and is before cut speed. In machine units/min."),
    PlasmaPin("creep-speed-distance", "float", "in", SETPOINT, "distance creep will run in machine units. Gouge plus creep distance should not be longer than any lead in."),
    PlasmaPin("current-feed-rate", "float", "out", REALTIME_OUT, "current feed rate per minute (for auto-thc)"),
    PlasmaPin("current-velocity", "float", "in", HAL_DRIVEN, "current machine velocity, connect to motion.current-vel"),
    PlasmaPin("cut-feed-rate", "float", "in", SETPOINT, "cut feed rate from current material (machine units per minute)"),
    PlasmaPin("cut-height", "float", "in", SETPOINT, "cut height (machine units)"),
    PlasmaPin("cut-height-delay", "float", "in", SETPOINT, "at the end of transition to end-pierce-height how long to pause before transition to cut height."),
    PlasmaPin("cut-length", "float", "out", REALTIME_OUT, "length of current cut job"),
    PlasmaPin("cut-recovering", "bit", "out", REALTIME_OUT, "recovering from cut error"),
    PlasmaPin("cut-recovery", "bit", "in", SETPOINT, "recover from cut error"),
    PlasmaPin("cut-time", "float", "out", REALTIME_OUT, "cut time of current job"),
    PlasmaPin("cut-volts", "float", "in", SETPOINT, "cut voltage (volts)"),
    PlasmaPin("cutting-start", "bit", "in", HAL_DRIVEN, "start a new cut, connect to spindle.0.on"),
    PlasmaPin("cutting-stop", "bit", "out", REALTIME_OUT, "stop manual cut, connect to halui.spindle.0.stop"),
    PlasmaPin("debug-print", "bit", "in", SETPOINT, "if true will print state changes as a debug aid"),
    PlasmaPin("dry-run", "bit", "in", SETPOINT, "perform a dry run without probing"),
    PlasmaPin("external-estop", "bit", "in", HAL_DRIVEN, "external E-stop input"),
    PlasmaPin("feed-hold", "bit", "out", REALTIME_OUT, "feed hold, connect to motion.feed-hold"),
    PlasmaPin("feed-override", "float", "in", HAL_DRIVEN, "feed override value from GUI (connect to halui.feed-override.value)"),
    PlasmaPin("feed-reduction", "float", "in", HAL_DRIVEN, "reduce adaptive feed to this percentage (connect to motion.analog-out-03)"),
    PlasmaPin("feed-upm", "float", "in", HAL_DRIVEN, "requested feed_rate, connect to motion.feed-upm to use as the default (G-code units per minute)"),
    PlasmaPin("float-switch", "bit", "in", HAL_DRIVEN, "float switch input (can also act as breakaway if it actuates when torch breaks away)"),
    PlasmaPin("float-switch-travel", "float", "in", SETPOINT, "float switch travel (machine units)"),
    PlasmaPin("gcode-scale", "float", "in", SETPOINT, "current G-code scale"),
    PlasmaPin("gouge-speed", "float", "in", SETPOINT, "ramp starting speed for gouge. In machine units/min."),
    PlasmaPin("gouge-speed-distance", "float", "in", SETPOINT, "distance gouge will run in machine units. Gouge plus creep distance should not be longer than any lead in."),
    PlasmaPin("height-override", "float", "in", SETPOINT, "height override adjustment (volts)"),
    PlasmaPin("height-per-volt", "float", "in", SETPOINT, "torch height change per volt (machine units)"),
    PlasmaPin("homed", "bit", "in", HAL_DRIVEN, "machine is homed"),
    PlasmaPin("ignore-arc-ok-0", "bit", "in", HAL_DRIVEN, "Do not require arc ok for start or cutting."),
    PlasmaPin("ignore-arc-ok-1", "bit", "in", SETPOINT, "Do not require arc ok for start or cutting."),
    PlasmaPin("jog-inhibit", "bit", "out", REALTIME_OUT, "jog inhibit, connect to motion.jog-inhibit"),
    PlasmaPin("kerf-width", "float", "in", SETPOINT, "placeholder for better G-code portability between GUIs"),
    PlasmaPin("laser-mode", "bit", "in", SETPOINT, "laser mode for fiber lasers"),
    PlasmaPin("laser-recovery-start", "s32", "in", SETPOINT, "start laser offset for cut recovery"),
    PlasmaPin("laser-recovery-state", "s32", "out", REALTIME_OUT, "laser recovery status"),
    PlasmaPin("laser-x-offset", "s32", "in", SETPOINT, "alignment laser x axis offset (scaled units)"),
    PlasmaPin("laser-y-offset", "s32", "in", SETPOINT, "alignment laser y axis offset (scaled units)"),
    PlasmaPin("led-down", "bit", "out", REALTIME_OUT, "thc move down indicator"),
    PlasmaPin("led-up", "bit", "out", REALTIME_OUT, "thc move up indicator"),
    PlasmaPin("low-cut-volts", "s32", "in", SETPOINT, "low cut voltage threshold while thc active"),
    PlasmaPin("lowpass-frequency", "float", "in", SETPOINT, "lowpass cutoff frequency for arc voltage output"),
    PlasmaPin("machine-is-on", "bit", "in", HAL_DRIVEN, "machine is on signal, connect to halui.machine.is-on"),
    PlasmaPin("material-thickness", "float", "in", SETPOINT, "material thickness (machine units)"),
    PlasmaPin("max-offset", "s32", "in", SETPOINT, "maximum height offset (mm)"),
    PlasmaPin("mesh-arc-ok", "bit", "in", SETPOINT, "Do not require arc ok for mesh mode."),
    PlasmaPin("mesh-enable", "bit", "in", SETPOINT, "enable mesh cutting mode"),
    PlasmaPin("mode", "s32", "in", SETPOINT, "operating mode"),
    PlasmaPin("motion-type", "s32", "in", HAL_DRIVEN, "motion type, connect to motion.motion-type"),
    PlasmaPin("move-down", "bit", "in", HAL_DRIVEN, "external thc down switch [mode 2]"),
    PlasmaPin("move-up", "bit", "in", HAL_DRIVEN, "external thc up switch [mode 2]"),
    PlasmaPin("multi-tool", "bit", "in", SETPOINT, "allows the use of multiple tools"),
    PlasmaPin("offset-feed-rate", "float", "in", SETPOINT, "probe offset velocity (machine units per minute)"),
    PlasmaPin("offset-probe-delay", "float", "in", SETPOINT, "wait for probe to deploy (seconds)"),
    PlasmaPin("offset-probe-x", "float", "in", SETPOINT, "X axis offset for offset probe (machine units)"),
    PlasmaPin("offset-probe-y", "float", "in", SETPOINT, "Y axis offset for offset probe (machine units)"),
    PlasmaPin("offset-scale", "float", "out", REALTIME_OUT, "offset scale, connect to axis.<x y z>.eoffset-scale"),
    PlasmaPin("offset-set-probe", "bit", "in", SETPOINT, "deploy probe for setting offsets"),
    PlasmaPin("offset-set-scribe", "bit", "in", SETPOINT, "deploy scribe for setting offsets"),
    PlasmaPin("offsets-active", "bit", "in", HAL_DRIVEN, "offsets are active, connect to motion.eoffset-active"),
    PlasmaPin("offsets-limited", "bit", "in", HAL_DRIVEN, "offsets are limited, connect to motion.eoffset-limited"),
    PlasmaPin("ohmic-enable", "bit", "out", REALTIME_OUT, "on only while probing"),
    PlasmaPin("ohmic-max-attempts", "s32", "in", SETPOINT, "maximum ohmic probe attempts before fallback to float switch"),
    PlasmaPin("ohmic-probe", "bit", "in", HAL_DRIVEN, "ohmic probe input, from ohmic-sense-out or external component/pin"),
    PlasmaPin("ohmic-probe-enable", "bit", "in", SETPOINT, "enable ohmic probe"),
    PlasmaPin("ohmic-probe-offset", "float", "in", SETPOINT, "Z axis offset for ohmic probe (machine units)"),
    PlasmaPin("ohmic-sense-in", "bit", "in", HAL_DRIVEN, "ohmic sense relay input"),
    PlasmaPin("ohmic-sense-off-delay", "s32", "in", SETPOINT, "debounce cycles for ohmic sense off"),
    PlasmaPin("ohmic-sense-on-delay", "s32", "in", SETPOINT, "debounce cycles for ohmic sense on"),
    PlasmaPin("ohmic-sense-out", "bit", "out", REALTIME_OUT, "ohmic sense output state"),
    PlasmaPin("ohmic-test", "bit", "in", SETPOINT, "test for shorted torch"),
    PlasmaPin("ok-sample-counts", "s32", "in", SETPOINT, "arc_ok number of valid samples required [mode 0]"),
    PlasmaPin("ok-sample-threshold", "float", "in", SETPOINT, "arc_ok maximum arc voltage deviation allowed [mode 0]"),
    PlasmaPin("override-jog", "bit", "in", SETPOINT, "override jog inhibit"),
    PlasmaPin("pause-at-end", "float", "in", SETPOINT, "time to pause at end of cut"),
    PlasmaPin("paused-motion", "bit", "out", REALTIME_OUT, "paused motion flag, true when paused motion is active"),
    PlasmaPin("paused-motion-speed", "float", "in", SETPOINT, "multiplier for speed of motion when paused, from -1 to 1"),
    PlasmaPin("paused-time", "float", "out", REALTIME_OUT, "paused time during current job"),
    PlasmaPin("pid-d-gain", "float", "in", SETPOINT, "derivative gain input [mode 0 & mode 1]"),
    PlasmaPin("pid-i-gain", "float", "in", SETPOINT, "integral gain input [mode 0 & mode 1]"),
    PlasmaPin("pid-p-gain", "float", "in", SETPOINT, "proportional gain input [mode 0 & mode 1]"),
    PlasmaPin("pierce-count", "s32", "out", REALTIME_OUT, "number of pierce attempts (torch starts)"),
    PlasmaPin("pierce-delay", "float", "in", SETPOINT, "time required to pierce stock (seconds)"),
    PlasmaPin("pierce-end-height", "float", "in", SETPOINT, "height at end of piercing (in machine units). Can be different to Cut Height. Default 0 means not used. i.e. no change in height."),
    PlasmaPin("pierce-height", "float", "in", SETPOINT, "pierce height (machine units)"),
    PlasmaPin("pierce-motion-delay", "float", "in", SETPOINT, "delay starting motion during pierce delay period. This is a % of Pierce Delay. Only used when pierce-with-motion is True."),
    PlasmaPin("pierce-type", "s32", "in", SETPOINT, "allows motion to progress during pierce. 0=No movement, 1=Wiggle, 2=Ramp"),
    PlasmaPin("probe-feed-rate", "float", "in", SETPOINT, "probe down velocity (machine units per minute)"),
    PlasmaPin("probe-final-speed", "s32", "in", SETPOINT, "final probe speed (steps per servo period)"),
    PlasmaPin("probe-out", "bit", "out", REALTIME_OUT, "probe for tube cutting, connect to motion.probe-input"),
    PlasmaPin("probe-start-height", "float", "in", SETPOINT, "probe starting height"),
    PlasmaPin("probe-test", "bit", "in", SETPOINT, "probe test only"),
    PlasmaPin("probe-test-error", "bit", "out", REALTIME_OUT, "minimum limit reached while probe testing"),
    PlasmaPin("probe-time", "float", "out", REALTIME_OUT, "probe time of current job"),
    PlasmaPin("program-is-idle", "bit", "in", HAL_DRIVEN, "program is idle, connect to halui.program.is-idle"),
    PlasmaPin("program-is-paused", "bit", "in", HAL_DRIVEN, "program is paused, connect to halui.program.is-paused"),
    PlasmaPin("program-is-running", "bit", "in", HAL_DRIVEN, "program is running, connect to halui.program.is-running"),
    PlasmaPin("program-pause", "bit", "out", REALTIME_OUT, "pause the current program, connect to halui.program.pause"),
    PlasmaPin("program-resume", "bit", "out", REALTIME_OUT, "resume the currently paused program, connect to halui.program.resume"),
    PlasmaPin("program-run", "bit", "out", REALTIME_OUT, "run the currently loaded program, connect to halui.program.run"),
    PlasmaPin("program-stop", "bit", "out", REALTIME_OUT, "stop current program, connect to halui.program.stop"),
    PlasmaPin("puddle-jump-delay", "float", "in", SETPOINT, "Delay move from pierce height to cut height (seconds), leave disconnected if not required."),
    PlasmaPin("puddle-jump-height", "float", "in", SETPOINT, "Puddle jump height (percentage of pierce height), leave disconnected if not required."),
    PlasmaPin("rapid-time", "float", "out", REALTIME_OUT, "rapid motion time of current job"),
    PlasmaPin("requested-feed-rate", "float", "out", REALTIME_OUT, "requested feed rate (for auto-thc)"),
    PlasmaPin("requested-velocity", "float", "in", DEPRECATED, "deprecated"),
    PlasmaPin("resolution", "s32", "in", SETPOINT, "multiplier for resolution of the offset counts"),
    PlasmaPin("restart-delay", "float", "in", SETPOINT, "time from arc failure till next restart attempt"),
    PlasmaPin("run-time", "float", "out", REALTIME_OUT, "run time of current job"),
    PlasmaPin("safe-height", "float", "in", SETPOINT, "requested safe traverse height (machine units)"),
    PlasmaPin("safe-height-is-limited", "bit", "out", REALTIME_OUT, "safe height is limited indicator"),
    PlasmaPin("scribe-arm", "bit", "out", REALTIME_OUT, "arm the scribe"),
    PlasmaPin("scribe-arm-delay", "float", "in", SETPOINT, "delay from scribe arm to scribe on"),
    PlasmaPin("scribe-on", "bit", "out", REALTIME_OUT, "turn scribe on"),
    PlasmaPin("scribe-on-delay", "float", "in", SETPOINT, "delay from scribe on to motion beginning"),
    PlasmaPin("scribe-start", "bit", "in", HAL_DRIVEN, "start a new scribe, connect to spindle.1.on"),
    PlasmaPin("sensor-active", "bit", "out", REALTIME_OUT, "one of float, ohmic, or breakaway is detected"),
    PlasmaPin("setup-feed-rate", "float", "in", SETPOINT, "feed rate for moves to pierce and cut heights (machine units per minute)"),
    PlasmaPin("skip-ihs-distance", "float", "in", SETPOINT, "skip IHS if less than this distance from last cut"),
    PlasmaPin("slat-height", "float", "in", SETPOINT, "slat height (machine units)"),
    PlasmaPin("spotting-start", "bit", "in", HAL_DRIVEN, "start a new spot, connect to spindle.2.on"),
    PlasmaPin("spotting-threshold", "float", "in", SETPOINT, "threshold voltage to start spotting delay"),
    PlasmaPin("spotting-time", "float", "in", SETPOINT, "torch off delay after spotting threshold reached"),
    PlasmaPin("state-out", "s32", "out", REALTIME_OUT, "current state"),
    PlasmaPin("stop-type-out", "s32", "out", REALTIME_OUT, "current stop type"),
    PlasmaPin("target-samples", "s32", "in", SETPOINT, "number of samples for setting target_volts"),
    PlasmaPin("target-volts", "float", "out", REALTIME_OUT, "target voltage for thc, set by arc voltage at cut height"),
    PlasmaPin("thc-active", "bit", "out", REALTIME_OUT, "thc status output"),
    PlasmaPin("thc-auto", "bit", "in", SETPOINT, "enable automatic thc activation"),
    PlasmaPin("thc-delay", "float", "in", SETPOINT, "delay from cut feed rate reached to THC activate (seconds) [non auto THC]"),
    PlasmaPin("thc-disable", "bit", "in", HAL_DRIVEN, "thc disable"),
    PlasmaPin("thc-enable", "bit", "in", SETPOINT, "enable/disable thc and set the IHS skip type"),
    PlasmaPin("thc-enabled", "bit", "out", REALTIME_OUT, "thc is enabled"),
    PlasmaPin("thc-feed-rate", "float", "in", SETPOINT, "maximum feed rate for thc (machine units per minute)"),
    PlasmaPin("thc-sample-counts", "s32", "in", SETPOINT, "thc number of valid samples required [auto THC]"),
    PlasmaPin("thc-sample-threshold", "float", "in", SETPOINT, "thc maximum arc voltage deviation allowed [auto THC]"),
    PlasmaPin("thc-threshold", "float", "in", SETPOINT, "thc threshold (volts), changes below this have no effect"),
    PlasmaPin("torch-enable", "bit", "in", SETPOINT, "enable torch"),
    PlasmaPin("torch-off", "bit", "in", HAL_DRIVEN, "turn torch off"),
    PlasmaPin("torch-on", "bit", "out", REALTIME_OUT, "turn torch on, connect to your torch on input"),
    PlasmaPin("torch-pulse-abort", "bit", "in", SETPOINT, "torch pulse abort"),
    PlasmaPin("torch-pulse-hold", "bit", "in", SETPOINT, "torch pulse hold"),
    PlasmaPin("torch-pulse-start", "bit", "in", SETPOINT, "torch pulse start"),
    PlasmaPin("torch-pulse-time", "float", "in", SETPOINT, "torch pulse time (seconds)"),
    PlasmaPin("torch-time", "float", "out", REALTIME_OUT, "torch on time of current job"),
    PlasmaPin("tube-cut", "bit", "in", SETPOINT, "set the current job as tube cutting"),
    PlasmaPin("units-per-mm", "float", "in", HAL_DRIVEN, "for scale calcs, connect to halui.machine.units-per-mm"),
    PlasmaPin("use-auto-volts", "bit", "in", SETPOINT, "use calculated voltage for thc baseline"),
    PlasmaPin("voidlock-enable", "bit", "in", SETPOINT, "enable voidlock [mode 0 & mode 1]"),
    PlasmaPin("voidlock-is-locked", "bit", "out", REALTIME_OUT, "voidlock is locked indicator [mode 0 & mode 1]"),
    PlasmaPin("voidlock-off-cycles", "s32", "in", SETPOINT, "number of sampling cycles to deactivate voidlock"),
    PlasmaPin("voidlock-on-cycles", "s32", "in", SETPOINT, "number of sampling cycles to activate voidlock"),
    PlasmaPin("voidlock-slope", "s32", "in", SETPOINT, "voidlock slope in volts per second"),
    PlasmaPin("x-offset", "s32", "in", SETPOINT, "offset to apply to axis x for consumable change and cut recovery (scaled units)"),
    PlasmaPin("x-offset-counts", "s32", "out", REALTIME_OUT, "x offset for consumable change, connect to axis.x.eoffset-counts"),
    PlasmaPin("x-offset-current", "float", "in", HAL_DRIVEN, "current x axis offset, connect to axis.x.eoffset"),
    PlasmaPin("xy-feed-rate", "float", "in", SETPOINT, "feed-rate for consumable change"),
    PlasmaPin("xy-offset-enable", "bit", "out", REALTIME_OUT, "enable x and y offsets, connect to axis.<x & y>.eoffset-enable"),
    PlasmaPin("y-offset", "s32", "in", SETPOINT, "offset to apply to axis y for consumable change and cut recovery (scaled units)"),
    PlasmaPin("y-offset-counts", "s32", "out", REALTIME_OUT, "y offset for consumable change, connect to axis.y.eoffset-counts"),
    PlasmaPin("y-offset-current", "float", "in", HAL_DRIVEN, "current y axis offset, connect to axis.y.eoffset"),
    PlasmaPin("z-height", "float", "out", REALTIME_OUT, "current z axis height relative to the probed zero height"),
    PlasmaPin("z-offset-counts", "s32", "out", REALTIME_OUT, "z offset for height control, connect to axis.z.eoffset-counts"),
    PlasmaPin("z-offset-current", "float", "in", HAL_DRIVEN, "current z axis offset, connect to axis.z.eoffset"),
    PlasmaPin("z-offset-enable", "bit", "out", REALTIME_OUT, "enable z offsets, connect to axis.z.eoffset-enable"),
    PlasmaPin("z-relative", "float", "out", REALTIME_OUT, "distance of Z from last probed height"),
    PlasmaPin("zero-window", "float", "in", SETPOINT, "sets window that voltage fluctuations show as zero (-0.1 to 0.1 at default value)"),
)

#: ``qtplasmac.*`` — the userspace component QtPlasmaC exports and we must recreate,
#: with upstream's exact pin names (underscores) so existing HAL wiring keeps working.
QTPLASMAC_PINS: Tuple[PlasmaPin, ...] = (
    PlasmaPin("consumable_changing", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("conv_disable", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("cut_type", "s32", "in", OWNED_ACK, ""),
    PlasmaPin("development", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("ext_abort", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("ext_auto_volts_enable", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("ext_consumables", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("ext_cornerlock_enable", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("ext_cutrec_cancel", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("ext_cutrec_e", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("ext_cutrec_fwd", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("ext_cutrec_n", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("ext_cutrec_ne", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("ext_cutrec_nw", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("ext_cutrec_rev", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("ext_cutrec_s", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("ext_cutrec_se", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("ext_cutrec_sw", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("ext_cutrec_w", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("ext_frame_job", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("ext_height_ovr_count_enable", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("ext_height_ovr_counts", "s32", "in", EXTERNAL_IN, ""),
    PlasmaPin("ext_height_ovr_minus", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("ext_height_ovr_plus", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("ext_height_ovr_reset", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("ext_height_ovr_scale", "float", "in", EXTERNAL_IN, ""),
    PlasmaPin("ext_ignore_arc_ok", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("ext_jog_slow", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("ext_kerfcross_enable", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("ext_laser_toggle", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("ext_laser_touchoff", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("ext_mesh_mode", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("ext_ohmic", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("ext_ohmic_probe_enable", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("ext_out_0", "bit", "out", OWNED_OUT, ""),
    PlasmaPin("ext_out_1", "bit", "out", OWNED_OUT, ""),
    PlasmaPin("ext_out_2", "bit", "out", OWNED_OUT, ""),
    PlasmaPin("ext_pause", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("ext_pause_only", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("ext_power", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("ext_probe", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("ext_pulse", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("ext_resume", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("ext_run", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("ext_run_pause", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("ext_thc_enable", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("ext_torch_enable", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("ext_touchoff", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("ext_voidlock_enable", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("gcode_scale", "float", "out", OWNED_OUT, ""),
    PlasmaPin("height_override", "float", "out", OWNED_OUT, ""),
    PlasmaPin("jog_inhibited", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("laser_on", "bit", "out", OWNED_OUT, ""),
    PlasmaPin("laser_recovery_state", "s32", "in", EXTERNAL_IN, ""),
    PlasmaPin("material_change", "s32", "in", OWNED_ACK, ""),
    PlasmaPin("material_change_number", "s32", "in", OWNED_ACK, ""),
    PlasmaPin("material_change_timeout", "bit", "in", OWNED_ACK, ""),
    PlasmaPin("material_reload", "bit", "in", OWNED_ACK, ""),
    PlasmaPin("material_temp", "s32", "in", OWNED_ACK, ""),
    PlasmaPin("offset_set_probe", "bit", "out", OWNED_OUT, ""),
    PlasmaPin("offset_set_scribe", "bit", "out", OWNED_OUT, ""),
    PlasmaPin("offsets_active", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("ohmic_led_in", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("param_disable", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("plasmac_state", "s32", "in", EXTERNAL_IN, ""),
    PlasmaPin("plasmac_stop", "s32", "in", EXTERNAL_IN, ""),
    PlasmaPin("pmx485_arc_time", "float", "in", EXTERNAL_IN, ""),
    PlasmaPin("pmx485_current", "float", "in", EXTERNAL_IN, ""),
    PlasmaPin("pmx485_current_max", "float", "in", EXTERNAL_IN, ""),
    PlasmaPin("pmx485_current_min", "float", "in", EXTERNAL_IN, ""),
    PlasmaPin("pmx485_fault", "float", "in", EXTERNAL_IN, ""),
    PlasmaPin("pmx485_mode", "float", "in", EXTERNAL_IN, ""),
    PlasmaPin("pmx485_pressure", "float", "in", EXTERNAL_IN, ""),
    PlasmaPin("pmx485_pressure_max", "float", "in", EXTERNAL_IN, ""),
    PlasmaPin("pmx485_pressure_min", "float", "in", EXTERNAL_IN, ""),
    PlasmaPin("pmx485_status", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("probe_test_error", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("sensor_active", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("settings_disable", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("sim_style_update", "bit", "out", OWNED_OUT, ""),
    PlasmaPin("tabs_always_enabled", "bit", "in", EXTERNAL_IN, ""),
    PlasmaPin("thc_feed_rate", "float", "out", OWNED_OUT, ""),
    PlasmaPin("vel_reduct", "float", "in", EXTERNAL_IN, ""),
    PlasmaPin("x_max_pierce_extent", "float", "in", EXTERNAL_IN, ""),
    PlasmaPin("x_min_pierce_extent", "float", "in", EXTERNAL_IN, ""),
    PlasmaPin("x_offset", "float", "in", EXTERNAL_IN, ""),
    PlasmaPin("y_max_pierce_extent", "float", "in", EXTERNAL_IN, ""),
    PlasmaPin("y_min_pierce_extent", "float", "in", EXTERNAL_IN, ""),
    PlasmaPin("y_offset", "float", "in", EXTERNAL_IN, ""),
    PlasmaPin("z_height", "float", "in", EXTERNAL_IN, ""),
    PlasmaPin("z_offset_counts", "s32", "in", EXTERNAL_IN, ""),
)

class HalNet(NamedTuple):
    """One ``halcmd net`` line: a signal name and the pins to link to it."""

    signal: str
    members: Tuple[str, ...]


#: The links QtPlasmaC's ``link_hal_pins()`` makes, restricted to ones we can satisfy.
#: Without these the plasma layer runs but the machine misbehaves — most visibly, the
#: ``plasmac.axis-*-limit`` inputs stay at 0 and every probe fails.
HAL_NETS: Tuple[HalNet, ...] = (
    HalNet("plasmac:thc-feed-rate", ("qtplasmac.thc_feed_rate", "plasmac.thc-feed-rate",)),
    HalNet("plasmac:ohmic-probe-out", ("qtplasmac.ohmic_led_in",)),
    HalNet("plasmac:x-offset-current", ("qtplasmac.x_offset",)),
    HalNet("plasmac:y-offset-current", ("qtplasmac.y_offset",)),
    HalNet("plasmac:offsets-active", ("qtplasmac.offsets_active",)),
    HalNet("plasmac:height-override", ("qtplasmac.height_override", "plasmac.height-override",)),
    HalNet("plasmac:axis-x-max-limit", ("ini.x.max_limit", "plasmac.axis-x-max-limit",)),
    HalNet("plasmac:axis-x-min-limit", ("ini.x.min_limit", "plasmac.axis-x-min-limit",)),
    HalNet("plasmac:axis-y-max-limit", ("ini.y.max_limit", "plasmac.axis-y-max-limit",)),
    HalNet("plasmac:axis-y-min-limit", ("ini.y.min_limit", "plasmac.axis-y-min-limit",)),
    HalNet("plasmac:axis-z-max-limit", ("ini.z.max_limit", "plasmac.axis-z-max-limit",)),
    HalNet("plasmac:axis-z-min-limit", ("ini.z.min_limit", "plasmac.axis-z-min-limit",)),
    HalNet("plasmac:consumable-changing", ("plasmac.consumable-changing", "qtplasmac.consumable_changing",)),
    HalNet("plasmac:gcode-scale", ("plasmac.gcode-scale", "qtplasmac.gcode_scale",)),
    HalNet("plasmac:jog-inhibit", ("qtplasmac.jog_inhibited",)),
    HalNet("plasmac:laser-on", ("qtplasmac.laser_on",)),
    HalNet("plasmac:laser-recovery-state", ("plasmac.laser-recovery-state", "qtplasmac.laser_recovery_state",)),
    HalNet("plasmac:probe-test-error", ("plasmac.probe-test-error", "qtplasmac.probe_test_error",)),
    HalNet("plasmac:sensor_active", ("plasmac.sensor-active", "qtplasmac.sensor_active",)),
    HalNet("plasmac:state", ("plasmac.state-out", "qtplasmac.plasmac_state",)),
    HalNet("plasmac:stop", ("plasmac.stop-type-out", "qtplasmac.plasmac_stop",)),
    HalNet("plasmac:z-height", ("plasmac.z-height", "qtplasmac.z_height",)),
    HalNet("plasmac:z-offset-counts", ("qtplasmac.z_offset_counts",)),
    HalNet("plasmac:offset-set-probe", ("plasmac.offset-set-probe", "qtplasmac.offset_set_probe",)),
    HalNet("plasmac:offset-set-scribe", ("plasmac.offset-set-scribe", "qtplasmac.offset_set_scribe",)),
    HalNet("plasmac:adaptive-feed", ("qtplasmac.vel_reduct",)),
    HalNet("plasmac:feed-upm", ("motion.feed-upm", "plasmac.feed-upm",)),
)


_PLASMAC_BY_NAME: Dict[str, PlasmaPin] = {pin.name: pin for pin in PLASMAC_PINS}
_QTPLASMAC_BY_NAME: Dict[str, PlasmaPin] = {pin.name: pin for pin in QTPLASMAC_PINS}


def hal_name(component: str, pin: PlasmaPin) -> str:
    """Full HAL name, e.g. ``plasmac.pierce-height``."""
    return f"{component}.{pin.name}"


def plasmac_pin(name: str) -> PlasmaPin:
    """Look up a ``plasmac.*`` pin by its dashed name. Raises ``KeyError`` if unknown."""
    return _PLASMAC_BY_NAME[name]


def qtplasmac_pin(name: str) -> PlasmaPin:
    """Look up a ``qtplasmac.*`` pin by its dashed name. Raises ``KeyError`` if unknown."""
    return _QTPLASMAC_BY_NAME[name]


def is_writable(pin: PlasmaPin) -> bool:
    """Whether the backend may write this pin. The whole safety boundary in one call."""
    return pin.policy in WRITABLE_POLICIES


def writable_plasmac_pins() -> Tuple[PlasmaPin, ...]:
    return tuple(pin for pin in PLASMAC_PINS if is_writable(pin))


def readable_plasmac_pins() -> Tuple[PlasmaPin, ...]:
    """Every ``plasmac.*`` pin is readable; only the policy differs."""
    return PLASMAC_PINS


def missing_pins(existing: Iterable[str], pins: Iterable[PlasmaPin], component: str) -> List[str]:
    """Names in ``pins`` that ``existing`` (live HAL pin names) does not contain.

    Used at startup to log which pins this LinuxCNC build lacks instead of failing.
    """
    have = set(existing)
    return [
        hal_name(component, pin) for pin in pins if hal_name(component, pin) not in have
    ]
