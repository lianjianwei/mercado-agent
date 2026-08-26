import argparse
from pathlib import Path
from typing import Any, Dict

from mercadolibre_collectbox_utils import load_payload, normalize_payload, readiness_from_detail, readiness_from_info
from mercadolibre_client import load_config, post, print_json


SKILL_DIR = Path(__file__).resolve().parent.parent
BASE_PATH = "/open/v1/product/collect_box/mercadolibre/collect_box/"


def json_mode(args: argparse.Namespace):
    return bool(getattr(args, "raw", False) or getattr(args, "json", False))


def print_summary(args: argparse.Namespace, message: str):
    if not json_mode(args):
        print(message)


def cmd_list(config: Dict[str, str], args: argparse.Namespace):
    filters: Dict[str, Any] = {}
    if args.status is not None:
        filters["status"] = args.status
    if args.filter_cid_site:
        filters["filterCidSite"] = args.filter_cid_site
    if args.keyword:
        filters["sourceItemIdKeyword"] = args.keyword
    body: Dict[str, Any] = {"pageNo": args.page, "pageSize": args.size}
    if filters:
        body["filter"] = filters
    result = post(config, BASE_PATH + "search_collect_box_detailList", body)
    detail_list = result.get("data", {}).get("detailList") or result.get("data", {}).get("list") or []
    if not json_mode(args):
        print(f"MercadoLibre collect box page={args.page} size={args.size} items={len(detail_list)}")
        for item in detail_list[:20]:
            detail_id = item.get("collectBoxDetailId")
            print(f"- {detail_id} | {item.get('title')} | status={item.get('status')} | cid={item.get('cid')}")
    return result


def cmd_detail(config: Dict[str, str], args: argparse.Namespace):
    body: Dict[str, Any] = {"detailId": args.detail_id}
    if args.shop_id:
        body["shopId"] = args.shop_id
    if args.cid:
        body["cid"] = args.cid
    result = post(config, BASE_PATH + "get_site_collect_item_info", body)
    info = result.get("data", {}).get("siteCollectItemInfo", {})
    print_summary(
        args,
        f"MercadoLibre detail {args.detail_id}: "
        f"title={info.get('title')} cid={info.get('cid')} sku={len(info.get('skuMap') or {})}",
    )
    return result


def cmd_preflight(config: Dict[str, str], args: argparse.Namespace):
    body: Dict[str, Any] = {"detailId": args.detail_id}
    if args.shop_id:
        body["shopId"] = args.shop_id
    if args.cid:
        body["cid"] = args.cid
    detail_result = post(config, BASE_PATH + "get_site_collect_item_info", body)
    data = detail_result.get("data") or {}
    info = data.get("siteCollectItemInfo") or {}
    cid = args.cid or info.get("cid")
    shop_id = args.shop_id or info.get("shopId")
    setting = {}
    if cid and shop_id:
        setting_result = post(config, BASE_PATH + "get_category_setting", {"cid": cid, "shopId": shop_id})
        setting = setting_result.get("data") or {}
        data["categorySetting"] = setting
    missing = readiness_from_detail({"data": data})
    output = {
        "result": "success",
        "code": "localPreflight",
        "data": {
            "detailId": args.detail_id,
            "ready": not missing,
            "missing": missing,
            "cid": cid,
            "shopId": shop_id,
            "maxTitleLength": setting.get("maxTitleLength"),
        },
    }
    print_json(output)
    return output


def cmd_check(config: Dict[str, str], args: argparse.Namespace):
    body = {"detailId": args.detail_id}
    result = post(config, BASE_PATH + "get_site_collect_item_info", body)
    missing = readiness_from_detail(result)
    output = {
        "result": "success",
        "code": "localCheck",
        "data": {"detailId": args.detail_id, "ready": not missing, "missing": missing},
    }
    print_json(output)
    return output


def load_optional_json(path: str | None):
    if not path:
        return None
    import json

    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def context_from_args(args: argparse.Namespace):
    detail_context = load_optional_json(args.context)
    if detail_context:
        data = detail_context.get("data") if isinstance(detail_context, dict) else {}
        data = data or {}
        return {
            "product_rules": data.get("productAttributeRules") or detail_context.get("productAttributeRules"),
            "setting": data.get("categorySetting") or data.get("setting") or detail_context.get("categorySetting") or detail_context.get("setting"),
        }
    return {
        "product_rules": load_optional_json(args.rules),
        "setting": load_optional_json(args.setting),
    }


def cmd_normalize(_config: Dict[str, str], args: argparse.Namespace):
    payload = load_payload(args, wrap=bool(args.detail_id))
    context = context_from_args(args)
    result = normalize_payload(payload, product_rules=context["product_rules"], setting=context["setting"])
    info = result["payload"].get("siteCollectItemInfo") if isinstance(result["payload"].get("siteCollectItemInfo"), dict) else result["payload"]
    missing = readiness_from_info(info, product_rules=context["product_rules"], setting=context["setting"])
    result["preValidation"] = {
        "ready": not missing,
        "missing": missing,
    }
    output = {"result": "dryRun", "code": "localNormalize", "data": result}
    print_json(output)
    return output


