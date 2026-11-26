"""Validate generated art, HTML references and the Yandex upload archive."""
from argparse import ArgumentParser
from hashlib import sha256
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath
from struct import unpack
from zipfile import ZIP_DEFLATED, ZipFile
import json
import re

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'
ART_REFRESH_DIRS = {'items', 'shelves', 'logo', 'ui'}
ART_REFRESH_PLACEHOLDERS = {f'assets/art-refresh/{folder}/.gitkeep' for folder in ART_REFRESH_DIRS}
MANIFEST = ROOT / 'src/audio/AudioAssets.json'
AUDIO_HASHES = ROOT / 'docs/audio.sha256.json'
GOODS = 'jam tea honey cocoa pear apple lemon soda soap candle milk flour mint cookie'.split()
ART = {**dict.fromkeys(GOODS, (192, 192)), 'wallpaper': (288, 288), 'shelf': (432, 272),
       'shop': (832, 514), 'victory': (424, 412),
       'wordmark-ru': (1200, 426), 'wordmark-en': (1200, 426)}
FONT_LICENSES = {'assets/font-licenses/nunito-OFL.txt'}
FONT_FILE = re.compile(r'assets/nunito-(latin|cyrillic)-[a-zA-Z0-9_.-]+\.woff2')
ART.update({f'control-{name}': (96, 96) for name in ('undo', 'restart', 'hint')})
ART_REFRESH = {f'assets/art-refresh/items/{name}.webp' for name in GOODS} | {
    'assets/art-refresh/shelves/shelf.webp', 'assets/art-refresh/logo/wordmark-ru.webp',
    'assets/art-refresh/logo/wordmark-en.webp', 'assets/art-refresh/ui/shop.webp', 'assets/art-refresh/ui/victory.webp',
}


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
    manifest = json.loads(MANIFEST.read_text())
    require(type(manifest['enabled']) is bool, 'Invalid audio activation flag')
    entries = manifest['files']
    require(len(entries) == 8, 'Expected eight audio manifest entries')
    files = {f'assets/audio/{name}' for name in entries.values()}
    require(len(files) == 7 and all(re.fullmatch(r'assets/audio/[a-zA-Z0-9_-]+\.ogg', name) for name in files),
            'Expected seven distinct OGG files in the audio manifest')
    if not manifest['enabled']:
        return {}
    hashes = {f'assets/audio/{name}': digest for name, digest in json.loads(AUDIO_HASHES.read_text()).items()}
    require(files == hashes.keys(), 'Audio manifest and SHA-256 registry differ')
    return hashes


def verify(names, read, audio, refresh):
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
    require(refresh <= names, f'Missing installed WebP: {sorted(refresh - names)}')
    for location in refresh:
        data = read(location)
        require(len(data) >= 20 and data[:4] == b'RIFF' and data[8:12] == b'WEBP'
                and unpack('<I', data[4:8])[0] == len(data) - 8, f'Invalid WebP: {location}')
    fonts = [name for name in names if FONT_FILE.fullmatch(name)]
    require(sorted(FONT_FILE.fullmatch(name)[1] for name in fonts) == ['cyrillic', 'latin'],
            'The release needs the Latin and Cyrillic Nunito font subsets')
    require(all(read(name).startswith(b'wOF2') for name in fonts), 'Invalid WOFF2 file')
    require(FONT_LICENSES <= names, 'Missing font licenses')
    actual_audio = {name for name in names if name.startswith('assets/audio/') and name != 'assets/audio/README.md'}
    require(actual_audio == audio.keys(), f'Audio files differ from manifest: {sorted(actual_audio ^ audio.keys())}')
    for name, expected in audio.items():
        require(sha256(read(name)).hexdigest() == expected, f'Wrong audio SHA-256: {name}')


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument('--zip', action='store_true', help='Create and verify yandex-upload-ready.zip')
    args = parser.parse_args()
    audio = allowed_audio()
    refresh = {name for name in ART_REFRESH if (ROOT / 'public' / name).is_file()}
    files = {p.relative_to(DIST).as_posix(): p for p in DIST.rglob('*') if p.is_file()}
    names = set(files)
    verify(names, lambda name: files[name].read_bytes(), audio, refresh)
    print(f'Validated {len(ART)} PNG assets, {len(refresh)} installed WebP assets, index.html and SHA-256 of {len(audio)} OGG files')
    if not args.zip:
        return
    release = names - {'assets/audio/README.md'} - ART_REFRESH_PLACEHOLDERS
    for name in release:
        compiled = bool(re.fullmatch(r'assets/[a-zA-Z0-9_.-]+\.(js|css)', name))
        raster = name in {f'assets/art/{asset}.png' for asset in ART} or name in refresh
        require(name == 'index.html' or compiled or raster or name in audio or name in FONT_LICENSES or FONT_FILE.fullmatch(name), f'Unexpected ZIP entry: {name}')
        require(not files[name].is_symlink(), f'Symlink in release: {name}')
    path = ROOT / 'yandex-upload-ready.zip'
    with ZipFile(path, 'w', ZIP_DEFLATED, compresslevel=9) as archive:
        for name in sorted(release):
            archive.write(files[name], name)
    with ZipFile(path) as archive:
        require(archive.testzip() is None, 'CRC check failed')
        require(set(archive.namelist()) == release, 'ZIP contents differ from the validated build')
        verify(release, archive.read, audio, refresh)
    print(f'Verified {path.name} ({path.stat().st_size:,} bytes, {len(release)} files)')


if __name__ == '__main__':
    main()
