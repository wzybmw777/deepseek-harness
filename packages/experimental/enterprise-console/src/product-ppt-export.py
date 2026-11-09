"""Validate bounded SVG input, then use the installed PPT Master release pipeline."""

import json
import os
from pathlib import Path
import resource
import shutil
import subprocess
import sys
from defusedxml import ElementTree


def main():
    skill = Path(sys.argv[1]).resolve(strict=True)
    destination = Path(sys.argv[2]).resolve(strict=True)
    resource.setrlimit(resource.RLIMIT_CPU, (150, 150))
    resource.setrlimit(resource.RLIMIT_AS, (2 * 1024**3, 2 * 1024**3))
    resource.setrlimit(resource.RLIMIT_FSIZE, (100 * 1024**2, 100 * 1024**2))
    raw = sys.stdin.buffer.read(2 * 1024**2 + 1)
    if len(raw) > 2 * 1024**2:
        raise ValueError('Deck input exceeded size limit')
    payload = json.loads(raw)
    slides = payload['slides']
    if not isinstance(slides, list) or not 3 <= len(slides) <= 6:
        raise ValueError('This executor accepts 3 to 6 slides')
    allowed = {'svg', 'g', 'rect', 'circle', 'ellipse', 'line', 'text', 'tspan', 'defs', 'linearGradient', 'stop'}
    for slide in slides:
        svg = slide['svg']
        if not isinstance(svg, str) or len(svg) > 200_000:
            raise ValueError('Invalid SVG input size')
        root = ElementTree.fromstring(svg, forbid_dtd=True, forbid_entities=True, forbid_external=True)
        if root.tag != '{http://www.w3.org/2000/svg}svg' or root.get('viewBox') != '0 0 1280 720':
            raise ValueError('Invalid SVG root or canvas')
        if sum(1 for _ in root.iter()) > 2000:
            raise ValueError('SVG element limit exceeded')
        for node in root.iter():
            name = node.tag.removeprefix('{http://www.w3.org/2000/svg}')
            if name not in allowed:
                raise ValueError('Unsupported SVG element: ' + name)
            for attribute, value in node.attrib.items():
                if attribute.startswith('on') or 'href' in attribute or attribute in {'style', 'class'}:
                    raise ValueError('Unsupported SVG attribute')
                if 'url(' in value and not value.startswith('url(#'):
                    raise ValueError('External SVG resource')
    environment = dict(os.environ, PYTHONDONTWRITEBYTECODE='1')

    def run(script, *arguments):
        completed = subprocess.run([sys.executable, str(skill / 'scripts' / script), *map(str, arguments)],
                                   capture_output=True, text=True, timeout=120, env=environment, cwd=destination)
        with (destination / 'export.log').open('a', encoding='utf-8') as log:
            log.write(completed.stdout + completed.stderr)
        if completed.returncode:
            raise RuntimeError(script + ': ' + (completed.stdout + completed.stderr)[-1800:])

    run('attribution_guard.py')
    run('project_manager.py', 'init', 'presentation', '--dir', destination, '--quick-generate')
    projects = [path for path in destination.iterdir() if path.is_dir() and (path / 'svg_output').is_dir()]
    if len(projects) != 1:
        raise ValueError('Expected one newly initialized project')
    project = projects[0]
    for index, slide in enumerate(slides, 1):
        (project / 'svg_output' / f'{index:02d}_slide.svg').write_text(slide['svg'], encoding='utf-8')
    run('svg_quality_checker.py', project, '--quick-generate', '--canonical-authoring', '--stage', 'final', '--json')
    run('svg_to_pptx.py', project, '--quick-generate', '--no-notes')
    exports = list((project / 'exports').glob('*.pptx'))
    if len(exports) != 1:
        raise ValueError('PPT Master did not publish exactly one deck')
    reports = list((project / 'validation').glob('*.report.json'))
    if len(reports) != 1:
        raise ValueError('PPT Master postflight report missing')
    report = json.loads(reports[0].read_text(encoding='utf-8'))
    # Postflight status is checked in addition to the exporter exit status.
    if report.get('status') not in {'passed', 'passed-with-warnings'}:
        raise ValueError('PPT Master postflight did not pass')
    shutil.copyfile(exports[0], destination / 'presentation.pptx')
    print(json.dumps({'artifact': 'presentation.pptx', 'slides': len(slides), 'status': report['status']}))


if __name__ == '__main__':
    main()