def cmd_create(config: Dict[str, str], args: argparse.Namespace):
    payload = load_payload(args, wrap=False)
    if "siteCollectItemInfo" not in payload:
        payload = {"siteCollectItemInfo": payload}
    if args.dry_run:
        print_summary(args, "DRY RUN: would submit create_collect_box_item")
        return {"result": "dryRun", "data": payload}
    result = post(config, BASE_PATH + "create_collect_box_item", payload)
    print_summary(args, "Created MercadoLibre collect box item.")
    return result


def cmd_save(config: Dict[str, str], args: argparse.Namespace):
    payload = load_payload(args, wrap=True)
    missing = readiness_from_info(payload.get("siteCollectItemInfo") or {})
    if missing and not args.skip_pre_validate:
        result = {
            "result": "preValidationFailed",
            "code": "localPreValidation",
            "data": {"ready": False, "missing": missing},
        }
        print_json(result)
        raise SystemExit(2)
    if args.dry_run:
        print_summary(args, "DRY RUN: would submit save_site_collect_item_info")
        return {"result": "dryRun", "data": {"preValidation": {"ready": True}, "payload": payload}}
    result = post(config, BASE_PATH + "save_site_collect_item_info", payload)
    print_summary(args, "Saved MercadoLibre collect box site data.")
    return result


def cmd_options(config: Dict[str, str], _args: argparse.Namespace):
    return post(config, BASE_PATH + "get_item_options", {})


def cmd_sites(config: Dict[str, str], args: argparse.Namespace):
    body: Dict[str, Any] = {"includeCbt": args.include_cbt}
    if args.shop_id:
        body["shopId"] = args.shop_id
    return post(config, BASE_PATH + "get_auth_site_and_site_name_map", body)


def should_print_result(args: argparse.Namespace):
    raw_commands = {"create", "save", "options", "sites"}
    return json_mode(args) or args.command in raw_commands


def main():
    parser = argparse.ArgumentParser(description="Miaoshou ERP MercadoLibre collect box helper")
    parser.add_argument("--raw", action="store_true", help="Print only raw JSON")
    parser.add_argument("--json", action="store_true", help="Alias for --raw")
    subparsers = parser.add_subparsers(dest="command", required=True)

    list_parser = subparsers.add_parser("list")
    list_parser.add_argument("--page", type=int, default=1)
    list_parser.add_argument("--size", type=int, default=20)
    list_parser.add_argument("--status", default="notPublished")
    list_parser.add_argument("--filter-cid-site", default="CBT")
    list_parser.add_argument("--keyword", default="")

    detail = subparsers.add_parser("detail")
    detail.add_argument("--detail-id", type=int, required=True)
    detail.add_argument("--shop-id", type=int)
    detail.add_argument("--cid", type=int)

    preflight = subparsers.add_parser("preflight")
    preflight.add_argument("--detail-id", type=int, required=True)
    preflight.add_argument("--shop-id", type=int)
    preflight.add_argument("--cid", type=int)

    check = subparsers.add_parser("check")
    check.add_argument("--detail-id", type=int, required=True)

    normalize = subparsers.add_parser("normalize")
    normalize.add_argument("--payload", required=True)
    normalize.add_argument("--detail-id", type=int)
    normalize.add_argument("--context", help="Raw detail/preflight JSON containing productAttributeRules and categorySetting")
    normalize.add_argument("--rules", help="JSON file containing productAttributeRules")
    normalize.add_argument("--setting", help="JSON file containing category setting")

    create = subparsers.add_parser("create")
    create.add_argument("--payload", required=True)
    create.add_argument("--dry-run", action="store_true")

    save = subparsers.add_parser("save")
    save.add_argument("--detail-id", type=int)
    save.add_argument("--payload", required=True)
    save.add_argument("--dry-run", action="store_true")
    save.add_argument("--skip-pre-validate", action="store_true")

    subparsers.add_parser("options")

    sites = subparsers.add_parser("sites")
    sites.add_argument("--shop-id", type=int)
    sites.add_argument("--include-cbt", type=int, choices=(0, 1), default=1)

    args = parser.parse_args()
    commands = {
        "list": cmd_list,
        "detail": cmd_detail,
        "preflight": cmd_preflight,
        "check": cmd_check,
        "normalize": cmd_normalize,
        "create": cmd_create,
        "save": cmd_save,
        "options": cmd_options,
        "sites": cmd_sites,
    }
    config = {} if args.command == "normalize" else load_config(SKILL_DIR)
    result = commands[args.command](config, args)
    if should_print_result(args):
        print_json(result)


if __name__ == "__main__":
    main()
