"""GlowyMacgOrb — laptop bridge.

Listens for the Flipper's Bluetooth broadcast and passes "orb home / away"
to the dashboard in the browser. No pairing, no USB.

    pip install bleak
    python bridge.py
    -> open http://localhost:8765
"""

import asyncio
import json
import pathlib
import time

from bleak import BleakScanner

PORT = 8765
COMPANY_ID = 0xFFFF
LOST_AFTER_S = 5.0
PAGE = pathlib.Path(__file__).with_name("index.html")

state = {"orb": False, "seen": 0.0}
clients: set[asyncio.Queue] = set()


def snapshot() -> str:
    return json.dumps({"orb": state["orb"], "flipper": time.time() - state["seen"] < LOST_AFTER_S})


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


async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    request = await reader.readline()
    while (await reader.readline()) not in (b"\r\n", b""):
        pass
    parts = request.split()
    path = parts[1].decode() if len(parts) > 1 else "/"

    if path.startswith("/events"):
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
                writer.write(f"data: {msg}\n\n".encode())
                await writer.drain()
        except (ConnectionError, asyncio.CancelledError):
            pass
        finally:
            clients.discard(q)
            writer.close()
        return

    body = PAGE.read_bytes()
    writer.write(
        b"HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n"
        + f"Content-Length: {len(body)}\r\nConnection: close\r\n\r\n".encode()
        + body
    )
    await writer.drain()
    writer.close()


async def watchdog() -> None:
    # If the Flipper goes quiet while the orb was home, let the garden settle.
    while True:
        await asyncio.sleep(1)
        if state["orb"] and time.time() - state["seen"] > LOST_AFTER_S:
            state["orb"] = False
            print("flipper went quiet -> orb away")
            push()


async def main() -> None:
    scanner = BleakScanner(detection_callback=on_advertisement)
    await scanner.start()
    server = await asyncio.start_server(handle, "127.0.0.1", PORT)
    print(f"Listening for the flower. Open http://localhost:{PORT}")
    asyncio.create_task(watchdog())
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
