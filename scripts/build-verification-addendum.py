#!/usr/bin/env python3
"""Append a dated verification card without altering the recorded narration.

Usage: python3 scripts/build-verification-addendum.py ORIGINAL.mp4 VERIFY.log OUTPUT.mp4
Requires Pillow, ffmpeg and the local Inter fonts used by the original film.
"""
from pathlib import Path
import re
import subprocess
import sys
from PIL import Image, ImageDraw, ImageFont

original, log_path, output = map(lambda p: Path(p).resolve(), sys.argv[1:])
log = re.sub(r'\x1b\[[0-9;]*m', '', log_path.read_text())
checks = ['8 passed (8)', '10 passed (10)', '53 passed | 1 skipped (54)',
          'RelayLab production smoke passed', 'found 0 vulnerabilities']
if not all(item in log for item in checks):
    raise SystemExit('Expected verification evidence is absent; refusing to render a pass card.')
if original == output:
    raise SystemExit('Preserve the original recording: choose another output file.')
output.parent.mkdir(parents=True, exist_ok=True)
fonts = Path.home() / 'Library/Fonts'
def font(size, weight='400Regular'):
    return ImageFont.truetype(str(fonts / f'Inter_{weight}.ttf'), size)
canvas = Image.new('RGB', (1920, 1080), '#101c28')
draw = ImageDraw.Draw(canvas)
draw.text((100, 70), 'RELAYLAB  /  VERIFICATION UPDATE  /  20 SEPTEMBER 2026', font=font(28,'600SemiBold'), fill='#89bfda')
draw.text((100, 140), 'Three boundary failures repaired.', font=font(64,'700Bold'), fill='#ffffff')
for y, text in zip([275, 345, 415], [
    'Same retry key stays isolated between experiments.',
    'A reply naming the wrong experiment is rejected.',
    'A reply containing both result and error is rejected.',
]):
    draw.text((100,y), text, font=font(37), fill='#e1e9ee')
draw.rounded_rectangle((100, 530, 1820, 805), radius=16, fill='#1c3041')
draw.text((135,560), 'npm run verify  /  LOCAL RESULTS', font=font(25,'600SemiBold'), fill='#89bfda')
for y, text in zip([615,665,715,760], [
    'Tests: 8 client + 10 downstream + 53 coordinator passed',
    'Live MySQL: 1 skipped (credential-free verification)',
    'Production smoke: restart persistence verified',
    'Production dependency audit: found 0 vulnerabilities',
]):
    draw.text((135,y), text, font=font(29), fill='#ffffff')
draw.text((100, 855), 'Type checks and all production builds also passed.', font=font(30,'600SemiBold'), fill='#b4e2c7')
draw.text((100, 918), 'Earlier footage retains its original dates; retry deduplication is process-local.', font=font(26), fill='#bccbd5')
draw.text((100, 995), 'COMP713  /  MAXWELL YOUNG  /  23213801', font=font(25), fill='#89bfda')
card = output.parent / 'verification-addendum.png'
canvas.save(card)
segment = output.parent / 'verification-addendum.mp4'
subprocess.run(['ffmpeg','-y','-v','error','-loop','1','-i',str(card),
    '-f','lavfi','-i','anullsrc=r=48000:cl=mono','-t','18','-r','30',
    '-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p',
    '-c:a','aac','-b:a','160k',str(segment)],check=True)
# Stream copy preserves the original picture and authentic narration byte-for-byte.
listing = output.parent / 'addendum-concat.txt'
if any("'" in str(p) for p in [original, segment]):
    raise SystemExit('Paths with single quotes are not supported by the concat list.')
listing.write_text(f"file '{original}'\nfile '{segment}'\n")
subprocess.run(['ffmpeg','-y','-v','error','-f','concat','-safe','0','-i',str(listing),
    '-c','copy','-movflags','+faststart',str(output)],check=True)
print(output)
