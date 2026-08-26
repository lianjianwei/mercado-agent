import importlib.util
import sys
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPT_DIR))


def load_module(name):
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class MercadoLibreCategoryTests(unittest.TestCase):
    def test_required_tag_accepts_bool_and_string(self):
        category = load_module("mercadolibre_category")

        self.assertTrue(category.is_required({"tags": {"required": True}}))
        self.assertTrue(category.is_required({"tags": {"required": "true"}}))
        self.assertFalse(category.is_required({"tags": {"required": False}}))
        self.assertFalse(category.is_required({"tags": {}}))

    def test_parse_ids_ignores_empty_parts(self):
        client = load_module("mercadolibre_client")

        self.assertEqual(client.parse_ids("1, 2,,3"), [1, 2, 3])

    def test_iter_category_nodes_flattens_tree_with_paths(self):
        category = load_module("mercadolibre_category")
        tree = {
            "1": {
                "cid": 1,
                "name": "Apparel",
                "nameChinese": "服饰",
                "isLastLevel": "false",
                "children": {
                    "2": {
                        "cid": 2,
                        "name": "Dresses",
                        "nameChinese": "连衣裙",
                        "isLastLevel": "true",
                        "children": {},
                    }
                },
            }
        }

        nodes = list(category.iter_category_nodes(tree))

        self.assertEqual(nodes[1]["cid"], 2)
        self.assertTrue(nodes[1]["isLastLevel"])
        self.assertEqual(nodes[1]["pathText"], "服饰 > 连衣裙")

    def test_search_category_tree_matches_leaf_keyword(self):
        category = load_module("mercadolibre_category")
        tree = {
            "1": {
                "cid": 1,
                "name": "Apparel",
                "nameChinese": "服饰",
                "isLastLevel": "false",
                "children": {
                    "2": {
                        "cid": 2,
                        "name": "Dresses",
                        "nameChinese": "连衣裙",
                        "isLastLevel": "true",
                        "disabled": False,
                    },
                    "3": {
                        "cid": 3,
                        "name": "Sports Dresses",
                        "nameChinese": "运动连衣裙",
                        "isLastLevel": "true",
                        "disabled": True,
                    },
                },
            }
        }

        candidates = category.search_category_tree(tree, "连衣裙", leaf_only=True)

        self.assertEqual([item["cid"] for item in candidates], [2])


if __name__ == "__main__":
    unittest.main()
