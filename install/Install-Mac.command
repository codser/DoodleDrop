#!/bin/bash
# Doodle Drop installer for macOS
DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="$DIR/DoodleDrop"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/DoodleDrop"

echo ""
echo "Installing Doodle Drop for Adobe Premiere Pro..."
echo ""

if [ ! -f "$SRC/CSXS/manifest.xml" ]; then
  echo "Couldn't find the DoodleDrop folder next to this file."
  echo "Unzip the whole download first, then run this again."
  read -n 1 -s -r -p "Press any key to close."
  exit 1
fi

mkdir -p "$DEST"
cp -R "$SRC/." "$DEST/"

# Allow unsigned panels (needed for Doodle Drop) for all recent Premiere versions
for v in 9 10 11 12 13; do defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1; done

echo "Done! Doodle Drop is installed to:"
echo "$DEST"
echo ""
echo "Restart Premiere Pro, then open Window > Extensions > Doodle Drop."
echo ""
read -n 1 -s -r -p "Press any key to close."
