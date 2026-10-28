import importlib.util, sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "layout_prompt_pkg", ROOT / "__init__.py",
    submodule_search_locations=[str(ROOT)])
pkg = importlib.util.module_from_spec(spec)
sys.modules["layout_prompt_pkg"] = pkg
spec.loader.exec_module(pkg)

class TestSchema(unittest.TestCase):
    def test_schema(self):
        cls = pkg.NODE_CLASS_MAPPINGS["LayoutPromptBuilder"]
        schema = cls.define_schema()
        self.assertEqual(schema.node_id, "LayoutPromptBuilder")
        self.assertEqual(schema.display_name, "Layout Prompt Builder")
        self.assertEqual([i.id for i in schema.inputs],
                         ["summary", "aspect_ratio", "megapixels", "boxes_json"])
        self.assertEqual([o.display_name for o in schema.outputs],
                         ["width", "height", "prompt"])

    def test_execute(self):
        cls = pkg.NODE_CLASS_MAPPINGS["LayoutPromptBuilder"]
        boxes = ('{"version":1,"boxes":[{"label":"character","caption":"miku",'
                 '"text":"","bbox":[100,200,400,600]}]}')
        out = cls.execute("1girl", "1:1 (Square)", 1.0, boxes)
        self.assertEqual(out.args[0:2], (1024, 1024))
        self.assertIn('"label":"character"', out.args[2])
        self.assertIn('"bbox":[-410,-308,-102,103]', out.args[2])

    def test_no_boxes_is_plain_summary(self):
        cls = pkg.NODE_CLASS_MAPPINGS["LayoutPromptBuilder"]
        out = cls.execute("  hello  ", "1:1 (Square)", 1.0, "")
        self.assertEqual(out.args[2], "  hello  ")

    def test_invalid_boxes_logs_warning(self):
        cls = pkg.NODE_CLASS_MAPPINGS["LayoutPromptBuilder"]
        with self.assertLogs(level="WARNING") as cm:
            out = cls.execute("hello", "1:1 (Square)", 1.0, "not json")
        self.assertEqual(out.args[2], "hello")
        self.assertTrue(any("boxes_json" in message for message in cm.output))

if __name__ == "__main__":
    unittest.main()
