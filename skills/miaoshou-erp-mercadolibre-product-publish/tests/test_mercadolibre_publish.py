import importlib.util
import sys
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPT_DIR))


def load_publish():
    spec = importlib.util.spec_from_file_location(
        "mercadolibre_publish",
        SCRIPT_DIR / "mercadolibre_publish.py",
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class MercadoLibrePublishTests(unittest.TestCase):
    def test_readiness_from_detail_flags_missing_sku_fields(self):
        publish = load_publish()
        detail = {"data": {"siteCollectItemInfo": {"title": "T", "skuMap": {";a;": {"price": 10}}}}}

        missing = publish.readiness_from_detail(detail)

        self.assertIn("notes", missing)
        self.assertNotIn("skuMap[;a;].price", missing)
        self.assertIn("skuMap[;a;].stock", missing)
        self.assertIn("skuMap[;a;].itemNum", missing)
        self.assertIn("skuMap[;a;].imgUrls", missing)

    def test_parse_ids_accepts_csv(self):
        spec = importlib.util.spec_from_file_location("mercadolibre_client", SCRIPT_DIR / "mercadolibre_client.py")
        client = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(client)

        self.assertEqual(client.parse_ids("10, 20"), [10, 20])


if __name__ == "__main__":
    unittest.main()
