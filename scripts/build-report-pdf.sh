#!/bin/sh
# Build the submission report as DOCX and then PDF.
# Usage: scripts/build-report-pdf.sh [output-directory]
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
out=${1:-"$root/output/report"}
name="RelayLab-Report-23213801-Maxwell-Young"
mkdir -p "$out"
python3 "$root/scripts/build-report.py" "$out/$name.docx"
soffice=$(command -v soffice || echo /Applications/LibreOffice.app/Contents/MacOS/soffice)
[ -x "$soffice" ] || { echo "LibreOffice not found; the DOCX is in $out" >&2; exit 1; }
"$soffice" -env:UserInstallation="file://$out/.libreoffice" --headless --norestore \
  --convert-to pdf --outdir "$out" "$out/$name.docx" >/dev/null
echo "$out/$name.pdf"
