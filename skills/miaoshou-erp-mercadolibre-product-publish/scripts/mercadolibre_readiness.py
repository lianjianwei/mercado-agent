from typing import Any, Dict, List


REQUIRED_INFO_FIELDS = (
    "title",
    "notes",
    "cid",
    "shopId",
    "sites",
    "siteAndTitleList",
    "siteAndListingTypeList",
    "siteAndPriceMap",
    "price",
    "pricingMode",
    "warrantyType",
    "warrantyTime",
    "warrantyTimeUnit",
    "skuMap",
    "firstSkuKey",
)

REQUIRED_SKU_FIELDS = ("stock", "itemNum")
REQUIRED_DIMENSION_FIELDS = ("length", "width", "height")


def is_blank(value: Any):
    return value is None or value == "" or value == [] or value == {}


def is_required(rule: Dict[str, Any]):
    tags = rule.get("tags") or {}
    return tags.get("required") in (True, "true", 1, "1") or tags.get("catalogRequired") in (True, "true", 1, "1")


def is_hidden_or_readonly(rule: Dict[str, Any]):
    tags = rule.get("tags") or {}
    return tags.get("hidden") in (True, "true", 1, "1") or tags.get("readOnly") in (True, "true", 1, "1")


def rule_key(rule: Dict[str, Any]):
    return rule.get("name") or rule.get("id") or rule.get("displayName") or "<unknown>"


def attribute_keys(attributes: Any):
    keys = set()
    for attr in attributes or []:
        for key in ("name", "id", "displayName"):
            value = attr.get(key) if isinstance(attr, dict) else None
            if value not in (None, ""):
                keys.add(str(value))
    return keys


def positive_number(value: Any):
    try:
        return float(value) > 0
    except (TypeError, ValueError):
        return False


def selected_sites(info: Dict[str, Any]):
    sites = info.get("sites") or []
    if isinstance(sites, str):
        return [sites]
    return [str(site) for site in sites if site not in (None, "")]


def site_price_missing(info: Dict[str, Any]):
    missing: List[str] = []
    site_price_map = info.get("siteAndPriceMap") or {}
    if not isinstance(site_price_map, dict):
        return ["siteAndPriceMap"]
    for site in selected_sites(info):
        if is_blank(site_price_map.get(site)):
            missing.append(f"siteAndPriceMap[{site}]")
    return missing


def sale_attribute_issues(info: Dict[str, Any]):
    issues: List[str] = []
    for attr_index, attr in enumerate(info.get("saleAttributes") or []):
        values = attr.get("values") or []
        attr_name = attr.get("name") or attr.get("id") or attr_index
        for value_index, value in enumerate(values):
            sku_key = value.get("skuKey") if isinstance(value, dict) else None
            value_name = value.get("name") or value.get("id") or value_index if isinstance(value, dict) else value_index
            if isinstance(sku_key, str):
                issues.append(f"saleAttributes[{attr_name}].values[{value_name}].skuKey must be int, not hex string")
            elif sku_key is None:
                issues.append(f"saleAttributes[{attr_name}].values[{value_name}].skuKey")
    return issues


def required_attribute_issues(info: Dict[str, Any], product_rules: Any):
    issues: List[str] = []
    present = attribute_keys(info.get("attributes"))
    for rule in product_rules or []:
        if not isinstance(rule, dict) or not is_required(rule) or is_hidden_or_readonly(rule):
            continue
        accepted = {str(value) for value in (rule.get("name"), rule.get("id"), rule.get("displayName")) if value not in (None, "")}
        if present.isdisjoint(accepted):
            issues.append(f"attributes[{rule_key(rule)}]")
    return issues


def title_length_issues(info: Dict[str, Any], setting: Dict[str, Any] | None):
    if not setting:
        return []
    max_title_length = setting.get("maxTitleLength")
    if not max_title_length:
        return []
    try:
        max_title_length = int(max_title_length)
    except (TypeError, ValueError):
        return []
    issues: List[str] = []
    title = info.get("title") or ""
    if len(title) > max_title_length:
        issues.append(f"title length {len(title)} > maxTitleLength {max_title_length}")
    for index, site_title in enumerate(info.get("siteAndTitleList") or []):
        value = site_title.get("title") if isinstance(site_title, dict) else ""
        if len(value or "") > max_title_length:
            site = site_title.get("site") or site_title.get("siteId") or index if isinstance(site_title, dict) else index
            issues.append(f"siteAndTitleList[{site}].title length {len(value or '')} > maxTitleLength {max_title_length}")
    return issues


def unique(items: List[str]):
    seen = set()
    output: List[str] = []
    for item in items:
        if item not in seen:
            seen.add(item)
            output.append(item)
    return output


def readiness_from_info(info: Dict[str, Any], product_rules: Any = None, setting: Dict[str, Any] | None = None):
    missing: List[str] = []
    for field in REQUIRED_INFO_FIELDS:
        if is_blank(info.get(field)):
            missing.append(field)
    missing.extend(site_price_missing(info))
    missing.extend(title_length_issues(info, setting))
    missing.extend(required_attribute_issues(info, product_rules))
    missing.extend(sale_attribute_issues(info))
    sku_map = info.get("skuMap") or {}
    if not sku_map:
        missing.append("skuMap")
    first_sku_key = info.get("firstSkuKey")
    if first_sku_key and isinstance(sku_map, dict) and first_sku_key not in sku_map:
        missing.append("firstSkuKey must match an existing skuMap key")
    for key, sku in sku_map.items():
        for field in REQUIRED_SKU_FIELDS:
            if sku.get(field) in (None, ""):
                missing.append(f"skuMap[{key}].{field}")
        if not sku.get("imgUrls"):
            missing.append(f"skuMap[{key}].imgUrls")
        for field in REQUIRED_DIMENSION_FIELDS:
            if not positive_number(sku.get(field)):
                missing.append(f"skuMap[{key}].{field} must be > 0")
        if sku.get("weight") is not None and not positive_number(sku.get("weight")):
            missing.append(f"skuMap[{key}].weight must be > 0")
    return unique(missing)


def readiness_from_detail(detail: Dict[str, Any]):
    data = detail.get("data") or {}
    return readiness_from_info(
        data.get("siteCollectItemInfo") or {},
        product_rules=data.get("productAttributeRules"),
        setting=data.get("categorySetting") or data.get("setting"),
    )
