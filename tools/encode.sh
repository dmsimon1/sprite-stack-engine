#!/bin/sh
# encode.sh: capture the camera tour and make an MP4 and a small GIF.   sh tools/encode.sh
# Needs python with Playwright (see capture.py) and ffmpeg. Output goes to out/.
set -e
cd "$(dirname "$0")/.."
PY=${PYTHON:-python3}
mkdir -p out
# 1920x1080, 30 frames a second (every second step of the 60-a-second clock), 18 seconds
$PY tools/capture.py out/tour --size 1920x1080 --step 2 --query "&tour&hud=1.8"
ffmpeg -v error -y -framerate 30 -i out/tour/%04d.png -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -movflags +faststart out/tour.mp4
# the GIF: 400 pixels wide, 10 frames a second, its palette made from the frames
ffmpeg -v error -y -framerate 30 -i out/tour/%04d.png -vf "fps=10,scale=400:-1:flags=area,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" -loop 0 out/tour.gif
ls -l out/tour.mp4 out/tour.gif
