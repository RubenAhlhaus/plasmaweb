# Web interface version of QtPlasmaC

## Goal

The goal is to create a web interface version of QtPlasmaC. The interface should have all the functionality that QtPlasmaC has including the look/feel/customisability of the UI. The communication will be done via a websocket interface to a python backend. The front end can be written in React or vanilla JS.

## Plan of attack

Instead of "merging" the files, extract the non-GUI logic from QtPlasmaC and wrap it in a WebSocket server utilising the source code from Lcncgui.

Three specific areas of focus:

1. Extract the Conversational G-code Generators

One of QtPlasmaC's best features is its built-in conversational programming (generating shapes like circles, arcs, and lines directly on the screen).

- The File: reference/linuxcnc/src/emc/usr_intf/qtvcp/lib/qtplasmac/conversational.py
- Extract the mathematical shape-to-gcode generation functions from this file into a pure Python library. Remove all Qt, widget, and interface dependencies so it output raw G-code text based on JSON inputs.

2. Bridge the plasmac HAL Pins to JSON

QtPlasmaC monitors things like torch height control, arc voltage, and consumables wear by reading LinuxCNC HAL pins.

- Write a Python WebSocket loop using the native hal module. Every 50ms, poll the plasmac.* pins (like plasmac.torch-on, plasmac.arc-ok, and plasmac.requested-height) and broadcast their states as a JSON object over the WebSocket. Also handle incoming WebSocket messages to write values back to those pins.

3. Parse the Material Cut Charts

QtPlasmaC reads and writes material settings (amperage, feed rate, pierce height) from a text-based .cfg file.

- Create a Python parser that converts a LinuxCNC QtPlasmaC _material.cfg file into a JSON structure, and write a function to save JSON modifications back to the .cfg format.

## Pitfalls to Watch Out For

- The Real-Time Trap: WebSockets and Python are not real-time. Never let your web interface handle critical timing (like turning off the torch if voltage spikes). Make sure all safety and reactive logic stays inside the low-level LinuxCNC plasmac HAL component. Your web app should only be a dashboard and a remote control.

- The Event Loop Conflict: Python's asyncio (commonly used for WebSockets) can conflict with LinuxCNC's standard synchronous polling loop. Run the LinuxCNC status polling (linuxcnc.stat()) in a separate thread or a dedicated worker process so it doesn't freeze your web server.

## Reference

- LinuxCNC - *root*/reference/linuxcnc/
- Lcncgui - *root*/reference/lcncgui/