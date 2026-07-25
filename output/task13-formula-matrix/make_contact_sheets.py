from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).parent
MODES = ['word-native', 'eq-field', 'mathtype-compatible', 'latex-vector']

def make_sheet(position, render_root, output_prefix):
    images = []
    for mode in MODES:
        for page in [1, 2]:
            source = render_root / f'{mode}__{position}' / f'page-{page}.png'
            image = Image.open(source).convert('RGB')
            image.thumbnail((620, 877))
            images.append((f'{mode} / {position} / page {page}', image.copy()))
    sheet = Image.new('RGB', (4 * 650, 2 * 930), 'white')
    draw = ImageDraw.Draw(sheet)
    for index, (label, image) in enumerate(images):
        x = (index % 4) * 650 + 15
        y = (index // 4) * 930 + 40
        draw.text((x, y - 25), label, fill='black')
        sheet.paste(image, (x, y))
    sheet.save(ROOT / f'{output_prefix}-contact-{position}.png')

for position in ['end', 'after-each']:
    make_sheet(position, ROOT / 'pdf-renders', 'pdf')
    make_sheet(position, ROOT / 'word-page-renders', 'word')
