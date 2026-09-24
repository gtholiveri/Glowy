"""GlowyMacgOrb — laptop bridge.

Listens for the Flipper's Bluetooth broadcast, serves the dashboard, and
writes the garden friends' chatter with Gemini. No pairing, no USB.

    pip install bleak google-genai
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
CHAT_MODELS = ("gemini-3.5-flash", "gemini-3.6-flash", "gemini-flash-latest")
CHAT_TIMEOUT_S = 20

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


# ---------- chatter ----------
CHAT_PROMPT = """You write tiny lines of ambient dialogue for a cozy, gentle garden game, like Animal Crossing.
It is night in a glowing garden. The theme is care and gratitude for every living being: the friends
often thank each other for the jobs they do in the garden, notice small beautiful things, and are sweet
about Glowy, a tiny fairy of light who lives in the glowing rose and can't fly yet (visitors carry her
around in a lantern so she can meet new friends).

Who can speak (id: who they are):
{cast}

What just happened: {event}

Write {n} lines of conversation between them. Rules: every line under 12 words; warm, funny, kind and
suitable for kids; no numbers or statistics; no real people or brands; each speaker must be one of the
ids above; vary who speaks; lines should reply to each other.
Return only JSON like [{{"speaker": "bee", "text": "..."}}]."""

_client = None


def load_key() -> str | None:
    env = HERE.parent / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            name, sep, value = line.partition("=")
            if not sep:
                return line  # a bare key
            if name.strip() in ("GEMINI_API_KEY", "GOOGLE_API_KEY"):
                return value.strip().strip("\"'")
    return None


async def write_chatter(req: dict) -> list[dict]:
    global _client
    cast = req.get("cast") or []
    ids = {c.get("id") for c in cast}
    if not cast:
        return []
    if _client is None:
        key = load_key()
        if not key:
            return []
        from google import genai

        _client = genai.Client(api_key=key)
    from google.genai import types

    prompt = CHAT_PROMPT.format(
        cast="\n".join(f"- {c['id']}: {c.get('desc', '')}" for c in cast),
        event=req.get("event") or "a quiet moment in the garden",
        n=int(req.get("n") or 8),
    )
    config = types.GenerateContentConfig(response_mime_type="application/json", temperature=1.0)
    for model in CHAT_MODELS:
        try:
            resp = await asyncio.wait_for(
                _client.aio.models.generate_content(model=model, contents=prompt, config=config),
                CHAT_TIMEOUT_S,
            )
            lines = json.loads(resp.text)
            good = [
                {"speaker": l["speaker"], "text": str(l["text"]).strip()}
                for l in lines
                if isinstance(l, dict)
                and l.get("speaker") in ids
                and 0 < len(str(l.get("text", ""))) <= 90
            ]
            if good:
                return good
        except Exception as e:  # noqa: BLE001 - fall through to the next model
            print(f"chatter: {model} failed: {str(e)[:120]}")
    return []


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
        headers = {}
        while (line := await reader.readline()) not in (b"\r\n", b""):
            name, _, value = line.decode(errors="replace").partition(":")
            headers[name.strip().lower()] = value.strip()
        parts = request.split()
        method = parts[0].decode() if parts else "GET"
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

    if path == "/api/chatter" and method == "POST":
        size = int(headers.get("content-length") or 0)
        try:
            req = json.loads(await reader.readexactly(size)) if size else {}
            lines = await write_chatter(req)
        except Exception as e:  # noqa: BLE001
            print(f"chatter request failed: {e}")
            lines = []
        await respond(writer, "200 OK", json.dumps({"lines": lines}).encode(), "application/json")
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
