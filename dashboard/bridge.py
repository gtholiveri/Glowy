"""GlowyMacgOrb — laptop bridge.

Listens for the Flipper's Bluetooth broadcast and serves the dashboard.
No pairing, no USB.

    pip install bleak
    python bridge.py          (or: python bridge.py 8766 to use another port)
    -> open http://localhost:8765   (the old page lives at /legacy.html)

No Flipper handy? `python bridge.py --fake` skips Bluetooth; keys typed in this
window place and remove the orb exactly as the Flipper would.
"""

import argparse
import asyncio
import json
import mimetypes
import pathlib
import sys
import time

PORT = 8765
COMPANY_ID = 0xFFFF
LOST_AFTER_S = 5.0
HERE = pathlib.Path(__file__).parent
WEB = HERE / "web"

state = {"orb": False, "seen": 0.0, "fake": False}
clients: set[asyncio.Queue] = set()


# ---------- orb broadcast ----------
def snapshot() -> str:
    heard = state["fake"] or time.time() - state["seen"] < LOST_AFTER_S
    return json.dumps({"orb": state["orb"], "flipper": heard})


def push() -> None:
    msg = snapshot()
    for q in list(clients):
        q.put_nowait(msg)


def on_advertisement(device, adv) -> None:
    data = adv.manufacturer_data.get(COMPANY_ID)
    if not data or len(data) < 3 or data[:2] != b"GM":
        return
    first = state["seen"] == 0.0
    state["seen"] = time.time()
    orb = data[2] == 1
    if orb != state["orb"] or first:
        state["orb"] = orb
        print("orb home" if orb else "orb away")
        push()


async def watchdog() -> None:
    # If the Flipper goes quiet while the orb was home, let the garden settle.
    while True:
        await asyncio.sleep(1)
        if state["orb"] and time.time() - state["seen"] > LOST_AFTER_S:
            state["orb"] = False
            print("flipper went quiet -> orb away")
            push()


# ---------- --fake: keys stand in for the Flipper ----------
def read_key() -> str | None:
    if sys.stdin.isatty():
        import msvcrt  # Windows: one keypress, no Enter needed

        return msvcrt.getwch().lower()
    line = sys.stdin.readline()  # piped input: one command per line
    return (line.strip()[:1] or "\n").lower() if line else None


async def fake_orb() -> None:
    print("FAKE ORB: Space/Enter = toggle, p = place, r = remove, q = quit (type in this window)")
    loop = asyncio.get_running_loop()
    while True:
        key = await loop.run_in_executor(None, read_key)
        if key is None:  # input closed: keep serving, just stop listening for keys
            await asyncio.Event().wait()
        if key in ("q", "\x03"):
            return
        if key == "p":
            orb = True
        elif key == "r":
            orb = False
        elif key in (" ", "\r", "\n", "t"):
            orb = not state["orb"]
        else:
            continue
        if orb != state["orb"]:
            state["orb"] = orb
            print("orb placed (home)" if orb else "orb removed (away)")
            push()


# ---------- tiny web server ----------
async def respond(writer, status: str, body: bytes, ctype: str) -> None:
    writer.write(
        f"HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\nContent-Length: {len(body)}\r\n"
        f"Cache-Control: no-cache\r\nConnection: close\r\n\r\n".encode()
        + body
    )
    await writer.drain()
    writer.close()


async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        request = await reader.readline()
        while (await reader.readline()) not in (b"\r\n", b""):
            pass  # headers: nothing here needs them
        parts = request.split()
        path = parts[1].decode().split("?")[0] if len(parts) > 1 else "/"
    except (ConnectionError, UnicodeDecodeError):
        writer.close()
        return

    if path == "/events":
        writer.write(
            b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n"
            b"Cache-Control: no-cache\r\nConnection: keep-alive\r\n\r\n"
        )
        q: asyncio.Queue = asyncio.Queue()
        clients.add(q)
        q.put_nowait(snapshot())
        try:
            while True:
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=2)
                except asyncio.TimeoutError:
                    msg = snapshot()  # heartbeat keeps the status dot honest
                if msg is None:  # shutting down
                    break
                writer.write(f"data: {msg}\n\n".encode())
                await writer.drain()
        except (ConnectionError, asyncio.CancelledError):
            pass
        finally:
            clients.discard(q)
            writer.close()
        return

    file = (WEB / (path.lstrip("/") or "index.html")).resolve()
    if file.is_dir():
        file = file / "index.html"
    if WEB.resolve() not in file.parents or not file.is_file():
        await respond(writer, "404 Not Found", b"not found", "text/plain")
        return
    ctype = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
    if ctype.startswith("text/") or ctype.endswith("javascript"):
        ctype += "; charset=utf-8"
    await respond(writer, "200 OK", file.read_bytes(), ctype)


async def main(port: int, fake: bool) -> None:
    mimetypes.add_type("text/javascript", ".js")
    servers = [await asyncio.start_server(handle, "127.0.0.1", port)]  # fails fast if the port is taken
    try:
        # Also answer on IPv6: on Windows, "localhost" tries it first and stalls ~2 s if nobody's there.
        servers.append(await asyncio.start_server(handle, "::1", port))
    except OSError:
        pass  # no IPv6 loopback on this machine; IPv4 is enough
    scanner = None
    if fake:
        state.update(fake=True, orb=True)  # start with Glowy home, like the orb sitting on the flower
        jobs = [asyncio.create_task(fake_orb())]
        print(f"Open http://localhost:{port}")
    else:
        from bleak import BleakScanner

        scanner = BleakScanner(detection_callback=on_advertisement)
        await scanner.start()
        jobs = [asyncio.create_task(watchdog())]
        print(f"Listening for the flower. Open http://localhost:{port}")
    try:
        serving = [asyncio.create_task(s.serve_forever()) for s in servers]
        try:
            await asyncio.wait([*serving, *jobs], return_when=asyncio.FIRST_COMPLETED)
        finally:
            # Let open pages disconnect; otherwise closing the server waits on them forever.
            for q in list(clients):
                q.put_nowait(None)
            for s in servers:
                s.close()
            for s in servers:
                await s.wait_closed()
    finally:
        if scanner:
            await scanner.stop()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="GlowyMacgOrb bridge")
    parser.add_argument("port", nargs="?", type=int, default=PORT)
    parser.add_argument("--fake", action="store_true", help="no Flipper: keys in this window place/remove the orb")
    args = parser.parse_args()
    asyncio.run(main(args.port, args.fake))
