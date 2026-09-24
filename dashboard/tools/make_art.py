"""Generate the dashboard art with Gemini.

    python make_art.py              # make anything that's missing
    python make_art.py frog bee     # remake just these
    python make_art.py stages       # remake all six garden stages

Needs the Gemini key in GlowyMacgOrb/.env and:  pip install google-genai "rembg[cpu]" pillow
Garden stages are chained edits of one picture, so the garden grows in place.
Creatures are cut out of their backgrounds so they can walk around the scene.
"""

import io
import pathlib
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from google import genai
from google.genai import types
from PIL import Image

HERE = pathlib.Path(__file__).parent
ASSETS = HERE.parent / "web" / "assets"
RAW = HERE / "raw"
STYLE_REF = (HERE / "style_ref.png").read_bytes()
MODELS = ("gemini-3.1-flash-image", "gemini-2.5-flash-image")

STYLE = (
    "Art style: low-poly faceted 3D, like a cozy indie video game. Clean flat-shaded facets, "
    "soft bioluminescent glow accents in teal and rose, gentle rim light, cute and whimsical, "
    "simple readable shapes, matching the style of the reference image. No text, no watermark, no UI."
)

KEEP = (
    "Edit the provided image. Keep the camera, framing, composition, lighting, colors, sky and every "
    "existing element exactly the same and in exactly the same place. Do not add any animals, "
    "characters or fairies. Only add: "
)

STAGES = [
    "A wide 16:9 night garden clearing seen from a low, straight-on camera. In the lower center stands "
    "one large glowing translucent rose-red low-poly rose on a short stem: the heart of the garden. "
    "The ground is mostly bare dark soil with a few scattered stones and a faint stepping-stone path "
    "leading toward the flower. Low-poly hills and silhouetted pine trees on the far horizon, deep teal "
    "night sky with stars and a crescent moon. Lots of open empty ground on the left and right of the "
    "flower. The scene feels quiet and a little empty, waiting to grow. No animals, no characters, "
    "no fairies, no buildings, no benches. " + STYLE,
    KEEP + "short tufts of grass and tiny glowing green sprouts scattered across the soil, and a few "
    "small leafy plants near the flower.",
    KEEP + "clusters of glowing low-poly wildflowers in teal, violet and pink on both sides, a small "
    "cluster of glowing mushrooms in the lower left foreground, and a few fireflies.",
    KEEP + "a small calm pond in the lower right part of the scene with lily pads, a few reeds and a "
    "soft teal glow on the water.",
    KEEP + "one big glowing low-poly tree on the left side of the scene behind the flowers, with a thick "
    "trunk and a rounded canopy of softly glowing leaves.",
    KEEP + "a full bloom: many more glowing flowers and small crystals everywhere, little paper lanterns "
    "hanging in the tree, more fireflies, and a soft teal-and-rose aurora across the sky. Keep the "
    "central rose, the pond and the tree where they are.",
]

SPRITE = (
    "{desc}. One single cute character, full body, centered, three-quarter view toward the viewer, "
    "isolated on a plain flat solid light gray background, no shadow, no ground, no scenery, no text. "
    + STYLE
)

# Glowy is a fairy made only of light: a glowing sphere with two pairs of wings. The dashboard
# makes the wings flutter and draws a pulsing core over the sphere, so the sphere must be centered.
GLOWY = (
    "A tiny fairy made only of light: a small, very bright sphere of warm white light with a soft "
    "rose-pink and gold glow, and two pairs of delicate translucent dragonfly-like wings, an upper pair "
    "raised high and a lower pair angled down, spread symmetrically from the sphere. No face, no body, "
    "no arms or legs. The sphere sits in the exact center of the image. Isolated on a plain flat solid "
    "light gray background, no shadow, no scenery, no text. Clean, simple, magical, slightly low-poly "
    "facets on the wings."
)
SPRITES = {
    "bee": "a round fuzzy bumblebee with big friendly eyes, black and golden stripes and small "
    "translucent wings",
    "earthworm": "a friendly pink earthworm poking up out of a little mound of soil, smiling, big eyes, "
    "rosy cheeks",
    "moth": "a soft fluffy night moth with wide dusty-violet wings with pale moon-like spots, fuzzy "
    "antennae and big eyes",
    "snail": "a small snail with a glowing teal spiral crystal shell and big shy eyes on stalks",
    "mushroom": "a little mushroom creature with a glowing violet spotted cap, tiny arms and a happy face",
    "frog": "a small round green frog with big shiny eyes and a happy smile, sitting on a lily pad",
    "ladybug": "a round red ladybug with black spots and a tiny smiling face",
    "firefly": "a tiny firefly with a softly glowing yellow-green tail light and big friendly eyes",
    "bat": "a small fluffy fruit bat with big ears and soft wings spread open, friendly smile",
    "spider": "a small cute round garden spider with big shiny eyes hanging from one silk thread, "
    "friendly and not scary at all",
    "luna_moth": "a rare luna moth with long pale mint-green wings with graceful long tails and small "
    "eyespots, elegant and magical, softly glowing",
    "tortoise": "a wise ancient tortoise with a mossy shell covered in tiny glowing flowers and gentle "
    "old eyes",
}


def load_key() -> str:
    env = HERE.parent.parent / ".env"
    for line in env.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        name, sep, value = line.partition("=")
        if not sep:
            return line  # a bare key
        if name.strip() in ("GEMINI_API_KEY", "GOOGLE_API_KEY"):
            return value.strip().strip("\"'")
    raise SystemExit("No key found in .env")


