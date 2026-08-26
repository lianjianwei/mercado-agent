import argparse
from pathlib import Path
from typing import Any, Dict

from mercadolibre_client import load_config, parse_ids, post, print_json

from mercadolibre_readiness import readiness_from_detail


SKILL_DIR = Path(__file__).resolve().parent.parent
COLLECT_BOX_BASE = "/open/v1/product/collect_box/mercadolibre/collect_box/"
PUBLISH_PATH = "/open/v1/product/collect_box/mercadolibre/move_collect/save_move_collect_task"


def json_mode(args: argparse.Namespace):
    return bool(getattr(args, "raw", False) or getattr(args, "json", False))


def cmd_check(config: Dict[str, str], args: argparse.Namespace):
    checked = []
    for detail_id in parse_ids(args.detail_ids):
        detail = post(config, COLLECT_BOX_BASE + "get_site_collect_item_info", {"detailId": detail_id})
        missing = readiness_from_detail(detail)
        checked.append({"detailId": detail_id, "ready": not missing, "missing": missing})
    result = {"result": "success", "code": "localCheck", "data": {"items": checked}}
    print_json(result)
    return result


def cmd_publish(config: Dict[str, str], args: argparse.Namespace):
    detail_ids = parse_ids(args.detail_ids)
    if len(detail_ids) > 200:
        raise SystemExit("MercadoLibre publish accepts at most 200 detailIds per request.")
    body = {"detailIds": detail_ids}
    if args.dry_run:
        result = {"result": "dryRun", "data": body}
        print_json(result)
        return result
    result = post(config, PUBLISH_PATH, body)
    if not json_mode(args):
        print("Submitted MercadoLibre publish task.")
    print_json(result)
    return result


def main():
    parser = argparse.ArgumentParser(description="Miaoshou ERP MercadoLibre publish helper")
    parser.add_argument("--raw", action="store_true", help="Print only raw JSON")
    parser.add_argument("--json", action="store_true", help="Alias for --raw")
    subparsers = parser.add_subparsers(dest="command", required=True)

    check = subparsers.add_parser("check", help="Run local readiness checks from MercadoLibre detail API")
    check.add_argument("--detail-ids", required=True)

    publish = subparsers.add_parser("publish", help="Submit MercadoLibre publish task")
    publish.add_argument("--detail-ids", required=True)
    publish.add_argument("--dry-run", action="store_true")

    args = parser.parse_args()
    config = load_config(SKILL_DIR)
    {"check": cmd_check, "publish": cmd_publish}[args.command](config, args)


if __name__ == "__main__":
    main()
