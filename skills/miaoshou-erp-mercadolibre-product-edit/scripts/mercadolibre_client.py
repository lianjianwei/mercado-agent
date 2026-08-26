import hashlib
import hmac
import json
import os
import time
from pathlib import Path
from typing import Any, Dict, List
from urllib import request


DEFAULT_BASE_URL = "https://openapi-erp.91miaoshou.com"


def config_candidates(skill_dir: Path):
    env_path = os.environ.get("MIAOSHOU_CONFIG_PATH")
    if env_path:
        yield Path(env_path).expanduser()
    yield skill_dir / "resources" / "config.json"


def load_config(skill_dir: Path):
    config: Dict[str, str] = {}
    checked_paths: List[str] = []
    for config_path in config_candidates(skill_dir):
        checked_paths.append(str(config_path))
        if config_path.exists():
            config = json.loads(config_path.read_text(encoding="utf-8"))
            break
    app_key = os.environ.get("MIAOSHOU_APP_KEY") or config.get("app_key")
    app_secret = os.environ.get("MIAOSHOU_APP_SECRET") or config.get("app_secret")
    base_url = os.environ.get("MIAOSHOU_BASE_URL") or config.get("base_url") or DEFAULT_BASE_URL
    if not app_key or not app_secret:
        raise SystemExit(
            "Missing Miaoshou credentials. Set MIAOSHOU_APP_KEY/MIAOSHOU_APP_SECRET "
            "or create one of: " + ", ".join(checked_paths)
        )
    return {"app_key": app_key, "app_secret": app_secret, "base_url": base_url.rstrip("/")}


def compact_json(body: Dict[str, Any]):
    return json.dumps(body, ensure_ascii=False, separators=(",", ":"))


def sign(app_secret: str, path: str, timestamp: str, app_key: str, body_json: str):
    raw = f"{app_secret}{path}{timestamp}{app_key}{body_json}{app_secret}"
    return hmac.new(app_secret.encode("utf-8"), raw.encode("utf-8"), hashlib.sha256).hexdigest()


def post(config: Dict[str, str], path: str, body: Dict[str, Any] | None = None):
    payload = compact_json(body or {})
    timestamp = str(int(time.time()))
    headers = {
        "Content-Type": "application/json",
        "x-app-key": config["app_key"],
        "x-timestamp": timestamp,
        "x-sign": sign(config["app_secret"], path, timestamp, config["app_key"], payload),
    }
    req = request.Request(
        config["base_url"] + path,
        data=payload.encode("utf-8"),
        headers=headers,
        method="POST",
    )
    with request.urlopen(req, timeout=60) as response:
        text = response.read().decode("utf-8")
    return json.loads(text) if text else {}


def parse_ids(value: str):
    return [int(part.strip()) for part in value.split(",") if part.strip()]


def print_json(value: Any):
    print(json.dumps(value, ensure_ascii=False, indent=2))
