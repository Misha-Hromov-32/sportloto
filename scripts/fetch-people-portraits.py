"""Download the fixed stock portraits for fictional seed profiles. No runtime third-party requests."""

import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "backend/app/domain/seed/companion_people.json"
DESTINATION = ROOT / "frontend/public/demo/people"


def download(entry: tuple[str, str]) -> None:
    user_id, url = entry
    target = DESTINATION / f"{user_id}.jpg"
    if target.is_file():
        return
    request = Request(url, headers={"User-Agent": "Sportitochka-Seed/1.0"})
    with urlopen(request, timeout=45) as response:
        content = response.read()
    if not content.startswith(b"\xff\xd8"):
        raise ValueError(f"Expected JPEG for {user_id}")
    target.write_bytes(content)
    print(f"{user_id}: {len(content)} bytes")


if __name__ == "__main__":
    DESTINATION.mkdir(parents=True, exist_ok=True)
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(download, fixture["portraits"].items()))
