"""Validate generated art, HTML references and the Yandex upload archive."""
from argparse import ArgumentParser
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath
from struct import unpack
from zipfile import ZIP_DEFLATED, ZipFile
import re

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'
MANIFEST = ROOT / 'src/audio/AudioAssetManifest.ts'
GOODS = 'jam tea honey cocoa pear apple lemon soda soap candle milk flour mint cookie'.split()
ART = {**dict.fromkeys(GOODS, (192, 192)), 'wallpaper': (960, 1600), 'shelf': (432, 272),
       'shop': (832, 514), 'victory': (424, 412), 'paper': (880, 880)}
ART.update({f'button-{name}': (720, 144) for name in ('green', 'paper', 'red', 'muted')})


class EntryPage(HTMLParser):
    def __init__(self):
        super().__init__()
        self.references = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'script' and 'src' in attrs:
            self.references.append(attrs['src'])
        if tag == 'link' and attrs.get('rel') in ('stylesheet', 'modulepreload'):
            self.references.append(attrs['href'])


def require(condition, problem):
    if not condition:
        raise SystemExit(problem)


def allowed_audio():
    entries = re.findall(r"file: '([^']+)', enabled: (true|false)", MANIFEST.read_text())
    require(len(entries) == 8, 'Expected eight audio manifest entries')
    enabled = {f'assets/audio/{name}' for name, flag in entries if flag == 'true'}
    require(all(re.fullmatch(r'assets/audio/[a-zA-Z0-9_-]+\.(ogg|mp3|wav|m4a|aac)', name) for name in enabled),
            'Invalid audio manifest filename')
    return enabled


def verify(names, read, audio):
    require('index.html' in names, 'Missing root index.html')
    require(all('/sdk.js' not in '/' + name for name in names), 'SDK must not be shipped in the ZIP')
    page = EntryPage()
    page.feed(read('index.html').decode('utf-8'))
    require(any(url.endswith('.js') for url in page.references), 'Missing entry script')
    for url in page.references:
        path = PurePosixPath(url)
        require(not path.is_absolute() and '..' not in path.parts and ':' not in url
                and str(path) in names, f'Invalid index.html reference: {url}')
    for name, expected in ART.items():
        location = f'assets/art/{name}.png'
        require(location in names, f'Missing raster asset: {location}')
        header = read(location)[:24]
        require(header.startswith(b'\x89PNG\r\n\x1a\n') and header[12:16] == b'IHDR'
                and unpack('>II', header[16:24]) == expected, f'Wrong PNG dimensions: {location}')
    require(audio <= names, f'Missing installed audio: {sorted(audio - names)}')


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument('--zip', action='store_true', help='Create and verify yandex-upload-ready.zip')
    args = parser.parse_args()
    audio = allowed_audio()
    files = {p.relative_to(DIST).as_posix(): p for p in DIST.rglob('*') if p.is_file()}
    names = set(files)
    verify(names, lambda name: files[name].read_bytes(), audio)
    print(f'Validated {len(ART)} PNG assets, index.html and the enabled audio manifest')
    if not args.zip:
        return
    release = set(names) - {'assets/audio/README.md'}
    for name in release:
        compiled = bool(re.fullmatch(r'assets/[a-zA-Z0-9_.-]+\.(js|css)', name))
        raster = name in {f'assets/art/{asset}.png' for asset in ART}
        require(name == 'index.html' or compiled or raster or name in audio, f'Unexpected ZIP entry: {name}')
        require(not files[name].is_symlink(), f'Symlink in release: {name}')
    path = ROOT / 'yandex-upload-ready.zip'
    with ZipFile(path, 'w', ZIP_DEFLATED, compresslevel=9) as archive:
        for name in sorted(release):
            archive.write(files[name], name)
    with ZipFile(path) as archive:
        require(archive.testzip() is None, 'CRC check failed')
        require(set(archive.namelist()) == release, 'ZIP contents differ from the validated build')
        verify(release, archive.read, audio)
    print(f'Verified {path.name} ({path.stat().st_size:,} bytes, {len(release)} files)')


if __name__ == '__main__':
    main()
