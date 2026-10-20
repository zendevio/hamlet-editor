"""Regression tests for package notice discovery. Run with python3 -I."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    'generate_licenses', Path(__file__).with_name('generate-licenses.py'))
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)


class NoticeDiscoveryTests(unittest.TestCase):
    def test_license_names_and_nested_notices_survive_source_filter(self):
        included = {
            'LICENSE-APACHE-2.0', 'LICENSE_APACHE-2.0', 'license-apache-2.0',
            'LICENSE-Apache-2.0_WITH_LLVM-exception', 'LICENSE.MIT',
            'LICENSE.BSD-3-Clause', 'LICENSE', 'NOTICE.txt',
            'src/unicode_tables/LICENSE-UNICODE', 'src/spin/LICENSE',
        }
        excluded = {
            'src/copying.rs', 'src/Copyright.svelte', 'src/License.d.ts',
            'src/LICENSE.js', 'src/Copyright.svg', 'LICENSE.spdx',
            'vendor/dependency/LICENSE', 'tests/LICENSE', 'test/LICENSE',
            'node_modules/dependency/LICENSE', 'target/LICENSE', '.git/LICENSE',
        }
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name in included | excluded:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('Notice text\n')
            (root / 'LICENSE-link').symlink_to(root / 'LICENSE')
            self.assertEqual(
                {str(path.relative_to(root)) for path in generator.notices(root)},
                included)


if __name__ == '__main__':
    unittest.main()
