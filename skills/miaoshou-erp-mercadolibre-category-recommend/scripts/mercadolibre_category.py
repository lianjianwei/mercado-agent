import argparse
from pathlib import Path
from typing import Any, Dict, Iterable, List

from mercadolibre_client import load_config, post, print_json


SKILL_DIR = Path(__file__).resolve().parent.parent
BASE_PATH = "/open/v1/product/collect_box/mercadolibre/collect_box/"


def json_mode(args: argparse.Namespace):
    return bool(getattr(args, "raw", False) or getattr(args, "json", False))


def cmd_detail(config: Dict[str, str], args: argparse.Namespace):
    body: Dict[str, Any] = {"detailId": args.detail_id}
    if args.shop_id:
        body["shopId"] = args.shop_id
    if args.cid:
        body["cid"] = args.cid
    result = post(config, BASE_PATH + "get_site_collect_item_info", body)
    info = result.get("data", {}).get("siteCollectItemInfo", {})
    if not json_mode(args):
        print(
            f"MercadoLibre detail={args.detail_id} "
            f"shopId={info.get('shopId')} cid={info.get('cid')} title={info.get('title')}"
        )
    return result


def cmd_setting(config: Dict[str, str], args: argparse.Namespace):
    result = post(config, BASE_PATH + "get_category_setting", {"cid": args.cid, "shopId": args.shop_id})
    data = result.get("data", {})
    if not json_mode(args):
        print(
            f"cid={args.cid} shopId={args.shop_id} "
            f"domain={data.get('catalogDomain')} maxTitle={data.get('maxTitleLength')}"
        )
    return result


def is_required(rule: Dict[str, Any]):
    tags = rule.get("tags") or {}
    return tags.get("required") is True or tags.get("required") == "true"


def cmd_attributes(config: Dict[str, str], args: argparse.Namespace):
    result = post(config, BASE_PATH + "get_category_attribute_rules", {"cid": args.cid, "shopId": args.shop_id})
    data = result.get("data", {})
    if not json_mode(args):
        for key in ("productAttributeRules", "saleAttributeRules", "skuAttributeRules"):
            rules = data.get(key) or []
            required = [rule for rule in rules if is_required(rule)]
            print(f"{key}: total={len(rules)} required={len(required)}")
    return result


def is_last_level(value: Any):
    return value in (True, "true", "TRUE", "1", 1)


def iter_category_nodes(nodes: Dict[str, Any], path: List[str] | None = None) -> Iterable[Dict[str, Any]]:
    path = path or []
    for node in (nodes or {}).values():
        if not isinstance(node, dict):
            continue
        name = node.get("name") or ""
        name_chinese = node.get("nameChinese") or ""
        label = name_chinese or name or str(node.get("cid") or "")
        current_path = path + [label]
        item = {
            "cid": node.get("cid"),
            "aid": node.get("aid"),
            "fid": node.get("fid"),
            "name": name,
            "nameChinese": name_chinese,
            "isLastLevel": is_last_level(node.get("isLastLevel")),
            "disabled": bool(node.get("disabled")),
            "path": current_path,
            "pathText": " > ".join(current_path),
        }
        yield item
        children = node.get("children") or {}
        if isinstance(children, dict):
            yield from iter_category_nodes(children, current_path)


def category_matches(node: Dict[str, Any], keywords: List[str]):
    searchable = " ".join(
        str(value).lower()
        for value in (
            node.get("name"),
            node.get("nameChinese"),
            node.get("pathText"),
        )
        if value
    )
    return all(keyword.lower() in searchable for keyword in keywords)


def search_category_tree(cate_tree: Dict[str, Any], keyword: str, leaf_only: bool = False, limit: int = 30):
    keywords = [part.strip() for part in keyword.replace("/", " ").replace(">", " ").split() if part.strip()]
    candidates = []
    for node in iter_category_nodes(cate_tree):
        if leaf_only and not node["isLastLevel"]:
            continue
        if node["disabled"]:
            continue
        if keywords and not category_matches(node, keywords):
            continue
        candidates.append(node)
        if len(candidates) >= limit:
            break
    return candidates


def cmd_tree(config: Dict[str, str], args: argparse.Namespace):
    result = post(config, BASE_PATH + "get_category_tree_by_site", {"site": args.site})
    cate_tree = result.get("data", {}).get("cateTree") or {}
    if args.keyword:
        candidates = search_category_tree(cate_tree, args.keyword, leaf_only=args.leaf_only, limit=args.limit)
        output = {
            "result": "success",
            "code": "localCategorySearch",
            "data": {
                "site": args.site,
                "keyword": args.keyword,
                "leafOnly": args.leaf_only,
                "candidateCount": len(candidates),
                "candidates": candidates,
            },
        }
        if not json_mode(args):
            print(f"category candidates site={args.site} keyword={args.keyword!r} count={len(candidates)}")
            for item in candidates:
                leaf = "leaf" if item["isLastLevel"] else "branch"
                print(f"- {item.get('cid')} | {leaf} | {item.get('pathText')}")
        return output
    if not json_mode(args):
        top_count = len(cate_tree) if isinstance(cate_tree, dict) else 0
        print(f"category tree site={args.site} topLevel={top_count}")
    return result


def cmd_options(config: Dict[str, str], _args: argparse.Namespace):
    return post(config, BASE_PATH + "get_item_options", {})


def cmd_sites(config: Dict[str, str], args: argparse.Namespace):
    body: Dict[str, Any] = {"includeCbt": args.include_cbt}
    if args.shop_id:
        body["shopId"] = args.shop_id
    return post(config, BASE_PATH + "get_auth_site_and_site_name_map", body)


def main():
    parser = argparse.ArgumentParser(description="Miaoshou ERP MercadoLibre category helper")
    parser.add_argument("--raw", action="store_true", help="Print only raw JSON")
    parser.add_argument("--json", action="store_true", help="Alias for --raw")
    subparsers = parser.add_subparsers(dest="command", required=True)

    detail = subparsers.add_parser("detail", help="Fetch detail and rule context")
    detail.add_argument("--detail-id", type=int, required=True)
    detail.add_argument("--shop-id", type=int)
    detail.add_argument("--cid", type=int)

    setting = subparsers.add_parser("setting", help="Fetch category setting")
    setting.add_argument("--cid", type=int, required=True)
    setting.add_argument("--shop-id", type=int, required=True)

    attrs = subparsers.add_parser("attributes", help="Fetch category attribute rules")
    attrs.add_argument("--cid", type=int, required=True)
    attrs.add_argument("--shop-id", type=int, required=True)

    tree = subparsers.add_parser("tree", help="Fetch/search MercadoLibre category tree")
    tree.add_argument("--site", default="CBT")
    tree.add_argument("--keyword")
    tree.add_argument("--leaf-only", action="store_true")
    tree.add_argument("--limit", type=int, default=30)

    subparsers.add_parser("options", help="Fetch MercadoLibre item option lists")

    sites = subparsers.add_parser("sites", help="Fetch authorized site map")
    sites.add_argument("--shop-id", type=int)
    sites.add_argument("--include-cbt", type=int, choices=(0, 1), default=1)

    args = parser.parse_args()
    config = load_config(SKILL_DIR)
    result = {
        "detail": cmd_detail,
        "setting": cmd_setting,
        "attributes": cmd_attributes,
        "tree": cmd_tree,
        "options": cmd_options,
        "sites": cmd_sites,
    }[args.command](config, args)
    if json_mode(args) or args.command in {"options", "sites"}:
        print_json(result)


if __name__ == "__main__":
    main()