client = genai.Client(api_key=load_key())


def generate(prompt: str, images: list[bytes], aspect: str, size: str | None = None) -> bytes:
    contents = [types.Part.from_bytes(data=b, mime_type="image/png") for b in images] + [prompt]
    configs = []
    if size:
        configs.append(types.ImageConfig(aspect_ratio=aspect, image_size=size))
    configs += [types.ImageConfig(aspect_ratio=aspect), None]

    last_error = None
    for model in MODELS:
        for image_config in configs:
            for attempt in range(3):
                try:
                    config = types.GenerateContentConfig(
                        response_modalities=["IMAGE"], image_config=image_config
                    )
                    resp = client.models.generate_content(model=model, contents=contents, config=config)
                    for part in resp.candidates[0].content.parts:
                        if getattr(part, "inline_data", None) and part.inline_data.data:
                            return part.inline_data.data
                    raise RuntimeError("no image in response")
                except Exception as e:  # noqa: BLE001 - retry anything, report the last
                    last_error = e
                    text = str(e)
                    if "429" in text or "503" in text or "UNAVAILABLE" in text:
                        time.sleep(8 * (attempt + 1))
                        continue
                    break  # bad config/model: try the next one
    raise RuntimeError(f"image generation failed: {last_error}")


def save_stage(n: int, data: bytes) -> None:
    (RAW / f"stage{n}.png").write_bytes(data)
    Image.open(io.BytesIO(data)).convert("RGB").save(ASSETS / f"stage{n}.jpg", quality=90)


def make_stages(start: int = 0) -> None:
    prev = (RAW / f"stage{start - 1}.png").read_bytes() if start > 0 else None
    for n in range(start, len(STAGES)):
        t = time.time()
        refs = [STYLE_REF] if n == 0 else [prev]
        prev = generate(STAGES[n], refs, "16:9", "2K")
        save_stage(n, prev)
        print(f"stage{n} done ({time.time() - t:.0f}s)", flush=True)


_cutter = None
_cutter_lock = threading.Lock()


def cut_out(data: bytes) -> Image.Image:
    global _cutter
    from rembg import new_session, remove

    with _cutter_lock:  # the first call downloads the model; do it once
        if _cutter is None:
            try:
                _cutter = new_session("isnet-general-use")
            except Exception:  # noqa: BLE001
                _cutter = new_session("u2net")
    img = remove(Image.open(io.BytesIO(data)).convert("RGBA"), session=_cutter)
    box = img.getbbox()
    if box:
        img = img.crop(box)
    img.thumbnail((640, 640))
    return img


def make_sprite(name: str) -> None:
    t = time.time()
    data = generate(SPRITE.format(desc=SPRITES[name]), [STYLE_REF], "1:1")
    (RAW / f"{name}.png").write_bytes(data)
    cut_out(data).save(ASSETS / f"friends/{name}.png", optimize=True)
    print(f"{name} done ({time.time() - t:.0f}s)", flush=True)


def make_glowy() -> None:
    import numpy as np
    from PIL import ImageFilter
    from rembg import remove

    t = time.time()
    data = generate(GLOWY, [], "1:1")
    (RAW / "glowy.png").write_bytes(data)
    cut_out(data)  # makes sure the cutter model is loaded
    img = remove(Image.open(io.BytesIO(data)).convert("RGBA"), session=_cutter)
    ys, xs = np.nonzero(np.asarray(img)[..., 3] > 40)  # ignore faint specks left by the cutter
    img = img.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    img.thumbnail((640, 640))
    img.save(ASSETS / "glowy.png", optimize=True)

    # Report where the sphere landed: .fairy's transform-origin and .core in style.css use it.
    px = np.asarray(img).astype(float)
    lum = Image.fromarray((px[..., :3].mean(axis=2) * px[..., 3] / 255).astype(np.uint8))
    cy, cx = np.unravel_index(np.asarray(lum.filter(ImageFilter.GaussianBlur(25))).argmax(), px.shape[:2])
    print(
        f"glowy done ({time.time() - t:.0f}s): {img.width}x{img.height}, "
        f"sphere at {cx / img.width:.1%} {cy / img.height:.1%}",
        flush=True,
    )


def main() -> None:
    RAW.mkdir(exist_ok=True)
    (ASSETS / "friends").mkdir(parents=True, exist_ok=True)
    wanted = [a for a in sys.argv[1:] if not a.startswith("-")]

    if wanted:
        sprites = [w for w in wanted if w in SPRITES]
        do_stages = "stages" in wanted
        do_glowy = "glowy" in wanted
    else:
        sprites = [n for n in SPRITES if not (ASSETS / f"friends/{n}.png").exists()]
        do_stages = not all((ASSETS / f"stage{n}.jpg").exists() for n in range(len(STAGES)))
        do_glowy = not (ASSETS / "glowy.png").exists()

    with ThreadPoolExecutor(max_workers=3) as pool:
        stage_job = pool.submit(make_stages) if do_stages else None
        jobs = {pool.submit(make_sprite, n): n for n in sprites}
        if do_glowy:
            jobs[pool.submit(make_glowy)] = "glowy"
        for job, name in jobs.items():
            try:
                job.result()
            except Exception as e:  # noqa: BLE001
                print(f"{name} FAILED: {e}", flush=True)
        if stage_job:
            try:
                stage_job.result()
            except Exception as e:  # noqa: BLE001
                print(f"stages FAILED: {e}", flush=True)


if __name__ == "__main__":
    main()
