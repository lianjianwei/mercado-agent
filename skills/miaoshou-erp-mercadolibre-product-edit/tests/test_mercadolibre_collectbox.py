import importlib.util
import json
import os
import sys
import unittest
from argparse import Namespace
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPT_DIR))


def load_collectbox():
    spec = importlib.util.spec_from_file_location(
        "mercadolibre_collectbox",
        SCRIPT_DIR / "mercadolibre_collectbox.py",
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class MercadoLibreCollectboxTests(unittest.TestCase):
    def test_readiness_reports_missing_info_and_sku_fields(self):
        collectbox = load_collectbox()
        missing = collectbox.readiness_from_info({"skuMap": {";a;": {"stock": 3}}})

        self.assertIn("title", missing)
        self.assertNotIn("skuMap[;a;].price", missing)
        self.assertIn("skuMap[;a;].itemNum", missing)
        self.assertIn("skuMap[;a;].imgUrls", missing)
        self.assertIn("skuMap[;a;].length must be > 0", missing)

    def test_readiness_accepts_cbt_site_prices_without_sku_price(self):
        collectbox = load_collectbox()
        info = {
            "title": "Sample",
            "notes": "Description",
            "cid": 123,
            "shopId": 456,
            "sites": ["BR"],
            "siteAndTitleList": [{"site": "BR", "title": "Sample"}],
            "siteAndListingTypeList": [{"site": "BR", "listingType": "gold_special"}],
            "siteAndPriceMap": {"BR": 10},
            "price": 10,
            "pricingMode": "sellPrice",
            "warrantyType": "noWarranty",
            "warrantyTime": 0,
            "warrantyTimeUnit": "day",
            "firstSkuKey": ";52055;",
            "skuMap": {
                ";52055;": {
                    "stock": 3,
                    "itemNum": "SKU-1",
                    "imgUrls": ["https://example.com/a.jpg"],
                    "length": 30,
                    "width": 20,
                    "height": 15,
                }
            },
        }

        missing = collectbox.readiness_from_info(info)

        self.assertNotIn("skuMap[;52055;].price", missing)
        self.assertFalse(missing)

    def test_readiness_reports_required_attribute_and_hex_sku_key(self):
        collectbox = load_collectbox()
        info = {
            "title": "Sample",
            "notes": "Description",
            "cid": 123,
            "shopId": 456,
            "sites": ["BR"],
            "siteAndTitleList": [{"site": "BR", "title": "Sample"}],
            "siteAndListingTypeList": [{"site": "BR", "listingType": "gold_special"}],
            "siteAndPriceMap": {"BR": 10},
            "price": 10,
            "pricingMode": "sellPrice",
            "warrantyType": "noWarranty",
            "warrantyTime": 0,
            "warrantyTimeUnit": "day",
            "firstSkuKey": ";52055;",
            "saleAttributes": [{"name": "Color", "values": [{"name": "Black", "skuKey": "104bf393"}]}],
            "skuMap": {
                ";52055;": {
                    "stock": 3,
                    "itemNum": "SKU-1",
                    "imgUrls": ["https://example.com/a.jpg"],
                    "length": 30,
                    "width": 20,
                    "height": 15,
                }
            },
        }

        missing = collectbox.readiness_from_info(
            info,
            product_rules=[{"id": "BRAND", "name": "Brand", "tags": {"required": True}}],
        )

        self.assertIn("attributes[Brand]", missing)
        self.assertIn("saleAttributes[Color].values[Black].skuKey must be int, not hex string", missing)

    def test_normalize_payload_converts_safe_detail_shapes(self):
        collectbox = load_collectbox()
        payload = {
            "detailId": 123,
            "siteCollectItemInfo": {
                "title": "Sample",
                "notes": "Description",
                "cid": 123,
                "shopId": 456,
                "sites": ["BR"],
                "siteAndTitleList": [{"site": "BR", "title": "Sample"}],
                "siteAndListingTypeList": [{"site": "BR", "listingType": "gold_special"}],
                "siteAndPriceMap": {"BR": 10},
                "price": 10,
                "pricingMode": "sellPrice",
                "warrantyType": "noWarranty",
                "warrantyTime": 0,
                "warrantyTimeUnit": "day",
                "firstSkuKey": ";104bf393;",
                "attributes": [{"id": "BRAND", "values": [2026]}],
                "saleAttributes": [{"name": "Color", "values": [{"name": "Black", "id": 52055, "skuKey": "104bf393"}]}],
                "skuMap": {
                    ";104bf393;": {
                        "stock": 3,
                        "itemNum": "SKU-1",
                        "imgUrls": ["https://example.com/a.jpg"],
                        "length": 30,
                        "width": 20,
                        "height": 15,
                    }
                },
            },
        }

        result = collectbox.normalize_payload(
            payload,
            product_rules=[{"id": "BRAND", "name": "Brand", "tags": {"required": True}}],
        )

        info = result["payload"]["siteCollectItemInfo"]
        self.assertTrue(result["changed"])
        self.assertEqual(info["attributes"][0]["name"], "Brand")
        self.assertEqual(info["attributes"][0]["values"], [{"name": "2026"}])
        self.assertEqual(info["saleAttributes"][0]["values"][0]["skuKey"], 52055)
        self.assertIn(";52055;", info["skuMap"])
        self.assertEqual(info["firstSkuKey"], ";52055;")
        self.assertFalse(
            collectbox.readiness_from_info(
                info,
                product_rules=[{"id": "BRAND", "name": "Brand", "tags": {"required": True}}],
            )
        )

    def test_normalize_payload_warns_when_sku_key_cannot_be_mapped(self):
        collectbox = load_collectbox()
        result = collectbox.normalize_payload(
            {
                "siteCollectItemInfo": {
                    "warrantyType": "noWarranty",
                    "saleAttributes": [{"name": "Color", "values": [{"name": "Black", "skuKey": "104bf393"}]}],
                }
            }
        )

        self.assertFalse(result["changed"])
        self.assertIn("cannot convert string skuKey", result["warnings"][0])

    def test_load_payload_wraps_site_collect_item_info(self):
        collectbox = load_collectbox()
        from tempfile import TemporaryDirectory

        with TemporaryDirectory() as tmp_dir:
            payload_path = Path(tmp_dir) / "payload.json"
            payload_path.write_text(json.dumps({"title": "Sample"}), encoding="utf-8")
            args = Namespace(payload=str(payload_path), detail_id=123)

            payload = collectbox.load_payload(args, wrap=True)

        self.assertEqual(payload, {"detailId": 123, "siteCollectItemInfo": {"title": "Sample"}})

    def test_json_mode_treats_raw_and_json_as_machine_output(self):
        collectbox = load_collectbox()

        self.assertTrue(collectbox.json_mode(Namespace(raw=True, json=False)))
        self.assertTrue(collectbox.json_mode(Namespace(raw=False, json=True)))
        self.assertFalse(collectbox.json_mode(Namespace(raw=False, json=False)))

    def test_client_loads_config_from_explicit_config_path(self):
        spec = importlib.util.spec_from_file_location("mercadolibre_client", SCRIPT_DIR / "mercadolibre_client.py")
        client = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(client)
        from tempfile import TemporaryDirectory

        with TemporaryDirectory() as tmp_dir:
            config_path = Path(tmp_dir) / "config.json"
            config_path.write_text(json.dumps({"app_key": "k", "app_secret": "s"}), encoding="utf-8")
            old_env = {key: os.environ.get(key) for key in ("MIAOSHOU_CONFIG_PATH", "MIAOSHOU_APP_KEY", "MIAOSHOU_APP_SECRET", "MIAOSHOU_BASE_URL")}
            os.environ["MIAOSHOU_CONFIG_PATH"] = str(config_path)
            os.environ.pop("MIAOSHOU_APP_KEY", None)
            os.environ.pop("MIAOSHOU_APP_SECRET", None)
            os.environ.pop("MIAOSHOU_BASE_URL", None)
            try:
                config = client.load_config(Path(tmp_dir) / "skill")
            finally:
                for key, value in old_env.items():
                    if value is None:
                        os.environ.pop(key, None)
                    else:
                        os.environ[key] = value

        self.assertEqual(config["app_key"], "k")
        self.assertEqual(config["app_secret"], "s")


if __name__ == "__main__":
    unittest.main()
