import json
from copy import deepcopy
from pathlib import Path
from typing import Any, Dict, List

from mercadolibre_readiness import is_blank, readiness_from_detail, readiness_from_info


def change(path: str, before: Any, after: Any, reason: str):
    return {"path": path, "before": before, "after": after, "reason": reason}


def value_id(value: Dict[str, Any]):
    for key in ("skuKey", "valueId", "value_id", "id"):
        candidate = value.get(key)
        if isinstance(candidate, int):
            return candidate
        if isinstance(candidate, str) and candidate.isdigit():
            return int(candidate)
    return None


def normalize_attribute_values(attr: Dict[str, Any], path: str, changes: List[Dict[str, Any]]):
    values = attr.get("values")
    if not isinstance(values, list):
        return
    normalized = []
    changed = False
    for value in values:
        if isinstance(value, dict):
            normalized.append(value)
        else:
            normalized_value = {"name": str(value)}
            normalized.append(normalized_value)
            changed = True
    if changed:
        changes.append(change(f"{path}.values", values, normalized, "Convert scalar attribute values to save API value objects."))
        attr["values"] = normalized


def product_rule_name_by_id(product_rules: Any):
    mapping: Dict[str, str] = {}
    for rule in product_rules or []:
        if not isinstance(rule, dict):
            continue
        rule_id = rule.get("id")
        rule_name = rule.get("name")
        if rule_id and rule_name:
            mapping[str(rule_id)] = str(rule_name)
    return mapping


def normalize_product_attributes(info: Dict[str, Any], product_rules: Any, changes: List[Dict[str, Any]]):
    id_to_name = product_rule_name_by_id(product_rules)
    for index, attr in enumerate(info.get("attributes") or []):
        if not isinstance(attr, dict):
            continue
        attr_path = f"siteCollectItemInfo.attributes[{index}]"
        attr_id = attr.get("id")
        if attr_id and not attr.get("name") and str(attr_id) in id_to_name:
            attr["name"] = id_to_name[str(attr_id)]
            changes.append(change(f"{attr_path}.name", None, attr["name"], "Use category rule name for save payload attribute identity."))
        normalize_attribute_values(attr, attr_path, changes)


def replace_sku_key_part(sku_key: str, sku_key_map: Dict[str, int]):
    parts = sku_key.split(";")
    changed = False
    for index, part in enumerate(parts):
        if part in sku_key_map:
            parts[index] = str(sku_key_map[part])
            changed = True
    return ";".join(parts), changed


def normalize_sale_attributes_and_sku_keys(info: Dict[str, Any], changes: List[Dict[str, Any]], warnings: List[str]):
    sku_key_map: Dict[str, int] = {}
    for attr_index, attr in enumerate(info.get("saleAttributes") or []):
        if not isinstance(attr, dict):
            continue
        for value_index, value in enumerate(attr.get("values") or []):
            if not isinstance(value, dict):
                continue
            old_sku_key = value.get("skuKey")
            new_sku_key = value_id(value)
            path = f"siteCollectItemInfo.saleAttributes[{attr_index}].values[{value_index}].skuKey"
            if isinstance(old_sku_key, str) and new_sku_key is not None:
                value["skuKey"] = new_sku_key
                sku_key_map[old_sku_key] = new_sku_key
                changes.append(change(path, old_sku_key, new_sku_key, "Convert hex/internal skuKey to integer value ID."))
            elif isinstance(old_sku_key, str):
                warnings.append(f"{path}: cannot convert string skuKey without an integer id/valueId on the same value.")
    if not sku_key_map:
        return
    sku_map = info.get("skuMap") or {}
    if isinstance(sku_map, dict):
        new_sku_map: Dict[str, Any] = {}
        for key, sku in sku_map.items():
            new_key, changed_key = replace_sku_key_part(str(key), sku_key_map)
            if changed_key:
                changes.append(change(f"siteCollectItemInfo.skuMap[{key}]", key, new_key, "Rewrite skuMap key to match normalized sale attribute value IDs."))
            if new_key in new_sku_map:
                warnings.append(f"siteCollectItemInfo.skuMap[{key}]: normalized key collides with existing {new_key}.")
            new_sku_map[new_key] = sku
        info["skuMap"] = new_sku_map
    first_sku_key = info.get("firstSkuKey")
    if isinstance(first_sku_key, str):
        new_first_sku_key, changed_key = replace_sku_key_part(first_sku_key, sku_key_map)
        if changed_key:
            info["firstSkuKey"] = new_first_sku_key
            changes.append(change("siteCollectItemInfo.firstSkuKey", first_sku_key, new_first_sku_key, "Keep firstSkuKey aligned with normalized skuMap keys."))


def title_trim_suggestions(info: Dict[str, Any], setting: Dict[str, Any] | None, warnings: List[str]):
    if not setting:
        return
    max_title_length = setting.get("maxTitleLength")
    if not max_title_length:
        return
    try:
        max_title_length = int(max_title_length)
    except (TypeError, ValueError):
        return
    title = info.get("title") or ""
    if len(title) > max_title_length:
        warnings.append(f"siteCollectItemInfo.title length {len(title)} exceeds maxTitleLength {max_title_length}; rewrite manually before save.")
    for index, site_title in enumerate(info.get("siteAndTitleList") or []):
        if not isinstance(site_title, dict):
            continue
        value = site_title.get("title") or ""
        if len(value) > max_title_length:
            warnings.append(f"siteCollectItemInfo.siteAndTitleList[{index}].title length {len(value)} exceeds maxTitleLength {max_title_length}; rewrite manually before save.")


def normalize_payload(payload: Dict[str, Any], product_rules: Any = None, setting: Dict[str, Any] | None = None):
    normalized = deepcopy(payload)
    info = normalized.get("siteCollectItemInfo") if isinstance(normalized.get("siteCollectItemInfo"), dict) else normalized
    changes: List[Dict[str, Any]] = []
    warnings: List[str] = []
    if not isinstance(info, dict):
        return {"changed": False, "changes": [], "warnings": ["payload does not contain a siteCollectItemInfo object"], "payload": normalized}
    normalize_product_attributes(info, product_rules, changes)
    normalize_sale_attributes_and_sku_keys(info, changes, warnings)
    title_trim_suggestions(info, setting, warnings)
    if is_blank(info.get("warrantyType")):
        warnings.append("siteCollectItemInfo.warrantyType is blank; choose an API option explicitly before save.")
    return {"changed": bool(changes), "changes": changes, "warnings": warnings, "payload": normalized}


def load_payload(args, wrap: bool):
    payload_path = Path(args.payload)
    payload = json.loads(payload_path.read_text(encoding="utf-8-sig"))
    if wrap and "siteCollectItemInfo" not in payload:
        if not args.detail_id:
            raise SystemExit("--detail-id is required when payload is only the siteCollectItemInfo object")
        payload = {"detailId": args.detail_id, "siteCollectItemInfo": payload}
    return payload
