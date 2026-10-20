#!/usr/bin/env python3
"""Offline notice generation from locked Cargo metadata and installed pnpm packages.

Install the frozen pnpm graph and fetch Cargo's locked graph first. Includes build
and target-specific crates and platform-neutral installed npm packages as a conservative
superset of the code and assets redistributed by the desktop bundles.
"""
import hashlib
import json
import re
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
TEXTS = Path(__file__).resolve().parent / 'license-texts'
# Canonical source archives (kept verbatim): serde 1.0.229 (MIT/Apache-2.0),
# alloc-no-stdlib 3.0.0 (BSD-3-Clause), libloading 0.7.4 (ISC), cssparser
# 0.37.0 (MPL-2.0), unicode-ident 1.0.27 (Unicode-3.0), tinyvec 1.13.3
# (Zlib), @fontsource-variable/jetbrains-mono 5.3.0 (OFL-1.1).
PREFIXES = ('license', 'licence', 'copying', 'copyright', 'notice', 'unlicense')
# License names can contain dots that are not file extensions (LICENSE.MIT,
# LICENSE-APACHE-2.0). Exclude code and SPDX metadata, not unknown suffixes.
NON_NOTICE_SUFFIXES = {
    '.rs', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx',
    '.svelte', '.vue', '.py', '.c', '.h', '.cc', '.cpp', '.hpp', '.go',
    '.json', '.toml', '.yaml', '.yml', '.css', '.scss', '.map', '.spdx',
    '.svg', '.png', '.jpg', '.woff', '.woff2', '.ttf', '.wasm',
}
EXCLUDED_DIRECTORIES = {'node_modules', 'target', '.git', 'vendor', 'test', 'tests'}


def notices(directory):
    return [p for p in sorted(directory.rglob('*'))
            if p.is_file() and not p.is_symlink()
            and p.name.lower().startswith(PREFIXES)
            and p.suffix.lower() not in NON_NOTICE_SUFFIXES
            and not any(part.lower() in EXCLUDED_DIRECTORIES for part in p.relative_to(directory).parts[:-1])]


def generate():
    metadata = json.loads(subprocess.check_output(
        ['cargo', 'metadata', '--offline', '--locked', '--format-version', '1'], cwd=ROOT / 'src-tauri'))
    packages = []
    for package in metadata['packages']:
        if package['name'] == 'hamlet-editor':
            continue
        packages.append(('Rust', package['name'], package['version'], package.get('license'),
                         ', '.join(package['authors']), package.get('repository'),
                         Path(package['manifest_path']).parent))
    installed = ROOT / 'node_modules/.pnpm'
    if not installed.is_dir():
        raise SystemExit('Install pnpm dependencies with the frozen lockfile first')
    # pnpm package-table keys have no peer suffix. Read only these two-space
    # keys, not dependency names deeper in the YAML. This also excludes stale
    # package directories left behind by an earlier install.
    locked = set()
    in_packages = False
    for line in (ROOT / 'pnpm-lock.yaml').read_text().splitlines():
        if line and not line.startswith(' '):
            in_packages = line == 'packages:'
        if in_packages:
            match = re.fullmatch(r"  (?:'([^']+)'|\"([^\"]+)\"|([^ :]+)):", line)
            if match:
                locked.add(next(group for group in match.groups() if group))
    seen = set()
    for manifest in sorted(installed.glob('*/node_modules/**/package.json')):
        # Only package roots, never examples or vendored fixture packages.
        relative = manifest.relative_to(installed).parts
        if len(relative) not in (4, 5) or (len(relative) == 5 and not relative[2].startswith('@')):
            continue
        package = json.loads(manifest.read_text())
        key = (package.get('name'), package.get('version'))
        if not all(key) or key in seen or f'{key[0]}@{key[1]}' not in locked:
            continue
        # Native build tools are host-specific and are not shipped in bundles.
        if package.get('os') or package.get('cpu'):
            continue
        seen.add(key)
        author = package.get('author', '')
        if isinstance(author, dict):
            author = author.get('name', '')
        repository = package.get('repository', '')
        if isinstance(repository, dict):
            repository = repository.get('url', '')
        packages.append(('npm', *key, package.get('license'), author, repository, manifest.parent))
    project = json.loads((ROOT / 'package.json').read_text())
    for name in project['dependencies'] | project['devDependencies']:
        manifest = ROOT / 'node_modules' / name / 'package.json'
        installed_package = json.loads(manifest.read_text())
        if (name, installed_package['version']) not in seen:
            raise SystemExit(f'Direct dependency missing from locked notice set: {name}')
    texts = {}
    rows = []
    for ecosystem, name, version, license_id, author, repository, directory in sorted(packages, key=lambda p: p[:3]):
        refs = []
        has_license = False
        for notice in notices(directory):
            has_license |= notice.name.lower().startswith(('license', 'licence', 'copying', 'unlicense'))
            content = notice.read_text(errors='replace').strip() + '\n'
            digest = hashlib.sha256(content.encode()).hexdigest()[:16]
            texts[digest] = content
            refs.append(f'{notice.relative_to(directory)}: {digest}')
        # Canonical full texts cover packages whose archives omit license files.
        # Package attribution above stays separate from canonical license text.
        if not license_id and refs:
            license_id = 'See bundled package license notice'
        if not license_id:
            raise SystemExit(f'Missing license metadata: {ecosystem} {name} {version}')
        if not has_license:
            # Copyright/NOTICE attribution alone is not a full license.
            # Each AND clause must have a full canonical license available;
            # an OR clause needs only one of the offered alternatives.
            for clause in license_id.split(' AND '):
                if not any(re.search(r'(?<![\w-])' + re.escape(path.name) + r'(?![\w-])', clause)
                           for path in TEXTS.iterdir() if path.is_file()):
                    raise SystemExit(f'Add canonical license text for {name}: {license_id}')
        rows.append(f'## {ecosystem}: {name} {version}\n\nLicense: {license_id}\n\n'
                    f'Authors: {author or "See package notices/source"}\n\nSource: {repository or "See package registry"}\n\n'
                    + ('Notices: ' + '; '.join(refs) if refs else 'Full license text: see canonical texts below.') + '\n')
    canonical = []
    for path in sorted(TEXTS.iterdir()):
        if path.is_file():
            canonical.append(f'## {path.name}\n\n{path.read_text().strip()}\n')
    output = '# Third-party licenses\n\nGenerated by `.github/scripts/generate-licenses.py`.\n\n'
    output += ('Includes the locked Rust graph for all targets and platform-neutral installed npm packages, including build tools. '
               'License expressions list upstream alternatives; when no archive notice is supplied, '
               'the canonical MIT or Apache-2.0 alternative applies where offered. '
               'MPL-2.0 sources are available at the crate repository/registry links.\n\n')
    output += '\n'.join(rows) + '\n# Canonical full license texts\n\n' + '\n'.join(canonical)
    output += '\n# Package notice texts\n\n'
    output += '\n'.join(f'## {digest}\n\n{content}' for digest, content in sorted(texts.items()))
    (ROOT / 'THIRD_PARTY_LICENSES.md').write_text(output)
    print(f'Generated notices for {len(packages)} packages, {len(texts)} distinct notice texts')


if __name__ == '__main__':
    generate()
